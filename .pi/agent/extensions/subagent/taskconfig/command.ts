import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { discoverAgents } from "../agents/discover.js";
import { updateAgentDefaultsInFile } from "../agents/update.js";
import { discoverExtensionsForTaskConfig } from "./extensions.js";
import { discoverSkillsForTaskConfig } from "./skills.js";
import { TaskConfigPanel, type TaskConfigPanelResult } from "./panel.js";

type AgentsCommandContext = Pick<ExtensionCommandContext, "cwd" | "hasUI" | "ui">;

function splitCommaInput(value: string): string[] {
  return Array.from(new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

export async function openAgentsPanel(
  ctx: AgentsCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/agents requires interactive UI.", "error");
    return;
  }

  const { agents } = discoverAgents(ctx.cwd, "both");
  if (agents.length === 0) {
    ctx.ui.notify("No agents available to configure.", "warning");
    return;
  }

  const availableSkills = discoverSkillsForTaskConfig(ctx.cwd);
  const availableExtensions = discoverExtensionsForTaskConfig(ctx.cwd);

  const result = await ctx.ui.custom<TaskConfigPanelResult>(
    (tui, theme, _keybindings, done) =>
      new TaskConfigPanel(tui, theme, agents, availableSkills, availableExtensions, done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 92,
        maxHeight: 20,
        margin: 1,
      },
    },
  );

  if (!result || result.action === "cancel") return;

  const selectedAgent = agents.find((agent) => agent.name === result.agentName);
  if (!selectedAgent) {
    ctx.ui.notify(`Could not find agent ${result.agentName}.`, "error");
    return;
  }

  if (result.action === "clear") {
    updateAgentDefaultsInFile(selectedAgent.filePath, {
      defaultSkills: null,
      enabledExtensions: null,
    });
    ctx.ui.notify(`Cleared agent settings for ${result.agentName}.`, "info");
    return;
  }

  const normalized = result.value.trim();
  if (result.field === "skills") {
    updateAgentDefaultsInFile(selectedAgent.filePath, {
      defaultSkills: normalized ? splitCommaInput(result.value) : null,
    });
  } else {
    const enabledExtensions = result.extensionMode === "inherit"
      ? null
      : result.extensionMode === "none"
        ? []
        : normalized
          ? splitCommaInput(result.value)
          : null;

    updateAgentDefaultsInFile(selectedAgent.filePath, {
      enabledExtensions,
    });
  }

  ctx.ui.notify(`Saved agent settings for ${result.agentName}.`, "info");
}

export function registerAgentsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("agents", {
    description: "Configure per-agent defaults (skills, extensions).",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await openAgentsPanel(ctx);
    },
  });
}
