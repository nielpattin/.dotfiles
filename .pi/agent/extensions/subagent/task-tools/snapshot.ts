export interface SessionSnapshotSource {
  getHeader?: () => unknown;
  getEntries?: () => unknown;
  getSessionFile?: () => string | undefined;
}

export interface SessionSnapshot {
  header: Record<string, unknown>;
  entries: Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function captureForkSessionSnapshot(
  sessionManager: SessionSnapshotSource | undefined,
): SessionSnapshot | undefined {
  if (!sessionManager?.getHeader || !sessionManager.getEntries) return undefined;

  try {
    const header = sessionManager.getHeader();
    const entries = sessionManager.getEntries();
    if (!isRecord(header) || !Array.isArray(entries)) return undefined;

    return {
      header: { ...header },
      entries: entries.filter(isRecord).map((entry) => ({ ...entry })),
    };
  } catch {
    return undefined;
  }
}
