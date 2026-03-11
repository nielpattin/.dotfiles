import type { AgentConfig } from "../agents/types.js";
import { DEFAULT_DELEGATION_MODE, type DelegationMode, type SingleResult, type SubagentDetails } from "../types.js";
import { executeParallel, type TaskExecutionOperation } from "./parallel.js";
import { buildForkSessionSnapshotJsonl, type SessionSnapshotSource } from "./snapshot.js";
import { type PublicOperation } from "./schema.js";

function getRequestedProjectAgents(
  agents: AgentConfig[],
  requestedNames: Set<string>,
): AgentConfig[] {
  return Array.from(requestedNames)
    .map((name) => agents.find((a) => a.name === name))
    .filter((a): a is AgentConfig => a?.source === "project");
}

async function confirmProjectAgentsIfNeeded(
  projectAgents: AgentConfig[],
  projectAgentsDir: string | null,
  ctx: { ui: { confirm: (title: string, body: string) => Promise<boolean> } },
): Promise<boolean> {
  if (projectAgents.length === 0) return true;

  const names = projectAgents.map((a) => a.name).join(", ");
  const dir = projectAgentsDir ?? "(unknown)";
  return ctx.ui.confirm(
    "Run project-local agents?",
    `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
  );
}

function mapOperationsWithAgentDefaults(
  operations: PublicOperation[],
  agents: AgentConfig[],
): TaskExecutionOperation[] {
  return operations.map((operation) => {
    const agentConfig = agents.find((candidate) => candidate.name === operation.agent);
    const overrideSkills = operation.skill ? [operation.skill] : agentConfig?.skills;
    return {
      agent: operation.agent,
      task: operation.task,
      summary: operation.summary,
      cwd: operation.cwd ?? agentConfig?.cwd,
      overrideSkills,
      extensions: agentConfig?.extensions,
      delegationMode: operation.delegationMode ?? DEFAULT_DELEGATION_MODE,
    };
  });
}

export interface ExecuteTaskToolParams {
  toolCallId: string;
  operations: PublicOperation[];
  agents: AgentConfig[];
  projectAgentsDir: string | null;
  baseCwd: string;
  inheritedThinking: string;
  signal?: AbortSignal;
  onUpdate?: (partial: any) => void;
  ctx: {
    hasUI: boolean;
    ui: {
      confirm: (title: string, body: string) => Promise<boolean>;
      setWidget?: (...args: any[]) => void;
    };
    sessionManager?: SessionSnapshotSource;
  };
  makeDetails: (results: SingleResult[]) => SubagentDetails;
  maxParallelTasks: number;
  concurrency: number;
  currentDepth: number;
  maxDepth: number;
  upsertDelegatedRun: (
    key: string,
    partial: {
      agent: string;
      summary: string;
      state: "queued" | "running" | "success" | "error" | "aborted";
      startedAt?: number;
      updatedAt?: number;
      finishedAt?: number;
      activity?: string;
      error?: string;
    },
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
  ) => void;
  syncDelegatedRunWithResult: (
    key: string,
    fallbackAgent: string,
    fallbackSummary: string,
    result: SingleResult,
    ctx: { hasUI: boolean; ui?: { setWidget?: (...args: any[]) => void } },
  ) => void;
  upsertTask: (
    taskId: string,
    partial: {
      agent: string;
      summary: string;
      task: string;
      status: "queued" | "running" | "success" | "error" | "aborted";
      delegationMode?: DelegationMode;
      startedAt?: number;
      updatedAt?: number;
      finishedAt?: number;
      sessionId?: string;
      provider?: string;
      model?: string;
      error?: string;
    },
  ) => void;
  syncTaskWithResult: (
    taskId: string,
    fallback: {
      agent: string;
      summary: string;
      task: string;
      delegationMode: DelegationMode;
    },
    result: SingleResult,
  ) => void;
}

export async function executeTaskTool(params: ExecuteTaskToolParams) {
  const {
    toolCallId,
    operations,
    agents,
    projectAgentsDir,
    baseCwd,
    inheritedThinking,
    signal,
    onUpdate,
    ctx,
    makeDetails,
    maxParallelTasks,
    concurrency,
    currentDepth,
    maxDepth,
    upsertDelegatedRun,
    syncDelegatedRunWithResult,
    upsertTask,
    syncTaskWithResult,
  } = params;

  const tasks = mapOperationsWithAgentDefaults(operations, agents);

  const requested = new Set<string>();
  for (const operation of tasks) requested.add(operation.agent);

  const requestedProjectAgents = getRequestedProjectAgents(agents, requested);
  if (requestedProjectAgents.length > 0) {
    if (ctx.hasUI) {
      const approved = await confirmProjectAgentsIfNeeded(
        requestedProjectAgents,
        projectAgentsDir,
        ctx,
      );
      if (!approved) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Canceled: project-local agents not approved.",
            },
          ],
          details: makeDetails([]),
        };
      }
    } else {
      const names = requestedProjectAgents.map((a) => a.name).join(", ");
      const dir = projectAgentsDir ?? "(unknown)";
      return {
        content: [
          {
            type: "text" as const,
            text: `Blocked: project-local agent confirmation is required in non-UI mode.\nAgents: ${names}\nSource: ${dir}`,
          },
        ],
        details: makeDetails([]),
        isError: true,
      };
    }
  }

  const forkSessionSnapshotJsonl = tasks.some((operation) => operation.delegationMode === "fork")
    ? buildForkSessionSnapshotJsonl(ctx.sessionManager)
    : undefined;

  return executeParallel({
    toolCallId,
    tasks,
    inheritedThinking,
    agents,
    baseCwd,
    forkSessionSnapshotJsonl,
    signal,
    onUpdate,
    ctx,
    makeDetails,
    maxParallelTasks,
    concurrency,
    currentDepth,
    maxDepth,
    upsertDelegatedRun,
    syncDelegatedRunWithResult,
    upsertTask,
    syncTaskWithResult,
  });
}
