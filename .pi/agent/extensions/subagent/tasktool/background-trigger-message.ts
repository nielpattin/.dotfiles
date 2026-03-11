import type { BackgroundCompletionEvent } from "./background-completion.js";
import { toPublicTaskId } from "./display-task-id.js";

const TASK_RESULT_RACE_WAIT_MS = 750;

function toIsoTime(epochMs: number): string {
  const safe = Number.isFinite(epochMs) ? epochMs : Date.now();
  return new Date(safe).toISOString();
}

function resolvePublicTaskId(event: Pick<BackgroundCompletionEvent, "taskId" | "publicTaskId">): string {
  const publicTaskId = typeof event.publicTaskId === "string" ? event.publicTaskId.trim() : "";
  if (publicTaskId) return publicTaskId;
  return toPublicTaskId(event.taskId);
}

function visibleCompletionLine(
  status: BackgroundCompletionEvent["status"],
  publicTaskId: string,
): string {
  const icon = status === "success" ? "✓" : (status === "aborted" ? "⚠" : "✗");
  return `${icon} Fetching ${publicTaskId}`;
}

function normalizeInline(text: string): string {
  const value = typeof text === "string" ? text : "";
  return value.replace(/\r\n?/g, "\n").trim();
}

export interface BackgroundCompletionMessageBundle {
  visibleContent: string;
  controlContent: string;
}

/**
 * Builds two complementary messages for background completion handling:
 * - visibleContent: concise UX line shown in transcript
 * - controlContent: hidden, machine-actionable instruction payload that triggers the model turn
 */
export function buildBackgroundCompletionMessages(
  event: BackgroundCompletionEvent,
): BackgroundCompletionMessageBundle {
  const output = normalizeInline(event.output);
  const outputAvailable = output.length > 0 && output !== "(no output)";
  const publicTaskId = resolvePublicTaskId(event);

  const payload = {
    type: "subagent_background_completion",
    version: 2,
    task: {
      id: event.taskId,
      publicId: publicTaskId,
      sessionId: event.sessionId,
      agent: event.agent,
      summary: event.summary,
      status: event.status,
      finishedAt: event.finishedAt,
      finishedAtIso: toIsoTime(event.finishedAt),
    },
    handoff: {
      strategy: "task_result_first",
      taskResultCall: {
        tool: "task_result",
        args: {
          taskId: publicTaskId,
          waitMs: TASK_RESULT_RACE_WAIT_MS,
        },
      },
      replyImmediatelyAfterTaskResult: true,
      allowOtherToolsOnlyIf: ["task_result_missing", "task_result_running", "task_result_empty"],
    },
    inlineResultFallback: {
      fallbackOnly: true,
      output,
      outputAvailable,
    },
  } as const;

  return {
    visibleContent: visibleCompletionLine(event.status, publicTaskId),
    controlContent: [
      "SUBAGENT_BACKGROUND_COMPLETION_CONTROL_V1",
      "A delegated background task has completed.",
      "Call task_result now using payload.handoff.taskResultCall.args.",
      "After task_result returns, reply to the user immediately.",
      "Do not run any tools other than task_result unless task_result reports missing/running/empty.",
      "The inline snippet is fallback context only.",
      "```json",
      JSON.stringify(payload, null, 2),
      "```",
    ].join("\n"),
  };
}
