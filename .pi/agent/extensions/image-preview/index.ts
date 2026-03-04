/**
 * image-preview extension
 *
 * What it does:
 * - Converts pasted Windows image file paths in user input into real image attachments.
 * - Renders image previews inline under the corresponding user message in interactive TUI.
 * - Supports Sixel on Windows with native fallback rendering.
 *
 * Notes:
 * - This file intentionally combines conversion + preview logic in one place.
 * - Session history keeps image payloads; inline rendering is patched on load/switch.
 */

import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

import {
  type ExtensionAPI,
  InteractiveMode,
  UserMessageComponent,
} from "@mariozechner/pi-coding-agent";
import {
  calculateImageRows,
  getImageDimensions,
  Image,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

import { convertImageToSixelSequence, ensureSixelModuleAvailable } from "./sixel.js";

const DEFAULT_MAX_WIDTH_CELLS = 60;
const MAX_IMAGES_PER_MESSAGE = 3;
const SIXEL_IMAGE_LINE_MARKER = "\x1b_Gm=0;\x1b\\";
const PREVIEW_ITEM_CACHE_LIMIT = 64;

function shouldAttemptSixelRendering(): boolean {
  return process.platform === "win32";
}

type ImagePayload = {
  type: "image";
  data: string;
  mimeType: string;
};

type ImagePreviewItem = {
  protocol: "sixel" | "native";
  mimeType: string;
  rows: number;
  maxWidthCells: number;
  sixelSequence?: string;
  data?: string;
  warning?: string;
};

type UserMessageRenderFn = (width: number) => string[];

type UserMessagePrototype = {
  render: UserMessageRenderFn;
  __piImageToolsInlineOriginalRender?: UserMessageRenderFn;
  __piImageToolsInlinePatched?: boolean;
};

type UserMessageInstance = {
  __piImageToolsInlineAssigned?: boolean;
  __piImageToolsInlineItems?: ImagePreviewItem[];
};

type InteractiveModePrototype = {
  addMessageToChat: (message: unknown, options?: unknown) => void;
  __piImageToolsOriginalAddMessageToChat?: (message: unknown, options?: unknown) => void;
  __piImageToolsPreviewPatched?: boolean;
};

interface UserImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

interface UserMessageLike {
  role?: unknown;
  content?: unknown;
}

interface InteractiveModeLike {
  chatContainer?: {
    children?: unknown[];
  };
}

function estimateImageRows(image: ImagePayload, maxWidthCells: number): number {

  const dimensions = getImageDimensions(image.data, image.mimeType);
  if (!dimensions) {
    return 12;
  }

  return Math.max(1, Math.min(calculateImageRows(dimensions, maxWidthCells), 80));
}

const previewItemCache = new Map<string, ImagePreviewItem>();

function buildPreviewCacheKey(image: ImagePayload, sixelMode: string): string {
  const head = image.data.slice(0, 64);
  const tail = image.data.slice(-64);
  return `${image.mimeType}|${image.data.length}|${head}|${tail}|${sixelMode}`;
}

function rememberPreviewItem(key: string, item: ImagePreviewItem): void {
  if (previewItemCache.size >= PREVIEW_ITEM_CACHE_LIMIT) {
    const oldest = previewItemCache.keys().next().value;
    if (oldest) {
      previewItemCache.delete(oldest);
    }
  }
  previewItemCache.set(key, item);
}

function buildPreviewItems(images: readonly ImagePayload[]): ImagePreviewItem[] {
  const selectedImages = images.slice(0, MAX_IMAGES_PER_MESSAGE);
  if (selectedImages.length === 0) {
    return [];
  }

  const attemptSixel = shouldAttemptSixelRendering();
  const sixelState = attemptSixel ? ensureSixelModuleAvailable() : undefined;
  const sixelMode = sixelState?.available
    ? `sixel:${sixelState.version ?? "unknown"}`
    : `native:${sixelState?.reason ?? "no-sixel"}`;

  return selectedImages.map((image) => {
    const cacheKey = buildPreviewCacheKey(image, sixelMode);
    const cached = previewItemCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = estimateImageRows(image, DEFAULT_MAX_WIDTH_CELLS);

    let item: ImagePreviewItem;

    if (attemptSixel && sixelState?.available) {
      const conversion = convertImageToSixelSequence(image);
      if (conversion.sequence) {
        item = {
          protocol: "sixel",
          mimeType: image.mimeType,
          rows,
          maxWidthCells: DEFAULT_MAX_WIDTH_CELLS,
          sixelSequence: conversion.sequence,
        };
      } else {
        item = {
          protocol: "native",
          mimeType: image.mimeType,
          rows,
          maxWidthCells: DEFAULT_MAX_WIDTH_CELLS,
          data: image.data,
          warning: conversion.error,
        };
      }
    } else {
      item = {
        protocol: "native",
        mimeType: image.mimeType,
        rows,
        maxWidthCells: DEFAULT_MAX_WIDTH_CELLS,
        data: image.data,
        warning:
          attemptSixel && sixelState && !sixelState.available
            ? `Sixel preview unavailable: ${sixelState.reason || "missing PowerShell Sixel module."}`
            : undefined,
      };
    }

    rememberPreviewItem(cacheKey, item);
    return item;
  });
}

function sanitizeRows(rows: number): number {
  return Math.max(1, Math.min(Math.trunc(rows), 80));
}

function buildSixelLines(sequence: string, rows: number): string[] {
  const safeRows = sanitizeRows(rows);
  const lines = Array.from({ length: Math.max(0, safeRows - 1) }, () => "");
  const moveUp = safeRows > 1 ? `\x1b[${safeRows - 1}A` : "";
  return [...lines, `${SIXEL_IMAGE_LINE_MARKER}${moveUp}${sequence}`];
}

function buildNativeLines(item: ImagePreviewItem, width: number): string[] {
  if (!item.data) {
    return [];
  }

  const image = new Image(
    item.data,
    item.mimeType,
    {
      fallbackColor: (text: string) => text,
    },
    {
      maxWidthCells: item.maxWidthCells,
    },
  );

  return image.render(Math.max(8, width));
}

function isInlineImageLine(line: string): boolean {
  return line.startsWith(SIXEL_IMAGE_LINE_MARKER) || line.includes(SIXEL_IMAGE_LINE_MARKER);
}

function fitLineToWidth(line: string, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  if (isInlineImageLine(line)) {
    return line;
  }

  if (visibleWidth(line) <= safeWidth) {
    return line;
  }

  return truncateToWidth(line, safeWidth, "", true);
}

function fitLinesToWidth(lines: readonly string[], width: number): string[] {
  return lines.map((line) => fitLineToWidth(line, width));
}

function renderPreviewLines(items: readonly ImagePreviewItem[], width: number): string[] {
  if (items.length === 0) {
    return [];
  }

  const lines: string[] = ["", "↳ pasted image preview"];

  for (const item of items) {
    lines.push("");

    if (item.protocol === "sixel" && item.sixelSequence) {
      lines.push(...buildSixelLines(item.sixelSequence, item.rows));
    } else {
      lines.push(...buildNativeLines(item, width));
    }

    if (item.warning) {
      lines.push(...item.warning.split(/\r?\n/).filter((line) => line.length > 0));
    }
  }

  return fitLinesToWidth(lines, width);
}

function toUserMessage(value: unknown): UserMessageLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as UserMessageLike;
}

