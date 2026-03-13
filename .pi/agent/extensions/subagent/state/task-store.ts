import {
  DEFAULT_DELEGATION_MODE,
  emptyUsage,
  type DelegationMode,
  type SingleResult,
  getFailureCategory,
} from "../types.js";
import { SUBAGENT_TOOL_NAME } from "../constants.js";
import {
  listTaskMetadata,
  loadTaskResultFromSession,
  persistTaskMetadata,
  type TaskMetadataRecord,
} from "./task-files.js";

export type TaskState = "queued" | "running" | "success" | "error" | "aborted";

export interface TaskRef {
  sessionId: string;
  taskId?: string;
  siblingIndex?: number;
  agent: string;
  summary: string;
  task: string;
  status: TaskState;
  delegationMode: DelegationMode;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  provider?: string;
  model?: string;
  error?: string;
  sessionFile?: string;
}

export interface TaskDetail {
  sessionId: string;
  ref: TaskRef;
  result?: SingleResult;
}

function toTaskState(result: SingleResult): TaskState {
  if (result.exitCode === -1) return "running";
  const failure = getFailureCategory(result);
  if (failure === "abort") return "aborted";
  if (failure) return "error";
  return "success";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function isDelegationMode(value: unknown): value is DelegationMode {
  return value === "spawn" || value === "fork";
}

function normalizeSingleResult(
  raw: unknown,
  fallbackDelegationMode: DelegationMode,
  fallbackTimestamp: number,
): SingleResult | undefined {
  if (!isRecord(raw)) return undefined;

  const partial = raw as Partial<SingleResult>;
  const startedAt = toTimestamp(partial.startedAt) ?? fallbackTimestamp;
  const updatedAt = toTimestamp(partial.updatedAt) ?? startedAt;
  const usage = isRecord(partial.usage)
    ? {
        input: typeof partial.usage.input === "number" ? partial.usage.input : 0,
        output: typeof partial.usage.output === "number" ? partial.usage.output : 0,
        cacheRead: typeof partial.usage.cacheRead === "number" ? partial.usage.cacheRead : 0,
        cacheWrite: typeof partial.usage.cacheWrite === "number" ? partial.usage.cacheWrite : 0,
        cost: typeof partial.usage.cost === "number" ? partial.usage.cost : 0,
        contextTokens: typeof partial.usage.contextTokens === "number" ? partial.usage.contextTokens : 0,
        turns: typeof partial.usage.turns === "number" ? partial.usage.turns : 0,
      }
    : emptyUsage();

  return {
    sessionId: typeof partial.sessionId === "string" ? partial.sessionId : undefined,
    taskId: typeof partial.taskId === "string" ? partial.taskId : undefined,
    siblingIndex: typeof partial.siblingIndex === "number" ? partial.siblingIndex : undefined,
    agent: typeof partial.agent === "string" ? partial.agent : "unknown",
    agentSource: partial.agentSource === "user" || partial.agentSource === "project" || partial.agentSource === "unknown"
      ? partial.agentSource
      : "unknown",
    task: typeof partial.task === "string" ? partial.task : "",
    summary: typeof partial.summary === "string" ? partial.summary : "",
    delegationMode: isDelegationMode(partial.delegationMode) ? partial.delegationMode : fallbackDelegationMode,
    exitCode: typeof partial.exitCode === "number" ? partial.exitCode : 1,
    messages: Array.isArray(partial.messages) ? partial.messages : [],
    stderr: typeof partial.stderr === "string" ? partial.stderr : "",
    usage,
    startedAt,
    updatedAt,
    sessionName: typeof partial.sessionName === "string" ? partial.sessionName : undefined,
    sessionFile: typeof partial.sessionFile === "string" ? partial.sessionFile : undefined,
    skillLoad: partial.skillLoad,
    activeTool: partial.activeTool,
    lastTool: partial.lastTool,
    model: typeof partial.model === "string" ? partial.model : undefined,
    provider: typeof partial.provider === "string" ? partial.provider : undefined,
    thinking: typeof partial.thinking === "string" ? partial.thinking : undefined,
    stopReason: typeof partial.stopReason === "string" ? partial.stopReason : undefined,
    errorMessage: typeof partial.errorMessage === "string" ? partial.errorMessage : undefined,
    failureCategory:
      partial.failureCategory === "validation"
      || partial.failureCategory === "startup"
      || partial.failureCategory === "abort"
      || partial.failureCategory === "runtime"
        ? partial.failureCategory
        : undefined,
  };
}

interface HydratedTaskCandidate {
  sessionId: string;
  fallback: Pick<TaskRef, "agent" | "summary" | "task" | "delegationMode" | "taskId" | "siblingIndex">;
  result: SingleResult;
  updatedAt: number;
}

function extractHydratedTaskCandidates(branchEntries: unknown[]): HydratedTaskCandidate[] {
  const candidates: HydratedTaskCandidate[] = [];

  for (const rawEntry of branchEntries) {
    if (!isRecord(rawEntry) || rawEntry.type !== "message" || !isRecord(rawEntry.message)) continue;

    const rawMessage = rawEntry.message;
    if (rawMessage.role !== "toolResult" || rawMessage.toolName !== SUBAGENT_TOOL_NAME) continue;
    if (!isRecord(rawMessage.details) || !Array.isArray(rawMessage.details.results)) continue;

    const details = rawMessage.details as { delegationMode?: unknown; results: unknown[] };
    const fallbackDelegationMode = isDelegationMode(details.delegationMode)
      ? details.delegationMode
      : DEFAULT_DELEGATION_MODE;

    const messageTimestamp = toTimestamp(rawMessage.timestamp) ?? toTimestamp(rawEntry.timestamp) ?? Date.now();

    for (const rawResult of details.results) {
      const normalized = normalizeSingleResult(rawResult, fallbackDelegationMode, messageTimestamp);
      if (!normalized?.sessionId?.trim()) continue;

      const sessionId = normalized.sessionId.trim();
      normalized.sessionId = sessionId;

      const fallback = {
        agent: normalized.agent,
        summary: normalized.summary,
        task: normalized.task,
        delegationMode: normalized.delegationMode ?? fallbackDelegationMode,
        taskId: normalized.taskId,
        siblingIndex: normalized.siblingIndex,
      };

      candidates.push({
        sessionId,
        fallback,
        result: normalized,
        updatedAt: normalized.updatedAt,
      });
    }
  }

  return candidates;
}

function taskMetadataFromRef(ref: TaskRef): TaskMetadataRecord {
  return {
    type: "subagent_task_metadata",
    version: 3,
    sessionId: ref.sessionId,
    taskId: ref.taskId,
    siblingIndex: ref.siblingIndex,
    agent: ref.agent,
    summary: ref.summary,
    task: ref.task,
    status: ref.status,
    delegationMode: ref.delegationMode,
    startedAt: ref.startedAt,
    updatedAt: ref.updatedAt,
    finishedAt: ref.finishedAt,
    provider: ref.provider,
    model: ref.model,
    error: ref.error,
    sessionFile: ref.sessionFile,
  };
}

export function createTaskStore() {
  const refs = new Map<string, TaskRef>();
  const details = new Map<string, SingleResult>();
  let parentSessionFile: string | undefined;

  const upsertTask = (sessionId: string, partial: Partial<TaskRef> & Pick<TaskRef, "agent" | "summary" | "task" | "status">) => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) return;

    const now = Date.now();
    const existing = refs.get(normalizedSessionId);

    const next: TaskRef = {
      sessionId: normalizedSessionId,
      taskId: partial.taskId ?? existing?.taskId,
      siblingIndex: partial.siblingIndex ?? existing?.siblingIndex,
      agent: partial.agent,
      summary: partial.summary,
      task: partial.task,
      status: partial.status,
      delegationMode: partial.delegationMode ?? existing?.delegationMode ?? "spawn",
      startedAt: partial.startedAt ?? existing?.startedAt ?? now,
      updatedAt: partial.updatedAt ?? now,
      finishedAt: partial.finishedAt ?? existing?.finishedAt,
      provider: partial.provider ?? existing?.provider,
      model: partial.model ?? existing?.model,
      error: partial.error ?? existing?.error,
      sessionFile: partial.sessionFile ?? existing?.sessionFile,
    };

    if (next.status === "queued" || next.status === "running") {
      next.finishedAt = undefined;
      next.error = undefined;
    } else if (!next.finishedAt) {
      next.finishedAt = now;
    }

    refs.set(normalizedSessionId, next);
    persistTaskMetadata(parentSessionFile, taskMetadataFromRef(next));
  };

  const syncTaskWithResult = (
    fallbackSessionId: string,
    fallback: Pick<TaskRef, "agent" | "summary" | "task" | "delegationMode" | "taskId" | "siblingIndex">,
    result: SingleResult,
  ) => {
    const sessionId = (result.sessionId?.trim() || fallbackSessionId.trim());
    if (!sessionId) return;

    result.sessionId = sessionId;
    if (!result.taskId && fallback.taskId) result.taskId = fallback.taskId;
    if (!result.siblingIndex && fallback.siblingIndex) result.siblingIndex = fallback.siblingIndex;

    const status = toTaskState(result);
    const now = Date.now();

    upsertTask(sessionId, {
      agent: result.agent || fallback.agent,
      summary: result.summary || fallback.summary,
      task: result.task || fallback.task,
      status,
      delegationMode: result.delegationMode ?? fallback.delegationMode,
      startedAt: result.startedAt,
      updatedAt: result.updatedAt || now,
      finishedAt: status === "running" ? undefined : (result.updatedAt || now),
      taskId: result.taskId ?? fallback.taskId,
      siblingIndex: result.siblingIndex ?? fallback.siblingIndex,
      provider: result.provider,
      model: result.model,
      sessionFile: result.sessionFile,
      error: status === "error" || status === "aborted"
        ? result.errorMessage || result.stderr || result.stopReason || status
        : undefined,
    });

    if (result.sessionFile) {
      details.delete(sessionId);
    } else {
      details.set(sessionId, result);
    }
  };

  const hydrateFromBranch = (branchEntries: unknown[]): number => {
    clear();

    const latestBySessionId = new Map<string, HydratedTaskCandidate>();
    const mergedCandidates = [
      ...extractHydratedTaskCandidates(branchEntries),
      ...listTaskMetadata(parentSessionFile).map((metadata) => {
        const result = loadTaskResultFromSession(metadata) ?? {
          sessionId: metadata.sessionId,
          taskId: metadata.taskId,
          siblingIndex: metadata.siblingIndex,
          agent: metadata.agent,
          agentSource: "unknown" as const,
          task: metadata.task,
          summary: metadata.summary,
          delegationMode: metadata.delegationMode,
          exitCode: metadata.status === "success" ? 0 : (metadata.status === "running" || metadata.status === "queued" ? -1 : 1),
          messages: [],
          stderr: metadata.error || "",
          usage: emptyUsage(),
          startedAt: metadata.startedAt,
          updatedAt: metadata.updatedAt,
          sessionFile: metadata.sessionFile,
          model: metadata.model,
          provider: metadata.provider,
          stopReason: metadata.status === "aborted" ? "aborted" : undefined,
          errorMessage: metadata.error,
        } satisfies SingleResult;

        return {
          sessionId: metadata.sessionId,
          fallback: {
            agent: metadata.agent,
            summary: metadata.summary,
            task: metadata.task,
            delegationMode: metadata.delegationMode,
            taskId: metadata.taskId,
            siblingIndex: metadata.siblingIndex,
          },
          result,
          updatedAt: metadata.updatedAt,
        } satisfies HydratedTaskCandidate;
      }),
    ];

    for (const candidate of mergedCandidates) {
      const existing = latestBySessionId.get(candidate.sessionId);
      if (!existing || candidate.updatedAt >= existing.updatedAt) {
        latestBySessionId.set(candidate.sessionId, candidate);
      }
    }

    for (const candidate of latestBySessionId.values()) {
      const status = toTaskState(candidate.result);
      const now = Date.now();
      upsertTask(candidate.sessionId, {
        agent: candidate.result.agent || candidate.fallback.agent,
        summary: candidate.result.summary || candidate.fallback.summary,
        task: candidate.result.task || candidate.fallback.task,
        status,
        delegationMode: candidate.result.delegationMode ?? candidate.fallback.delegationMode,
        startedAt: candidate.result.startedAt,
        updatedAt: candidate.result.updatedAt || now,
        finishedAt: status === "running" ? undefined : (candidate.result.updatedAt || now),
        taskId: candidate.result.taskId ?? candidate.fallback.taskId,
        siblingIndex: candidate.result.siblingIndex ?? candidate.fallback.siblingIndex,
        provider: candidate.result.provider,
        model: candidate.result.model,
        sessionFile: candidate.result.sessionFile,
        error: status === "error" || status === "aborted"
          ? candidate.result.errorMessage || candidate.result.stderr || candidate.result.stopReason || status
          : undefined,
      });
    }

    return latestBySessionId.size;
  };

  const listTasks = (): TaskRef[] => {
    return [...refs.values()].sort((a, b) => {
      if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
      return a.sessionId.localeCompare(b.sessionId);
    });
  };

  const getTaskDetail = (sessionId: string): TaskDetail | undefined => {
    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalizedSessionId) return undefined;

    const ref = refs.get(normalizedSessionId);
    if (!ref) return undefined;

    let result = details.get(normalizedSessionId);
    if (ref.sessionFile && (!result || ref.status === "queued" || ref.status === "running")) {
      const loaded = loadTaskResultFromSession(taskMetadataFromRef(ref));
      if (loaded) {
        details.set(normalizedSessionId, loaded);
        result = loaded;
      }
    }

    return {
      sessionId: normalizedSessionId,
      ref,
      result,
    };
  };

  const setParentSessionFile = (sessionFile: string | undefined) => {
    parentSessionFile = sessionFile;
  };

  const clear = () => {
    refs.clear();
    details.clear();
  };

  return {
    setParentSessionFile,
    upsertTask,
    syncTaskWithResult,
    hydrateFromBranch,
    listTasks,
    getTaskDetail,
    clear,
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;
