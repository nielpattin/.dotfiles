import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { getAllSessions, getSessionInfo } from "../storage";
import { formatSessionList, filterSessionsByDate, filterSessionsByProject } from "../formatters";
import type { SessionListArgs, SessionInfo } from "../types";

export function createSessionListTool(): ToolDefinition {
  return tool({
    description: "List available sessions with optional date and project filtering.",
    args: {
      limit: tool.schema
        .number()
        .optional()
        .describe("Maximum number of sessions to return (default: 20)"),
      date_filter: tool.schema
        .string()
        .optional()
        .describe("Filter by date (e.g., 'today', 'yesterday', '2024-01-15')"),
      project: tool.schema
        .string()
        .optional()
        .describe("Filter by project name or directory path"),
    },
    async execute(args: SessionListArgs) {
      const limit = args?.limit ?? 20;
      const sessionIds = getAllSessions().slice(0, limit * 3); // Get more to account for filtering
      const sessions: SessionInfo[] = [];

      for (const id of sessionIds) {
        const info = getSessionInfo(id);
        if (info) {
          sessions.push(info);
        }
      }

      // Apply filters
      let filtered = sessions;
      
      if (args.date_filter) {
        filtered = filterSessionsByDate(filtered, args.date_filter);
      }
      
      if (args.project) {
        filtered = filterSessionsByProject(filtered, args.project);
      }

      return formatSessionList(filtered.slice(0, limit));
    },
  });
}
