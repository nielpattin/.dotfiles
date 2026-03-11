import { describe, expect, it } from "vitest";
import { buildBackgroundQueueToolText } from "./execute.js";

describe("buildBackgroundQueueToolText", () => {
  it("returns concise id-only queue text", () => {
    const text = buildBackgroundQueueToolText([
      { publicTaskId: "task-1-a1b2c3", task: { agent: "worker" } },
      { publicTaskId: "task-2-d4e5f6", task: { agent: "reviewer" } },
    ]);

    expect(text).toBe("Background task ids: task-1-a1b2c3 (worker), task-2-d4e5f6 (reviewer)");
    expect(text).not.toContain("I’ll post results when they finish");
  });
});
