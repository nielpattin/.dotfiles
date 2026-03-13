import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  type SessionPromptToggleState,
  setOrchestratorFooterStatus,
} from "../state/orchestrator-prompt-state.js";

export type StableSessionIdResolver = (ctx: {
  sessionManager?: { getSessionId?: () => string | undefined; getSessionFile?: () => string | undefined };
}) => string | undefined;

export const SUBAGENT_ORCHESTRATOR_PROMPT_SECTION = [
  "## Subagent Orchestration",
  "Route work by role:",
  "- Use scout first for unknown codebase areas, discovery, file finding, and impact analysis.",
  "- Use worker after scope and target files are known for implementation, edits, and targeted validation.",
].join("\n");

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
