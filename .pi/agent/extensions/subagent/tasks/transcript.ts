import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { getFinalOutput } from "../types.js";
import type { TaskDetail } from "../state/task-store.js";
import { blocklabel, blocktone, toneText, type TranscriptKind } from "./theme.js";

interface TranscriptBlock {
  kind: TranscriptKind;
  label: string;
  markdown: boolean;
  text: string;
}

function oneLine(text: string, max = 180): string {
  const compact = text.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 3))}...`;
}

function wrapWords(text: string, maxWidth: number): string[] {
  const width = Math.max(8, maxWidth);
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }

    const words = trimmed.split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (visibleWidth(next) <= width) {
        line = next;
        continue;
      }

      if (line) out.push(line);
      if (visibleWidth(word) > width) {
        out.push(truncateToWidth(word, width));
        line = "";
      } else {
        line = word;
      }
    }

    if (line) out.push(line);
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.length > 0 ? out : [""];
}

function wrapWithPrefix(prefix: string, body: string, maxWidth: number): string[] {
  const width = Math.max(8, maxWidth);
  const bodyWidth = Math.max(4, width - visibleWidth(prefix));
  const lines = wrapWords(body, bodyWidth);
  if (lines.length === 0) return [prefix.trimEnd()];

  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    out.push(`${i === 0 ? prefix : " ".repeat(Math.max(1, visibleWidth(prefix)))}${lines[i]}`);
  }
  return out;
}

function wrapMarkdown(text: string, maxWidth: number): string[] {
  const width = Math.max(8, maxWidth);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      out.push(truncateToWidth(trimmed || "```", width));
      continue;
    }

    if (inFence) {
      if (!line) {
        out.push("");
      } else if (line.length <= width) {
        out.push(line);
      } else {
        for (let i = 0; i < line.length; i += width) {
          out.push(line.slice(i, i + width));
        }
      }
      continue;
    }

    if (!trimmed) {
      out.push("");
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      out.push(...wrapWords(`▸ ${headingMatch[2]}`, width));
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      out.push(...wrapWithPrefix("❯ ", quoteMatch[1] || "", width));
      continue;
    }

    const bulletMatch = trimmed.match(/^([-*+]\s+|\d+\.\s+)(.+)$/);
    if (bulletMatch) {
      out.push(...wrapWithPrefix(`${bulletMatch[1] ?? ""}`, bulletMatch[2] ?? "", width));
      continue;
    }

    out.push(...wrapWords(trimmed, width));
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.length > 0 ? out : [""];
}

function toolCallPreview(args: unknown): string {
  if (args == null) return "No arguments";
  if (typeof args === "object") {
    const json = JSON.stringify(args);
    return json ? oneLine(json, 220) : "No arguments";
  }
  return oneLine(String(args), 220) || "No arguments";
}

function buildTranscriptBlocks(detail: TaskDetail): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const result = detail.result;

  if (!result) {
    return [{ kind: "system", label: "System", markdown: false, text: "No run output yet." }];
  }

  for (const message of result.messages) {
    if (!message) continue;

    if (message.role === "assistant") {
      for (const part of message.content || []) {
        const type = (part as any)?.type;
        if (type === "text" && typeof (part as any).text === "string") {
          blocks.push({ kind: "assistant", label: "Assistant", markdown: true, text: (part as any).text });
          continue;
        }

        if (type === "toolCall" && typeof (part as any).name === "string") {
          blocks.push({
            kind: "tool",
            label: `Tool · ${(part as any).name}`,
            markdown: false,
            text: toolCallPreview((part as any).arguments),
          });
          continue;
        }

        if ((type === "reasoning" || type === "thinking") && typeof (part as any).text === "string") {
          blocks.push({ kind: "thinking", label: "Thinking", markdown: true, text: (part as any).text });
          continue;
        }

        if ((type === "reasoning" || type === "thinking") && typeof (part as any).reasoning === "string") {
          blocks.push({
            kind: "thinking",
            label: "Thinking",
            markdown: true,
            text: (part as any).reasoning,
          });
        }
      }
      continue;
    }

    if (message.role === "toolResult") {
      continue;
    }

    if (message.role === "user") {
      for (const part of message.content || []) {
        if ((part as any)?.type === "text" && typeof (part as any).text === "string") {
          blocks.push({ kind: "user", label: "User", markdown: true, text: (part as any).text });
        }
      }
    }
  }

  if (blocks.length === 0) {
    const final = getFinalOutput(result.messages);
    if (final) blocks.push({ kind: "assistant", label: "Assistant", markdown: true, text: final });
  }

  if (result.errorMessage) {
    blocks.push({ kind: "error", label: "Error", markdown: false, text: result.errorMessage });
  }

  return blocks;
}

export function renderTranscriptLines(detail: TaskDetail, innerWidth: number, theme: Theme): string[] {
  const blocks = buildTranscriptBlocks(detail);
  if (blocks.length === 0) return [` ${theme.fg("muted", "No messages yet.")}`];

  const rows: string[] = [];

  for (let idx = 0; idx < blocks.length; idx += 1) {
    const block = blocks[idx]!;
    const heading = blocklabel(theme, block.kind, block.label);
    const prefix = ` ${heading} `;
    const continuationPrefix = ` ${" ".repeat(Math.max(3, visibleWidth(block.label) + 1))}`;
    const contentWidth = Math.max(8, innerWidth - visibleWidth(prefix));
    if (block.kind === "tool") {
      const singleLine = truncateToWidth(oneLine(block.text || "-", contentWidth), contentWidth);
      rows.push(`${prefix}${toneText(theme, blocktone(block.kind), singleLine)}`);
    } else {
      const wrapped = (block.markdown
        ? wrapMarkdown(block.text || "-", contentWidth)
        : wrapWords(block.text || "-", contentWidth));

      for (let i = 0; i < wrapped.length; i += 1) {
        const lead = i === 0 ? prefix : continuationPrefix;
        rows.push(`${lead}${toneText(theme, blocktone(block.kind), wrapped[i] || "")}`);
      }
    }

    if (idx < blocks.length - 1) rows.push("");
  }

  return rows;
}
