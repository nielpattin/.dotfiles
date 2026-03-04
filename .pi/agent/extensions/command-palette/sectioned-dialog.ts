import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, parseKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export interface SectionedAction<T = string> {
	id: T;
	section: string;
	source: string;
	label: string;
	description?: string;
}

type Row<T> =
	| {
			type: "section";
			section: string;
			source: string;
	  }
	| {
			type: "action";
			action: SectionedAction<T>;
	  };

class SectionedMenuDialog<T> {
	private selected = 0;
	private scroll = 0;
	private query = "";
	private rows: Row<T>[] = [];
	private readonly maxVisibleRows = 12;

	constructor(
		private readonly theme: Theme,
		private readonly title: string,
		private readonly actions: SectionedAction<T>[],
		private readonly footer: string,
		private readonly done: (value: SectionedAction<T> | undefined) => void,
	) {
		this.rebuildRows(true);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done(undefined);
			return;
		}

		if (matchesKey(data, "backspace") || matchesKey(data, "shift+backspace")) {
			if (this.query.length > 0) {
				this.query = this.query.slice(0, -1);
				this.rebuildRows(true);
			}
			return;
		}

		if (matchesKey(data, "ctrl+u")) {
			if (this.query.length > 0) {
				this.query = "";
				this.rebuildRows(true);
			}
			return;
		}

		const textInput = this.getTextInput(data);
		if (textInput) {
			this.query += textInput;
			this.rebuildRows(true);
			return;
		}

		const selectable = this.rowIndices();
		if (selectable.length === 0) {
			if (matchesKey(data, "return") || matchesKey(data, "enter")) {
				this.done(undefined);
			}
			return;
		}

		if (matchesKey(data, "up")) {
			this.move(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.move(1);
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.move(-6);
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.move(6);
			return;
		}

		if (matchesKey(data, "return") || matchesKey(data, "enter")) {
			const row = this.rows[this.selected];
			if (row?.type === "action") {
				this.done(row.action);
			}
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerWidth = Math.max(30, width - 2);
		const visibleRows = Math.min(this.maxVisibleRows, Math.max(1, this.rows.length));

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
		const searchHint = this.query.length > 0 ? this.query : th.fg("dim", "type command name...");
		lines.push(row(` ${th.fg("muted", "Search:")} ${th.fg("text", searchHint)}`));
		lines.push(row(""));

		if (this.rows.length === 0) {
			lines.push(row(` ${th.fg("dim", "No commands match your search")}`));
		} else {
			this.ensureVisible();

			let rowsToRender = visibleRows;
			const firstVisible = this.rows[this.scroll];
			if (firstVisible?.type === "action") {
				const section = this.findSectionForIndex(this.scroll);
				if (section) {
					const sectionText = `${section.section} ${th.fg("muted", `(${section.source})`)}`;
					lines.push(row(` ${th.bold(th.fg("accent", sectionText))}`));
					rowsToRender = Math.max(0, rowsToRender - 1);
				}
			}

			for (let i = 0; i < rowsToRender; i++) {
				const index = this.scroll + i;
				const item = this.rows[index];
				if (!item) {
					lines.push(row(""));
					continue;
				}

				if (item.type === "section") {
					const sectionText = `${item.section} ${th.fg("muted", `(${item.source})`)}`;
					lines.push(row(` ${th.bold(th.fg("accent", sectionText))}`));
					continue;
				}

				const isSelected = index === this.selected;
				const prefix = isSelected ? th.fg("accent", "›") : th.fg("dim", " ");
				const label = isSelected ? th.fg("accent", item.action.label) : th.fg("text", item.action.label);
				const desc = item.action.description ? ` ${th.fg("muted", item.action.description)}` : "";
				lines.push(row(` ${prefix} ${label}${desc}`, isSelected));
			}
		}

		lines.push(row(""));
		lines.push(row(` ${th.fg("dim", `${this.footer} • type to filter • ctrl+u clear`)}`));
		lines.push(th.fg("borderAccent", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}

	private getTextInput(data: string): string | undefined {
		const key = parseKey(data);
		if (key === "space") return " ";
		if (key && key.length === 1) return key;
		if (key?.startsWith("shift+")) {
			const shifted = key.slice(6);
			if (shifted.length === 1) {
				if (/^[a-z]$/.test(shifted)) return shifted.toUpperCase();
				return shifted;
			}
		}

		if (data.length === 1) {
			const code = data.charCodeAt(0);
			if (code >= 32 && code <= 126) {
				return data;
			}
		}

		return undefined;
	}

	private rebuildRows(resetSelection: boolean): void {
		const query = this.query.trim().toLowerCase();
		const filtered = query
			? this.actions.filter((action) => {
					const haystack = `${action.label} ${action.description ?? ""} ${action.section} ${action.source}`.toLowerCase();
					return haystack.includes(query);
			  })
			: this.actions;

		const nextRows: Row<T>[] = [];
		let currentSectionKey = "";
		for (const action of filtered) {
			const sectionKey = `${action.section}::${action.source}`;
			if (sectionKey !== currentSectionKey) {
				nextRows.push({
					type: "section",
					section: action.section,
					source: action.source,
				});
				currentSectionKey = sectionKey;
			}
			nextRows.push({
				type: "action",
				action,
			});
		}

		this.rows = nextRows;

		if (resetSelection) {
			const firstSelectable = this.rowIndices()[0];
			this.selected = firstSelectable ?? 0;
			this.scroll = 0;
			return;
		}

		if (this.selected >= this.rows.length) {
			const firstSelectable = this.rowIndices()[0];
			this.selected = firstSelectable ?? 0;
		}
		this.ensureVisible();
	}

	private rowIndices(): number[] {
		const indices: number[] = [];
		for (let i = 0; i < this.rows.length; i++) {
			if (this.rows[i]?.type === "action") indices.push(i);
		}
		return indices;
	}

	private findSectionForIndex(index: number): { section: string; source: string } | undefined {
		for (let i = Math.min(index, this.rows.length - 1); i >= 0; i--) {
			const item = this.rows[i];
			if (item?.type === "section") {
				return {
					section: item.section,
					source: item.source,
				};
			}
		}
		return undefined;
	}

	private move(delta: number): void {
		const selectable = this.rowIndices();
		if (selectable.length === 0) return;

		const currentIndex = Math.max(0, selectable.indexOf(this.selected));
		const nextIndex = Math.min(selectable.length - 1, Math.max(0, currentIndex + delta));
		this.selected = selectable[nextIndex] ?? selectable[0] ?? 0;
		this.ensureVisible();
	}

	private ensureVisible(): void {
		const visibleRows = Math.min(this.maxVisibleRows, Math.max(1, this.rows.length));
		if (this.selected < this.scroll) {
			this.scroll = this.selected;
		} else if (this.selected >= this.scroll + visibleRows) {
			this.scroll = this.selected - visibleRows + 1;
		}
		const maxScroll = Math.max(0, this.rows.length - visibleRows);
		this.scroll = Math.min(Math.max(0, this.scroll), maxScroll);
	}
}

export async function showSectionedMenu<T>(
	ctx: ExtensionContext,
	title: string,
	actions: SectionedAction<T>[],
): Promise<SectionedAction<T> | undefined> {
	if (!ctx.hasUI) return undefined;

	return ctx.ui.custom<SectionedAction<T> | undefined>(
		(tui, theme, _kb, done) => {
			const dialog = new SectionedMenuDialog(theme, title, actions, "↑↓ navigate • enter select • esc cancel", done);
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
				width: 84,
				maxHeight: 22,
				margin: 1,
			},
		},
	);
}
