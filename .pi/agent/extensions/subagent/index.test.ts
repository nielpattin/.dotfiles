import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as path from "node:path";

const TEST_HOME = path.join(path.sep, "home", "test");
const TEST_REPO_CWD = path.join(path.sep, "repo");
const TEST_PROJECT_AGENTS_DIR = path.join(TEST_REPO_CWD, ".pi", "agents");
const TEST_USER_AGENT_FILE = path.join(TEST_HOME, ".pi", "agent", "agents", "worker.md");
const TEST_PROJECT_AGENT_FILE = path.join(TEST_PROJECT_AGENTS_DIR, "reviewer.md");
const TEST_APP_CWD = path.join(TEST_REPO_CWD, "packages", "app");
const TEST_DOCS_CWD = path.join(TEST_REPO_CWD, "docs");

type DiscoveryResult = {
  agents: any[];
  projectAgentsDir: string | null;
};

type RunAgentCall = Record<string, any>;
type MapConcurrentCall = {
  items: any[];
  concurrency: number;
};

const discoverAgentsCalls: Array<{ cwd: string; scope: string }> = [];
const runAgentCalls: RunAgentCall[] = [];
const mapConcurrentCalls: MapConcurrentCall[] = [];

let discoverAgentsResult: DiscoveryResult = { agents: [], projectAgentsDir: null };
let runAgentImpl: (opts: any) => Promise<any> = async () => {
  throw new Error("runAgentImpl not configured for test");
};
let mapConcurrentImpl: (
  items: any[],
  concurrency: number,
  fn: (item: any, index: number) => Promise<any>,
) => Promise<any[]> = async (items, _concurrency, fn) => {
  const results: any[] = [];
  for (const [index, item] of items.entries()) {
    results.push(await fn(item, index));
  }
  return results;
};

mock.module("./agents.js", () => ({
  discoverAgents(cwd: string, scope: string) {
    discoverAgentsCalls.push({ cwd, scope });
    return discoverAgentsResult;
  },
}));

mock.module("./runner.js", () => ({
  async runAgent(opts: any) {
    runAgentCalls.push(opts);
    return runAgentImpl(opts);
  },
  async mapConcurrent(
    items: any[],
    concurrency: number,
    fn: (item: any, index: number) => Promise<any>,
  ) {
    mapConcurrentCalls.push({ items, concurrency });
    return mapConcurrentImpl(items, concurrency, fn);
  },
}));

mock.module("./render.js", () => ({
  renderCall() {
    return null;
  },
  renderResult() {
    return null;
  },
}));

const { default: subagentExtension } = await import("./index.ts");
const { emptyUsage } = await import("./types.ts");

class MockPi {
  tool: any;
  private readonly handlers = new Map<string, Function[]>();

  constructor(
    private readonly thinkingLevel = "medium",
    private readonly flags: Record<string, string | undefined> = {},
  ) {}

  registerFlag(_name: string, _config: unknown): void {}

  getFlag(name: string): string | undefined {
    return this.flags[name];
  }

  getThinkingLevel(): string {
    return this.thinkingLevel;
  }

  on(eventName: string, handler: Function): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  registerTool(tool: any): void {
    this.tool = tool;
  }

  async emit(eventName: string, event: any, ctx?: any): Promise<any> {
    const handlers = this.handlers.get(eventName) ?? [];
    let result: any;
    for (const handler of handlers) {
      result = await handler(event, ctx);
    }
    return result;
  }
}

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    name: "worker",
    description: "General worker agent",
    source: "user",
    systemPrompt: "",
    filePath: TEST_USER_AGENT_FILE,
    ...overrides,
  };
}

