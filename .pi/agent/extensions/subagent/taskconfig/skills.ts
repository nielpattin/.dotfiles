import { loadSkills } from "@mariozechner/pi-coding-agent";

export interface AvailableSkillInfo {
  name: string;
  source: string;
  description?: string;
}

export function discoverSkillsForTaskConfig(cwd: string): AvailableSkillInfo[] {
  try {
    const loaded = loadSkills({ cwd });
    return loaded.skills
      .map((skill) => ({
        name: skill.name,
        source: skill.source,
        description: skill.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
