import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

interface RecentSession {
  name: string;
  timeAgo: string;
}

interface LoadedCounts {
  contextFiles: number;
  extensions: number;
  skills: number;
  promptTemplates: number;
}

interface WelcomeData {
  modelName: string;
  providerName: string;
  recentSessions: RecentSession[];
  loadedCounts: LoadedCounts;
}

const PI_LOGO = [
  "▀████████████▀",
  " ╘███    ███  ",
  "  ███    ███  ",
  "  ███    ███  ",
  " ▄███▄  ▄███▄ ",
];

const GRADIENT_COLORS = ["\x1b[38;5;199m", "\x1b[38;5;171m", "\x1b[38;5;135m", "\x1b[38;5;99m", "\x1b[38;5;75m", "\x1b[38;5;51m"];

const ansi = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[38;5;51m",
  accent: "\x1b[38;5;75m",
  muted: "\x1b[38;5;245m",
  success: "\x1b[38;5;114m",
};

function bold(text: string): string {
  return `${ansi.bold}${text}${ansi.reset}`;
}

function dim(text: string): string {
  return `${ansi.muted}${text}${ansi.reset}`;
}

function accent(text: string): string {
  return `${ansi.accent}${text}${ansi.reset}`;
}

function cyan(text: string): string {
  return `${ansi.cyan}${text}${ansi.reset}`;
}

function success(text: string): string {
  return `${ansi.success}${text}${ansi.reset}`;
}

function checkmark(): string {
  return success("✓");
}

function gradientLine(line: string): string {
  let result = "";
  let colorIdx = 0;
  const step = Math.max(1, Math.floor(line.length / GRADIENT_COLORS.length));

  for (let i = 0; i < line.length; i++) {
    if (i > 0 && i % step === 0 && colorIdx < GRADIENT_COLORS.length - 1) colorIdx++;
    const char = line[i];
    result += char === " " ? " " : `${GRADIENT_COLORS[colorIdx]}${char}${ansi.reset}`;
  }

  return result;
}

function truncateToWidth(str: string, width: number): string {
  const ellipsis = "…";
  const maxWidth = Math.max(0, width - 1);
  let result = "";
  let currentWidth = 0;
  let inEscape = false;

  for (const char of str) {
    if (char === "\x1b") inEscape = true;
    if (inEscape) {
      result += char;
      if (char === "m") inEscape = false;
      continue;
    }
    if (currentWidth < maxWidth) {
      result += char;
      currentWidth++;
    }
  }

  return visibleWidth(str) > width ? `${result}${ellipsis}` : result;
}

