import type { Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, parseKey, truncateToWidth, visibleWidth, type TUI } from "@mariozechner/pi-tui";
import type { AgentConfig } from "../agents/types.js";

type TaskConfigField = "skills" | "extensions";

export interface AvailableSkillInfo {
  name: string;
  source: string;
  description?: string;
}

export interface AvailableExtensionInfo {
  name: string;
  source: "user" | "project";
}

export type TaskConfigPanelResult =
  | { action: "cancel" }
  | { action: "clear"; agentName: string }
  | { action: "save"; agentName: string; field: "skills"; value: string }
  | {
    action: "save";
    agentName: string;
    field: "extensions";
    value: string;
    extensionMode?: "set" | "inherit" | "none";
  };

function getAgentConfig(agents: AgentConfig[], agentName: string): AgentConfig | undefined {
  return agents.find((agent) => agent.name === agentName);
}

export class TaskConfigPanel {
  private selectedIndex = 0;
  private scrollOffset = 0;
  private readonly maxVisibleOptions = 6;
  private mode: "agent" | "action" | "skills" | "extensions" | "edit" = "agent";
  private currentAgentName: string;
  private currentField: TaskConfigField = "skills";
  private inputValue = "";
  private selectedSkills = new Set<string>();
  private selectedExtensions = new Set<string>();

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly agents: AgentConfig[],
    private readonly availableSkills: AvailableSkillInfo[],
    private readonly availableExtensions: AvailableExtensionInfo[],
    private readonly done: (result: TaskConfigPanelResult) => void,
  ) {
    this.currentAgentName = agents[0]?.name ?? "";
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      if (this.mode === "edit") {
        this.mode = "action";
      } else if (this.mode === "skills" || this.mode === "extensions") {
        this.mode = "action";
      } else if (this.mode === "action") {
        this.mode = "agent";
      } else {
        this.done({ action: "cancel" });
        return;
      }
      this.resetSelection();
      this.refresh();
      return;
    }

    if (this.mode === "edit") {
      this.handleEditInput(data);
      return;
    }

    const options = this.getCurrentOptions();
    if (options.length === 0) return;

    if (matchesKey(data, "up")) {
      this.moveSelection(options.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.moveSelection(options.length, 1);
      return;
    }
    if (this.isPageUpKey(data)) {
      this.moveSelection(options.length, -this.maxVisibleOptions);
      return;
    }
    if (this.isPageDownKey(data)) {
      this.moveSelection(options.length, this.maxVisibleOptions);
      return;
    }
    if (this.isHomeKey(data)) {
      this.selectedIndex = 0;
      this.ensureSelectionVisible(options.length);
      this.refresh();
      return;
    }
    if (this.isEndKey(data)) {
      this.selectedIndex = Math.max(0, options.length - 1);
      this.ensureSelectionVisible(options.length);
      this.refresh();
      return;
    }
    if ((this.mode === "skills" || this.mode === "extensions") && matchesKey(data, "space")) {
      const selected = options[this.selectedIndex];
      const listLength = this.mode === "skills" ? this.availableSkills.length : this.availableExtensions.length;
      if (selected && this.selectedIndex < listLength) selected.action();
      return;
    }

    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      if (this.mode === "skills" && this.selectedIndex < this.availableSkills.length) {
        this.done({
          action: "save",
          agentName: this.currentAgentName,
          field: "skills",
          value: Array.from(this.selectedSkills).join(", "),
        });
        return;
      }
      if (this.mode === "extensions" && this.selectedIndex < this.availableExtensions.length) {
        this.done({
          action: "save",
          agentName: this.currentAgentName,
          field: "extensions",
          value: Array.from(this.selectedExtensions).join(", "),
          extensionMode: "set",
        });
        return;
      }
      const selected = options[this.selectedIndex];
      if (selected) selected.action();
    }
  }

  render(width: number): string[] {
    const w = Math.max(68, Math.min(width, 108));
    const innerWidth = Math.max(0, w - 2);
    const lines: string[] = [];
    const th = this.theme;

    const pad = (text: string) => `${text}${" ".repeat(Math.max(0, innerWidth - visibleWidth(text)))}`;
    const row = (content = "") => `${th.fg("border", "│")}${pad(truncateToWidth(content, innerWidth))}${th.fg("border", "│")}`;

    lines.push(th.fg("border", `╭${"─".repeat(innerWidth)}╮`));
    lines.push(row(` ${th.bold(th.fg("accent", "Agents"))}`));

    if (this.mode === "agent") {
      lines.push(row(` ${th.fg("dim", "Choose agent • Enter select • Esc close")}`));
    } else if (this.mode === "action") {
      lines.push(row(` ${th.fg("dim", `Agent: ${this.currentAgentName} • Enter edit • Esc back`)}`));
    } else if (this.mode === "skills" || this.mode === "extensions") {
      lines.push(row(` ${th.fg("dim", "Space toggle • Enter save • PgUp/PgDn/Home/End jump • Esc back")}`));
    } else {
      lines.push(row(` ${th.fg("dim", `${this.getFieldLabel(this.currentField)} • Enter save • Esc cancel`)}`));
    }

    lines.push(row());

    if (this.mode === "edit") {
      lines.push(row(` ${th.fg("muted", "Value:")} ${this.inputValue || th.fg("dim", "(blank)")}`));
      lines.push(row());
      lines.push(row(` ${th.fg("dim", this.getFieldHint(this.currentField))}`));
    } else {
      const options = this.getCurrentOptions();
      if (options.length > 0) {
        this.selectedIndex = Math.min(this.selectedIndex, options.length - 1);
        this.ensureSelectionVisible(options.length);
      }

      const start = this.scrollOffset;
      const end = Math.min(options.length, start + this.maxVisibleOptions);
      for (let i = start; i < end; i += 1) {
        const option = options[i]!;
        const selected = i === this.selectedIndex;
        const prefix = selected ? th.fg("accent", "▶") : th.fg("dim", "•");
        const label = selected ? th.fg("accent", option.label) : option.label;
        lines.push(row(` ${prefix} ${label}`));
        if (option.description) {
          lines.push(row(`   ${th.fg("muted", truncateToWidth(option.description, Math.max(8, innerWidth - 3)))}`));
        }
      }

      if (options.length > this.maxVisibleOptions) {
        lines.push(row(` ${th.fg("dim", `${this.selectedIndex + 1}/${options.length} • showing ${start + 1}-${end}`)}`));
      }
    }

    lines.push(th.fg("border", `╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}

  private handleEditInput(data: string): void {
    if (matchesKey(data, "backspace") || matchesKey(data, "shift+backspace")) {
      if (this.inputValue.length > 0) {
        this.inputValue = this.inputValue.slice(0, -1);
        this.refresh();
      }
      return;
    }

    if (matchesKey(data, "ctrl+u")) {
      if (this.inputValue.length > 0) {
        this.inputValue = "";
        this.refresh();
      }
      return;
    }

    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.done({
        action: "save",
        agentName: this.currentAgentName,
        field: this.currentField,
        value: this.inputValue,
      });
      return;
    }

    const textInput = this.getTextInput(data);
    if (textInput) {
      this.inputValue += textInput;
      this.refresh();
    }
  }

  private getTextInput(data: string): string | undefined {
    const key = parseKey(data);
    if (key === "space") return " ";
    if (key && key.length === 1) return key;
    if (key?.startsWith("shift+")) {
      const shifted = key.slice(6);
      if (shifted.length === 1) {
        if (/^[a-z]$/.test(shifted)) return shifted.toUpperCase();
        return shifted;
      }
    }

    if (data.length === 1) {
      const code = data.charCodeAt(0);
      if (code >= 32 && code <= 126) return data;
    }

    return undefined;
  }

  private isPageUpKey(data: string): boolean {
    const key = parseKey(data);
    return key === "pageup" || key === "page_up" || key === "prior" || matchesKey(data, "ctrl+b");
  }

  private isPageDownKey(data: string): boolean {
    const key = parseKey(data);
    return key === "pagedown" || key === "page_down" || key === "next" || matchesKey(data, "ctrl+f");
  }

  private isHomeKey(data: string): boolean {
    return matchesKey(data, "home") || matchesKey(data, "ctrl+a");
  }

  private isEndKey(data: string): boolean {
    return matchesKey(data, "end") || matchesKey(data, "ctrl+e");
  }

  private getCurrentOptions(): Array<{ label: string; description?: string; action: () => void }> {
    if (this.mode === "agent") {
      return this.agents.map((agent) => ({
        label: `${agent.name} (${agent.source})`,
        description: this.getAgentSummary(agent.name),
        action: () => {
          this.currentAgentName = agent.name;
          this.mode = "action";
          this.resetSelection();
          this.refresh();
        },
      }));
    }

    const current = getAgentConfig(this.agents, this.currentAgentName);

    if (this.mode === "skills") {
      const options: Array<{ label: string; description?: string; action: () => void }> = this.availableSkills.map((skill) => ({
        label: `${this.selectedSkills.has(skill.name) ? "[x]" : "[ ]"} ${skill.name}`,
        description: skill.description
          ? `${skill.description} [${skill.source}]`
          : `source: ${skill.source}`,
        action: () => {
          if (this.selectedSkills.has(skill.name)) this.selectedSkills.delete(skill.name);
          else this.selectedSkills.add(skill.name);
          this.refresh();
        },
      }));

      options.push({
        label: "Clear all",
        description: "Remove all configured skills.",
        action: () => this.done({
          action: "save",
          agentName: this.currentAgentName,
          field: "skills",
          value: "",
        }),
      });

      options.push({
        label: "Manual entry...",
        description: "Comma-separated list when a skill is not discoverable.",
        action: () => this.startEditing("skills", Array.from(this.selectedSkills).join(", ")),
      });

      options.push({
        label: "Back",
        action: () => {
          this.mode = "action";
          this.resetSelection();
          this.refresh();
        },
      });

      return options;
    }

    if (this.mode === "extensions") {
      const options: Array<{ label: string; description?: string; action: () => void }> = this.availableExtensions.map((extension) => ({
        label: `${this.selectedExtensions.has(extension.name) ? "[x]" : "[ ]"} ${extension.name}`,
        description: `source: ${extension.source}`,
        action: () => {
          if (this.selectedExtensions.has(extension.name)) this.selectedExtensions.delete(extension.name);
          else this.selectedExtensions.add(extension.name);
          this.refresh();
        },
      }));

      options.push({
        label: "Inherit agent/default",
        description: "Clear override and use inherited extension defaults.",
        action: () => this.done({
          action: "save",
          agentName: this.currentAgentName,
          field: "extensions",
          value: "",
          extensionMode: "inherit",
        }),
      });

      options.push({
        label: "None (disable all)",
        description: "Persist an empty extension list in frontmatter.",
        action: () => this.done({
          action: "save",
          agentName: this.currentAgentName,
          field: "extensions",
          value: "",
          extensionMode: "none",
        }),
      });

      options.push({
        label: "Manual entry...",
        description: "Comma-separated list when an extension is not discoverable.",
        action: () => this.startEditing("extensions", Array.from(this.selectedExtensions).join(", ")),
      });

      options.push({
        label: "Back",
        action: () => {
          this.mode = "action";
          this.resetSelection();
          this.refresh();
        },
      });

      return options;
    }

    const skillsText = current?.skills && current.skills.length > 0
      ? current.skills.join(", ")
      : "(none)";

    return [
      {
        label: `Skills: ${skillsText}`,
        action: () => this.openSkillPicker(current?.skills),
      },
      {
        label: `Enabled extensions: ${this.formatExtensionsSummary(current?.extensions)}`,
        action: () => this.openExtensionPicker(current?.extensions),
      },
      {
        label: "Clear agent settings",
        description: "Removes stored skills/extensions for this agent.",
        action: () => this.done({ action: "clear", agentName: this.currentAgentName }),
      },
      {
        label: "Back",
        action: () => {
          this.mode = "agent";
          this.resetSelection();
          this.refresh();
        },
      },
    ];
  }

  private startEditing(field: TaskConfigField, value: string): void {
    this.currentField = field;
    this.inputValue = value;
    this.mode = "edit";
    this.refresh();
  }

  private openSkillPicker(currentSkills?: string[]): void {
    this.mode = "skills";
    this.selectedSkills = new Set(currentSkills ?? []);

    if (this.availableSkills.length === 0) {
      this.selectedIndex = 1;
    } else {
      const firstSelected = this.availableSkills.findIndex((skill) => this.selectedSkills.has(skill.name));
      this.selectedIndex = firstSelected >= 0 ? firstSelected : 0;
    }
    this.scrollOffset = 0;
    this.ensureSelectionVisible(this.getCurrentOptions().length);
    this.refresh();
  }

  private openExtensionPicker(currentExtensions?: string[]): void {
    this.mode = "extensions";
    this.selectedExtensions = new Set(currentExtensions ?? []);

    if (this.availableExtensions.length === 0) {
      this.selectedIndex = 2;
    } else {
      const firstSelected = this.availableExtensions.findIndex((extension) => this.selectedExtensions.has(extension.name));
      this.selectedIndex = firstSelected >= 0 ? firstSelected : 0;
    }
    this.scrollOffset = 0;
    this.ensureSelectionVisible(this.getCurrentOptions().length);
    this.refresh();
  }

  private getFieldLabel(field: TaskConfigField): string {
    if (field === "skills") return "Skills";
    return "Extensions";
  }

  private getFieldHint(field: TaskConfigField): string {
    if (field === "skills") return "Comma-separated list. Leave blank to clear.";
    return "Comma-separated list. Leave blank to inherit agent/default.";
  }

  private formatExtensionsSummary(extensions?: string[]): string {
    if (extensions === undefined) return "(inherit agent/default)";
    if (extensions.length === 0) return "(none)";
    return extensions.join(", ");
  }

  private getAgentSummary(agentName: string): string {
    const current = getAgentConfig(this.agents, agentName);
    const skills = current?.skills && current.skills.length > 0
      ? current.skills.join(", ")
      : "-";
    return `skills: ${skills} | extensions: ${this.formatExtensionsSummary(current?.extensions)}`;
  }

  private moveSelection(totalOptions: number, delta: number): void {
    if (totalOptions <= 0) return;
    this.selectedIndex = Math.min(totalOptions - 1, Math.max(0, this.selectedIndex + delta));
    this.ensureSelectionVisible(totalOptions);
    this.refresh();
  }

  private ensureSelectionVisible(totalOptions: number): void {
    if (totalOptions <= 0) {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      return;
    }

    const visible = Math.min(this.maxVisibleOptions, totalOptions);
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + visible) {
      this.scrollOffset = this.selectedIndex - visible + 1;
    }

    const maxScroll = Math.max(0, totalOptions - visible);
    this.scrollOffset = Math.min(Math.max(0, this.scrollOffset), maxScroll);
  }

  private resetSelection(): void {
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  private refresh(): void {
    this.tui.requestRender();
  }
}
