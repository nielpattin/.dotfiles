import { type SingleResult, getFailureCategory, getFinalOutput } from "../types.js";

type WidgetRunState = "queued" | "running" | "success" | "error" | "aborted";

interface DelegatedRunWidgetItem {
  key: string;
  agent: string;
  summary: string;
  state: WidgetRunState;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  activity?: string;
  error?: string;
}

export interface DelegatedRunsWidgetContext {
  hasUI: boolean;
  ui?: { setWidget?: (...args: any[]) => void };
}

const SUBAGENT_RUNS_WIDGET_ID = "subagent-runs";
const SUBAGENT_RUNS_WIDGET_MAX_ROWS = 8;
const SUBAGENT_RUNS_WIDGET_MAX_LINE_LENGTH = 84;
const SUBAGENT_RUNS_WIDGET_LINGER_MS = 5_000;

function shortenInline(text: string, max = SUBAGENT_RUNS_WIDGET_MAX_LINE_LENGTH): string {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function toWidgetRunState(result: SingleResult): WidgetRunState {
  if (result.exitCode === -1) return "running";
  const failureCategory = getFailureCategory(result);
  if (failureCategory === "abort") return "aborted";
  if (failureCategory) return "error";
  return "success";
}

function getWidgetStateIcon(state: WidgetRunState): string {
  if (state === "running") return "▶";
  if (state === "queued") return "○";
  if (state === "success") return "✓";
  if (state === "aborted") return "⏹";
  return "✕";
}

function pickRunActivity(result: SingleResult): string | undefined {
  if (result.activeTool?.name) return `tool: ${result.activeTool.name}`;
  if (result.lastTool?.name) return `last: ${result.lastTool.name}`;
  const output = getFinalOutput(result.messages);
  if (output) return shortenInline(output, 44);
  if (result.errorMessage) return shortenInline(result.errorMessage, 44);
  if (result.stderr) return shortenInline(result.stderr, 44);
  return undefined;
}

export function createDelegatedRunsWidget() {
  const delegatedRuns = new Map<string, DelegatedRunWidgetItem>();
  let widgetFailed = false;
  let widgetLingerTimer: NodeJS.Timeout | undefined;
  let latestWidgetCtx: DelegatedRunsWidgetContext | undefined;

  const clearWidgetLingerTimer = () => {
    if (widgetLingerTimer) {
      clearTimeout(widgetLingerTimer);
      widgetLingerTimer = undefined;
    }
  };

  const clearExpiredDelegatedRuns = (now = Date.now()) => {
    for (const [key, run] of delegatedRuns.entries()) {
      if (!run.finishedAt) continue;
      if (now - run.finishedAt > SUBAGENT_RUNS_WIDGET_LINGER_MS) {
        delegatedRuns.delete(key);
      }
    }
  };

  const sortDelegatedRuns = (runs: DelegatedRunWidgetItem[]): DelegatedRunWidgetItem[] => {
    const rank = (state: WidgetRunState): number => {
      if (state === "running") return 0;
      if (state === "queued") return 1;
      return 2;
    };
    return [...runs].sort((a, b) => {
      const rankDiff = rank(a.state) - rank(b.state);
      if (rankDiff !== 0) return rankDiff;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  };

  const buildDelegatedRunsWidgetLines = (now = Date.now()): string[] => {
    const visibleRuns = sortDelegatedRuns(
      [...delegatedRuns.values()].filter((run) =>
        run.state === "running"
        || run.state === "queued"
        || (run.finishedAt !== undefined && now - run.finishedAt <= SUBAGENT_RUNS_WIDGET_LINGER_MS)
      ),
    );
    if (visibleRuns.length === 0) return [];

    const running = visibleRuns.filter((run) => run.state === "running").length;
    const queued = visibleRuns.filter((run) => run.state === "queued").length;
    const recent = visibleRuns.length - running - queued;

    const lines = [
      `Subagent runs: ${running} running · ${queued} queued · ${recent} recent`,
    ];

    const shownRuns = visibleRuns.slice(0, SUBAGENT_RUNS_WIDGET_MAX_ROWS);
    for (const run of shownRuns) {
      const status = `${getWidgetStateIcon(run.state)} ${run.agent}: ${run.summary}`;
      const detail = run.error || run.activity;
      lines.push(
        shortenInline(detail ? `${status} — ${detail}` : status),
      );
    }

    const hiddenCount = visibleRuns.length - shownRuns.length;
    if (hiddenCount > 0) {
      lines.push(`… ${hiddenCount} more`);
    }

    return lines.slice(0, 10);
  };

  const render = (ctxOverride?: DelegatedRunsWidgetContext) => {
    if (widgetFailed) return;
    const ctx = ctxOverride ?? latestWidgetCtx;
    if (!ctx?.hasUI) return;
    if (typeof ctx.ui?.setWidget !== "function") return;

    latestWidgetCtx = ctx;
    const now = Date.now();
    clearExpiredDelegatedRuns(now);
    const lines = buildDelegatedRunsWidgetLines(now);

    try {
      if (lines.length === 0) {
        ctx.ui.setWidget(SUBAGENT_RUNS_WIDGET_ID, undefined);
      } else {
        ctx.ui.setWidget(
          SUBAGENT_RUNS_WIDGET_ID,
          lines,
          { placement: "aboveEditor" },
        );
      }
    } catch (error) {
      widgetFailed = true;
      clearWidgetLingerTimer();
      console.warn(`[pi-task] Failed to render subagent widget: ${String(error)}`);
      return;
    }

    clearWidgetLingerTimer();
    const expirations = [...delegatedRuns.values()]
      .filter((run) => run.finishedAt !== undefined)
      .map((run) => (run.finishedAt as number) + SUBAGENT_RUNS_WIDGET_LINGER_MS - now)
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b);

    const nextExpiration = expirations[0];
    if (nextExpiration !== undefined) {
      widgetLingerTimer = setTimeout(() => {
        render();
      }, nextExpiration + 5);
    }
  };

  const upsertRun = (
    key: string,
    partial: Partial<DelegatedRunWidgetItem> & Pick<DelegatedRunWidgetItem, "agent" | "summary" | "state">,
    ctx: DelegatedRunsWidgetContext,
  ) => {
    const now = Date.now();
    const existing = delegatedRuns.get(key);
    const next: DelegatedRunWidgetItem = {
      key,
      agent: partial.agent,
      summary: partial.summary,
      state: partial.state,
      startedAt: partial.startedAt ?? existing?.startedAt ?? now,
      updatedAt: partial.updatedAt ?? now,
      finishedAt: partial.finishedAt ?? existing?.finishedAt,
      activity: partial.activity ?? existing?.activity,
      error: partial.error ?? existing?.error,
    };
    if (next.state === "running" || next.state === "queued") {
      next.finishedAt = undefined;
      if (next.state === "running") next.error = undefined;
    } else if (!next.finishedAt) {
      next.finishedAt = now;
    }

    delegatedRuns.set(key, next);
    render(ctx);
  };

  const syncRunWithResult = (
    key: string,
    fallbackAgent: string,
    fallbackSummary: string,
    result: SingleResult,
    ctx: DelegatedRunsWidgetContext,
  ) => {
    const state = toWidgetRunState(result);
    const now = Date.now();
    upsertRun(
      key,
      {
        agent: result.agent || fallbackAgent,
        summary: result.summary || fallbackSummary,
        state,
        startedAt: result.startedAt,
        updatedAt: result.updatedAt || now,
        finishedAt: state === "running" ? undefined : (result.updatedAt || now),
        activity: pickRunActivity(result),
        error:
          state === "error" || state === "aborted"
            ? shortenInline(result.errorMessage || result.stderr || result.stopReason || state, 44)
            : undefined,
      },
      ctx,
    );
  };

  const handleSessionStart = (ctx: DelegatedRunsWidgetContext) => {
    delegatedRuns.clear();
    widgetFailed = false;
    clearWidgetLingerTimer();
    latestWidgetCtx = ctx.hasUI ? ctx : undefined;
    render(ctx);
  };

  const handleSessionShutdown = () => {
    delegatedRuns.clear();
    clearWidgetLingerTimer();
    if (!widgetFailed && latestWidgetCtx?.hasUI && typeof latestWidgetCtx.ui?.setWidget === "function") {
      try {
        latestWidgetCtx.ui.setWidget(SUBAGENT_RUNS_WIDGET_ID, undefined);
      } catch {
        widgetFailed = true;
      }
    }
    latestWidgetCtx = undefined;
  };

  return {
    upsertRun,
    syncRunWithResult,
    handleSessionStart,
    handleSessionShutdown,
  };
}
