import { describe, expect, it } from "vitest";
import { createTaskStore } from "./taskstore.js";

describe("task store public task ids", () => {
  it("assigns a stable public id and resolves details by public id", () => {
    const store = createTaskStore();
    store.upsertTask("call_abcdefghijklmnopqrstuvwxyz:3", {
      agent: "worker",
      summary: "Do work",
      task: "Complete job",
      status: "queued",
    });

    const listed = store.listTasks();
    expect(listed).toHaveLength(1);
    const task = listed[0]!;
    expect(task.publicTaskId).toMatch(/^task-3-[a-z0-9]{6}$/);

    const detailByPublicId = store.getTaskDetail(task.publicTaskId);
    expect(detailByPublicId?.taskId).toBe("call_abcdefghijklmnopqrstuvwxyz:3");
    expect(detailByPublicId?.publicTaskId).toBe(task.publicTaskId);

    expect(store.resolveTaskId(task.publicTaskId)).toBe("call_abcdefghijklmnopqrstuvwxyz:3");
    expect(store.resolveTaskId("call_abcdefghijklmnopqrstuvwxyz:3")).toBe("call_abcdefghijklmnopqrstuvwxyz:3");
  });
});