function makeResult(overrides: Record<string, any> = {}) {
  const now = Date.now();
  return {
    agent: "worker",
    agentSource: "user",
    task: "Default task",
    summary: "Default summary",
    delegationMode: "spawn",
    exitCode: 0,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      },
    ],
    stderr: "",
    usage: emptyUsage(),
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSessionManager(hasSnapshot = true) {
  return {
    getHeader: () => (hasSnapshot ? { type: "session", id: "parent-session" } : null),
    getBranch: () => (hasSnapshot ? [{ type: "message", role: "user", content: [] }] : []),
  };
}

function makeCtx(overrides: Record<string, any> = {}) {
  const confirm = mock(async () => true);
  const notify = mock(() => {});
  return {
    cwd: TEST_REPO_CWD,
    hasUI: false,
    sessionManager: makeSessionManager(true),
    ui: {
      confirm,
      notify,
    },
    ...overrides,
  };
}

function createExtension(options?: {
  thinkingLevel?: string;
  flags?: Record<string, string | undefined>;
}) {
  const pi = new MockPi(options?.thinkingLevel, options?.flags);
  subagentExtension(pi as any);
  expect(pi.tool).toBeDefined();
  return { pi, tool: pi.tool };
}

beforeEach(() => {
  discoverAgentsCalls.length = 0;
  runAgentCalls.length = 0;
  mapConcurrentCalls.length = 0;
  discoverAgentsResult = { agents: [], projectAgentsDir: null };
  runAgentImpl = async () => {
    throw new Error("runAgentImpl not configured for test");
  };
  mapConcurrentImpl = async (items, _concurrency, fn) => {
    const results: any[] = [];
    for (const [index, item] of items.entries()) {
      results.push(await fn(item, index));
    }
    return results;
  };
  delete process.env.PI_TASK_DEPTH;
  delete process.env.PI_TASK_MAX_DEPTH;
  delete process.env.PI_TASK_MAX_PARALLEL;
  delete process.env.PI_TASK_CONCURRENCY;
});

