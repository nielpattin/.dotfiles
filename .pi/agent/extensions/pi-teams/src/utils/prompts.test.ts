import { describe, it, expect } from "vitest";
import {
  buildInboxWakeupMessage,
  buildLeadSystemPrompt,
  buildTeammateSystemPrompt,
} from "./prompts";

describe("prompt builders", () => {
  it("builds teammate prompt with inbox replay when prior context exists", () => {
    const prompt = buildTeammateSystemPrompt("BASE", "alpha", "reviewer", {
      model: "google-gemini-cli/gemini-3.1-pro-preview",
      thinking: "high",
      prompt: "Review the design plan carefully.",
      planModeRequired: true,
    }, true);

    expect(prompt).toContain("You are teammate 'reviewer' on team 'alpha'.");
    expect(prompt).toContain("Your initial assignment is below. Treat it as your starting task for this session.");
    expect(prompt).toContain("Review the design plan carefully.");
    expect(prompt).toContain("Start this session by replaying prior inbox context once.");
    expect(prompt).toContain("team-lead coordinates the team and represents the active user request.");
    expect(prompt).toContain("Plan approval mode is required.");
    expect(prompt).toContain("google-gemini-cli/gemini-3.1-pro-preview");
    expect(prompt).toContain("with thinking level: high");
  });

  it("builds teammate prompt without inbox replay when no prior context exists", () => {
    const prompt = buildTeammateSystemPrompt("BASE", "alpha", "reviewer", {
      prompt: "Start on the initial task.",
    }, false);

    expect(prompt).toContain("Start this session from your initial assignment.");
    expect(prompt).not.toContain("read_inbox({ team_name: 'alpha', unread_only: false })");
  });

  it("builds lead prompt with explicit inbox handling instructions", () => {
    const prompt = buildLeadSystemPrompt("BASE", "alpha");

    expect(prompt).toContain("You are the team lead for team 'alpha'.");
    expect(prompt).toContain("read the inbox before responding");
    expect(prompt).toContain("turn that into the user-facing response");
  });

  it("builds consistent lead wakeup messages", () => {
    expect(buildInboxWakeupMessage("alpha", 2)).toBe("You have 2 unread inbox message(s) on team 'alpha'. Read your inbox and process those messages.");
  });
});
