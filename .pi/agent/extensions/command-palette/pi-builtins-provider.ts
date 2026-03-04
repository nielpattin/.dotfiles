import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PaletteAction, PaletteProvider } from "./registry.js";

interface BuiltinCommandItem {
	id: string;
	command: string;
	label: string;
	description: string;
}

const DEFAULT_BUILTINS: BuiltinCommandItem[] = [
	{ id: "settings", command: "/settings", label: "Settings", description: "Open settings selector" },
	{ id: "model", command: "/model", label: "Model", description: "Open model selector" },
	{ id: "resume", command: "/resume", label: "Resume", description: "Open session picker" },
	{ id: "new", command: "/new", label: "New Session", description: "Start a fresh session" },
	{ id: "tree", command: "/tree", label: "Tree", description: "Open session tree" },
	{ id: "fork", command: "/fork", label: "Fork", description: "Fork from a selected message" },
	{ id: "session", command: "/session", label: "Session Info", description: "Show session metadata" },
	{ id: "hotkeys", command: "/hotkeys", label: "Hotkeys", description: "Show keyboard shortcuts" },
];

function submitCommandInEditor(command: string, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setEditorText(command);

	const stdin = process.stdin as NodeJS.ReadStream & {
		emit(event: "data", data: string): boolean;
	};
	const delivered = stdin.emit("data", "\r");
	if (!delivered) {
		ctx.ui.notify(`Inserted ${command}. Press Enter to run.`, "warning");
	}
}

export function createPiBuiltinsProvider(): PaletteProvider {
	return {
		id: "pi-builtins",
		section: "Pi Built-ins",
		source: "core",
		order: 20,
		getActions: (_ctx) => {
			const actions: PaletteAction[] = DEFAULT_BUILTINS.map((item) => ({
				id: item.id,
				label: item.label,
				description: item.description,
				invoke: (ctx) => {
					submitCommandInEditor(item.command, ctx);
				},
			}));

			return actions;
		},
	};
}
