import { complete, type Context } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type VibeMode = "generate" | "file";

const DEFAULT_MODEL = "openai-codex/gpt-5.3-codex";

const DEFAULT_PROMPT = `Generate a 2-4 word "{theme}" themed loading message ending in "...".

Task: {task}

Be creative and unexpected. Avoid obvious/clichéd phrases for this theme.
The message should hint at the task using theme vocabulary.
{exclude}
Output only the message, nothing else.`;

const BATCH_PROMPT = `Generate {count} unique 2-4 word loading messages for a "{theme}" theme.
Each message should end with "..."
Be creative, varied, and thematic. No duplicates.
Output one message per line, nothing else. No numbering, no bullets.`;

const VIBE_SYSTEM_PROMPT =
  "You generate concise terminal loading messages. Follow the user instructions exactly and output plain text only.";

interface VibeConfig {
  theme: string | null;
  mode: VibeMode;
  modelSpec: string;
  fallback: string;
  timeout: number;
  promptTemplate: string;
  maxLength: number;
}

interface VibeGenContext {
  theme: string;
  userPrompt: string;
}

let config: VibeConfig = loadConfig();
let extensionCtx: ExtensionContext | null = null;
let currentGeneration: AbortController | null = null;
let isStreaming = false;

let vibeCache: string[] = [];
let vibeCacheTheme: string | null = null;
let vibeSeed = Date.now();
let vibeIndex = 0;

const MAX_RECENT_VIBES = 5;
let recentVibes: string[] = [];

function getSettingsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return join(homeDir, ".pi", "agent", "settings.json");
}

function loadConfig(): VibeConfig {
  const settingsPath = getSettingsPath();

  let settings: Record<string, unknown> = {};
  try {
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
  } catch {
    // ignore
  }

  const rawTheme = typeof settings.workingVibe === "string" ? settings.workingVibe : null;
  const theme = rawTheme?.toLowerCase() === "off" ? null : rawTheme;

  const rawMode = settings.workingVibeMode;
  const mode: VibeMode = rawMode === "file" || rawMode === "generate" ? rawMode : "generate";

  return {
    theme,
    mode,
    modelSpec: typeof settings.workingVibeModel === "string" ? settings.workingVibeModel : DEFAULT_MODEL,
    fallback: typeof settings.workingVibeFallback === "string" ? settings.workingVibeFallback : "Working",
    timeout: 3000,
    promptTemplate:
      typeof settings.workingVibePrompt === "string" ? settings.workingVibePrompt : DEFAULT_PROMPT,
    maxLength: typeof settings.workingVibeMaxLength === "number" ? settings.workingVibeMaxLength : 65,
  };
}

function readSettings(): Record<string, unknown> {
  const settingsPath = getSettingsPath();
  try {
    if (!existsSync(settingsPath)) return {};
    return JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  const settingsPath = getSettingsPath();
  try {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.debug("[working-vibes] Failed to write settings:", error);
  }
}

function saveThemeConfig(): void {
  const settings = readSettings();
  if (config.theme === null) {
    delete settings.workingVibe;
  } else {
    settings.workingVibe = config.theme;
  }
  writeSettings(settings);
}

function saveModelConfig(): void {
  const settings = readSettings();
  if (config.modelSpec === DEFAULT_MODEL) {
    delete settings.workingVibeModel;
  } else {
    settings.workingVibeModel = config.modelSpec;
  }
  writeSettings(settings);
}

function saveModeConfig(): void {
  const settings = readSettings();
  if (config.mode === "generate") {
    delete settings.workingVibeMode;
  } else {
    settings.workingVibeMode = config.mode;
  }
  writeSettings(settings);
}

function getVibesDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return join(homeDir, ".pi", "agent", "vibes");
}

function getVibeFilePath(theme: string): string {
  const filename = theme.toLowerCase().replace(/\s+/g, "-") + ".txt";
  return join(getVibesDir(), filename);
}

function loadVibesFromFile(theme: string): string[] {
  const filePath = getVibeFilePath(theme);
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.endsWith("..."));
  } catch {
    return [];
  }
}

function saveVibesToFile(theme: string, vibes: string[]): void {
  const vibesDir = getVibesDir();
  const filePath = getVibeFilePath(theme);

  if (!existsSync(vibesDir)) {
    mkdirSync(vibesDir, { recursive: true });
  }

  writeFileSync(filePath, vibes.join("\n"));
}

function mulberry32(seed: number): () => number {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getVibeAtIndex(vibes: string[], index: number, seed: number): string {
  if (vibes.length === 0) return `${config.fallback}...`;

  const effectiveIndex = index % vibes.length;
  const rng = mulberry32(seed);
  const indices = Array.from({ length: vibes.length }, (_, i) => i);

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = indices[i];
    const b = indices[j];
    if (a === undefined || b === undefined) continue;
    indices[i] = b;
    indices[j] = a;
  }

  const selected = indices[effectiveIndex];
  if (selected === undefined) return `${config.fallback}...`;
  return vibes[selected] ?? `${config.fallback}...`;
}

