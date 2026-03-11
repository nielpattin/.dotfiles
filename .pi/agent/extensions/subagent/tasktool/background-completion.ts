import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type BackgroundCompletionStatus = "success" | "error" | "aborted";

export interface BackgroundCompletionEvent {
  taskId: string;
  publicTaskId?: string;
  sessionId: string;
  agent: string;
  summary: string;
  status: BackgroundCompletionStatus;
  output: string;
  finishedAt: number;
}

function encodeSessionId(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

function decodeSessionId(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._:-]+/g, "-").slice(0, 80) || "task";
}

function defaultInboxRoot(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "background-inbox");
}

export function createBackgroundCompletionInbox(rootDir = defaultInboxRoot()) {
  const ensureRoot = () => {
    fs.mkdirSync(rootDir, { recursive: true });
  };

  const getSessionDir = (sessionId: string) => {
    ensureRoot();
    const sessionDir = path.join(rootDir, encodeSessionId(sessionId));
    fs.mkdirSync(sessionDir, { recursive: true });
    return sessionDir;
  };

  const enqueue = (event: BackgroundCompletionEvent): string => {
    const sessionDir = getSessionDir(event.sessionId);
    const fileName = `${event.finishedAt}-${sanitizeTaskId(event.taskId)}-${randomUUID().slice(0, 8)}.json`;
    const filePath = path.join(sessionDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(event), "utf-8");
    return filePath;
  };

  const listSessionIds = (): string[] => {
    ensureRoot();
    const dirs = fs.readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => decodeSessionId(entry.name));
    return dirs.sort((a, b) => a.localeCompare(b));
  };

  const drainSession = (sessionId: string): BackgroundCompletionEvent[] => {
    const sessionDir = path.join(rootDir, encodeSessionId(sessionId));
    if (!fs.existsSync(sessionDir)) return [];

    const files = fs.readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const events: BackgroundCompletionEvent[] = [];
    for (const fileName of files) {
      const filePath = path.join(sessionDir, fileName);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as BackgroundCompletionEvent;
        if (
          parsed
          && typeof parsed.taskId === "string"
          && (parsed.publicTaskId === undefined || typeof parsed.publicTaskId === "string")
          && typeof parsed.sessionId === "string"
          && typeof parsed.agent === "string"
          && typeof parsed.summary === "string"
          && typeof parsed.status === "string"
          && typeof parsed.output === "string"
          && typeof parsed.finishedAt === "number"
        ) {
          events.push(parsed);
        }
      } catch {
        // ignore malformed payloads
      } finally {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore unlink errors
        }
      }
    }

    try {
      if (fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir);
    } catch {
      // ignore cleanup errors
    }

    return events;
  };

  const clearAll = (): void => {
    try {
      fs.rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  return {
    rootDir,
    enqueue,
    drainSession,
    listSessionIds,
    clearAll,
  };
}
