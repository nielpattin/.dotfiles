import { keyHint } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import {
	type DelegationMode,
	type DisplayItem,
	type SingleResult,
	getDisplayItems,
	getFailureCategory,
	getFinalOutput,
	isResultError,
} from "../types.js";
import {
	cleanSingleLine,
	firstContentLine,
	formatDuration,
	formatFailureLineLabel,
	formatModelDisplay,
	formatTokens,
	getDisplaySummary,
	getResultDelegationMode,
	humanizeAgentName,
	shortenPath,
	shortenSessionName,
	truncateText,
	splitOutputLines,
} from "./format.js";
import {
	type CardAccent,
	type RenderTheme,
	type ThemeFg,
	colorizeRgb,
	getCardAccent,
	joinLeftRight,
	padAnsi,
} from "./theme.js";

const COLLAPSED_CARD_LIMIT = 4;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAME_MS = 80;

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
			title: `${theme.fg("error", "✕ ")}${colorizeRgb(baseTitle, accent.title)}`,
			status: "",
		};
	}
	return {
		title: `${colorizeRgb(baseTitle, accent.title)} ${theme.fg("dim", "|")} ${theme.fg("success", "Done")}`,
		status: "",
	};
}

export function formatToolCall(toolName: string, args: Record<string, unknown>, fg: ThemeFg): string {
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

export function renderDisplayItems(
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

function cardTaskLine(r: SingleResult, theme: RenderTheme): string | null {
	const preview = truncateText(cleanSingleLine(r.task), 240);
	if (!preview) return null;
	return truncateToWidth(
		theme.fg("muted", "Task: ") + theme.fg("text", preview),
		500,
	);
}

function cardSessionLine(
	r: SingleResult,
	fallbackDelegationMode: DelegationMode,
	theme: RenderTheme,
): string {
	const delegationMode = getResultDelegationMode(r, fallbackDelegationMode);
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
		const label = formatFailureLineLabel(r);
		const message = cleanSingleLine(r.errorMessage || r.stderr || r.stopReason || "failed");
		return theme.fg("error", `${label}: ${message || "failed"}`);
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
	fallbackDelegationMode: DelegationMode,
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
	const row = (content: string) => colorizeRgb("▌", accent.stripe) + " " + padAnsi(content, contentWidth);

	const lines = [row(joinLeftRight(title, status, contentWidth))];
	if (taskLine) lines.push(row(taskLine));
	lines.push(
		row(cardSessionLine(r, fallbackDelegationMode, theme)),
		row(cardActivityLine(r, theme)),
		row(cardFooterLine(r, theme, contentWidth)),
	);
	return lines;
}

export function hasExpandableContent(results: SingleResult[]): boolean {
	return results.some((r) => {
		if (r.skillLoad?.requested.length) return true;
		if (r.errorMessage) return true;
		const displayItems = getDisplayItems(r.messages);
		if (displayItems.length > 0) return true;
		return Boolean(getFinalOutput(r.messages).trim());
	});
}

export class SummaryCardsComponent {
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
			lines.push(this.theme.fg("muted", `(${keyHint("expandTools", "to expand")})`));
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