describe("subagent index", () => {
  it("refreshes discovered agents before injecting them into the system prompt", async () => {
    discoverAgentsResult = {
      agents: [
        makeAgent({ name: "worker", description: "Handles implementation work" }),
      ],
      projectAgentsDir: TEST_PROJECT_AGENTS_DIR,
    };

    const { pi } = createExtension();
    const ctx = makeCtx({ hasUI: true });

    await pi.emit("session_start", {}, ctx);

    discoverAgentsResult = {
      agents: [
        makeAgent({
          name: "reviewer",
          description: "Reviews code changes",
          source: "project",
          filePath: TEST_PROJECT_AGENT_FILE,
        }),
      ],
      projectAgentsDir: TEST_PROJECT_AGENTS_DIR,
    };

    const injected = await pi.emit("before_agent_start", { systemPrompt: "Base prompt" }, ctx);

    expect(discoverAgentsCalls).toEqual([
      { cwd: TEST_REPO_CWD, scope: "both" },
      { cwd: TEST_REPO_CWD, scope: "both" },
    ]);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect((ctx.ui.notify as any).mock.calls[0]?.[0]).toContain("worker (user)");
    expect(injected.systemPrompt).toContain("## Available Task Agents");
    expect(injected.systemPrompt).not.toContain("**worker**: Handles implementation work");
    expect(injected.systemPrompt).toContain("**reviewer**: Reviews code changes");
    expect(injected.systemPrompt).toContain("'spawn' (default): child receives only the provided task prompt");
  });

  it("rejects an invalid mode before execution", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { agent: "worker", summary: "Mode check", task: "Do work", mode: "weird" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid mode "weird"');
    expect(runAgentCalls).toHaveLength(0);
  });

  it("rejects mixed single and parallel invocation shapes", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      {
        agent: "worker",
        summary: "Single",
        task: "Do work",
        tasks: [{ agent: "worker", summary: "Parallel", task: "Do more work" }],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Provide exactly one invocation shape");
    expect(runAgentCalls).toHaveLength(0);
    expect(mapConcurrentCalls).toHaveLength(0);
  });

  it("rejects incomplete single-task parameters", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { agent: "worker", task: "Missing summary" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Single mode requires agent, summary, and task");
    expect(runAgentCalls).toHaveLength(0);
  });

  it("rejects invalid parallel task items", async () => {
    discoverAgentsResult = {
      agents: [makeAgent(), makeAgent({ name: "reviewer" })],
      projectAgentsDir: null,
    };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      {
        tasks: [
          { agent: "worker", summary: "Valid", task: "Do work" },
          { agent: "reviewer", summary: "   ", task: "Review work" },
        ],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Each task item requires agent, summary, and task");
    expect(runAgentCalls).toHaveLength(0);
  });

  it("rejects invalid per-task modes in parallel batches", async () => {
    discoverAgentsResult = {
      agents: [makeAgent(), makeAgent({ name: "reviewer" })],
      projectAgentsDir: null,
    };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      {
        tasks: [
          { agent: "worker", summary: "Write", task: "Do work", mode: "spawn" },
          { agent: "reviewer", summary: "Review", task: "Review work", mode: "weird" },
        ],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid task mode "weird"');
    expect(result.content[0]?.text).toContain('parallel task "Review"');
    expect(runAgentCalls).toHaveLength(0);
  });

  it("blocks fork mode when the parent session snapshot cannot be built", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { agent: "worker", summary: "Fork", task: "Do work", mode: "fork" },
      undefined,
      undefined,
      makeCtx({ sessionManager: makeSessionManager(false) }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Cannot use mode=\"fork\": failed to snapshot current session context.");
    expect(runAgentCalls).toHaveLength(0);
  });

  it("blocks parallel batches when any task needs fork mode but the parent snapshot cannot be built", async () => {
    discoverAgentsResult = {
      agents: [makeAgent(), makeAgent({ name: "reviewer" })],
      projectAgentsDir: null,
    };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      {
        tasks: [
          { agent: "worker", summary: "Write", task: "Do work", mode: "spawn" },
          { agent: "reviewer", summary: "Review", task: "Review work", mode: "fork" },
        ],
      },
      undefined,
      undefined,
      makeCtx({ sessionManager: makeSessionManager(false) }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Cannot use mode=\"fork\": failed to snapshot current session context.");
    expect(runAgentCalls).toHaveLength(0);
  });

  it("cancels project-local agents when the user declines confirmation", async () => {
    discoverAgentsResult = {
      agents: [
        makeAgent({
          name: "reviewer",
          source: "project",
          filePath: TEST_PROJECT_AGENT_FILE,
        }),
      ],
      projectAgentsDir: TEST_PROJECT_AGENTS_DIR,
    };

    const { tool } = createExtension();
    const confirm = mock(async () => false);
    const result = await tool.execute(
      "call-1",
      { agent: "reviewer", summary: "Review", task: "Check this repo" },
      undefined,
      undefined,
      makeCtx({ hasUI: true, ui: { confirm, notify: mock(() => {}) } }),
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toContain("Canceled: project-local agents not approved.");
    expect(result.isError).toBeUndefined();
    expect(runAgentCalls).toHaveLength(0);
  });

  it("blocks project-local agents in non-UI mode unless confirmation is disabled", async () => {
    discoverAgentsResult = {
      agents: [
        makeAgent({
          name: "reviewer",
          source: "project",
          filePath: TEST_PROJECT_AGENT_FILE,
        }),
      ],
      projectAgentsDir: TEST_PROJECT_AGENTS_DIR,
    };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { agent: "reviewer", summary: "Review", task: "Check this repo" },
      undefined,
      undefined,
      makeCtx({ hasUI: false }),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Blocked: project-local agent confirmation is required in non-UI mode.");
    expect(runAgentCalls).toHaveLength(0);
  });

  it("executes a single task and passes the resolved runner options", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };
    runAgentImpl = async (opts) =>
      makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
        thinking: opts.inheritedThinking,
        messages: [{ role: "assistant", content: [{ type: "text", text: "single done" }] }],
      });

    const { tool } = createExtension({ thinkingLevel: "high" });
    const result = await tool.execute(
      "call-1",
      {
        agent: "worker",
        summary: "Implement feature",
        task: "Ship the feature",
        cwd: TEST_APP_CWD,
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(runAgentCalls).toHaveLength(1);
    expect(runAgentCalls[0]?.agentName).toBe("worker");
    expect(runAgentCalls[0]?.task).toBe("Ship the feature");
    expect(runAgentCalls[0]?.summary).toBe("Implement feature");
    expect(runAgentCalls[0]?.taskCwd).toBe(TEST_APP_CWD);
    expect(runAgentCalls[0]?.delegationMode).toBe("spawn");
    expect(runAgentCalls[0]?.cwd).toBe(TEST_REPO_CWD);
    expect(runAgentCalls[0]?.parentDepth).toBe(0);
    expect(runAgentCalls[0]?.maxDepth).toBe(1);
    expect(runAgentCalls[0]?.inheritedThinking).toBe("high");
    expect(result.content[0]?.text).toBe("single done");
    expect(result.details.mode).toBe("single");
    expect(result.details.results[0]?.summary).toBe("Implement feature");
  });

  it("surfaces categorized single-task failures in the result text", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };
    runAgentImpl = async (opts) =>
      makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
        exitCode: 1,
        stopReason: "error",
        failureCategory: "startup",
        errorMessage: "Failed to start child process.",
        messages: [],
      });

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { agent: "worker", summary: "Failure", task: "Fail now" },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Agent startup failed: Failed to start child process.");
    expect(result.details.results[0]?.failureCategory).toBe("startup");
  });

  it("uses env-configured parallel task limits", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };
    process.env.PI_TASK_MAX_PARALLEL = "3";
    process.env.PI_TASK_CONCURRENCY = "2";

    runAgentImpl = async (opts) =>
      makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
      });

    const tasks = Array.from({ length: 3 }, (_, index) => ({
      agent: "worker",
      summary: `Task ${index + 1}`,
      task: `Do task ${index + 1}`,
    }));

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { tasks },
      undefined,
      undefined,
      makeCtx(),
    );

    const rejected = await tool.execute(
      "call-2",
      {
        tasks: [...tasks, { agent: "worker", summary: "Task 4", task: "Do task 4" }],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(mapConcurrentCalls).toHaveLength(1);
    expect(mapConcurrentCalls[0]?.concurrency).toBe(2);
    expect(runAgentCalls).toHaveLength(3);
    expect(result.content[0]?.text).toContain("Parallel: 3/3 succeeded");
    expect(rejected.content[0]?.text).toContain("Too many parallel tasks (4). Max is 3.");
  });

  it("lets task flags override env settings and clamps concurrency to the task cap", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };
    process.env.PI_TASK_MAX_PARALLEL = "3";
    process.env.PI_TASK_CONCURRENCY = "2";

    runAgentImpl = async (opts) =>
      makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
      });

    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn as any;

    try {
      const tasks = Array.from({ length: 6 }, (_, index) => ({
        agent: "worker",
        summary: `Task ${index + 1}`,
        task: `Do task ${index + 1}`,
      }));

      const { tool } = createExtension({
        flags: {
          "task-max-parallel": "6",
          "task-concurrency": "9",
        },
      });
      await tool.execute("call-1", { tasks }, undefined, undefined, makeCtx());

      expect(mapConcurrentCalls).toHaveLength(1);
      expect(mapConcurrentCalls[0]?.concurrency).toBe(6);
      expect(runAgentCalls).toHaveLength(6);
      expect(warn).toHaveBeenCalled();
      expect(
        (warn as any).mock.calls.some((call: any[]) =>
          String(call[0]).includes("Clamping task concurrency from 9 to 6"),
        ),
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("warns on invalid parallel settings and falls back to the defaults", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };
    process.env.PI_TASK_MAX_PARALLEL = "0";
    process.env.PI_TASK_CONCURRENCY = "abc";

    runAgentImpl = async (opts) =>
      makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
      });

    const warn = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warn as any;

    try {
      const { tool } = createExtension();
      await tool.execute(
        "call-1",
        {
          tasks: [
            { agent: "worker", summary: "Task 1", task: "Do task 1" },
            { agent: "worker", summary: "Task 2", task: "Do task 2" },
          ],
        },
        undefined,
        undefined,
        makeCtx(),
      );

      const rejected = await tool.execute(
        "call-2",
        {
          tasks: Array.from({ length: 9 }, (_, index) => ({
            agent: "worker",
            summary: `Task ${index + 1}`,
            task: `Do task ${index + 1}`,
          })),
        },
        undefined,
        undefined,
        makeCtx(),
      );

      expect(mapConcurrentCalls).toHaveLength(1);
      expect(mapConcurrentCalls[0]?.concurrency).toBe(4);
      expect(rejected.content[0]?.text).toContain("Too many parallel tasks (9). Max is 8.");
      expect(
        (warn as any).mock.calls.some((call: any[]) =>
          String(call[0]).includes("Ignoring invalid PI_TASK_MAX_PARALLEL=\"0\""),
        ),
      ).toBe(true);
      expect(
        (warn as any).mock.calls.some((call: any[]) =>
          String(call[0]).includes("Ignoring invalid PI_TASK_CONCURRENCY=\"abc\""),
        ),
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("uses per-task modes in parallel runs with task-level precedence over the top-level default", async () => {
    discoverAgentsResult = {
      agents: [
        makeAgent(),
        makeAgent({ name: "reviewer", description: "Reviews work" }),
        makeAgent({ name: "planner", description: "Plans work" }),
      ],
      projectAgentsDir: null,
    };

    runAgentImpl = async (opts) =>
      makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: `${opts.agentName} complete` }],
          },
        ],
      });

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      {
        tasks: [
          { agent: "worker", summary: "Write", task: "Write docs", mode: "spawn" },
          { agent: "reviewer", summary: "Review", task: "Review docs", mode: "fork" },
          { agent: "planner", summary: "Plan", task: "Plan docs" },
        ],
        mode: "fork",
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(runAgentCalls).toHaveLength(3);
    expect(runAgentCalls[0]?.delegationMode).toBe("spawn");
    expect(runAgentCalls[1]?.delegationMode).toBe("fork");
    expect(runAgentCalls[2]?.delegationMode).toBe("fork");
    expect(runAgentCalls[0]?.forkSessionSnapshotJsonl).toBeUndefined();
    expect(runAgentCalls[1]?.forkSessionSnapshotJsonl).toBe(
      '{"type":"session","id":"parent-session"}\n{"type":"message","role":"user","content":[]}\n',
    );
    expect(runAgentCalls[2]?.forkSessionSnapshotJsonl).toBe(
      '{"type":"session","id":"parent-session"}\n{"type":"message","role":"user","content":[]}\n',
    );
    expect(result.details.results.map((taskResult: any) => taskResult.delegationMode)).toEqual([
      "spawn",
      "fork",
      "fork",
    ]);
  });

  it("executes parallel tasks, forwards fork snapshots, and streams aggregate updates", async () => {
    discoverAgentsResult = {
      agents: [makeAgent(), makeAgent({ name: "reviewer", description: "Reviews work" })],
      projectAgentsDir: null,
    };

    runAgentImpl = async (opts) => {
      if (opts.agentName === "worker") {
        opts.onUpdate?.({
          content: [{ type: "text", text: "(running...)" }],
          details: opts.makeDetails([
            makeResult({
              agent: "worker",
              task: opts.task,
              summary: opts.summary,
              delegationMode: opts.delegationMode,
              exitCode: -1,
              messages: [],
            }),
          ]),
        });
      }

      return makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: `${opts.agentName} complete` }],
          },
        ],
      });
    };

    const updates: any[] = [];
    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      {
        tasks: [
          { agent: "worker", summary: "Write", task: "Write docs", cwd: TEST_DOCS_CWD },
          { agent: "reviewer", summary: "Review", task: "Review docs" },
        ],
        mode: "fork",
      },
      undefined,
      (partial: any) => updates.push(partial),
      makeCtx(),
    );

    expect(mapConcurrentCalls).toHaveLength(1);
    expect(mapConcurrentCalls[0]?.concurrency).toBe(4);
    expect(runAgentCalls).toHaveLength(2);
    expect(runAgentCalls[0]?.delegationMode).toBe("fork");
    expect(runAgentCalls[1]?.delegationMode).toBe("fork");
    expect(runAgentCalls[0]?.forkSessionSnapshotJsonl).toBe(
      '{"type":"session","id":"parent-session"}\n{"type":"message","role":"user","content":[]}\n',
    );
    expect(runAgentCalls[1]?.forkSessionSnapshotJsonl).toBe(
      '{"type":"session","id":"parent-session"}\n{"type":"message","role":"user","content":[]}\n',
    );
    expect(runAgentCalls[0]?.taskCwd).toBe(TEST_DOCS_CWD);
    expect(runAgentCalls[1]?.taskCwd).toBeUndefined();
    expect(updates.length).toBeGreaterThan(0);
    expect(result.content[0]?.text).toContain("Parallel: 2/2 succeeded");
    expect(result.content[0]?.text).toContain("[worker] completed: worker complete");
    expect(result.content[0]?.text).toContain("[reviewer] completed: reviewer complete");
    expect(result.details.mode).toBe("parallel");
    expect(result.details.results).toHaveLength(2);
  });

  it("surfaces categorized parallel failures in the aggregate summary", async () => {
    discoverAgentsResult = {
      agents: [makeAgent(), makeAgent({ name: "reviewer", description: "Reviews work" })],
      projectAgentsDir: null,
    };

    runAgentImpl = async (opts) => {
      if (opts.agentName === "worker") {
        return makeResult({
          agent: opts.agentName,
          agentSource: "user",
          task: opts.task,
          summary: opts.summary,
          delegationMode: opts.delegationMode,
          exitCode: 1,
          stopReason: "error",
          failureCategory: "runtime",
          errorMessage: "Tests failed in child task.",
          messages: [],
        });
      }

      return makeResult({
        agent: opts.agentName,
        agentSource: "user",
        task: opts.task,
        summary: opts.summary,
        delegationMode: opts.delegationMode,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: `${opts.agentName} complete` }],
          },
        ],
      });
    };

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      {
        tasks: [
          { agent: "worker", summary: "Write", task: "Write docs" },
          { agent: "reviewer", summary: "Review", task: "Review docs" },
        ],
      },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.content[0]?.text).toContain("Parallel: 1/2 succeeded");
    expect(result.content[0]?.text).toContain("[worker] runtime failed: Tests failed in child task.");
    expect(result.content[0]?.text).toContain("[reviewer] completed: reviewer complete");
  });

  it("rejects parallel batches above the hard task limit", async () => {
    discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };

    const tasks = Array.from({ length: 9 }, (_, index) => ({
      agent: "worker",
      summary: `Task ${index + 1}`,
      task: `Do task ${index + 1}`,
    }));

    const { tool } = createExtension();
    const result = await tool.execute(
      "call-1",
      { tasks },
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.content[0]?.text).toContain("Too many parallel tasks (9). Max is 8.");
    expect(runAgentCalls).toHaveLength(0);
    expect(mapConcurrentCalls).toHaveLength(0);
  });
});
