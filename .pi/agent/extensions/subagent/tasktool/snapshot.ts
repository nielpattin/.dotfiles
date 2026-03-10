export interface SessionSnapshotSource {
  getHeader?: () => unknown;
  getEntries?: () => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildForkSessionSnapshotJsonl(
  sessionManager: SessionSnapshotSource | undefined,
): string | undefined {
  if (!sessionManager?.getHeader || !sessionManager.getEntries) return undefined;

  try {
    const header = sessionManager.getHeader();
    const entries = sessionManager.getEntries();
    if (!isRecord(header) || !Array.isArray(entries)) return undefined;

    const lines = [JSON.stringify(header)];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      lines.push(JSON.stringify(entry));
    }
    return `${lines.join("\n")}\n`;
  } catch {
    return undefined;
  }
}
