/**
 * Session Query + Search extension
 *
 * Tools:
 * - session_search: deterministic branch/session discovery across ~/.pi/agent/sessions
 * - session_query: LLM-powered Q&A over a selected session/branch
 *
 * This keeps discovery cheap and local, while preserving deep Q&A quality.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  SessionManager,
  convertToLlm,
  getMarkdownTheme,
  serializeConversation,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");
const MAX_SEARCH_RESULTS = 50;
const DEFAULT_SEARCH_RESULTS = 20;
const DEFAULT_QUERY_MAX_MESSAGES = 300;

const QUERY_SYSTEM_PROMPT = `You are a session context assistant. Given the conversation history from a pi coding session and a question, provide a concise answer based on the session contents.

Focus on:
- Specific facts, decisions, and outcomes
- File paths and code changes mentioned
- Key context the user is asking about

Be concise and direct. If the information isn't in the session, say so.`;

interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

interface ContentPart {
  type: string;
  text?: string;
  thinking?: string;
  arguments?: Record<string, unknown>;
}

interface SessionMessageLike {
  role: string;
  content?: ContentPart[];
}

interface SessionEntryLike {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  modelId?: string;
  message?: SessionMessageLike;
  [key: string]: unknown;
}

interface ParsedSessionFile {
  header: SessionHeader | null;
  entries: SessionEntryLike[];
  sessionName: string;
}

interface BranchSearchResult {
  sessionId: string;
  sessionName: string;
  branchLeafId: string;
  sessionPath: string;
  workspace: string;
  timestampStart: string;
  timestampEnd: string;
  filesTouched: string[];
  models: string[];
  messageCount: number;
  firstUserMessage: string;
  searchableText: string;
  parentSessionPath?: string;
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function ensureSessionFiles(): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) {
    return [];
  }

  const files: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  };

  walk(SESSIONS_DIR);
  return files;
}

function parseSessionFile(filePath: string): ParsedSessionFile {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { header: null, entries: [], sessionName: "" };
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  let header: SessionHeader | null = null;
  let sessionName = "";
  const entries: SessionEntryLike[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const type = typeof parsed.type === "string" ? parsed.type : "";

      if (type === "session") {
        const id = typeof parsed.id === "string" ? parsed.id : "";
        const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : "";
        const cwd = typeof parsed.cwd === "string" ? parsed.cwd : "";
        if (id && timestamp) {
          header = {
            type: "session",
            version: typeof parsed.version === "number" ? parsed.version : undefined,
            id,
            timestamp,
            cwd,
            parentSession: typeof parsed.parentSession === "string" ? parsed.parentSession : undefined,
          };
        }
      } else if (type === "session_info") {
        if (typeof parsed.name === "string") {
          sessionName = parsed.name;
        }
      }

      if (typeof parsed.id === "string") {
        entries.push(parsed as unknown as SessionEntryLike);
      }
    } catch {
      // Skip malformed lines.
    }
  }

  return { header, entries, sessionName };
}

const ARG_PATH_KEYS = ["path", "filePath", "file_path", "target", "from", "to"];

function extractFilePathsFromArguments(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];

  const paths: string[] = [];
  for (const key of ARG_PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string") {
      paths.push(value);
    }
  }

  return paths;
}

function extractFilePathsFromText(text: string): string[] {
  const paths: string[] = [];

  for (const match of text.matchAll(/@([\w./-]+\/[\w./-]+)/g)) {
    const value = match[1];
    if (value) paths.push(value);
  }

  for (const match of text.matchAll(/(?:^|\s)([A-Za-z]:\\[^\s"'`]+|\/[\w./-]+)/g)) {
    const value = match[1];
    if (value) paths.push(value);
  }

  return paths;
}

function enumerateBranches(
  header: SessionHeader,
  entries: SessionEntryLike[],
  sessionName: string,
  sessionPath: string,
): BranchSearchResult[] {
  const byId = new Map<string, SessionEntryLike>();
  const hasChildren = new Set<string>();

  for (const entry of entries) {
    byId.set(entry.id, entry);
    if (entry.parentId) {
      hasChildren.add(entry.parentId);
    }
  }

  const leaves = entries.filter((entry) => !hasChildren.has(entry.id));
  const branches: BranchSearchResult[] = [];

  for (const leaf of leaves) {
    const chain: SessionEntryLike[] = [];
    let current: SessionEntryLike | undefined = leaf;

    while (current) {
      chain.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    const files = new Set<string>();
    const models = new Set<string>();
    const textChunks: string[] = [];
    let messageCount = 0;
    let firstUserMessage = "";

    for (const entry of chain) {
      if (entry.type === "model_change" && typeof entry.modelId === "string") {
        models.add(entry.modelId);
      }

      if (entry.type !== "message" || !entry.message) {
        continue;
      }

      messageCount += 1;
      const role = entry.message.role;
      const content = Array.isArray(entry.message.content) ? entry.message.content : [];

      for (const part of content) {
        if (typeof part !== "object" || part === null) continue;

        const text = typeof part.text === "string"
          ? part.text
          : typeof part.thinking === "string"
            ? part.thinking
            : "";

        if (text) {
          textChunks.push(text);

          if (role === "user" && !firstUserMessage) {
            firstUserMessage = text.slice(0, 200);
          }

          for (const extracted of extractFilePathsFromText(text)) {
            files.add(extracted);
          }
        }

        if (part.type === "toolCall" && part.arguments && typeof part.arguments === "object") {
          const extractedPaths = extractFilePathsFromArguments(part.arguments as Record<string, unknown>);
          for (const extracted of extractedPaths) {
            files.add(extracted);
          }
        }
      }
    }

    if (messageCount === 0) {
      continue;
    }

    const timestamps = chain
      .map((entry) => entry.timestamp)
      .filter((timestamp): timestamp is string => typeof timestamp === "string" && timestamp.length > 0)
      .sort();

    branches.push({
      sessionId: header.id,
      sessionName,
      branchLeafId: leaf.id,
      sessionPath,
      workspace: header.cwd,
      timestampStart: timestamps[0] ?? header.timestamp,
      timestampEnd: timestamps[timestamps.length - 1] ?? header.timestamp,
      filesTouched: [...files],
      models: [...models],
      messageCount,
      firstUserMessage,
      searchableText: textChunks.join("\n"),
      parentSessionPath: header.parentSession,
    });
  }

  return branches;
}

function matchesKeyword(branch: BranchSearchResult, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  return (
    branch.sessionName.toLowerCase().includes(needle) ||
    branch.searchableText.toLowerCase().includes(needle)
  );
}

function matchesFile(branch: BranchSearchResult, fileQuery: string): boolean {
  const needle = fileQuery.toLowerCase();
  return branch.filesTouched.some((filePath) => filePath.toLowerCase().includes(needle));
}

function parseDateInput(dateLike: string): Date | null {
  const relative = dateLike.match(/^(\d+)([dw])$/i);
  if (relative) {
    const value = Number.parseInt(relative[1] ?? "", 10);
    const unit = (relative[2] ?? "").toLowerCase();
    if (Number.isNaN(value) || value < 0) return null;

    const now = new Date();
    if (unit === "d") now.setDate(now.getDate() - value);
    if (unit === "w") now.setDate(now.getDate() - value * 7);
    return now;
  }

  const parsed = new Date(dateLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function matchesDateRange(branch: BranchSearchResult, after?: string, before?: string): boolean {
  const branchStart = new Date(branch.timestampStart);
  const branchEnd = new Date(branch.timestampEnd);

  if (after) {
    const parsedAfter = parseDateInput(after);
    if (parsedAfter && branchEnd < parsedAfter) {
      return false;
    }
  }

  if (before) {
    const parsedBefore = parseDateInput(before);
    if (parsedBefore && branchStart > parsedBefore) {
      return false;
    }
  }

  return true;
}

function preFilterFilesByKeyword(keyword: string): Set<string> | null {
  try {
    const result = execSync(
      `rg -l -i -- ${JSON.stringify(keyword)} ${JSON.stringify(SESSIONS_DIR)}`,
      { stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 },
    )
      .toString()
      .trim();

    if (!result) {
      return new Set();
    }

    return new Set(result.split(/\r?\n/).filter(Boolean));
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) {
      // ripgrep executed and found no matches.
      return new Set();
    }

    // ripgrep unavailable or another execution issue -> proceed without prefilter.
    return null;
  }
}

function filenameDateFilter(sessionFile: string, after?: string, before?: string): boolean {
  if (!after && !before) return true;

  const basename = path.basename(sessionFile);
  const match = basename.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!match) return true;

  const fileDate = new Date(match[1] ?? "");
  if (Number.isNaN(fileDate.getTime())) return true;

  if (after) {
    const parsedAfter = parseDateInput(after);
    if (parsedAfter && fileDate < parsedAfter) return false;
  }

  if (before) {
    const parsedBefore = parseDateInput(before);
    if (parsedBefore && fileDate > parsedBefore) return false;
  }

  return true;
}

function formatSearchResults(results: BranchSearchResult[], totalMatches: number): string {
  if (totalMatches === 0) {
    return "(no matching sessions found)";
  }

  const lines: string[] = [];
  lines.push(`Found ${totalMatches} matching branch${totalMatches === 1 ? "" : "es"}. Showing ${results.length}.`);
  lines.push("");

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]!;
    const date = new Date(result.timestampEnd);
    const dateString = Number.isNaN(date.getTime())
      ? result.timestampEnd
      : date.toLocaleString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

    lines.push(`### ${i + 1}. ${result.sessionName || "(unnamed session)"}`);
    lines.push(`session_id: ${result.sessionId}`);
    lines.push(`branch_leaf_id: ${result.branchLeafId}`);
    lines.push(`session_path: ${result.sessionPath}`);
    lines.push(`workspace: ${result.workspace || "(unknown)"}`);
    lines.push(`last_active: ${dateString}`);
    lines.push(`messages: ${result.messageCount}`);

    if (result.models.length > 0) {
      lines.push(`models: ${result.models.join(", ")}`);
    }

    if (result.filesTouched.length > 0) {
      const shownFiles = result.filesTouched.slice(0, 8);
      const extraCount = result.filesTouched.length - shownFiles.length;
      lines.push(
        `files_touched: ${shownFiles.join(", ")}${extraCount > 0 ? ` (+${extraCount} more)` : ""}`,
      );
    }

    if (result.firstUserMessage) {
      const preview = result.firstUserMessage.length > 160
        ? `${result.firstUserMessage.slice(0, 160)}...`
        : result.firstUserMessage;
      lines.push(`preview: ${preview}`);
    }

    if (i < results.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
}

function resolveSessionPathById(sessionId: string, sessionFiles: string[]): { path?: string; error?: string } {
  const normalizedId = sessionId.trim();
  if (!normalizedId) {
    return { error: "Error: sessionId cannot be empty." };
  }

  const quickCandidates = sessionFiles.filter((filePath) => {
    const base = path.basename(filePath);
    return base.includes(normalizedId);
  });

  const filesToScan = quickCandidates.length > 0 ? quickCandidates : sessionFiles;

  const exactMatches: string[] = [];
  for (const filePath of filesToScan) {
    const { header } = parseSessionFile(filePath);
    if (header?.id === normalizedId) {
      exactMatches.push(filePath);
    }
  }

  if (exactMatches.length === 1) {
    return { path: exactMatches[0] };
  }

  if (exactMatches.length > 1) {
    return {
      error:
        `Error: Multiple session files matched sessionId "${normalizedId}". ` +
        "Please provide sessionPath instead.",
    };
  }

  return { error: `Error: No session file found for sessionId "${normalizedId}".` };
}

function extractBranchMessages(
  sessionPath: string,
  branchLeafId?: string,
  maxMessages = DEFAULT_QUERY_MAX_MESSAGES,
): { messages?: unknown[]; error?: string } {
  let manager: SessionManager;
  try {
    manager = SessionManager.open(sessionPath);
  } catch (error) {
    return { error: `Error loading session: ${String(error)}` };
  }

  const branchEntries = branchLeafId
    ? manager.getBranch(branchLeafId)
    : manager.getBranch();

  if (!Array.isArray(branchEntries) || branchEntries.length === 0) {
    if (branchLeafId) {
      return {
        error: `Error: Branch "${branchLeafId}" not found in session ${sessionPath}.`,
      };
    }
    return { error: "Error: Session has no entries." };
  }

  if (branchLeafId) {
    const branchContainsLeaf = branchEntries.some((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      return (entry as { id?: string }).id === branchLeafId;
    });

    if (!branchContainsLeaf) {
      return {
        error: `Error: Branch "${branchLeafId}" was not found. Use session_search to discover valid branch_leaf_id values.`,
      };
    }
  }

  const allMessages = branchEntries
    .filter((entry): entry is SessionEntry & { type: "message"; message: unknown } => {
      return (
        !!entry &&
        typeof entry === "object" &&
        (entry as { type?: string }).type === "message" &&
        "message" in entry
      );
    })
    .map((entry) => entry.message);

  if (allMessages.length === 0) {
    return { error: "Error: Session branch has no messages." };
  }

  const safeLimit = Number.isFinite(maxMessages)
    ? Math.max(1, Math.min(Math.floor(maxMessages), 2_000))
    : DEFAULT_QUERY_MAX_MESSAGES;

  return {
    messages: allMessages.slice(-safeLimit),
  };
}

export default function registerSessionContextTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "session_search",
    label: "Session Search",
    description:
      "Search pi session history by keyword, file path, date range, and workspace. " +
      "Returns matching session branches with session_id, session_path, and branch_leaf_id. " +
      "Use session_query for deep question-answering on one chosen result.",
    parameters: Type.Object({
      keyword: Type.Optional(
        Type.String({ description: "Text to search in session names and conversation content." }),
      ),
      file: Type.Optional(
        Type.String({ description: "Partial file path match for files touched in a branch." }),
      ),
      after: Type.Optional(
        Type.String({ description: "Only return branches after this date (YYYY-MM-DD, 7d, 2w)." }),
      ),
      before: Type.Optional(
        Type.String({ description: "Only return branches before this date (YYYY-MM-DD, 7d, 2w)." }),
      ),
      workspace: Type.Optional(
        Type.String({ description: "Workspace path filter (partial match). Defaults to current workspace." }),
      ),
      all_workspaces: Type.Optional(
        Type.Boolean({ description: "Search across all workspaces instead of current workspace." }),
      ),
      limit: Type.Optional(
        Type.Number({ description: `Maximum branches to return (default ${DEFAULT_SEARCH_RESULTS}, max ${MAX_SEARCH_RESULTS}).` }),
      ),
    }),

    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const params = rawParams as {
        keyword?: string;
        file?: string;
        after?: string;
        before?: string;
        workspace?: string;
        all_workspaces?: boolean;
        limit?: number;
      };

      const sessionFiles = ensureSessionFiles();
      if (sessionFiles.length === 0) {
        return {
          content: [{ type: "text" as const, text: "(no sessions found under ~/.pi/agent/sessions)" }],
          details: { total: 0, results: [] },
        };
      }

      let filesToScan = sessionFiles;

      if (params.keyword) {
        const preFiltered = preFilterFilesByKeyword(params.keyword);
        if (preFiltered !== null) {
          filesToScan = filesToScan.filter((filePath) => preFiltered.has(filePath));
        }
      }

      filesToScan = filesToScan.filter((filePath) => filenameDateFilter(filePath, params.after, params.before));

      const workspaceFilter = params.all_workspaces
        ? undefined
        : params.workspace ?? ctx.cwd;
      const workspaceNeedle = workspaceFilter ? normalizePathForMatch(workspaceFilter) : undefined;

      const branches: BranchSearchResult[] = [];

      for (const sessionFile of filesToScan) {
        const { header, entries, sessionName } = parseSessionFile(sessionFile);
        if (!header) continue;

        if (workspaceNeedle) {
          const workspace = normalizePathForMatch(header.cwd || "");
          if (!workspace.includes(workspaceNeedle)) {
            continue;
          }
        }

        branches.push(...enumerateBranches(header, entries, sessionName, sessionFile));
      }

      let filtered = branches;

      if (params.keyword) {
        filtered = filtered.filter((branch) => matchesKeyword(branch, params.keyword!));
      }

      if (params.file) {
        filtered = filtered.filter((branch) => matchesFile(branch, params.file!));
      }

      if (params.after || params.before) {
        filtered = filtered.filter((branch) => matchesDateRange(branch, params.after, params.before));
      }

      filtered.sort((a, b) => new Date(b.timestampEnd).getTime() - new Date(a.timestampEnd).getTime());

      const requestedLimit = Number.isFinite(params.limit)
        ? Math.max(1, Math.min(Math.floor(params.limit!), MAX_SEARCH_RESULTS))
        : DEFAULT_SEARCH_RESULTS;

      const shown = filtered.slice(0, requestedLimit);
      const output = formatSearchResults(shown, filtered.length);

      return {
        content: [{ type: "text" as const, text: output }],
        details: {
          total: filtered.length,
          shown: shown.length,
          results: shown.map((item) => ({
            sessionId: item.sessionId,
            sessionPath: item.sessionPath,
            branchLeafId: item.branchLeafId,
            sessionName: item.sessionName,
            timestampEnd: item.timestampEnd,
            filesTouched: item.filesTouched,
          })),
        },
      } as const;
    },
  });

  pi.registerTool({
    name: "session_query",
    label: "Session Query",
    description:
      "Query a previous pi session for context, decisions, or code changes. " +
      "Supports sessionPath (legacy), or sessionId + optional branchLeafId from session_search.",
    renderResult: (result, _options, theme) => {
      const container = new Container();
      const firstPart = result.content?.[0];
      const text = firstPart?.type === "text" ? firstPart.text : undefined;

      if (text) {
        const match = text.match(/\*\*Query:\*\* (.+?)\n\n---\n\n([\s\S]+)/);

        if (match) {
          const query = match[1] ?? "";
          const answer = match[2] ?? "";
          container.addChild(new Text(theme.bold("Query: ") + theme.fg("accent", query), 0, 0));
          container.addChild(new Spacer(1));
          container.addChild(
            new Markdown(answer.trim(), 0, 0, getMarkdownTheme(), {
              color: (markdownText: string) => theme.fg("toolOutput", markdownText),
            }),
          );
        } else {
          container.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
        }
      }

      return container;
    },
    parameters: Type.Object({
      question: Type.String({
        description: "What you want to know about the session.",
      }),
      sessionPath: Type.Optional(
        Type.String({
          description: "Full path to a .jsonl session file (legacy input).",
        }),
      ),
      sessionId: Type.Optional(
        Type.String({
          description: "Session ID to resolve automatically (recommended with session_search results).",
        }),
      ),
      branchLeafId: Type.Optional(
        Type.String({
          description: "Optional branch leaf ID to scope analysis to one branch.",
        }),
      ),
      maxMessages: Type.Optional(
        Type.Number({
          description: `Maximum number of recent messages to include (default ${DEFAULT_QUERY_MAX_MESSAGES}).`,
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const errorResult = (text: string) => ({
        content: [{ type: "text" as const, text }],
        details: { error: true },
      });

      const question = typeof params.question === "string" ? params.question.trim() : "";
      if (!question) {
        return errorResult("Error: 'question' is required.");
      }

      const sessionFiles = ensureSessionFiles();
      let resolvedSessionPath = typeof params.sessionPath === "string" ? params.sessionPath.trim() : "";
      const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";

      if (!resolvedSessionPath && !sessionId) {
        return errorResult(
          "Error: Provide either sessionPath or sessionId. Tip: use session_search first to find candidates.",
        );
      }

      if (resolvedSessionPath) {
        if (!resolvedSessionPath.endsWith(".jsonl")) {
          return errorResult(`Error: Invalid session path. Expected a .jsonl file, got: ${resolvedSessionPath}`);
        }
      } else {
        const resolved = resolveSessionPathById(sessionId, sessionFiles);
        if (resolved.error) {
          return errorResult(resolved.error);
        }
        resolvedSessionPath = resolved.path ?? "";
      }

      if (!resolvedSessionPath || !fs.existsSync(resolvedSessionPath)) {
        return errorResult(`Error: Session file not found: ${resolvedSessionPath || sessionId}`);
      }

      const branchLeafId = typeof params.branchLeafId === "string" ? params.branchLeafId.trim() : undefined;
      const maxMessages = typeof params.maxMessages === "number"
        ? params.maxMessages
        : DEFAULT_QUERY_MAX_MESSAGES;

      onUpdate?.({
        content: [{ type: "text", text: `Query: ${question}` }],
        details: {
          status: "loading",
          sessionPath: resolvedSessionPath,
          branchLeafId,
        },
      });

      const extracted = extractBranchMessages(resolvedSessionPath, branchLeafId, maxMessages);
      if (extracted.error) {
        return errorResult(extracted.error);
      }

      const messages = extracted.messages ?? [];
      if (messages.length === 0) {
        return errorResult("Error: No messages available in the selected scope.");
      }

      if (!ctx.model) {
        return errorResult("Error: No model available to analyze the session.");
      }

      const llmMessages = convertToLlm(messages as any[]);
      const conversationText = serializeConversation(llmMessages);

      try {
        const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);

        const userMessage: Message = {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `## Session Path\n\n${resolvedSessionPath}\n\n` +
                `## Branch Leaf ID\n\n${branchLeafId ?? "(current/default)"}\n\n` +
                `## Session Conversation\n\n${conversationText}\n\n` +
                `## Question\n\n${question}`,
            },
          ],
          timestamp: Date.now(),
        };

        const response = await complete(
          ctx.model,
          { systemPrompt: QUERY_SYSTEM_PROMPT, messages: [userMessage] },
          { apiKey, signal },
        );

        if (response.stopReason === "aborted") {
          return {
            content: [{ type: "text" as const, text: "Query was cancelled." }],
            details: { cancelled: true },
          };
        }

        const answer = response.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();

        return {
          content: [{ type: "text" as const, text: `**Query:** ${question}\n\n---\n\n${answer}` }],
          details: {
            sessionPath: resolvedSessionPath,
            sessionId: sessionId || undefined,
            branchLeafId,
            messageCount: messages.length,
          },
        } as const;
      } catch (error) {
        return errorResult(`Error querying session: ${String(error)}`);
      }
    },
  });
}
