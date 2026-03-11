import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_DELEGATION_MODE,
  emptyUsage,
  type DelegationMode,
  type SingleResult,
  getFailureCategory,
} from "../types.js";
import { SUBAGENT_TOOL_NAME } from "../constants.js";
import { toPublicTaskId } from "../tasktool/display-task-id.js";
import { deriveTaskDirectory, loadTaskFile, persistTaskFile } from "./taskfiles.js";

export type TaskState = "queued" | "running" | "success" | "error" | "aborted";

export interface TaskRef {
  taskId: string;
  publicTaskId: string;
  agent: string;
  summary: string;
  task: string;
  status: TaskState;
  delegationMode: DelegationMode;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  sessionId?: string;
  provider?: string;
  model?: string;
  error?: string;
  taskFile?: string;
}

export interface TaskDetail {
  taskId: string;
  publicTaskId: string;
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
    taskId: typeof partial.taskId === "string" ? partial.taskId : undefined,
    publicTaskId: typeof partial.publicTaskId === "string" ? partial.publicTaskId : undefined,
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
    sessionId: typeof partial.sessionId === "string" ? partial.sessionId : undefined,
    sessionName: typeof partial.sessionName === "string" ? partial.sessionName : undefined,
    taskFile: typeof partial.taskFile === "string" ? partial.taskFile : undefined,
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
  taskId: string;
  fallback: Pick<TaskRef, "agent" | "summary" | "task" | "delegationMode">;
  result: SingleResult;
  updatedAt: number;
  hydrateDetail: boolean;
}

function extractHydratedTaskCandidates(branchEntries: unknown[]): HydratedTaskCandidate[] {
  const candidates: HydratedTaskCandidate[] = [];

  for (const [entryIndex, rawEntry] of branchEntries.entries()) {
    if (!isRecord(rawEntry) || rawEntry.type !== "message" || !isRecord(rawEntry.message)) continue;

    const rawMessage = rawEntry.message;
    if (rawMessage.role !== "toolResult" || rawMessage.toolName !== SUBAGENT_TOOL_NAME) continue;

    if (!isRecord(rawMessage.details) || !Array.isArray(rawMessage.details.results)) continue;

    const details = rawMessage.details as { delegationMode?: unknown; results: unknown[] };
    const fallbackDelegationMode = isDelegationMode(details.delegationMode)
      ? details.delegationMode
      : DEFAULT_DELEGATION_MODE;

    const messageTimestamp =
      toTimestamp(rawMessage.timestamp)
      ?? toTimestamp(rawEntry.timestamp)
      ?? Date.now();

    const toolCallId = typeof rawMessage.toolCallId === "string" ? rawMessage.toolCallId : undefined;

    for (const [resultIndex, rawResult] of details.results.entries()) {
      const normalized = normalizeSingleResult(rawResult, fallbackDelegationMode, messageTimestamp);
      if (!normalized) continue;

      const generatedTaskId = toolCallId
        ? `${toolCallId}:${resultIndex + 1}`
        : `hydrated:${entryIndex + 1}:${resultIndex + 1}`;
      const taskId = normalized.taskId?.trim() || generatedTaskId;
      normalized.taskId = taskId;

      const fallback = {
        agent: normalized.agent,
        summary: normalized.summary,
        task: normalized.task,
        delegationMode: normalized.delegationMode ?? fallbackDelegationMode,
      };

      candidates.push({
        taskId,
        fallback,
        result: normalized,
        updatedAt: normalized.updatedAt,
        hydrateDetail: !normalized.taskFile,
      });
    }
  }

  return candidates;
}

