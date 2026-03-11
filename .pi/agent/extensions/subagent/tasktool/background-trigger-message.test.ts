import { describe, expect, it } from "vitest";
import { buildBackgroundCompletionMessages } from "./background-trigger-message.js";
import { toPublicTaskId } from "./display-task-id.js";

describe("background trigger message", () => {
  it("builds machine-actionable task_result-first handoff instructions", () => {
    const taskId = "toolcall-abcdefghijklmnopqrstuvwxyz:17";
    const publicTaskId = toPublicTaskId(taskId);

    const bundle = buildBackgroundCompletionMessages({
      taskId,
      sessionId: "session-a",
      agent: "worker",
      summary: "Summarize changelog",
      status: "success",
      output: "Updated release notes with migration warning.",
      finishedAt: 1700000000000,
    });

    expect(bundle.visibleContent).toBe(`✓ Fetching ${publicTaskId}`);
    expect(bundle.controlContent).toContain("SUBAGENT_BACKGROUND_COMPLETION_CONTROL_V1");
    expect(bundle.controlContent).toContain("Call task_result now");
    expect(bundle.controlContent).toContain("Do not run any tools other than task_result");

    const payloadMatch = bundle.controlContent.match(/```json\n([\s\S]*?)\n```/);
    expect(payloadMatch?.[1]).toBeTruthy();
    const payload = JSON.parse(payloadMatch?.[1] ?? "{}");
    expect(payload.type).toBe("subagent_background_completion");
    expect(payload.task.id).toBe(taskId);
    expect(payload.task.publicId).toBe(publicTaskId);
    expect(payload.handoff.strategy).toBe("task_result_first");
    expect(payload.handoff.taskResultCall.tool).toBe("task_result");
    expect(payload.handoff.taskResultCall.args.taskId).toBe(publicTaskId);
    expect(payload.handoff.taskResultCall.args.waitMs).toBe(750);
    expect(payload.handoff.replyImmediatelyAfterTaskResult).toBe(true);
    expect(payload.inlineResultFallback.fallbackOnly).toBe(true);
    expect(payload.inlineResultFallback.output).toContain("migration warning");
  });

  it("uses provided public task id when available", () => {
    const bundle = buildBackgroundCompletionMessages({
      taskId: "task-124",
      publicTaskId: "task-124-a1b2c3",
      sessionId: "session-a",
      agent: "worker",
      summary: "No output task",
      status: "error",
      output: "(no output)",
      finishedAt: 1700000000000,
    });

    expect(bundle.visibleContent).toBe("✗ Fetching task-124-a1b2c3");

    const payloadMatch = bundle.controlContent.match(/```json\n([\s\S]*?)\n```/);
    const payload = JSON.parse(payloadMatch?.[1] ?? "{}");
    expect(payload.inlineResultFallback.outputAvailable).toBe(false);
    expect(payload.handoff.allowOtherToolsOnlyIf).toContain("task_result_empty");
    expect(payload.handoff.taskResultCall.args.taskId).toBe("task-124-a1b2c3");
  });
});
