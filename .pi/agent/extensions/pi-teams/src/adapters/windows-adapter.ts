/**
 * Windows Terminal/PowerShell Adapter
 *
 * Implements the TerminalAdapter interface for Windows with PowerShell.
 * Uses wt (Windows Terminal) CLI for pane management and PowerShell for command execution.
 */

import { TerminalAdapter, SpawnOptions, execCommand } from "../utils/terminal-adapter";

export class WindowsAdapter implements TerminalAdapter {
  readonly name = "Windows";

  private wtPath: string | null = null;
  private psPath: string | null = null;

  private findWtBinary(): string | null {
    if (this.wtPath !== null) {
      return this.wtPath;
    }

    const fs = require("fs");
    const possiblePaths = [
      `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe`,
      "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\wt.exe",
    ];

    for (const candidate of possiblePaths) {
      try {
        if (fs.existsSync(candidate)) {
          this.wtPath = candidate;
          return candidate;
        }
      } catch {}
    }

    if (process.platform === "win32") {
      this.wtPath = "wt";
      return "wt";
    }

    this.wtPath = null;
    return null;
  }

  private findPsBinary(): string {
    if (this.psPath !== null) {
      return this.psPath;
    }

    try {
      const result = execCommand("pwsh", ["-NoProfile", "-Command", "echo 'found'"]);
      if (result.status === 0 && result.stdout.trim() === "found") {
        this.psPath = "pwsh";
        return "pwsh";
      }
    } catch {}

    try {
      const result = execCommand("powershell", ["-NoProfile", "-Command", "echo 'found'"]);
      if (result.status === 0 && result.stdout.trim() === "found") {
        this.psPath = "powershell";
        return "powershell";
      }
    } catch {}

    this.psPath = "powershell";
    return "powershell";
  }

  detect(): boolean {
    if (process.platform !== "win32") {
      return false;
    }

    if (process.env.TMUX || process.env.ZELLIJ || process.env.WEZTERM_PANE) {
      return false;
    }

    return true;
  }

  private escapeForSingleQuotedPs(value: string): string {
    return value.replace(/'/g, "''");
  }

  private buildPsScript(options: SpawnOptions): string {
    const cwd = this.escapeForSingleQuotedPs(options.cwd);
    const envVars = Object.entries(options.env)
      .filter(([key]) => key.startsWith("PI_"))
      .map(([key, value]) => `$env:${key}='${this.escapeForSingleQuotedPs(value)}'`)
      .join("; ");

    const envPrefix = envVars ? `${envVars}; ` : "";
    return `${envPrefix}Set-Location -LiteralPath '${cwd}'; ${options.command}`;
  }

  private encodePsCommand(script: string): string {
    return Buffer.from(script, "utf16le").toString("base64");
  }

  private buildSplitPaneArgs(options: SpawnOptions, splitDirection: "vertical" | "horizontal"): string[] {
    const psBin = this.findPsBinary();
    const encodedCommand = this.encodePsCommand(this.buildPsScript(options));

    return [
      "-w", "0",
      "split-pane",
      "--profile", "pi-teams-pwsh",
      splitDirection === "vertical" ? "--vertical" : "--horizontal",
      "--size", "0.5",
      "--",
      psBin,
      "-EncodedCommand",
      encodedCommand,
    ];
  }

  spawn(options: SpawnOptions): string {
    const wtBin = this.findWtBinary();
    if (!wtBin) {
      throw new Error("Windows Terminal (wt) CLI binary not found.");
    }

    const attempts = [
      this.buildSplitPaneArgs(options, "vertical"),
      this.buildSplitPaneArgs(options, "horizontal"),
    ];

    let lastError = "";
    for (const wtArgs of attempts) {
      const result = execCommand(wtBin, wtArgs);
      if (result.status === 0) {
        return `windows_${Date.now()}_${options.name}`;
      }
      lastError = result.stderr || result.stdout || "unknown error";
    }

    throw new Error(`Windows Terminal spawn failed: ${lastError}`);
  }

  kill(paneId: string): void {
    if (!paneId?.startsWith("windows_")) return;
  }

  isAlive(paneId: string): boolean {
    if (!paneId?.startsWith("windows_")) return false;
    return true;
  }

  setTitle(title: string): void {
    return;
  }

  supportsWindows(): boolean {
    return this.findWtBinary() !== null;
  }

  spawnWindow(options: SpawnOptions): string {
    const wtBin = this.findWtBinary();
    if (!wtBin) {
      throw new Error("Windows Terminal (wt) CLI binary not found.");
    }

    const psBin = this.findPsBinary();
    const encodedCommand = this.encodePsCommand(this.buildPsScript(options));
    const windowTitle = options.teamName ? `${options.teamName}: ${options.name}` : options.name;

    const spawnArgs = [
      "-w", "new",
      "--profile", "pi-teams-pwsh",
      "--title", windowTitle,
      "--",
      psBin,
      "-EncodedCommand",
      encodedCommand,
    ];

    const result = execCommand(wtBin, spawnArgs);
    if (result.status !== 0) {
      throw new Error(`Windows Terminal spawn-window failed: ${result.stderr || result.stdout}`);
    }

    return `windows_win_${Date.now()}_${options.name}`;
  }

  setWindowTitle(windowId: string, title: string): void {
    return;
  }

  killWindow(windowId: string): void {
    if (!windowId?.startsWith("windows_win_")) return;
  }

  isWindowAlive(windowId: string): boolean {
    if (!windowId?.startsWith("windows_win_")) return false;
    return true;
  }
}
