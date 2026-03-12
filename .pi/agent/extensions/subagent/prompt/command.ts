import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

export type StableSessionIdResolver = (ctx: {
  sessionManager?: { getSessionId?: () => string | undefined; getSessionFile?: () => string | undefined };
}) => string | undefined;

export const SUBAGENT_ORCHESTRATOR_PROMPT_SECTION = [
  "## Subagent Orchestration",
  "You're orchestrator you delegated task to worker and scout to do the task",
].join("\n");

export const SUBAGENT_ORCHESTRATOR_STATUS_KEY = "subagent-orchestrator";

export interface SessionPromptToggleState {
  isEnabled(sessionId: string | undefined): boolean;
  toggle(sessionId: string): boolean;
}

export function createSessionPromptToggleState(): SessionPromptToggleState {
  const enabledSessions = new Set<string>();

  return {
    isEnabled(sessionId: string | undefined): boolean {
      if (!sessionId) return false;
      return enabledSessions.has(sessionId);
    },
    toggle(sessionId: string): boolean {
      if (!sessionId) return false;
      const next = !enabledSessions.has(sessionId);
      if (next) enabledSessions.add(sessionId);
      else enabledSessions.delete(sessionId);
      return next;
    },
  };
}

export function setOrchestratorFooterStatus(
  ctx: Pick<ExtensionCommandContext, "ui"> | Pick<ExtensionContext, "ui" | "hasUI">,
  enabled: boolean,
): void {
  const maybeContext = ctx as { hasUI?: boolean; ui?: { setStatus?: (key: string, value: string | undefined) => void; theme?: { fg?: (token: string, text: string) => string } } };
  if (maybeContext.hasUI === false) return;
  const ui = maybeContext.ui;
  if (!ui || typeof ui.setStatus !== "function") return;

  const text = enabled ? "Orchestrator: ON" : "Orchestrator: OFF";
  const rendered = typeof ui.theme?.fg === "function"
    ? ui.theme.fg("accent", text)
    : text;

  ui.setStatus(SUBAGENT_ORCHESTRATOR_STATUS_KEY, rendered);
}

export function registerSubagentPromptCommand(
  pi: ExtensionAPI,
  state: SessionPromptToggleState,
  resolveSessionId: StableSessionIdResolver,
): void {
  pi.registerCommand("toggle-orchestrator", {
    description: "Toggle the in-memory orchestrator system prompt for the current session.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const sessionId = resolveSessionId(ctx);
      if (!sessionId) {
        ctx.ui.notify("Could not resolve a stable session id for /toggle-orchestrator.", "warning");
        return;
      }

      const next = state.toggle(sessionId);
      setOrchestratorFooterStatus(ctx, next);
    },
  });
}
