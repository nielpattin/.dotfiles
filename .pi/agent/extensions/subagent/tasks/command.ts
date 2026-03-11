import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { TasksPanel } from "./panel.js";
import type { TaskStore } from "../ui/taskstore.js";

type TasksCommandContext = Pick<ExtensionCommandContext, "hasUI" | "ui">;

export async function openTasksPanel(ctx: TasksCommandContext, store: TaskStore): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/tasks requires interactive UI.", "error");
    return;
  }

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => new TasksPanel(tui, theme, store, () => done()),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 136,
        maxHeight: 52,
        margin: 1,
      },
    },
  );
}

export function registerTasksCommand(pi: ExtensionAPI, store: TaskStore): void {
  pi.registerCommand("tasks", {
    description: "Inspect delegated subagent tasks and open detailed task views.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await openTasksPanel(ctx, store);
    },
  });
}
