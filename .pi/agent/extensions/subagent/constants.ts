/** Shared UI refresh cadence for streaming subagent updates. */
export const SUBAGENT_UI_REFRESH_MS = 100;

/** Shared extension log prefix. */
export const SUBAGENT_LOG_PREFIX = "[pi-task]";

/** Stable tool name for registration and task history hydration. */
export const SUBAGENT_TOOL_NAME = "task";

/** Shared fallback text snippets for partial/empty output states. */
export const SUBAGENT_FALLBACK_TEXT = {
  running: "(running...)",
  noOutput: "(no output)",
} as const;

/** Delegation-related CLI flag names. */
export const TASK_FLAG_NAMES = {
  maxDepth: "task-max-depth",
  maxParallel: "task-max-parallel",
  concurrency: "task-concurrency",
} as const;

/** Delegation/process environment variable names. */
export const TASK_ENV_NAMES = {
  depth: "PI_TASK_DEPTH",
  maxDepth: "PI_TASK_MAX_DEPTH",
  maxParallel: "PI_TASK_MAX_PARALLEL",
  concurrency: "PI_TASK_CONCURRENCY",
  offline: "PI_OFFLINE",
} as const;

/** Delegation runtime defaults. */
export const TASK_DEFAULTS = {
  maxParallelTasks: 8,
  maxConcurrency: 4,
  maxDelegationDepth: 1,
} as const;