function toImageContent(value: unknown): UserImageContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== "image") {
    return null;
  }

  if (typeof record.data !== "string" || record.data.length === 0) {
    return null;
  }

  return {
    type: "image",
    data: record.data,
    mimeType: typeof record.mimeType === "string" && record.mimeType.length > 0
      ? record.mimeType
      : "image/png",
  };
}

function extractImagePayloads(message: unknown): ImagePayload[] {
  const userMessage = toUserMessage(message);
  if (userMessage.role !== "user") {
    return [];
  }

  if (!Array.isArray(userMessage.content)) {
    return [];
  }

  const payloads: ImagePayload[] = [];
  for (const part of userMessage.content) {
    const image = toImageContent(part);
    if (!image) {
      continue;
    }

    payloads.push({
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
    });
  }

  return payloads;
}

function patchUserMessageRender(): void {
  const prototype = (UserMessageComponent as unknown as { prototype: UserMessagePrototype }).prototype;
  if (typeof prototype.render !== "function") {
    return;
  }

  if (!prototype.__piImageToolsInlineOriginalRender) {
    prototype.__piImageToolsInlineOriginalRender = prototype.render;
  }

  if (prototype.__piImageToolsInlinePatched) {
    return;
  }

  prototype.render = function renderWithInlineImagePreview(width: number): string[] {
    const originalRender = prototype.__piImageToolsInlineOriginalRender;
    if (!originalRender) {
      return [];
    }

    const instance = this as unknown as UserMessageInstance;
    if (!instance.__piImageToolsInlineAssigned) {
      instance.__piImageToolsInlineAssigned = true;
      if (!Array.isArray(instance.__piImageToolsInlineItems)) {
        instance.__piImageToolsInlineItems = [];
      }
    }

    const baseLines = originalRender.call(this, width);
    const previewLines = renderPreviewLines(instance.__piImageToolsInlineItems ?? [], width);
    if (previewLines.length === 0) {
      return baseLines;
    }

    return [...baseLines, ...previewLines];
  };

  prototype.__piImageToolsInlinePatched = true;
}

