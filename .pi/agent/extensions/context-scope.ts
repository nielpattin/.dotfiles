import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ContextScopeMode = "cwd-only" | "all";

const CONTEXT_SECTION_HEADER = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";
const SKILLS_SECTION_MARKER = "\n\nThe following skills provide specialized instructions for specific tasks.";
const DATE_TIME_MARKER = "\nCurrent date and time:";
const PATH_HEADING_PATTERN = /^## ((?:[A-Za-z]:\\[^\r\n]+)|(?:\/[^\r\n]+))$/gm;

interface ParsedContextEntry {
	path: string;
	block: string;
}

function getAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return join(homedir(), envDir.slice(2));
		return envDir;
	}
	return join(homedir(), ".pi", "agent");
}

function getAllowedContextPaths(cwd: string): Set<string> {
	return new Set([join(getAgentDir(), "AGENTS.md"), join(cwd, "AGENTS.md")].map((path) => resolve(path)));
}

function getContextSectionRange(prompt: string): { start: number; end: number; body: string } | undefined {
	const start = prompt.indexOf(CONTEXT_SECTION_HEADER);
	if (start === -1) {
		return undefined;
	}

	const bodyStart = start + CONTEXT_SECTION_HEADER.length;
	const skillsIndex = prompt.indexOf(SKILLS_SECTION_MARKER, bodyStart);
	const dateIndex = prompt.lastIndexOf(DATE_TIME_MARKER);
	const endCandidates = [skillsIndex, dateIndex, prompt.length].filter((index) => index >= bodyStart);
	const end = Math.min(...endCandidates);

	if (!Number.isFinite(end) || end <= bodyStart) {
		return undefined;
	}

	return {
		start,
		end,
		body: prompt.slice(bodyStart, end),
	};
}

function parseContextEntries(body: string): ParsedContextEntry[] {
	const matches: Array<{ path: string; start: number }> = [];

	for (const match of body.matchAll(PATH_HEADING_PATTERN)) {
		const [_, rawPath] = match;
		if (typeof rawPath !== "string" || typeof match.index !== "number") {
			continue;
		}
		matches.push({ path: resolve(rawPath), start: match.index });
	}

	if (matches.length === 0) {
		return [];
	}

	return matches.map((match, index) => ({
		path: match.path,
		block: body.slice(match.start, matches[index + 1]?.start ?? body.length),
	}));
}

function filterContextFilesFromPrompt(prompt: string, cwd: string): string {
	const section = getContextSectionRange(prompt);
	if (!section) {
		return prompt;
	}

	const entries = parseContextEntries(section.body);
	if (entries.length === 0) {
		return prompt;
	}

	const allowedPaths = getAllowedContextPaths(cwd);
	const keptEntries = entries.filter((entry) => allowedPaths.has(entry.path));

	if (keptEntries.length === entries.length) {
		return prompt;
	}

	const replacement = keptEntries.length > 0 ? CONTEXT_SECTION_HEADER + keptEntries.map((entry) => entry.block).join("") : "";
	return prompt.slice(0, section.start) + replacement + prompt.slice(section.end);
}

export default function contextScopeExtension(pi: ExtensionAPI) {
	let mode: ContextScopeMode = "cwd-only";

	pi.registerCommand("context-scope", {
		description: "Control AGENTS.md prompt scope: cwd-only or all",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();

			if (value === "" || value === "status") {
				ctx.ui.notify(`Context scope: ${mode}\n\nModes:\n  /context-scope cwd-only\n  /context-scope all`, "info");
				return;
			}

			if (value === "cwd" || value === "cwd-only" || value === "current") {
				mode = "cwd-only";
				ctx.ui.notify("Context scope set to cwd-only. Pi will keep ~/.pi/agent/AGENTS.md and the current directory AGENTS.md in the effective system prompt.", "info");
				return;
			}

			if (value === "all" || value === "default") {
				mode = "all";
				ctx.ui.notify("Context scope set to all. Pi will use the full discovered AGENTS.md chain again.", "info");
				return;
			}

			ctx.ui.notify("Usage:\n  /context-scope status\n  /context-scope cwd-only\n  /context-scope all", "warning");
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (mode === "all") {
			return undefined;
		}

		const filteredPrompt = filterContextFilesFromPrompt(event.systemPrompt, ctx.cwd);
		if (filteredPrompt === event.systemPrompt) {
			return undefined;
		}

		return { systemPrompt: filteredPrompt };
	});
}
