import { loadSkills } from "@mariozechner/pi-coding-agent";
import type { AvailableSkillInfo } from "./panel.js";

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
