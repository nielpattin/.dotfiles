/**
 * Subagent process runner.
 *
 * Spawns isolated `pi` processes and streams results back via callbacks.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadSkills, stripFrontmatter } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "./agents.js";
import {
  type DelegationMode,
  type SingleResult,
  type SubagentDetails,
  type SkillLoadInfo,
  emptyUsage,
  getFinalOutput,
} from "./types.js";

const SIGKILL_TIMEOUT_MS = 5000;
const TASK_DEPTH_ENV = "PI_TASK_DEPTH";
const TASK_MAX_DEPTH_ENV = "PI_TASK_MAX_DEPTH";
const PI_OFFLINE_ENV = "PI_OFFLINE";

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

const require = createRequire(import.meta.url);

interface SpawnTarget {
  command: string;
  args: string[];
}

function isRunnableNodeScript(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  return /\.(?:mjs|cjs|js)$/i.test(filePath);
}

function findPackageJsonFromEntry(entryPath: string): string | null {
  let dir = path.dirname(path.resolve(entryPath));

  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
          name?: string;
        };
        if (pkg.name === "@mariozechner/pi-coding-agent") {
          return pkgPath;
        }
      } catch {
        // ignore parse/read issues and keep walking up
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveWindowsPiCliScript(): string | null {
  const argvEntry = process.argv[1];
  if (argvEntry) {
    const candidate = path.resolve(argvEntry);
    if (isRunnableNodeScript(candidate)) return candidate;

    const fromArgvPackage = findPackageJsonFromEntry(candidate);
    if (fromArgvPackage) {
      try {
        const pkg = JSON.parse(fs.readFileSync(fromArgvPackage, "utf-8")) as {
          bin?: string | Record<string, string>;
        };
        const binField = pkg.bin;
        const binPath =
          typeof binField === "string"
            ? binField
            : binField?.pi ?? Object.values(binField ?? {})[0];
        if (binPath) {
          const binCandidate = path.resolve(path.dirname(fromArgvPackage), binPath);
          if (isRunnableNodeScript(binCandidate)) return binCandidate;
        }
      } catch {
        // ignore and continue to package-based resolution
      }
    }
  }

  try {
    const entry = require.resolve("@mariozechner/pi-coding-agent");
    const packageJsonPath = findPackageJsonFromEntry(entry);
    if (!packageJsonPath) return null;

    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    ) as {
      bin?: string | Record<string, string>;
    };

    const binField = packageJson.bin;
    const binPath =
      typeof binField === "string"
        ? binField
        : binField?.pi ?? Object.values(binField ?? {})[0];

    if (!binPath) return null;

    const candidate = path.resolve(path.dirname(packageJsonPath), binPath);
    if (isRunnableNodeScript(candidate)) return candidate;
  } catch {
    return null;
  }

  return null;
}

function getPiSpawnTarget(piArgs: string[]): SpawnTarget | null {
  if (process.platform === "win32") {
    const scriptPath = resolveWindowsPiCliScript();
    if (!scriptPath) return null;

    return {
      command: process.execPath,
      args: [scriptPath, ...piArgs],
    };
  }

  return { command: "pi", args: piArgs };
}

function buildSkillBlock(skillName: string, skillPath: string, baseDir: string, body: string): string {
  return `<skill name="${skillName}" location="${skillPath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
}

interface TaskPromptBuildResult {
  prompt: string;
  warnings: string[];
  requestedSkills: string[];
  loadedSkills: string[];
  missingSkills: string[];
}

function buildTaskPromptWithAgentSkills(
  task: string,
  agent: AgentConfig,
  skillCwd: string,
): TaskPromptBuildResult {
  const skillNames = agent.skills?.filter(Boolean) ?? [];
  if (skillNames.length === 0) {
    return {
      prompt: `Task: ${task}`,
      warnings: [],
      requestedSkills: [],
      loadedSkills: [],
      missingSkills: [],
    };
  }

  const loaded = loadSkills({ cwd: skillCwd });
  const skillByName = new Map(loaded.skills.map((s) => [s.name, s] as const));
  const warnings: string[] = [];
  const blocks: string[] = [];
  const loadedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (const requestedName of skillNames) {
    const skill = skillByName.get(requestedName);
    if (!skill) {
      missingSkills.push(requestedName);
      warnings.push(`Skill not found for agent \"${agent.name}\": ${requestedName}`);
      continue;
    }

    try {
      const content = fs.readFileSync(skill.filePath, "utf-8");
      const body = stripFrontmatter(content).trim();
      if (!body) {
        warnings.push(`Skill has empty body: ${skill.filePath}`);
        missingSkills.push(requestedName);
        continue;
      }

      blocks.push(buildSkillBlock(skill.name, skill.filePath, skill.baseDir, body));
      loadedSkills.push(skill.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to load skill \"${requestedName}\": ${message}`);
      missingSkills.push(requestedName);
    }
  }

  if (blocks.length === 0) {
    return {
      prompt: `Task: ${task}`,
      warnings,
      requestedSkills: skillNames,
      loadedSkills,
      missingSkills,
    };
  }

  return {
    prompt: `${blocks.join("\n\n")}\n\nTask: ${task}`,
    warnings,
    requestedSkills: skillNames,
    loadedSkills,
    missingSkills,
  };
}

function formatSkillLoadSummary(skillLoad: SkillLoadInfo): string {
  const requested =
    skillLoad.requested.length > 0
      ? skillLoad.requested.join(", ")
      : "(none)";
  const loaded =
    skillLoad.loaded.length > 0 ? skillLoad.loaded.join(", ") : "(none)";
  const missing =
    skillLoad.missing.length > 0 ? skillLoad.missing.join(", ") : "(none)";

  return `[pi-task] skill preload cwd="${skillLoad.lookupCwd}" requested=[${requested}] loaded=[${loaded}] missing=[${missing}]`;
}

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

function writePromptToTempFile(
  agentName: string,
  prompt: string,
): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

function writeForkSessionToTempFile(
  agentName: string,
  sessionJsonl: string,
): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `fork-${safeName}.jsonl`);
  fs.writeFileSync(filePath, sessionJsonl, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

function cleanupTempDir(dir: string | null): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// JSON-line stream processing
// ---------------------------------------------------------------------------

function processJsonLine(line: string, result: SingleResult): boolean {
  if (!line.trim()) return false;

  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }

  const now = Date.now();
  result.updatedAt = now;

  if (event.type === "session") {
    if (typeof event.id === "string") result.sessionId = event.id;
    if (typeof event.name === "string" && event.name.trim()) {
      result.sessionName = event.name.trim();
    }
    return true;
  }

  if (event.type === "tool_execution_start") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    const toolName = typeof event.toolName === "string" ? event.toolName : null;
    const toolArgs =
      typeof event.args === "object" && event.args !== null
        ? (event.args as Record<string, unknown>)
        : {};

    if (toolName) {
      result.activeTool = {
        toolCallId,
        name: toolName,
        args: toolArgs,
        startedAt: now,
      };

      const alreadySeen = result.messages.some((msg: any) => {
        if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) {
          return false;
        }
        return msg.content.some((part: any) => {
          if (!part || part.type !== "toolCall") return false;
          if (toolCallId && typeof part.id === "string") {
            return part.id === toolCallId;
          }
          return part.name === toolName;
        });
      });

      if (!alreadySeen) {
        const syntheticToolCall = {
          type: "toolCall",
          ...(toolCallId ? { id: toolCallId } : {}),
          name: toolName,
          arguments: toolArgs,
        };

        result.messages.push({
          role: "assistant",
          content: [syntheticToolCall],
          timestamp: now,
        } as unknown as Message);
      }
      return true;
    }
  }

  if (event.type === "tool_execution_end") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
    const activeTool = result.activeTool;

    if (activeTool) {
      const sameCall = toolCallId && activeTool.toolCallId === toolCallId;
      const sameName = toolName && activeTool.name === toolName;
      if (sameCall || sameName || (!toolCallId && !toolName)) {
        result.lastTool = {
          ...activeTool,
          finishedAt: now,
        };
        result.activeTool = undefined;
        return true;
      }
    }

    if (toolName) {
      result.lastTool = {
        toolCallId,
        name: toolName,
        args:
          typeof event.args === "object" && event.args !== null
            ? (event.args as Record<string, unknown>)
            : {},
        startedAt: now,
        finishedAt: now,
      };
      return true;
    }
  }

  if (event.type === "message_end" && event.message) {
    const msg = event.message as Message;
    result.messages.push(msg);

    if (msg.role === "assistant") {
      result.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        result.usage.input += usage.input || 0;
        result.usage.output += usage.output || 0;
        result.usage.cacheRead += usage.cacheRead || 0;
        result.usage.cacheWrite += usage.cacheWrite || 0;
        result.usage.cost += usage.cost?.total || 0;
        result.usage.contextTokens = usage.totalTokens || 0;
      }
      if (!result.model && msg.model) result.model = msg.model;
      if (!result.provider && typeof (msg as any).provider === "string") {
        result.provider = (msg as any).provider;
      }
      if (msg.stopReason) result.stopReason = msg.stopReason;
      if (msg.errorMessage) result.errorMessage = msg.errorMessage;
    }
    return true;
  }

  if (event.type === "tool_result_end" && event.message) {
    result.messages.push(event.message as Message);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Build pi CLI arguments
// ---------------------------------------------------------------------------

function buildPiArgs(
  agent: AgentConfig,
  systemPromptPath: string | null,
  prompt: string,
  delegationMode: DelegationMode,
  forkSessionPath: string | null,
  thinkingLevel: string | undefined,
): string[] {
  const args: string[] = ["--mode", "json", "-p"];

  if (delegationMode === "spawn") {
    args.push("--no-session");
  } else if (forkSessionPath) {
    args.push("--session", forkSessionPath);
  }

  if (agent.model) args.push("--model", agent.model);
  if (thinkingLevel) args.push("--thinking", thinkingLevel);
  if (agent.tools && agent.tools.length > 0)
    args.push("--tools", agent.tools.join(","));
  if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
  args.push(prompt);
  return args;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunAgentOptions {
  /** Base working directory when the task doesn't specify one. */
  cwd: string;
  /** All available agent configs. */
  agents: AgentConfig[];
  /** Name of the agent to run. */
  agentName: string;
  /** Task description. */
  task: string;
  /** Compact display summary for the UI card header. */
  summary: string;
  /** Optional override working directory. */
  taskCwd?: string;
  /** Context mode: spawn (fresh) or fork (session snapshot + task). */
  delegationMode: DelegationMode;
  /** Effective thinking level inherited from the parent session when the agent file omits it. */
  inheritedThinking?: string;
  /** Serialized parent session snapshot used when delegationMode is "fork". */
  forkSessionSnapshotJsonl?: string;
  /** Current delegation depth of the caller process. */
  parentDepth: number;
  /** Maximum allowed delegation depth to propagate to child processes. */
  maxDepth: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Streaming update callback. */
  onUpdate?: OnUpdateCallback;
  /** Factory to wrap results into SubagentDetails. */
  makeDetails: (results: SingleResult[]) => SubagentDetails;
}

