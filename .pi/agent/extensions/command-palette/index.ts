import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";
import {
	actionVisibilityKey,
	loadCommandPaletteConfig,
	saveCommandPaletteConfig,
	type CommandPaletteConfig,
} from "./config.js";
import { createPiBuiltinsProvider } from "./pi-builtins-provider.js";
import {
	getCommandPaletteProviders,
	registerCommandPaletteProvider,
	type PaletteAction,
	type PaletteProvider,
} from "./registry.js";
import { showSectionedMenu, type SectionedAction } from "./sectioned-dialog.js";

type ActionRef = {
	provider: PaletteProvider;
	action: PaletteAction;
};

function isHiddenProvider(config: CommandPaletteConfig, providerId: string): boolean {
	return config.hiddenProviders.includes(providerId);
}

function isHiddenAction(config: CommandPaletteConfig, providerId: string, actionId: string): boolean {
	return config.hiddenActions.includes(actionVisibilityKey(providerId, actionId));
}

function setProviderHidden(config: CommandPaletteConfig, providerId: string, hidden: boolean): CommandPaletteConfig {
	const next = new Set(config.hiddenProviders);
	if (hidden) next.add(providerId);
	else next.delete(providerId);
	return {
		...config,
		hiddenProviders: [...next],
	};
}

function setActionHidden(
	config: CommandPaletteConfig,
	providerId: string,
	actionId: string,
	hidden: boolean,
): CommandPaletteConfig {
	const next = new Set(config.hiddenActions);
	const key = actionVisibilityKey(providerId, actionId);
	if (hidden) next.add(key);
	else next.delete(key);
	return {
		...config,
		hiddenActions: [...next],
	};
}

