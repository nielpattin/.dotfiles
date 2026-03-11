import type { AgentConfig } from "../agents/types.js";
import {
  DEFAULT_DELEGATION_MODE,
  type DelegationMode,
  type SingleResult,
  type SubagentDetails,
  getFailureCategory,
  getFinalOutput,
} from "../types.js";
import { executeParallel, type TaskExecutionOperation } from "./parallel.js";
import { buildForkSessionSnapshotJsonl, type SessionSnapshotSource } from "./snapshot.js";
import { type PublicOperation } from "./schema.js";
import { type BackgroundCompletionEvent } from "./background-completion.js";
import { toPublicTaskId } from "./display-task-id.js";

function getRequestedProjectAgents(
  agents: AgentConfig[],
  requestedNames: Set<string>,
): AgentConfig[] {
  return Array.from(requestedNames)
    .map((name) => agents.find((a) => a.name === name))
    .filter((a): a is AgentConfig => a?.source === "project");
}

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

function mapOperationsWithAgentDefaults(
  operations: PublicOperation[],
  agents: AgentConfig[],
): TaskExecutionOperation[] {
  return operations.map((operation) => {
    const agentConfig = agents.find((candidate) => candidate.name === operation.agent);
    const overrideSkills = operation.skill ? [operation.skill] : agentConfig?.skills;
    return {
      agent: operation.agent,
      task: operation.task,
      summary: operation.summary,
      cwd: operation.cwd ?? agentConfig?.cwd,
      overrideSkills,
      extensions: agentConfig?.extensions,
      delegationMode: operation.delegationMode ?? DEFAULT_DELEGATION_MODE,
      background: operation.background === true,
    };
  });
}

const BACKGROUND_COMPLETION_OUTPUT_MAX = 1600;

