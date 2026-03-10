import * as fs from "node:fs";
import {
  buildAgentFile,
  normalizeString,
  normalizeStringList,
  parseAgentDocument,
} from "./frontmatter.js";
import type { AgentDefaultsUpdate } from "./types.js";

/**
 * Persist editable task defaults directly in the agent frontmatter.
 */
export function updateAgentDefaultsInFile(
  filePath: string,
  updates: AgentDefaultsUpdate,
): void {
  const parsed = parseAgentDocument(filePath);
  const frontmatter: Record<string, unknown> = { ...parsed.frontmatter };

  if (updates.defaultSkills !== undefined) {
    const normalized = normalizeStringList(updates.defaultSkills);
    delete frontmatter.skill;
    if (!normalized || normalized.length === 0) {
      delete frontmatter.skills;
    } else {
      frontmatter.skills = normalized;
    }
  }

  if (updates.enabledExtensions !== undefined) {
    const normalized = normalizeStringList(updates.enabledExtensions);
    delete frontmatter.enabledExtensions;
    if (!normalized) {
      delete frontmatter.extensions;
    } else {
      frontmatter.extensions = normalized;
    }
  }

  if (updates.defaultCwd !== undefined) {
    const normalized = normalizeString(updates.defaultCwd);
    delete frontmatter.defaultCwd;
    if (!normalized) {
      delete frontmatter.cwd;
    } else {
      frontmatter.cwd = normalized;
    }
  }

  const next = buildAgentFile(frontmatter, parsed.body);
  fs.writeFileSync(filePath, next, "utf-8");
}
