import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "./agents.ts";
import { getFinalOutput } from "./types.ts";

type SpawnCall = {
  command: string;
  args: string[];
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    shell?: boolean;
    stdio?: unknown;
  };
};

type SkillFixture = {
  name: string;
  filePath: string;
  baseDir: string;
};

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  killed = false;
  killCalls: string[] = [];
  onKill?: (signal: string) => void;

  kill(signal?: string | number): boolean {
    const normalized = String(signal ?? "SIGTERM");
    this.killed = true;
    this.killCalls.push(normalized);
    this.onKill?.(normalized);
    return true;
  }

  emitStdout(line: string): void {
    this.stdout.emit("data", Buffer.from(line));
  }

  emitStderr(text: string): void {
    this.stderr.emit("data", Buffer.from(text));
  }

  close(code = 0): void {
    this.exitCode = code;
    this.emit("close", code);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }
}

let spawnImpl:
  | ((
      command: string,
      args: string[],
      options: SpawnCall["options"],
    ) => MockChildProcess)
  | undefined;
const spawnCalls: SpawnCall[] = [];
const actualChildProcess = await import("node:child_process");

const mockSkills: SkillFixture[] = [];
const loadSkillsCwds: string[] = [];

mock.module("node:child_process", () => ({
  ...actualChildProcess,
  spawn(command: string, args: string[], options: SpawnCall["options"]) {
    spawnCalls.push({ command, args, options });
    if (!spawnImpl) throw new Error("spawnImpl not configured for test");
    return spawnImpl(command, args, options);
  },
}));

mock.module("@mariozechner/pi-coding-agent", () => ({
  loadSkills({ cwd }: { cwd: string }) {
    loadSkillsCwds.push(cwd);
    return { skills: [...mockSkills] };
  },
  stripFrontmatter(content: string) {
    return content.replace(/^---[\s\S]*?---\s*/, "");
  },
}));

// @ts-expect-error test-only query string keeps this import isolated from other test modules
const { mapConcurrent, runAgent } = await import("./runner.ts?runner-test");

const testRootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "pi-subagent-runner-test-"),
);
const workDir = path.join(testRootDir, "workspace");
const taskCwd = path.join(testRootDir, "task-workspace");
const agentDir = path.join(testRootDir, "agents");
const skillDir = path.join(testRootDir, "skills");
const cliStubPath = path.join(testRootDir, "pi-subagent-runner-test-cli.js");
const agentFilePath = path.join(agentDir, "worker.md");
const skillFilePath = path.join(skillDir, "test-skill.md");
const originalArgv1 = process.argv[1];

function makeDetails(results: any[]) {
  return {
    mode: "single" as const,
    delegationMode: "spawn" as const,
    projectAgentsDir: null,
    results,
  };
}

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "worker",
    description: "Test worker",
    systemPrompt: "",
    source: "user",
    filePath: agentFilePath,
    ...overrides,
  };
}

function getPiArgs(call: SpawnCall): string[] {
  return process.platform === "win32" ? call.args.slice(1) : call.args;
}

function getFlagValue(piArgs: string[], flag: string): string | undefined {
  const index = piArgs.indexOf(flag);
  return index >= 0 ? piArgs[index + 1] : undefined;
}

