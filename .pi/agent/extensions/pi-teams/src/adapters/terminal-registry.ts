/**
 * Terminal Registry
 *
 * pi-teams currently supports Windows Terminal only.
 */

import type { TerminalAdapter } from "../utils/terminal-adapter";
import { WindowsAdapter } from "./windows-adapter";

const adapters: TerminalAdapter[] = [new WindowsAdapter()];

let cachedAdapter: TerminalAdapter | null = null;

export function getTerminalAdapter(): TerminalAdapter | null {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  for (const adapter of adapters) {
    if (adapter.detect()) {
      cachedAdapter = adapter;
      return adapter;
    }
  }

  return null;
}

export function getAdapterByName(name: string): TerminalAdapter | undefined {
  return adapters.find(a => a.name === name);
}

export function getAllAdapters(): TerminalAdapter[] {
  return [...adapters];
}

export function clearAdapterCache(): void {
  cachedAdapter = null;
}

export function setAdapter(adapter: TerminalAdapter): void {
  cachedAdapter = adapter;
}

export function hasTerminalAdapter(): boolean {
  return getTerminalAdapter() !== null;
}

export function supportsWindows(): boolean {
  const adapter = getTerminalAdapter();
  return adapter?.supportsWindows() ?? false;
}

export function getTerminalName(): string | null {
  return getTerminalAdapter()?.name ?? null;
}
