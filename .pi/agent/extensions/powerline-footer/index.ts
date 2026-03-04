import type { ExtensionAPI, ReadonlyFooterDataProvider, Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorTheme } from "@mariozechner/pi-tui";

import type { ColorScheme, SegmentContext, StatusLinePreset, StatusLineSegmentId } from "./types.js";
import { getPreset, PRESETS } from "./presets.js";
import { getSeparator } from "./separators.js";
import { renderSegment } from "./segments.js";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./vcs-status.js";
import { getDefaultColors } from "./theme.js";

interface PowerlineConfig {
  preset: StatusLinePreset;
}

let config: PowerlineConfig = {
  preset: "default",
};

function renderSegmentWithWidth(
  segId: StatusLineSegmentId,
  ctx: SegmentContext,
): { content: string; width: number; visible: boolean } {
  const rendered = renderSegment(segId, ctx);
  if (!rendered.visible || !rendered.content) {
    return { content: "", width: 0, visible: false };
  }
  return { content: rendered.content, width: visibleWidth(rendered.content), visible: true };
}

function joinParts(parts: string[], sep: string): string {
  return parts.length > 0 ? parts.join(` ${sep} `) : "";
}

function buildContentFromParts(
  parts: string[],
  presetDef: ReturnType<typeof getPreset>,
): string {
  if (parts.length === 0) return "";
  const separatorDef = getSeparator(presetDef.separator);
  return ` ${joinParts(parts, separatorDef.left)} `;
}

function groupWidth(parts: { width: number }[], sepWidth: number): number {
  if (parts.length === 0) return 0;
  const partsWidth = parts.reduce((sum, p) => sum + p.width, 0);
  return partsWidth + sepWidth * (parts.length - 1);
}

function computeResponsiveLayout(
  ctx: SegmentContext,
  presetDef: ReturnType<typeof getPreset>,
  availableWidth: number,
): { topContent: string; secondaryContent: string } {
  const separatorDef = getSeparator(presetDef.separator);
  const leftSepWidth = visibleWidth(separatorDef.left) + 2;

  const leftRendered = presetDef.leftSegments
    .map((segId) => ({ ...renderSegmentWithWidth(segId, ctx), segId }))
    .filter((seg) => seg.visible);
  const rightRendered = presetDef.rightSegments
    .map((segId) => ({ ...renderSegmentWithWidth(segId, ctx), segId }))
    .filter((seg) => seg.visible);
  const secondaryRendered = (presetDef.secondarySegments ?? [])
    .map((segId) => ({ ...renderSegmentWithWidth(segId, ctx), segId }))
    .filter((seg) => seg.visible);

  const leftTop = [...leftRendered];
  const rightTop = [...rightRendered];
  const topInnerWidth = Math.max(0, availableWidth - 2);

  const getTopWidth = () => {
    const leftWidth = groupWidth(leftTop, leftSepWidth);
    const rightWidth = groupWidth(rightTop, leftSepWidth);
    const betweenGroups = leftTop.length > 0 && rightTop.length > 0 ? 1 : 0;
    return leftWidth + rightWidth + betweenGroups;
  };

  while (getTopWidth() > topInnerWidth) {
    if (leftTop.length > 0) {
      leftTop.pop();
      continue;
    }
    if (rightTop.length > 0) {
      rightTop.shift();
      continue;
    }
    break;
  }

  const includedSegIds = new Set<StatusLineSegmentId>([
    ...leftTop.map((seg) => seg.segId),
    ...rightTop.map((seg) => seg.segId),
  ]);

  const overflowPrimary = [...leftRendered, ...rightRendered].filter(
    (seg) => !includedSegIds.has(seg.segId),
  );

  const leftStr = joinParts(
    leftTop.map((seg) => seg.content),
    separatorDef.left,
  );
  const rightStr = joinParts(
    rightTop.map((seg) => seg.content),
    separatorDef.right,
  );

  let topContent = "";
  if (leftStr || rightStr) {
    const leftWidth = visibleWidth(leftStr);
    const rightWidth = visibleWidth(rightStr);
    const betweenGroups = leftStr && rightStr ? 1 : 0;
    const paddingWidth = Math.max(0, topInnerWidth - leftWidth - rightWidth - betweenGroups);

    if (leftStr && rightStr) {
      topContent = ` ${leftStr}${" ".repeat(paddingWidth + 1)}${rightStr} `;
    } else if (leftStr) {
      topContent = ` ${leftStr} `;
    } else {
      topContent = ` ${rightStr} `;
    }
  }

  const secondaryCandidates = [...overflowPrimary, ...secondaryRendered];
  const secondarySegments: string[] = [];
  let secondaryWidth = 2;

  for (const seg of secondaryCandidates) {
    const neededWidth = seg.width + (secondarySegments.length > 0 ? leftSepWidth : 0);
    if (secondaryWidth + neededWidth <= availableWidth) {
      secondarySegments.push(seg.content);
      secondaryWidth += neededWidth;
    } else {
      break;
    }
  }

  return {
    topContent,
    secondaryContent: buildContentFromParts(secondarySegments, presetDef),
  };
}

