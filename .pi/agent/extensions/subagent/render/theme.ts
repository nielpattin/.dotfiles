import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SingleResult } from "../types.js";

export type ThemeFg = Theme["fg"];
export type RenderTheme = Pick<Theme, "fg" | "bold">;
export type Rgb = { r: number; g: number; b: number };
export type CardAccent = { title: Rgb; stripe: Rgb };

export function padAnsi(text: string, width: number): string {
	const truncated = truncateToWidth(text, width);
	const pad = Math.max(0, width - visibleWidth(truncated));
	return truncated + " ".repeat(pad);
}

export function joinLeftRight(left: string, right: string, width: number): string {
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

export function colorizeRgb(text: string, rgb: Rgb): string {
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

export function getCardAccent(index: number, r: SingleResult): CardAccent {
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