function emitJson(proc: MockChildProcess, event: unknown): void {
  proc.emitStdout(`${JSON.stringify(event)}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(() => {
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(taskCwd, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(agentFilePath, "---\nname: worker\ndescription: Test worker\n---\n", "utf-8");
  fs.writeFileSync(
    skillFilePath,
    [
      "---",
      "name: test-skill",
      "description: test skill",
      "---",
      "# Skill Body",
      "Use this skill carefully.",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(cliStubPath, "#!/usr/bin/env node\n", "utf-8");
  process.argv[1] = cliStubPath;
});

afterAll(() => {
  if (originalArgv1 === undefined) {
    process.argv.splice(1, 1);
  } else {
    process.argv[1] = originalArgv1;
  }
  try {
    fs.rmSync(testRootDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

beforeEach(() => {
  spawnCalls.length = 0;
  loadSkillsCwds.length = 0;
  mockSkills.length = 0;
  spawnImpl = undefined;
});

describe("runAgent", () => {
  it("completes successfully and propagates child env vars", async () => {
    const proc = new MockChildProcess();

    spawnImpl = () => {
      setTimeout(() => {
        emitJson(proc, {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "finished normally" }],
          },
        });
        proc.close(0);
      }, 5);
      return proc;
    };

    const result = await runAgent({
      cwd: workDir,
      agents: [makeAgent()],
      agentName: "worker",
      task: "Do the thing",
      summary: "Success case",
      delegationMode: "spawn",
      parentDepth: 0,
      maxDepth: 1,
      makeDetails,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stopReason).toBeUndefined();
    expect(result.errorMessage).toBeUndefined();
    expect(proc.killCalls).toHaveLength(0);
    expect(getFinalOutput(result.messages)).toBe("finished normally");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.options.cwd).toBe(workDir);
    expect(spawnCalls[0]?.options.env?.PI_TASK_DEPTH).toBe("1");
    expect(spawnCalls[0]?.options.env?.PI_TASK_MAX_DEPTH).toBe("1");
    expect(spawnCalls[0]?.options.env?.PI_OFFLINE).toBe("1");

    if (process.platform === "win32") {
      expect(spawnCalls[0]?.command).toBe(process.execPath);
      expect(spawnCalls[0]?.args[0]).toBe(cliStubPath);
    } else {
      expect(spawnCalls[0]?.command).toBe("pi");
    }

    const piArgs = getPiArgs(spawnCalls[0]!);
    expect(piArgs).toContain("--no-session");
    expect(piArgs.at(-1)).toBe("Task: Do the thing");
  });

  it("returns an error for an unknown agent without spawning a process", async () => {
    const result = await runAgent({
      cwd: workDir,
      agents: [makeAgent()],
      agentName: "missing-agent",
      task: "Do the thing",
      summary: "Unknown agent",
      delegationMode: "spawn",
      parentDepth: 0,
      maxDepth: 1,
      makeDetails,
    });

    expect(result.exitCode).toBe(1);
    expect(result.agentSource).toBe("unknown");
    expect(result.stderr).toContain('Unknown agent: "missing-agent"');
    expect(spawnCalls).toHaveLength(0);
  });

  it("rejects fork mode when the parent session snapshot is missing", async () => {
    const result = await runAgent({
      cwd: workDir,
      agents: [makeAgent()],
      agentName: "worker",
      task: "Do the thing",
      summary: "Fork missing snapshot",
      delegationMode: "fork",
      parentDepth: 0,
      maxDepth: 1,
      makeDetails,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("missing parent session snapshot context");
    expect(spawnCalls).toHaveLength(0);
  });

  it("parses streamed session, tool, tool-result, and assistant events", async () => {
    const proc = new MockChildProcess();
    const updates: any[] = [];

    spawnImpl = () => {
      setTimeout(() => {
        emitJson(proc, { type: "session", id: "session-12345678", name: "Runner smoke test session" });
        emitJson(proc, {
          type: "tool_execution_start",
          toolCallId: "tool-1",
          toolName: "bash",
          args: { command: "echo hello" },
        });
        emitJson(proc, {
          type: "tool_result_end",
          message: {
            role: "toolResult",
            toolName: "bash",
            content: [{ type: "text", text: "hello" }],
          },
        });
        emitJson(proc, {
          type: "tool_execution_end",
          toolCallId: "tool-1",
          toolName: "bash",
        });
        emitJson(proc, {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            usage: {
              input: 11,
              output: 7,
              cacheRead: 3,
              cacheWrite: 2,
              totalTokens: 18,
              cost: { total: 0.125 },
            },
            model: "provider-x/model-y",
            provider: "provider-x",
            stopReason: "endTurn",
          },
        });
        proc.close(0);
      }, 5);
      return proc;
    };

    const result = await runAgent({
      cwd: workDir,
      agents: [makeAgent({ model: undefined })],
      agentName: "worker",
      task: "Stream things",
      summary: "Event stream",
      delegationMode: "spawn",
      parentDepth: 0,
      maxDepth: 1,
      onUpdate: (partial: any) => updates.push(partial),
      makeDetails,
    });

    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBe("session-12345678");
    expect(result.sessionName).toBe("Runner smoke test session");
    expect(result.activeTool).toBeUndefined();
    expect(result.lastTool?.name).toBe("bash");
    expect(result.lastTool?.toolCallId).toBe("tool-1");
    expect(result.usage.turns).toBe(1);
    expect(result.usage.input).toBe(11);
    expect(result.usage.output).toBe(7);
    expect(result.usage.cacheRead).toBe(3);
    expect(result.usage.cacheWrite).toBe(2);
    expect(result.usage.cost).toBe(0.125);
    expect(result.usage.contextTokens).toBe(18);
    expect(result.model).toBe("provider-x/model-y");
    expect(result.provider).toBe("provider-x");
    expect(result.stopReason).toBe("endTurn");
    expect(getFinalOutput(result.messages)).toBe("done");
    expect(result.messages.some((msg: any) => msg.role === "toolResult")).toBe(true);
    expect(result.messages.some((msg: any) =>
      msg.role === "assistant"
      && Array.isArray(msg.content)
      && msg.content.some((part: any) => part.type === "toolCall" && part.name === "bash"),
    )).toBe(true);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)?.details?.results?.[0]?.lastTool?.name).toBe("bash");
    expect(updates.at(-1)?.content?.[0]?.text).toBe("done");
  });

  it("captures startup spawn errors", async () => {
    const proc = new MockChildProcess();

    spawnImpl = () => {
      setTimeout(() => proc.fail(new Error("boom")), 0);
      return proc;
    };

    const result = await runAgent({
      cwd: workDir,
      agents: [makeAgent()],
      agentName: "worker",
      task: "Do the thing",
      summary: "Spawn error",
      delegationMode: "spawn",
      parentDepth: 0,
      maxDepth: 1,
      makeDetails,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Failed to start task process");
    expect(result.stderr).toContain("Spawn error: boom");
  });

  it("captures child stderr and preserves non-zero exit codes", async () => {
    const proc = new MockChildProcess();

    spawnImpl = () => {
      setTimeout(() => {
        proc.emitStderr("warning on stderr\n");
        proc.close(7);
      }, 5);
      return proc;
    };

    const result = await runAgent({
      cwd: workDir,
      agents: [makeAgent()],
      agentName: "worker",
      task: "Do the thing",
      summary: "Non-zero exit",
      delegationMode: "spawn",
      parentDepth: 0,
      maxDepth: 1,
      makeDetails,
    });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("warning on stderr");
    expect(result.stopReason).toBeUndefined();
  });

  it("loads skills, records skill metadata, and uses task cwd for skill lookup", async () => {
    mockSkills.push({
      name: "test-skill",
      filePath: skillFilePath,
      baseDir: skillDir,
    });

    const proc = new MockChildProcess();
    let promptArg = "";

    spawnImpl = (_command, args) => {
      promptArg = getPiArgs({ command: "", args, options: {} }).at(-1) ?? "";
      setTimeout(() => {
        emitJson(proc, {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "skill run complete" }],
          },
        });
        proc.close(0);
      }, 5);
      return proc;
    };

    const result = await runAgent({
      cwd: workDir,
      taskCwd,
      agents: [makeAgent({ skills: ["test-skill", "missing-skill"] })],
      agentName: "worker",
      task: "Use the skill",
      summary: "Skill load",
      delegationMode: "spawn",
      parentDepth: 0,
      maxDepth: 1,
      makeDetails,
    });

    expect(result.exitCode).toBe(0);
    expect(loadSkillsCwds).toEqual([taskCwd]);
    expect(result.skillLoad?.lookupCwd).toBe(taskCwd);
    expect(result.skillLoad?.requested).toEqual(["test-skill", "missing-skill"]);
    expect(result.skillLoad?.loaded).toEqual(["test-skill"]);
    expect(result.skillLoad?.missing).toEqual(["missing-skill"]);
    expect(result.stderr).toContain("skill preload");
    expect(result.stderr).toContain("Skill not found for agent");
    expect(promptArg).toContain('<skill name="test-skill"');
    expect(promptArg).toContain("Use this skill carefully.");
    expect(promptArg).toContain("Task: Use the skill");
    expect(spawnCalls[0]?.options.cwd).toBe(taskCwd);
  });

  it("creates and cleans temp files for system prompt and fork session", async () => {
    const proc = new MockChildProcess();
    let promptPath: string | undefined;
    let sessionPath: string | undefined;
    let promptContents = "";
    let sessionContents = "";

    spawnImpl = (_command, args) => {
      const piArgs = getPiArgs({ command: "", args, options: {} });
      promptPath = getFlagValue(piArgs, "--append-system-prompt");
      sessionPath = getFlagValue(piArgs, "--session");

      expect(promptPath).toBeDefined();
      expect(sessionPath).toBeDefined();
      expect(fs.existsSync(promptPath!)).toBe(true);
      expect(fs.existsSync(sessionPath!)).toBe(true);

      promptContents = fs.readFileSync(promptPath!, "utf-8");
      sessionContents = fs.readFileSync(sessionPath!, "utf-8");

      setTimeout(() => {
        emitJson(proc, {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "fork run complete" }],
          },
        });
        proc.close(0);
      }, 5);
      return proc;
    };

    const result = await runAgent({
      cwd: workDir,
      agents: [makeAgent({ systemPrompt: "System prompt body" })],
      agentName: "worker",
      task: "Forked task",
      summary: "Fork cleanup",
      delegationMode: "fork",
      forkSessionSnapshotJsonl: '{"type":"session"}\n',
      parentDepth: 0,
      maxDepth: 1,
      makeDetails,
    });

    expect(result.exitCode).toBe(0);
    expect(promptContents).toBe("System prompt body");
    expect(sessionContents).toBe('{"type":"session"}\n');
    expect(fs.existsSync(promptPath!)).toBe(false);
    expect(fs.existsSync(sessionPath!)).toBe(false);
  });

  it("returns aborted when the parent signal cancels the task", async () => {
    const proc = new MockChildProcess();
    proc.onKill = () => {
      setTimeout(() => proc.close(130), 0);
    };

    spawnImpl = () => proc;

    const controller = new AbortController();
    const resultPromise = runAgent({
      cwd: workDir,
      agents: [makeAgent()],
      agentName: "worker",
      task: "Do the thing",
      summary: "Abort case",
      delegationMode: "spawn",
      parentDepth: 0,
      maxDepth: 1,
      signal: controller.signal,
      makeDetails,
    });

    setTimeout(() => controller.abort(), 5);
    const result = await resultPromise;

    expect(result.exitCode).toBe(130);
    expect(result.stopReason).toBe("aborted");
    expect(result.errorMessage).toBe("Task was aborted.");
    expect(proc.killCalls).toContain("SIGTERM");
  });
});

describe("mapConcurrent", () => {
  it("preserves result order and respects the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapConcurrent([40, 10, 25, 5], 2, async (delayMs: number, index: number) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(delayMs);
      active--;
      return `result-${index}`;
    });

    expect(results).toEqual([
      "result-0",
      "result-1",
      "result-2",
      "result-3",
    ]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("returns an empty array when there is no work", async () => {
    const results = await mapConcurrent([], 4, async () => "unused");
    expect(results).toEqual([]);
  });
});
