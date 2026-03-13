import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export type StreamTone = "text" | "accent" | "muted" | "warning" | "error";
export type TranscriptKind = "assistant" | "user" | "tool" | "thinking" | "system" | "error";

function statusColor(status: string): "accent" | "success" | "warning" | "error" | "muted" {
  switch (status.toLowerCase()) {
    case "done":
    case "success":
    case "completed":
      return "success";
    case "running":
    case "active":
      return "accent";
    case "failed":
    case "error":
      return "error";
    case "aborted":
    case "canceled":
    case "cancelled":
    case "timeout":
      return "warning";
    default:
      return "muted";
  }
}

function roleColor(kind: TranscriptKind): "accent" | "toolTitle" | "error" | "muted" | "warning" {
  if (kind === "assistant") return "accent";
  if (kind === "tool") return "toolTitle";
  if (kind === "error") return "error";
  if (kind === "user") return "warning";
  return "muted";
}

export function blocktone(kind: TranscriptKind): StreamTone {
  if (kind === "tool") return "accent";
  if (kind === "thinking" || kind === "system") return "muted";
  if (kind === "error") return "error";
  return "text";
}

export function blocklabel(theme: Theme, kind: TranscriptKind, text: string): string {
  return theme.bold(theme.fg(roleColor(kind), text));
}

export function toneText(theme: Theme, kind: StreamTone, text: string): string {
  if (kind === "accent") return theme.fg("accent", text);
  if (kind === "muted") return theme.fg("muted", text);
  if (kind === "warning") return theme.fg("warning", text);
  if (kind === "error") return theme.fg("error", text);
  return text;
}

export function statusLabel(theme: Theme, status: string, selected: boolean): string {
  const label = status.toUpperCase();
  const colored = theme.fg(statusColor(status), label);
  return selected ? theme.bold(colored) : colored;
}

export function hotkey(theme: Theme, key: string): string {
  return theme.bold(theme.fg("accent", key));
}

export function makeChrome(theme: Theme, innerWidth: number): {
  row: (content?: string) => string;
  top: () => string;
  bottom: () => string;
  divider: () => string;
  strongDivider: () => string;
} {
  const pad = (text: string) => `${text}${" ".repeat(Math.max(0, innerWidth - visibleWidth(text)))}`;
  const row = (content = "") =>
    `${theme.fg("border", "│")}${pad(truncateToWidth(content, innerWidth))}${theme.fg("border", "│")}`;

  return {
    row,
    top: () => theme.fg("borderAccent", `╭${"─".repeat(innerWidth)}╮`),
    bottom: () => theme.fg("border", `╰${"─".repeat(innerWidth)}╯`),
    divider: () => theme.fg("border", `├${"─".repeat(innerWidth)}┤`),
    strongDivider: () => theme.fg("borderAccent", `├${"─".repeat(innerWidth)}┤`),
  };
}
