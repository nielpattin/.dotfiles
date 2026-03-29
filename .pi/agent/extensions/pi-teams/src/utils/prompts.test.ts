import { describe, it, expect } from "vitest";
import {
  buildInboxWakeupMessage,
  buildLeadSystemPrompt,
  buildTeammateSystemPrompt,
} from "./prompts";

describe("prompt builders", () => {
  it("builds teammate prompt with initial assignment outside the inbox", () => {
    const prompt = buildTeammateSystemPrompt("BASE", "alpha", "reviewer", {
      model: "google-gemini-cli/gemini-3.1-pro-preview",
      thinking: "high",
      prompt: "Review the design plan carefully.",
      planModeRequired: true,
    });

    expect(prompt).toContain("You are teammate 'reviewer' on team 'alpha'.");
    expect(prompt).toContain("Your initial assignment is below. Treat it as your starting task. It is startup context, not an inbox message.");
    expect(prompt).toContain("Review the design plan carefully.");
    expect(prompt).toContain("Start by calling read_inbox(team_name=\"alpha\") once");
    expect(prompt).toContain("Plan approval mode is required.");
    expect(prompt).toContain("google-gemini-cli/gemini-3.1-pro-preview");
    expect(prompt).toContain("with thinking level: high");
  });

  it("builds lead prompt with explicit inbox handling instructions", () => {
    const prompt = buildLeadSystemPrompt("BASE", "alpha");

    expect(prompt).toContain("You are the team lead for team 'alpha'.");
    expect(prompt).toContain("call read_inbox({ team_name: 'alpha' }) immediately before responding");
  });

  it("builds consistent lead wakeup messages", () => {
    expect(buildInboxWakeupMessage("alpha", 2)).toBe("You have 2 unread inbox message(s) on team 'alpha'. Call read_inbox({ team_name: 'alpha' }) now, then process those messages.");
  });
});
