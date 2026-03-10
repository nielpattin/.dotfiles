import { beforeEach, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

export const TEST_REPO_CWD = path.join(path.sep, "repo");

type DiscoveryResult = {
  agents: any[];
  projectAgentsDir: string | null;
};

type TestState = {
  discoverAgentsResult: DiscoveryResult;
  runAgentImpl: (opts: any) => Promise<any>;
  runAgentCalls: any[];
  mapConcurrentCalls: Array<{ items: any[]; concurrency: number }>;
  updateDefaultsCalls: Array<{ filePath: string; updates: any }>;
  availableSkills: Array<{ name: string; source: string; description?: string }>;
};

vi.hoisted(() => {
  (globalThis as any).__subagentTestState = {
    discoverAgentsResult: { agents: [], projectAgentsDir: null } as DiscoveryResult,
    runAgentImpl: async () => {
      throw new Error("runAgentImpl not configured");
    },
    runAgentCalls: [] as any[],
    mapConcurrentCalls: [] as Array<{ items: any[]; concurrency: number }>,
    updateDefaultsCalls: [] as Array<{ filePath: string; updates: any }>,
    availableSkills: [] as Array<{ name: string; source: string; description?: string }>,
  } satisfies TestState;
});

export const state = (globalThis as any).__subagentTestState as TestState;

vi.mock("./agents/discover.js", () => ({
  discoverAgents() {
    return state.discoverAgentsResult;
  },
}));

vi.mock("./agents/update.js", () => ({
  updateAgentDefaultsInFile(filePath: string, updates: any) {
    state.updateDefaultsCalls.push({ filePath, updates });
  },
}));

vi.mock("./runner.js", () => ({
  async runAgent(opts: any) {
    state.runAgentCalls.push(opts);
    return state.runAgentImpl(opts);
  },
  async mapConcurrent(items: any[], concurrency: number, fn: (item: any, index: number) => Promise<any>) {
    state.mapConcurrentCalls.push({ items, concurrency });
    const results: any[] = [];
    for (const [index, item] of items.entries()) {
      results.push(await fn(item, index));
    }
    return results;
  },
}));

vi.mock("./render/details.js", () => ({
  renderCall: () => null,
  renderResult: () => null,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  loadSkills: () => ({ skills: state.availableSkills, diagnostics: [] }),
}));

const { default: subagentExtension } = await import("./index.ts");
const { emptyUsage } = await import("./types.ts");

class MockPi {
  tool: any;
  command: any;
  private readonly handlers = new Map<string, Function[]>();

  registerFlag(): void {}
  registerCommand(_name: string, command: any): void {
    this.command = command;
  }
  getFlag(): string | undefined {
    return undefined;
  }
  getThinkingLevel(): string {
    return "medium";
  }
  on(eventName: string, handler: Function): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }
  registerTool(tool: any): void {
    this.tool = tool;
  }
}

export function makeAgent(overrides: Record<string, any> = {}) {
  return {
    name: "worker",
    description: "worker",
    source: "user",
    systemPrompt: "",
    filePath: "/tmp/worker.md",
    ...overrides,
  };
}

export function makeResult(overrides: Record<string, any> = {}) {
  const now = Date.now();
  return {
    agent: "worker",
    agentSource: "user",
    task: "Default task",
    summary: "Default summary",
    delegationMode: "spawn",
    exitCode: 0,
    messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
    stderr: "",
    usage: emptyUsage(),
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createExtension() {
  const pi = new MockPi();
  subagentExtension(pi as any);
  expect(pi.tool).toBeDefined();
  return { tool: pi.tool, command: pi.command };
}

export function makeProjectExtensionsFixture(extensionNames: string[]): { cwd: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-subagent-ext-picker-"));
  const extensionsDir = path.join(root, ".pi", "extensions");
  const cwd = path.join(root, "repo", "app");

  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  for (const extensionName of extensionNames) {
    fs.writeFileSync(path.join(extensionsDir, `${extensionName}.ts`), "export default function () {}\n", "utf-8");
  }

  return {
    cwd,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function makeCtx(overrides: Record<string, any> = {}) {
  return {
    cwd: TEST_REPO_CWD,
    hasUI: false,
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(async () => true),
      select: vi.fn(async () => undefined),
      input: vi.fn(async () => undefined),
      custom: vi.fn(async () => ({ action: "cancel" })),
      setWidget: vi.fn(),
    },
    sessionManager: {
      getHeader: () => ({ type: "session", id: "session-1", timestamp: new Date(0).toISOString(), cwd: TEST_REPO_CWD }),
      getEntries: () => [],
    },
    ...overrides,
  };
}

export function setupIndexTests() {
  beforeEach(() => {
    delete process.env.PI_TASK_DEPTH;
    delete process.env.PI_TASK_MAX_DEPTH;
    delete process.env.PI_TASK_MAX_PARALLEL;
    delete process.env.PI_TASK_CONCURRENCY;
    state.discoverAgentsResult = { agents: [makeAgent()], projectAgentsDir: null };
    state.runAgentCalls.length = 0;
    state.mapConcurrentCalls.length = 0;
    state.updateDefaultsCalls.length = 0;
    state.availableSkills = [];
    state.runAgentImpl = async (opts) => makeResult({
      agent: opts.agentName,
      task: opts.task,
      summary: opts.summary,
      delegationMode: opts.delegationMode,
    });
  });
}
