import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionSnapshot } from "../tasktool/snapshot.js";

function toSerializableSnapshot(snapshot: SessionSnapshot): string {
  const payload = {
    header: snapshot.header,
    entries: snapshot.entries,
  };
  return JSON.stringify(payload, null, 2);
}

export function writePromptToTempFile(
  agentName: string,
  prompt: string,
): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

export function initializeSpawnChildSessionFile(sessionFile: string): void {
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
  }
}

export function initializeForkChildSessionFile(sessionFile: string): void {
  initializeSpawnChildSessionFile(sessionFile);
}

export function buildForkSnapshotPrompt(snapshot: SessionSnapshot): string {
  return [
    "Forked context from parent Pi session snapshot:",
    "```json",
    toSerializableSnapshot(snapshot),
    "```",
    "Use this context as inherited conversation state for the delegated task.",
  ].join("\n");
}

export function cleanupTempDir(dir: string | null): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
