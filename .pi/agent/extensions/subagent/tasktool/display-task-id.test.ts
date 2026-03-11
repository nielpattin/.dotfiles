import { describe, expect, it } from "vitest";
import { toDisplayTaskId, toPublicTaskId } from "./display-task-id.js";

describe("public task id", () => {
  it("creates a stable medium id for tool-call style ids", () => {
    const id = "toolcall-abcdefghijklmnopqrstuvwxyz:17";
    expect(toPublicTaskId(id)).toBe("task-17-ctm4u9");
    expect(toPublicTaskId(id)).toBe("task-17-ctm4u9");
  });

  it("creates a stable medium id without numeric suffix", () => {
    expect(toPublicTaskId("very-long-task-id-without-suffix")).toBe("task-18v8zf");
  });

  it("keeps old display helper wired to the public id format", () => {
    expect(toDisplayTaskId("task-123")).toBe("task-rvp3lp");
  });
});
