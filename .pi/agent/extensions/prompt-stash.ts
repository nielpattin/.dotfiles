/**
 * Prompt Stash Extension
 *
 * Primary UX:
 * - /stash-list opens a centered dialog with:
 *   1) Stash this (current editor prompt)
 *   2) Show prompts list
 * - Registers Prompt Stash actions in the modular command palette section
 *
 * Persistence:
 * - Global file: ~/.pi/agent/prompt-stash.jsonl
 * - JSONL format, one stash item per line
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, type SelectItem, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { registerCommandPaletteProvider } from "./command-palette/registry.js";

interface StashItem {
	id: number;
	text: string;
	createdAt: number;
}

// Legacy session-persisted shape, used for one-time migration fallback.
interface LegacyStashSnapshot {
	items?: unknown;
	nextId?: unknown;
}

const PREVIEW_MAX = 90;
const MAX_STASH_ENTRIES = 50;
const STASH_PATH = join(homedir(), ".pi", "agent", "prompt-stash.jsonl");

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function preview(text: string): string {
	const compact = oneLine(text);
	return compact.length <= PREVIEW_MAX ? compact : `${compact.slice(0, PREVIEW_MAX - 1)}…`;
}

function parseId(value: string): number | undefined {
	const id = Number.parseInt(value, 10);
	return Number.isFinite(id) ? id : undefined;
}

function isValidItem(value: unknown): value is StashItem {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<StashItem>;
	return typeof item.id === "number" && typeof item.text === "string" && typeof item.createdAt === "number";
}

function ensureStashDir(): void {
	mkdirSync(dirname(STASH_PATH), { recursive: true });
}

function writeAll(items: StashItem[]): void {
	ensureStashDir();
	const content = items.length > 0 ? `${items.map((item) => JSON.stringify(item)).join("\n")}\n` : "";
	writeFileSync(STASH_PATH, content, "utf-8");
}

function appendOne(item: StashItem): boolean {
	try {
		ensureStashDir();
		appendFileSync(STASH_PATH, `${JSON.stringify(item)}\n`, "utf-8");
		return true;
	} catch {
		return false;
	}
}

function loadFromDisk(): { items: StashItem[]; needsRewrite: boolean } {
	if (!existsSync(STASH_PATH)) {
		return { items: [], needsRewrite: false };
	}

	let text = "";
	try {
		text = readFileSync(STASH_PATH, "utf-8");
	} catch {
		return { items: [], needsRewrite: false };
	}

	const parsed: StashItem[] = [];
	let hadInvalid = false;

	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const value = JSON.parse(trimmed) as unknown;
			if (!isValidItem(value)) {
				hadInvalid = true;
				continue;
			}
			parsed.push({ ...value });
		} catch {
			hadInvalid = true;
		}
	}

	const limited = parsed.slice(-MAX_STASH_ENTRIES);
	const trimmed = limited.length !== parsed.length;
	return { items: limited, needsRewrite: hadInvalid || trimmed };
}

class CenterMenuDialog {
	private selected = 0;
	private scroll = 0;
	private readonly maxVisibleRows = 8;

	constructor(
		private readonly theme: Theme,
		private readonly title: string,
		private readonly options: SelectItem[],
		private readonly footer: string,
		private readonly done: (result: SelectItem | undefined) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done(undefined);
			return;
		}

		if (this.options.length === 0) {
			if (matchesKey(data, "return") || matchesKey(data, "enter")) {
				this.done(undefined);
			}
			return;
		}

		if (matchesKey(data, "up")) {
			this.selected = Math.max(0, this.selected - 1);
			this.ensureVisible();
			return;
		}
		if (matchesKey(data, "down")) {
			this.selected = Math.min(this.options.length - 1, this.selected + 1);
			this.ensureVisible();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.selected = Math.max(0, this.selected - this.maxVisibleRows);
			this.ensureVisible();
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.selected = Math.min(this.options.length - 1, this.selected + this.maxVisibleRows);
			this.ensureVisible();
			return;
		}

		if (matchesKey(data, "return") || matchesKey(data, "enter")) {
			this.done(this.options[this.selected]);
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerWidth = Math.max(24, width - 2);
		const visibleRows = Math.min(this.maxVisibleRows, Math.max(1, this.options.length));

		const row = (content: string, selected = false): string => {
			const truncated = truncateToWidth(content, innerWidth);
			const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
			const bgToken = selected ? "selectedBg" : "toolPendingBg";
			const bg = th.bg(bgToken, `${truncated}${pad}`);
			return `${th.fg("borderAccent", "│")}${bg}${th.fg("borderAccent", "│")}`;
		};

		const lines: string[] = [];
		lines.push(th.fg("borderAccent", `╭${"─".repeat(innerWidth)}╮`));
		lines.push(row(` ${th.bold(th.fg("accent", this.title))}`));
		lines.push(row(""));

		if (this.options.length === 0) {
			lines.push(row(` ${th.fg("dim", "No options")}`));
		} else {
			this.ensureVisible();
			for (let i = 0; i < visibleRows; i++) {
				const index = this.scroll + i;
				const option = this.options[index];
				if (!option) {
					lines.push(row(""));
					continue;
				}

				const isSelected = index === this.selected;
				const prefix = isSelected ? th.fg("accent", "›") : th.fg("dim", " ");
				const label = isSelected ? th.fg("accent", option.label) : th.fg("text", option.label);
				const desc = option.description ? ` ${th.fg("muted", option.description)}` : "";
				lines.push(row(` ${prefix} ${label}${desc}`, isSelected));
			}
		}

		if (this.options.length > visibleRows) {
			lines.push(row(` ${th.fg("dim", `${this.selected + 1}/${this.options.length}`)}`));
		}

		lines.push(row(""));
		lines.push(row(` ${th.fg("dim", this.footer)}`));
		lines.push(th.fg("borderAccent", `╰${"─".repeat(innerWidth)}╯`));

		return lines;
	}

	invalidate(): void {}

	private ensureVisible(): void {
		const visibleRows = Math.min(this.maxVisibleRows, Math.max(1, this.options.length));
		if (this.selected < this.scroll) {
			this.scroll = this.selected;
		} else if (this.selected >= this.scroll + visibleRows) {
			this.scroll = this.selected - visibleRows + 1;
		}
		const maxScroll = Math.max(0, this.options.length - visibleRows);
		this.scroll = Math.min(Math.max(0, this.scroll), maxScroll);
	}
}

export default function promptStashExtension(pi: ExtensionAPI) {
	let items: StashItem[] = [];
	let nextId = 1;
	let loaded = false;

	function recomputeNextId(): void {
		nextId = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
	}

	function migrateFromLegacySession(ctx: ExtensionContext): void {
		let migrated: StashItem[] = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== "prompt-stash") continue;
			const data = entry.data as LegacyStashSnapshot | undefined;
			if (!data || !Array.isArray(data.items)) continue;
			migrated = data.items.filter(isValidItem).map((item) => ({ ...item }));
		}

		if (migrated.length === 0) return;
		items = migrated.slice(-MAX_STASH_ENTRIES);
		recomputeNextId();
		writeAll(items);
		ctx.ui.notify(`Migrated ${items.length} prompt stash item(s) to ${STASH_PATH}`, "info");
	}

	function ensureLoaded(ctx?: ExtensionContext): void {
		if (loaded) return;
		loaded = true;

		const fromDisk = loadFromDisk();
		items = fromDisk.items;
		recomputeNextId();
		if (fromDisk.needsRewrite) {
			writeAll(items);
		}

		if (items.length === 0 && ctx) {
			migrateFromLegacySession(ctx);
		}
	}

	function stashPrompt(rawText: string, ctx: ExtensionContext): boolean {
		ensureLoaded(ctx);
		const text = rawText.trim();
		if (!text) {
			ctx.ui.notify("Prompt is empty. Nothing stashed.", "warning");
			return false;
		}

		const item: StashItem = {
			id: nextId++,
			text,
			createdAt: Date.now(),
		};

		items.push(item);
		let trimmed = false;
		if (items.length > MAX_STASH_ENTRIES) {
			items = items.slice(-MAX_STASH_ENTRIES);
			trimmed = true;
		}

		if (trimmed || !appendOne(item)) {
			writeAll(items);
		}

		ctx.ui.notify(`Stashed #${item.id}: ${preview(item.text)}`, "info");
		return true;
	}

	function removeById(id: number): StashItem | undefined {
		const index = items.findIndex((item) => item.id === id);
		if (index < 0) return undefined;
		const [removed] = items.splice(index, 1);
		return removed;
	}

	function findById(id: number): StashItem | undefined {
		return items.find((item) => item.id === id);
	}

	function popToEditor(item: StashItem, ctx: ExtensionContext): void {
		ctx.ui.setEditorText(item.text);
		removeById(item.id);
		writeAll(items);
		ctx.ui.notify(`Popped #${item.id} into editor`, "info");
	}

	function deleteItem(item: StashItem, ctx: ExtensionContext): void {
		removeById(item.id);
		writeAll(items);
		ctx.ui.notify(`Deleted #${item.id} from stash`, "info");
	}

	async function modalSelect(
		ctx: ExtensionContext,
		title: string,
		options: SelectItem[],
		footer = "↑↓ navigate • enter select • esc cancel",
	): Promise<SelectItem | undefined> {
		if (!ctx.hasUI) return undefined;

		return ctx.ui.custom<SelectItem | undefined>(
			(tui, theme, _kb, done) => {
				const dialog = new CenterMenuDialog(theme, title, options, footer, done);
				return {
					render(width: number) {
						return dialog.render(width);
					},
					invalidate() {
						dialog.invalidate();
					},
					handleInput(data: string) {
						dialog.handleInput(data);
						tui.requestRender();
					},
				};
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 72,
					maxHeight: 18,
					margin: 1,
				},
			},
		);
	}

	function stashCurrentEditorPrompt(ctx: ExtensionContext): void {
		ensureLoaded(ctx);
		const draft = ctx.ui.getEditorText().trim();
		if (!draft || draft.startsWith("/")) {
			ctx.ui.notify("Editor has no prompt draft to stash", "warning");
			return;
		}
		const ok = stashPrompt(draft, ctx);
		if (ok) {
			ctx.ui.setEditorText("");
		}
	}

	async function openPromptListDialog(ctx: ExtensionContext): Promise<void> {
		ensureLoaded(ctx);
		if (!ctx.hasUI) {
			ctx.ui.notify("Prompt stash list requires interactive mode", "error");
			return;
		}

		if (items.length === 0) {
			ctx.ui.notify("Prompt stash is empty", "info");
			return;
		}

		const sorted = [...items].sort((a, b) => b.id - a.id);
		const listOptions: SelectItem[] = sorted.map((item) => ({
			value: String(item.id),
			label: `#${item.id}`,
			description: preview(item.text),
		}));
		listOptions.push({ value: "__clear_all__", label: "Clear all stashed prompts" });

		const selected = await modalSelect(ctx, "Stashed Prompts", listOptions);
		if (!selected) return;

		if (selected.value === "__clear_all__") {
			const ok = await ctx.ui.confirm("Clear prompt stash", "Delete all stashed prompts?");
			if (!ok) return;
			items = [];
			nextId = 1;
			writeAll(items);
			ctx.ui.notify("Cleared prompt stash", "info");
			return;
		}

		const id = parseId(selected.value);
		if (id === undefined) return;
		const item = findById(id);
		if (!item) {
			ctx.ui.notify(`Stash item #${id} no longer exists`, "warning");
			return;
		}

		const action = await modalSelect(ctx, `Prompt #${item.id}`, [
			{ value: "paste", label: "Paste to editor", description: "Keep in stash" },
			{ value: "pop", label: "Pop to editor", description: "Remove from stash" },
			{ value: "delete", label: "Delete", description: "Remove this stashed prompt" },
		]);
		if (!action) return;

		if (action.value === "pop") {
			popToEditor(item, ctx);
			return;
		}

		if (action.value === "paste") {
			ctx.ui.setEditorText(item.text);
			ctx.ui.notify(`Loaded #${item.id} into editor`, "info");
			return;
		}

		if (action.value === "delete") {
			deleteItem(item, ctx);
		}
	}

	async function openMainDialog(ctx: ExtensionContext): Promise<void> {
		ensureLoaded(ctx);
		if (!ctx.hasUI) {
			ctx.ui.notify("Prompt stash requires interactive mode", "error");
			return;
		}

		const choice = await modalSelect(ctx, "Prompt Stash", [
			{ value: "stash-current", label: "Stash this", description: "Save current editor prompt" },
			{ value: "show-list", label: "Show prompts list", description: `Manage stashed prompts (${items.length})` },
		]);
		if (!choice) return;

		if (choice.value === "stash-current") {
			stashCurrentEditorPrompt(ctx);
			return;
		}

		if (choice.value === "show-list") {
			await openPromptListDialog(ctx);
		}
	}

	const unregisterPaletteProvider = registerCommandPaletteProvider({
		id: "prompt-stash",
		section: "Prompt Stash",
		source: "prompt-stash",
		order: 10,
		getActions: (ctx) => {
			ensureLoaded(ctx);
			return [
				{
					id: "stash-current",
					label: "Stash this",
					description: "Save current editor prompt",
					invoke: (callCtx) => {
						stashCurrentEditorPrompt(callCtx);
					},
				},
				{
					id: "show-list",
					label: "Show prompts list",
					description: `Manage stashed prompts (${items.length})`,
					invoke: async (callCtx) => {
						await openPromptListDialog(callCtx);
					},
				},
			];
		},
	});

	pi.registerCommand("stash-list", {
		description: "Open centered prompt stash dialog",
		handler: async (_args, ctx) => {
			await openMainDialog(ctx);
		},
	});

	pi.registerCommand("pop", {
		description: "Pop latest stashed prompt into editor, optionally by id: /pop [id]",
		getArgumentCompletions: (prefix) => {
			const choices = [...items]
				.sort((a, b) => b.id - a.id)
				.map((item) => ({ value: String(item.id), label: `${item.id}: ${preview(item.text)}` }));
			const filtered = choices.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			ensureLoaded(ctx);
			if (!ctx.hasUI) {
				ctx.ui.notify("/pop requires interactive mode", "error");
				return;
			}

			if (items.length === 0) {
				ctx.ui.notify("Prompt stash is empty", "info");
				return;
			}

			const raw = args.trim();
			let item: StashItem | undefined;

			if (!raw) {
				item = items[items.length - 1];
			} else {
				const id = Number.parseInt(raw, 10);
				if (Number.isNaN(id)) {
					ctx.ui.notify(`Invalid stash id: ${raw}`, "error");
					return;
				}
				item = findById(id);
			}

			if (!item) {
				ctx.ui.notify("Stashed prompt not found", "warning");
				return;
			}

			popToEditor(item, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		loaded = false;
		ensureLoaded(ctx);
	});

	pi.on("session_shutdown", async () => {
		unregisterPaletteProvider();
	});
}
