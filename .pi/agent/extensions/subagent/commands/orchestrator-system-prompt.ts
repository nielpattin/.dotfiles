import type { AgentConfig } from "../agents/types.js";

export function buildAvailableAgentsPromptSection(agents: AgentConfig[]): string {
  if (agents.length === 0) return "";

  const agentList = agents
    .map((agent) => `- **${agent.name}**: ${agent.description}`)
    .join("\n");

  return `\n\n## Available Task Agents

The following task agents are available via the \`task\` tool:

${agentList}

### Routing policy

- Use **scout** first when scope is unclear: discovery, file finding, context gathering, impact mapping.
- Use **worker** after scope is known: implementation, code edits, and targeted validation.

### How to call the task tool

Each task runs in an **isolated process**.

Use exactly one of these public payload shapes:

\`\`\`json
{ "mode": "single", "operation": { "agent": "agent-name", "summary": "Short task summary", "task": "Detailed task...", "skill": "triage-expert", "delegationMode": "spawn", "background": false } }
\`\`\`

\`\`\`json
{ "mode": "parallel", "operations": [{ "agent": "agent-name", "summary": "Task A", "task": "...", "delegationMode": "fork", "background": true }, { "agent": "other-agent", "summary": "Task B", "task": "..." }] }
\`\`\`

Rules:
- \`mode\` must be \`single\` or \`parallel\`
- \`single\` requires \`operation\` and forbids \`operations\`
- \`parallel\` requires non-empty \`operations\` and forbids \`operation\`
- each operation requires non-empty \`agent\`, \`summary\`, \`task\`
- \`skill\` is optional and singular (string only)
- \`delegationMode\` is optional per operation and must be \`spawn\` or \`fork\` (defaults to \`spawn\`)
- \`background\` is optional per operation (\`boolean\`, defaults to \`false\`)
- payload \`skills\`, \`extension\`, and \`extensions\` are rejected

Use \`/agents\` for per-agent settings like extensions and skills, \`/tasks\` to inspect delegated task sessions, and \`task_result\` for programmatic status/result lookup by child session id.
Background completions are pushed into the originating session, trigger one batched follow-up turn per flush, and default to a single immediate task_result lookup (waitMs: 0) with no auto-polling.
`;
}
