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
  skills?: string[] | null;
  extensions?: string[] | null;
  cwd?: string | null;
}