function getNextVibeFromFile(): string {
  if (!config.theme) return `${config.fallback}...`;

  if (vibeCacheTheme !== config.theme) {
    vibeCache = loadVibesFromFile(config.theme);
    vibeCacheTheme = config.theme;
    vibeSeed = Date.now();
    vibeIndex = 0;
  }

  if (vibeCache.length === 0) {
    return `${config.fallback}...`;
  }

  const vibe = getVibeAtIndex(vibeCache, vibeIndex, vibeSeed);
  vibeIndex++;
  return vibe;
}

function buildVibePrompt(ctx: VibeGenContext): string {
  const task = ctx.userPrompt.slice(0, 100);
  const exclude = recentVibes.length > 0 ? `Don't use: ${recentVibes.join(", ")}` : "";

  return config.promptTemplate
    .replace(/\{theme\}/g, ctx.theme)
    .replace(/\{task\}/g, task)
    .replace(/\{exclude\}/g, exclude);
}

function parseVibeResponse(response: string, fallback: string): string {
  if (!response) return `${fallback}...`;

  const firstLine = response.trim().split("\n")[0] ?? "";
  let vibe = firstLine.trim().replace(/^["']|["']$/g, "");

  if (!vibe.endsWith("...")) {
    vibe = vibe.replace(/\.+$/, "") + "...";
  }

  if (vibe.length > config.maxLength) {
    vibe = vibe.slice(0, config.maxLength - 3) + "...";
  }

  if (!vibe || vibe === "...") {
    return `${fallback}...`;
  }

  return vibe;
}

async function generateVibe(ctx: VibeGenContext, signal: AbortSignal): Promise<string> {
  if (!extensionCtx) {
    return `${config.fallback}...`;
  }

  const slashIndex = config.modelSpec.indexOf("/");
  if (slashIndex === -1) {
    return `${config.fallback}...`;
  }

  const provider = config.modelSpec.slice(0, slashIndex);
  const modelId = config.modelSpec.slice(slashIndex + 1);
  if (!provider || !modelId) {
    return `${config.fallback}...`;
  }

  const model = extensionCtx.modelRegistry.find(provider, modelId);
  if (!model) {
    console.debug(`[working-vibes] Model not found: ${config.modelSpec}`);
    return `${config.fallback}...`;
  }

  const apiKey = await extensionCtx.modelRegistry.getApiKey(model);
  if (!apiKey) {
    console.debug(`[working-vibes] No API key for provider: ${provider}`);
    return `${config.fallback}...`;
  }

  const aiContext: Context = {
    systemPrompt: VIBE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildVibePrompt(ctx) }],
        timestamp: Date.now(),
      },
    ],
  };

  const response = await complete(model, aiContext, { apiKey, signal });
  const textContent = response.content.find((c) => c.type === "text");
  const text = textContent?.type === "text" ? textContent.text : "";
  return parseVibeResponse(text, config.fallback);
}

function trackRecentVibe(vibe: string): void {
  if (vibe === `${config.fallback}...`) return;
  recentVibes = [vibe, ...recentVibes.filter((v) => v !== vibe)].slice(0, MAX_RECENT_VIBES);
}

function updateVibeFromFile(setWorkingMessage: (msg?: string) => void): void {
  const vibe = getNextVibeFromFile();
  setWorkingMessage(vibe);
}

async function generateAndUpdate(prompt: string, setWorkingMessage: (msg?: string) => void): Promise<void> {
  if (config.mode === "file") {
    updateVibeFromFile(setWorkingMessage);
    return;
  }

  const controller = new AbortController();
  currentGeneration?.abort();
  currentGeneration = controller;

  const timeoutSignal = AbortSignal.timeout(config.timeout);
  const combinedSignal = AbortSignal.any([controller.signal, timeoutSignal]);

  try {
    const vibe = await generateVibe({ theme: config.theme ?? "", userPrompt: prompt }, combinedSignal);

    if (isStreaming && !controller.signal.aborted) {
      trackRecentVibe(vibe);
      setWorkingMessage(vibe);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.debug("[working-vibes] Generation aborted");
    } else {
      console.debug("[working-vibes] Generation failed:", error);
    }
  }
}

export function initVibeManager(ctx: ExtensionContext): void {
  extensionCtx = ctx;
  config = loadConfig();
}

export function getVibeTheme(): string | null {
  return config.theme;
}

export function setVibeTheme(theme: string | null): void {
  config = { ...config, theme };
  recentVibes = [];
  saveThemeConfig();
}

export function getVibeModel(): string {
  return config.modelSpec;
}

export function setVibeModel(modelSpec: string): void {
  config = { ...config, modelSpec };
  saveModelConfig();
}

export function getVibeMode(): VibeMode {
  return config.mode;
}

