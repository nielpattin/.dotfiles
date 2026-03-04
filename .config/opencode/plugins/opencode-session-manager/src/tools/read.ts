import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { readSessionMessages, getSessionInfo } from "../storage";
import { formatSessionMessages } from "../formatters";
import type { SessionReadArgs } from "../types";

export function createSessionReadTool(): ToolDefinition {
  return tool({
    description: "Read messages from a specific session.",
    args: {
      session_id: tool.schema.string().describe("Session ID to read"),
      limit: tool.schema
        .number()
        .optional()
        .describe("Maximum number of messages to return (default: 50)"),
      include_todos: tool.schema
        .boolean()
        .optional()
        .describe("Include todo items (default: false)"),
    },
    async execute(args: SessionReadArgs) {
      const limit = args.limit ?? 50;
      const messages = readSessionMessages(args.session_id, limit);

      if (messages.length === 0) {
        return `Session "${args.session_id}" not found or has no messages.`;
      }

      // Get session info for header context
      const info = getSessionInfo(args.session_id);
      
      let result = "";
      
      // Add session header with title and project
      if (info) {
        result += `Session: ${info.title}\n`;
        result += `Project: ${info.project_name} (${info.directory})\n`;
        result += `Messages: ${info.message_count} total (showing ${messages.length})\n`;
        result += "\n";
      }
      
      result += formatSessionMessages(messages);

      if (args.include_todos && info?.todos) {
        result += "\n\n--- TODOS ---\n";
        for (const todo of info.todos) {
          const statusIcon =
            todo.status === "completed"
              ? "✓"
              : todo.status === "in_progress"
                ? "⏳"
                : todo.status === "cancelled"
                  ? "✗"
                  : "○";
          result += `${statusIcon} ${todo.content}\n`;
        }
      }

      return result;
    },
  });
}
