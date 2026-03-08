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

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const DEFAULT_MAX_DELEGATION_DEPTH = 1;
const TASK_DEPTH_ENV = "PI_TASK_DEPTH";
const TASK_MAX_DEPTH_ENV = "PI_TASK_MAX_DEPTH";

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

function getMaxDepthFlagFromArgv(argv: string[]): string | null {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--task-max-depth") {
      return argv[i + 1] ?? "";
    }
    if (arg.startsWith("--task-max-depth=")) {
      return arg.slice("--task-max-depth=".length);
    }
  }
  return null;
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

  const argvFlagRaw = getMaxDepthFlagFromArgv(process.argv);
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

  const depthConfig = resolveDelegationDepthConfig(pi);
  const { currentDepth, maxDepth, canDelegate } = depthConfig;

  let discoveredAgents: AgentConfig[] = [];

  function refreshDiscoveredAgents(cwd: string): AgentConfig[] {
    const discovery = discoverAgents(cwd, "both");
    discoveredAgents = discovery.agents;
    return discoveredAgents;
  }

  // Auto-discover agents on session start
  pi.on("session_start", async (_event, ctx) => {
    if (!canDelegate) return;

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

      async execute(_toolCallId, params, signal, onUpdate, ctx) {
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
            parallelTasks!,
            inheritedThinking,
            forkSessionSnapshotJsonl,
            agents,
            ctx.cwd,
            signal,
            onUpdate,
            makeDetails,
          );
        }

        // ── Single mode ──
        return executeSingle(
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

    const handleChildUpdate = onUpdate
      ? (partial: any) => {
          const streamed = partial?.details?.results?.[0];
          if (streamed) latestResult = streamed as SingleResult;
          onUpdate(partial);
        }
      : undefined;

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
        return finalResult;
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
    makeDetails: ReturnType<typeof makeDetailsFactory>,
  ) {
    if (tasks.length > MAX_PARALLEL_TASKS) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
          },
        ],
        details: makeDetails("parallel")([]),
      };
    }

    // Initialize placeholder results for streaming
    const now = Date.now();
    const allResults: SingleResult[] = tasks.map((t) => {
      const agent = agents.find((candidate) => candidate.name === t.agent);
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

    let results: SingleResult[];
    try {
      results = await mapConcurrent(
        tasks,
        MAX_CONCURRENCY,
        async (t, index) => {
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
                emitProgress();
              }
            },
            makeDetails: makeDetails("parallel"),
          });
          allResults[index] = result;
          emitProgress();
          return result;
        },
      );
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
          text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
        },
      ],
      details: makeDetails("parallel")(results),
    };
  }
}
