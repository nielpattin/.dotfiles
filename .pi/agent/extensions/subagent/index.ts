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
import {
  SUBAGENT_BACKGROUND_COMPLETION_TYPE,
  SUBAGENT_BACKGROUND_STATUS_TYPE,
  SUBAGENT_TOOL_NAME,
  TASK_FLAG_NAMES,
  TASK_RESULT_TOOL_NAME,
} from "./constants.js";
import { discoverAgents } from "./agents/discover.js";
import { renderCall, renderResult } from "./render/details.js";
import { registerAgentsCommand } from "./taskconfig/command.js";
import { registerTasksCommand } from "./tasks/command.js";
import {
  createSessionPromptToggleState,
  registerSubagentPromptCommand,
  setOrchestratorFooterStatus,
  SUBAGENT_ORCHESTRATOR_PROMPT_SECTION,
} from "./prompt/command.js";
import { TaskParams } from "./tasktool/schema.js";
import { resolveDelegationDepthConfig, resolveParallelExecutionConfig } from "./tasktool/settings.js";
import { validateTaskToolParams } from "./tasktool/validate.js";
import { executeTaskTool } from "./tasktool/execute.js";
import {
  createBackgroundCompletionInbox,
  type BackgroundCompletionEvent,
} from "./tasktool/background-completion.js";
import { buildBackgroundCompletionMessages } from "./tasktool/background-trigger-message.js";
import {
  TaskResultParams,
  normalizePollIntervalMs,
  normalizeWaitMs,
  waitForTaskDetail,
} from "./tasktool/result.js";
import {
  createDelegatedRunsWidget,
  type DelegatedRunsWidgetContext,
} from "./ui/runswidget.js";
import { createTaskStore } from "./ui/taskstore.js";
import {
  type SingleResult,
  type SubagentDetails,
  DEFAULT_DELEGATION_MODE,
  getFailureCategory,
  getFinalOutput,
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

function shortenInline(text: string, max = 140): string {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function resolveStableSessionId(ctx: { sessionManager?: { getSessionId?: () => string | undefined; getSessionFile?: () => string | undefined } }): string | undefined {
  const manager = ctx.sessionManager;
  const byId = manager?.getSessionId?.();
  if (typeof byId === "string" && byId.trim()) return byId.trim();
  const byFile = manager?.getSessionFile?.();
  if (typeof byFile === "string" && byFile.trim()) return byFile.trim();
  return undefined;
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
  const sessionPromptToggleState = createSessionPromptToggleState();
  const backgroundInbox = createBackgroundCompletionInbox();
  const deliveredCompletionKeys = new Map<string, number>();
  const completionDedupTtlMs = 10 * 60 * 1000;
  let currentSessionId: string | undefined;

  const markCompletionDelivered = (event: BackgroundCompletionEvent): boolean => {
    const now = Date.now();
    for (const [key, ts] of deliveredCompletionKeys.entries()) {
      if (now - ts > completionDedupTtlMs) deliveredCompletionKeys.delete(key);
    }

    const key = `${event.originSessionId}:${event.sessionId}:${event.finishedAt}:${event.status}`;
    if (deliveredCompletionKeys.has(key)) return false;
    deliveredCompletionKeys.set(key, now);
    return true;
  };

  const pushCompletionTurn = (event: BackgroundCompletionEvent): void => {
    if (!markCompletionDelivered(event)) return;

    const messageBundle = buildBackgroundCompletionMessages(event);

    pi.sendMessage({
      customType: SUBAGENT_BACKGROUND_STATUS_TYPE,
      content: messageBundle.visibleContent,
      display: true,
    });

    pi.sendMessage(
      {
        customType: SUBAGENT_BACKGROUND_COMPLETION_TYPE,
        content: messageBundle.controlContent,
        display: false,
      },
      { triggerTurn: true },
    );
  };

  const flushCompletionInboxForSession = (sessionId: string | undefined) => {
    if (!sessionId) return;
    const completions = backgroundInbox.drainSession(sessionId);
    for (const completion of completions) {
      if (completion.originSessionId !== sessionId) continue;
      pushCompletionTurn(completion);
    }
  };

  const enqueueBackgroundCompletion = (event: BackgroundCompletionEvent) => {
    if (!event.originSessionId) return;
    backgroundInbox.enqueue(event);
    if (currentSessionId && event.originSessionId === currentSessionId) {
      flushCompletionInboxForSession(currentSessionId);
    }
  };

  registerTasksCommand(pi, taskStore);
  registerSubagentPromptCommand(pi, sessionPromptToggleState, resolveStableSessionId);

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
    currentSessionId = resolveStableSessionId(ctx);
    setOrchestratorFooterStatus(ctx, sessionPromptToggleState.isEnabled(currentSessionId));
    hydrateTasksFromCurrentBranch(ctx);
    delegatedRunsWidget.handleSessionStart(ctx as DelegatedRunsWidgetContext);
    flushCompletionInboxForSession(currentSessionId);

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

    currentSessionId = resolveStableSessionId(ctx);
    setOrchestratorFooterStatus(ctx, sessionPromptToggleState.isEnabled(currentSessionId));
    hydrateTasksFromCurrentBranch(ctx);
    delegatedRunsWidget.handleSessionStart(ctx as DelegatedRunsWidgetContext);
    flushCompletionInboxForSession(currentSessionId);
    refreshDiscoveredAgents(ctx.cwd);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!canDelegate) return;

    const additions: string[] = [];
    const agents = ctx ? refreshDiscoveredAgents(ctx.cwd) : discoveredAgents;
    if (agents.length > 0) {
      const agentList = agents
        .map((a) => `- **${a.name}**: ${a.description}`)
        .join("\n");
      additions.push(`\n\n## Available Task Agents

The following task agents are available via the \`task\` tool:

${agentList}

### Routing policy

- Use **scout** first when scope is unclear: discovery, file finding, context gathering, impact mapping.
- Use **worker** after scope is known: implementation, code edits, and targeted validation.

### How to call the task tool

Each task runs in an **isolated process**.

Use exactly one of these public payload shapes:

\`\`\`json
{ "mode": "single", "operation": { "agent": "agent-name", "summary": "Short task summary", "task": "Detailed task...", "skill": "triage-expert", "delegationMode": "spawn", "background": false } }
\`\`\`

\`\`\`json
{ "mode": "parallel", "operations": [{ "agent": "agent-name", "summary": "Task A", "task": "...", "delegationMode": "fork", "background": true }, { "agent": "other-agent", "summary": "Task B", "task": "..." }] }
\`\`\`

Rules:
- \`mode\` must be \`single\` or \`parallel\`
- \`single\` requires \`operation\` and forbids \`operations\`
- \`parallel\` requires non-empty \`operations\` and forbids \`operation\`
- each operation requires non-empty \`agent\`, \`summary\`, \`task\`
- \`skill\` is optional and singular (string only)
- \`delegationMode\` is optional per operation and must be \`spawn\` or \`fork\` (defaults to \`spawn\`)
- \`background\` is optional per operation (\`boolean\`, defaults to \`false\`)
- payload \`skills\`, \`extension\`, and \`extensions\` are rejected

Use \`/agents\` for per-agent settings like extensions and skills, \`/tasks\` to inspect delegated task sessions, and \`task_result\` for programmatic status/result lookup by child session id.
Background completions are pushed into the originating session, trigger a follow-up turn automatically, and use a task_result-first handoff.
`);
    }

    const sessionId = resolveStableSessionId(ctx);
    const orchestratorPrefix = sessionPromptToggleState.isEnabled(sessionId)
      ? `${SUBAGENT_ORCHESTRATOR_PROMPT_SECTION}\n\n`
      : "";

    if (orchestratorPrefix === "" && additions.length === 0) return;
    return {
      systemPrompt: `${orchestratorPrefix}${event.systemPrompt}${additions.join("")}`,
    };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    currentSessionId = undefined;
    setOrchestratorFooterStatus(ctx, false);
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
        "  { mode: \"single\", operation: { agent, summary, task, cwd?, skill?, delegationMode?, background? } }",
        "  { mode: \"parallel\", operations: [{ agent, summary, task, cwd?, skill?, delegationMode?, background? }, ...] }",
        "",
        "Validation rules:",
        "  - mode is required and must be \"single\" or \"parallel\"",
        "  - single requires operation and forbids operations",
        "  - parallel requires non-empty operations and forbids operation",
        "  - each operation requires non-empty agent, summary, task",
        "  - skill is optional and singular string only",
        "  - delegationMode is optional per operation: \"spawn\" | \"fork\" (defaults to \"spawn\")",
        "  - background is optional per operation: boolean (defaults to false)",
        "  - skills / extension / extensions are rejected in payload",
        "",
        "Use /agents for per-agent defaults (skills, extensions).",
        "Use task_result for programmatic polling/retrieval by child session id.",
        "Background completions are pushed into the originating session, trigger a follow-up turn automatically, and use a task_result-first handoff.",
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

        const originatingSessionId = resolveStableSessionId(ctx);
        const taskId = toolCallId;

        return executeTaskTool({
          taskId,
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
          originatingSessionId,
          onBackgroundCompletion: enqueueBackgroundCompletion,
        });
      },

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded, isPartial }, theme) =>
        renderResult(result, expanded, isPartial, theme),
    });

    pi.registerTool({
      name: TASK_RESULT_TOOL_NAME,
      label: "Task Result",
      description: "Retrieve delegated task status/results by child session id, with optional wait/polling.",
      parameters: TaskResultParams,
      async execute(_toolCallId, params, signal, _onUpdate, _ctx): Promise<any> {
        const requestedSessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
        if (!requestedSessionId) {
          return {
            content: [{ type: "text" as const, text: "`sessionId` is required." }],
            details: { found: false, requestedSessionId: "", sessionId: "", done: false, ref: undefined, result: undefined },
            isError: true,
          };
        }

        const waitMs = normalizeWaitMs(params.waitMs);
        const pollIntervalMs = normalizePollIntervalMs(params.pollIntervalMs);
        const detail = await waitForTaskDetail(taskStore, requestedSessionId, waitMs, pollIntervalMs, signal);

        if (!detail) {
          return {
            content: [{ type: "text" as const, text: `Task not found: ${requestedSessionId}` }],
            details: { found: false, requestedSessionId, sessionId: requestedSessionId, done: false, ref: undefined, result: undefined },
            isError: true,
          };
        }

        const done = detail.ref.status !== "queued" && detail.ref.status !== "running";
        const waitNote = waitMs > 0 ? ` (waited up to ${waitMs}ms)` : "";
        const hasResult = Boolean(detail.result);
        const failure = detail.result ? getFailureCategory(detail.result) : undefined;
        const finalOutput = detail.result ? (getFinalOutput(detail.result.messages) || "").trim() : "";
        const failureOutput = detail.result ? (detail.result.errorMessage || detail.result.stderr || "").trim() : "";
        const primaryOutput = finalOutput || failureOutput;
        const outputSnippet = primaryOutput ? shortenInline(primaryOutput) : "";
        const outputSource = finalOutput ? "output" : (failureOutput ? "error" : "none");

        const handoffState = !done
          ? "running"
          : (!hasResult ? "missing" : (!primaryOutput ? "empty" : "ready"));
        const usableForReply = handoffState === "ready";

        const summaryText = done
          ? `Task ${detail.sessionId}: ${detail.ref.status}${waitNote} • ${failure ? "failed" : "completed"} • ${outputSnippet || "no output"}`
          : `Task ${detail.sessionId}: ${detail.ref.status}${waitNote} • still running. Use waitMs or check /tasks.`;

        return {
          content: [{
            type: "text" as const,
            text: summaryText,
          }],
          details: {
            found: true,
            done,
            requestedSessionId,
            sessionId: detail.sessionId,
            ref: detail.ref,
            result: detail.result,
            handoff: {
              state: handoffState,
              usableForReply,
              outputSource,
              outputSnippet,
              suggestedAction: usableForReply
                ? "reply_now"
                : "wait_or_inspect_tasks",
            },
          },
        };
      },
    });
  }
}
