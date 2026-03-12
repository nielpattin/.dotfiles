import { randomUUID } from "node:crypto";
import { SUBAGENT_FALLBACK_TEXT, SUBAGENT_UI_REFRESH_MS } from "../constants.js";
import type { AgentConfig } from "../agents/types.js";
import type { SessionSnapshot } from "./snapshot.js";
import { mapConcurrent, runAgent } from "../runner.js";
import {
  type DelegationMode,
  type SingleResult,
  type SubagentDetails,
  emptyUsage,
  getFinalOutput,
  getFailureCategory,
  isResultError,
} from "../types.js";

export interface TaskExecutionOperation {
  agent: string;
  task: string;
  summary: string;
  cwd?: string;
  overrideSkills?: string[];
  extensions?: string[];
  delegationMode: DelegationMode;
  background?: boolean;
}

export interface TaskIdentity {
  sessionId: string;
  taskId?: string;
  siblingIndex?: number;
}

export interface ExecuteParallelParams {
  taskId: string;
  tasks: TaskExecutionOperation[];
  taskIdentities?: TaskIdentity[];
  inheritedThinking: string;
  agents: AgentConfig[];
  baseCwd: string;
  parentSessionFile?: string;
  forkSessionSnapshot?: SessionSnapshot;
  signal?: AbortSignal;
  onUpdate?: (partial: any) => void;
  ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } };
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
    sessionId: string,
    partial: {
      agent: string;
      summary: string;
      task: string;
      status: "queued" | "running" | "success" | "error" | "aborted";
      delegationMode?: DelegationMode;
      startedAt?: number;
      updatedAt?: number;
      finishedAt?: number;
      taskId?: string;
      siblingIndex?: number;
      provider?: string;
      model?: string;
      error?: string;
      sessionFile?: string;
    },
  ) => void;
  syncTaskWithResult: (
    sessionId: string,
    fallback: {
      agent: string;
      summary: string;
      task: string;
      delegationMode: DelegationMode;
      taskId?: string;
      siblingIndex?: number;
    },
    result: SingleResult,
  ) => void;
}

function getResultStatusLabel(result: SingleResult): string {
  const failureCategory = getFailureCategory(result);
  if (failureCategory === "abort") return "aborted";
  if (failureCategory) return `${failureCategory} failed`;
  if (result.exitCode === 0) return "completed";
  return result.stopReason || "failed";
}

function toLightweightResult(result: SingleResult): SingleResult {
  return {
    ...result,
    messages: [],
    activeTool: undefined,
  };
}

