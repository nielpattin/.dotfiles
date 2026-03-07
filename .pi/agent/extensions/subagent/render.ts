/**
 * TUI rendering for subagent tool calls and results.
 */

import * as os from "node:os";
import { getModels } from "@mariozechner/pi-ai";
import { getMarkdownTheme, keyHint } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Markdown,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import {
	type DelegationMode,
	type DisplayItem,
	type SingleResult,
	type SubagentDetails,
	type UsageStats,
	DEFAULT_DELEGATION_MODE,
	aggregateUsage,
	getDisplayItems,
	getFinalOutput,
	isResultError,
} from "./types.js";

const COLLAPSED_CARD_LIMIT = 4;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAME_MS = 80;

type ThemeFg = (color: string, text: string) => string;
type RenderTheme = { fg: ThemeFg; bold: (s: string) => string };
type Rgb = { r: number; g: number; b: number };
type CardAccent = { title: Rgb; stripe: Rgb };

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTokens(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "0";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsage(usage: Partial<UsageStats>, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function truncateText(text: string, maxLen: number): string {
	return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function cleanSingleLine(text: string): string {
	return text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

function firstContentLine(text: string): string {
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const trimmed = cleanSingleLine(line);
		if (trimmed) return trimmed;
	}
	return "";
}

function shortenPath(p: string): string {
	const home = os.homedir();
	if (p.startsWith(home)) return `~${p.slice(home.length)}`;

	const normalizedPath = p.replace(/\\/g, "/");
	const normalizedHome = home.replace(/\\/g, "/");
	return normalizedPath.startsWith(normalizedHome)
		? `~${normalizedPath.slice(normalizedHome.length)}`
		: p;
}

function normalizeDelegationMode(raw: unknown): DelegationMode {
	return raw === "fork" ? "fork" : DEFAULT_DELEGATION_MODE;
}

function formatSkillList(items: string[]): string {
	return items.length > 0 ? items.join(", ") : "(none)";
}

function splitModelRef(model?: string, providerHint?: string): { provider?: string; modelId?: string } {
	if (!model) return providerHint ? { provider: providerHint } : {};
	const trimmed = cleanSingleLine(model);
	if (!trimmed) return providerHint ? { provider: providerHint } : {};
	const slash = trimmed.lastIndexOf("/");
	if (slash >= 0) {
		return {
			provider: trimmed.slice(0, slash),
			modelId: trimmed.slice(slash + 1),
		};
	}
	return { provider: providerHint, modelId: trimmed };
}

function splitNamedModel(displayName: string): { providerName?: string; modelName?: string } {
	const trimmed = cleanSingleLine(displayName);
	if (!trimmed) return {};
	const colon = trimmed.indexOf(":");
	if (colon < 0) return { modelName: trimmed };
	return {
		providerName: cleanSingleLine(trimmed.slice(0, colon)),
		modelName: cleanSingleLine(trimmed.slice(colon + 1)),
	};
}

function lookupRegisteredModelName(provider?: string, modelId?: string): string | undefined {
	if (!provider || !modelId) return undefined;
	try {
		const models = getModels(provider as any) as Array<{ id?: string; name?: string }>;
		const match = models.find((model) => cleanSingleLine(model.id || "") === modelId);
		return typeof match?.name === "string" ? cleanSingleLine(match.name) : undefined;
	} catch {
		return undefined;
	}
}

function formatProviderName(provider?: string, registeredName?: string): string | undefined {
	const named = registeredName ? splitNamedModel(registeredName).providerName : undefined;
	if (named) return named;
	if (!provider) return undefined;
	const trimmed = cleanSingleLine(provider);
	if (!trimmed) return undefined;
	return trimmed
		.split(/[\-_\/]+/)
		.map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
		.join(" ");
}

function formatModelName(modelId?: string, registeredName?: string): string | undefined {
	const named = registeredName ? splitNamedModel(registeredName).modelName : undefined;
	if (named) return named;
	if (!modelId) return undefined;
	const trimmed = cleanSingleLine(modelId);
	if (!trimmed) return undefined;
	return trimmed
		.split(/[\-_]+/)
		.map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
		.join(" ");
}

function formatModelDisplay(model?: string, providerHint?: string): string | undefined {
	const { provider, modelId } = splitModelRef(model, providerHint);
	const registeredName = lookupRegisteredModelName(provider, modelId);
	const displayModel = formatModelName(modelId, registeredName);
	const displayProvider = formatProviderName(provider, registeredName);
	if (displayModel && displayProvider) return `${displayModel} (${displayProvider})`;
	return displayModel ?? displayProvider;
}

function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0s";
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
	if (minutes > 0) return `${minutes}m${seconds}s`;
	return `${seconds}s`;
}

function humanizeAgentName(name: string): string {
	const words = name
		.split(/[\s_-]+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (words.length === 0) return "Agent";
	return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function padAnsi(text: string, width: number): string {
	const truncated = truncateToWidth(text, width);
	const pad = Math.max(0, width - visibleWidth(truncated));
	return truncated + " ".repeat(pad);
}

function joinLeftRight(left: string, right: string, width: number): string {
	if (width <= 0) return "";
	if (!left) return truncateToWidth(right, width);
	if (!right) return truncateToWidth(left, width);

	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width);

	const leftMaxWidth = Math.max(0, width - rightWidth - 1);
	const truncatedLeft = truncateToWidth(left, leftMaxWidth);
	const gap = Math.max(1, width - visibleWidth(truncatedLeft) - rightWidth);
	return truncatedLeft + " ".repeat(gap) + right;
}

function colorizeRgb(text: string, rgb: Rgb): string {
	const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
	const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
	const b = Math.max(0, Math.min(255, Math.round(rgb.b)));
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function hashString(text: string): number {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hslToRgb(h: number, s: number, l: number): Rgb {
	const hue = ((h % 360) + 360) % 360;
	const sat = Math.max(0, Math.min(1, s));
	const light = Math.max(0, Math.min(1, l));
	const c = (1 - Math.abs(2 * light - 1)) * sat;
	const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = light - c / 2;

	let r1 = 0;
	let g1 = 0;
	let b1 = 0;
	if (hue < 60) {
		r1 = c;
		g1 = x;
	} else if (hue < 120) {
		r1 = x;
		g1 = c;
	} else if (hue < 180) {
		g1 = c;
		b1 = x;
	} else if (hue < 240) {
		g1 = x;
		b1 = c;
	} else if (hue < 300) {
		r1 = x;
		b1 = c;
	} else {
		r1 = c;
		b1 = x;
	}

	return {
		r: (r1 + m) * 255,
		g: (g1 + m) * 255,
		b: (b1 + m) * 255,
	};
}

function getDisplaySummary(summary: unknown): string {
	const cleaned = typeof summary === "string" ? cleanSingleLine(summary) : "";
	return cleaned.length > 0 ? cleaned : "(missing summary)";
}

function getCardAccent(index: number, r: SingleResult): CardAccent {
	const seedText = [r.agent, r.task, r.summary, String(index)].join("|");
	const random = createSeededRandom(hashString(seedText));
	const hue = random() * 360;
	const saturation = 0.86 + random() * 0.12;
	const lightness = 0.62 + random() * 0.1;
	return {
		title: hslToRgb(hue, saturation, lightness),
		stripe: hslToRgb(hue + 8 + random() * 18, saturation, Math.max(0.42, lightness - 0.16)),
	};
}

function getSpinnerFrame(r: SingleResult, now = Date.now()): string {
	const startTs = Number.isFinite(r.startedAt) ? r.startedAt : now;
	const frame = Math.floor(Math.max(0, now - startTs) / SPINNER_FRAME_MS);
	return SPINNER[frame % SPINNER.length] ?? SPINNER[0]!;
}

function getCardHeader(r: SingleResult, accent: CardAccent, theme: RenderTheme): { title: string; status: string } {
	const agentName = humanizeAgentName(r.agent);
	const baseTitle = `${agentName} — ${getDisplaySummary(r.summary)}`;
	if (r.exitCode === -1) {
		const spinner = theme.fg("warning", getSpinnerFrame(r));
		return { title: `${spinner} ${colorizeRgb(baseTitle, accent.title)}`, status: "" };
	}
	if (isResultError(r)) {
		return {
			title: theme.fg("error", `# ${baseTitle}`),
			status: theme.fg("error", "failed"),
		};
	}
	return {
		title: `${colorizeRgb(baseTitle, accent.title)} ${theme.fg("dim", "|")} ${theme.fg("success", "Done")}`,
		status: "",
	};
}

function formatToolCall(toolName: string, args: Record<string, unknown>, fg: ThemeFg): string {
	const pathArg = (args.file_path || args.path || "...") as string;

	switch (toolName) {
		case "bash": {
			const cmd = cleanSingleLine((args.command as string) || "...");
			return fg("muted", "$ ") + fg("toolOutput", truncateText(cmd, 60));
		}
		case "read": {
			let text = fg("accent", shortenPath(pathArg));
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
			}
			return fg("muted", "read ") + text;
		}
		case "write": {
			const lines = ((args.content || "") as string).split("\n").length;
			let text = fg("muted", "write ") + fg("accent", shortenPath(pathArg));
			if (lines > 1) text += fg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit":
			return fg("muted", "edit ") + fg("accent", shortenPath(pathArg));
		case "ls":
			return fg("muted", "ls ") + fg("accent", shortenPath((args.path || ".") as string));
		case "find":
			return (
				fg("muted", "find ") +
				fg("accent", (args.pattern || "*") as string) +
				fg("dim", ` in ${shortenPath((args.path || ".") as string)}`)
			);
		case "grep":
			return (
				fg("muted", "grep ") +
				fg("accent", `/${(args.pattern || "") as string}/`) +
				fg("dim", ` in ${shortenPath((args.path || ".") as string)}`)
			);
		default:
			return fg("accent", toolName) + fg("dim", ` ${truncateText(cleanSingleLine(JSON.stringify(args)), 50)}`);
	}
}

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

function splitOutputLines(text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function firstSentence(text: string): string {
	const compact = cleanSingleLine(text);
	if (!compact) return "";
	const match = compact.match(/^(.+?[.!?])(?=\s|$)/);
	return match ? match[1] : compact;
}

function shortenSessionName(name: string, maxLen = 24): string {
	return truncateText(firstSentence(name), maxLen);
}

function renderDisplayItems(
	items: DisplayItem[],
	theme: { fg: ThemeFg },
	limit?: number,
): string {
	const lines: string[] = [];
	for (const item of items) {
		if (item.type === "text") {
			for (const line of splitOutputLines(item.text)) {
				lines.push(theme.fg("toolOutput", line));
			}
		} else {
			lines.push(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)));
		}
	}

	const shouldTail = typeof limit === "number";
	const toShow = shouldTail ? lines.slice(-limit) : lines;
	const skipped = shouldTail && lines.length > limit ? lines.length - limit : 0;

	let text = "";
	if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier lines\n`);
	text += toShow.join("\n");
	return text.trimEnd();
}

function sessionIdentity(r: SingleResult): string | null {
	if (r.sessionName) return shortenSessionName(r.sessionName);
	if (r.sessionId) return `#${r.sessionId.slice(0, 8)}`;
	return null;
}

function cardTaskLine(_r: SingleResult, _theme: RenderTheme): string | null {
	return null;
}

function cardSessionLine(
	r: SingleResult,
	delegationMode: DelegationMode,
	theme: RenderTheme,
): string {
	const session = sessionIdentity(r);
	if (session) {
		const parts = [session, delegationMode];
		return theme.fg("muted", "Session: ") + theme.fg("dim", parts.join(" • "));
	}

	const parts = [delegationMode];
	return theme.fg("muted", "Source: ") + theme.fg("dim", parts.join(" • "));
}

function cardActivityLine(r: SingleResult, theme: RenderTheme): string {
	if (isResultError(r)) {
		const message = cleanSingleLine(r.errorMessage || r.stderr || r.stopReason || "failed");
		return theme.fg("error", `Error: ${message || "failed"}`);
	}

	if (r.lastTool) {
		const toolTitleFg: ThemeFg = (_color, text) => theme.fg("toolTitle", text);
		return truncateToWidth(
			theme.fg("toolTitle", "└ ● ") +
				formatToolCall(r.lastTool.name, r.lastTool.args, toolTitleFg),
			500,
		);
	}

	const finalPreview = firstContentLine(getFinalOutput(r.messages));
	if (finalPreview) {
		return theme.fg("muted", "Result: ") + theme.fg("toolOutput", finalPreview);
	}

	if (r.exitCode === -1) return theme.fg("dim", "Current: waiting for first tool call");
	return theme.fg("dim", "Result: completed");
}

function cardFooterLine(r: SingleResult, theme: RenderTheme, contentWidth: number): string {
	const endTs = r.exitCode === -1
		? Date.now()
		: Number.isFinite(r.updatedAt)
			? r.updatedAt
			: Date.now();
	const startTs = Number.isFinite(r.startedAt) ? r.startedAt : endTs;

	const parts: string[] = [theme.fg("dim", `◷ ${formatDuration(Math.max(0, endTs - startTs))}`)];
	const modelLabel = formatModelDisplay(r.model, r.provider);
	if (modelLabel) {
		parts.push(theme.fg("dim", `◈ ${modelLabel}`));
	}
	if (r.thinking) parts.push(theme.fg("dim", ` ${r.thinking}`));

	const tokenParts: string[] = [];
	if (r.usage.input > 0) tokenParts.push(`↑${formatTokens(r.usage.input)}`);
	if (r.usage.output > 0) tokenParts.push(`↓${formatTokens(r.usage.output)}`);
	if (r.usage.cacheRead > 0) tokenParts.push(`R${formatTokens(r.usage.cacheRead)}`);
	if (r.usage.cacheWrite > 0) tokenParts.push(`W${formatTokens(r.usage.cacheWrite)}`);
	if (tokenParts.length > 0) parts.push(theme.fg("dim", tokenParts.join(" ")));

	return truncateToWidth(parts.join(theme.fg("dim", " : ")), contentWidth);
}

function renderCard(
	r: SingleResult,
	index: number,
	width: number,
	delegationMode: DelegationMode,
	theme: RenderTheme,
): string[] {
	const accent = getCardAccent(index, r);
	const { title, status } = getCardHeader(r, accent, theme);
	const taskLine = cardTaskLine(r, theme);

	if (width < 28) {
		const lines = [
			truncateToWidth(joinLeftRight(title, status, width), width),
			truncateToWidth(cardActivityLine(r, theme), width),
			truncateToWidth(cardFooterLine(r, theme, width), width),
		];
		if (taskLine) lines.splice(1, 0, truncateToWidth(taskLine, width));
		return lines;
	}

	const contentWidth = Math.max(1, width - 2);
	const stripe = (text: string) =>
		isResultError(r) ? theme.fg("error", text) : colorizeRgb(text, accent.stripe);
	const row = (content: string) => stripe("▌") + " " + padAnsi(content, contentWidth);

	const lines = [row(joinLeftRight(title, status, contentWidth))];
	if (taskLine) lines.push(row(taskLine));
	lines.push(
		row(cardSessionLine(r, delegationMode, theme)),
		row(cardActivityLine(r, theme)),
		row(cardFooterLine(r, theme, contentWidth)),
	);
	return lines;
}

function hasExpandableContent(results: SingleResult[]): boolean {
	return results.some((r) => {
		if (r.skillLoad?.requested.length) return true;
		if (r.errorMessage) return true;
		const displayItems = getDisplayItems(r.messages);
		if (displayItems.length > 0) return true;
		return Boolean(getFinalOutput(r.messages).trim());
	});
}

class SummaryCardsComponent {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly results: SingleResult[],
		private readonly delegationMode: DelegationMode,
		private readonly theme: RenderTheme,
		private readonly expanded: boolean,
		private readonly showExpandHint: boolean,
	) {}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const visibleResults = this.expanded ? this.results : this.results.slice(0, COLLAPSED_CARD_LIMIT);
		const lines: string[] = [];

		visibleResults.forEach((r, index) => {
			if (index > 0) lines.push("");
			lines.push(...renderCard(r, index, width, this.delegationMode, this.theme));
		});

		const hiddenCount = this.results.length - visibleResults.length;
		if (hiddenCount > 0) {
			lines.push("");
			lines.push(
				this.theme.fg(
					"muted",
					`... ${hiddenCount} more task${hiddenCount === 1 ? "" : "s"} (${keyHint("expandTools", "to expand")})`,
				),
			);
		} else if (!this.expanded && this.showExpandHint) {
			lines.push("");
			lines.push(this.theme.fg("muted", `(${keyHint("expandTools", "for full trace")})`));
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ---------------------------------------------------------------------------
// renderCall — shown while the tool is being invoked
// ---------------------------------------------------------------------------

export function renderCall(args: Record<string, any>, theme: RenderTheme): Text {
	const delegationMode = normalizeDelegationMode(args.mode);
	const modeBadge = theme.fg("muted", ` [${delegationMode}]`);
	const prefix = theme.fg("toolTitle", theme.bold("Task")) + theme.fg("muted", " • ");

	if (args.tasks && args.tasks.length > 0) {
		const names = args.tasks.slice(0, 4).map((task: { agent: string }) => task.agent).join(", ");
		const overflow = args.tasks.length > 4 ? ", ..." : "";
		const summary = `${args.tasks.length} task${args.tasks.length === 1 ? "" : "s"}: ${names}${overflow}`;
		return new Text(prefix + theme.fg("accent", summary) + modeBadge, 0, 0);
	}

	const agentName = typeof args.agent === "string" ? args.agent : "(invalid task call)";
	const text = prefix + theme.fg("accent", `${agentName}`) + modeBadge;
	return new Text(text, 0, 0);
}

// ---------------------------------------------------------------------------
// renderResult — shown after the tool completes / while streaming
// ---------------------------------------------------------------------------

export function renderResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	expanded: boolean,
	_isPartial: boolean,
	theme: RenderTheme,
): Container | Text | SummaryCardsComponent {
	const details = result.details as SubagentDetails | undefined;
	if (!details || details.results.length === 0) {
		const first = result.content[0];
		return new Text(first?.type === "text" && first.text ? first.text : "(no output)", 0, 0);
	}

	const delegationMode = normalizeDelegationMode((details as Partial<SubagentDetails>).delegationMode);
	if (details.mode === "single") {
		const first = details.results[0];
		if (!first) {
			const firstContent = result.content[0];
			return new Text(firstContent?.type === "text" && firstContent.text ? firstContent.text : "(no output)", 0, 0);
		}
		return renderSingleResult(first, delegationMode, expanded, theme);
	}
	return renderParallelResult(details, delegationMode, expanded, theme);
}

// ---------------------------------------------------------------------------
// Single-mode result
// ---------------------------------------------------------------------------

function renderSingleResult(
	r: SingleResult,
	delegationMode: DelegationMode,
	expanded: boolean,
	theme: RenderTheme,
): Container | SummaryCardsComponent {
	if (!expanded) {
		return new SummaryCardsComponent([r], delegationMode, theme, false, hasExpandableContent([r]));
	}
	return renderSingleExpanded(r, delegationMode, theme);
}

function appendCommonDetails(container: Container, r: SingleResult, theme: RenderTheme): void {
	const mdTheme = getMarkdownTheme();
	const displayItems = getDisplayItems(r.messages);
	const toolCalls = displayItems.filter((item): item is Extract<DisplayItem, { type: "toolCall" }> => item.type === "toolCall");
	const finalOutput = getFinalOutput(r.messages).trim();

	if (isResultError(r)) {
		const errorText = cleanSingleLine(r.errorMessage || r.stderr || r.stopReason || "failed");
		if (errorText) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("error", `Error: ${errorText}`), 0, 0));
		}
	}

	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
	container.addChild(new Text(theme.fg("text", r.task), 0, 0));

	if (r.skillLoad && r.skillLoad.requested.length > 0) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Skills ───"), 0, 0));
		container.addChild(new Text(theme.fg("dim", `lookup cwd: ${shortenPath(r.skillLoad.lookupCwd)}`), 0, 0));
		container.addChild(new Text(theme.fg("dim", `requested: ${formatSkillList(r.skillLoad.requested)}`), 0, 0));
		container.addChild(new Text(theme.fg("dim", `loaded: ${formatSkillList(r.skillLoad.loaded)}`), 0, 0));
		if (r.skillLoad.missing.length > 0) {
			container.addChild(new Text(theme.fg("warning", `missing: ${formatSkillList(r.skillLoad.missing)}`), 0, 0));
		}
		for (const warning of r.skillLoad.warnings) {
			container.addChild(new Text(theme.fg("warning", `! ${warning}`), 0, 0));
		}
	}

	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Tool Trace ───"), 0, 0));
	if (toolCalls.length === 0) {
		container.addChild(new Text(theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no tool calls)"), 0, 0));
	} else {
		container.addChild(new Text(renderDisplayItems(toolCalls, theme, undefined), 0, 0));
	}

	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
	if (finalOutput) {
		container.addChild(new Markdown(finalOutput, 0, 0, mdTheme));
	} else {
		container.addChild(new Text(theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)"), 0, 0));
	}

	const usageStr = formatUsage(r.usage, r.model);
	if (usageStr) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
	}
}

function renderSingleExpanded(
	r: SingleResult,
	delegationMode: DelegationMode,
	theme: RenderTheme,
): Container {
	const container = new Container();
	container.addChild(new SummaryCardsComponent([r], delegationMode, theme, true, false));
	appendCommonDetails(container, r, theme);
	return container;
}

// ---------------------------------------------------------------------------
// Parallel-mode result
// ---------------------------------------------------------------------------

function renderParallelResult(
	details: SubagentDetails,
	delegationMode: DelegationMode,
	expanded: boolean,
	theme: RenderTheme,
): Container | SummaryCardsComponent {
	if (!expanded) {
		return new SummaryCardsComponent(
			details.results,
			delegationMode,
			theme,
			false,
			hasExpandableContent(details.results) || details.results.length > COLLAPSED_CARD_LIMIT,
		);
	}
	return renderParallelExpanded(details, delegationMode, theme);
}

function renderParallelExpanded(
	details: SubagentDetails,
	delegationMode: DelegationMode,
	theme: RenderTheme,
): Container {
	const container = new Container();
	container.addChild(new SummaryCardsComponent(details.results, delegationMode, theme, true, false));

	for (const [index, r] of details.results.entries()) {
		const hasBody = Boolean(
			r.errorMessage ||
			r.skillLoad?.requested.length ||
			getDisplayItems(r.messages).length ||
			getFinalOutput(r.messages).trim(),
		);
		if (!hasBody) continue;

		container.addChild(new Spacer(1));
		const accent = getCardAccent(index, r);
		container.addChild(
			new Text(colorizeRgb(`─── ${humanizeAgentName(r.agent)} Details ───`, accent.title), 0, 0),
		);
		appendCommonDetails(container, r, theme);
	}

	const totalUsage = formatUsage(aggregateUsage(details.results));
	if (totalUsage) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", `Total: ${totalUsage}`), 0, 0));
	}

	return container;
}
