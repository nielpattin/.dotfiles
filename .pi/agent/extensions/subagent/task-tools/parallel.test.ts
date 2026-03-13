import { describe, expect, it, vi } from "vitest";
import { createTaskAbortRegistry } from "../state/task-abort-registry.js";
import { emptyUsage, type SingleResult } from "../types.js";

vi.mock("../runner/index.js", () => ({
  runAgent: vi.fn(),
}));

import { runAgent } from "../runner/index.js";
import { executeParallel } from "./parallel.js";

const runAgentMock = runAgent as unknown as ReturnType<typeof vi.fn>;

function makeResult(partial: Partial<SingleResult>): SingleResult {
  const now = Date.now();
  return {
    sessionId: partial.sessionId,
    taskId: partial.taskId,
    siblingIndex: partial.siblingIndex,
    agent: partial.agent ?? "worker",
    agentSource: partial.agentSource ?? "user",
    task: partial.task ?? "task",
    summary: partial.summary ?? "summary",
    delegationMode: partial.delegationMode ?? "spawn",
    exitCode: partial.exitCode ?? 0,
    messages: partial.messages ?? [],
    stderr: partial.stderr ?? "",
    usage: partial.usage ?? emptyUsage(),
    startedAt: partial.startedAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    stopReason: partial.stopReason,
    errorMessage: partial.errorMessage,
    failureCategory: partial.failureCategory,
  };
}

describe("executeParallel task aborting", () => {
  it("aborts one child session without canceling siblings", async () => {
    runAgentMock.mockImplementation(async (opts: any) => {
      if (opts.sessionId === "child-1") {
        return new Promise((resolve) => {
          const finish = () => {
            resolve(makeResult({
              sessionId: "child-1",
              taskId: "task-1",
              siblingIndex: 1,
              agent: "worker-a",
              summary: "first",
              task: "task one",
              exitCode: 130,
              stopReason: "aborted",
              errorMessage: "Task was aborted.",
              failureCategory: "abort",
              stderr: "Task was aborted.",
            }));
          };

          if (opts.signal?.aborted) {
            finish();
            return;
          }

          opts.signal?.addEventListener("abort", finish, { once: true });
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
      return makeResult({
        sessionId: "child-2",
        taskId: "task-1",
        siblingIndex: 2,
        agent: "worker-b",
        summary: "second",
        task: "task two",
        exitCode: 0,
      });
    });

    const taskAbortRegistry = createTaskAbortRegistry();

    const promise = executeParallel({
      taskId: "task-1",
      tasks: [
        { agent: "worker-a", summary: "first", task: "task one", delegationMode: "spawn" },
        { agent: "worker-b", summary: "second", task: "task two", delegationMode: "spawn" },
      ],
      taskIdentities: [
        { sessionId: "child-1", taskId: "task-1", siblingIndex: 1 },
        { sessionId: "child-2", taskId: "task-1", siblingIndex: 2 },
      ],
      inheritedThinking: "low",
      agents: [
        { name: "worker-a", source: "user", description: "", filePath: "", systemPrompt: "" },
        { name: "worker-b", source: "user", description: "", filePath: "", systemPrompt: "" },
      ],
      baseCwd: process.cwd(),
      makeDetails: (results) => ({ results } as any),
      concurrency: 2,
      currentDepth: 0,
      ctx: { hasUI: false },
      upsertDelegatedRun: vi.fn(),
      syncDelegatedRunWithResult: vi.fn(),
      upsertTask: vi.fn(),
      syncTaskWithResult: vi.fn(),
      taskAbortRegistry,
    });

    expect(taskAbortRegistry.abort("child-1")).toBe(true);

    const result = await promise;
    const results = (result.details as any).results as SingleResult[];

    expect(result.isError).toBeUndefined();
    expect(results).toHaveLength(2);

    const aborted = results.find((entry) => entry.sessionId === "child-1");
    const completed = results.find((entry) => entry.sessionId === "child-2");

    expect(aborted?.failureCategory).toBe("abort");
    expect(aborted?.stopReason).toBe("aborted");
    expect(completed?.exitCode).toBe(0);
  });
});