function shortenInline(text: string, max = 120): string {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function toResultStatus(result: SingleResult): "success" | "error" | "aborted" {
  const failure = getFailureCategory(result);
  if (failure === "abort") return "aborted";
  if (failure) return "error";
  return "success";
}

function toBackgroundCompletionEvent(
  originatingSessionId: string,
  fallback: { taskId: string; publicTaskId: string; agent: string; summary: string },
  result: SingleResult,
): BackgroundCompletionEvent {
  const status = toResultStatus(result);
  const output = shortenInline(
    getFinalOutput(result.messages)
    || result.errorMessage
    || result.stderr
    || result.stopReason
    || "(no output)",
    BACKGROUND_COMPLETION_OUTPUT_MAX,
  );

  return {
    taskId: result.taskId?.trim() || fallback.taskId,
    publicTaskId: result.publicTaskId?.trim() || fallback.publicTaskId,
    sessionId: originatingSessionId,
    agent: result.agent || fallback.agent,
    summary: result.summary || fallback.summary,
    status,
    output,
    finishedAt: result.updatedAt || Date.now(),
  };
}

function appendBackgroundTrackingDetails(
  details: SubagentDetails,
  backgroundTasks: Array<{ taskId: string; publicTaskId: string; agent: string; summary: string }>,
): SubagentDetails {
  return {
    ...details,
    backgroundTasks: backgroundTasks.map((task) => ({
      taskId: task.publicTaskId,
      internalTaskId: task.taskId,
      agent: task.agent,
      summary: task.summary,
      status: "queued" as const,
    })),
    backgroundTrackingHint: "Use task_result with the public task id (optionally waitMs) or /tasks to inspect progress/completion.",
  };
}

export function buildBackgroundQueueToolText(
  backgroundTasks: Array<{ publicTaskId: string; task: { agent: string } }>,
): string {
  const queued = backgroundTasks
    .map((entry) => `${entry.publicTaskId} (${entry.task.agent})`)
    .join(", ");
  return `Background task ids: ${queued}`;
}

export interface ExecuteTaskToolParams {
  toolCallId: string;
  operations: PublicOperation[];
  agents: AgentConfig[];
  projectAgentsDir: string | null;
  baseCwd: string;
  inheritedThinking: string;
  signal?: AbortSignal;
  onUpdate?: (partial: any) => void;
  ctx: {
    hasUI: boolean;
    ui: {
      confirm: (title: string, body: string) => Promise<boolean>;
      notify?: (message: string, level?: "info" | "warning" | "error") => void;
      setWidget?: (...args: any[]) => void;
    };
    sessionManager?: SessionSnapshotSource;
  };
  makeDetails: (results: SingleResult[]) => SubagentDetails;
  maxParallelTasks: number;
  concurrency: number;
  currentDepth: number;
  maxDepth: number;
  upsertDelegatedRun: (
    key: string,
    partial: {
      agent: string;
      summary: string;
      state: "queued" | "running" | "success" | "error" | "aborted";
      startedAt?: number;
      updatedAt?: number;
      finishedAt?: number;
      activity?: string;
      error?: string;
    },
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
  ) => void;
  syncDelegatedRunWithResult: (
    key: string,
    fallbackAgent: string,
    fallbackSummary: string,
    result: SingleResult,
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
  ) => void;
  upsertTask: (
    taskId: string,
    partial: {
      agent: string;
      summary: string;
      task: string;
      status: "queued" | "running" | "success" | "error" | "aborted";
      delegationMode?: DelegationMode;
      startedAt?: number;
      updatedAt?: number;
      finishedAt?: number;
      sessionId?: string;
      provider?: string;
      model?: string;
      error?: string;
    },
  ) => void;
  syncTaskWithResult: (
    taskId: string,
    fallback: {
      agent: string;
      summary: string;
      task: string;
      delegationMode: DelegationMode;
    },
    result: SingleResult,
  ) => void;
  originatingSessionId?: string;
  onBackgroundCompletion?: (completion: BackgroundCompletionEvent) => void;
}

export async function executeTaskTool(params: ExecuteTaskToolParams) {
  const {
    toolCallId,
    operations,
    agents,
    projectAgentsDir,
    baseCwd,
    inheritedThinking,
    signal,
    onUpdate,
    ctx,
    makeDetails,
    maxParallelTasks,
    concurrency,
    currentDepth,
    maxDepth,
    upsertDelegatedRun,
    syncDelegatedRunWithResult,
    upsertTask,
    syncTaskWithResult,
    originatingSessionId,
    onBackgroundCompletion,
  } = params;

  const tasks = mapOperationsWithAgentDefaults(operations, agents);
  if (tasks.length > maxParallelTasks) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Too many parallel tasks (${tasks.length}). Max is ${maxParallelTasks}.`,
        },
      ],
      details: makeDetails([]),
      isError: true,
    };
  }

  const requested = new Set<string>();
  for (const operation of tasks) requested.add(operation.agent);

  const requestedProjectAgents = getRequestedProjectAgents(agents, requested);
  if (requestedProjectAgents.length > 0) {
    if (ctx.hasUI) {
      const approved = await confirmProjectAgentsIfNeeded(
        requestedProjectAgents,
        projectAgentsDir,
        ctx,
      );
      if (!approved) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Canceled: project-local agents not approved.",
            },
          ],
          details: makeDetails([]),
        };
      }
    } else {
      const names = requestedProjectAgents.map((a) => a.name).join(", ");
      const dir = projectAgentsDir ?? "(unknown)";
      return {
        content: [
          {
            type: "text" as const,
            text: `Blocked: project-local agent confirmation is required in non-UI mode.\nAgents: ${names}\nSource: ${dir}`,
          },
        ],
        details: makeDetails([]),
        isError: true,
      };
    }
  }

  const forkSessionSnapshotJsonl = tasks.some((operation) => operation.delegationMode === "fork")
    ? buildForkSessionSnapshotJsonl(ctx.sessionManager)
    : undefined;

  const indexedTasks = tasks.map((task, index) => {
    const taskId = `${toolCallId}:${index + 1}`;
    return {
      task,
      taskId,
      publicTaskId: toPublicTaskId(taskId),
    };
  });
  const foreground = indexedTasks.filter((entry) => !entry.task.background);
  const background = indexedTasks.filter((entry) => entry.task.background);

  const runBatch = (batch: typeof indexedTasks, options: { signal?: AbortSignal; onUpdate?: (partial: any) => void }) => {
    return executeParallel({
      toolCallId,
      tasks: batch.map((entry) => entry.task),
      taskIds: batch.map((entry) => entry.taskId),
      inheritedThinking,
      agents,
      baseCwd,
      forkSessionSnapshotJsonl,
      signal: options.signal,
      onUpdate: options.onUpdate,
      ctx,
      makeDetails,
      maxParallelTasks,
      concurrency,
      currentDepth,
      maxDepth,
      upsertDelegatedRun,
      syncDelegatedRunWithResult,
      upsertTask,
      syncTaskWithResult,
    });
  };

  const backgroundTaskRefs = background.map((entry) => ({
    taskId: entry.taskId,
    publicTaskId: entry.publicTaskId,
    agent: entry.task.agent,
    summary: entry.task.summary,
  }));
  const backgroundByTaskId = new Map(backgroundTaskRefs.map((entry) => [entry.taskId, entry]));

  if (background.length > 0) {
    void runBatch(background, {})
      .then((result) => {
        const details = result.details as SubagentDetails | undefined;
        if (!details?.results?.length) return;

        if (!originatingSessionId || typeof onBackgroundCompletion !== "function") return;

        for (const single of details.results) {
          const taskId = single.taskId?.trim();
          const fallback = taskId ? backgroundByTaskId.get(taskId) : undefined;
          if (!fallback) continue;
          onBackgroundCompletion(
            toBackgroundCompletionEvent(originatingSessionId, fallback, single),
          );
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const finishedAt = Date.now();
        for (const entry of background) {
          upsertTask(entry.taskId, {
            agent: entry.task.agent,
            summary: entry.task.summary,
            task: entry.task.task,
            status: "error",
            delegationMode: entry.task.delegationMode,
            updatedAt: finishedAt,
            error: `Background execution failed: ${message}`,
          });

          if (originatingSessionId && typeof onBackgroundCompletion === "function") {
            onBackgroundCompletion({
              taskId: entry.taskId,
              publicTaskId: entry.publicTaskId,
              sessionId: originatingSessionId,
              agent: entry.task.agent,
              summary: entry.task.summary,
              status: "error",
              output: shortenInline(`Background execution failed: ${message}`, BACKGROUND_COMPLETION_OUTPUT_MAX),
              finishedAt,
            });
          }
        }
        if (ctx.hasUI && typeof ctx.ui.notify === "function") {
          ctx.ui.notify(`Background task execution failed: ${message}`, "error");
        }
      });
  }

  if (foreground.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: buildBackgroundQueueToolText(background),
        },
      ],
      details: appendBackgroundTrackingDetails(makeDetails([]), backgroundTaskRefs),
    };
  }

  const foregroundResult = await runBatch(foreground, { signal, onUpdate });
  if (background.length === 0) return foregroundResult;

  foregroundResult.details = appendBackgroundTrackingDetails(
    (foregroundResult.details as SubagentDetails | undefined) ?? makeDetails([]),
    backgroundTaskRefs,
  );

  return foregroundResult;
}
