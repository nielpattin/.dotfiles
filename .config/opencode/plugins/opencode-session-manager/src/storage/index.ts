import * as fs from "fs";
import * as path from "path";
import {
  MESSAGE_STORAGE,
  PART_STORAGE,
  SESSION_STORAGE,
  TODO_DIR,
} from "./paths";
import type {
  SessionMessage,
  MessagePart,
  SessionInfo,
  SessionMetadata,
  TodoItem,
} from "../types";

// ============================================================================
// Session Metadata (from storage/session/<projectID>/<sessionID>.json)
// ============================================================================

/**
 * Find and read session metadata from the session storage.
 * Sessions are stored under: storage/session/<projectID>/<sessionID>.json
 */
export function getSessionMetadata(sessionId: string): SessionMetadata | null {
  if (!fs.existsSync(SESSION_STORAGE)) {
    return null;
  }

  try {
    // Session storage is organized by projectID, so we need to search
    const projectDirs = fs.readdirSync(SESSION_STORAGE, { withFileTypes: true });
    
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;
      
      const sessionFile = path.join(SESSION_STORAGE, projectDir.name, `${sessionId}.json`);
      if (fs.existsSync(sessionFile)) {
        const content = fs.readFileSync(sessionFile, "utf-8");
        return JSON.parse(content) as SessionMetadata;
      }
    }
  } catch {
    // Ignore errors
  }
  
  return null;
}

/**
 * Get all session IDs by scanning the session metadata storage.
 * Returns sessions sorted by last updated time (newest first).
 */
export function getAllSessions(): string[] {
  if (!fs.existsSync(SESSION_STORAGE)) {
    return [];
  }

  const sessions: Array<{ id: string; updated: number }> = [];

  try {
    const projectDirs = fs.readdirSync(SESSION_STORAGE, { withFileTypes: true });
    
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;
      
      const projectPath = path.join(SESSION_STORAGE, projectDir.name);
      const sessionFiles = fs.readdirSync(projectPath).filter(f => f.endsWith(".json"));
      
      for (const file of sessionFiles) {
        try {
          const content = fs.readFileSync(path.join(projectPath, file), "utf-8");
          const metadata = JSON.parse(content) as SessionMetadata;
          sessions.push({
            id: metadata.id,
            updated: metadata.time?.updated ?? 0,
          });
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    return [];
  }

  // Sort by updated time (newest first)
  return sessions
    .sort((a, b) => b.updated - a.updated)
    .map(s => s.id);
}

// ============================================================================
// Message Parts (from storage/part/<messageID>/)
// ============================================================================

export function readParts(messageId: string): MessagePart[] {
  const partsDir = path.join(PART_STORAGE, messageId);
  if (!fs.existsSync(partsDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(partsDir).filter((f) => f.endsWith(".json"));
    return files
      .sort()
      .map((file) => {
        try {
          const content = fs.readFileSync(path.join(partsDir, file), "utf-8");
          return JSON.parse(content) as MessagePart;
        } catch {
          return null;
        }
      })
      .filter((p): p is MessagePart => p !== null);
  } catch {
    return [];
  }
}

// ============================================================================
// Messages (from storage/message/<sessionID>/)
// ============================================================================

export function readSessionMessages(
  sessionId: string,
  limit = 50,
): SessionMessage[] {
  const messageDir = path.join(MESSAGE_STORAGE, sessionId);
  if (!fs.existsSync(messageDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(messageDir).filter((f) => f.endsWith(".json"));
    const sortedFiles = files.sort((a, b) => a.localeCompare(b));
    const filesToRead = sortedFiles.slice(-limit);

    return filesToRead
      .map((file) => {
        try {
          const content = fs.readFileSync(path.join(messageDir, file), "utf-8");
          const message = JSON.parse(content) as SessionMessage;
          message.parts = readParts(message.id);
          return message;
        } catch {
          return null;
        }
      })
      .filter((m): m is SessionMessage => m !== null);
  } catch {
    return [];
  }
}

// ============================================================================
// Todos (from storage/todo/<sessionID>.json)
// ============================================================================

export function readSessionTodos(sessionId: string): TodoItem[] {
  const todoPath = path.join(TODO_DIR, `${sessionId}.json`);
  if (!fs.existsSync(todoPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(todoPath, "utf-8");
    return JSON.parse(content) as TodoItem[];
  } catch {
    return [];
  }
}

// ============================================================================
// Combined Session Info
// ============================================================================

/**
 * Get project name from directory path (last folder name).
 */
function getProjectName(directory: string): string {
  if (!directory) return "unknown";
  const normalized = directory.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "unknown";
}

/**
 * Get comprehensive session info combining metadata and messages.
 */
export function getSessionInfo(sessionId: string): SessionInfo | null {
  // First, get session metadata (title, directory, etc.)
  const metadata = getSessionMetadata(sessionId);
  
  // Also read messages to get agent info and message count
  const messages = readSessionMessages(sessionId, 1000);
  
  // If neither exists, session not found
  if (!metadata && messages.length === 0) {
    return null;
  }

  // Collect agents used
  const agents = new Set<string>();
  let firstMessageTime: number | undefined;
  let lastMessageTime: number | undefined;

  for (const msg of messages) {
    if (msg.agent) {
      agents.add(msg.agent);
    }
    const created = msg.time?.created;
    if (created) {
      if (!firstMessageTime || created < firstMessageTime) {
        firstMessageTime = created;
      }
      if (!lastMessageTime || created > lastMessageTime) {
        lastMessageTime = created;
      }
    }
  }

  // Get todos
  const todos = readSessionTodos(sessionId);

  return {
    id: sessionId,
    title: metadata?.title ?? "Untitled Session",
    directory: metadata?.directory ?? "Unknown",
    project_name: getProjectName(metadata?.directory ?? ""),
    message_count: messages.length,
    first_message: firstMessageTime ?? metadata?.time?.created,
    last_message: lastMessageTime ?? metadata?.time?.updated,
    agents_used: Array.from(agents),
    has_todos: todos.length > 0,
    todos: todos.length > 0 ? todos : undefined,
  };
}
