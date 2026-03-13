import { describe, expect, it, vi } from "vitest";
import { TasksPanel } from "./panel.js";
import type { TaskDetail, TaskRef } from "../state/task-store.js";

function createTheme() {
  return {
    fg: (_name: string, text: string) => text,
    bold: (text: string) => text,
  } as any;
}

function makeTask(partial: Partial<TaskRef> = {}): TaskRef {
  return {
    sessionId: partial.sessionId ?? "session-1",
    taskId: partial.taskId,
    siblingIndex: partial.siblingIndex,
    agent: partial.agent ?? "worker",
    summary: partial.summary ?? "summary",
    task: partial.task ?? "task",
    status: partial.status ?? "running",
    delegationMode: partial.delegationMode ?? "spawn",
    startedAt: partial.startedAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    finishedAt: partial.finishedAt,
    provider: partial.provider,
    model: partial.model,
    error: partial.error,
    sessionFile: partial.sessionFile,
  };
}

describe("tasks panel", () => {
  it("aborts selected task on dd chord", () => {
    const task = makeTask();
    const store = {
      listTasks: () => [task],
      getTaskDetail: (_sessionId: string): TaskDetail | undefined => ({ sessionId: task.sessionId, ref: task, result: undefined }),
    } as any;

    const abortTaskBySessionId = vi.fn(() => true);
    const panel = new TasksPanel(
      { requestRender: vi.fn() } as any,
      createTheme(),
      store,
      abortTaskBySessionId,
      vi.fn(),
    );

    panel.handleInput("d");
    expect(abortTaskBySessionId).not.toHaveBeenCalled();

    panel.handleInput("d");
    expect(abortTaskBySessionId).toHaveBeenCalledWith("session-1");
  });

  it("shows dd hint in list footer", () => {
    const task = makeTask();
    const store = {
      listTasks: () => [task],
      getTaskDetail: () => ({ sessionId: task.sessionId, ref: task }),
    } as any;

    const panel = new TasksPanel(
      { requestRender: vi.fn() } as any,
      createTheme(),
      store,
      vi.fn(() => true),
      vi.fn(),
    );

    const rendered = panel.render(120).join("\n");
    expect(rendered).toContain("DD");
    expect(rendered).toContain("abort task");
  });
});
