/**
 * Shared type definitions for the subagent extension.
 */

import type { Message } from "@mariozechner/pi-ai";

/** Context mode for delegated runs. */
export type DelegationMode = "spawn" | "fork";

/** Default context mode for delegated runs. */
export const DEFAULT_DELEGATION_MODE: DelegationMode = "spawn";

/** Aggregated token usage from a subagent run. */
export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

/** Skill preload telemetry attached to a delegated run. */
export interface SkillLoadInfo {
	lookupCwd: string;
	requested: string[];
	loaded: string[];
	missing: string[];
	warnings: string[];
}

/** Current or most recent tool activity observed from the child session stream. */
export interface ToolActivity {
	toolCallId?: string;
	name: string;
	args: Record<string, unknown>;
	startedAt: number;
	finishedAt?: number;
}

/** Result of a single subagent invocation. */
export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	summary: string;
	delegationMode?: DelegationMode;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	startedAt: number;
	updatedAt: number;
	sessionId?: string;
	sessionName?: string;
	skillLoad?: SkillLoadInfo;
	activeTool?: ToolActivity;
	lastTool?: ToolActivity;
	model?: string;
	provider?: string;
	thinking?: string;
	stopReason?: string;
	errorMessage?: string;
}

/** Metadata attached to every tool result for rendering. */
export interface SubagentDetails {
	mode: "single" | "parallel";
	delegationMode: DelegationMode;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

/** A display-friendly representation of a message part. */
export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

/** Create an empty UsageStats object. */
export function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

/** Sum usage across multiple results. */
export function aggregateUsage(results: SingleResult[]): UsageStats {
	const total = emptyUsage();
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}

/** Whether a result represents an error. */
export function isResultError(r: SingleResult): boolean {
	return r.exitCode > 0 || r.stopReason === "error" || r.stopReason === "aborted";
}

function isObjectPart(part: unknown): part is Record<string, unknown> {
	return typeof part === "object" && part !== null;
}

/** Extract the last assistant text from a message history.
 * If assistant text is absent, return the last toolResult text.
 */
export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || msg.role !== "assistant") continue;
		for (const rawPart of msg.content) {
			if (!isObjectPart(rawPart)) continue;
			if (rawPart.type === "text" && typeof rawPart.text === "string") {
				return rawPart.text;
			}
		}
	}

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || msg.role !== "toolResult") continue;
		for (const rawPart of msg.content) {
			if (!isObjectPart(rawPart)) continue;
			if (rawPart.type === "text" && typeof rawPart.text === "string") {
				return rawPart.text;
			}
		}
	}

	return "";
}

/** Extract all display-worthy items from a message history. */
export function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];

	for (const msg of messages) {
		if (!msg) continue;

		if (msg.role === "assistant") {
			for (const rawPart of msg.content) {
				if (!isObjectPart(rawPart)) continue;

				if (rawPart.type === "text" && typeof rawPart.text === "string") {
					items.push({ type: "text", text: rawPart.text });
				} else if (
					rawPart.type === "toolCall" &&
					typeof rawPart.name === "string"
				) {
					items.push({
						type: "toolCall",
						name: rawPart.name,
						args:
							typeof rawPart.arguments === "object" && rawPart.arguments !== null
								? (rawPart.arguments as Record<string, unknown>)
								: {},
					});
				}
			}
		}

		if (msg.role === "toolResult") {
			for (const rawPart of msg.content) {
				if (!isObjectPart(rawPart)) continue;
				if (rawPart.type === "text" && typeof rawPart.text === "string") {
					items.push({ type: "text", text: rawPart.text });
				}
			}
		}
	}

	return items;
}
