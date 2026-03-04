import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type RunResult = { code: number; stdout: string; stderr: string };

function isWslHost(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

function resolveBash(): string | null {
  if (process.platform !== "win32" || isWslHost()) {
    return "bash";
  }

  const candidates = [
    `${process.env.ProgramFiles || ""}\\Git\\bin\\bash.exe`,
    `${process.env["ProgramFiles(x86)"] || ""}\\Git\\bin\\bash.exe`,
    `${process.env.LocalAppData || ""}\\Programs\\Git\\bin\\bash.exe`,
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  const where = spawnSync("cmd.exe", ["/C", "where bash"], { encoding: "utf8", windowsHide: true });
  if (where.status === 0 && where.stdout) {
    const paths = where.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const p of paths) {
      const lower = p.toLowerCase();
      if (lower.endsWith("\\system32\\bash.exe")) continue; // WSL launcher
      if (lower.endsWith("bash.exe")) return p;
    }
  }

  return null;
}

function resolveWindowsPwsh(): string | null {
  if (process.platform === "win32") {
    const wherePwsh = spawnSync("cmd.exe", ["/C", "where pwsh"], { encoding: "utf8", windowsHide: true });
    if (wherePwsh.status === 0 && wherePwsh.stdout) {
      const first = wherePwsh.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) return first;
    }
    return "pwsh.exe";
  }

  if (!isWslHost()) return null;

  const candidates = [
    "/mnt/c/Program Files/PowerShell/7/pwsh.exe",
    "/mnt/c/Program Files/PowerShell/6/pwsh.exe",
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // PATH fallback inside WSL
  const pwshWhere = spawnSync("bash", ["-lc", "command -v pwsh.exe || true"], { encoding: "utf8" });
  const pwsh = (pwshWhere.stdout || "").trim();
  if (pwsh) return pwsh;

  const psWhere = spawnSync("bash", ["-lc", "command -v powershell.exe || true"], { encoding: "utf8" });
  const ps = (psWhere.stdout || "").trim();
  if (ps) return ps;

  return null;
}

function runProcess(bin: string, args: string[], timeoutMs = 30_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        code: 1,
        stdout: stdout.trim(),
        stderr: [stderr.trim(), `timed out after ${Math.floor(timeoutMs / 1000)}s`].filter(Boolean).join("\n"),
      });
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function runBash(command: string, timeoutMs = 15_000): Promise<RunResult> {
  const bashPath = resolveBash();
  if (!bashPath) {
    return Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "Git Bash not found. Install Git for Windows or add Git bash.exe to PATH.",
    });
  }
  return runProcess(bashPath, ["-lc", command], timeoutMs);
}

async function startFigmaViaPwsh(): Promise<RunResult> {
  const pwsh = resolveWindowsPwsh();
  if (!pwsh) {
    return {
      code: 1,
      stdout: "",
      stderr: "Windows PowerShell (pwsh.exe/powershell.exe) not found from this environment.",
    };
  }

  const psScript = [
    '$fig = Join-Path $env:LOCALAPPDATA "Figma\\Figma.exe"',
    'if (!(Test-Path $fig)) { throw "Figma.exe not found at $fig" }',
    'Stop-Process -Name Figma -Force -ErrorAction SilentlyContinue',
    'Start-Sleep -Milliseconds 300',
    'Start-Process -FilePath $fig -ArgumentList "--remote-debugging-port=9222"',
  ].join("; ");

  return runProcess(pwsh, ["-NoProfile", "-Command", psScript], 20_000);
}

async function waitForFigmaUseConnection(maxAttempts = 20, delayMs = 1000): Promise<RunResult> {
  let last: RunResult = { code: 1, stdout: "", stderr: "figma-use status did not report connected" };

  for (let i = 0; i < maxAttempts; i++) {
    const res = await runBash("figma-use status --json", 8_000);
    last = res;

    const payload = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
    try {
      if (payload) {
        const parsed = JSON.parse(payload);
        if (parsed && parsed.connected === true) return { ...res, code: 0 };
      }
    } catch {
      // ignore parse errors and keep retrying
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  return last;
}

export default function figmaStartExtension(pi: ExtensionAPI) {
  pi.registerCommand("figma-start", {
    description: "Start Windows Figma via pwsh (port 9222) then verify with figma-use status",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) ctx.ui.notify("Starting Windows Figma via pwsh...", "info");

      const start = await startFigmaViaPwsh();
      if (start.code !== 0) {
        const output = [start.stdout, start.stderr].filter(Boolean).join("\n");
        const firstLine = output.split(/\r?\n/).find(Boolean) || "unknown error";
        if (ctx.hasUI) ctx.ui.notify(`/figma-start failed: ${firstLine}`, "error");
        return;
      }

      if (ctx.hasUI) ctx.ui.notify("Checking figma-use connection...", "info");
      const status = await waitForFigmaUseConnection();
      const output = [status.stdout, status.stderr].filter(Boolean).join("\n");

      if (status.code === 0) {
        if (ctx.hasUI) ctx.ui.notify("Figma connected (figma-use status OK)", "info");
        return;
      }

      const firstLine = output.split(/\r?\n/).find(Boolean) || "figma-use status not connected";
      if (ctx.hasUI) ctx.ui.notify(`/figma-start failed: ${firstLine}`, "error");
    },
  });
}
