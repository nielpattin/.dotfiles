import { describe, expect, it, vi } from "vitest";
import {
  createExtension,
  makeCtx,
  makeProjectExtensionsFixture,
  setupIndexTests,
  state,
} from "./harness.ts";

setupIndexTests();

describe("task settings command", () => {
  it("writes selected default skills to the agent frontmatter", async () => {
    state.availableSkills = [{ name: "triage-expert", source: "user" }];

    const { command } = createExtension();
    const custom = vi.fn(async () => ({
      action: "save",
      agentName: "worker",
      field: "skills",
      value: "triage-expert, frontend-design",
    }));
    const ctx = makeCtx({
      hasUI: true,
      ui: {
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
        custom,
        setWidget: vi.fn(),
      },
    });

    await command.handler("", ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(state.updateDefaultsCalls).toEqual([
      {
        filePath: "/tmp/worker.md",
        updates: { defaultSkills: ["triage-expert", "frontend-design"] },
      },
    ]);
  });

  it("clears default skills when picker returns blank", async () => {
    const { command } = createExtension();
    const ctx = makeCtx({
      hasUI: true,
      ui: {
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
        custom: vi.fn(async () => ({
          action: "save",
          agentName: "worker",
          field: "skills",
          value: "",
        })),
        setWidget: vi.fn(),
      },
    });

    await command.handler("", ctx);

    expect(state.updateDefaultsCalls).toEqual([
      {
        filePath: "/tmp/worker.md",
        updates: { defaultSkills: null },
      },
    ]);
  });

  it("keeps selected discovered skill visible while navigating long lists", async () => {
    state.availableSkills = Array.from({ length: 18 }, (_item, index) => ({
      name: `skill-${String(index + 1).padStart(2, "0")}`,
      source: "user",
      description: `skill description ${index + 1}`,
    }));

    const { command } = createExtension();
    const custom = vi.fn(async (factory: any) => {
      const tui = { requestRender: vi.fn() };
      const theme = {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      };

      const component = factory(tui, theme, {}, () => undefined);
      component.handleInput("\r");
      component.handleInput("\r");

      for (let i = 0; i < 12; i += 1) {
        component.handleInput("\u001b[B");
      }

      const panelText = component.render(92).join("\n");
      expect(panelText).toContain("▶ [ ] skill-13");
      expect(panelText).toContain("13/21");
      expect(panelText).not.toContain("skill-01");

      return { action: "cancel" };
    });

    const ctx = makeCtx({
      hasUI: true,
      ui: {
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
        custom,
        setWidget: vi.fn(),
      },
    });

    await command.handler("", ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(state.updateDefaultsCalls).toHaveLength(0);
  });

  it("re-scrolls upward when moving back up from a scrolled skill list", async () => {
    state.availableSkills = Array.from({ length: 18 }, (_item, index) => ({
      name: `skill-${String(index + 1).padStart(2, "0")}`,
      source: "user",
    }));

    const { command } = createExtension();
    const custom = vi.fn(async (factory: any) => {
      const component = factory(
        { requestRender: vi.fn() },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        () => undefined,
      );

      component.handleInput("\r");
      component.handleInput("\r");

      for (let i = 0; i < 12; i += 1) component.handleInput("\u001b[B");
      for (let i = 0; i < 5; i += 1) component.handleInput("\u001b[A");

      const panelText = component.render(92).join("\n");
      expect(panelText).toContain("▶ [ ] skill-08");
      expect(panelText).toContain("8/21");
      expect(panelText).toContain("showing 8-13");

      return { action: "cancel" };
    });

    await command.handler("", makeCtx({
      hasUI: true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true), custom, setWidget: vi.fn() },
    }));

    expect(custom).toHaveBeenCalledTimes(1);
  });

  it("supports page/home/end-style jumps in the picker", async () => {
    state.availableSkills = Array.from({ length: 18 }, (_item, index) => ({
      name: `skill-${String(index + 1).padStart(2, "0")}`,
      source: "user",
    }));

    const { command } = createExtension();
    const custom = vi.fn(async (factory: any) => {
      const component = factory(
        { requestRender: vi.fn() },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        () => undefined,
      );

      component.handleInput("\r");
      component.handleInput("\r");
      component.handleInput("\u0006"); // ctrl+f (pagedown fallback)
      component.handleInput("\u0005"); // ctrl+e (end fallback)

      let panelText = component.render(92).join("\n");
      expect(panelText).toContain("▶ Back");
      expect(panelText).toContain("21/21");

      component.handleInput("\u0001"); // ctrl+a (home fallback)
      panelText = component.render(92).join("\n");
      expect(panelText).toContain("▶ [ ] skill-01");
      expect(panelText).toContain("1/21");

      return { action: "cancel" };
    });

    await command.handler("", makeCtx({
      hasUI: true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true), custom, setWidget: vi.fn() },
    }));

    expect(custom).toHaveBeenCalledTimes(1);
  });

  it("toggles selections while scrolled and saves selected skills", async () => {
    state.availableSkills = Array.from({ length: 18 }, (_item, index) => ({
      name: `skill-${String(index + 1).padStart(2, "0")}`,
      source: "user",
    }));

    const { command } = createExtension();
    const done = vi.fn();
    const custom = vi.fn(async (factory: any) => {
      const component = factory(
        { requestRender: vi.fn() },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        done,
      );

      component.handleInput("\r");
      component.handleInput("\r");
      for (let i = 0; i < 9; i += 1) component.handleInput("\u001b[B");
      component.handleInput(" ");
      component.handleInput("\r");

      expect(done).toHaveBeenCalledWith({
        action: "save",
        agentName: "worker",
        field: "skills",
        value: "skill-10",
      });

      return { action: "cancel" };
    });

    await command.handler("", makeCtx({
      hasUI: true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true), custom, setWidget: vi.fn() },
    }));
  });

  it("does not clear skills when no discovered skills exist and Enter is pressed", async () => {
    state.availableSkills = [];

    const { command } = createExtension();
    const done = vi.fn();
    const custom = vi.fn(async (factory: any) => {
      const component = factory(
        { requestRender: vi.fn() },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        done,
      );

      component.handleInput("\r");
      component.handleInput("\r");
      component.handleInput("\r");

      expect(done).not.toHaveBeenCalled();
      expect(component.render(92).join("\n")).toContain("Value:");

      return { action: "cancel" };
    });

    await command.handler("", makeCtx({
      hasUI: true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true), custom, setWidget: vi.fn() },
    }));
    expect(state.updateDefaultsCalls).toHaveLength(0);
  });

  it("does not show cwd in the action list", async () => {
    const { command } = createExtension();
    const custom = vi.fn(async (factory: any) => {
      const component = factory(
        { requestRender: vi.fn() },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        () => undefined,
      );

      component.handleInput("\r");
      const panelText = component.render(92).join("\n");

      expect(panelText).toContain("Default skills:");
      expect(panelText).toContain("Enabled extensions:");
      expect(panelText).not.toContain("Default cwd:");

      return { action: "cancel" };
    });

    await command.handler("", makeCtx({
      hasUI: true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true), custom, setWidget: vi.fn() },
    }));

    expect(custom).toHaveBeenCalledTimes(1);
  });

  it("uses discovered extensions as a selectable picker and saves selections", async () => {
    const fixture = makeProjectExtensionsFixture(["alpha-ext", "beta-ext"]);
    const { command } = createExtension();
    const done = vi.fn();

    try {
      const custom = vi.fn(async (factory: any) => {
        const component = factory(
          { requestRender: vi.fn() },
          { fg: (_color: string, text: string) => text, bold: (text: string) => text },
          {},
          done,
        );

        component.handleInput("\r");
        component.handleInput("\u001b[B");
        component.handleInput("\r");

        const pickerText = component.render(92).join("\n");
        const selectedMatch = pickerText.match(/▶ \[[ x]\] ([^│\n]+)/);
        const selectedExtension = selectedMatch?.[1]?.trim();
        expect(selectedExtension).toBeTruthy();

        component.handleInput(" ");
        component.handleInput("\r");

        expect(done).toHaveBeenCalledWith({
          action: "save",
          agentName: "worker",
          field: "extensions",
          value: selectedExtension,
          extensionMode: "set",
        });

        return { action: "cancel" };
      });

      await command.handler("", makeCtx({
        cwd: fixture.cwd,
        hasUI: true,
        ui: { notify: vi.fn(), confirm: vi.fn(async () => true), custom, setWidget: vi.fn() },
      }));

      expect(custom).toHaveBeenCalledTimes(1);
    } finally {
      fixture.cleanup();
    }
  });

  it("supports extension none mode to persist an empty frontmatter list", async () => {
    const { command } = createExtension();
    const ctx = makeCtx({
      hasUI: true,
      ui: {
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
        custom: vi.fn(async () => ({
          action: "save",
          agentName: "worker",
          field: "extensions",
          value: "",
          extensionMode: "none",
        })),
        setWidget: vi.fn(),
      },
    });

    await command.handler("", ctx);

    expect(state.updateDefaultsCalls).toEqual([
      {
        filePath: "/tmp/worker.md",
        updates: { enabledExtensions: [] },
      },
    ]);
  });

  it("writes extension defaults from /task-config panel inputs", async () => {
    const { command } = createExtension();
    const ctx = makeCtx({
      hasUI: true,
      ui: {
        notify: vi.fn(),
        confirm: vi.fn(async () => true),
        custom: vi.fn(async () => ({
          action: "save",
          agentName: "worker",
          field: "extensions",
          value: "rtk, read-map",
        })),
        setWidget: vi.fn(),
      },
    });

    await command.handler("", ctx);

    expect(state.updateDefaultsCalls).toEqual([
      {
        filePath: "/tmp/worker.md",
        updates: { enabledExtensions: ["rtk", "read-map"] },
      },
    ]);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Saved task settings for worker.", "info");
  });
});
