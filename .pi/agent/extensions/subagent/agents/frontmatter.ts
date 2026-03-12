import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { SUBAGENT_LOG_PREFIX } from "../constants.js";
import type { AgentConfig } from "./types.js";

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : null;

  if (!values) return undefined;

  const normalized = Array.from(new Set(
    values
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  ));

  return normalized.length > 0 ? normalized : [];
}

export function parseListField(
  filePath: string,
  fieldName: "tools" | "skills" | "extensions",
  value: unknown,
): string[] | undefined {
  if (value === undefined) return undefined;

  if (fieldName === "extensions" && value === null) {
    return [];
  }

  let parsed: string[];
  if (typeof value === "string") {
    parsed = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (Array.isArray(value)) {
    parsed = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } else {
    if (fieldName !== "extensions") {
      console.warn(
        `${SUBAGENT_LOG_PREFIX} Ignoring invalid ${fieldName} field in "${filePath}". Expected a comma-separated string or string array.`,
      );
    }
    return undefined;
  }

  if (parsed.length === 0) {
    return fieldName === "extensions" ? [] : undefined;
  }

  return parsed;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function serializeYamlValue(value: unknown, indent = ""): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return ["[]"];

    const lines: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        lines.push(`${indent}- ${quoteYamlString(item)}`);
      } else if (typeof item === "number" || typeof item === "boolean") {
        lines.push(`${indent}- ${String(item)}`);
      }
    }
    return lines.length > 0 ? lines : ["[]"];
  }

  if (typeof value === "string") return [quoteYamlString(value)];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (value === null) return ["null"];
  return [];
}

function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  const preferredOrder = [
    "name",
    "description",
    "model",
    "thinking",
    "tools",
    "skills",
    "extensions",
    "cwd",
  ];

  const keys = Object.keys(frontmatter)
    .filter((key) => frontmatter[key] !== undefined)
    .sort((a, b) => {
      const ai = preferredOrder.indexOf(a);
      const bi = preferredOrder.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });

  const lines: string[] = [];
  for (const key of keys) {
    const valueLines = serializeYamlValue(frontmatter[key]);
    if (valueLines.length === 0) continue;

    if (valueLines.length === 1) {
      lines.push(`${key}: ${valueLines[0]}`);
    } else {
      lines.push(`${key}:`);
      for (const line of valueLines) {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join("\n");
}

export function parseAgentDocument(
  filePath: string,
): { frontmatter: Record<string, unknown>; body: string } {
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = parseFrontmatter<Record<string, unknown>>(content);
  return {
    frontmatter: { ...(parsed.frontmatter ?? {}) },
    body: parsed.body ?? "",
  };
}

export function buildAgentFile(frontmatter: Record<string, unknown>, body: string): string {
  const serializedFrontmatter = serializeFrontmatter(frontmatter);
  const normalizedBody = body.replace(/^\r?\n/, "");
  return `---\n${serializedFrontmatter}\n---\n${normalizedBody}`;
}

/** Parse a single agent markdown file into an AgentConfig. Returns null on skip. */
export function parseAgentFile(
  filePath: string,
  source: "user" | "project",
): AgentConfig | null {
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseAgentDocument(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `${SUBAGENT_LOG_PREFIX} Skipping invalid agent file "${filePath}": ${message}`,
    );
    return null;
  }

  const frontmatter = parsed.frontmatter ?? {};
  const body = parsed.body ?? "";

  const name =
    typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : "";
  if (!name || !description) return null;

  const tools = parseListField(filePath, "tools", frontmatter.tools);
  const skills = parseListField(filePath, "skills", frontmatter.skills);
  const extensions = parseListField(filePath, "extensions", frontmatter.extensions);

  return {
    name,
    description,
    tools,
    skills,
    extensions,
    cwd: normalizeString(frontmatter.cwd),
    model:
      typeof frontmatter.model === "string" ? frontmatter.model : undefined,
    thinking:
      typeof frontmatter.thinking === "string"
        ? frontmatter.thinking
        : undefined,
    systemPrompt: body,
    source,
    filePath,
  };
}
