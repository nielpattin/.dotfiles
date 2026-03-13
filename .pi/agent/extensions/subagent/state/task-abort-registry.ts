export interface TaskAbortRegistry {
  register(sessionId: string, abort: () => void): void;
  abort(sessionId: string): boolean;
  unregister(sessionId: string): void;
  has(sessionId: string): boolean;
}

export function createTaskAbortRegistry(): TaskAbortRegistry {
  const abortBySessionId = new Map<string, () => void>();

  const normalizeSessionId = (sessionId: string): string => sessionId.trim();

  return {
    register(sessionId: string, abort: () => void): void {
      const normalized = normalizeSessionId(sessionId);
      if (!normalized) return;
      abortBySessionId.set(normalized, abort);
    },

    abort(sessionId: string): boolean {
      const normalized = normalizeSessionId(sessionId);
      if (!normalized) return false;
      const abort = abortBySessionId.get(normalized);
      if (!abort) return false;
      abort();
      return true;
    },

    unregister(sessionId: string): void {
      const normalized = normalizeSessionId(sessionId);
      if (!normalized) return;
      abortBySessionId.delete(normalized);
    },

    has(sessionId: string): boolean {
      const normalized = normalizeSessionId(sessionId);
      if (!normalized) return false;
      return abortBySessionId.has(normalized);
    },
  };
}
