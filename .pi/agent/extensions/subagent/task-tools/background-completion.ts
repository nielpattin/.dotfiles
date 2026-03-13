import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type BackgroundCompletionStatus = "success" | "error" | "aborted";

export interface BackgroundCompletionEvent {
  sessionId: string;
  originSessionId: string;
  agent: string;
  summary: string;
  status: BackgroundCompletionStatus;
  output: string;
  finishedAt: number;
}

function encodeSessionId(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, "-").slice(0, 80) || "id";
}

function defaultInboxRoot(): string {
  return path.join(os.homedir(), ".pi", "agent", "state", "subagent", "background-inbox");
}

export function createBackgroundCompletionInbox(rootDir = defaultInboxRoot()) {
  const ensureRoot = () => {
    fs.mkdirSync(rootDir, { recursive: true });
  };

  const getSessionDir = (sessionId: string) => {
    ensureRoot();
    const sessionDir = path.join(rootDir, encodeSessionId(sessionId));
    fs.mkdirSync(sessionDir, { recursive: true });
    return sessionDir;
  };

  const enqueue = (event: BackgroundCompletionEvent): string => {
    const sessionDir = getSessionDir(event.originSessionId);
    const fileName = `${event.finishedAt}-${sanitizeId(event.sessionId)}-${randomUUID().slice(0, 8)}.json`;
    const filePath = path.join(sessionDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(event), "utf-8");
    return filePath;
  };

  const drainSession = (sessionId: string): BackgroundCompletionEvent[] => {
    const sessionDir = path.join(rootDir, encodeSessionId(sessionId));
    if (!fs.existsSync(sessionDir)) return [];

    const files = fs.readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const events: BackgroundCompletionEvent[] = [];
    for (const fileName of files) {
      const filePath = path.join(sessionDir, fileName);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as BackgroundCompletionEvent;
        if (
          parsed
          && typeof parsed.sessionId === "string"
          && typeof parsed.originSessionId === "string"
          && typeof parsed.agent === "string"
          && typeof parsed.summary === "string"
          && typeof parsed.status === "string"
          && typeof parsed.output === "string"
          && typeof parsed.finishedAt === "number"
        ) {
          events.push(parsed);
        }
      } catch {
        // ignore malformed payloads
      } finally {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore unlink errors
        }
      }
    }

    try {
      if (fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir);
    } catch {
      // ignore cleanup errors
    }

    return events;
  };

  return {
    rootDir,
    enqueue,
    drainSession,
  };
}

const TASK_RESULT_IMMEDIATE_WAIT_MS = 0;

function toIsoTime(epochMs: number): string {
  const safe = Number.isFinite(epochMs) ? epochMs : Date.now();
  return new Date(safe).toISOString();
}

function visibleCompletionLine(
  status: BackgroundCompletionEvent["status"],
  sessionId: string,
): string {
  const icon = status === "success" ? "✓" : (status === "aborted" ? "⚠" : "✗");
  return `${icon} Fetching ${sessionId}`;
}

function normalizeInline(text: string): string {
  const value = typeof text === "string" ? text : "";
  return value.replace(/\r\n?/g, "\n").trim();
}

function toPayloadTask(event: BackgroundCompletionEvent) {
  return {
    sessionId: event.sessionId,
    originSessionId: event.originSessionId,
    agent: event.agent,
    summary: event.summary,
    status: event.status,
    finishedAt: event.finishedAt,
    finishedAtIso: toIsoTime(event.finishedAt),
  };
}

function pickPrimaryCompletion(events: BackgroundCompletionEvent[]): BackgroundCompletionEvent {
  return [...events].sort((a, b) => b.finishedAt - a.finishedAt)[0] ?? events[0]!;
}

export function buildBackgroundCompletionControlMessage(
  events: BackgroundCompletionEvent[],
): string {
  if (events.length === 0) {
    return [
      "SUBAGENT_BACKGROUND_COMPLETION_CONTROL_V1",
      "No background completions were provided.",
    ].join("\n");
  }

  const completions = events
    .map((event) => {
      const output = normalizeInline(event.output);
      return {
        task: toPayloadTask(event),
        inlineResultFallback: {
          fallbackOnly: true,
          output,
          outputAvailable: output.length > 0 && output !== "(no output)",
        },
      };
    });

  const primaryEvent = pickPrimaryCompletion(events);

  const payload = {
    type: "subagent_background_completion",
    version: 3,
    completionCount: completions.length,
    primarySessionId: primaryEvent.sessionId,
    completions,
    handoff: {
      strategy: "task_result_single_lookup",
      taskResultCall: {
        tool: "task_result",
        args: {
          sessionId: primaryEvent.sessionId,
          waitMs: TASK_RESULT_IMMEDIATE_WAIT_MS,
        },
      },
      maxTaskResultCalls: 1,
      autoPoll: false,
      replyImmediatelyAfterTaskResult: true,
      allowPollingOnlyIfUserExplicitlyAsks: true,
      allowOtherToolsOnlyIf: ["task_result_missing", "task_result_running", "task_result_empty"],
    },
  } as const;

  return [
    "SUBAGENT_BACKGROUND_COMPLETION_CONTROL_V1",
    "One or more delegated background tasks completed.",
    "Make at most one immediate task_result lookup now using payload.handoff.taskResultCall.args (waitMs: 0).",
    "Do not auto-loop or poll. Do not call task_result again unless the user explicitly asks for polling/waiting.",
    "After the single task_result call, reply to the user immediately.",
    "Do not run other tools unless task_result reports missing/running/empty and the user requests further action.",
    "Inline snippets are fallback context only.",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

export function buildVisibleBackgroundCompletionLine(event: BackgroundCompletionEvent): string {
  return visibleCompletionLine(event.status, event.sessionId);
}
