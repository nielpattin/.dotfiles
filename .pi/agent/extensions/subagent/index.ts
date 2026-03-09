/**
 * Pi Task Extension
 *
 * Delegates tasks to specialized task agents, each running as an isolated `pi`
 * process.
 *
 * Supports two invocation shapes:
 *   - Single:   { agent: "name", summary: "...", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", summary: "...", task: "..." }, ...] }
 *
 * And two context modes:
 *   - spawn (default): child gets only the task prompt.
 *   - fork: child gets a forked snapshot of current session context + task prompt.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type AgentConfig, discoverAgents } from "./agents.js";
import { SUBAGENT_UI_REFRESH_MS } from "./constants.js";
import { renderCall, renderResult } from "./render.js";
import { mapConcurrent, runAgent } from "./runner.js";
import {
  type DelegationMode,
  type SingleResult,
  type SubagentDetails,
  DEFAULT_DELEGATION_MODE,
  emptyUsage,
  getFailureCategory,
  getFinalOutput,
  isResultError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PARALLEL_TASKS = 8;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_DELEGATION_DEPTH = 1;
const TASK_DEPTH_ENV = "PI_TASK_DEPTH";
const TASK_MAX_DEPTH_ENV = "PI_TASK_MAX_DEPTH";
const TASK_MAX_PARALLEL_ENV = "PI_TASK_MAX_PARALLEL";
const TASK_CONCURRENCY_ENV = "PI_TASK_CONCURRENCY";

// ---------------------------------------------------------------------------
// Tool parameter schema
// ---------------------------------------------------------------------------

const TaskItem = Type.Object({
  agent: Type.String({
    description: "Name of an available agent (must match exactly)",
  }),
  task: Type.String({
    description:
      "Task description for this delegated run. In spawn mode include all required context; in fork mode the task agent also sees your current session context.",
  }),
  summary: Type.String({
    minLength: 1,
    pattern: "\\S",
    description:
      "Short UI summary for this delegated run. Displayed in task card headers. Does not change the task sent to the child agent.",
  }),
  mode: Type.Optional(
    Type.String({
      description:
        "Context mode for this task only. Overrides the top-level mode when present. Supports \"spawn\" and \"fork\".",
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for this agent's process" }),
  ),
});

const TaskParams = Type.Object({
  agent: Type.Optional(
    Type.String({
      description:
        "Agent name for single mode. Must match an available agent name exactly.",
    }),
  ),
  task: Type.Optional(
    Type.String({
      description:
        "Task description for single mode. In spawn mode it must be self-contained; in fork mode the task agent also receives your current session context.",
    }),
  ),
  summary: Type.Optional(
    Type.String({
      minLength: 1,
      pattern: "\\S",
      description:
        "Short UI summary for single mode. Required with agent/task at runtime. Displayed in task card headers. Does not change the task sent to the child agent.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      minItems: 1,
      description:
        "For parallel mode: array of {agent, summary, task, mode?} objects. Each task runs in an isolated process concurrently. Do NOT set top-level agent/task when using this.",
    }),
  ),
  mode: Type.Optional(
    Type.String({
      description:
        "Context mode for delegated runs. 'spawn' (default) sends only the task prompt (best for isolated, reproducible runs with lower token/cost and less context leakage). 'fork' adds a snapshot of current session context plus task prompt (best for follow-up work that depends on prior context; usually higher token/cost and may include sensitive context).",
      default: DEFAULT_DELEGATION_MODE,
    }),
  ),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      description:
        "Whether to prompt the user before running project-local agents. Default: true.",
      default: true,
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the agent process (single mode only)",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DelegationDepthConfig {
  currentDepth: number;
  maxDepth: number;
  canDelegate: boolean;
}

interface ParallelExecutionConfig {
  maxParallelTasks: number;
  concurrency: number;
}

interface SessionSnapshotSource {
  getHeader: () => unknown;
  getBranch: () => unknown[];
}

function parseDelegationMode(raw: unknown): DelegationMode | null {
  if (raw === undefined) return DEFAULT_DELEGATION_MODE;
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "spawn" || normalized === "fork") {
    return normalized;
  }
  return null;
}

function parseTaskDelegationMode(raw: unknown): DelegationMode | null | undefined {
  if (raw === undefined) return undefined;
  return parseDelegationMode(raw);
}

function hasNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildForkSessionSnapshotJsonl(
  sessionManager: SessionSnapshotSource,
): string | null {
  const header = sessionManager.getHeader();
  if (!header || typeof header !== "object") return null;

  const branchEntries = sessionManager.getBranch();
  const lines = [JSON.stringify(header)];
  for (const entry of branchEntries) lines.push(JSON.stringify(entry));
  return `${lines.join("\n")}\n`;
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

function resolveDelegationDepthConfig(pi: ExtensionAPI): DelegationDepthConfig {
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

function resolveParallelExecutionConfig(pi: ExtensionAPI): ParallelExecutionConfig {
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

function makeDetailsFactory(
  projectAgentsDir: string | null,
  delegationMode: DelegationMode,
) {
  return (mode: "single" | "parallel") =>
    (results: SingleResult[]): SubagentDetails => ({
      mode,
      delegationMode,
      projectAgentsDir,
      results,
    });
}

function formatAgentNames(agents: AgentConfig[]): string {
  return agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
}

function getResultStatusLabel(result: SingleResult): string {
  const failureCategory = getFailureCategory(result);
  if (failureCategory === "abort") return "aborted";
  if (failureCategory) return `${failureCategory} failed`;
  if (result.exitCode === 0) return "completed";
  return result.stopReason || "failed";
}

type WidgetRunState = "queued" | "running" | "success" | "error" | "aborted";

interface DelegatedRunWidgetItem {
  key: string;
  agent: string;
  summary: string;
  state: WidgetRunState;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  activity?: string;
  error?: string;
}

const SUBAGENT_RUNS_WIDGET_ID = "subagent-runs";
const SUBAGENT_RUNS_WIDGET_MAX_ROWS = 8;
const SUBAGENT_RUNS_WIDGET_MAX_LINE_LENGTH = 84;
const SUBAGENT_RUNS_WIDGET_LINGER_MS = 5_000;

function shortenInline(text: string, max = SUBAGENT_RUNS_WIDGET_MAX_LINE_LENGTH): string {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function toWidgetRunState(result: SingleResult): WidgetRunState {
  if (result.exitCode === -1) return "running";
  const failureCategory = getFailureCategory(result);
  if (failureCategory === "abort") return "aborted";
  if (failureCategory) return "error";
  return "success";
}

function getWidgetStateIcon(state: WidgetRunState): string {
  if (state === "running") return "▶";
  if (state === "queued") return "○";
  if (state === "success") return "✓";
  if (state === "aborted") return "⏹";
  return "✕";
}

function pickRunActivity(result: SingleResult): string | undefined {
  if (result.activeTool?.name) return `tool: ${result.activeTool.name}`;
  if (result.lastTool?.name) return `last: ${result.lastTool.name}`;
  const output = getFinalOutput(result.messages);
  if (output) return shortenInline(output, 44);
  if (result.errorMessage) return shortenInline(result.errorMessage, 44);
  if (result.stderr) return shortenInline(result.stderr, 44);
  return undefined;
}

/** Get project-local agents referenced by the current request. */
function getRequestedProjectAgents(
  agents: AgentConfig[],
  requestedNames: Set<string>,
): AgentConfig[] {
  return Array.from(requestedNames)
    .map((name) => agents.find((a) => a.name === name))
    .filter((a): a is AgentConfig => a?.source === "project");
}

