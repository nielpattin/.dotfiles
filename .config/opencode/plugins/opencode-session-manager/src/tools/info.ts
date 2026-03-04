import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { getSessionInfo } from "../storage";
import { formatSessionInfo } from "../formatters";
import type { SessionInfoArgs } from "../types";

export function createSessionInfoTool(): ToolDefinition {
  return tool({
    description: "Get detailed information about a specific session.",
    args: {
      session_id: tool.schema.string().describe("Session ID to get info for"),
    },
    async execute(args: SessionInfoArgs) {
      const info = getSessionInfo(args.session_id);

      if (!info) {
        return `Session "${args.session_id}" not found.`;
      }

      return formatSessionInfo(info);
    },
  });
}
