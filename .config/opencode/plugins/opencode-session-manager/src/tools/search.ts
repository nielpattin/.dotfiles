import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { getAllSessions, readSessionMessages } from "../storage";
import { formatSearchResults, searchInSession } from "../formatters";
import type { SessionSearchArgs, SearchResult } from "../types";

const SEARCH_TIMEOUT_MS = 60000;
const MAX_SESSIONS_TO_SCAN = 50;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms),
    ),
  ]);
}

export function createSessionSearchTool(): ToolDefinition {
  return tool({
    description: "Search for text across sessions or within a specific session.",
    args: {
      query: tool.schema.string().describe("Search query"),
      session_id: tool.schema
        .string()
        .optional()
        .describe("Limit search to specific session"),
      case_sensitive: tool.schema
        .boolean()
        .optional()
        .describe("Case sensitive search (default: false)"),
      limit: tool.schema
        .number()
        .optional()
        .describe("Maximum results to return (default: 20)"),
    },
    async execute(args: SessionSearchArgs) {
      const limit = args.limit ?? 20;
      const caseSensitive = args.case_sensitive ?? false;

      const searchPromise = async (): Promise<string> => {
        const results: SearchResult[] = [];

        if (args.session_id) {
          const messages = readSessionMessages(args.session_id, 500);
          const sessionResults = searchInSession(
            messages,
            args.query,
            caseSensitive,
          );
          for (const r of sessionResults) {
            r.session_id = args.session_id;
          }
          results.push(...sessionResults);
        } else {
          const sessionIds = getAllSessions().slice(0, MAX_SESSIONS_TO_SCAN);

          for (const id of sessionIds) {
            if (results.length >= limit) break;

            const messages = readSessionMessages(id, 100);
            const sessionResults = searchInSession(
              messages,
              args.query,
              caseSensitive,
            );

            for (const r of sessionResults) {
              r.session_id = id;
              results.push(r);
              if (results.length >= limit) break;
            }
          }
        }

        return formatSearchResults(results.slice(0, limit));
      };

      return withTimeout(searchPromise(), SEARCH_TIMEOUT_MS);
    },
  });
}
