import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ReadonlyFooterDataProvider, Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorTheme } from "@mariozechner/pi-tui";

type ColorValue = ThemeColor | `#${string}`;
type SemanticColor = "pi" | "model" | "path" | "gitDirty" | "gitClean" | "thinking" | "context" | "contextWarn" | "contextError" | "cost";
type SegmentId = "pi" | "model" | "thinking" | "cost" | "path" | "git" | "cache_total" | "context_pct" | "extension_statuses";
type ColorScheme = Partial<Record<SemanticColor, ColorValue>>;
type GitStatus = { branch: string | null; staged: number; unstaged: number; untracked: number };
type SegmentContext = {
  model: { id: string; name?: string; provider?: string; providerName?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  cwd: string;
  thinkingLevel: string;
  cost: number;
  cacheTotal: number;
  contextPercent: number;
  contextUsed: number;
  contextWindow: number;
  git: GitStatus;
  extensionStatuses: ReadonlyMap<string, string>;
  theme: Theme;
  colors: ColorScheme;
};

type CachedGitStatus = Omit<GitStatus, "branch"> & { timestamp: number };
type CachedBranch = { branch: string | null; timestamp: number };

const COLORS: Required<ColorScheme> = {
  pi: "accent",
  model: "#d787af",
  path: "#00afaf",
  gitDirty: "warning",
  gitClean: "success",
  thinking: "muted",
  context: "dim",
  contextWarn: "warning",
  contextError: "error",
  cost: "text",
};

const ICONS = {
  pi: "\uE22C",
  model: "\uEC19",
  thinking: "\uF0EB",
  folder: "\uF115",
  branch: "\uF126",
  git: "\uF1D3",
  cache: "\uF1C0",
} as const;

const SEG_LEFT: SegmentId[] = ["pi", "model", "thinking", "cost"];
const SEG_RIGHT: SegmentId[] = ["path", "git", "cache_total", "context_pct"];
const SEG_SECONDARY: SegmentId[] = ["extension_statuses"];
const THINK_LABELS: Record<string, string> = { off: "off", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xhigh" };
const GIT_BRANCH_PATTERNS = [
  /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
  /\bgit\s+stash\s+(pop|apply)/,
] as const;
const THEME_PATH = join(dirname(fileURLToPath(import.meta.url)), "theme.json");
const SEPARATOR = "›";
const GIT_STATUS_TTL_MS = 1000;
const GIT_BRANCH_TTL_MS = 500;
const THEME_CACHE_TTL_MS = 5000;
const EMPTY_SEGMENT = { content: "", visible: false } as const;

let cachedStatus: CachedGitStatus | null = null;
let cachedBranch: CachedBranch | null = null;
let pendingStatusFetch: Promise<void> | null = null;
let pendingBranchFetch: Promise<void> | null = null;
let statusInvalidationCounter = 0;
let branchInvalidationCounter = 0;
let userThemeCache: ColorScheme | null = null;
let userThemeCacheTime = 0;

const withIcon = (icon: string, text: string) => (icon ? `${icon} ${text}` : text);
const joinParts = (parts: string[], separator: string) => (parts.length ? parts.join(` ${separator} `) : "");
const buildContent = (parts: string[], separator: string) => (parts.length ? ` ${joinParts(parts, separator)} ` : "");
const groupWidth = (parts: { width: number }[], separatorWidth: number) =>
  parts.length ? parts.reduce((sum, part) => sum + part.width, 0) + separatorWidth * (parts.length - 1) : 0;

function loadUserTheme(): ColorScheme {
  const now = Date.now();
  if (userThemeCache && now - userThemeCacheTime < THEME_CACHE_TTL_MS) return userThemeCache;
  try {
    if (existsSync(THEME_PATH)) userThemeCache = JSON.parse(readFileSync(THEME_PATH, "utf-8")).colors ?? {};
    else userThemeCache = {};
  } catch {
    userThemeCache = {};
  }
  userThemeCacheTime = now;
  return userThemeCache ?? {};
}

function applyColor(theme: Theme, color: ColorValue, text: string): string {
  if (!color.startsWith("#")) return theme.fg(color as ThemeColor, text);
  const hex = color.slice(1);
  return `\x1b[38;2;${parseInt(hex.slice(0, 2), 16)};${parseInt(hex.slice(2, 4), 16)};${parseInt(hex.slice(4, 6), 16)}m${text}\x1b[0m`;
}

function color(ctx: SegmentContext, semantic: SemanticColor, text: string): string {
  const user = loadUserTheme();
  return applyColor(ctx.theme, user[semantic] ?? ctx.colors[semantic] ?? COLORS[semantic], text);
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

function cleanLabel(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function humanizeProviderId(provider: string | undefined): string | undefined {
  const cleaned = cleanLabel(provider);
  if (!cleaned) return undefined;
  return cleaned
    .split(/([\-_/]+)/)
    .map((part) => (/^[\-_/]+$/.test(part) ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join("");
}

function getProviderName(modelRegistry: { authStorage?: { getOAuthProviders?: () => Array<{ id: string; name?: string }> } } | undefined, provider: string | undefined): string | undefined {
  const cleanedProvider = cleanLabel(provider);
  if (!cleanedProvider) return undefined;
  const oauthProviderName = cleanLabel(modelRegistry?.authStorage?.getOAuthProviders?.().find((entry) => entry.id === cleanedProvider)?.name);
  const compactOauthName = cleanLabel(oauthProviderName?.split("(")[0]);
  if (compactOauthName && !compactOauthName.includes("/")) return compactOauthName;
  return humanizeProviderId(cleanedProvider);
}

function formatModelLabel(model: SegmentContext["model"]): string {
  const modelName = cleanLabel(model?.name) || cleanLabel(model?.id) || "no-model";
  const providerName = cleanLabel(model?.providerName);
  return providerName ? `${modelName} (${providerName})` : modelName;
}

function getDisplayPath(cwd: string): string {
  const pwd = cwd.replace(/\\/g, "/");
  const home = (process.env.HOME || process.env.USERPROFILE || "").replace(/\\/g, "/").replace(/\/$/, "");
  const basename = pwd.split("/").filter(Boolean).at(-1) || pwd;
  if (!home) return basename;

  const pwdLower = pwd.toLowerCase();
  const homeLower = home.toLowerCase();
  if (pwdLower === homeLower) return "~";
  if (!pwdLower.startsWith(`${homeLower}/`)) return basename;

  const parts = pwd.slice(home.length).replace(/^\//, "").split("/").filter(Boolean);
  if (parts.length === 0) return "~";
  if (parts.length === 1) return `~/${parts[0]}`;
  if (parts.length === 2) return `~/${parts[0]}/${parts[1]}`;
  return parts.at(-1) || "~";
}

function parseGitStatus(output: string): Omit<GitStatus, "branch"> {
  let staged = 0, unstaged = 0, untracked = 0;
  for (const line of output.split("\n")) {
    if (!line) continue;
    const x = line[0], y = line[1];
    if (x === "?" && y === "?") { untracked++; continue; }
    if (x && x !== " " && x !== "?") staged++;
    if (y && y !== " ") unstaged++;
  }
  return { staged, unstaged, untracked };
}

function runGit(args: string[], timeout = 200): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let done = false;
    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.on("close", (code) => finish(code === 0 ? stdout.trim() : null));
    proc.on("error", () => finish(null));
    const timer = setTimeout(() => { proc.kill(); finish(null); }, timeout);
  });
}

async function fetchGitBranch(): Promise<string | null> {
  const branch = await runGit(["branch", "--show-current"]);
  if (branch === null) return null;
  if (branch) return branch;
  const sha = await runGit(["rev-parse", "--short", "HEAD"]);
  return sha ? `${sha} (detached)` : "detached";
}

async function fetchGitStatus(): Promise<Omit<GitStatus, "branch"> | null> {
  const output = await runGit(["status", "--porcelain"], 500);
  return output === null ? null : parseGitStatus(output);
}

function getCurrentBranch(providerBranch: string | null): string | null {
  const now = Date.now();
  if (cachedBranch && now - cachedBranch.timestamp < GIT_BRANCH_TTL_MS) return cachedBranch.branch;
  if (!pendingBranchFetch) {
    const fetchId = branchInvalidationCounter;
    pendingBranchFetch = fetchGitBranch().then((branch) => {
      if (fetchId === branchInvalidationCounter) cachedBranch = { branch, timestamp: Date.now() };
      pendingBranchFetch = null;
    });
  }
  return cachedBranch?.branch ?? providerBranch;
}

function getGitStatus(providerBranch: string | null): GitStatus {
  const branch = getCurrentBranch(providerBranch);
  const now = Date.now();
  if (cachedStatus && now - cachedStatus.timestamp < GIT_STATUS_TTL_MS) {
    return { branch, staged: cachedStatus.staged, unstaged: cachedStatus.unstaged, untracked: cachedStatus.untracked };
  }
  if (!pendingStatusFetch) {
    const fetchId = statusInvalidationCounter;
    pendingStatusFetch = fetchGitStatus().then((status) => {
      if (fetchId === statusInvalidationCounter) {
        cachedStatus = status ? { ...status, timestamp: Date.now() } : { staged: 0, unstaged: 0, untracked: 0, timestamp: Date.now() };
      }
      pendingStatusFetch = null;
    });
  }
  return cachedStatus
    ? { branch, staged: cachedStatus.staged, unstaged: cachedStatus.unstaged, untracked: cachedStatus.untracked }
    : { branch, staged: 0, unstaged: 0, untracked: 0 };
}

function invalidateGitStatus(): void {
  cachedStatus = null;
  statusInvalidationCounter++;
}

function invalidateGitBranch(): void {
  cachedBranch = null;
  branchInvalidationCounter++;
}

function renderSegment(id: SegmentId, ctx: SegmentContext) {
  switch (id) {
    case "pi":
      return { content: color(ctx, "pi", `${ICONS.pi} `), visible: true };
    case "model":
      return { content: color(ctx, "model", withIcon(ICONS.model, formatModelLabel(ctx.model))), visible: true };
    case "thinking":
      return { content: color(ctx, "thinking", withIcon(ICONS.thinking, THINK_LABELS[ctx.thinkingLevel] || ctx.thinkingLevel)), visible: true };
    case "cost":
      return ctx.cost ? { content: color(ctx, "cost", `$${ctx.cost.toFixed(2)}`), visible: true } : EMPTY_SEGMENT;
    case "path":
      return { content: color(ctx, "path", withIcon(ICONS.folder, getDisplayPath(ctx.cwd))), visible: true };
    case "git": {
      const { branch, staged, unstaged, untracked } = ctx.git;
      if (!branch && !staged && !unstaged && !untracked) return EMPTY_SEGMENT;
      const dirty = staged > 0 || unstaged > 0 || untracked > 0;
      const branchColor: SemanticColor = dirty ? "gitDirty" : "gitClean";
      let content = branch ? color(ctx, branchColor, withIcon(ICONS.branch, branch)) : "";
      const indicators = [
        unstaged > 0 ? applyColor(ctx.theme, "warning", `*${unstaged}`) : "",
        staged > 0 ? applyColor(ctx.theme, "success", `+${staged}`) : "",
        untracked > 0 ? applyColor(ctx.theme, "muted", `?${untracked}`) : "",
      ].filter(Boolean);
      if (!content && indicators.length) content = color(ctx, branchColor, `${ICONS.git} `) + indicators.join(" ");
      else if (indicators.length) content += ` ${indicators.join(" ")}`;
      return content ? { content, visible: true } : EMPTY_SEGMENT;
    }
    case "cache_total":
      return ctx.cacheTotal ? { content: color(ctx, "context", withIcon(ICONS.cache, formatTokens(ctx.cacheTotal))), visible: true } : EMPTY_SEGMENT;
    case "context_pct": {
      const text = `${formatTokens(ctx.contextUsed)}/${formatTokens(ctx.contextWindow)} (${ctx.contextPercent.toFixed(1)}%)`;
      const semantic = ctx.contextPercent > 90 ? "contextError" : ctx.contextPercent > 70 ? "contextWarn" : "context";
      return { content: color(ctx, semantic, text), visible: true };
    }
    case "extension_statuses": {
      if (!ctx.extensionStatuses.size) return EMPTY_SEGMENT;
      const parts = [...ctx.extensionStatuses.values()].filter((value) => value && !value.trimStart().startsWith("["));
      return parts.length ? { content: parts.join(" | "), visible: true } : EMPTY_SEGMENT;
    }
  }
}

function rendered(segId: SegmentId, ctx: SegmentContext) {
  const segment = renderSegment(segId, ctx);
  return segment.visible && segment.content
    ? { segId, content: segment.content, width: visibleWidth(segment.content), visible: true }
    : { segId, content: "", width: 0, visible: false };
}

function computeResponsiveLayout(ctx: SegmentContext, width: number) {
  const separatorWidth = visibleWidth(SEPARATOR) + 2;
  const left = SEG_LEFT.map((id) => rendered(id, ctx)).filter((seg) => seg.visible);
  const right = SEG_RIGHT.map((id) => rendered(id, ctx)).filter((seg) => seg.visible);
  const secondary = SEG_SECONDARY.map((id) => rendered(id, ctx)).filter((seg) => seg.visible);
  const leftTop = [...left];
  const rightTop = [...right];
  const topInnerWidth = Math.max(0, width - 2);

  while (groupWidth(leftTop, separatorWidth) + groupWidth(rightTop, separatorWidth) + (leftTop.length && rightTop.length ? 1 : 0) > topInnerWidth) {
    if (leftTop.length) leftTop.pop();
    else if (rightTop.length) rightTop.shift();
    else break;
  }

  const shown = new Set<SegmentId>([...leftTop.map((seg) => seg.segId), ...rightTop.map((seg) => seg.segId)]);
  const leftStr = joinParts(leftTop.map((seg) => seg.content), SEPARATOR);
  const rightStr = joinParts(rightTop.map((seg) => seg.content), SEPARATOR);
  const overflow = [...left, ...right].filter((seg) => !shown.has(seg.segId));

  let topContent = "";
  if (leftStr || rightStr) {
    const pad = Math.max(0, topInnerWidth - visibleWidth(leftStr) - visibleWidth(rightStr) - (leftStr && rightStr ? 1 : 0));
    topContent = leftStr && rightStr ? ` ${leftStr}${" ".repeat(pad + 1)}${rightStr} ` : leftStr ? ` ${leftStr} ` : ` ${rightStr} `;
  }

  const bottom: string[] = [];
  let bottomWidth = 2;
  for (const seg of [...overflow, ...secondary]) {
    const needed = seg.width + (bottom.length ? separatorWidth : 0);
    if (bottomWidth + needed > width) break;
    bottom.push(seg.content);
    bottomWidth += needed;
  }

  return { topContent, secondaryContent: buildContent(bottom, SEPARATOR) };
}

export default function powerlineFooter(pi: ExtensionAPI) {
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let tuiRef: any = null;
  let lastLayoutWidth = 0;
  let lastLayout: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;

  const maybeRequestRender = (delay: number) => setTimeout(() => tuiRef?.requestRender(), delay);
  const invalidateGit = () => { invalidateGitStatus(); invalidateGitBranch(); };
  const mightChangeGitBranch = (cmd: string) => GIT_BRANCH_PATTERNS.some((pattern) => pattern.test(cmd));

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    if (ctx.hasUI) setupCustomEditor(ctx);
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName === "write" || event.toolName === "edit") invalidateGitStatus();
    if (event.toolName === "bash" && event.input?.command && mightChangeGitBranch(String(event.input.command))) {
      invalidateGit();
      maybeRequestRender(100);
    }
  });

  pi.on("user_bash", async (event) => {
    if (!mightChangeGitBranch(event.command)) return;
    invalidateGit();
    maybeRequestRender(100);
    maybeRequestRender(300);
    maybeRequestRender(500);
  });

  function buildSegmentContext(ctx: any, theme: Theme): SegmentContext {
    let cost = 0;
    let cacheTotal = 0;
    let lastUsage: any;
    let thinkingLevel = "off";

    for (const entry of ctx.sessionManager?.getBranch?.() ?? []) {
      if (entry.type === "thinking_level_change" && entry.thinkingLevel) thinkingLevel = entry.thinkingLevel;
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;
      const message = entry.message;
      if (message.stopReason === "error" || message.stopReason === "aborted" || !message.usage) continue;
      cost += message.usage.cost?.total ?? 0;
      cacheTotal += (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0);
      lastUsage = message.usage;
    }

    const fallbackContextUsed = lastUsage
      ? (lastUsage.input ?? 0) + (lastUsage.output ?? 0) + (lastUsage.cacheRead ?? 0) + (lastUsage.cacheWrite ?? 0)
      : 0;
    const usage = ctx.getContextUsage?.();
    const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const contextUsed = typeof usage?.tokens === "number" ? usage.tokens : fallbackContextUsed;
    const contextPercent = typeof usage?.percent === "number" ? usage.percent : contextWindow > 0 ? (contextUsed / contextWindow) * 100 : 0;

    return {
      model: ctx.model ? { ...ctx.model, providerName: getProviderName(ctx.modelRegistry, ctx.model.provider) } : undefined,
      cwd: ctx.cwd,
      thinkingLevel: thinkingLevel !== "off" ? thinkingLevel : pi.getThinkingLevel(),
      cost,
      cacheTotal,
      contextPercent,
      contextUsed,
      contextWindow,
      git: getGitStatus(footerDataRef?.getGitBranch() ?? null),
      extensionStatuses: footerDataRef?.getExtensionStatuses() ?? new Map(),
      theme,
      colors: COLORS,
    };
  }

  function getLayout(width: number, theme: Theme) {
    const now = Date.now();
    if (lastLayout && lastLayoutWidth === width && now - lastLayoutTimestamp < 50) return lastLayout;
    lastLayoutWidth = width;
    lastLayout = computeResponsiveLayout(buildSegmentContext(currentCtx, theme), width);
    lastLayoutTimestamp = now;
    return lastLayout;
  }

  function setupCustomEditor(ctx: any) {
    import("@mariozechner/pi-coding-agent").then(({ CustomEditor }) => {
      let currentEditor: any = null;
      let autocompleteFixed = false;

      const editorFactory = (tui: any, editorTheme: EditorTheme, keybindings: any) => {
        const editor = new CustomEditor(tui, editorTheme, keybindings);
        currentEditor = editor;

        const originalHandleInput = editor.handleInput.bind(editor);
        editor.handleInput = (data: string) => {
          if (!autocompleteFixed && !(editor as any).autocompleteProvider) {
            autocompleteFixed = true;
            ctx.ui.setEditorComponent(editorFactory);
            currentEditor?.handleInput(data);
            return;
          }
          originalHandleInput(data);
        };

        const originalRender = editor.render.bind(editor);
        editor.render = (width: number): string[] => {
          if (width < 10) return originalRender(width);
          const lines = originalRender(width);
          if (!lines.length || !currentCtx) return lines;

          let bottomBorderIndex = lines.length - 1;
          for (let i = lines.length - 1; i >= 1; i--) {
            const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
            if (stripped && /^─{3,}/.test(stripped)) { bottomBorderIndex = i; break; }
          }

          const promptPrefix = " \x1b[38;2;200;200;200m>\x1b[0m ";
          const contPrefix = "   ";
          const border = (text: string) => editorTheme.borderColor(text);
          const { topContent } = getLayout(width, ctx.ui.theme);
          const result = [topContent];

          const promptRow = (prefix: string, inner: string) => {
            const innerWidth = Math.max(1, width - visibleWidth(prefix));
            const clipped = truncateToWidth(inner, innerWidth, "");
            return prefix + clipped + " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
          };
          const borderRow = (line: string) => line + border("─".repeat(Math.max(0, width - visibleWidth(line))));

          result.push(borderRow(lines[0] || ""));
          for (let i = 1; i < bottomBorderIndex; i++) result.push(promptRow(i === 1 ? promptPrefix : contPrefix, lines[i] || ""));
          if (bottomBorderIndex === 1) result.push(promptRow(promptPrefix, ""));
          result.push(borderRow(lines[bottomBorderIndex] || ""));
          for (let i = bottomBorderIndex + 1; i < lines.length; i++) result.push(lines[i] || "");
          return result;
        };

        return editor;
      };

      ctx.ui.setEditorComponent(editorFactory);

      ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
        footerDataRef = footerData;
        tuiRef = tui;
        const dispose = footerData.onBranchChange(() => tui.requestRender());
        return { dispose, invalidate() {}, render(): string[] { return []; } };
      });

      ctx.ui.setWidget("powerline-secondary", (_tui: any, theme: Theme) => ({
        dispose() {},
        invalidate() {},
        render(width: number): string[] {
          if (!currentCtx) return [];
          const { secondaryContent } = getLayout(width, theme);
          return secondaryContent ? [secondaryContent] : [];
        },
      }), { placement: "belowEditor" });

      ctx.ui.setWidget("powerline-status", () => ({
        dispose() {},
        invalidate() {},
        render(width: number): string[] {
          if (!footerDataRef) return [];
          const lines = [...footerDataRef.getExtensionStatuses().values()]
            .filter((value) => value && value.trimStart().startsWith("["))
            .map((value) => ` ${value}`)
            .filter((line) => visibleWidth(line) <= width);
          return lines;
        },
      }), { placement: "aboveEditor" });
    });
  }
}