function extractHydratedTaskFileCandidates(sessionFile: string | undefined): HydratedTaskCandidate[] {
  if (!sessionFile) return [];

  const taskDir = deriveTaskDirectory(sessionFile);
  if (!fs.existsSync(taskDir)) return [];

  const candidates: HydratedTaskCandidate[] = [];
  const entries = fs.readdirSync(taskDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;

    const taskFile = path.join(taskDir, entry.name);
    const loaded = loadTaskFile(taskFile);
    if (!loaded) continue;

    let decodedTaskId = entry.name.slice(0, -".jsonl".length);
    try {
      decodedTaskId = decodeURIComponent(decodedTaskId);
    } catch {
      // keep encoded id fallback
    }
    const taskId = loaded.taskId?.trim() || decodedTaskId;
    loaded.taskId = taskId;
    loaded.taskFile = loaded.taskFile || taskFile;

    const fallbackDelegationMode = loaded.delegationMode ?? DEFAULT_DELEGATION_MODE;
    const fallback = {
      agent: loaded.agent || "unknown",
      summary: loaded.summary || "",
      task: loaded.task || "",
      delegationMode: fallbackDelegationMode,
    };

    candidates.push({
      taskId,
      fallback,
      result: loaded,
      updatedAt: loaded.updatedAt || loaded.startedAt || Date.now(),
      hydrateDetail: true,
    });
  }

  return candidates;
}

