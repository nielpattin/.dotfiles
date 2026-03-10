import * as os from "node:os";
import { getModels } from "@mariozechner/pi-ai";
import {
	type DelegationMode,
	type SingleResult,
	type UsageStats,
	DEFAULT_DELEGATION_MODE,
	getFailureCategory,
} from "../types.js";

export function formatTokens(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return "0";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsage(usage: Partial<UsageStats>, model?: string): string {
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

export function truncateText(text: string, maxLen: number): string {
	return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

export function cleanSingleLine(text: string): string {
	return text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

export function firstContentLine(text: string): string {
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const trimmed = cleanSingleLine(line);
		if (trimmed) return trimmed;
	}
	return "";
}

export function shortenPath(p: string): string {
	const home = os.homedir();
	if (p.startsWith(home)) return `~${p.slice(home.length)}`;

	const normalizedPath = p.replace(/\\/g, "/");
	const normalizedHome = home.replace(/\\/g, "/");
	return normalizedPath.startsWith(normalizedHome)
		? `~${normalizedPath.slice(normalizedHome.length)}`
		: p;
}

export function normalizeDelegationMode(raw: unknown): DelegationMode {
	return raw === "fork" ? "fork" : DEFAULT_DELEGATION_MODE;
}

export function getResultDelegationMode(
	r: Pick<SingleResult, "delegationMode">,
	fallback: DelegationMode,
): DelegationMode {
	return normalizeDelegationMode(r.delegationMode ?? fallback);
}

export function formatSkillList(items: string[]): string {
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

export function formatModelDisplay(model?: string, providerHint?: string): string | undefined {
	const { provider, modelId } = splitModelRef(model, providerHint);
	const registeredName = lookupRegisteredModelName(provider, modelId);
	const displayModel = formatModelName(modelId, registeredName);
	const displayProvider = formatProviderName(provider, registeredName);
	if (displayModel && displayProvider) return `${displayModel} (${displayProvider})`;
	return displayModel ?? displayProvider;
}

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0s";
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
	if (minutes > 0) return `${minutes}m${seconds}s`;
	return `${seconds}s`;
}

export function humanizeAgentName(name: string): string {
	const words = name
		.split(/[\s_-]+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (words.length === 0) return "Agent";
	return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

export function splitOutputLines(text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function firstSentence(text: string): string {
	const compact = cleanSingleLine(text);
	if (!compact) return "";
	const match = compact.match(/^(.+?[.!?])(?=\s|$)/);
	return match?.[1] ?? compact;
}

export function shortenSessionName(name: string, maxLen = 24): string {
	return truncateText(firstSentence(name), maxLen);
}

export function getDisplaySummary(summary: unknown): string {
	const cleaned = typeof summary === "string" ? cleanSingleLine(summary) : "";
	return cleaned.length > 0 ? cleaned : "(missing summary)";
}

export function formatFailureCategory(category: ReturnType<typeof getFailureCategory>): string {
	switch (category) {
		case "validation":
			return "validation";
		case "startup":
			return "startup";
		case "abort":
			return "abort";
		case "runtime":
			return "runtime";
		default:
			return "failed";
	}
}

export function formatFailureLineLabel(r: SingleResult): string {
	switch (getFailureCategory(r)) {
		case "validation":
			return "Validation failure";
		case "startup":
			return "Startup failure";
		case "abort":
			return "Aborted";
		case "runtime":
			return "Runtime failure";
		default:
			return "Failure";
	}
}
