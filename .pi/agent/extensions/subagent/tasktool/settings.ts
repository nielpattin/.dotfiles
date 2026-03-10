import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_MAX_PARALLEL_TASKS = 8;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_DELEGATION_DEPTH = 1;
const TASK_DEPTH_ENV = "PI_TASK_DEPTH";
const TASK_MAX_DEPTH_ENV = "PI_TASK_MAX_DEPTH";
const TASK_MAX_PARALLEL_ENV = "PI_TASK_MAX_PARALLEL";
const TASK_CONCURRENCY_ENV = "PI_TASK_CONCURRENCY";

export interface DelegationDepthConfig {
  currentDepth: number;
  maxDepth: number;
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
      `[pi-task] Ignoring invalid ${envName}="${envRaw}". Expected a positive integer.`,
    );
  }

  const argvFlagRaw = getFlagValueFromArgv(process.argv, flagName);
  const argvFlagValue =
    argvFlagRaw !== null ? parsePositiveInt(argvFlagRaw) : null;
  if (argvFlagRaw !== null && argvFlagValue === null) {
    console.warn(
      `[pi-task] Ignoring invalid --${flagName} value "${argvFlagRaw}". Expected a positive integer.`,
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
      `[pi-task] Ignoring invalid --${flagName} value "${runtimeFlagRaw}". Expected a positive integer.`,
    );
  }

  return argvFlagValue ?? runtimeFlagValue ?? envValue ?? fallback;
}

export function resolveDelegationDepthConfig(pi: ExtensionAPI): DelegationDepthConfig {
  const depthRaw = process.env[TASK_DEPTH_ENV];
  const parsedDepth = parseNonNegativeInt(depthRaw);
  if (depthRaw !== undefined && parsedDepth === null) {
    console.warn(
      `[pi-task] Ignoring invalid ${TASK_DEPTH_ENV}="${depthRaw}". Expected a non-negative integer.`,
    );
  }
  const currentDepth = parsedDepth ?? 0;

  const envMaxDepthRaw = process.env[TASK_MAX_DEPTH_ENV];
  const envMaxDepth = parseNonNegativeInt(envMaxDepthRaw);
  if (envMaxDepthRaw !== undefined && envMaxDepth === null) {
    console.warn(
      `[pi-task] Ignoring invalid ${TASK_MAX_DEPTH_ENV}="${envMaxDepthRaw}". Expected a non-negative integer.`,
    );
  }

  const argvFlagRaw = getFlagValueFromArgv(process.argv, "task-max-depth");
  const argvFlagMaxDepth =
    argvFlagRaw !== null ? parseNonNegativeInt(argvFlagRaw) : null;
  if (argvFlagRaw !== null && argvFlagMaxDepth === null) {
    console.warn(
      `[pi-task] Ignoring invalid --task-max-depth value "${argvFlagRaw}". Expected a non-negative integer.`,
    );
  }

  const runtimeFlagValue = pi.getFlag("task-max-depth");
  const runtimeFlagMaxDepth =
    typeof runtimeFlagValue === "string"
      ? parseNonNegativeInt(runtimeFlagValue)
      : null;
  if (
    argvFlagRaw === null &&
    typeof runtimeFlagValue === "string" &&
    runtimeFlagMaxDepth === null
  ) {
    console.warn(
      `[pi-task] Ignoring invalid --task-max-depth value "${runtimeFlagValue}". Expected a non-negative integer.`,
    );
  }

  const flagMaxDepth = argvFlagMaxDepth ?? runtimeFlagMaxDepth;
  const maxDepth = flagMaxDepth ?? envMaxDepth ?? DEFAULT_MAX_DELEGATION_DEPTH;
  return { currentDepth, maxDepth, canDelegate: currentDepth < maxDepth };
}

export function resolveParallelExecutionConfig(pi: ExtensionAPI): ParallelExecutionConfig {
  const maxParallelTasks = resolvePositiveIntSetting(
    pi,
    "task-max-parallel",
    TASK_MAX_PARALLEL_ENV,
    DEFAULT_MAX_PARALLEL_TASKS,
  );
  const requestedConcurrency = resolvePositiveIntSetting(
    pi,
    "task-concurrency",
    TASK_CONCURRENCY_ENV,
    DEFAULT_MAX_CONCURRENCY,
  );
  const concurrency = Math.min(requestedConcurrency, maxParallelTasks);

  if (requestedConcurrency > maxParallelTasks) {
    console.warn(
      `[pi-task] Clamping task concurrency from ${requestedConcurrency} to ${maxParallelTasks} to respect the max parallel task limit.`,
    );
  }

  return { maxParallelTasks, concurrency };
}
