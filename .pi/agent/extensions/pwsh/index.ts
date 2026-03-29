/**
 * PowerShell Extension
 *
 * Disables the built-in bash tool and provides a "powershell" tool
 * that executes commands via pwsh/powershell.exe and captures output.
 *
 * Placement: ~/.pi/agent/extensions/pwsh/index.ts
 */

import type { BashOperations, ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { createBashToolDefinition } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";

export type ExecProbe = (
  command: string,
  options: { stdio: "ignore" },
) => unknown;

export type PowerShellToolOptions = {
  operations?: BashOperations;
  psExe?: string;
};

export function findPowerShell(probe: ExecProbe = (command, options) => execSync(command, options)): string {
  try {
    probe("pwsh -Version", { stdio: "ignore" });
    return "pwsh";
  } catch {
    return "powershell.exe";
  }
}

export function formatPowerShellCwd(cwd: string, homeDir: string = homedir()): string {
  const normalizedCwd = cwd.replaceAll("/", "\\");
  const normalizedHome = homeDir.replaceAll("/", "\\");

  if (normalizedCwd.toLowerCase() === normalizedHome.toLowerCase()) {
    return "~";
  }

  const homePrefix = `${normalizedHome}\\`;
  if (normalizedCwd.toLowerCase().startsWith(homePrefix.toLowerCase())) {
    return `~\\${normalizedCwd.slice(homePrefix.length)}`;
  }

  return cwd;
}

export function formatPowerShellCall(
  args: { command?: string; timeout?: number } | undefined,
  cwd: string,
): string {
  const command = args?.command && args.command.length > 0 ? args.command : "...";
  const timeoutSuffix = args?.timeout ? ` (timeout ${args.timeout}s)` : "";
  const displayCwd = formatPowerShellCwd(cwd);
  return `$ ${displayCwd} ${command}${timeoutSuffix}`;
}

export function rewriteBashPrompt(prompt: string): string {
  return prompt.replace(
    /Use bash for file operations like ls, rg, find/g,
    "Use powershell for file operations like Get-ChildItem, Select-String, Get-ChildItem -Recurse",
  );
}

export function createPowerShellOperations(psExe: string): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) =>
      new Promise((resolve, reject) => {
        const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
        const child = spawn(
          psExe,
          ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
          {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: env ?? { ...process.env },
          },
        );

        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            child.kill();
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        const onAbort = () => child.kill();
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        const cleanup = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
        };

        child.on("error", (error) => {
          cleanup();
          reject(error);
        });

        child.on("close", (code) => {
          cleanup();

          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }

          if (timedOut) {
            reject(new Error(`timeout:${timeout}`));
            return;
          }

          resolve({ exitCode: code });
        });
      }),
  };
}

export function renderPowerShellCall(
  args: { command?: string; timeout?: number },
  theme: Theme,
  context: { lastComponent?: unknown; cwd: string },
): Text {
  const text = context.lastComponent instanceof Text
    ? context.lastComponent
    : new Text("", 0, 0);

  text.setText(theme.fg("toolTitle", theme.bold(formatPowerShellCall(args, context.cwd))));
  return text;
}

export function createPowerShellToolDefinition(
  cwd: string,
  options: PowerShellToolOptions = {},
) {
  const psExe = options.psExe ?? findPowerShell();
  const baseTool = createBashToolDefinition(cwd, {
    operations: options.operations ?? createPowerShellOperations(psExe),
  });

  return {
    ...baseTool,
    name: "powershell",
    label: "PowerShell",
    description:
      "Execute a PowerShell command in the current working directory. Returns stdout and stderr. " +
      "Output is truncated to last 2000 lines or 50KB (whichever is hit first). " +
      "If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
    promptSnippet: "Execute PowerShell commands and capture output",
    promptGuidelines: [
      "Use the powershell tool instead of bash - this is a Windows environment",
      "Write commands using PowerShell syntax (e.g., Get-ChildItem instead of ls, Select-String instead of grep)",
    ],
    renderCall: renderPowerShellCall,
  };
}

export default function powerShellExtension(pi: ExtensionAPI) {
  const psExe = findPowerShell();
  const operations = createPowerShellOperations(psExe);

  pi.on("session_start", async (_event, ctx) => {
    const active = pi.getActiveTools().filter((tool) => tool !== "bash");
    if (!active.includes("powershell")) active.push("powershell");
    pi.setActiveTools(active);

    pi.registerTool(createPowerShellToolDefinition(ctx.cwd, { psExe, operations }));
  });

  pi.on("user_bash", () => {
    return { operations };
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: rewriteBashPrompt(event.systemPrompt),
    };
  });
}
