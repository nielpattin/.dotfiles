/**
 * Terminal Adapter Interface
 *
 * pi-teams currently targets Windows Terminal.
 */

import { spawnSync } from "node:child_process";

export interface SpawnOptions {
  name: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
  teamName?: string;
}

export interface TerminalAdapter {
  readonly name: string;
  detect(): boolean;
  spawn(options: SpawnOptions): string;
  kill(paneId: string): void;
  isAlive(paneId: string): boolean;
  setTitle(title: string): void;
  supportsWindows(): boolean;
  spawnWindow(options: SpawnOptions): string;
  setWindowTitle(windowId: string, title: string): void;
  killWindow(windowId: string): void;
  isWindowAlive(windowId: string): boolean;
}

export function execCommand(command: string, args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(command, args, { encoding: "utf-8" });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status,
  };
}
