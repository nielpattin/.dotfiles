/**
 * Pi Task Extension
 *
 * Delegates tasks to specialized task agents, each running as an isolated `pi`
 * process.
 *
 * Public tool contract modes:
 *   - single: { mode: "single", operation: { ... } }
 *   - parallel: { mode: "parallel", operations: [{ ... }] }
 */

import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "./agents/types.js";
import { SUBAGENT_TOOL_NAME, TASK_FLAG_NAMES } from "./constants.js";
import { discoverAgents } from "./agents/discover.js";
import { renderCall, renderResult } from "./render/details.js";
import { registerAgentsCommand } from "./taskconfig/command.js";
import { registerTasksCommand } from "./tasks/command.js";
import { TaskParams } from "./tasktool/schema.js";
import { resolveDelegationDepthConfig, resolveParallelExecutionConfig } from "./tasktool/settings.js";
import { validateTaskToolParams } from "./tasktool/validate.js";
import { executeTaskTool } from "./tasktool/execute.js";
import {
  createDelegatedRunsWidget,
  type DelegatedRunsWidgetContext,
} from "./ui/runswidget.js";
import { createTaskStore } from "./ui/taskstore.js";
import {
  type SingleResult,
  type SubagentDetails,
  DEFAULT_DELEGATION_MODE,
} from "./types.js";

function makeDetailsFactory(
  projectAgentsDir: string | null,
  executionMode: "single" | "parallel",
) {
  return (results: SingleResult[]): SubagentDetails => ({
    mode: executionMode,
    delegationMode: results[0]?.delegationMode ?? DEFAULT_DELEGATION_MODE,
    projectAgentsDir,
    results,
  });
}

