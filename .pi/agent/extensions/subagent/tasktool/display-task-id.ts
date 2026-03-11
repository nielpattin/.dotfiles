function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashToken(value: string, length = 6): string {
  const token = fnv1a32(value).toString(36);
  if (token.length >= length) return token.slice(0, length);
  return token.padStart(length, "0");
}

/**
 * Stable medium-length public task id used in user-facing UX.
 *
 * Examples:
 * - call_foo:1 -> task-1-0a9k2x
 * - very-long-id -> task-0f3m8q
 */
export function toPublicTaskId(taskId: string): string {
  const normalized = typeof taskId === "string" ? taskId.trim() : "";
  if (!normalized) return "task-unknown";

  const suffixMatch = /:(\d+)$/.exec(normalized);
  const suffix = suffixMatch?.[1];
  const token = hashToken(normalized, 6);
  return suffix ? `task-${suffix}-${token}` : `task-${token}`;
}

// Backward-compatible name used by existing callers.
export function toDisplayTaskId(taskId: string): string {
  return toPublicTaskId(taskId);
}
