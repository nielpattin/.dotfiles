import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface PaletteAction {
	id: string;
	label: string;
	description?: string;
	invoke: (ctx: ExtensionContext) => Promise<void> | void;
}

export interface PaletteProvider {
	id: string;
	section: string;
	source: string;
	order?: number;
	getActions: (ctx: ExtensionContext) => Promise<PaletteAction[]> | PaletteAction[];
}

const REGISTRY_KEY = "__pi_command_palette_providers__";

type RegistryBag = {
	providers: Map<string, PaletteProvider>;
};

function getRegistry(): RegistryBag {
	const globalObj = globalThis as typeof globalThis & {
		[REGISTRY_KEY]?: RegistryBag;
	};

	if (!globalObj[REGISTRY_KEY]) {
		globalObj[REGISTRY_KEY] = {
			providers: new Map<string, PaletteProvider>(),
		};
	}

	return globalObj[REGISTRY_KEY];
}

export function registerCommandPaletteProvider(provider: PaletteProvider): () => void {
	const registry = getRegistry();
	registry.providers.set(provider.id, provider);
	return () => {
		const current = getRegistry().providers.get(provider.id);
		if (current === provider) {
			getRegistry().providers.delete(provider.id);
		}
	};
}

export function getCommandPaletteProviders(): PaletteProvider[] {
	return [...getRegistry().providers.values()].sort((a, b) => {
		const ao = a.order ?? 100;
		const bo = b.order ?? 100;
		if (ao !== bo) return ao - bo;
		return a.section.localeCompare(b.section);
	});
}
