import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  SUBAGENT_LOG_PREFIX,
  TASK_DEFAULTS,
  TASK_ENV_NAMES,
  TASK_FLAG_NAMES,
} from "../constants.js";

export interface DelegationDepthConfig {
  currentDepth: number;
  canDelegate: boolean;
}

export interface ParallelExecutionConfig {
  maxParallelTasks: number;
  concurrency: number;
}

function parseNonNegativeInt(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInt(raw: unknown): number | null {
  const parsed = parseNonNegativeInt(raw);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function getFlagValueFromArgv(argv: string[], flagName: string): string | null {
  const longFlag = `--${flagName}`;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === longFlag) {
      return argv[i + 1] ?? "";
    }
    if (arg.startsWith(`${longFlag}=`)) {
      return arg.slice(longFlag.length + 1);
    }
  }
  return null;
}

function resolvePositiveIntSetting(
  pi: ExtensionAPI,
  flagName: string,
  envName: string,
  fallback: number,
): number {
  const envRaw = process.env[envName];
  const envValue = parsePositiveInt(envRaw);
  if (envRaw !== undefined && envValue === null) {
    console.warn(
      `${SUBAGENT_LOG_PREFIX} Ignoring invalid ${envName}="${envRaw}". Expected a positive integer.`,
    );
  }

  const argvFlagRaw = getFlagValueFromArgv(process.argv, flagName);
  const argvFlagValue =
    argvFlagRaw !== null ? parsePositiveInt(argvFlagRaw) : null;
  if (argvFlagRaw !== null && argvFlagValue === null) {
    console.warn(
      `${SUBAGENT_LOG_PREFIX} Ignoring invalid --${flagName} value "${argvFlagRaw}". Expected a positive integer.`,
    );
  }

  const runtimeFlagRaw = pi.getFlag(flagName);
  const runtimeFlagValue =
    typeof runtimeFlagRaw === "string"
      ? parsePositiveInt(runtimeFlagRaw)
      : null;
  if (
    argvFlagRaw === null &&
    typeof runtimeFlagRaw === "string" &&
    runtimeFlagValue === null
  ) {
    console.warn(
      `${SUBAGENT_LOG_PREFIX} Ignoring invalid --${flagName} value "${runtimeFlagRaw}". Expected a positive integer.`,
    );
  }

  return argvFlagValue ?? runtimeFlagValue ?? envValue ?? fallback;
}

export function resolveDelegationDepthConfig(_pi: ExtensionAPI): DelegationDepthConfig {
  const depthRaw = process.env[TASK_ENV_NAMES.depth];
  const parsedDepth = parseNonNegativeInt(depthRaw);
  if (depthRaw !== undefined && parsedDepth === null) {
    console.warn(
      `${SUBAGENT_LOG_PREFIX} Ignoring invalid ${TASK_ENV_NAMES.depth}="${depthRaw}". Expected a non-negative integer.`,
    );
  }

  const currentDepth = parsedDepth ?? 0;
  const canDelegate = depthRaw === undefined || parsedDepth === 0;

  return { currentDepth, canDelegate };
}

export function resolveParallelExecutionConfig(pi: ExtensionAPI): ParallelExecutionConfig {
  const maxParallelTasks = resolvePositiveIntSetting(
    pi,
    TASK_FLAG_NAMES.maxParallel,
    TASK_ENV_NAMES.maxParallel,
    TASK_DEFAULTS.maxParallelTasks,
  );
  const requestedConcurrency = resolvePositiveIntSetting(
    pi,
    TASK_FLAG_NAMES.concurrency,
    TASK_ENV_NAMES.concurrency,
    TASK_DEFAULTS.maxConcurrency,
  );
  const concurrency = Math.min(requestedConcurrency, maxParallelTasks);

  if (requestedConcurrency > maxParallelTasks) {
    console.warn(
      `${SUBAGENT_LOG_PREFIX} Clamping task concurrency from ${requestedConcurrency} to ${maxParallelTasks} to respect the max parallel task limit.`,
    );
  }

  return { maxParallelTasks, concurrency };
}
