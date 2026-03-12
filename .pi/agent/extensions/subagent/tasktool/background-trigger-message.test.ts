import { describe, expect, it } from "vitest";
import { buildBackgroundCompletionMessages } from "./background-trigger-message.js";

describe("background trigger message", () => {
  it("builds machine-actionable task_result-first handoff instructions", () => {
    const sessionId = "toolcall-abcdefghijklmnopqrstuvwxyz:17";

    const bundle = buildBackgroundCompletionMessages({
      sessionId,
      originSessionId: "session-a",
      agent: "worker",
      summary: "Summarize changelog",
      status: "success",
      output: "Updated release notes with migration warning.",
      finishedAt: 1700000000000,
    });

    expect(bundle.visibleContent).toBe(`✓ Fetching ${sessionId}`);
    expect(bundle.controlContent).toContain("SUBAGENT_BACKGROUND_COMPLETION_CONTROL_V1");
    expect(bundle.controlContent).toContain("Call task_result now");
    expect(bundle.controlContent).toContain("Do not run any tools other than task_result");

    const payloadMatch = bundle.controlContent.match(/```json\n([\s\S]*?)\n```/);
    expect(payloadMatch?.[1]).toBeTruthy();
    const payload = JSON.parse(payloadMatch?.[1] ?? "{}");
    expect(payload.type).toBe("subagent_background_completion");
    expect(payload.task.sessionId).toBe(sessionId);
    expect(payload.task.originSessionId).toBe("session-a");
    expect(payload.handoff.strategy).toBe("task_result_first");
    expect(payload.handoff.taskResultCall.tool).toBe("task_result");
    expect(payload.handoff.taskResultCall.args.sessionId).toBe(sessionId);
    expect(payload.handoff.taskResultCall.args.waitMs).toBe(750);
    expect(payload.handoff.replyImmediatelyAfterTaskResult).toBe(true);
    expect(payload.inlineResultFallback.fallbackOnly).toBe(true);
    expect(payload.inlineResultFallback.output).toContain("migration warning");
  });

  it("keeps empty output fallback semantics", () => {
    const bundle = buildBackgroundCompletionMessages({
      sessionId: "child-session-124",
      originSessionId: "session-a",
      agent: "worker",
      summary: "No output task",
      status: "error",
      output: "(no output)",
      finishedAt: 1700000000000,
    });

    expect(bundle.visibleContent).toBe("✗ Fetching child-session-124");

    const payloadMatch = bundle.controlContent.match(/```json\n([\s\S]*?)\n```/);
    const payload = JSON.parse(payloadMatch?.[1] ?? "{}");
    expect(payload.inlineResultFallback.outputAvailable).toBe(false);
    expect(payload.handoff.allowOtherToolsOnlyIf).toContain("task_result_empty");
    expect(payload.handoff.taskResultCall.args.sessionId).toBe("child-session-124");
  });
});