function centerText(text: string, width: number): string {
  const visLen = visibleWidth(text);
  if (visLen > width) return truncateToWidth(text, width);
  if (visLen === width) return text;
  const leftPad = Math.floor((width - visLen) / 2);
  const rightPad = width - visLen - leftPad;
  return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

function fitToWidth(text: string, width: number): string {
  const visLen = visibleWidth(text);
  if (visLen > width) return truncateToWidth(text, width);
  return text + " ".repeat(width - visLen);
}

function buildLeftColumn(data: WelcomeData, colWidth: number): string[] {
  const logo = PI_LOGO.map((line) => gradientLine(line));
  return [
    "",
    centerText(bold("Welcome back!"), colWidth),
    "",
    ...logo.map((line) => centerText(line, colWidth)),
    "",
    centerText(cyan(data.modelName), colWidth),
    centerText(dim(data.providerName), colWidth),
  ];
}

function buildRightColumn(data: WelcomeData, colWidth: number): string[] {
  const separator = ` ${dim("─".repeat(Math.max(1, colWidth - 2)))}`;

  const sessionLines: string[] = [];
  if (data.recentSessions.length === 0) {
    sessionLines.push(` ${dim("No recent sessions")}`);
  } else {
    for (const session of data.recentSessions.slice(0, 3)) {
      sessionLines.push(` ${dim("• ")}${cyan(session.name)}${dim(` (${session.timeAgo})`)}`);
    }
  }

  const countLines: string[] = [];
  const { contextFiles, extensions, skills, promptTemplates } = data.loadedCounts;
  if (contextFiles + extensions + skills + promptTemplates === 0) {
    countLines.push(` ${dim("No extensions loaded")}`);
  } else {
    if (contextFiles > 0) countLines.push(` ${checkmark()} ${success(String(contextFiles))} context file${contextFiles !== 1 ? "s" : ""}`);
    if (extensions > 0) countLines.push(` ${checkmark()} ${success(String(extensions))} extension${extensions !== 1 ? "s" : ""}`);
    if (skills > 0) countLines.push(` ${checkmark()} ${success(String(skills))} skill${skills !== 1 ? "s" : ""}`);
    if (promptTemplates > 0) countLines.push(` ${checkmark()} ${success(String(promptTemplates))} prompt template${promptTemplates !== 1 ? "s" : ""}`);
  }

  return [
    ` ${bold(accent("Tips"))}`,
    ` ${dim("/")} for commands`,
    ` ${dim("!")} to run bash`,
    ` ${dim("Shift+Tab")} cycle thinking`,
    separator,
    ` ${bold(accent("Loaded"))}`,
    ...countLines,
    separator,
    ` ${bold(accent("Recent sessions"))}`,
    ...sessionLines,
    "",
  ];
}

function renderWelcomeBox(data: WelcomeData, termWidth: number, bottomLine: string): string[] {
  const minLayoutWidth = 44;
  if (termWidth < minLayoutWidth) return [];

  const minWidth = 76;
  const maxWidth = 96;
  const boxWidth = Math.min(termWidth, Math.max(minWidth, Math.min(termWidth - 2, maxWidth)));
  const leftCol = 26;
  const rightCol = Math.max(1, boxWidth - leftCol - 3);

  const h = "─";
  const v = dim("│");
  const tl = dim("╭");
  const tr = dim("╮");
  const bl = dim("╰");
  const br = dim("╯");

  const leftLines = buildLeftColumn(data, leftCol);
  const rightLines = buildRightColumn(data, rightCol);

  const lines: string[] = [];
  const title = " pi agent ";
  const titlePrefix = dim(h.repeat(3));
  const titleStyled = titlePrefix + cyan(title);
  const titleVisLen = 3 + visibleWidth(title);
  const afterTitle = boxWidth - 2 - titleVisLen;
  lines.push(tl + titleStyled + (afterTitle > 0 ? dim(h.repeat(afterTitle)) : "") + tr);

  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    const left = fitToWidth(leftLines[i] ?? "", leftCol);
    const right = fitToWidth(rightLines[i] ?? "", rightCol);
    lines.push(v + left + v + right + v);
  }

  lines.push(bl + bottomLine + br);
  return lines;
}

class WelcomeComponent implements Component {
  private data: WelcomeData;
  private countdown = 30;

  constructor(data: WelcomeData) {
    this.data = data;
  }

  setCountdown(seconds: number): void {
    this.countdown = seconds;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    const minLayoutWidth = 44;
    if (termWidth < minLayoutWidth) return [];

    const minWidth = 76;
    const maxWidth = 96;
    const boxWidth = Math.min(termWidth, Math.max(minWidth, Math.min(termWidth - 2, maxWidth)));

    const countdownText = ` Press any key to continue (${this.countdown}s) `;
    const countdownStyled = dim(countdownText);
    const contentWidth = boxWidth - 2;
    const visLen = visibleWidth(countdownText);
    const leftPad = Math.floor((contentWidth - visLen) / 2);
    const rightPad = contentWidth - visLen - leftPad;
    const bottomLine = dim("─".repeat(Math.max(0, leftPad))) + countdownStyled + dim("─".repeat(Math.max(0, rightPad)));

    return renderWelcomeBox(this.data, termWidth, bottomLine);
  }
}

class WelcomeHeader implements Component {
  private data: WelcomeData;

