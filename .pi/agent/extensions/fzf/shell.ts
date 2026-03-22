import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ExecOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  killed?: boolean;
}

export type ExecFunction = (
  command: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

interface ShellCommand {
  command: string;
  argsPrefix: string[];
}

function resolveWindowsGitBash(): string | null {
  const candidates = [
    join(process.env.ProgramFiles ?? "", "Git", "bin", "bash.exe"),
    join(process.env.ProgramFiles ?? "", "Git", "usr", "bin", "bash.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "", "Git", "bin", "bash.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "", "Git", "usr", "bin", "bash.exe"),
    join(process.env.LocalAppData ?? "", "Programs", "Git", "bin", "bash.exe"),
    join(process.env.LocalAppData ?? "", "Programs", "Git", "usr", "bin", "bash.exe"),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveShellCommand(): ShellCommand {
  if (process.platform === "win32") {
    const gitBash = resolveWindowsGitBash();
    if (gitBash) {
      return {
        command: gitBash,
        argsPrefix: ["-lc"],
      };
    }

    return {
      command: "bash.exe",
      argsPrefix: ["-lc"],
    };
  }

  return {
    command: "bash",
    argsPrefix: ["-c"],
  };
}

export async function execShell(
  exec: ExecFunction,
  script: string,
  options: ExecOptions = {},
): Promise<ExecResult> {
  const shell = resolveShellCommand();
  return exec(shell.command, [...shell.argsPrefix, script], options);
}
