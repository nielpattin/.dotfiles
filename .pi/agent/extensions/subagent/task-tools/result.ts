import { Type } from "@sinclair/typebox";
import { getFailureCategory, getFinalOutput } from "../types.js";
import type { TaskDetail, TaskStore } from "../state/task-store.js";

const DEFAULT_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 120_000;

export const TaskResultParams = Type.Object({
  sessionId: Type.String({
    minLength: 1,
    pattern: "\\S",
    description: "Delegated child session id to fetch.",
  }),
  waitMs: Type.Optional(
    Type.Number({
      minimum: 0,
      description: `Optional max wait in milliseconds for completion (default: 0, max: ${MAX_WAIT_MS}).`,
    }),
  ),
  pollIntervalMs: Type.Optional(
    Type.Number({
      minimum: 25,
      description: "Optional polling interval while waiting (default: 250ms).",
    }),
  ),
});

function isDone(detail: TaskDetail): boolean {
  return detail.ref.status !== "queued" && detail.ref.status !== "running";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForTaskDetail(
  store: TaskStore,
  sessionId: string,
  waitMs: number,
  pollIntervalMs: number,
  signal?: AbortSignal,
): Promise<TaskDetail | undefined> {
  const startedAt = Date.now();
  let detail = store.getTaskDetail(sessionId);

  while (
    !signal?.aborted
    && waitMs > 0
    && (!detail || !isDone(detail))
    && (Date.now() - startedAt) < waitMs
  ) {
    await delay(Math.min(pollIntervalMs, waitMs), signal);
    detail = store.getTaskDetail(sessionId);
  }

  return detail;
}

export function normalizeWaitMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_WAIT_MS, Math.floor(value)));
}

export function normalizePollIntervalMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  const normalized = Math.floor(value);
  return Math.max(25, Math.min(MAX_POLL_INTERVAL_MS, normalized));
}

export type TaskResultState = "running" | "missing" | "empty" | "ready";

export interface TaskResultToolResponse {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

function shortenInline(text: string, max = 140): string {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function waitNote(waitMs: number): string {
  return waitMs > 0 ? ` (waited up to ${waitMs}ms)` : "";
}

interface BuildTaskResultToolResponseInput {
  requestedSessionId: string;
  waitMs: number;
  detail?: TaskDetail;
}

export function buildTaskResultToolResponse(
  input: BuildTaskResultToolResponseInput,
): TaskResultToolResponse {
  const { requestedSessionId, waitMs, detail } = input;

  if (!detail) {
    return {
      content: [{ type: "text", text: `Task ${requestedSessionId}: not found${waitNote(waitMs)}.` }],
      details: {
        state: "missing" satisfies TaskResultState,
        found: false,
        done: false,
        ready: false,
        usableForReply: false,
        requestedSessionId,
        sessionId: requestedSessionId,
        status: "missing",
        waitMs,
        outputSource: "none",
        outputSnippet: "",
        suggestedAction: "inspect_tasks_or_confirm_session_id",
      },
    };
  }

  const done = isDone(detail);
  const hasResult = Boolean(detail.result);
  const failure = detail.result ? getFailureCategory(detail.result) : undefined;
  const finalOutput = detail.result ? (getFinalOutput(detail.result.messages) || "").trim() : "";
  const failureOutput = detail.result ? (detail.result.errorMessage || detail.result.stderr || "").trim() : "";
  const primaryOutput = finalOutput || failureOutput;
  const outputSnippet = primaryOutput ? shortenInline(primaryOutput) : "";
  const outputSource = finalOutput ? "output" : (failureOutput ? "error" : "none");

  const state: TaskResultState = !done
    ? "running"
    : (!hasResult ? "missing" : (!primaryOutput ? "empty" : "ready"));

  const baseDetails = {
    state,
    found: true,
    done,
    ready: state === "ready",
    usableForReply: state === "ready",
    requestedSessionId,
    sessionId: detail.sessionId,
    status: detail.ref.status,
    waitMs,
    outputSource,
    outputSnippet,
    failureCategory: failure,
    suggestedAction: state === "ready"
      ? "reply_now"
      : (state === "running" ? "reply_briefly_without_polling" : "inspect_tasks_or_retry_once"),
  } as const;

  if (state === "running") {
    return {
      content: [{
        type: "text",
        text: `Task ${detail.sessionId}: still running${waitNote(waitMs)}.`,
      }],
      details: baseDetails,
    };
  }

  if (state === "missing") {
    return {
      content: [{
        type: "text",
        text: `Task ${detail.sessionId}: completed${waitNote(waitMs)} but result payload is missing.`,
      }],
      details: baseDetails,
    };
  }

  if (state === "empty") {
    return {
      content: [{
        type: "text",
        text: `Task ${detail.sessionId}: completed${waitNote(waitMs)} with no output.`,
      }],
      details: baseDetails,
    };
  }

  return {
    content: [{
      type: "text",
      text: `Task ${detail.sessionId}: completed${waitNote(waitMs)} • ${outputSnippet}`,
    }],
    details: {
      ...baseDetails,
      ref: detail.ref,
      result: detail.result,
    },
  };
}
