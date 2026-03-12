import { spawn } from "node:child_process";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { SubagentDetails, SingleResult, FailureCategory } from "../types.js";
import { TASK_ENV_NAMES } from "../constants.js";
import { processJsonLine } from "./stream.js";
import type { SpawnTarget } from "./spawntarget.js";

const SIGKILL_TIMEOUT_MS = 5000;
const ABORT_SIGNALS = new Set(["SIGINT", "SIGTERM", "SIGKILL"]);
const SIGNAL_EXIT_CODES: Record<string, number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGABRT: 134,
  SIGKILL: 137,
  SIGUSR1: 138,
  SIGSEGV: 139,
  SIGUSR2: 140,
  SIGALRM: 141,
  SIGTERM: 143,
};

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

export function setFailure(
  result: SingleResult,
  category: FailureCategory,
  message?: string,
): SingleResult {
  result.failureCategory = category;
  if (category === "abort") {
    result.stopReason = "aborted";
  } else if (!result.stopReason) {
    result.stopReason = "error";
  }
  if (message) {
    result.errorMessage = message;
    if (!result.stderr.includes(message)) {
      result.stderr += `${message}${result.stderr.endsWith("\n") || result.stderr.length === 0 ? "" : "\n"}`;
    }
  }
  return result;
}

function signalToExitCode(signalName: string): number {
  return SIGNAL_EXIT_CODES[signalName] ?? 128;
}

export interface RunChildProcessOptions {
  spawnTarget: SpawnTarget;
  cwd: string;
  parentDepth: number;
  signal?: AbortSignal;
  result: SingleResult;
  emitUpdate: () => void;
}

export async function runChildProcess(
  options: RunChildProcessOptions,
): Promise<{ exitCode: number; wasAborted: boolean }> {
  const {
    spawnTarget,
    cwd,
    parentDepth,
    signal,
    result,
    emitUpdate,
  } = options;

  let wasAborted = false;

  const exitCode = await new Promise<number>((resolve) => {
    const nextDepth = Math.max(0, Math.floor(parentDepth)) + 1;
    const proc = spawn(spawnTarget.command, spawnTarget.args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        [TASK_ENV_NAMES.depth]: String(nextDepth),
        [TASK_ENV_NAMES.offline]: "1",
      },
    });

    let buffer = "";
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const cleanup = () => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    };

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };

    const requestAbort = (): boolean => {
      if (settled || wasAborted) return false;
      wasAborted = true;
      result.updatedAt = Date.now();
      proc.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }, SIGKILL_TIMEOUT_MS);
      return true;
    };

    const flushLine = (line: string) => {
      if (processJsonLine(line, result)) emitUpdate();
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) flushLine(line);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      result.updatedAt = Date.now();
      result.stderr += chunk.toString();
    });

    proc.on("close", (code, signalName) => {
      result.updatedAt = Date.now();
      if (buffer.trim()) flushLine(buffer);

      if (signalName && code === null && !wasAborted) {
        const normalizedSignal = String(signalName);
        const resolvedExitCode = signalToExitCode(normalizedSignal);
        const message = `Task stopped by ${normalizedSignal}.`;
        if (ABORT_SIGNALS.has(normalizedSignal)) {
          setFailure(result, "abort", message);
        } else {
          setFailure(result, "runtime", message);
        }
        finish(resolvedExitCode);
        return;
      }

      finish(code ?? 0);
    });

    proc.on("error", (err) => {
      result.updatedAt = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      if (!result.stderr.includes(message)) {
        result.stderr += `Spawn error: ${message}\n`;
      }
      if (!wasAborted) {
        setFailure(
          result,
          "startup",
          `Failed to start task process (${spawnTarget.command}).`,
        );
      }
      finish(1);
    });

    if (signal) {
      abortListener = () => {
        if (!requestAbort()) return;
        setFailure(result, "abort", "Task was aborted.");
        if (!result.stderr.endsWith("\n")) {
          result.stderr += "\n";
        }
        emitUpdate();
      };
      if (signal.aborted) abortListener();
      else signal.addEventListener("abort", abortListener, { once: true });
    }
  });

  return { exitCode, wasAborted };
}