export default function powerlineFooter(pi: ExtensionAPI) {
  let enabled = true;
  let sessionStartTime = Date.now();
  let currentCtx: any = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let getThinkingLevelFn: (() => string) | null = null;
  let tuiRef: any = null;

  let lastLayoutWidth = 0;
  let lastLayoutResult: { topContent: string; secondaryContent: string } | null = null;
  let lastLayoutTimestamp = 0;

  pi.on("session_start", async (_event, ctx) => {
    sessionStartTime = Date.now();
    currentCtx = ctx;

    const ctxAny = ctx as any;
    if (typeof ctxAny.getThinkingLevel === "function") {
      getThinkingLevelFn = () => ctxAny.getThinkingLevel();
    }

    if (enabled && ctx.hasUI) {
      setupCustomEditor(ctx);
    }
  });

  const mightChangeGitBranch = (cmd: string): boolean => {
    const gitBranchPatterns = [
      /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
      /\bgit\s+stash\s+(pop|apply)/,
    ];
    return gitBranchPatterns.some((p) => p.test(cmd));
  };

  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }

    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (mightChangeGitBranch(cmd)) {
        invalidateGitStatus();
        invalidateGitBranch();
        setTimeout(() => tuiRef?.requestRender(), 100);
      }
    }
  });

  pi.on("user_bash", async (event, _ctx) => {
    if (mightChangeGitBranch(event.command)) {
      invalidateGitStatus();
      invalidateGitBranch();
      setTimeout(() => tuiRef?.requestRender(), 100);
      setTimeout(() => tuiRef?.requestRender(), 300);
      setTimeout(() => tuiRef?.requestRender(), 500);
    }
  });

  pi.registerCommand("powerline", {
    description: "Configure powerline status (toggle, preset)",
    handler: async (args, ctx) => {
      currentCtx = ctx;

      if (!args || !args.trim()) {
        enabled = !enabled;
        if (enabled) {
          setupCustomEditor(ctx);
          ctx.ui.notify("Powerline enabled", "info");
        } else {
          ctx.ui.setEditorComponent(undefined);
          ctx.ui.setFooter(undefined);
          ctx.ui.setWidget("powerline-secondary", undefined);
          ctx.ui.setWidget("powerline-status", undefined);
          footerDataRef = null;
          tuiRef = null;
          lastLayoutResult = null;
          ctx.ui.notify("Powerline disabled", "info");
        }
        return;
      }

      const sub = args.trim().toLowerCase();
      if (sub === "on") {
        enabled = true;
        setupCustomEditor(ctx);
        ctx.ui.notify("Powerline enabled", "info");
        return;
      }
      if (sub === "off") {
        enabled = false;
        ctx.ui.setEditorComponent(undefined);
        ctx.ui.setFooter(undefined);
        ctx.ui.setWidget("powerline-secondary", undefined);
        ctx.ui.setWidget("powerline-status", undefined);
        lastLayoutResult = null;
        ctx.ui.notify("Powerline disabled", "info");
        return;
      }

      const preset = sub as StatusLinePreset;
      if (preset in PRESETS) {
        config.preset = preset;
        lastLayoutResult = null;
        if (enabled) setupCustomEditor(ctx);
        ctx.ui.notify(`Preset set to: ${preset}`, "info");
        return;
      }

      const presetList = Object.keys(PRESETS).join(", ");
      ctx.ui.notify(`Available presets: ${presetList}`, "info");
    },
  });

  function buildSegmentContext(ctx: any, theme: Theme): SegmentContext {
    const presetDef = getPreset(config.preset);
    const colors: ColorScheme = presetDef.colors ?? getDefaultColors();

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    let lastAssistant: any = undefined;
    let thinkingLevelFromSession = "off";

    const sessionEvents = ctx.sessionManager?.getBranch?.() ?? [];
    for (const e of sessionEvents) {
      if (e.type === "thinking_level_change" && e.thinkingLevel) {
        thinkingLevelFromSession = e.thinkingLevel;
      }

      if (e.type === "message" && e.message.role === "assistant") {
        const m = e.message;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          continue;
        }

        const usage = m.usage;
        if (!usage) continue;

        input += usage.input ?? 0;
        output += usage.output ?? 0;
        cacheRead += usage.cacheRead ?? 0;
        cacheWrite += usage.cacheWrite ?? 0;
        cost += usage.cost?.total ?? 0;
        lastAssistant = m;
      }
    }

    const contextTokens = lastAssistant?.usage
      ? (lastAssistant.usage.input ?? 0)
        + (lastAssistant.usage.output ?? 0)
        + (lastAssistant.usage.cacheRead ?? 0)
        + (lastAssistant.usage.cacheWrite ?? 0)
      : 0;

    const contextWindow = ctx.model?.contextWindow || 0;
    const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const git = getGitStatus(gitBranch);

    const usingSubscription = ctx.model
      ? (ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false)
      : false;

    return {
      model: ctx.model,
      thinkingLevel: thinkingLevelFromSession || getThinkingLevelFn?.() || "off",
      sessionId: ctx.sessionManager?.getSessionId?.(),
      sessionName: ctx.sessionManager?.getSessionName?.(),
      usageStats: { input, output, cacheRead, cacheWrite, cost },
      contextPercent,
      contextUsed: contextTokens,
      contextWindow,
      autoCompactEnabled: ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? false,
      usingSubscription,
      sessionStartTime,
      git,
      extensionStatuses: footerDataRef?.getExtensionStatuses() ?? new Map(),
      options: presetDef.segmentOptions ?? {},
      theme,
      colors,
    };
  }

  function getResponsiveLayout(width: number, theme: Theme): { topContent: string; secondaryContent: string } {
    const now = Date.now();
    if (lastLayoutResult && lastLayoutWidth === width && now - lastLayoutTimestamp < 50) {
      return lastLayoutResult;
    }

    const presetDef = getPreset(config.preset);
    const segmentCtx = buildSegmentContext(currentCtx, theme);

    lastLayoutWidth = width;
    lastLayoutResult = computeResponsiveLayout(segmentCtx, presetDef, width);
    lastLayoutTimestamp = now;

    return lastLayoutResult;
  }

  function setupCustomEditor(ctx: any) {
    import("@mariozechner/pi-coding-agent").then(({ CustomEditor }) => {
      let currentEditor: any = null;
      let autocompleteFixed = false;

      const editorFactory = (tui: any, editorTheme: EditorTheme, keybindings: any) => {
        const editor = new CustomEditor(tui, editorTheme, keybindings);
        currentEditor = editor;

        const originalHandleInput = editor.handleInput.bind(editor);
        editor.handleInput = (data: string) => {
          if (!autocompleteFixed && !(editor as any).autocompleteProvider) {
            autocompleteFixed = true;
            ctx.ui.setEditorComponent(editorFactory);
            currentEditor?.handleInput(data);
            return;
          }
          originalHandleInput(data);
        };

        const originalRender = editor.render.bind(editor);
        editor.render = (width: number): string[] => {
          if (width < 10) {
            return originalRender(width);
          }

          const border = (s: string) => ctx.ui.theme.fg("borderAccent", s);
          const prompt = "\x1b[38;2;200;200;200m>\x1b[0m";

          const promptPrefix = ` ${prompt} `;
          const contPrefix = "   ";
          const contentWidth = Math.max(1, width - 5);
          const lines = originalRender(contentWidth);

          if (lines.length === 0 || !currentCtx) return lines;

          let bottomBorderIndex = lines.length - 1;
          for (let i = lines.length - 1; i >= 1; i--) {
            const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
            if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
              bottomBorderIndex = i;
              break;
            }
          }

          const result: string[] = [];
          const layout = getResponsiveLayout(width, ctx.ui.theme);
          result.push(layout.topContent);

          const sessionNameRaw = currentCtx.sessionManager?.getSessionName?.();
          const sessionName = typeof sessionNameRaw === "string" ? sessionNameRaw.trim() : "";

          const makeBodyRow = (inner: string) => {
            const innerWidth = Math.max(1, width - 2);
            const clipped = truncateToWidth(inner, innerWidth, "");
            const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
            return border("│") + clipped + pad + border("│");
          };

          let headerLabel = "";
          if (sessionName) {
            const maxSessionWidth = Math.max(0, width - 4);
            if (maxSessionWidth > 0) {
              const sessionText = truncateToWidth(sessionName, maxSessionWidth, "…");
              headerLabel = ` ${ctx.ui.theme.fg("dim", sessionText)} `;
            }
          }
          const topFill = Math.max(1, width - 2 - visibleWidth(headerLabel));
          result.push(border("┌") + headerLabel + border("─".repeat(topFill) + "┐"));

          for (let i = 1; i < bottomBorderIndex; i++) {
            const prefix = i === 1 ? promptPrefix : contPrefix;
            result.push(makeBodyRow(`${prefix}${lines[i] || ""}`));
          }

          if (bottomBorderIndex === 1) {
            result.push(makeBodyRow(`${promptPrefix}${" ".repeat(contentWidth)}`));
          }

          result.push(border("└" + "─".repeat(Math.max(1, width - 2)) + "┘"));

          for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
            result.push(lines[i] || "");
          }

          return result;
        };

        return editor;
      };

      ctx.ui.setEditorComponent(editorFactory);

      ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
        footerDataRef = footerData;
        tuiRef = tui;
        const unsub = footerData.onBranchChange(() => tui.requestRender());

        return {
          dispose: unsub,
          invalidate() {},
          render(): string[] {
            return [];
          },
        };
      });

      ctx.ui.setWidget(
        "powerline-secondary",
        (_tui: any, theme: Theme) => ({
          dispose() {},
          invalidate() {},
          render(width: number): string[] {
            if (!currentCtx) return [];
            const layout = getResponsiveLayout(width, theme);
            return layout.secondaryContent ? [layout.secondaryContent] : [];
          },
        }),
        { placement: "belowEditor" },
      );

      ctx.ui.setWidget(
        "powerline-status",
        () => ({
          dispose() {},
          invalidate() {},
          render(width: number): string[] {
            if (!currentCtx || !footerDataRef) return [];

            const statuses = footerDataRef.getExtensionStatuses();
            if (!statuses || statuses.size === 0) return [];

            const notifications: string[] = [];
            for (const value of statuses.values()) {
              if (value && value.trimStart().startsWith("[")) {
                const lineContent = ` ${value}`;
                if (visibleWidth(lineContent) <= width) {
                  notifications.push(lineContent);
                }
              }
            }
            return notifications;
          },
        }),
        { placement: "aboveEditor" },
      );
    });
  }
}
