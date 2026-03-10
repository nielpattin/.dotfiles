import type { AgentConfig } from "../agents/types.js";
import type { DelegationMode } from "../types.js";

export function buildPiArgs(
  agent: AgentConfig,
  systemPromptPath: string | null,
  prompt: string,
  delegationMode: DelegationMode,
  forkSessionPath: string | null,
  thinkingLevel: string | undefined,
  overrideExtensions?: string[],
): string[] {
  const args: string[] = ["--mode", "json", "-p"];

  if (delegationMode === "spawn") {
    args.push("--no-session");
  } else if (forkSessionPath) {
    args.push("--session", forkSessionPath);
  }

  if (agent.model) args.push("--model", agent.model);
  if (thinkingLevel) args.push("--thinking", thinkingLevel);
  if (agent.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  const effectiveExtensions = overrideExtensions ?? agent.extensions;
  if (effectiveExtensions !== undefined) {
    args.push("--no-extensions");
    for (const extension of effectiveExtensions) {
      args.push("-e", extension);
    }
  }

  if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
  args.push(prompt);
  return args;
}