/**
 * Spawn a single subagent process and collect its results.
 *
 * Returns a SingleResult even on failure (exitCode > 0, stderr populated).
 */
export async function runAgent(opts: RunAgentOptions): Promise<SingleResult> {
  const {
    cwd,
    agents,
    agentName,
    task,
    summary,
    taskCwd,
    delegationMode,
    inheritedThinking,
    forkSessionSnapshotJsonl,
    parentDepth,
    maxDepth,
    signal,
    onUpdate,
    makeDetails,
  } = opts;

  const now = Date.now();
  const agent = agents.find((a) => a.name === agentName);
  const effectiveThinking = agent?.thinking ?? inheritedThinking;
  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      summary,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: emptyUsage(),
      startedAt: now,
      updatedAt: now,
    };
  }

  if (
    delegationMode === "fork" &&
    (!forkSessionSnapshotJsonl || !forkSessionSnapshotJsonl.trim())
  ) {
    return {
      agent: agentName,
      agentSource: agent.source,
      task,
      summary,
      exitCode: 1,
      messages: [],
      stderr:
        "Cannot run in fork mode: missing parent session snapshot context.",
      usage: emptyUsage(),
      startedAt: now,
      updatedAt: now,
      model: agent.model,
      thinking: effectiveThinking,
      stopReason: "error",
      errorMessage:
        "Cannot run in fork mode: missing parent session snapshot context.",
    };
  }

  const result: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    summary,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    startedAt: now,
    updatedAt: now,
    model: agent.model,
    thinking: effectiveThinking,
  };

  const emitUpdate = () => {
    onUpdate?.({
      content: [
        {
          type: "text",
          text: getFinalOutput(result.messages) || "(running...)",
        },
      ],
      details: makeDetails([result]),
    });
  };

  // Write system prompt to temp file if needed
  let promptTmpDir: string | null = null;
  let promptTmpPath: string | null = null;
  if (agent.systemPrompt.trim()) {
    const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
    promptTmpDir = tmp.dir;
    promptTmpPath = tmp.filePath;
  }

  // Write forked session snapshot if needed
  let forkSessionTmpDir: string | null = null;
  let forkSessionTmpPath: string | null = null;
  if (delegationMode === "fork" && forkSessionSnapshotJsonl) {
    const tmp = writeForkSessionToTempFile(agent.name, forkSessionSnapshotJsonl);
    forkSessionTmpDir = tmp.dir;
    forkSessionTmpPath = tmp.filePath;
  }

  try {
    const taskPrompt = buildTaskPromptWithAgentSkills(
      task,
      agent,
      taskCwd ?? cwd,
    );

    const skillLoad: SkillLoadInfo | undefined =
      taskPrompt.requestedSkills.length > 0
        ? {
            lookupCwd: taskCwd ?? cwd,
            requested: taskPrompt.requestedSkills,
            loaded: taskPrompt.loadedSkills,
            missing: taskPrompt.missingSkills,
            warnings: taskPrompt.warnings,
          }
        : undefined;

    if (skillLoad) {
      result.skillLoad = skillLoad;
      result.stderr += `${formatSkillLoadSummary(skillLoad)}\n`;
    }
    if (taskPrompt.warnings.length > 0) {
      result.stderr += `${taskPrompt.warnings.join("\n")}\n`;
    }

    const piArgs = buildPiArgs(
      agent,
      promptTmpPath,
      taskPrompt.prompt,
      delegationMode,
      forkSessionTmpPath,
      effectiveThinking,
    );
    const spawnTarget = getPiSpawnTarget(piArgs);
    if (!spawnTarget) {
      return {
        ...result,
        exitCode: 1,
        stopReason: "error",
        errorMessage:
          "Failed to resolve Pi CLI script on Windows. Cannot start task.",
        stderr:
          "Failed to resolve Pi CLI script on Windows. Cannot start task.",
      };
    }

    let wasAborted = false;

    const runPromise = new Promise<number>((resolve) => {
      const nextDepth = Math.max(0, Math.floor(parentDepth)) + 1;
      const propagatedMaxDepth = Math.max(0, Math.floor(maxDepth));
      const proc = spawn(spawnTarget.command, spawnTarget.args, {
        cwd: taskCwd ?? cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          [TASK_DEPTH_ENV]: String(nextDepth),
          [TASK_MAX_DEPTH_ENV]: String(propagatedMaxDepth),
          [PI_OFFLINE_ENV]: "1",
        },
      });

      let buffer = "";

      const flushLine = (line: string) => {
        if (processJsonLine(line, result)) emitUpdate();
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) flushLine(line);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        result.updatedAt = Date.now();
        result.stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        result.updatedAt = Date.now();
        if (buffer.trim()) flushLine(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", (err) => {
        result.updatedAt = Date.now();
        const message = err instanceof Error ? err.message : String(err);
        if (!result.stderr.includes(message)) {
          result.stderr += `Spawn error: ${message}\n`;
        }
        result.stopReason = "error";
        result.errorMessage = `Failed to start task process (${spawnTarget.command}).`;
        resolve(1);
      });

      // Abort handling
      if (signal) {
        const kill = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, SIGKILL_TIMEOUT_MS);
        };
        if (signal.aborted) kill();
        else signal.addEventListener("abort", kill, { once: true });
      }
    });

    const exitCode = await runPromise;

    result.exitCode = exitCode;
    result.updatedAt = Date.now();
    if (wasAborted) {
      result.exitCode = 130;
      result.stopReason = "aborted";
      result.errorMessage = "Task was aborted.";
      if (!result.stderr.trim()) result.stderr = "Task was aborted.";
    }
    return result;
  } finally {
    cleanupTempDir(promptTmpDir);
    cleanupTempDir(forkSessionTmpDir);
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

/**
 * Map over items with a bounded number of concurrent workers.
 */
export async function mapConcurrent<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