export function createTaskStore() {
  const refs = new Map<string, TaskRef>();
  const details = new Map<string, SingleResult>();
  const publicToInternalTaskId = new Map<string, string>();
  const internalToPublicTaskId = new Map<string, string>();
  let parentSessionFile: string | undefined;

  const ensurePublicTaskId = (taskId: string): string => {
    const existing = internalToPublicTaskId.get(taskId);
    if (existing) return existing;

    const base = toPublicTaskId(taskId);
    let next = base;
    let collisionIndex = 2;
    while (true) {
      const occupiedBy = publicToInternalTaskId.get(next);
      if (!occupiedBy || occupiedBy === taskId) break;
      next = `${base}-${collisionIndex}`;
      collisionIndex += 1;
    }

    internalToPublicTaskId.set(taskId, next);
    publicToInternalTaskId.set(next, taskId);
    return next;
  };

  const resolveTaskId = (taskRef: string): string | undefined => {
    const normalized = typeof taskRef === "string" ? taskRef.trim() : "";
    if (!normalized) return undefined;
    if (refs.has(normalized)) return normalized;
    return publicToInternalTaskId.get(normalized);
  };

  const getPublicTaskId = (taskRef: string): string | undefined => {
    const taskId = resolveTaskId(taskRef);
    if (!taskId) return undefined;
    return ensurePublicTaskId(taskId);
  };

  const upsertTask = (taskId: string, partial: Partial<TaskRef> & Pick<TaskRef, "agent" | "summary" | "task" | "status">) => {
    const now = Date.now();
    const existing = refs.get(taskId);
    const publicTaskId = existing?.publicTaskId ?? ensurePublicTaskId(taskId);
    const next: TaskRef = {
      taskId,
      publicTaskId,
      agent: partial.agent,
      summary: partial.summary,
      task: partial.task,
      status: partial.status,
      delegationMode: partial.delegationMode ?? existing?.delegationMode ?? "spawn",
      startedAt: partial.startedAt ?? existing?.startedAt ?? now,
      updatedAt: partial.updatedAt ?? now,
      finishedAt: partial.finishedAt ?? existing?.finishedAt,
      sessionId: partial.sessionId ?? existing?.sessionId,
      provider: partial.provider ?? existing?.provider,
      model: partial.model ?? existing?.model,
      error: partial.error ?? existing?.error,
      taskFile: partial.taskFile ?? existing?.taskFile,
    };

    if (next.status === "queued" || next.status === "running") {
      next.finishedAt = undefined;
      next.error = undefined;
    } else if (!next.finishedAt) {
      next.finishedAt = now;
    }

    refs.set(taskId, next);
  };

  const syncTaskWithResult = (
    taskId: string,
    fallback: Pick<TaskRef, "agent" | "summary" | "task" | "delegationMode">,
    result: SingleResult,
  ) => {
    const status = toTaskState(result);
    const now = Date.now();
    const publicTaskId = ensurePublicTaskId(taskId);
    result.publicTaskId = result.publicTaskId || publicTaskId;
    const taskFile = persistTaskFile(parentSessionFile, taskId, result) ?? result.taskFile;
    if (taskFile) result.taskFile = taskFile;
    details.set(taskId, result);

    upsertTask(taskId, {
      agent: result.agent || fallback.agent,
      summary: result.summary || fallback.summary,
      task: result.task || fallback.task,
      status,
      delegationMode: result.delegationMode ?? fallback.delegationMode,
      startedAt: result.startedAt,
      updatedAt: result.updatedAt || now,
      finishedAt: status === "running" ? undefined : (result.updatedAt || now),
      sessionId: result.sessionId,
      provider: result.provider,
      model: result.model,
      taskFile,
      error: status === "error" || status === "aborted"
        ? result.errorMessage || result.stderr || result.stopReason || status
        : undefined,
    });
  };

  const hydrateFromBranch = (branchEntries: unknown[]): number => {
    clear();

    const latestByTaskId = new Map<string, HydratedTaskCandidate>();
    const mergedCandidates = [
      ...extractHydratedTaskCandidates(branchEntries),
      ...extractHydratedTaskFileCandidates(parentSessionFile),
    ];

    for (const candidate of mergedCandidates) {
      const existing = latestByTaskId.get(candidate.taskId);
      if (!existing || candidate.updatedAt >= existing.updatedAt) {
        latestByTaskId.set(candidate.taskId, candidate);
      }
    }

    for (const candidate of latestByTaskId.values()) {
      const status = toTaskState(candidate.result);
      const now = Date.now();
      const publicTaskId = ensurePublicTaskId(candidate.taskId);
      candidate.result.publicTaskId = candidate.result.publicTaskId || publicTaskId;

      upsertTask(candidate.taskId, {
        agent: candidate.result.agent || candidate.fallback.agent,
        summary: candidate.result.summary || candidate.fallback.summary,
        task: candidate.result.task || candidate.fallback.task,
        status,
        delegationMode: candidate.result.delegationMode ?? candidate.fallback.delegationMode,
        startedAt: candidate.result.startedAt,
        updatedAt: candidate.result.updatedAt || now,
        finishedAt: status === "running" ? undefined : (candidate.result.updatedAt || now),
        sessionId: candidate.result.sessionId,
        provider: candidate.result.provider,
        model: candidate.result.model,
        taskFile: candidate.result.taskFile,
        error: status === "error" || status === "aborted"
          ? candidate.result.errorMessage || candidate.result.stderr || candidate.result.stopReason || status
          : undefined,
      });
      if (candidate.hydrateDetail) {
        details.set(candidate.taskId, candidate.result);
      }
    }

    return latestByTaskId.size;
  };

  const listTasks = (): TaskRef[] => {
    return [...refs.values()].sort((a, b) => {
      if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
      return a.taskId.localeCompare(b.taskId);
    });
  };

  const getTaskDetail = (taskRef: string): TaskDetail | undefined => {
    const taskId = resolveTaskId(taskRef);
    if (!taskId) return undefined;

    const ref = refs.get(taskId);
    if (!ref) return undefined;

    let result = details.get(taskId);
    if (!result && ref.taskFile) {
      const loaded = loadTaskFile(ref.taskFile);
      if (loaded) {
        loaded.taskId = loaded.taskId || taskId;
        loaded.publicTaskId = loaded.publicTaskId || ref.publicTaskId;
        loaded.taskFile = loaded.taskFile || ref.taskFile;
        details.set(taskId, loaded);
        result = loaded;
      }
    }

    if (result && !result.publicTaskId) {
      result.publicTaskId = ref.publicTaskId;
    }

    return {
      taskId,
      publicTaskId: ref.publicTaskId,
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
    publicToInternalTaskId.clear();
    internalToPublicTaskId.clear();
  };

  return {
    setParentSessionFile,
    upsertTask,
    syncTaskWithResult,
    hydrateFromBranch,
    listTasks,
    getTaskDetail,
    getPublicTaskId,
    resolveTaskId,
    clear,
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;
