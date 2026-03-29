import type { Member } from "./models";

export function buildInboxWakeupMessage(teamName: string, unreadCount: number): string {
  return `You have ${unreadCount} unread inbox message(s) on team '${teamName}'. Call read_inbox({ team_name: '${teamName}' }) now, then process those messages.`;
}

export function buildLeadSystemPrompt(baseSystemPrompt: string, teamName: string): string {
  return `${baseSystemPrompt}\n\nYou are the team lead for team '${teamName}'. When a follow-up says there are unread inbox messages, call read_inbox({ team_name: '${teamName}' }) immediately before responding. Do not assume the inbox has already been read. Use the inbox to consume teammate progress updates, questions, and coordination messages.`;
}

export function buildTeammateSystemPrompt(
  baseSystemPrompt: string,
  teamName: string,
  agentName: string,
  member?: Pick<Member, "model" | "thinking" | "prompt" | "planModeRequired">
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
    ? `\nYour initial assignment is below. Treat it as your starting task. It is startup context, not an inbox message.\n\n${member.prompt}`
    : "";

  const planMode = member?.planModeRequired
    ? "\nPlan approval mode is required. Before implementing changes, submit a plan and wait for approval."
    : "";

  return `${baseSystemPrompt}\n\nYou are teammate '${agentName}' on team '${teamName}'.\nYour lead is 'team-lead'.${modelInfo}${initialAssignment}${planMode}\nStart by calling read_inbox(team_name=\"${teamName}\") once to check for any unread follow-up messages. After that, work from your initial assignment and inbox contents. When you send a progress or completion update to team-lead, end your turn. Do not manually poll with repeated read_inbox calls or sleep loops while waiting. The extension will automatically wake you when new unread inbox messages arrive.`;
}
