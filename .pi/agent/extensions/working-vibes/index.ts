import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  generateVibesBatch,
  getVibeFileCount,
  getVibeMode,
  getVibeModel,
  getVibeTheme,
  hasVibeFile,
  initVibeManager,
  onVibeAgentEnd,
  onVibeAgentStart,
  onVibeBeforeAgentStart,
  onVibeToolCall,
  setVibeMode,
  setVibeModel,
  setVibeTheme,
} from "./manager.js";

export default function workingVibesExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    initVibeManager(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    initVibeManager(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!ctx.hasUI) return;
    onVibeBeforeAgentStart(event.prompt, ctx.ui.setWorkingMessage);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      onVibeAgentStart();
      return;
    }

    onVibeAgentStart(ctx.ui.setWorkingMessage);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!ctx.hasUI) return;
    onVibeToolCall(event.toolName, (event.input ?? {}) as Record<string, unknown>, ctx.ui.setWorkingMessage);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    onVibeAgentEnd(ctx.ui.setWorkingMessage);
  });

  pi.registerCommand("vibe", {
    description: "Set working vibe. Usage: /vibe [theme|off|mode|model|generate]",
    handler: async (args, ctx) => {
      const trimmed = args?.trim() ?? "";
      const parts = trimmed ? trimmed.split(/\s+/) : [];
      const sub = parts[0]?.toLowerCase();

      if (!trimmed) {
        const theme = getVibeTheme();
        const mode = getVibeMode();
        const model = getVibeModel();
        let status = `Vibe: ${theme || "off"} | Mode: ${mode} | Model: ${model}`;
        if (theme && mode === "file") {
          const count = getVibeFileCount(theme);
          status += count > 0 ? ` | File: ${count} vibes` : " | File: not found";
        }
        ctx.ui.notify(status, "info");
        return;
      }

      if (sub === "model") {
        const modelSpec = parts.slice(1).join(" ").trim();
        if (!modelSpec) {
          ctx.ui.notify(`Current vibe model: ${getVibeModel()}`, "info");
          return;
        }
        if (!modelSpec.includes("/")) {
          ctx.ui.notify(
            "Invalid model format. Use provider/modelId (e.g., anthropic/claude-haiku-4-5)",
            "error",
          );
          return;
        }
        setVibeModel(modelSpec);
        ctx.ui.notify(`Vibe model set to: ${modelSpec}`, "info");
        return;
      }

      if (sub === "mode") {
        const next = parts[1]?.toLowerCase();
        if (!next) {
          ctx.ui.notify(`Current vibe mode: ${getVibeMode()}`, "info");
          return;
        }
        if (next !== "generate" && next !== "file") {
          ctx.ui.notify("Invalid mode. Use: generate or file", "error");
          return;
        }

        const theme = getVibeTheme();
        if (next === "file" && theme && !hasVibeFile(theme)) {
          ctx.ui.notify(`No vibe file for "${theme}". Run /vibe generate ${theme} first`, "error");
          return;
        }

        setVibeMode(next);
        ctx.ui.notify(`Vibe mode set to: ${next}`, "info");
        return;
      }

      if (sub === "generate") {
        const theme = parts[1];
        const countRaw = parts[2];
        const count = Number.isFinite(Number(countRaw)) ? Number(countRaw) : 100;

        if (!theme) {
          ctx.ui.notify("Usage: /vibe generate <theme> [count]", "error");
          return;
        }

        ctx.ui.notify(`Generating ${count} vibes for "${theme}"...`, "info");
        const result = await generateVibesBatch(theme, count);
        if (result.success) {
          ctx.ui.notify(`Generated ${result.count} vibes for "${theme}" → ${result.filePath}`, "info");
        } else {
          ctx.ui.notify(`Failed to generate vibes: ${result.error ?? "unknown error"}`, "error");
        }
        return;
      }

      if (sub === "off") {
        setVibeTheme(null);
        ctx.ui.notify("Vibe disabled", "info");
        return;
      }

      const theme = trimmed;
      setVibeTheme(theme);
      const mode = getVibeMode();
      if (mode === "file" && !hasVibeFile(theme)) {
        ctx.ui.notify(
          `Vibe set to: ${theme} (file mode, but no file found - run /vibe generate ${theme})`,
          "warning",
        );
      } else {
        ctx.ui.notify(`Vibe set to: ${theme}`, "info");
      }
    },
  });
}
