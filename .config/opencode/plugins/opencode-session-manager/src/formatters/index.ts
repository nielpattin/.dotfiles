import type { SessionInfo, SessionMessage, SearchResult } from "../types";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a Unix timestamp (milliseconds) to a human-readable date string.
 */
function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) return "unknown";
  
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const timeStr = date.toLocaleTimeString("en-US", { 
    hour: "2-digit", 
    minute: "2-digit",
    hour12: true 
  });
  
  if (dateOnly.getTime() === today.getTime()) {
    return `Today ${timeStr}`;
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return `Yesterday ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
    return `${dateStr} ${timeStr}`;
  }
}

/**
 * Shorten a directory path for display.
 * Example: C:\Users\niel\repo\public\kyte -> ~/repo/public/kyte
 */
function shortenPath(directory: string): string {
  if (!directory || directory === "Unknown") return directory;
  
  // Normalize path separators
  const normalized = directory.replace(/\\/g, "/");
  
  // Try to shorten home directory
  const homeDir = (process.env.HOME || process.env.USERPROFILE || "").replace(/\\/g, "/");
  if (homeDir && normalized.startsWith(homeDir)) {
    return "~" + normalized.slice(homeDir.length);
  }
  
  return normalized;
}

// ============================================================================
// Session List Formatter
// ============================================================================

export function formatSessionList(sessions: SessionInfo[]): string {
  if (sessions.length === 0) {
    return "No sessions found.";
  }

  const lines: string[] = [`Found ${sessions.length} session(s):`, ""];

  for (const session of sessions) {
    const agentsStr = session.agents_used.length > 0 ? ` [${session.agents_used.join(", ")}]` : "";
    const todoStr = session.has_todos ? " 📝" : "";
    
    // Title and ID
    lines.push(`• ${session.title}${todoStr}`);
    lines.push(`  ID: ${session.id}${agentsStr}`);
    
    // Project and timing
    lines.push(`  Project: ${session.project_name} | Messages: ${session.message_count}`);
    lines.push(`  Last active: ${formatTimestamp(session.last_message)}`);
    lines.push(`  Path: ${shortenPath(session.directory)}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Session Messages Formatter
// ============================================================================

export function formatSessionMessages(messages: SessionMessage[]): string {
  if (messages.length === 0) {
    return "No messages found.";
  }

  const lines: string[] = [];

  for (const msg of messages) {
    const roleLabel = msg.role === "user" ? "USER" : "ASSISTANT";
    const agentLabel = msg.agent ? ` (${msg.agent})` : "";
    const timeLabel = msg.time?.created ? ` @ ${formatTimestamp(msg.time.created)}` : "";

    lines.push(`--- ${roleLabel}${agentLabel}${timeLabel} ---`);

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        lines.push(part.text);
      } else if ((part.type === "thinking" || part.type === "reasoning") && (part.thinking || part.text)) {
        const thinkingText = part.thinking || part.text || "";
        lines.push(`[Thinking: ${thinkingText.slice(0, 200)}...]`);
      } else if (part.type === "tool" && part.tool) {
        const inputStr = part.input ? JSON.stringify(part.input).slice(0, 100) : "";
        lines.push(`[Tool: ${part.tool}(${inputStr})]`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Session Info Formatter
// ============================================================================

export function formatSessionInfo(info: SessionInfo): string {
  const lines: string[] = [
    `Session: ${info.title}`,
    "",
    `ID: ${info.id}`,
    `Project: ${info.project_name}`,
    `Directory: ${shortenPath(info.directory)}`,
    "",
    `Messages: ${info.message_count}`,
    `First message: ${formatTimestamp(info.first_message)}`,
    `Last message: ${formatTimestamp(info.last_message)}`,
    `Agents used: ${info.agents_used.length > 0 ? info.agents_used.join(", ") : "none"}`,
    `Has todos: ${info.has_todos ? "yes" : "no"}`,
  ];

  if (info.todos && info.todos.length > 0) {
    lines.push("", "Todos:");
    for (const todo of info.todos) {
      const statusIcon =
        todo.status === "completed"
          ? "✓"
          : todo.status === "in_progress"
            ? "⏳"
            : todo.status === "cancelled"
              ? "✗"
              : "○";
      lines.push(`  ${statusIcon} ${todo.content}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Search Results Formatter
// ============================================================================

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No matches found.";
  }

  const lines: string[] = [`Found ${results.length} match(es):`, ""];

  for (const result of results) {
    const timeStr = result.timestamp ? ` | ${formatTimestamp(result.timestamp)}` : "";
    lines.push(`• Session: ${result.session_id}`);
    lines.push(`  Role: ${result.role} | Matches: ${result.match_count}${timeStr}`);
    lines.push(`  Excerpt: ${result.excerpt}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Filter Functions
// ============================================================================

export function filterSessionsByDate(sessions: SessionInfo[], dateFilter: string): SessionInfo[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let targetDate: Date;

  if (dateFilter === "today") {
    targetDate = today;
  } else if (dateFilter === "yesterday") {
    targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() - 1);
  } else {
    targetDate = new Date(dateFilter);
    if (isNaN(targetDate.getTime())) {
      return sessions;
    }
  }

  const targetStart = targetDate.getTime();
  const targetEnd = targetStart + 24 * 60 * 60 * 1000;

  return sessions.filter((session) => {
    const messageTime = session.last_message;
    if (!messageTime) return false;
    return messageTime >= targetStart && messageTime < targetEnd;
  });
}

export function filterSessionsByProject(sessions: SessionInfo[], projectFilter: string): SessionInfo[] {
  const filter = projectFilter.toLowerCase();
  
  return sessions.filter((session) => {
    return (
      session.project_name.toLowerCase().includes(filter) ||
      session.directory.toLowerCase().includes(filter)
    );
  });
}

// ============================================================================
// Search Function
// ============================================================================

export function searchInSession(messages: SessionMessage[], query: string, caseSensitive = false): SearchResult[] {
  const results: SearchResult[] = [];
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  for (const msg of messages) {
    let matchCount = 0;
    let excerpt = "";

    for (const part of msg.parts) {
      const text = part.text ?? part.thinking ?? "";
      const searchText = caseSensitive ? text : text.toLowerCase();

      const idx = searchText.indexOf(searchQuery);
      if (idx !== -1) {
        matchCount++;
        if (!excerpt) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(text.length, idx + query.length + 50);
          excerpt = (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
        }
      }
    }

    if (matchCount > 0) {
      results.push({
        session_id: msg.id.split("/")[0] ?? msg.id,
        message_id: msg.id,
        role: msg.role,
        excerpt,
        match_count: matchCount,
        timestamp: msg.time?.created,
      });
    }
  }

  return results;
}