export function setVibeMode(mode: VibeMode): void {
  config = { ...config, mode };
  saveModeConfig();
}

export function onVibeBeforeAgentStart(prompt: string, setWorkingMessage: (msg?: string) => void): void {
  if (!config.theme || !extensionCtx) return;

  if (config.mode === "file") {
    return;
  }

  setWorkingMessage(`Channeling ${config.theme}...`);
  void generateAndUpdate(prompt, setWorkingMessage);
}

export function onVibeAgentStart(setWorkingMessage?: (msg?: string) => void): void {
  isStreaming = true;

  if (setWorkingMessage && config.mode === "file" && config.theme) {
    updateVibeFromFile(setWorkingMessage);
  }
}

export function onVibeToolCall(
  _toolName: string,
  _toolInput: Record<string, unknown>,
  setWorkingMessage: (msg?: string) => void,
): void {
  if (!config.theme || !extensionCtx || !isStreaming) return;

  // Event-based only: rotate on each tool call (no timer).
  if (config.mode === "file") {
    updateVibeFromFile(setWorkingMessage);
  }
}

export function onVibeAgentEnd(setWorkingMessage: (msg?: string) => void): void {
  isStreaming = false;
  currentGeneration?.abort();
  setWorkingMessage(undefined);
}

export function hasVibeFile(theme: string): boolean {
  return existsSync(getVibeFilePath(theme));
}

export function getVibeFileCount(theme: string): number {
  return loadVibesFromFile(theme).length;
}

export interface GenerateVibesResult {
  success: boolean;
  count: number;
  filePath: string;
  error?: string;
}

export async function generateVibesBatch(theme: string, count = 100): Promise<GenerateVibesResult> {
  const filePath = getVibeFilePath(theme);

  if (!extensionCtx) {
    return { success: false, count: 0, filePath, error: "Extension not initialized" };
  }

  const slashIndex = config.modelSpec.indexOf("/");
  if (slashIndex === -1) {
    return { success: false, count: 0, filePath, error: "Invalid model spec" };
  }

  const provider = config.modelSpec.slice(0, slashIndex);
  const modelId = config.modelSpec.slice(slashIndex + 1);

  const model = extensionCtx.modelRegistry.find(provider, modelId);
  if (!model) {
    return { success: false, count: 0, filePath, error: `Model not found: ${config.modelSpec}` };
  }

  const apiKey = await extensionCtx.modelRegistry.getApiKey(model);
  if (!apiKey) {
    return { success: false, count: 0, filePath, error: `No API key for provider: ${provider}` };
  }

  const targetCount = Math.max(1, Math.min(500, Number.isFinite(count) ? Math.floor(count) : 100));
  const collected = new Set<string>();
  let lastFailure = "No text response from model";

  const parseLines = (text: string): string[] => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        let vibe = line.replace(/^["'\d.\-)\s]+/, "").trim();
        vibe = vibe.replace(/["']$/g, "");
        if (!vibe.endsWith("...")) {
          vibe = vibe.replace(/\.+$/, "") + "...";
        }
        return vibe;
      })
      .filter((vibe) => vibe.length > 3 && vibe !== "...");
  };

  const maxAttempts = Math.max(4, Math.ceil(targetCount / 40) * 2);

  for (let attempt = 1; attempt <= maxAttempts && collected.size < targetCount; attempt++) {
    const remaining = targetCount - collected.size;
    const chunkSize = Math.min(40, remaining);

    const prompt = BATCH_PROMPT.replace(/\{theme\}/g, theme).replace(/\{count\}/g, String(chunkSize));

    const aiContext: Context = {
      systemPrompt: VIBE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        },
      ],
    };

    try {
      const signal = AbortSignal.timeout(30000);
      const response = await complete(model, aiContext, {
        apiKey,
        signal,
        reasoning: "minimal",
        textVerbosity: "low",
      });

      const textBlocks = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .filter((t) => t.trim().length > 0);

      const rawText = textBlocks.join("\n").trim();
      if (!rawText) {
        const reason = response.stopReason;
        const details = response.errorMessage?.trim();
        lastFailure = details ? `${reason}: ${details}` : `No text content (stopReason: ${reason})`;
        continue;
      }

      const vibes = parseLines(rawText);
      if (vibes.length === 0) {
        lastFailure = "Model returned text but no valid vibe lines";
        continue;
      }

      for (const vibe of vibes) {
        collected.add(vibe);
        if (collected.size >= targetCount) break;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "Unknown error";
    }
  }

  const finalVibes = [...collected];
  if (finalVibes.length === 0) {
    return {
      success: false,
      count: 0,
      filePath,
      error: `${lastFailure} (model: ${config.modelSpec})`,
    };
  }

  saveVibesToFile(theme, finalVibes);

  if (vibeCacheTheme === theme) {
    vibeCache = [];
    vibeCacheTheme = null;
  }

  return { success: true, count: finalVibes.length, filePath };
}
