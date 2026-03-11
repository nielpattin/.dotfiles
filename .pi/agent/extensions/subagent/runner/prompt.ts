import * as fs from "node:fs";
import { loadSkills, stripFrontmatter } from "@mariozechner/pi-coding-agent";
import { SUBAGENT_LOG_PREFIX } from "../constants.js";
import type { AgentConfig } from "../agents/types.js";
import type { SkillLoadInfo } from "../types.js";

function buildSkillBlock(skillName: string, skillPath: string, baseDir: string, body: string): string {
  return `<skill name="${skillName}" location="${skillPath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
}

export interface TaskPromptBuildResult {
  prompt: string;
  warnings: string[];
  requestedSkills: string[];
  loadedSkills: string[];
  missingSkills: string[];
}

export function buildTaskPromptWithAgentSkills(
  task: string,
  agent: AgentConfig,
  skillCwd: string,
  overrideSkills?: string[],
): TaskPromptBuildResult {
  const skillNames = (overrideSkills ?? agent.skills ?? []).filter(Boolean);
  if (skillNames.length === 0) {
    return {
      prompt: `Task: ${task}`,
      warnings: [],
      requestedSkills: [],
      loadedSkills: [],
      missingSkills: [],
    };
  }

  const loaded = loadSkills({ cwd: skillCwd });
  const skillByName = new Map(loaded.skills.map((s) => [s.name, s] as const));
  const warnings: string[] = [];
  const blocks: string[] = [];
  const loadedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (const requestedName of skillNames) {
    const skill = skillByName.get(requestedName);
    if (!skill) {
      missingSkills.push(requestedName);
      warnings.push(`Skill not found for agent \"${agent.name}\": ${requestedName}`);
      continue;
    }

    try {
      const content = fs.readFileSync(skill.filePath, "utf-8");
      const body = stripFrontmatter(content).trim();
      if (!body) {
        warnings.push(`Skill has empty body: ${skill.filePath}`);
        missingSkills.push(requestedName);
        continue;
      }

      blocks.push(buildSkillBlock(skill.name, skill.filePath, skill.baseDir, body));
      loadedSkills.push(skill.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to load skill \"${requestedName}\": ${message}`);
      missingSkills.push(requestedName);
    }
  }

  if (blocks.length === 0) {
    return {
      prompt: `Task: ${task}`,
      warnings,
      requestedSkills: skillNames,
      loadedSkills,
      missingSkills,
    };
  }

  return {
    prompt: `${blocks.join("\n\n")}\n\nTask: ${task}`,
    warnings,
    requestedSkills: skillNames,
    loadedSkills,
    missingSkills,
  };
}

export function formatSkillLoadSummary(skillLoad: SkillLoadInfo): string {
  const requested =
    skillLoad.requested.length > 0
      ? skillLoad.requested.join(", ")
      : "(none)";
  const loaded =
    skillLoad.loaded.length > 0 ? skillLoad.loaded.join(", ") : "(none)";
  const missing =
    skillLoad.missing.length > 0 ? skillLoad.missing.join(", ") : "(none)";

  return `${SUBAGENT_LOG_PREFIX} skill preload cwd="${skillLoad.lookupCwd}" requested=[${requested}] loaded=[${loaded}] missing=[${missing}]`;
}
