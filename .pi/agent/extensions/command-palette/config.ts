import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface CommandPaletteConfig {
	version: 1;
	hiddenProviders: string[];
	hiddenActions: string[];
}

const DEFAULT_CONFIG: CommandPaletteConfig = {
	version: 1,
	hiddenProviders: [],
	hiddenActions: [],
};

export const COMMAND_PALETTE_CONFIG_PATH = join(homedir(), ".pi", "agent", "command-palette.json");

function normalizeConfig(input: unknown): CommandPaletteConfig {
	if (!input || typeof input !== "object") {
		return { ...DEFAULT_CONFIG };
	}

	const raw = input as Partial<CommandPaletteConfig>;

	const hiddenProviders = Array.isArray(raw.hiddenProviders)
		? raw.hiddenProviders.filter((value): value is string => typeof value === "string")
		: [];

	const hiddenActions = Array.isArray(raw.hiddenActions)
		? raw.hiddenActions.filter((value): value is string => typeof value === "string")
		: [];

	return {
		version: 1,
		hiddenProviders,
		hiddenActions,
	};
}

export function loadCommandPaletteConfig(): CommandPaletteConfig {
	try {
		if (!existsSync(COMMAND_PALETTE_CONFIG_PATH)) {
			return { ...DEFAULT_CONFIG };
		}
		const raw = readFileSync(COMMAND_PALETTE_CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		return normalizeConfig(parsed);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function saveCommandPaletteConfig(config: CommandPaletteConfig): void {
	const normalized = normalizeConfig(config);
	const dir = dirname(COMMAND_PALETTE_CONFIG_PATH);
	mkdirSync(dir, { recursive: true });

	const tmp = `${COMMAND_PALETTE_CONFIG_PATH}.tmp`;
	writeFileSync(tmp, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
	renameSync(tmp, COMMAND_PALETTE_CONFIG_PATH);
}

export function actionVisibilityKey(providerId: string, actionId: string): string {
	return `${providerId}:${actionId}`;
}