export default function commandPaletteExtension(pi: ExtensionAPI) {
	let config = loadCommandPaletteConfig();
	let unbindTerminalListener: (() => void) | undefined;

	const unregisterBuiltinsProvider = registerCommandPaletteProvider(createPiBuiltinsProvider());

	function saveConfig(nextConfig: CommandPaletteConfig) {
		config = nextConfig;
		saveCommandPaletteConfig(config);
	}

	async function collectVisibleActions(ctx: ExtensionContext): Promise<ActionRef[]> {
		const providers = getCommandPaletteProviders();
		const result: ActionRef[] = [];

		for (const provider of providers) {
			if (isHiddenProvider(config, provider.id)) continue;

			const actions = await provider.getActions(ctx);
			for (const action of actions) {
				if (isHiddenAction(config, provider.id, action.id)) continue;
				result.push({ provider, action });
			}
		}

		return result;
	}

	async function toggleSectionsUI(ctx: ExtensionContext): Promise<void> {
		const providers = getCommandPaletteProviders();
		if (providers.length === 0) {
			ctx.ui.notify("No palette providers registered", "info");
			return;
		}

		while (true) {
			const options = providers.map((provider, index) => {
				const visible = !isHiddenProvider(config, provider.id);
				return `${index + 1}. ${visible ? "[x]" : "[ ]"} ${provider.section} (${provider.source})`;
			});
			options.push("Done");

			const selected = await ctx.ui.select("Palette Sections", options);
			if (!selected || selected === "Done") return;

			const index = options.indexOf(selected);
			if (index < 0 || index >= providers.length) continue;

			const provider = providers[index];
			if (!provider) continue;
			const currentlyVisible = !isHiddenProvider(config, provider.id);
			saveConfig(setProviderHidden(config, provider.id, currentlyVisible));
		}
	}

	async function toggleActionsForProvider(ctx: ExtensionContext, provider: PaletteProvider): Promise<void> {
		while (true) {
			const actions = await provider.getActions(ctx);
			if (actions.length === 0) {
				ctx.ui.notify(`No actions in section ${provider.section}`, "info");
				return;
			}

			const options = actions.map((action, index) => {
				const visible = !isHiddenAction(config, provider.id, action.id);
				return `${index + 1}. ${visible ? "[x]" : "[ ]"} ${action.label}`;
			});
			options.push("Done");

			const selected = await ctx.ui.select(`${provider.section} Actions`, options);
			if (!selected || selected === "Done") return;

			const index = options.indexOf(selected);
			if (index < 0 || index >= actions.length) continue;

			const action = actions[index];
			if (!action) continue;
			const currentlyVisible = !isHiddenAction(config, provider.id, action.id);
			saveConfig(setActionHidden(config, provider.id, action.id, currentlyVisible));
		}
	}

	async function toggleActionsUI(ctx: ExtensionContext): Promise<void> {
		const providers = getCommandPaletteProviders();
		if (providers.length === 0) {
			ctx.ui.notify("No palette providers registered", "info");
			return;
		}

		while (true) {
			const options = providers.map((provider, index) => `${index + 1}. ${provider.section} (${provider.source})`);
			options.push("Done");

			const selected = await ctx.ui.select("Choose Section", options);
			if (!selected || selected === "Done") return;

			const index = options.indexOf(selected);
			if (index < 0 || index >= providers.length) continue;

			const provider = providers[index];
			if (!provider) continue;
			await toggleActionsForProvider(ctx, provider);
		}
	}

	async function manageVisibility(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("Command palette requires interactive mode", "error");
			return;
		}

		while (true) {
			const choice = await ctx.ui.select("Command Palette", [
				"Toggle section visibility",
				"Toggle action visibility",
				"Reset visibility",
				"Done",
			]);

			if (!choice || choice === "Done") return;
			if (choice === "Toggle section visibility") {
				await toggleSectionsUI(ctx);
				continue;
			}
			if (choice === "Toggle action visibility") {
				await toggleActionsUI(ctx);
				continue;
			}
			if (choice === "Reset visibility") {
				saveConfig({
					version: 1,
					hiddenProviders: [],
					hiddenActions: [],
				});
				ctx.ui.notify("Command palette visibility reset", "info");
			}
		}
	}

	async function openPalette(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("Command palette requires interactive mode", "error");
			return;
		}

		const visibleActions = await collectVisibleActions(ctx);
		const menuActions: SectionedAction<ActionRef | "manage">[] = [
			{
				id: "manage",
				section: "Command Palette",
				source: "core",
				label: "Manage visibility",
				description: "Show/hide sections and actions",
			},
			...visibleActions.map((entry) => ({
				id: entry,
				section: entry.provider.section,
				source: entry.provider.source,
				label: entry.action.label,
				description: entry.action.description,
			})),
		];

		const selected = await showSectionedMenu(ctx, "Command Palette", menuActions);
		if (!selected) return;

		if (selected.id === "manage") {
			await manageVisibility(ctx);
			return;
		}

		await selected.id.action.invoke(ctx);
	}

	function bindHotkey(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		unbindTerminalListener?.();
		unbindTerminalListener = ctx.ui.onTerminalInput((data) => {
			if (matchesKey(data, "ctrl+p")) {
				void openPalette(ctx);
				return { consume: true };
			}
			return undefined;
		});
	}

	pi.registerCommand("palette", {
		description: "Open command palette",
		handler: async (_args, ctx) => {
			await openPalette(ctx);
		},
	});

	pi.registerCommand("command-palette", {
		description: "Open command palette",
		handler: async (_args, ctx) => {
			await openPalette(ctx);
		},
	});

	pi.registerCommand("palette-config", {
		description: "Configure command palette visibility",
		handler: async (_args, ctx) => {
			await manageVisibility(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		config = loadCommandPaletteConfig();
		bindHotkey(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		config = loadCommandPaletteConfig();
		bindHotkey(ctx);
	});

	pi.on("session_shutdown", async () => {
		unbindTerminalListener?.();
		unbindTerminalListener = undefined;
		unregisterBuiltinsProvider();
	});
}