function formatAgentNames(agents: AgentConfig[]): string {
  return agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag(TASK_FLAG_NAMES.maxDepth, {
    description: "Maximum allowed task delegation depth (default: 1).",
    type: "string",
  });
  pi.registerFlag(TASK_FLAG_NAMES.maxParallel, {
    description: "Maximum number of tasks allowed in one parallel batch (default: 8).",
    type: "string",
  });
  pi.registerFlag(TASK_FLAG_NAMES.concurrency, {
    description: "Maximum number of child agents run at once in parallel mode (default: 4).",
    type: "string",
  });

  registerAgentsCommand(pi);

  const depthConfig = resolveDelegationDepthConfig(pi);
  const parallelConfig = resolveParallelExecutionConfig(pi);
  const { currentDepth, maxDepth, canDelegate } = depthConfig;
  const { maxParallelTasks, concurrency } = parallelConfig;

  let discoveredAgents: AgentConfig[] = [];
  const delegatedRunsWidget = createDelegatedRunsWidget();
  const taskStore = createTaskStore();

  registerTasksCommand(pi, taskStore);

  function refreshDiscoveredAgents(cwd: string): AgentConfig[] {
    const discovery = discoverAgents(cwd, "both");
    discoveredAgents = discovery.agents;
    return discoveredAgents;
  }

  const hydrateTasksFromCurrentBranch = (ctx: { sessionManager?: { getBranch?: () => unknown[]; getSessionFile?: () => string | undefined } }) => {
    taskStore.setParentSessionFile(ctx.sessionManager?.getSessionFile?.());
    const branchEntries = ctx.sessionManager?.getBranch?.();
    if (Array.isArray(branchEntries)) {
      taskStore.hydrateFromBranch(branchEntries);
    } else {
      taskStore.clear();
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!canDelegate) return;

    // session_start fires on initial load, including reopening an existing session.
    hydrateTasksFromCurrentBranch(ctx);
    delegatedRunsWidget.handleSessionStart(ctx as DelegatedRunsWidgetContext);

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

  pi.on("session_switch", async (_event, ctx) => {
    if (!canDelegate) return;

    hydrateTasksFromCurrentBranch(ctx);
    delegatedRunsWidget.handleSessionStart(ctx as DelegatedRunsWidgetContext);
    refreshDiscoveredAgents(ctx.cwd);
  });

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

Use exactly one of these public payload shapes:

\`\`\`json
{ "mode": "single", "operation": { "agent": "agent-name", "summary": "Short task summary", "task": "Detailed task...", "skill": "triage-expert", "delegationMode": "spawn" } }
\`\`\`

\`\`\`json
{ "mode": "parallel", "operations": [{ "agent": "agent-name", "summary": "Task A", "task": "...", "delegationMode": "fork" }, { "agent": "other-agent", "summary": "Task B", "task": "..." }] }
\`\`\`

Rules:
- \`mode\` must be \`single\` or \`parallel\`
- \`single\` requires \`operation\` and forbids \`operations\`
- \`parallel\` requires non-empty \`operations\` and forbids \`operation\`
- each operation requires non-empty \`agent\`, \`summary\`, \`task\`
- \`skill\` is optional and singular (string only)
- \`delegationMode\` is optional per operation and must be \`spawn\` or \`fork\` (defaults to \`spawn\`)
- payload \`skills\`, \`extension\`, and \`extensions\` are rejected

Use \`/agents\` for per-agent defaults like extensions and default skills, and \`/tasks\` to inspect delegated task sessions.
`,
    };
  });

  pi.on("session_shutdown", async () => {
    taskStore.clear();
    delegatedRunsWidget.handleSessionShutdown();
  });

  if (canDelegate) {
    pi.registerTool({
      name: SUBAGENT_TOOL_NAME,
      label: "Task",
      description: [
        "Delegate work to specialized task agents running in isolated pi processes.",
        "",
        "Public contract:",
        "  { mode: \"single\", operation: { agent, summary, task, cwd?, skill?, delegationMode? } }",
        "  { mode: \"parallel\", operations: [{ agent, summary, task, cwd?, skill?, delegationMode? }, ...] }",
        "",
        "Validation rules:",
        "  - mode is required and must be \"single\" or \"parallel\"",
        "  - single requires operation and forbids operations",
        "  - parallel requires non-empty operations and forbids operation",
        "  - each operation requires non-empty agent, summary, task",
        "  - skill is optional and singular string only",
        "  - delegationMode is optional per operation: \"spawn\" | \"fork\" (defaults to \"spawn\")",
        "  - skills / extension / extensions are rejected in payload",
        "",
        "Use /agents for per-agent defaults (skills, extensions).",
      ].join("\n"),
      parameters: TaskParams,

      async execute(toolCallId, params, signal, onUpdate, ctx) {
        taskStore.setParentSessionFile(ctx.sessionManager?.getSessionFile?.());
        const discovery = discoverAgents(ctx.cwd, "both");
        const { agents } = discovery;
        const validated = validateTaskToolParams(params);
        const makeDetails = makeDetailsFactory(
          discovery.projectAgentsDir,
          validated.ok ? validated.value.mode : "parallel",
        );

        if (!validated.ok) {
          return {
            content: [{ type: "text" as const, text: `${validated.message}\nAvailable agents: ${formatAgentNames(agents)}` }],
            details: makeDetails([]),
            isError: true,
          };
        }

        return executeTaskTool({
          toolCallId,
          operations: validated.value.operations,
          agents,
          projectAgentsDir: discovery.projectAgentsDir,
          baseCwd: ctx.cwd,
          inheritedThinking: pi.getThinkingLevel(),
          signal,
          onUpdate,
          ctx: ctx as any,
          makeDetails,
          maxParallelTasks,
          concurrency,
          currentDepth,
          maxDepth,
          upsertDelegatedRun: delegatedRunsWidget.upsertRun,
          syncDelegatedRunWithResult: delegatedRunsWidget.syncRunWithResult,
          upsertTask: taskStore.upsertTask,
          syncTaskWithResult: taskStore.syncTaskWithResult,
        });
      },

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded, isPartial }, theme) =>
        renderResult(result, expanded, isPartial, theme),
    });
  }
}
