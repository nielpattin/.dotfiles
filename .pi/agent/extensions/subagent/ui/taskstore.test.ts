import { describe, expect, it } from "vitest";
import { createTaskStore } from "./taskstore.js";

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

  it("hydrates legacy toolCallId results as taskId", () => {
    const store = createTaskStore();
    const sessionId = "legacy-session";

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
                toolCallId: "legacy-call-1",
                siblingIndex: 1,
                agent: "worker",
                agentSource: "unknown",
                task: "Legacy task",
                summary: "Legacy summary",
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
    expect(detail?.ref.taskId).toBe("legacy-call-1");
  });
});
