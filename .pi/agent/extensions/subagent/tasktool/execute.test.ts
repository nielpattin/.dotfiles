import { describe, expect, it } from "vitest";
import { buildBackgroundQueueToolText } from "./execute.js";

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
