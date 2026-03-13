import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../agents/types.js";
import { discoverAgents } from "../agents/discover.js";
import {
  SUBAGENT_BACKGROUND_COMPLETION_TYPE,
  SUBAGENT_BACKGROUND_STATUS_TYPE,
} from "../constants.js";
import {
  buildBackgroundCompletionControlMessage,
  buildVisibleBackgroundCompletionLine,
  createBackgroundCompletionInbox,
  type BackgroundCompletionEvent,
} from "../task-tools/background-completion.js";
import {
  type SessionPromptToggleState,
  setOrchestratorFooterStatus,
} from "./orchestrator-prompt-state.js";
import type { TaskStore } from "./task-store.js";
import type { DelegatedRunsWidgetContext } from "../ui/delegated-runs-widget.js";

interface SessionManagerLike {
  getSessionId?: () => string | undefined;
  getSessionFile?: () => string | undefined;
  getBranch?: () => unknown[];
}

interface SessionContextLike {
  cwd: string;
  hasUI?: boolean;
  ui?: { notify: (message: string, level?: "info" | "warning" | "error") => void };
  sessionManager?: SessionManagerLike;
}

interface SessionRuntimeOptions {
  pi: ExtensionAPI;
  canDelegate: boolean;
  taskStore: TaskStore;
  delegatedRunsWidget: {
    handleSessionStart: (ctx: DelegatedRunsWidgetContext) => void;
    handleSessionShutdown: () => void;
  };
  sessionPromptToggleState: SessionPromptToggleState;
}

const COMPLETION_DEDUP_TTL_MS = 10 * 60 * 1000;

export function resolveStableSessionId(ctx: { sessionManager?: SessionManagerLike }): string | undefined {
  const manager = ctx.sessionManager;
  const byId = manager?.getSessionId?.();
  if (typeof byId === "string" && byId.trim()) return byId.trim();
  const byFile = manager?.getSessionFile?.();
  if (typeof byFile === "string" && byFile.trim()) return byFile.trim();
  return undefined;
}

export function createSessionRuntime(options: SessionRuntimeOptions) {
  const {
    pi,
    canDelegate,
    taskStore,
    delegatedRunsWidget,
    sessionPromptToggleState,
  } = options;

  let discoveredAgents: AgentConfig[] = [];
  let currentSessionId: string | undefined;
  const backgroundInbox = createBackgroundCompletionInbox();
  const deliveredCompletionKeys = new Map<string, number>();
  const sessionsWithScheduledCompletionFlush = new Set<string>();

  const markCompletionDelivered = (event: BackgroundCompletionEvent): boolean => {
    const now = Date.now();
    for (const [key, ts] of deliveredCompletionKeys.entries()) {
      if (now - ts > COMPLETION_DEDUP_TTL_MS) deliveredCompletionKeys.delete(key);
    }

    const key = `${event.originSessionId}:${event.sessionId}:${event.finishedAt}:${event.status}`;
    if (deliveredCompletionKeys.has(key)) return false;
    deliveredCompletionKeys.set(key, now);
    return true;
  };

  const pushCompletionTurnBatch = (events: BackgroundCompletionEvent[]): void => {
    if (events.length === 0) return;

    for (const event of events) {
      pi.sendMessage({
        customType: SUBAGENT_BACKGROUND_STATUS_TYPE,
        content: buildVisibleBackgroundCompletionLine(event),
        display: true,
      });
    }

    pi.sendMessage(
      {
        customType: SUBAGENT_BACKGROUND_COMPLETION_TYPE,
        content: buildBackgroundCompletionControlMessage(events),
        display: false,
      },
      { triggerTurn: true },
    );
  };

  const flushCompletionInboxForSession = (sessionId: string | undefined) => {
    if (!sessionId) return;

    const completions = backgroundInbox.drainSession(sessionId);
    const undelivered = completions
      .filter((completion) => completion.originSessionId === sessionId)
      .filter((completion) => markCompletionDelivered(completion));

    if (undelivered.length === 0) return;
    pushCompletionTurnBatch(undelivered);
  };

  const scheduleCompletionInboxFlushForSession = (sessionId: string | undefined) => {
    if (!sessionId || sessionsWithScheduledCompletionFlush.has(sessionId)) return;

    sessionsWithScheduledCompletionFlush.add(sessionId);
    queueMicrotask(() => {
      sessionsWithScheduledCompletionFlush.delete(sessionId);
      flushCompletionInboxForSession(sessionId);
    });
  };

  const hydrateTasksFromCurrentBranch = (ctx: SessionContextLike) => {
    taskStore.setParentSessionFile(ctx.sessionManager?.getSessionFile?.());
    const branchEntries = ctx.sessionManager?.getBranch?.();
    if (Array.isArray(branchEntries)) {
      taskStore.hydrateFromBranch(branchEntries);
    } else {
      taskStore.clear();
    }
  };

  const refreshDiscoveredAgents = (cwd: string): AgentConfig[] => {
    const discovery = discoverAgents(cwd, "both");
    discoveredAgents = discovery.agents;
    return discoveredAgents;
  };

  const handleSessionStartOrSwitch = (ctx: SessionContextLike, notify: boolean) => {
    if (!canDelegate) return;

    currentSessionId = resolveStableSessionId(ctx);
    setOrchestratorFooterStatus(ctx as any, sessionPromptToggleState.isEnabled(currentSessionId));
    hydrateTasksFromCurrentBranch(ctx);
    delegatedRunsWidget.handleSessionStart(ctx as DelegatedRunsWidgetContext);
    flushCompletionInboxForSession(currentSessionId);

    const agents = refreshDiscoveredAgents(ctx.cwd);
    if (notify && agents.length > 0 && ctx.hasUI && ctx.ui) {
      const list = agents.map((agent) => `  - ${agent.name} (${agent.source})`).join("\n");
      ctx.ui.notify(`Found ${agents.length} task agent(s):\n${list}`, "info");
    }
  };

  return {
    register() {
      pi.on("session_start", async (_event, ctx) => {
        handleSessionStartOrSwitch(ctx as SessionContextLike, true);
      });

      pi.on("session_switch", async (_event, ctx) => {
        handleSessionStartOrSwitch(ctx as SessionContextLike, false);
      });

      pi.on("session_shutdown", async (_event, ctx) => {
        currentSessionId = undefined;
        setOrchestratorFooterStatus(ctx as any, false);
        taskStore.clear();
        delegatedRunsWidget.handleSessionShutdown();
      });
    },

    refreshDiscoveredAgents,

    getDiscoveredAgents(): AgentConfig[] {
      return discoveredAgents;
    },

    enqueueBackgroundCompletion(event: BackgroundCompletionEvent): void {
      if (!event.originSessionId) return;
      backgroundInbox.enqueue(event);
      if (currentSessionId && event.originSessionId === currentSessionId) {
        scheduleCompletionInboxFlushForSession(currentSessionId);
      }
    },
  };
}
