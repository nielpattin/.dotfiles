import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBackgroundCompletionControlMessage,
  buildVisibleBackgroundCompletionLine,
  createBackgroundCompletionInbox,
} from "./background-completion.js";

const tempRoots: string[] = [];

function makeInbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-bg-inbox-"));
  tempRoots.push(root);
  return createBackgroundCompletionInbox(root);
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("background completion inbox", () => {
  it("stores events per origin session and drains only that session", () => {
    const inbox = makeInbox();

    inbox.enqueue({
      sessionId: "child-session-1",
      originSessionId: "session-a",
      agent: "worker",
      summary: "run tests",
      status: "success",
      output: "all tests passed",
      finishedAt: 100,
    });
    inbox.enqueue({
      sessionId: "child-session-2",
      originSessionId: "session-b",
      agent: "reviewer",
      summary: "review patch",
      status: "error",
      output: "lint failed",
      finishedAt: 200,
    });

    const sessionA = inbox.drainSession("session-a");
    expect(sessionA).toHaveLength(1);
    expect(sessionA[0]?.sessionId).toBe("child-session-1");

    const sessionB = inbox.drainSession("session-b");
    expect(sessionB).toHaveLength(1);
    expect(sessionB[0]?.sessionId).toBe("child-session-2");
  });

  it("ignores malformed payload files while draining", () => {
    const inbox = makeInbox();
    const sessionDir = path.join(inbox.rootDir, encodeURIComponent("session-a"));
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "broken.json"), "not-json", "utf-8");

    inbox.enqueue({
      sessionId: "child-session-1",
      originSessionId: "session-a",
      agent: "worker",
      summary: "run tests",
      status: "success",
      output: "ok",
      finishedAt: 123,
    });

    const drained = inbox.drainSession("session-a");
    expect(drained).toHaveLength(1);
    expect(drained[0]?.sessionId).toBe("child-session-1");
  });
});

describe("background completion trigger payload", () => {
  it("builds machine-actionable single-lookup handoff instructions", () => {
    const event = {
      sessionId: "toolcall-abcdefghijklmnopqrstuvwxyz:17",
      originSessionId: "session-a",
      agent: "worker",
      summary: "Summarize changelog",
      status: "success" as const,
      output: "Updated release notes with migration warning.",
      finishedAt: 1700000000000,
    };

    expect(buildVisibleBackgroundCompletionLine(event)).toBe(`✓ Fetching ${event.sessionId}`);

    const control = buildBackgroundCompletionControlMessage([event]);
    expect(control).toContain("SUBAGENT_BACKGROUND_COMPLETION_CONTROL_V1");
    expect(control).toContain("Make at most one immediate task_result lookup now");
    expect(control).toContain("Do not auto-loop or poll");

    const payloadMatch = control.match(/```json\n([\s\S]*?)\n```/);
    expect(payloadMatch?.[1]).toBeTruthy();
    const payload = JSON.parse(payloadMatch?.[1] ?? "{}");
    expect(payload.type).toBe("subagent_background_completion");
    expect(payload.primarySessionId).toBe(event.sessionId);
    expect(payload.completionCount).toBe(1);
    expect(payload.completions[0].task.sessionId).toBe(event.sessionId);
    expect(payload.handoff.strategy).toBe("task_result_single_lookup");
    expect(payload.handoff.taskResultCall.tool).toBe("task_result");
    expect(payload.handoff.taskResultCall.args.sessionId).toBe(event.sessionId);
    expect(payload.handoff.taskResultCall.args.waitMs).toBe(0);
    expect(payload.handoff.maxTaskResultCalls).toBe(1);
    expect(payload.handoff.autoPoll).toBe(false);
    expect(payload.inlineResultFallback).toBeUndefined();
    expect(payload.completions[0].inlineResultFallback.fallbackOnly).toBe(true);
    expect(payload.completions[0].inlineResultFallback.output).toContain("migration warning");
  });

  it("keeps empty output fallback semantics", () => {
    const event = {
      sessionId: "child-session-124",
      originSessionId: "session-a",
      agent: "worker",
      summary: "No output task",
      status: "error" as const,
      output: "(no output)",
      finishedAt: 1700000000000,
    };

    expect(buildVisibleBackgroundCompletionLine(event)).toBe("✗ Fetching child-session-124");

    const control = buildBackgroundCompletionControlMessage([event]);
    const payloadMatch = control.match(/```json\n([\s\S]*?)\n```/);
    const payload = JSON.parse(payloadMatch?.[1] ?? "{}");
    expect(payload.completions[0].inlineResultFallback.outputAvailable).toBe(false);
    expect(payload.handoff.allowOtherToolsOnlyIf).toContain("task_result_empty");
    expect(payload.handoff.taskResultCall.args.sessionId).toBe("child-session-124");
  });

  it("builds one control payload for batched completions", () => {
    const control = buildBackgroundCompletionControlMessage([
      {
        sessionId: "child-1",
        originSessionId: "session-a",
        agent: "worker",
        summary: "first",
        status: "success",
        output: "first output",
        finishedAt: 1000,
      },
      {
        sessionId: "child-2",
        originSessionId: "session-a",
        agent: "worker",
        summary: "second",
        status: "success",
        output: "second output",
        finishedAt: 2000,
      },
    ]);

    const payloadMatch = control.match(/```json\n([\s\S]*?)\n```/);
    const payload = JSON.parse(payloadMatch?.[1] ?? "{}");
    expect(payload.completionCount).toBe(2);
    expect(payload.completions).toHaveLength(2);
    expect(payload.primarySessionId).toBe("child-2");
    expect(payload.handoff.taskResultCall.args.sessionId).toBe("child-2");
    expect(payload.handoff.maxTaskResultCalls).toBe(1);
  });
});
