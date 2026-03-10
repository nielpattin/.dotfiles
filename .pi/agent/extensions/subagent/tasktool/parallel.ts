import { SUBAGENT_UI_REFRESH_MS } from "../constants.js";
import type { AgentConfig } from "../agents/types.js";
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
}

export interface ExecuteParallelParams {
  toolCallId: string;
  tasks: TaskExecutionOperation[];
  inheritedThinking: string;
  agents: AgentConfig[];
  baseCwd: string;
  forkSessionSnapshotJsonl?: string;
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
}

function getResultStatusLabel(result: SingleResult): string {
  const failureCategory = getFailureCategory(result);
  if (failureCategory === "abort") return "aborted";
  if (failureCategory) return `${failureCategory} failed`;
  if (result.exitCode === 0) return "completed";
  return result.stopReason || "failed";
}

export async function executeParallel(params: ExecuteParallelParams) {
  const {
    toolCallId,
    tasks,
    inheritedThinking,
    agents,
    baseCwd,
    forkSessionSnapshotJsonl,
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
      details: makeDetails([...allResults]),
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
            overrideSkills: t.overrideSkills,
            overrideExtensions: t.extensions,
            delegationMode: t.delegationMode,
            forkSessionSnapshotJsonl: t.delegationMode === "fork" ? forkSessionSnapshotJsonl : undefined,
            inheritedThinking,
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
            makeDetails,
          });
          allResults[index] = result;
          syncDelegatedRunWithResult(runKey, t.agent, t.summary, result, ctx);
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
    details: makeDetails(results),
    ...(unexpectedFailureMessage ? { isError: true } : {}),
  };
}