export async function executeParallel(params: ExecuteParallelParams) {
  const {
    taskId,
    tasks,
    taskIdentities: providedTaskIdentities,
    inheritedThinking,
    agents,
    baseCwd,
    parentSessionFile,
    forkSessionSnapshot,
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
  } = params;

  if (tasks.length > maxParallelTasks) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Too many parallel tasks (${tasks.length}). Max is ${maxParallelTasks}.`,
        },
      ],
      details: makeDetails([]),
    };
  }

  if (providedTaskIdentities && providedTaskIdentities.length !== tasks.length) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Internal error: task identity count does not match task count.",
        },
      ],
      details: makeDetails([]),
      isError: true,
    };
  }

  const now = Date.now();
  const taskIdentities = providedTaskIdentities ?? tasks.map((_task, index) => ({
    sessionId: randomUUID(),
    taskId: taskId,
    siblingIndex: index + 1,
  }));
  const sessionIds = taskIdentities.map((identity) => identity.sessionId);
  const runKeys = sessionIds.map((sessionId) => `${taskId}:run:${sessionId}`);

  const allResults: SingleResult[] = tasks.map((t, index) => {
    const agent = agents.find((candidate) => candidate.name === t.agent);
    const identity = taskIdentities[index]!;
    const sessionId = identity.sessionId;
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
    upsertTask(sessionId, {
      agent: t.agent,
      summary: t.summary,
      task: t.task,
      status: "queued",
      delegationMode: t.delegationMode,
      startedAt: now,
      updatedAt: now,
      taskId: identity.taskId,
      siblingIndex: identity.siblingIndex,
      provider: agent?.model?.includes("/") ? agent.model.split("/")[0] : undefined,
      model: agent?.model,
    });
    return {
      sessionId,
      taskId: identity.taskId,
      siblingIndex: identity.siblingIndex,
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
      details: makeDetails(allResults.map((result) => toLightweightResult(result))),
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
    const finalizedAt = Date.now();
    const failureText = error instanceof Error ? error.message : String(error);
    const errorMessage = signal?.aborted
      ? "Task was aborted."
      : `Parallel execution failed unexpectedly: ${failureText}`;

    const finalized = allResults.map((existing, index) => {
      if (existing.exitCode !== -1) return existing;
      const failure: SingleResult = {
        ...existing,
        exitCode: signal?.aborted ? 130 : 1,
        updatedAt: finalizedAt,
        stopReason: signal?.aborted ? "aborted" : "error",
        errorMessage,
        failureCategory: signal?.aborted ? "abort" : "runtime",
        stderr: existing.stderr.includes(errorMessage)
          ? existing.stderr
          : `${existing.stderr}${existing.stderr && !existing.stderr.endsWith("\n") ? "\n" : ""}${errorMessage}`,
      };
      allResults[index] = failure;
      syncDelegatedRunWithResult(runKeys[index]!, tasks[index]!.agent, tasks[index]!.summary, failure, ctx);
      syncTaskWithResult(sessionIds[index]!, {
        agent: tasks[index]!.agent,
        summary: tasks[index]!.summary,
        task: tasks[index]!.task,
        delegationMode: tasks[index]!.delegationMode,
        taskId: taskIdentities[index]?.taskId,
        siblingIndex: taskIdentities[index]?.siblingIndex,
      }, failure);
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
        const identity = taskIdentities[index]!;
        const sessionId = identity.sessionId;
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
        upsertTask(sessionId, {
          agent: t.agent,
          summary: t.summary,
          task: t.task,
          status: "running",
          delegationMode: t.delegationMode,
          updatedAt: Date.now(),
          taskId: identity.taskId,
          siblingIndex: identity.siblingIndex,
        });

        try {
          const result = await runAgent({
            cwd: baseCwd,
            agents,
            sessionId,
            taskId: identity.taskId,
            siblingIndex: identity.siblingIndex,
            agentName: t.agent,
            task: t.task,
            summary: t.summary,
            taskCwd: t.cwd,
            overrideSkills: t.overrideSkills,
            overrideExtensions: t.extensions,
            delegationMode: t.delegationMode,
            parentSessionFile,
            forkSessionSnapshot: t.delegationMode === "fork" ? forkSessionSnapshot : undefined,
            inheritedThinking,
            parentDepth: currentDepth,
            maxDepth,
            signal,
            onUpdate: (partial) => {
              if (partial.details?.results[0]) {
                allResults[index] = partial.details.results[0];
                if (!allResults[index]!.sessionId) allResults[index]!.sessionId = sessionId;
                if (!allResults[index]!.taskId) allResults[index]!.taskId = identity.taskId;
                if (!allResults[index]!.siblingIndex) allResults[index]!.siblingIndex = identity.siblingIndex;
                syncDelegatedRunWithResult(runKey, t.agent, t.summary, allResults[index]!, ctx);
                syncTaskWithResult(sessionId, {
                  agent: t.agent,
                  summary: t.summary,
                  task: t.task,
                  delegationMode: t.delegationMode,
                  taskId: identity.taskId,
                  siblingIndex: identity.siblingIndex,
                }, allResults[index]!);
                emitProgress();
              }
            },
            makeDetails,
          });
          allResults[index] = result;
          if (!allResults[index]!.sessionId) allResults[index]!.sessionId = sessionId;
          if (!allResults[index]!.taskId) allResults[index]!.taskId = identity.taskId;
          if (!allResults[index]!.siblingIndex) allResults[index]!.siblingIndex = identity.siblingIndex;
          syncDelegatedRunWithResult(runKey, t.agent, t.summary, result, ctx);
          syncTaskWithResult(sessionId, {
            agent: t.agent,
            summary: t.summary,
            task: t.task,
            delegationMode: t.delegationMode,
            taskId: identity.taskId,
            siblingIndex: identity.siblingIndex,
          }, result);
          emitProgress();
          return result;
        } catch (error) {
          const failedAt = Date.now();
          const errorText = error instanceof Error ? error.message : String(error);
          const failureMessage = signal?.aborted
            ? "Task was aborted."
            : `Parallel task crashed: ${errorText}`;
          const failure: SingleResult = {
            ...allResults[index]!,
            sessionId,
            taskId: identity.taskId,
            siblingIndex: identity.siblingIndex,
            exitCode: signal?.aborted ? 130 : 1,
            updatedAt: failedAt,
            stopReason: signal?.aborted ? "aborted" : "error",
            errorMessage: failureMessage,
            failureCategory: signal?.aborted ? "abort" : "runtime",
            stderr: allResults[index]!.stderr.includes(failureMessage)
              ? allResults[index]!.stderr
              : `${allResults[index]!.stderr}${allResults[index]!.stderr && !allResults[index]!.stderr.endsWith("\n") ? "\n" : ""}${failureMessage}`,
          };
          allResults[index] = failure;
          syncDelegatedRunWithResult(runKey, t.agent, t.summary, failure, ctx);
          syncTaskWithResult(sessionId, {
            agent: t.agent,
            summary: t.summary,
            task: t.task,
            delegationMode: t.delegationMode,
            taskId: identity.taskId,
            siblingIndex: identity.siblingIndex,
          }, failure);
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
      ? r.errorMessage || r.stderr || output || SUBAGENT_FALLBACK_TEXT.noOutput
      : output || SUBAGENT_FALLBACK_TEXT.noOutput;
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
    details: makeDetails(results.map((result) => toLightweightResult(result))),
    ...(unexpectedFailureMessage ? { isError: true } : {}),
  };
}
