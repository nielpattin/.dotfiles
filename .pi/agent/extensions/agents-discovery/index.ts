import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const AGENTS_FILENAME = "AGENTS.md";

interface DiscoveredAgentsFile {
	path: string;
	content: string;
}

class AgentsDiscovery {
	private cwd = "";
	private loaded = new Set<string>();

	isInitialized(): boolean {
		return this.cwd.length > 0;
	}

	reset(cwd: string): void {
		this.cwd = this.resolvePath(cwd, process.cwd());
		this.loaded.clear();

		// Global AGENTS.md is already loaded by Pi.
		const globalAgents = join(homedir(), ".pi", "agent", AGENTS_FILENAME);
		if (existsSync(globalAgents)) {
			this.loaded.add(this.resolvePath(globalAgents, this.cwd));
		}

		// CWD + ancestor AGENTS.md files are already loaded by Pi.
		let dir = this.cwd;
		while (true) {
			const filePath = join(dir, AGENTS_FILENAME);
			if (existsSync(filePath)) {
				this.loaded.add(this.resolvePath(filePath, this.cwd));
			}

			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}

	discover(inputPath: string): DiscoveredAgentsFile[] {
		if (!this.cwd) return [];

		const target = this.resolvePath(inputPath, this.cwd);
		if (!target) return [];

		if (basename(target).toLowerCase() === AGENTS_FILENAME.toLowerCase()) {
			this.loaded.add(target);
			return [];
		}

		const readDir = this.getReadDirectory(target);
		if (!this.isInside(readDir, this.cwd)) {
			return [];
		}

		const candidates: string[] = [];
		let dir = readDir;
		while (this.isInside(dir, this.cwd)) {
			const filePath = join(dir, AGENTS_FILENAME);
			if (existsSync(filePath)) {
				candidates.push(this.resolvePath(filePath, this.cwd));
			}

			if (dir === this.cwd) break;

			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}

		candidates.reverse(); // root -> leaf order

		const discovered: DiscoveredAgentsFile[] = [];
		for (const candidate of candidates) {
			if (this.loaded.has(candidate)) continue;
			if (!existsSync(candidate)) continue;

			try {
				const content = readFileSync(candidate, "utf-8");
				this.loaded.add(candidate);
				discovered.push({ path: candidate, content });
			} catch {
				// Ignore unreadable files silently.
			}
		}

		return discovered;
	}

	toDisplayPath(filePath: string): string {
		const rel = relative(this.cwd, filePath);
		if (!rel || rel === "") return AGENTS_FILENAME;
		if (!rel.startsWith("..") && !isAbsolute(rel)) return rel;

		const home = normalize(homedir());
		const normalized = normalize(filePath);
		if (normalized.startsWith(home)) {
			return `~${normalized.slice(home.length)}`;
		}

		return filePath;
	}

	private resolvePath(pathValue: string, baseDir: string): string {
		if (!pathValue) return "";

		let value = pathValue.trim();
		if (value.startsWith("@")) {
			value = value.slice(1);
		}
		if (value === "~") {
			value = homedir();
		} else if (value.startsWith("~/")) {
			value = join(homedir(), value.slice(2));
		}

		const absolute = isAbsolute(value) ? value : resolve(baseDir, value);
		const normalized = normalize(absolute);
		try {
			return realpathSync(normalized);
		} catch {
			return normalized;
		}
	}

	private getReadDirectory(target: string): string {
		try {
			if (existsSync(target) && statSync(target).isDirectory()) {
				return target;
			}
		} catch {
			// Fall through to dirname
		}
		return dirname(target);
	}

	private isInside(target: string, root: string): boolean {
		const rel = relative(root, target);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	}
}

export default function (pi: ExtensionAPI): void {
	const discovery = new AgentsDiscovery();

	const reset = (_event: unknown, ctx: { cwd: string }) => {
		discovery.reset(ctx.cwd);
	};

	pi.on("session_start", reset);
	pi.on("session_switch", reset);

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "read" || event.isError) return undefined;

		const maybePath = event.input.path;
		if (typeof maybePath !== "string" || maybePath.trim() === "") {
			return undefined;
		}

		if (!ctx.cwd) return undefined;
		if (!discovery.isInitialized()) {
			discovery.reset(ctx.cwd);
		}

		const discovered = discovery.discover(maybePath);
		if (discovered.length === 0) return undefined;

		const additions = discovered.map((file) => {
			const label = discovery.toDisplayPath(file.path);
			return {
				type: "text" as const,
				text: `<system-reminder>\nInstructions from: ${label}\n\n${file.content}\n</system-reminder>`,
			};
		});

		if (ctx.hasUI) {
			const labels = discovered.map((file) => discovery.toDisplayPath(file.path));
			ctx.ui.notify(`Loaded subdirectory AGENTS.md: ${labels.join(", ")}`, "info");
		}

		return {
			content: [...event.content, ...additions],
			details: event.details,
		};
	});
}
