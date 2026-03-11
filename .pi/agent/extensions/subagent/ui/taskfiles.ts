import * as fs from "node:fs";
import * as path from "node:path";
import { getFailureCategory, type SingleResult } from "../types.js";

const TASK_FILE_RECORD_TYPE = "subagent_task_detail";
const TASK_FILE_EVENT_TYPE = "subagent_task_event";

type TaskEventName =
  | "task_start"
  | "task_update"
  | "task_result"
  | "task_error"
  | "task_activity"
  | "task_message"
  | "task_tool"
  | "task_usage";

interface TaskFileRecord {
  type: typeof TASK_FILE_RECORD_TYPE;
  version: 1;
  taskId: string;
  updatedAt: number;
  result: SingleResult;
}

interface TaskFileEventRecord {
  type: typeof TASK_FILE_EVENT_TYPE;
  version: 1;
  taskId: string;
  event: TaskEventName;
  at: number;
  result: SingleResult;
}

function toSessionStem(sessionFile: string): string {
  const base = path.basename(sessionFile);
  return base.toLowerCase().endsWith(".jsonl")
    ? base.slice(0, -".jsonl".length)
    : base;
}

function encodeTaskId(taskId: string): string {
  return encodeURIComponent(taskId);
}

export function deriveTaskDirectory(sessionFile: string): string {
  const sessionDir = path.dirname(sessionFile);
  return path.join(sessionDir, toSessionStem(sessionFile));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasUsageChanged(current: SingleResult, previous: SingleResult): boolean {
  return current.usage.input !== previous.usage.input
    || current.usage.output !== previous.usage.output
    || current.usage.cacheRead !== previous.usage.cacheRead
    || current.usage.cacheWrite !== previous.usage.cacheWrite
    || current.usage.cost !== previous.usage.cost
    || current.usage.contextTokens !== previous.usage.contextTokens
    || current.usage.turns !== previous.usage.turns;
}

function hasToolChanged(current: SingleResult, previous: SingleResult): boolean {
  return JSON.stringify(current.activeTool) !== JSON.stringify(previous.activeTool)
    || JSON.stringify(current.lastTool) !== JSON.stringify(previous.lastTool);
}

function classifyEvent(current: SingleResult, previous?: SingleResult): TaskEventName {
  if (!previous) return "task_start";

  if (current.exitCode !== -1) {
    return getFailureCategory(current) ? "task_error" : "task_result";
  }

  if (current.messages.length !== previous.messages.length) return "task_message";
  if (hasToolChanged(current, previous)) return "task_tool";
  if (hasUsageChanged(current, previous)) return "task_usage";
  if (current.stderr !== previous.stderr || current.stopReason !== previous.stopReason) return "task_activity";
  return "task_update";
}

function parseResultRecord(line: string): SingleResult | undefined {
  if (!line) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!isObject(parsed)) return undefined;

  if (parsed.type === TASK_FILE_EVENT_TYPE && isObject(parsed.result)) {
    return parsed.result as unknown as SingleResult;
  }

  if (parsed.type === TASK_FILE_RECORD_TYPE && isObject(parsed.result)) {
    return parsed.result as unknown as SingleResult;
  }

  if (typeof parsed.agent === "string" && typeof parsed.summary === "string" && typeof parsed.task === "string") {
    return parsed as unknown as SingleResult;
  }

  return undefined;
}

export function deriveTaskFilePath(sessionFile: string, taskId: string): string {
  return path.join(deriveTaskDirectory(sessionFile), `${encodeTaskId(taskId)}.jsonl`);
}

export function persistTaskFile(sessionFile: string | undefined, taskId: string, result: SingleResult): string | undefined {
  if (!sessionFile) return undefined;

  const taskFile = deriveTaskFilePath(sessionFile, taskId);
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });

  const previous = loadTaskFile(taskFile);
  const record: TaskFileEventRecord = {
    type: TASK_FILE_EVENT_TYPE,
    version: 1,
    taskId,
    event: classifyEvent(result, previous),
    at: result.updatedAt,
    result,
  };

  fs.appendFileSync(taskFile, `${JSON.stringify(record)}\n`, "utf-8");
  return taskFile;
}

export function loadTaskFile(taskFile: string): SingleResult | undefined {
  if (!taskFile || !fs.existsSync(taskFile)) return undefined;

  const raw = fs.readFileSync(taskFile, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;

  for (let i = lines.length - 1; i >= 0; i--) {
    const result = parseResultRecord(lines[i]!);
    if (result) return result;
  }

  return undefined;
}
