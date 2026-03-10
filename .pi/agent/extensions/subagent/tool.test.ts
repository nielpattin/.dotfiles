import { describe, expect, it } from "vitest";
import { createExtension, makeAgent, makeCtx, setupIndexTests, state } from "./harness.ts";

setupIndexTests();

describe("subagent public contract", () => {
  it("runs single mode successfully and defaults delegationMode to spawn", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { mode: "single", operation: { agent: "worker", summary: "S1", task: "Do one" } },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBeUndefined();
    expect(state.runAgentCalls).toHaveLength(1);
    expect(state.runAgentCalls[0]?.agentName).toBe("worker");
    expect(state.runAgentCalls[0]?.summary).toBe("S1");
    expect(state.runAgentCalls[0]?.delegationMode).toBe("spawn");
    expect(state.runAgentCalls[0]?.forkSessionSnapshotJsonl).toBeUndefined();
  });

  it("runs single mode with explicit delegationMode spawn", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1b",
      {
        mode: "single",
        operation: { agent: "worker", summary: "S1", task: "Do one", delegationMode: "spawn" },
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBeUndefined();
    expect(state.runAgentCalls).toHaveLength(1);
    expect(state.runAgentCalls[0]?.delegationMode).toBe("spawn");
    expect(state.runAgentCalls[0]?.forkSessionSnapshotJsonl).toBeUndefined();
  });

  it("runs single mode with explicit delegationMode fork", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1c",
      {
        mode: "single",
        operation: { agent: "worker", summary: "S1", task: "Do one", delegationMode: "fork" },
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBeUndefined();
    expect(state.runAgentCalls).toHaveLength(1);
    expect(state.runAgentCalls[0]?.delegationMode).toBe("fork");
    expect(state.runAgentCalls[0]?.forkSessionSnapshotJsonl).toContain('"type":"session"');
  });

  it("runs parallel mode successfully and defaults delegationMode to spawn", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-2",
      {
        mode: "parallel",
        operations: [
          { agent: "worker", summary: "A", task: "Task A" },
          { agent: "worker", summary: "B", task: "Task B" },
        ],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBeUndefined();
    expect(state.runAgentCalls).toHaveLength(2);
    expect(state.mapConcurrentCalls[0]?.items).toHaveLength(2);
    expect(state.runAgentCalls.map((call) => call.delegationMode)).toEqual(["spawn", "spawn"]);
    expect(state.runAgentCalls[0]?.forkSessionSnapshotJsonl).toBeUndefined();
    expect(state.runAgentCalls[1]?.forkSessionSnapshotJsonl).toBeUndefined();
  });

  it("runs parallel mode with explicit spawn/fork delegationMode per operation", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-2b",
      {
        mode: "parallel",
        operations: [
          { agent: "worker", summary: "A", task: "Task A", delegationMode: "spawn" },
          { agent: "worker", summary: "B", task: "Task B", delegationMode: "fork" },
        ],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBeUndefined();
    expect(state.runAgentCalls).toHaveLength(2);
    expect(state.runAgentCalls[0]?.delegationMode).toBe("spawn");
    expect(state.runAgentCalls[0]?.forkSessionSnapshotJsonl).toBeUndefined();
    expect(state.runAgentCalls[1]?.delegationMode).toBe("fork");
    expect(state.runAgentCalls[1]?.forkSessionSnapshotJsonl).toContain('"type":"session"');
  });

  it("requires non-empty summary", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-3",
      { mode: "single", operation: { agent: "worker", summary: "   ", task: "Do one" } },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("requires non-empty `agent`, `summary`, and `task`");
  });

  it("rejects mixed single/parallel shapes", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-4",
      {
        mode: "single",
        operation: { agent: "worker", summary: "A", task: "Task" },
        operations: [{ agent: "worker", summary: "B", task: "Task" }],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("`operations` is not allowed when mode is `single`");
  });

  it("rejects invalid delegationMode values", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-4b",
      {
        mode: "single",
        operation: { agent: "worker", summary: "A", task: "Task", delegationMode: "invalid" },
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("delegationMode must be");
  });

  it("rejects payload skills alias", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-5",
      {
        mode: "single",
        operation: { agent: "worker", summary: "A", task: "Task", skills: ["triage-expert"] },
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unsupported field `skills`");
  });

  it("rejects payload extension/extensions", async () => {
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-6",
      {
        mode: "single",
        operation: { agent: "worker", summary: "A", task: "Task", extensions: ["rtk"] },
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("cannot include `extension` or `extensions`");
  });

  it("rejects legacy tasks payload and spawn/fork mode model", async () => {
    const { tool } = createExtension();

    const legacyTasks = await tool.execute(
      "call-7",
      { tasks: [{ agent: "worker", summary: "A", task: "Task" }] },
      undefined,
      undefined,
      makeCtx(),
    );
    expect(legacyTasks.isError).toBe(true);
    expect(legacyTasks.content[0]?.text).toContain("Legacy `tasks` payload");

    const legacyMode = await tool.execute(
      "call-8",
      { mode: "spawn", operation: { agent: "worker", summary: "A", task: "Task" } },
      undefined,
      undefined,
      makeCtx(),
    );
    expect(legacyMode.isError).toBe(true);
    expect(legacyMode.content[0]?.text).toContain("spawn|fork");
  });

  it("uses configured default skills/extensions/cwd when payload skill is omitted", async () => {
    state.discoverAgentsResult = {
      agents: [makeAgent({ skills: ["triage-expert", "frontend-design"], extensions: ["rtk"], cwd: "/repo/custom" })],
      projectAgentsDir: null,
    };

    const { tool } = createExtension();
    await tool.execute(
      "call-9",
      { mode: "single", operation: { agent: "worker", summary: "With defaults", task: "Task" } },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(state.runAgentCalls[0]?.overrideSkills).toEqual(["triage-expert", "frontend-design"]);
    expect(state.runAgentCalls[0]?.overrideExtensions).toEqual(["rtk"]);
    expect(state.runAgentCalls[0]?.taskCwd).toBe("/repo/custom");
  });

  it("replaces configured default skills when payload skill is provided", async () => {
    state.discoverAgentsResult = {
      agents: [makeAgent({ skills: ["triage-expert", "frontend-design"] })],
      projectAgentsDir: null,
    };

    const { tool } = createExtension();
    await tool.execute(
      "call-9b",
      {
        mode: "single",
        operation: { agent: "worker", summary: "Skill override", task: "Task", skill: "mermaid-diagrams" },
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(state.runAgentCalls[0]?.overrideSkills).toEqual(["mermaid-diagrams"]);
  });
});
