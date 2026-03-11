/**
 * Tokens Per Second Extension - displays tokens/second in the footer.
 *
 * Automatically enabled on startup. Shows cumulative average tok/s
 * based on completed messages.
 *
 * The footer displays:
 * - ↑{input tokens} ↓{output tokens} ${total cost} | {tps} tok/s {time} | {model}
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let totalOutputTokens = 0;
  let totalStreamingTime = 0;
  let ttft = 0;

  const reset = (ctx: ExtensionContext) => {
    totalOutputTokens = 0;
    totalStreamingTime = 0;
    ttft = 0;
    update(ctx);
  }

  const update = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const theme = ctx.ui.theme;

    ctx.ui.setStatus("tps", theme.fg("accent", `${getAverageTps()} tok/s`));
    ctx.ui.setStatus("streaming-time", theme.fg("accent", `${totalStreamingTime.toFixed(2)}s`));
  }

  const getAverageTps = (): string => {
    if (totalStreamingTime > 0 && totalOutputTokens > 0) {
      return (totalOutputTokens / totalStreamingTime).toFixed(2);
    }
    return "--";
  };

  pi.on("session_start", async (_event, ctx) => {
    reset(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    reset(ctx);
  });

  pi.on("message_start", async (_event, ctx) => {
    ttft = 0;
  })

  pi.on("message_update", async (event, ctx) => {
    if (ttft === 0) {
      ttft = new Date().getTime() - event.message.timestamp;
    }
  });

  pi.on("message_end", async (event, ctx) => {
    const msg = event.message as any;
    const outputTokens = msg.usage?.output || 0;

    if (!outputTokens) return;

    const endTime = new Date().getTime();
    const elapsed = (endTime - event.message.timestamp - ttft) / 1000;

    if (elapsed > 0 && outputTokens > 0) {
      totalOutputTokens += outputTokens;
      totalStreamingTime += elapsed;
    }

    update(ctx);
  });
}