  constructor(data: WelcomeData) {
    this.data = data;
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    const minLayoutWidth = 44;
    if (termWidth < minLayoutWidth) return [];

    const minWidth = 76;
    const maxWidth = 96;
    const boxWidth = Math.min(termWidth, Math.max(minWidth, Math.min(termWidth - 2, maxWidth)));
    const leftCol = 26;
    const rightCol = Math.max(1, boxWidth - leftCol - 3);
    const bottomLine = dim("─".repeat(leftCol)) + dim("┴") + dim("─".repeat(rightCol));

    const lines = renderWelcomeBox(this.data, termWidth, bottomLine);
    if (lines.length > 0) lines.push("");
    return lines;
  }
}

function isQuietStartup(): boolean {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const settingsPath = join(homeDir, ".pi", "agent", "settings.json");
  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      return settings.quietStartup === true;
    }
  } catch {}
  return false;
}

function discoverLoadedCounts(): LoadedCounts {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const cwd = process.cwd();

  let contextFiles = 0;
  let extensions = 0;
  let skills = 0;
  let promptTemplates = 0;

  const agentsMdPaths = [
    join(homeDir, ".pi", "agent", "AGENTS.md"),
    join(homeDir, ".claude", "AGENTS.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, ".pi", "AGENTS.md"),
    join(cwd, ".claude", "AGENTS.md"),
  ];

  for (const path of agentsMdPaths) if (existsSync(path)) contextFiles++;

  const extensionDirs = [
    join(homeDir, ".pi", "agent", "extensions"),
    join(cwd, "extensions"),
    join(cwd, ".pi", "extensions"),
  ];
  const countedExtensions = new Set<string>();

  for (const dir of extensionDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        const stats = statSync(entryPath);
        if (stats.isDirectory()) {
          if (existsSync(join(entryPath, "index.ts")) || existsSync(join(entryPath, "package.json"))) {
            if (!countedExtensions.has(entry)) {
              countedExtensions.add(entry);
              extensions++;
            }
          }
        } else if (entry.endsWith(".ts") && !entry.startsWith(".")) {
          const name = basename(entry, ".ts");
          if (!countedExtensions.has(name)) {
            countedExtensions.add(name);
            extensions++;
          }
        }
      }
    } catch {}
  }

  const skillDirs = [
    join(homeDir, ".pi", "agent", "skills"),
    join(cwd, ".pi", "skills"),
    join(cwd, "skills"),
  ];
  const countedSkills = new Set<string>();

  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "SKILL.md"))) {
            if (!countedSkills.has(entry)) {
              countedSkills.add(entry);
              skills++;
            }
          }
        } catch {}
      }
    } catch {}
  }

  const templateDirs = [
    join(homeDir, ".pi", "agent", "commands"),
    join(homeDir, ".claude", "commands"),
    join(cwd, ".pi", "commands"),
    join(cwd, ".claude", "commands"),
  ];
  const countedTemplates = new Set<string>();

  const countTemplatesInDir = (dir: string) => {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            countTemplatesInDir(entryPath);
          } else if (entry.endsWith(".md")) {
            const name = basename(entry, ".md");
            if (!countedTemplates.has(name)) {
              countedTemplates.add(name);
              promptTemplates++;
            }
          }
        } catch {}
      }
    } catch {}
  };

  for (const dir of templateDirs) countTemplatesInDir(dir);

  return { contextFiles, extensions, skills, promptTemplates };
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function getRecentSessions(maxCount = 3): RecentSession[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const sessionsDirs = [join(homeDir, ".pi", "agent", "sessions"), join(homeDir, ".pi", "sessions")];
  const sessions: { name: string; mtime: number }[] = [];

  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        try {
          const stats = statSync(entryPath);
          if (stats.isDirectory()) {
            scanDir(entryPath);
          } else if (entry.endsWith(".jsonl")) {
            const parentName = basename(dir);
            let projectName = parentName;
            if (parentName.startsWith("--")) {
              const parts = parentName.split("-").filter(Boolean);
              projectName = parts[parts.length - 1] || parentName;
            }
            sessions.push({ name: projectName, mtime: stats.mtimeMs });
          }
        } catch {}
      }
    } catch {}
  };

  for (const dir of sessionsDirs) scanDir(dir);
  if (sessions.length === 0) return [];

  sessions.sort((a, b) => b.mtime - a.mtime);
  const unique: typeof sessions = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (!seen.has(session.name)) {
      seen.add(session.name);
      unique.push(session);
    }
  }

  const now = Date.now();
  return unique.slice(0, maxCount).map((s) => ({
    name: s.name.length > 20 ? `${s.name.slice(0, 17)}…` : s.name,
    timeAgo: formatTimeAgo(now - s.mtime),
  }));
}

