/**
 * Subagent process runner.
 *
 * Spawns isolated `pi` processes and streams results back via callbacks.
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AgentConfig } from "./agents/types.js";
import {
  type DelegationMode,
  type SingleResult,
  type SubagentDetails,
  type SkillLoadInfo,
  emptyUsage,
  getFinalOutput,
} from "./types.js";
import { buildPiArgs } from "./runner/args.js";
import { runChildProcess, setFailure } from "./runner/process.js";
import { buildTaskPromptWithAgentSkills, formatSkillLoadSummary } from "./runner/prompt.js";
import { getPiSpawnTarget } from "./runner/spawntarget.js";
import { cleanupTempDir, writeForkSessionToTempFile, writePromptToTempFile } from "./runner/tempfiles.js";

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

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
  /** Call-time skill override. When provided, it replaces frontmatter skills for this run. */
  overrideSkills?: string[];
  /** Optional extension override from local task settings. */
  overrideExtensions?: string[];
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
    overrideSkills,
    overrideExtensions,
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

  if (
    delegationMode === "fork" &&
    (!forkSessionSnapshotJsonl || !forkSessionSnapshotJsonl.trim())
  ) {
    return {
      agent: agentName,
      agentSource: agent.source,
      task,
      summary,
      delegationMode,
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
      failureCategory: "validation",
    };
  }

  const result: SingleResult = {
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

  let promptTmpDir: string | null = null;
  let promptTmpPath: string | null = null;
  if (agent.systemPrompt.trim()) {
    const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
    promptTmpDir = tmp.dir;
    promptTmpPath = tmp.filePath;
  }

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
      overrideSkills,
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
      overrideExtensions,
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
        failureCategory: "startup",
      };
    }

    const runOutput = await runChildProcess({
      spawnTarget,
      cwd: taskCwd ?? cwd,
      parentDepth,
      maxDepth,
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