/**
 * Prompt the user to confirm project-local agents if needed.
 * Returns false if the user declines.
 */
async function confirmProjectAgentsIfNeeded(
  projectAgents: AgentConfig[],
  projectAgentsDir: string | null,
  ctx: { ui: { confirm: (title: string, body: string) => Promise<boolean> } },
): Promise<boolean> {
  if (projectAgents.length === 0) return true;

  const names = projectAgents.map((a) => a.name).join(", ");
  const dir = projectAgentsDir ?? "(unknown)";
  return ctx.ui.confirm(
    "Run project-local agents?",
    `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
  );
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerFlag("task-max-depth", {
    description: "Maximum allowed task delegation depth (default: 1).",
    type: "string",
  });
  pi.registerFlag("task-max-parallel", {
    description: "Maximum number of tasks allowed in one parallel batch (default: 8).",
    type: "string",
  });
  pi.registerFlag("task-concurrency", {
    description: "Maximum number of child agents run at once in parallel mode (default: 4).",
    type: "string",
  });

  const depthConfig = resolveDelegationDepthConfig(pi);
  const parallelConfig = resolveParallelExecutionConfig(pi);
  const { currentDepth, maxDepth, canDelegate } = depthConfig;
  const { maxParallelTasks, concurrency } = parallelConfig;

  let discoveredAgents: AgentConfig[] = [];
  const delegatedRuns = new Map<string, DelegatedRunWidgetItem>();
  let widgetFailed = false;
  let widgetLingerTimer: NodeJS.Timeout | undefined;
  let latestWidgetCtx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } } | undefined;

  const clearWidgetLingerTimer = () => {
    if (widgetLingerTimer) {
      clearTimeout(widgetLingerTimer);
      widgetLingerTimer = undefined;
    }
  };

  const clearExpiredDelegatedRuns = (now = Date.now()) => {
    for (const [key, run] of delegatedRuns.entries()) {
      if (!run.finishedAt) continue;
      if (now - run.finishedAt > SUBAGENT_RUNS_WIDGET_LINGER_MS) {
        delegatedRuns.delete(key);
      }
    }
  };

  const sortDelegatedRuns = (runs: DelegatedRunWidgetItem[]): DelegatedRunWidgetItem[] => {
    const rank = (state: WidgetRunState): number => {
      if (state === "running") return 0;
      if (state === "queued") return 1;
      return 2;
    };
    return [...runs].sort((a, b) => {
      const rankDiff = rank(a.state) - rank(b.state);
      if (rankDiff !== 0) return rankDiff;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  };

  const buildDelegatedRunsWidgetLines = (now = Date.now()): string[] => {
    const visibleRuns = sortDelegatedRuns(
      [...delegatedRuns.values()].filter((run) =>
        run.state === "running"
        || run.state === "queued"
        || (run.finishedAt !== undefined && now - run.finishedAt <= SUBAGENT_RUNS_WIDGET_LINGER_MS)
      ),
    );
    if (visibleRuns.length === 0) return [];

    const running = visibleRuns.filter((run) => run.state === "running").length;
    const queued = visibleRuns.filter((run) => run.state === "queued").length;
    const recent = visibleRuns.length - running - queued;

    const lines = [
      `Subagent runs: ${running} running · ${queued} queued · ${recent} recent`,
    ];

    const shownRuns = visibleRuns.slice(0, SUBAGENT_RUNS_WIDGET_MAX_ROWS);
    for (const run of shownRuns) {
      const status = `${getWidgetStateIcon(run.state)} ${run.agent}: ${run.summary}`;
      const detail = run.error || run.activity;
      lines.push(
        shortenInline(detail ? `${status} — ${detail}` : status),
      );
    }

    const hiddenCount = visibleRuns.length - shownRuns.length;
    if (hiddenCount > 0) {
      lines.push(`… ${hiddenCount} more`);
    }

    return lines.slice(0, 10);
  };

  const renderDelegatedRunsWidget = (ctxOverride?: {
    hasUI: boolean;
    ui?: { setWidget?: (...args: any[]) => void };
  }) => {
    if (widgetFailed) return;
    const ctx = ctxOverride ?? latestWidgetCtx;
    if (!ctx?.hasUI) return;
    if (typeof ctx.ui?.setWidget !== "function") return;

    latestWidgetCtx = ctx;
    const now = Date.now();
    clearExpiredDelegatedRuns(now);
    const lines = buildDelegatedRunsWidgetLines(now);

    try {
      if (lines.length === 0) {
        ctx.ui.setWidget(SUBAGENT_RUNS_WIDGET_ID, undefined);
      } else {
        ctx.ui.setWidget(
          SUBAGENT_RUNS_WIDGET_ID,
          lines,
          { placement: "aboveEditor" },
        );
      }
    } catch (error) {
      widgetFailed = true;
      clearWidgetLingerTimer();
      console.warn(`[pi-task] Failed to render subagent widget: ${String(error)}`);
      return;
    }

    clearWidgetLingerTimer();
    const expirations = [...delegatedRuns.values()]
      .filter((run) => run.finishedAt !== undefined)
      .map((run) => (run.finishedAt as number) + SUBAGENT_RUNS_WIDGET_LINGER_MS - now)
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b);

    const nextExpiration = expirations[0];
    if (nextExpiration !== undefined) {
      widgetLingerTimer = setTimeout(() => {
        renderDelegatedRunsWidget();
      }, nextExpiration + 5);
    }
  };

  const upsertDelegatedRun = (
    key: string,
    partial: Partial<DelegatedRunWidgetItem> & Pick<DelegatedRunWidgetItem, "agent" | "summary" | "state">,
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
  ) => {
    const now = Date.now();
    const existing = delegatedRuns.get(key);
    const next: DelegatedRunWidgetItem = {
      key,
      agent: partial.agent,
      summary: partial.summary,
      state: partial.state,
      startedAt: partial.startedAt ?? existing?.startedAt ?? now,
      updatedAt: partial.updatedAt ?? now,
      finishedAt: partial.finishedAt ?? existing?.finishedAt,
      activity: partial.activity ?? existing?.activity,
      error: partial.error ?? existing?.error,
    };
    if (next.state === "running" || next.state === "queued") {
      next.finishedAt = undefined;
      if (next.state === "running") next.error = undefined;
    } else if (!next.finishedAt) {
      next.finishedAt = now;
    }

    delegatedRuns.set(key, next);
    renderDelegatedRunsWidget(ctx);
  };

  const syncDelegatedRunWithResult = (
    key: string,
    fallbackAgent: string,
    fallbackSummary: string,
    result: SingleResult,
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
  ) => {
    const state = toWidgetRunState(result);
    const now = Date.now();
    upsertDelegatedRun(
      key,
      {
        agent: result.agent || fallbackAgent,
        summary: result.summary || fallbackSummary,
        state,
        startedAt: result.startedAt,
        updatedAt: result.updatedAt || now,
        finishedAt: state === "running" ? undefined : (result.updatedAt || now),
        activity: pickRunActivity(result),
        error:
          state === "error" || state === "aborted"
            ? shortenInline(result.errorMessage || result.stderr || result.stopReason || state, 44)
            : undefined,
      },
      ctx,
    );
  };

  function refreshDiscoveredAgents(cwd: string): AgentConfig[] {
    const discovery = discoverAgents(cwd, "both");
    discoveredAgents = discovery.agents;
    return discoveredAgents;
  }

  // Auto-discover agents on session start
  pi.on("session_start", async (_event, ctx) => {
    if (!canDelegate) return;

    delegatedRuns.clear();
    widgetFailed = false;
    clearWidgetLingerTimer();
    latestWidgetCtx = ctx.hasUI ? ctx : undefined;
    renderDelegatedRunsWidget(ctx);

    const agents = refreshDiscoveredAgents(ctx.cwd);

    if (agents.length > 0 && ctx.hasUI) {
      const list = agents
        .map((a) => `  - ${a.name} (${a.source})`)
        .join("\n");
      ctx.ui.notify(
        `Found ${agents.length} task agent(s):\n${list}`,
        "info",
      );
    }
  });

  // Inject available agents into the system prompt
  pi.on("before_agent_start", async (event, ctx) => {
    if (!canDelegate) return;

    const agents = ctx ? refreshDiscoveredAgents(ctx.cwd) : discoveredAgents;
    if (agents.length === 0) return;

    const agentList = agents
      .map((a) => `- **${a.name}**: ${a.description}`)
      .join("\n");
    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## Available Task Agents

The following task agents are available via the \`task\` tool:

${agentList}

### How to call the task tool

Each task runs in an **isolated process**.

Context behavior is controlled by optional 'mode':
- 'spawn' (default): child receives only the provided task prompt. Best for isolated, reproducible tasks with lower token/cost and less context leakage.
- 'fork': child receives a forked snapshot of current session context plus the task prompt. Best for follow-up tasks that rely on prior context; usually higher token/cost and may include sensitive context.
- In parallel mode, \`tasks[i].mode\` can override the top-level \`mode\` for that task only.

**Single mode** — delegate one task:
\`\`\`json
{ "agent": "agent-name", "summary": "Short task summary", "task": "Detailed task...", "mode": "spawn" }
\`\`\`

**Parallel mode** — run multiple tasks concurrently (do NOT also set agent/task):
\`\`\`json
{ "tasks": [{ "agent": "agent-name", "summary": "Short task summary", "task": "...", "mode": "spawn" }, { "agent": "other-agent", "summary": "Short task summary", "task": "..." }], "mode": "fork" }
\`\`\`

Use single mode for one task, parallel mode when tasks are independent and can run simultaneously.
`,
    };
  });

  pi.on("session_shutdown", async () => {
    delegatedRuns.clear();
    clearWidgetLingerTimer();
    if (!widgetFailed && latestWidgetCtx?.hasUI && typeof latestWidgetCtx.ui?.setWidget === "function") {
      try {
        latestWidgetCtx.ui.setWidget(SUBAGENT_RUNS_WIDGET_ID, undefined);
      } catch {
        widgetFailed = true;
      }
    }
    latestWidgetCtx = undefined;
  });

  // Register the task tool
  if (canDelegate) {
    pi.registerTool({
      name: "task",
      label: "Task",
      description: [
        "Delegate work to specialized task agents running in isolated pi processes.",
        "",
        "IMPORTANT: Use exactly ONE invocation shape:",
        "  Single mode:   set `agent`, `summary`, and `task` (all required together).",
        "  Parallel mode: set `tasks` array with `agent`, `summary`, and `task` for each item (do NOT also set top-level `agent`/`task`).",
        "",
        "Optional context mode switch:",
        "  mode: \"spawn\" (default) -> child gets only your task prompt.",
        "                             Best for isolated/reproducible work; lower token/cost and less context leakage.",
        "  mode: \"fork\"            -> child gets current session context + your task prompt.",
        "                             Best for follow-up work that depends on prior context; higher token/cost and may include sensitive context.",
        "  tasks[i].mode             -> overrides top-level mode for that parallel task only.",
        "",
        'Example single:   { agent: "writer", summary: "README rewrite", task: "Rewrite README.md", mode: "spawn" }',
        'Example parallel: { tasks: [{ agent: "writer", summary: "README rewrite", task: "...", mode: "spawn" }, { agent: "tester", summary: "Validation pass", task: "..." }], mode: "fork" }',
      ].join("\n"),
      parameters: TaskParams,

      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const discovery = discoverAgents(ctx.cwd, "both");
        const { agents } = discovery;

        const defaultDelegationMode = parseDelegationMode(params.mode);
        if (!defaultDelegationMode) {
          const invalidModeDetails = makeDetailsFactory(
            discovery.projectAgentsDir,
            DEFAULT_DELEGATION_MODE,
          );
          return {
            content: [
              {
                type: "text",
                text: `Invalid mode \"${String(params.mode)}\". Expected \"spawn\" or \"fork\".\nAvailable agents: ${formatAgentNames(agents)}`,
              },
            ],
            details: invalidModeDetails("single")([]),
            isError: true,
          };
        }

        const makeDetails = makeDetailsFactory(
          discovery.projectAgentsDir,
          defaultDelegationMode,
        );

        const hasParallelTasks = Array.isArray(params.tasks)
          && params.tasks.length > 0
          && params.tasks.every((task) =>
            hasNonBlankText(task.agent)
            && hasNonBlankText(task.summary)
            && hasNonBlankText(task.task)
            && (task.cwd === undefined || typeof task.cwd === "string")
            && (task.mode === undefined || typeof task.mode === "string"),
          );
        const hasAnySingleShapeField =
          params.agent !== undefined
          || params.summary !== undefined
          || params.task !== undefined
          || params.cwd !== undefined;
        const hasSingleTask =
          hasNonBlankText(params.agent)
          && hasNonBlankText(params.summary)
          && hasNonBlankText(params.task);

        if (params.tasks !== undefined && !hasParallelTasks) {
          return {
            content: [
              {
                type: "text",
                text: "Invalid parallel task parameters. Each task item requires agent, summary, and task.",
              },
            ],
            details: makeDetails("parallel")([]),
            isError: true,
          };
        }
        if (!hasParallelTasks && hasAnySingleShapeField && !hasSingleTask) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid single-task parameters. Single mode requires agent, summary, and task.\nAvailable agents: ${formatAgentNames(agents)}`,
              },
            ],
            details: makeDetails("single")([]),
            isError: true,
          };
        }
        if ((hasParallelTasks && hasAnySingleShapeField) || (!hasParallelTasks && !hasSingleTask)) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid parameters. Provide exactly one invocation shape.\nAvailable agents: ${formatAgentNames(agents)}`,
              },
            ],
            details: makeDetails(hasParallelTasks ? "parallel" : "single")([]),
            isError: true,
          };
        }

        const isParallel = hasParallelTasks;
        const singleDelegationMode = defaultDelegationMode;
        const parallelTasks = hasParallelTasks
          ? params.tasks!.map((task) => {
            const taskDelegationMode = parseTaskDelegationMode(task.mode);
            return {
              agent: task.agent,
              task: task.task,
              summary: task.summary,
              cwd: task.cwd,
              rawMode: task.mode,
              delegationMode: taskDelegationMode ?? defaultDelegationMode,
              hasInvalidMode: taskDelegationMode === null,
            };
          })
          : undefined;
        const invalidTaskMode = parallelTasks?.find((task) => task.hasInvalidMode);
        if (invalidTaskMode) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid task mode \"${String(invalidTaskMode.rawMode)}\" for parallel task \"${invalidTaskMode.summary}\". Expected \"spawn\" or \"fork\".`,
              },
            ],
            details: makeDetails("parallel")([]),
            isError: true,
          };
        }

        const singleAgent = hasSingleTask ? params.agent! : undefined;
        const singleTask = hasSingleTask ? params.task! : undefined;
        const singleSummary = hasSingleTask ? params.summary! : undefined;
        const needsForkSnapshot = isParallel
          ? parallelTasks!.some((task) => task.delegationMode === "fork")
          : singleDelegationMode === "fork";

        let forkSessionSnapshotJsonl: string | undefined;
        if (needsForkSnapshot) {
          forkSessionSnapshotJsonl =
            buildForkSessionSnapshotJsonl(ctx.sessionManager) ?? undefined;
          if (!forkSessionSnapshotJsonl) {
            return {
              content: [
                {
                  type: "text",
                  text: "Cannot use mode=\"fork\": failed to snapshot current session context.",
                },
              ],
              details: makeDetails(isParallel ? "parallel" : "single")([]),
              isError: true,
            };
          }
        }

        // Security: guard project-local agents before running
        const requested = new Set<string>();
        if (isParallel) {
          for (const t of parallelTasks!) requested.add(t.agent);
        } else {
          requested.add(singleAgent!);
        }

        const requestedProjectAgents = getRequestedProjectAgents(
          agents,
          requested,
        );
        const shouldConfirmProjectAgents = params.confirmProjectAgents ?? true;
        if (requestedProjectAgents.length > 0 && shouldConfirmProjectAgents) {
          if (ctx.hasUI) {
            const approved = await confirmProjectAgentsIfNeeded(
              requestedProjectAgents,
              discovery.projectAgentsDir,
              ctx,
            );
            if (!approved) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Canceled: project-local agents not approved.",
                  },
                ],
                details: makeDetails(isParallel ? "parallel" : "single")([]),
              };
            }
          } else {
            const names = requestedProjectAgents.map((a) => a.name).join(", ");
            const dir = discovery.projectAgentsDir ?? "(unknown)";
            return {
              content: [
                {
                  type: "text",
                  text: `Blocked: project-local agent confirmation is required in non-UI mode.\nAgents: ${names}\nSource: ${dir}\n\nRe-run with confirmProjectAgents: false only if this repository is trusted.`,
                },
              ],
              details: makeDetails(isParallel ? "parallel" : "single")([]),
              isError: true,
            };
          }
        }

        const inheritedThinking = pi.getThinkingLevel();

        // ── Parallel mode ──
        if (isParallel) {
          return executeParallel(
            toolCallId,
            parallelTasks!,
            inheritedThinking,
            forkSessionSnapshotJsonl,
            agents,
            ctx.cwd,
            signal,
            onUpdate,
            ctx,
            makeDetails,
            maxParallelTasks,
            concurrency,
          );
        }

        // ── Single mode ──
        return executeSingle(
          toolCallId,
          singleAgent!,
          singleTask!,
          singleSummary!,
          params.cwd,
          singleDelegationMode,
          inheritedThinking,
          forkSessionSnapshotJsonl,
          agents,
          ctx.cwd,
          signal,
          onUpdate,
          ctx,
          makeDetails,
        );
      },

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded, isPartial }, theme) =>
        renderResult(result, expanded, isPartial, theme),
    });
  }

  // -----------------------------------------------------------------------
  // Mode implementations
  // -----------------------------------------------------------------------

  async function executeSingle(
    toolCallId: string,
    agentName: string,
    task: string,
    summary: string,
    cwd: string | undefined,
    delegationMode: DelegationMode,
    inheritedThinking: string,
    forkSessionSnapshotJsonl: string | undefined,
    agents: AgentConfig[],
    baseCwd: string,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
    makeDetails: ReturnType<typeof makeDetailsFactory>,
  ) {
    const agent = agents.find((candidate) => candidate.name === agentName);
    const now = Date.now();
    let latestResult: SingleResult = {
      agent: agentName,
      agentSource: agent?.source ?? "unknown",
      task,
      summary,
      delegationMode,
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
      startedAt: now,
      updatedAt: now,
      model: agent?.model,
      provider: agent?.model?.includes("/") ? agent.model.split("/")[0] : undefined,
      thinking: agent?.thinking ?? inheritedThinking,
    };
    const runKey = `${toolCallId}:0`;
    upsertDelegatedRun(
      runKey,
      {
        agent: agentName,
        summary,
        state: "running",
        startedAt: now,
        updatedAt: now,
        activity: "starting",
      },
      ctx,
    );

    const emitSingleProgress = (current: SingleResult) => {
      if (!onUpdate) return;
      onUpdate({
        content: [
          {
            type: "text",
            text: getFinalOutput(current.messages) || "(running...)",
          },
        ],
        details: makeDetails("single")([current]),
      });
    };

    const handleChildUpdate = (partial: any) => {
      const streamed = partial?.details?.results?.[0];
      if (streamed) {
        latestResult = streamed as SingleResult;
        syncDelegatedRunWithResult(runKey, agentName, summary, latestResult, ctx);
      }
      onUpdate?.(partial);
    };

    let heartbeat: NodeJS.Timeout | undefined;
    if (onUpdate) {
      emitSingleProgress(latestResult);
      heartbeat = setInterval(() => {
        if (latestResult.exitCode === -1) emitSingleProgress(latestResult);
      }, SUBAGENT_UI_REFRESH_MS);
    }

    const result = await (async () => {
      try {
        const finalResult = await runAgent({
          cwd: baseCwd,
          agents,
          agentName,
          task,
          summary,
          taskCwd: cwd,
          delegationMode,
          inheritedThinking,
          forkSessionSnapshotJsonl,
          parentDepth: currentDepth,
          maxDepth,
          signal,
          onUpdate: handleChildUpdate,
          makeDetails: makeDetails("single"),
        });
        latestResult = finalResult;
        syncDelegatedRunWithResult(runKey, agentName, summary, latestResult, ctx);
        return finalResult;
      } catch (error) {
        upsertDelegatedRun(
          runKey,
          {
            agent: agentName,
            summary,
            state: signal?.aborted ? "aborted" : "error",
            updatedAt: Date.now(),
            finishedAt: Date.now(),
            error: shortenInline(String(error), 44),
          },
          ctx,
        );
        throw error;
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    })();

    if (isResultError(result)) {
      const errorMsg =
        result.errorMessage ||
        result.stderr ||
        getFinalOutput(result.messages) ||
        "(no output)";
      return {
        content: [
          {
            type: "text" as const,
            text: `Agent ${getResultStatusLabel(result)}: ${errorMsg}`,
          },
        ],
        details: makeDetails("single")([result]),
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: getFinalOutput(result.messages) || "(no output)",
        },
      ],
      details: makeDetails("single")([result]),
    };
  }

  async function executeParallel(
    toolCallId: string,
    tasks: Array<{
      agent: string;
      task: string;
      summary: string;
      cwd?: string;
      delegationMode: DelegationMode;
    }>,
    inheritedThinking: string,
    forkSessionSnapshotJsonl: string | undefined,
    agents: AgentConfig[],
    baseCwd: string,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
    makeDetails: ReturnType<typeof makeDetailsFactory>,
    maxParallelTasks: number,
    concurrency: number,
  ) {
    if (tasks.length > maxParallelTasks) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Too many parallel tasks (${tasks.length}). Max is ${maxParallelTasks}.`,
          },
        ],
        details: makeDetails("parallel")([]),
      };
    }

    // Initialize placeholder results for streaming
    const now = Date.now();
    const runKeys = tasks.map((_task, index) => `${toolCallId}:${index}`);
    const allResults: SingleResult[] = tasks.map((t, index) => {
      const agent = agents.find((candidate) => candidate.name === t.agent);
      upsertDelegatedRun(
        runKeys[index]!,
        {
          agent: t.agent,
          summary: t.summary,
          state: "queued",
          startedAt: now,
          updatedAt: now,
          activity: "waiting for slot",
        },
        ctx,
      );
      return {
        agent: t.agent,
        agentSource: agent?.source ?? "unknown",
        task: t.task,
        summary: t.summary,
        delegationMode: t.delegationMode,
        exitCode: -1,
        messages: [],
        stderr: "",
        usage: emptyUsage(),
        startedAt: now,
        updatedAt: now,
        model: agent?.model,
        provider: agent?.model?.includes("/") ? agent.model.split("/")[0] : undefined,
        thinking: agent?.thinking ?? inheritedThinking,
      };
    });

    const emitProgress = () => {
      if (!onUpdate) return;
      const running = allResults.filter((r) => r.exitCode === -1).length;
      const done = allResults.filter((r) => r.exitCode !== -1).length;
      onUpdate({
        content: [
          {
            type: "text",
            text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
          },
        ],
        details: makeDetails("parallel")([...allResults]),
      });
    };

    let heartbeat: NodeJS.Timeout | undefined;
    if (onUpdate) {
      emitProgress();
      heartbeat = setInterval(() => {
        if (allResults.some((r) => r.exitCode === -1)) emitProgress();
      }, SUBAGENT_UI_REFRESH_MS);
    }

    const finalizeUnexpectedParallelFailure = (error: unknown): SingleResult[] => {
      const now = Date.now();
      const failureText = error instanceof Error
        ? error.message
        : String(error);
      const errorMessage = signal?.aborted
        ? "Task was aborted."
        : `Parallel execution failed unexpectedly: ${failureText}`;

      const finalized = allResults.map((existing, index) => {
        if (existing.exitCode !== -1) return existing;
        const failure: SingleResult = {
          ...existing,
          exitCode: signal?.aborted ? 130 : 1,
          updatedAt: now,
          stopReason: signal?.aborted ? "aborted" : "error",
          errorMessage,
          failureCategory: signal?.aborted ? "abort" : "runtime",
          stderr: existing.stderr.includes(errorMessage)
            ? existing.stderr
            : `${existing.stderr}${existing.stderr && !existing.stderr.endsWith("\n") ? "\n" : ""}${errorMessage}`,
        };
        allResults[index] = failure;
        syncDelegatedRunWithResult(runKeys[index]!, tasks[index]!.agent, tasks[index]!.summary, failure, ctx);
        return failure;
      });

      emitProgress();
      return finalized;
    };

    let results: SingleResult[];
    let unexpectedFailureMessage: string | undefined;
    try {
      results = await mapConcurrent(
        tasks,
        concurrency,
        async (t, index) => {
          const runKey = runKeys[index]!;
          upsertDelegatedRun(
            runKey,
            {
              agent: t.agent,
              summary: t.summary,
              state: "running",
              updatedAt: Date.now(),
              activity: "starting",
            },
            ctx,
          );

          try {
            const result = await runAgent({
              cwd: baseCwd,
              agents,
              agentName: t.agent,
              task: t.task,
              summary: t.summary,
              taskCwd: t.cwd,
              delegationMode: t.delegationMode,
              inheritedThinking,
              forkSessionSnapshotJsonl:
                t.delegationMode === "fork" ? forkSessionSnapshotJsonl : undefined,
              parentDepth: currentDepth,
              maxDepth,
              signal,
              onUpdate: (partial) => {
                if (partial.details?.results[0]) {
                  allResults[index] = partial.details.results[0];
                  syncDelegatedRunWithResult(runKey, t.agent, t.summary, allResults[index]!, ctx);
                  emitProgress();
                }
              },
              makeDetails: makeDetails("parallel"),
            });
            allResults[index] = result;
            syncDelegatedRunWithResult(runKey, t.agent, t.summary, result, ctx);
            emitProgress();
            return result;
          } catch (error) {
            const now = Date.now();
            const errorText = error instanceof Error ? error.message : String(error);
            const failureMessage = signal?.aborted
              ? "Task was aborted."
              : `Parallel task crashed: ${errorText}`;
            const failure: SingleResult = {
              ...allResults[index]!,
              exitCode: signal?.aborted ? 130 : 1,
              updatedAt: now,
              stopReason: signal?.aborted ? "aborted" : "error",
              errorMessage: failureMessage,
              failureCategory: signal?.aborted ? "abort" : "runtime",
              stderr: allResults[index]!.stderr.includes(failureMessage)
                ? allResults[index]!.stderr
                : `${allResults[index]!.stderr}${allResults[index]!.stderr && !allResults[index]!.stderr.endsWith("\n") ? "\n" : ""}${failureMessage}`,
            };
            allResults[index] = failure;
            syncDelegatedRunWithResult(runKey, t.agent, t.summary, failure, ctx);
            emitProgress();
            throw error;
          }
        },
      );
    } catch (error) {
      unexpectedFailureMessage = error instanceof Error ? error.message : String(error);
      results = finalizeUnexpectedParallelFailure(error);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    const successCount = results.filter((r) => !isResultError(r)).length;
    const summaries = results.map((r) => {
      const output = getFinalOutput(r.messages);
      const summaryText = isResultError(r)
        ? r.errorMessage || r.stderr || output || "(no output)"
        : output || "(no output)";
      return `[${r.agent}] ${getResultStatusLabel(r)}: ${summaryText}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: unexpectedFailureMessage
            ? `Parallel execution encountered an unexpected failure: ${unexpectedFailureMessage}\n\nParallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`
            : `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
        },
      ],
      details: makeDetails("parallel")(results),
      ...(unexpectedFailureMessage ? { isError: true } : {}),
    };
  }
}
