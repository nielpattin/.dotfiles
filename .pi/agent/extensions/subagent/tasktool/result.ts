import { Type } from "@sinclair/typebox";
import type { TaskDetail, TaskStore } from "../ui/taskstore.js";

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
