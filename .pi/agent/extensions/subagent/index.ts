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
import { discoverAgents } from "./agents/discover.js";
import { renderCall, renderResult } from "./render/details.js";
import { registerTaskConfigCommand } from "./taskconfig/command.js";
import { TaskParams } from "./tasktool/schema.js";
import { resolveDelegationDepthConfig, resolveParallelExecutionConfig } from "./tasktool/settings.js";
import { validateTaskToolParams } from "./tasktool/validate.js";
import { executeTaskTool } from "./tasktool/execute.js";
import {
  createDelegatedRunsWidget,
  type DelegatedRunsWidgetContext,
} from "./ui/runswidget.js";
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

  registerTaskConfigCommand(pi);

  const depthConfig = resolveDelegationDepthConfig(pi);
  const parallelConfig = resolveParallelExecutionConfig(pi);
  const { currentDepth, maxDepth, canDelegate } = depthConfig;
  const { maxParallelTasks, concurrency } = parallelConfig;

  let discoveredAgents: AgentConfig[] = [];
  const delegatedRunsWidget = createDelegatedRunsWidget();

  function refreshDiscoveredAgents(cwd: string): AgentConfig[] {
    const discovery = discoverAgents(cwd, "both");
    discoveredAgents = discovery.agents;
    return discoveredAgents;
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!canDelegate) return;

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

Use \`/task-config\` for per-agent defaults like extensions and default skills.
`,
    };
  });

  pi.on("session_shutdown", async () => {
    delegatedRunsWidget.handleSessionShutdown();
  });

  if (canDelegate) {
    pi.registerTool({
      name: "task",
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
        "Use /task-config for per-agent defaults (skills, extensions).",
      ].join("\n"),
      parameters: TaskParams,

      async execute(toolCallId, params, signal, onUpdate, ctx) {
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
        });
      },

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded, isPartial }, theme) =>
        renderResult(result, expanded, isPartial, theme),
    });
  }
}
