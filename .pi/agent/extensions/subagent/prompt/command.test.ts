import { describe, expect, it } from "vitest";
import {
  createSessionPromptToggleState,
  registerSubagentPromptCommand,
  SUBAGENT_ORCHESTRATOR_PROMPT_SECTION,
  SUBAGENT_ORCHESTRATOR_STATUS_KEY,
} from "./command.js";

describe("session prompt toggle state", () => {
  it("toggles enabled state per session id", () => {
    const state = createSessionPromptToggleState();

    expect(state.isEnabled("session-a")).toBe(false);
    expect(state.toggle("session-a")).toBe(true);
    expect(state.isEnabled("session-a")).toBe(true);

    expect(state.isEnabled("session-b")).toBe(false);
    expect(state.toggle("session-a")).toBe(false);
    expect(state.isEnabled("session-a")).toBe(false);
  });
});

describe("/toggle-orchestrator command", () => {
  it("registers the renamed command", () => {
    const state = createSessionPromptToggleState();

    let commandName: string | undefined;
    const pi = {
      registerCommand: (name: string, _command: { handler: (args: string, ctx: any) => Promise<void> }) => {
        commandName = name;
      },
    } as any;

    registerSubagentPromptCommand(
      pi,
      state,
      (ctx) => ctx.sessionManager?.getSessionId?.() ?? ctx.sessionManager?.getSessionFile?.(),
    );

    expect(commandName).toBe("toggle-orchestrator");
  });

  it("always toggles current session and updates footer status", async () => {
    const state = createSessionPromptToggleState();

    let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
    const pi = {
      registerCommand: (_name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
        handler = command.handler;
      },
    } as any;

    registerSubagentPromptCommand(
      pi,
      state,
      (ctx) => ctx.sessionManager?.getSessionId?.() ?? ctx.sessionManager?.getSessionFile?.(),
    );

    const notifications: Array<{ text: string; level: string }> = [];
    const statuses: Array<{ key: string; value: string | undefined }> = [];
    const ctx = {
      sessionManager: { getSessionId: () => "session-a" },
      ui: {
        notify: (text: string, level: string) => notifications.push({ text, level }),
        setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
        theme: { fg: (_token: string, text: string) => text },
      },
    };

    expect(handler).toBeTypeOf("function");

    await handler!("", ctx);
    expect(state.isEnabled("session-a")).toBe(true);
    expect(statuses.at(-1)).toEqual({
      key: SUBAGENT_ORCHESTRATOR_STATUS_KEY,
      value: "Orchestrator: ON",
    });

    await handler!("status", ctx);
    expect(state.isEnabled("session-a")).toBe(false);
    expect(statuses.at(-1)).toEqual({
      key: SUBAGENT_ORCHESTRATOR_STATUS_KEY,
      value: "Orchestrator: OFF",
    });

    expect(notifications).toHaveLength(0);
  });

  it("warns when stable session id cannot be resolved", async () => {
    const state = createSessionPromptToggleState();

    let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
    const pi = {
      registerCommand: (_name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
        handler = command.handler;
      },
    } as any;

    registerSubagentPromptCommand(pi, state, () => undefined);

    const notifications: Array<{ text: string; level: string }> = [];
    await handler!("", {
      ui: {
        notify: (text: string, level: string) => notifications.push({ text, level }),
      },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.level).toBe("warning");
    expect(notifications[0]?.text).toContain("/toggle-orchestrator");
  });
});

describe("orchestrator prompt section", () => {
  it("contains the required orchestrator instruction", () => {
    expect(SUBAGENT_ORCHESTRATOR_PROMPT_SECTION).toContain(
      "You're orchestrator you delegated task to worker and scout to do the task",
    );
  });
});
