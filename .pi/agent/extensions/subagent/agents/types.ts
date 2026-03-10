export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  skills?: string[];
  extensions?: string[];
  cwd?: string;
  model?: string;
  thinking?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

export interface AgentDefaultsUpdate {
  defaultSkills?: string[] | null;
  enabledExtensions?: string[] | null;
  defaultCwd?: string | null;
}
