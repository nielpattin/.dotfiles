import { describe, expect, it } from "vitest";
import type { TaskDetail } from "../state/task-store.js";
import { buildBackgroundQueueToolText } from "./execute.js";
import { buildTaskResultToolResponse } from "./result.js";

describe("buildBackgroundQueueToolText", () => {
  it("returns concise session-id queue text", () => {
    const text = buildBackgroundQueueToolText([
      { sessionId: "child-session-1", task: { agent: "worker" } },
      { sessionId: "child-session-2", task: { agent: "reviewer" } },
    ]);

    expect(text).toBe("Background task session ids: child-session-1 (worker), child-session-2 (reviewer)");
    expect(text).not.toContain("I’ll post results when they finish");
  });
});

function makeDetail(partial: Partial<TaskDetail>): TaskDetail {
  return {
    sessionId: partial.sessionId ?? "child-session-1",
    ref: {
      sessionId: "child-session-1",
      agent: "worker",
      summary: "summary",
      task: "task",
      status: "success",
      delegationMode: "spawn",
      startedAt: 1,
      updatedAt: 2,
      ...(partial.ref ?? {}),
    },
    result: partial.result,
  };
}

describe("buildTaskResultToolResponse", () => {
  it("returns lightweight running state without heavy payload", () => {
    const response = buildTaskResultToolResponse({
      requestedSessionId: "child-session-1",
      waitMs: 0,
      detail: makeDetail({ ref: { status: "running" } as any }),
    });

    expect(response.details.state).toBe("running");
    expect(response.details.ready).toBe(false);
    expect(response.details).not.toHaveProperty("ref");
    expect(response.details).not.toHaveProperty("result");
    expect(response.content[0]?.text).toContain("still running");
  });

  it("returns lightweight missing state when task is not found", () => {
    const response = buildTaskResultToolResponse({
      requestedSessionId: "missing-session",
      waitMs: 0,
      detail: undefined,
    });

    expect(response.details.state).toBe("missing");
    expect(response.details.found).toBe(false);
    expect(response.details).not.toHaveProperty("ref");
    expect(response.details).not.toHaveProperty("result");
  });

  it("includes heavy payload only when state is ready", () => {
    const response = buildTaskResultToolResponse({
      requestedSessionId: "child-session-1",
      waitMs: 0,
      detail: makeDetail({
        result: {
          sessionId: "child-session-1",
          agent: "worker",
          agentSource: "user",
          task: "task",
          summary: "summary",
          delegationMode: "spawn",
          exitCode: 0,
          messages: [{ role: "assistant", content: [{ type: "text", text: "done output" }] } as any],
          stderr: "",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
          startedAt: 1,
          updatedAt: 2,
        },
      }),
    });

    expect(response.details.state).toBe("ready");
    expect(response.details.ready).toBe(true);
    expect(response.details).toHaveProperty("ref");
    expect(response.details).toHaveProperty("result");
    expect(response.details.outputSnippet).toContain("done output");
  });

  it("returns aborted status and failure category", () => {
    const response = buildTaskResultToolResponse({
      requestedSessionId: "child-session-1",
      waitMs: 0,
      detail: makeDetail({
        ref: { status: "aborted" } as any,
        result: {
          sessionId: "child-session-1",
          agent: "worker",
          agentSource: "user",
          task: "task",
          summary: "summary",
          delegationMode: "spawn",
          exitCode: 130,
          messages: [],
          stderr: "Task was aborted.",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
          startedAt: 1,
          updatedAt: 2,
          stopReason: "aborted",
          errorMessage: "Task was aborted.",
          failureCategory: "abort",
        },
      }),
    });

    expect(response.details.status).toBe("aborted");
    expect(response.details.failureCategory).toBe("abort");
  });
});
