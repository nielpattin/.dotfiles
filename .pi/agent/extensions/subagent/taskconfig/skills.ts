import { loadSkills } from "@mariozechner/pi-coding-agent";

export interface AvailableSkillInfo {
  name: string;
  source: string;
  description?: string;
}

function formatSkillSource(sourceInfo: { source: string; scope: string }): string {
  if (sourceInfo.source === "local") {
    if (sourceInfo.scope === "user") return "user";
    if (sourceInfo.scope === "project") return "project";
    return "path";
  }
  return sourceInfo.source;
}

export function discoverSkillsForTaskConfig(cwd: string): AvailableSkillInfo[] {
  try {
    const loaded = loadSkills({ cwd });
    return loaded.skills
      .map((skill) => ({
        name: skill.name,
        source: formatSkillSource(skill.sourceInfo),
        description: skill.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