export default function welcomeExtension(pi: ExtensionAPI) {
  let dismissWelcomeOverlay: (() => void) | null = null;
  let welcomeHeaderActive = false;
  let welcomeOverlayShouldDismiss = false;
  let isStreaming = false;

  const dismissWelcome = (ctx: any) => {
    if (dismissWelcomeOverlay) {
      dismissWelcomeOverlay();
      dismissWelcomeOverlay = null;
    } else {
      welcomeOverlayShouldDismiss = true;
    }
    if (welcomeHeaderActive) {
      welcomeHeaderActive = false;
      ctx.ui.setHeader(undefined);
    }
  };

  const buildData = (ctx: any): WelcomeData => ({
    modelName: ctx.model?.name || ctx.model?.id || "No model",
    providerName: ctx.model?.provider || "Unknown",
    loadedCounts: discoverLoadedCounts(),
    recentSessions: getRecentSessions(3),
  });

  const setupWelcomeHeader = (ctx: any) => {
    const header = new WelcomeHeader(buildData(ctx));
    welcomeHeaderActive = true;
    ctx.ui.setHeader(() => ({
      render: (width: number) => header.render(width),
      invalidate: () => header.invalidate(),
    }));
  };

  const setupWelcomeOverlay = (ctx: any) => {
    const data = buildData(ctx);

    setTimeout(() => {
      if (welcomeOverlayShouldDismiss || isStreaming) {
        welcomeOverlayShouldDismiss = false;
        return;
      }

      const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
      const hasActivity = sessionEvents.some((e: any) =>
        (e.type === "message" && e.message?.role === "assistant") ||
        e.type === "tool_call" ||
        e.type === "tool_result",
      );
      if (hasActivity) return;

      ctx.ui.custom(
        (tui: any, _theme: any, _keybindings: any, done: (result: void) => void) => {
          const welcome = new WelcomeComponent(data);
          let countdown = 30;
          let dismissed = false;

          const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            clearInterval(interval);
            dismissWelcomeOverlay = null;
            done();
          };

          dismissWelcomeOverlay = dismiss;

          if (welcomeOverlayShouldDismiss) {
            welcomeOverlayShouldDismiss = false;
            dismiss();
          }

          const interval = setInterval(() => {
            if (dismissed) return;
            countdown--;
            welcome.setCountdown(countdown);
            tui.requestRender();
            if (countdown <= 0) dismiss();
          }, 1000);

          return {
            focused: false,
            invalidate: () => welcome.invalidate(),
            render: (width: number) => welcome.render(width),
            handleInput: (_data: string) => dismiss(),
            dispose: () => {
              dismissed = true;
              clearInterval(interval);
            },
          };
        },
        {
          overlay: true,
          overlayOptions: () => ({
            verticalAlign: "center",
            horizontalAlign: "center",
          }),
        },
      ).catch(() => {});
    }, 100);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (isQuietStartup()) {
      setupWelcomeHeader(ctx);
    } else {
      setupWelcomeOverlay(ctx);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    isStreaming = true;
    if (ctx.hasUI) dismissWelcome(ctx);
  });

  pi.on("agent_end", async () => {
    isStreaming = false;
  });

  pi.on("tool_call", async (_event, ctx) => {
    if (ctx.hasUI) dismissWelcome(ctx);
  });

  pi.on("input", async (_event, ctx) => {
    if (ctx.hasUI) dismissWelcome(ctx);
  });
}
