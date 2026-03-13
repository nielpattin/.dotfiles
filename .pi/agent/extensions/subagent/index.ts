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
  SUBAGENT_TOOL_NAME,
  TASK_FLAG_NAMES,
  TASK_RESULT_TOOL_NAME,
} from "./constants.js";
import { discoverAgents } from "./agents/discover.js";
import { registerAgentsCommand } from "./commands/agents-command.js";
import { registerTasksCommand } from "./commands/tasks-command.js";
import {
  registerSubagentPromptCommand,
  SUBAGENT_ORCHESTRATOR_PROMPT_SECTION,
} from "./commands/orchestrator-command.js";
import { createSessionPromptToggleState } from "./state/orchestrator-prompt-state.js";
import { buildAvailableAgentsPromptSection } from "./commands/orchestrator-system-prompt.js";
import { TaskParams } from "./task-tools/schema.js";
import { resolveDelegationDepthConfig, resolveParallelExecutionConfig } from "./task-tools/settings.js";
import { validateTaskToolParams } from "./task-tools/validate.js";
import { executeTaskTool } from "./task-tools/execute.js";
import {
  buildTaskResultToolResponse,
  normalizePollIntervalMs,
  normalizeWaitMs,
  TaskResultParams,
  waitForTaskDetail,
} from "./task-tools/result.js";
import { renderCall, renderResult, renderTaskResultCall, renderTaskResultResult } from "./render/details.js";
import {
  createDelegatedRunsWidget,
} from "./ui/delegated-runs-widget.js";
import { createTaskStore } from "./state/task-store.js";
import { createTaskAbortRegistry } from "./state/task-abort-registry.js";
import { createSessionRuntime, resolveStableSessionId } from "./state/session-runtime.js";
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
  const { currentDepth, canDelegate } = depthConfig;
  const { maxParallelTasks, concurrency } = parallelConfig;

  const delegatedRunsWidget = createDelegatedRunsWidget();
  const taskStore = createTaskStore();
  const taskAbortRegistry = createTaskAbortRegistry();
  const sessionPromptToggleState = createSessionPromptToggleState();
  const sessionRuntime = createSessionRuntime({
    pi,
    canDelegate,
    taskStore,
    delegatedRunsWidget,
    sessionPromptToggleState,
  });

  const abortTaskBySessionId = (sessionId: string): boolean => {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) return false;

    const detail = taskStore.getTaskDetail(normalizedSessionId);
    if (!detail) return false;
    if (detail.ref.status !== "queued" && detail.ref.status !== "running") return false;

    const aborted = taskAbortRegistry.abort(normalizedSessionId);
    if (!aborted) return false;

    const abortedAt = Date.now();
    taskStore.upsertTask(normalizedSessionId, {
      agent: detail.ref.agent,
      summary: detail.ref.summary,
      task: detail.ref.task,
      status: "aborted",
      delegationMode: detail.ref.delegationMode,
      taskId: detail.ref.taskId,
      siblingIndex: detail.ref.siblingIndex,
      startedAt: detail.ref.startedAt,
      updatedAt: abortedAt,
      finishedAt: abortedAt,
      provider: detail.ref.provider,
      model: detail.ref.model,
      error: "Task was aborted.",
      sessionFile: detail.ref.sessionFile,
    });

    return true;
  };

  registerTasksCommand(pi, taskStore, abortTaskBySessionId);
  registerSubagentPromptCommand(pi, sessionPromptToggleState, resolveStableSessionId);
  sessionRuntime.register();

  pi.on("before_agent_start", async (event, ctx) => {
    if (!canDelegate) return;

    const agents = ctx
      ? sessionRuntime.refreshDiscoveredAgents(ctx.cwd)
      : sessionRuntime.getDiscoveredAgents();

    const sessionId = resolveStableSessionId(ctx);
    const orchestratorPrefix = sessionPromptToggleState.isEnabled(sessionId)
      ? `${SUBAGENT_ORCHESTRATOR_PROMPT_SECTION}\n\n`
      : "";
    const availableAgentsSection = buildAvailableAgentsPromptSection(agents);

    if (!orchestratorPrefix && !availableAgentsSection) return;
    return {
      systemPrompt: `${orchestratorPrefix}${event.systemPrompt}${availableAgentsSection}`,
    };
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
        "Use task_result for programmatic retrieval by child session id (default immediate lookup, no auto-poll).",
        "Background completions are pushed into the originating session, trigger one batched follow-up turn per flush, and default to a single immediate task_result lookup (waitMs: 0) with no auto-polling.",
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

        return executeTaskTool({
          taskId: toolCallId,
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
          upsertDelegatedRun: delegatedRunsWidget.upsertRun,
          syncDelegatedRunWithResult: delegatedRunsWidget.syncRunWithResult,
          upsertTask: taskStore.upsertTask,
          syncTaskWithResult: taskStore.syncTaskWithResult,
          originatingSessionId,
          onBackgroundCompletion: sessionRuntime.enqueueBackgroundCompletion,
          taskAbortRegistry,
        });
      },

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded, isPartial }, theme) =>
        renderResult(result, expanded, isPartial, theme),
    });

    pi.registerTool({
      name: TASK_RESULT_TOOL_NAME,
      label: "Task Result",
      description: "Retrieve delegated task status/results by child session id. Default is immediate lookup (waitMs: 0); avoid polling unless explicitly requested.",
      parameters: TaskResultParams,
      async execute(_toolCallId, params, signal, _onUpdate, _ctx): Promise<any> {
        const requestedSessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
        if (!requestedSessionId) {
          return {
            content: [{ type: "text" as const, text: "`sessionId` is required." }],
            details: {
              state: "missing",
              found: false,
              done: false,
              ready: false,
              usableForReply: false,
              requestedSessionId: "",
              sessionId: "",
              status: "missing",
              waitMs: 0,
              outputSource: "none",
              outputSnippet: "",
            },
            isError: true,
          };
        }

        const waitMs = normalizeWaitMs(params.waitMs);
        const pollIntervalMs = normalizePollIntervalMs(params.pollIntervalMs);
        const detail = await waitForTaskDetail(taskStore, requestedSessionId, waitMs, pollIntervalMs, signal);

        return buildTaskResultToolResponse({
          requestedSessionId,
          waitMs,
          detail,
        });
      },
      renderCall: (args, theme) => renderTaskResultCall(args, theme),
      renderResult: (result, _options, theme) => renderTaskResultResult(result, theme),
    });
  }
}
