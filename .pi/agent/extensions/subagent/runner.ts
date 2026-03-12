/**
 * Subagent process runner.
 *
 * Spawns isolated `pi` processes and streams results back via callbacks.
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AgentConfig } from "./agents/types.js";
import { SUBAGENT_FALLBACK_TEXT } from "./constants.js";
import {
  type SingleResult,
  type SubagentDetails,
  type SkillLoadInfo,
  emptyUsage,
  getFinalOutput,
} from "./types.js";
import type { SessionSnapshot } from "./tasktool/snapshot.js";
import { deriveTaskDirectory, deriveTaskSessionPath } from "./ui/taskfiles.js";
import { buildPiArgs } from "./runner/args.js";
import { runChildProcess, setFailure } from "./runner/process.js";
import { buildTaskPromptWithAgentSkills, formatSkillLoadSummary } from "./runner/prompt.js";
import { getPiSpawnTarget } from "./runner/spawntarget.js";
import {
  buildForkSnapshotPrompt,
  cleanupTempDir,
  initializeForkChildSessionFile,
  initializeSpawnChildSessionFile,
  writePromptToTempFile,
} from "./runner/tempfiles.js";

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

function toLightweightResult(result: SingleResult): SingleResult {
  return {
    ...result,
    messages: [],
    activeTool: undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunAgentOptions {
  /** Base working directory when the task doesn't specify one. */
  cwd: string;
  /** All available agent configs. */
  agents: AgentConfig[];
  /** Canonical child session id used by /tasks and task_result lookup. */
  sessionId?: string;
  /** Task id for sibling grouping in /tasks navigation. */
  taskId?: string;
  siblingIndex?: number;
  /** Name of the agent to run. */
  agentName: string;
  /** Task description. */
  task: string;
  /** Compact display summary for the UI card header. */
  summary: string;
  /** Optional override working directory. */
  taskCwd?: string;
  /** Effective thinking level inherited from the parent session when the agent file omits it. */
  inheritedThinking?: string;
  /** Call-time skill override. When provided, it replaces frontmatter skills for this run. */
  overrideSkills?: string[];
  /** Optional extension override from local task settings. */
  overrideExtensions?: string[];
  /** Parent session file path used to derive durable delegated task files. */
  parentSessionFile?: string;
  /** Parent session snapshot used when running in fork mode. */
  forkSessionSnapshot?: SessionSnapshot;
  /** Current delegation depth of the caller process. */
  parentDepth: number;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Streaming update callback. */
  onUpdate?: OnUpdateCallback;
  /** Factory to wrap results into SubagentDetails. */
  makeDetails: (results: SingleResult[]) => SubagentDetails;
  /** Delegation mode for the child run. */
  delegationMode: "spawn" | "fork";
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
    sessionId,
    taskId,
    siblingIndex,
    agentName,
    task,
    summary,
    taskCwd,
    delegationMode,
    inheritedThinking,
    overrideSkills,
    overrideExtensions,
    parentSessionFile,
    forkSessionSnapshot,
    parentDepth,
    signal,
    onUpdate,
    makeDetails,
  } = opts;

  const now = Date.now();
  const agent = agents.find((a) => a.name === agentName);
  const effectiveThinking = agent?.thinking ?? inheritedThinking;
  const canonicalSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      sessionId: canonicalSessionId || undefined,
      taskId,
      siblingIndex,
      agent: agentName,
      agentSource: "unknown",
      task,
      summary,
      delegationMode,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: emptyUsage(),
      startedAt: now,
      updatedAt: now,
      failureCategory: "validation",
    };
  }

  if (!parentSessionFile || !parentSessionFile.trim()) {
    return {
      sessionId: canonicalSessionId || undefined,
      taskId,
      siblingIndex,
      agent: agentName,
      agentSource: agent.source,
      task,
      summary,
      delegationMode,
      exitCode: 1,
      messages: [],
      stderr: "Cannot run delegated task: missing parent session file.",
      usage: emptyUsage(),
      startedAt: now,
      updatedAt: now,
      model: agent.model,
      thinking: effectiveThinking,
      stopReason: "error",
      errorMessage: "Cannot run delegated task: missing parent session file.",
      failureCategory: "validation",
    };
  }

  if (!canonicalSessionId) {
    return {
      sessionId: undefined,
      taskId,
      siblingIndex,
      agent: agentName,
      agentSource: agent.source,
      task,
      summary,
      delegationMode,
      exitCode: 1,
      messages: [],
      stderr: "Cannot run delegated task: missing child session id.",
      usage: emptyUsage(),
      startedAt: now,
      updatedAt: now,
      model: agent.model,
      thinking: effectiveThinking,
      stopReason: "error",
      errorMessage: "Cannot run delegated task: missing child session id.",
      failureCategory: "validation",
    };
  }

  if (delegationMode === "fork" && !forkSessionSnapshot) {
    return {
      sessionId: canonicalSessionId,
      taskId,
      siblingIndex,
      agent: agentName,
      agentSource: agent.source,
      task,
      summary,
      delegationMode,
      exitCode: 1,
      messages: [],
      stderr: "Cannot run in fork mode: missing parent session snapshot context.",
      usage: emptyUsage(),
      startedAt: now,
      updatedAt: now,
      model: agent.model,
      thinking: effectiveThinking,
      stopReason: "error",
      errorMessage: "Cannot run in fork mode: missing parent session snapshot context.",
      failureCategory: "validation",
    };
  }

  const childSessionDir = deriveTaskDirectory(parentSessionFile);
  const childSessionFile = deriveTaskSessionPath(parentSessionFile, canonicalSessionId);

  const result: SingleResult = {
    sessionId: canonicalSessionId,
    taskId,
    siblingIndex,
    agent: agentName,
    agentSource: agent.source,
    task,
    summary,
    delegationMode,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    startedAt: now,
    updatedAt: now,
    model: agent.model,
    thinking: effectiveThinking,
    sessionFile: childSessionFile,
  };

  if (delegationMode === "fork") {
    initializeForkChildSessionFile(childSessionFile);
  } else {
    initializeSpawnChildSessionFile(childSessionFile);
  }

  const emitUpdate = () => {
    onUpdate?.({
      content: [
        {
          type: "text",
          text: getFinalOutput(result.messages) || SUBAGENT_FALLBACK_TEXT.running,
        },
      ],
      details: makeDetails([toLightweightResult(result)]),
    });
  };

  let promptTmpDir: string | null = null;
  let promptTmpPath: string | null = null;
  if (agent.systemPrompt.trim()) {
    const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
    promptTmpDir = tmp.dir;
    promptTmpPath = tmp.filePath;
  }

  try {
    const taskPrompt = buildTaskPromptWithAgentSkills(
      task,
      agent,
      taskCwd ?? cwd,
      overrideSkills,
    );

    const effectivePrompt = delegationMode === "fork" && forkSessionSnapshot
      ? `${buildForkSnapshotPrompt(forkSessionSnapshot)}\n\n${taskPrompt.prompt}`
      : taskPrompt.prompt;

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
      effectivePrompt,
      childSessionFile,
      childSessionDir,
      effectiveThinking,
      overrideExtensions,
    );
    const spawnTarget = getPiSpawnTarget(piArgs);
    if (!spawnTarget) {
      return {
        ...result,
        exitCode: 1,
        stopReason: "error",
        errorMessage: "Failed to resolve Pi CLI script on Windows. Cannot start task.",
        stderr: "Failed to resolve Pi CLI script on Windows. Cannot start task.",
        failureCategory: "startup",
      };
    }

    const runOutput = await runChildProcess({
      spawnTarget,
      cwd: taskCwd ?? cwd,
      parentDepth,
      signal,
      result,
      emitUpdate,
    });

    result.exitCode = runOutput.exitCode;
    result.updatedAt = Date.now();
    if (runOutput.wasAborted) {
      result.exitCode = 130;
      setFailure(result, "abort", "Task was aborted.");
    } else if (!result.failureCategory && result.stopReason === "aborted") {
      setFailure(result, "abort", result.errorMessage || "Task was aborted.");
    } else if (!result.failureCategory && (result.stopReason === "error" || result.exitCode > 0)) {
      setFailure(result, "runtime");
    }
    return result;
  } finally {
    cleanupTempDir(promptTmpDir);
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
