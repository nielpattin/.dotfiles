import * as path from "path";
import * as os from "os";

function getOpenCodeStorageDir(): string {
  if (process.platform === "win32") {
    return path.join(os.homedir(), ".local", "share", "opencode");
  }
  return process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, "opencode")
    : path.join(os.homedir(), ".local", "share", "opencode");
}

const STORAGE_BASE = getOpenCodeStorageDir();

// Message content storage
export const MESSAGE_STORAGE = path.join(STORAGE_BASE, "storage", "message");
export const PART_STORAGE = path.join(STORAGE_BASE, "storage", "part");

// Session metadata storage (contains title, directory, projectID)
export const SESSION_STORAGE = path.join(STORAGE_BASE, "storage", "session");

// Project metadata storage
export const PROJECT_STORAGE = path.join(STORAGE_BASE, "storage", "project");

// Todo storage
export const TODO_DIR = path.join(STORAGE_BASE, "storage", "todo");
