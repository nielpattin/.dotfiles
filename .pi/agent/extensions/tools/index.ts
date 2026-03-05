import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import diffRendererExtension from "./diff-renderer";
import toolSelectorExtension from "./tool-selector";

export default function toolsExtension(pi: ExtensionAPI) {
	diffRendererExtension(pi);
	toolSelectorExtension(pi);
}
