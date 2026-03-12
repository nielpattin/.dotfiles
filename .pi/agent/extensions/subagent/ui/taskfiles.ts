import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { emptyUsage, type DelegationMode, type FailureCategory, type SingleResult } from "../types.js";

const TASK_METADATA_RECORD_TYPE = "subagent_task_metadata";

export interface TaskMetadataRecord {
  type: typeof TASK_METADATA_RECORD_TYPE;
  version: 3;
  sessionId: string;
  taskId?: string;
  siblingIndex?: number;
  agent: string;
  summary: string;
  task: string;
  status: "queued" | "running" | "success" | "error" | "aborted";
  delegationMode: DelegationMode;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  provider?: string;
  model?: string;
  error?: string;
  sessionFile?: string;
}

function toSessionStem(sessionFile: string): string {
  const base = path.basename(sessionFile);
  return base.toLowerCase().endsWith(".jsonl")
    ? base.slice(0, -".jsonl".length)
    : base;
}

function encodeSessionId(sessionId: string): string {
  return encodeURIComponent(sessionId);
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

function toTaskExitCode(status: TaskMetadataRecord["status"]): number {
  if (status === "queued" || status === "running") return -1;
  if (status === "success") return 0;
  if (status === "aborted") return 130;
  return 1;
}

function toFailureCategory(status: TaskMetadataRecord["status"]): FailureCategory | undefined {
  if (status === "aborted") return "abort";
  if (status === "error") return "runtime";
  return undefined;
}

export function deriveTaskDirectory(sessionFile: string): string {
  const sessionDir = path.dirname(sessionFile);
  return path.join(sessionDir, toSessionStem(sessionFile));
}

export function deriveTaskSessionPath(sessionFile: string, sessionId: string): string {
  return path.join(deriveTaskDirectory(sessionFile), `${encodeSessionId(sessionId)}.session.jsonl`);
}

export function deriveTaskMetadataPath(sessionFile: string, sessionId: string): string {
  return path.join(deriveTaskDirectory(sessionFile), `${encodeSessionId(sessionId)}.task.json`);
}

export function persistTaskMetadata(
  parentSessionFile: string | undefined,
  metadata: TaskMetadataRecord,
): string | undefined {
  if (!parentSessionFile) return undefined;

  const metadataPath = deriveTaskMetadataPath(parentSessionFile, metadata.sessionId);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  return metadataPath;
}

export function loadTaskMetadata(metadataFile: string): TaskMetadataRecord | undefined {
  if (!metadataFile || !fs.existsSync(metadataFile)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(metadataFile, "utf-8"));
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  if (parsed.type !== TASK_METADATA_RECORD_TYPE || parsed.version !== 3) return undefined;

  const status = parsed.status;
  const delegationMode = parsed.delegationMode;
  if (
    typeof parsed.sessionId !== "string"
    || typeof parsed.agent !== "string"
    || typeof parsed.summary !== "string"
    || typeof parsed.task !== "string"
    || (status !== "queued" && status !== "running" && status !== "success" && status !== "error" && status !== "aborted")
    || (delegationMode !== "spawn" && delegationMode !== "fork")
  ) {
    return undefined;
  }

  return {
    type: TASK_METADATA_RECORD_TYPE,
    version: 3,
    sessionId: parsed.sessionId,
    taskId:
      typeof parsed.taskId === "string"
        ? parsed.taskId
        : (typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined),
    siblingIndex: typeof parsed.siblingIndex === "number" ? parsed.siblingIndex : undefined,
    agent: parsed.agent,
    summary: parsed.summary,
    task: parsed.task,
    status,
    delegationMode,
    startedAt: toTimestamp(parsed.startedAt) ?? Date.now(),
    updatedAt: toTimestamp(parsed.updatedAt) ?? Date.now(),
    finishedAt: toTimestamp(parsed.finishedAt),
    provider: typeof parsed.provider === "string" ? parsed.provider : undefined,
    model: typeof parsed.model === "string" ? parsed.model : undefined,
    error: typeof parsed.error === "string" ? parsed.error : undefined,
    sessionFile: typeof parsed.sessionFile === "string" ? parsed.sessionFile : undefined,
  };
}

export function listTaskMetadata(parentSessionFile: string | undefined): TaskMetadataRecord[] {
  if (!parentSessionFile) return [];

  const taskDir = deriveTaskDirectory(parentSessionFile);
  if (!fs.existsSync(taskDir)) return [];

  const metadata: TaskMetadataRecord[] = [];
  const entries = fs.readdirSync(taskDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".task.json")) continue;
    const loaded = loadTaskMetadata(path.join(taskDir, entry.name));
    if (loaded) metadata.push(loaded);
  }

  return metadata;
}

export function loadTaskResultFromSession(metadata: TaskMetadataRecord): SingleResult | undefined {
  const sessionFile = metadata.sessionFile;
  if (!sessionFile || !fs.existsSync(sessionFile)) return undefined;

  let raw = "";
  try {
    raw = fs.readFileSync(sessionFile, "utf-8");
  } catch {
    return undefined;
  }

  const messages: Message[] = [];
  const usage = emptyUsage();
  let model = metadata.model;
  let provider = metadata.provider;
  let startedAt = metadata.startedAt;
  let updatedAt = metadata.updatedAt;
  let stopReason: string | undefined;
  let errorMessage = metadata.error;
  let sessionName: string | undefined;

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) continue;

    const ts = toTimestamp(parsed.timestamp);
    if (ts) {
      updatedAt = Math.max(updatedAt, ts);
      if (startedAt <= 0) startedAt = ts;
    }

    if (parsed.type === "session_info") {
      if (typeof parsed.name === "string" && parsed.name.trim()) sessionName = parsed.name.trim();
      continue;
    }

    if (parsed.type === "model_change") {
      if (typeof parsed.modelId === "string" && !model) model = parsed.modelId;
      if (typeof parsed.provider === "string" && !provider) provider = parsed.provider;
      continue;
    }

    if (parsed.type !== "message" || !isRecord(parsed.message)) continue;

    const message = parsed.message as unknown as Message;
    messages.push(message);

    if (message.role !== "assistant") continue;

    usage.turns += 1;
    const assistantUsage = message.usage;
    if (assistantUsage) {
      usage.input += assistantUsage.input || 0;
      usage.output += assistantUsage.output || 0;
      usage.cacheRead += assistantUsage.cacheRead || 0;
      usage.cacheWrite += assistantUsage.cacheWrite || 0;
      usage.cost += assistantUsage.cost?.total || 0;
      usage.contextTokens = assistantUsage.totalTokens || usage.contextTokens;
    }

    if (!model && message.model) model = message.model;
    if (!provider && typeof (message as any).provider === "string") provider = (message as any).provider;
    if (message.stopReason) stopReason = message.stopReason;
    if (message.errorMessage) errorMessage = message.errorMessage;
  }

  const failureCategory = toFailureCategory(metadata.status);
  const result: SingleResult = {
    sessionId: metadata.sessionId,
    taskId: metadata.taskId,
    siblingIndex: metadata.siblingIndex,
    agent: metadata.agent,
    agentSource: "unknown",
    task: metadata.task,
    summary: metadata.summary,
    delegationMode: metadata.delegationMode,
    exitCode: toTaskExitCode(metadata.status),
    messages,
    stderr: metadata.error || "",
    usage,
    startedAt,
    updatedAt,
    sessionName,
    model,
    provider,
    stopReason: metadata.status === "aborted" ? "aborted" : (failureCategory ? "error" : stopReason),
    errorMessage,
    failureCategory,
    sessionFile,
  };

  return result;
}
