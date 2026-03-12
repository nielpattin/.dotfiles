import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackgroundCompletionInbox } from "./background-completion.js";

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