function assignPreviewItemsToLatestUserMessage(
  mode: InteractiveModeLike,
  fromChildIndex: number,
  previewItems: ImagePreviewItem[],
): void {
  const children = mode.chatContainer?.children;
  if (!Array.isArray(children) || children.length === 0) {
    return;
  }

  const start = Math.max(0, fromChildIndex);
  for (let index = children.length - 1; index >= start; index -= 1) {
    const child = children[index];
    if (!(child instanceof UserMessageComponent)) {
      continue;
    }

    const instance = child as unknown as UserMessageInstance;
    instance.__piImageToolsInlineItems = previewItems;
    instance.__piImageToolsInlineAssigned = true;
    return;
  }
}

function patchInteractiveMode(): void {
  const prototype = (InteractiveMode as unknown as { prototype: InteractiveModePrototype }).prototype;
  if (!prototype) {
    return;
  }

  if (!prototype.__piImageToolsOriginalAddMessageToChat) {
    prototype.__piImageToolsOriginalAddMessageToChat = prototype.addMessageToChat;
  }

  if (prototype.__piImageToolsPreviewPatched) {
    return;
  }

  prototype.addMessageToChat = function addMessageToChatWithImagePreview(message: unknown, options?: unknown): void {
    const mode = this as unknown as InteractiveModeLike;
    const beforeCount = Array.isArray(mode.chatContainer?.children)
      ? mode.chatContainer?.children.length ?? 0
      : 0;

    const imagePayloads = extractImagePayloads(message);
    let previewItems: ImagePreviewItem[] = [];
    if (imagePayloads.length > 0) {
      try {
        previewItems = buildPreviewItems(imagePayloads);
      } catch {
        previewItems = [];
      }
    }

    const original = prototype.__piImageToolsOriginalAddMessageToChat;
    if (!original) {
      return;
    }

    original.call(this, message, options);

    if (previewItems.length === 0) {
      return;
    }

    assignPreviewItemsToLatestUserMessage(mode, beforeCount, previewItems);
  };

  prototype.__piImageToolsPreviewPatched = true;
}

function registerInlineUserImagePreview(pi: ExtensionAPI): void {
  const applyPatchNow = (): void => {
    patchInteractiveMode();
    patchUserMessageRender();
  };

  const schedulePatch = (): void => {
    applyPatchNow();

    setTimeout(() => {
      applyPatchNow();
    }, 0);

    setTimeout(() => {
      applyPatchNow();
    }, 25);

    setTimeout(() => {
      applyPatchNow();
    }, 100);
  };

  schedulePatch();

  pi.on("session_start", async () => {
    schedulePatch();
  });

  pi.on("before_agent_start", async () => {
    schedulePatch();
  });

  pi.on("session_switch", async () => {
    schedulePatch();
  });
}

function mimeTypeFromPath(filePath: string): string | null {
  const extension = extname(filePath).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return null;
  }
}

function extractImagePathsFromText(text: string): string[] {
  const matches = text.match(/[A-Za-z]:\\[^\r\n"'<>|?*]+\.(?:png|jpe?g|webp|gif|bmp|tiff?)/gi) ?? [];
  const unique = new Set<string>();
  for (const raw of matches) {
    const candidate = raw.trim();
    if (candidate) {
      unique.add(candidate);
    }
  }
  return [...unique];
}

function imagePayloadFromFilePath(filePath: string): ImagePayload | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const mimeType = mimeTypeFromPath(filePath);
    if (!mimeType) {
      return null;
    }

    const bytes = readFileSync(filePath);
    if (bytes.length === 0) {
      return null;
    }

    return {
      type: "image",
      mimeType,
      data: bytes.toString("base64"),
    };
  } catch {
    return null;
  }
}

export default function imagePreviewExtension(pi: ExtensionAPI): void {
  let warnedSixelSetup = false;

  pi.on("session_start", async (_event, ctx) => {
    if (!shouldAttemptSixelRendering()) {
      return;
    }

    const availability = ensureSixelModuleAvailable();
    if (!availability.available && !warnedSixelSetup && ctx.hasUI) {
      warnedSixelSetup = true;
      ctx.ui.notify(
        `Image preview fallback active: ${availability.reason || "Sixel module unavailable."}`,
        "warning",
      );
    }
  });
  registerInlineUserImagePreview(pi);

  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return { action: "continue" as const };
    }

    const inputImages = Array.isArray(event.images) ? event.images : [];
    const attachedImages: ImagePayload[] = inputImages.filter(
      (image): image is ImagePayload =>
        image?.type === "image" &&
        typeof image.data === "string" &&
        image.data.length > 0 &&
        typeof image.mimeType === "string" &&
        image.mimeType.length > 0,
    );

    const textPaths = typeof event.text === "string" ? extractImagePathsFromText(event.text) : [];
    const pathImages = textPaths
      .map((filePath) => imagePayloadFromFilePath(filePath))
      .filter((image): image is ImagePayload => image !== null);

    if (pathImages.length > 0) {
      return {
        action: "transform" as const,
        text: event.text,
        images: [...attachedImages, ...pathImages],
      };
    }

    return { action: "continue" as const };
  });
}
