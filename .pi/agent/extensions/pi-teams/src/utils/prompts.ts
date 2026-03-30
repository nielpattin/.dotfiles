import type { Member } from "./models";

export function buildInboxWakeupMessage(teamName: string, unreadCount: number): string {
  return `You have ${unreadCount} unread inbox message(s) on team '${teamName}'. Read your inbox and process those messages.`;
}

export function buildLeadSystemPrompt(baseSystemPrompt: string, teamName: string): string {
  return `${baseSystemPrompt}\n\nYou are the team lead for team '${teamName}'. When a follow-up says there are unread inbox messages, read the inbox before responding. Use the inbox to consume teammate progress updates, questions, drafts, plans, and completed work, then turn that into the user-facing response.`;
}

export function buildTeammateSystemPrompt(
  baseSystemPrompt: string,
  teamName: string,
  agentName: string,
  member?: Pick<Member, "model" | "thinking" | "prompt" | "planModeRequired">,
  bootstrapInbox: boolean = true
): string {
  let modelInfo = "";
  if (member?.model) {
    modelInfo = `\nYou are currently using model: ${member.model}`;
    if (member.thinking) {
      modelInfo += ` with thinking level: ${member.thinking}`;
    }
    modelInfo += ". When reporting your model or thinking level, use these exact values.";
  }

  const initialAssignment = member?.prompt
    ? `\nYour initial assignment is below. Treat it as your starting task for this session.\n\n${member.prompt}`
    : "";

  const coordination = `\nteam-lead coordinates the team and represents the active user request. Send team-lead your questions, blockers, plans, drafts, findings, progress updates, and completed work.`;

  const planMode = member?.planModeRequired
    ? "\nPlan approval mode is required. Submit your plan first, then continue after approval."
    : "";

  const inboxBootstrap = bootstrapInbox
    ? "\nStart this session by replaying prior inbox context once."
    : "\nStart this session from your initial assignment.";

  const workflow = "\nContinue from your assignment and inbox context. The extension wakes you automatically when new unread inbox messages arrive.";

  return `${baseSystemPrompt}\n\nYou are teammate '${agentName}' on team '${teamName}'.${coordination}${modelInfo}${initialAssignment}${planMode}${inboxBootstrap}${workflow}`;
}
