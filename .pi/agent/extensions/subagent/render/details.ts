import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import {
	type DelegationMode,
	type DisplayItem,
	type SingleResult,
	type SubagentDetails,
	aggregateUsage,
	getDisplayItems,
	getFailureCategory,
	getFinalOutput,
	isResultError,
} from "../types.js";
import {
	SummaryCardsComponent,
	hasExpandableContent,
	renderDisplayItems,
} from "./cards.js";
import {
	cleanSingleLine,
	formatFailureCategory,
	formatSkillList,
	formatUsage,
	humanizeAgentName,
	normalizeDelegationMode,
	shortenPath,
} from "./format.js";
import { colorizeRgb, getCardAccent, type RenderTheme } from "./theme.js";

export function renderCall(args: Record<string, any>, theme: RenderTheme): Text {
	const prefix = theme.fg("toolTitle", theme.bold("Task")) + theme.fg("muted", " • ");
	const mode = typeof args.mode === "string" ? args.mode : "";

	if (mode === "single" && args.operation && typeof args.operation === "object") {
		const agentName = typeof args.operation.agent === "string" ? args.operation.agent : "(invalid operation)";
		return new Text(prefix + theme.fg("accent", `single: ${agentName}`), 0, 0);
	}

	if (mode === "parallel" && Array.isArray(args.operations)) {
		const names = args.operations.slice(0, 4).map((task: { agent: string }) => task.agent).join(", ");
		const overflow = args.operations.length > 4 ? ", ..." : "";
		const summary = `${args.operations.length} task${args.operations.length === 1 ? "" : "s"}: ${names}${overflow}`;
		return new Text(prefix + theme.fg("accent", `parallel: ${summary}`), 0, 0);
	}

	return new Text(prefix + theme.fg("accent", "(invalid task call)"), 0, 0);
}

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
	if (details.results.length === 1) {
		const first = details.results[0];
		if (!first) {
			const firstContent = result.content[0];
			return new Text(firstContent?.type === "text" && firstContent.text ? firstContent.text : "(no output)", 0, 0);
		}
		return renderSingleResult(first, delegationMode, expanded, theme);
	}
	return renderParallelResult(details, delegationMode, expanded, theme);
}

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
		const category = formatFailureCategory(getFailureCategory(r));
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("error", `Failure category: ${category}`), 0, 0));
		if (errorText) {
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
			hasExpandableContent(details.results) || details.results.length > 4,
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
