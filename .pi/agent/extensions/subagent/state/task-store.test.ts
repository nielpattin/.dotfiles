import { describe, expect, it } from "vitest";
import { createTaskStore } from "./task-store.js";

describe("task store session identity", () => {
  it("stores and resolves tasks by canonical child session id", () => {
    const store = createTaskStore();
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";

    store.upsertTask(sessionId, {
      agent: "worker",
      summary: "Do work",
      task: "Complete job",
      status: "queued",
      taskId: "task-1",
      siblingIndex: 3,
    });

    const listed = store.listTasks();
    expect(listed).toHaveLength(1);
    const task = listed[0]!;
    expect(task.sessionId).toBe(sessionId);
    expect(task.taskId).toBe("task-1");

    const detail = store.getTaskDetail(sessionId);
    expect(detail?.sessionId).toBe(sessionId);
    expect(detail?.ref.sessionId).toBe(sessionId);
  });

  it("hydrates canonical taskId from tool results", () => {
    const store = createTaskStore();
    const sessionId = "session-with-task-id";

    const hydrated = store.hydrateFromBranch([
      {
        type: "message",
        timestamp: Date.now(),
        message: {
          role: "toolResult",
          toolName: "task",
          details: {
            delegationMode: "spawn",
            results: [
              {
                sessionId,
                taskId: "task-call-1",
                siblingIndex: 1,
                agent: "worker",
                agentSource: "unknown",
                task: "Hydrated task",
                summary: "Hydrated summary",
                delegationMode: "spawn",
                exitCode: 0,
                messages: [],
                stderr: "",
                usage: {},
                startedAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          },
        },
      },
    ]);

    expect(hydrated).toBe(1);
    const detail = store.getTaskDetail(sessionId);
    expect(detail?.ref.taskId).toBe("task-call-1");
  });

  it("stores aborted result as aborted status", () => {
    const store = createTaskStore();
    const sessionId = "aborted-session";

    store.syncTaskWithResult(
      sessionId,
      {
        agent: "worker",
        summary: "Abort me",
        task: "Stop",
        delegationMode: "spawn",
      },
      {
        sessionId,
        agent: "worker",
        agentSource: "user",
        task: "Stop",
        summary: "Abort me",
        delegationMode: "spawn",
        exitCode: 130,
        messages: [],
        stderr: "Task was aborted.",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        startedAt: Date.now() - 1000,
        updatedAt: Date.now(),
        stopReason: "aborted",
        errorMessage: "Task was aborted.",
        failureCategory: "abort",
      },
    );

    const detail = store.getTaskDetail(sessionId);
    expect(detail?.ref.status).toBe("aborted");
    expect(detail?.ref.error).toContain("aborted");
  });
});
