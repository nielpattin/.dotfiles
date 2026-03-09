/**
 * Agent discovery and configuration.
 *
 * Agents are Markdown files with YAML frontmatter that define name, description,
 * optional model/tools/extensions, and a system prompt body.
 *
 * Lookup locations:
 *   - User agents:    ~/.pi/agent/agents/*.md
 *   - Project agents: .pi/agents/*.md  (walks up from cwd)
 */

import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  skills?: string[];
  extensions?: string[];
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function parseListField(
  filePath: string,
  fieldName: "tools" | "skills" | "extensions",
  value: unknown,
): string[] | undefined {
  if (value === undefined) return undefined;

  if (fieldName === "extensions" && value === null) {
    return [];
  }

  let parsed: string[];
  if (typeof value === "string") {
    parsed = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (Array.isArray(value)) {
    parsed = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } else {
    if (fieldName !== "extensions") {
      console.warn(
        `[pi-task] Ignoring invalid ${fieldName} field in "${filePath}". Expected a comma-separated string or string array.`,
      );
    }
    return undefined;
  }

  if (parsed.length === 0) {
    return fieldName === "extensions" ? [] : undefined;
  }

  if (fieldName === "skills" && parsed.length > 1) {
    return [parsed[0]!];
  }

  return parsed;
}

/** Walk up from `cwd` looking for a `.pi/agents` directory. */
function findNearestProjectAgentsDir(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Parse a single agent markdown file into an AgentConfig. Returns null on skip. */
function parseAgentFile(
  filePath: string,
  source: "user" | "project",
): AgentConfig | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter<Record<string, unknown>>(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[pi-task] Skipping invalid agent file "${filePath}": ${message}`,
    );
    return null;
  }

  const frontmatter = parsed.frontmatter ?? {};
  const body = parsed.body ?? "";

  const name =
    typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : "";
  if (!name || !description) return null;

  if (
    typeof frontmatter.extensions === "string"
    && frontmatter.extensions.trim() === ""
  ) {
    delete frontmatter.extensions;
  }

  const tools = parseListField(filePath, "tools", frontmatter.tools);
  const skills = parseListField(filePath, "skills", frontmatter.skills);
  const extensions = parseListField(
    filePath,
    "extensions",
    frontmatter.extensions,
  );

  return {
    name,
    description,
    tools,
    skills,
    extensions,
    model:
      typeof frontmatter.model === "string" ? frontmatter.model : undefined,
    thinking:
      typeof frontmatter.thinking === "string"
        ? frontmatter.thinking
        : undefined,
    systemPrompt: body,
    source,
    filePath,
  };
}

/** Load all agent definitions from a directory. */
function loadAgentsFromDir(
  dir: string,
  source: "user" | "project",
): AgentConfig[] {
  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const agent = parseAgentFile(path.join(dir, entry.name), source);
    if (agent) agents.push(agent);
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all available agents according to the requested scope.
 *
 * When scope is "both", project agents override user agents with the same name.
 */
export function discoverAgents(
  cwd: string,
  scope: AgentScope,
): AgentDiscoveryResult {
  const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents =
    scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents =
    scope === "user" || !projectAgentsDir
      ? []
      : loadAgentsFromDir(projectAgentsDir, "project");

  // Deduplicate by name; project agents win in "both" mode.
  const agentMap = new Map<string, AgentConfig>();
  for (const agent of userAgents) agentMap.set(agent.name, agent);
  if (scope !== "user") {
    for (const agent of projectAgents) agentMap.set(agent.name, agent);
  }

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
