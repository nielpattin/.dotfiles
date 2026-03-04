import { complete, type Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

const skillPattern = /^\/skill:(\S+)\s*([\s\S]*)/;

const SUMMARY_PROMPT = `You are a session title generator.
Output ONLY a single session title, nothing else.

Rules:
- Use the same language as the user input.
- Keep it concise and natural.
- Prefer 3-8 words (hard max 10 words).
- Focus on the main intent/task.
- Preserve important technical terms, filenames, error codes, numbers.
- Never include tool names (read, bash, edit, etc).
- Never include quotes.
- No trailing punctuation.
- If input is casual/short (e.g. "hi", "hello"), output a meaningful short title like "Greeting" or "Quick check-in".
- Always output something meaningful.`;

const PREFERRED_MODEL_BY_PROVIDER: Record<string, string> = {
  "openai-codex": "gpt-5.1-codex-mini",
  "google-gemini-cli": "gemini-2.5-flash",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTitleInput(rawText: string): { prefix: string; userPrompt: string } | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  const skillMatch = text.match(skillPattern);
  if (skillMatch) {
    const skillName = skillMatch[1] ?? "skill";
    return {
      prefix: `[${skillName}] `,
      userPrompt: (skillMatch[2] ?? "").trim(),
    };
  }

  if (text.startsWith("/")) {
    return null;
  }

  return {
    prefix: "",
    userPrompt: text,
  };
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!isObject(part)) {
        return "";
      }

      if (typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .filter((text) => text.trim().length > 0)
    .join("\n")
    .trim();
}

function getFirstUserMessageText(ctx: ExtensionCommandContext): string | null {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (!isObject(entry) || entry.type !== "message") {
      continue;
    }

    const message = entry.message;
    if (!isObject(message) || message.role !== "user") {
      continue;
    }

    const text = extractMessageText(message.content);
    if (text) {
      return text;
    }
  }

  return null;
}

function sanitizeTitle(rawSummary: string): string | null {
  const summary = rawSummary
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/[.!?]+$/g, "")
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
    .trim();

  if (!summary) {
    return null;
  }

  return summary.length > 100 ? `${summary.slice(0, 97).trimEnd()}...` : summary;
}

async function tryProviderModel(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
): Promise<{ model: Model<any>; apiKey: string } | null> {
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    return null;
  }

  const apiKey = await ctx.modelRegistry.getApiKey(model);
  if (!apiKey) {
    return null;
  }

  return { model, apiKey };
}

async function pickCheapModel(ctx: ExtensionContext): Promise<{ model: Model<any>; apiKey: string } | null> {
  if (!ctx.model) {
    return null;
  }

  const provider = ctx.model.provider;
  const preferredModelId = PREFERRED_MODEL_BY_PROVIDER[provider];

  if (preferredModelId) {
    const preferred = await tryProviderModel(ctx, provider, preferredModelId);
    if (preferred) {
      return preferred;
    }
  }

  // Fallback: current model.
  const currentApiKey = await ctx.modelRegistry.getApiKey(ctx.model);
  if (currentApiKey) {
    return { model: ctx.model, apiKey: currentApiKey };
  }

  return null;
}

async function generateTitle(ctx: ExtensionContext, userPrompt: string): Promise<string | null> {
  const cheap = await pickCheapModel(ctx);
  if (!cheap) {
    return null;
  }

  const response = await complete(
    cheap.model,
    {
      systemPrompt: SUMMARY_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: userPrompt }], timestamp: Date.now() }],
    },
    { apiKey: cheap.apiKey },
  );

  const rawSummary = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  return sanitizeTitle(rawSummary);
}

async function autoNameSession(input: {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  prefix: string;
  userPrompt: string;
}): Promise<{ fallback: string; title: string | null }> {
  const fallback = `${input.prefix}${input.userPrompt.slice(0, 60)}`.trim();
  if (fallback) {
    input.pi.setSessionName(fallback);
  }

  try {
    const summary = await generateTitle(input.ctx, input.userPrompt);
    if (!summary) {
      return { fallback, title: null };
    }

    const title = `${input.prefix}${summary}`.trim();
    input.pi.setSessionName(title);
    return { fallback, title };
  } catch {
    // Keep fallback title if model call fails.
    return { fallback, title: null };
  }
}

export default function (pi: ExtensionAPI) {
  let named = false;

  const syncNamedState = () => {
    named = !!pi.getSessionName();
  };

  pi.on("session_start", syncNamedState);
  pi.on("session_switch", syncNamedState);

  pi.registerCommand("autoname-sessions", {
    description: "Auto-name from first user message or provided text",
    handler: async (args, ctx) => {
      const source = args.trim() || getFirstUserMessageText(ctx) || "";
      const parsed = parseTitleInput(source);

      if (!parsed) {
        ctx.ui.notify("No suitable user message found. Usage: /autoname-sessions [text]", "warning");
        return;
      }

      if (!parsed.userPrompt) {
        const title = parsed.prefix.trim();
        pi.setSessionName(title);
        named = true;
        ctx.ui.notify(`Session named: ${title}`, "info");
        return;
      }

      const result = await autoNameSession({
        pi,
        ctx,
        prefix: parsed.prefix,
        userPrompt: parsed.userPrompt,
      });

      named = true;

      if (result.title) {
        ctx.ui.notify(`Session named: ${result.title}`, "info");
        return;
      }

      if (result.fallback) {
        ctx.ui.notify(`Session named (fallback): ${result.fallback}`, "warning");
        return;
      }

      ctx.ui.notify("Could not generate a session name.", "warning");
    },
  });

  pi.on("input", (event, ctx) => {
    if (named) return;

    const parsed = parseTitleInput(event.text);
    if (!parsed) {
      return;
    }

    if (!parsed.userPrompt) {
      named = true;
      pi.setSessionName(parsed.prefix.trim());
      return;
    }

    named = true;

    // Fire-and-forget summarization so prompt handling is never blocked.
    void autoNameSession({
      pi,
      ctx,
      prefix: parsed.prefix,
      userPrompt: parsed.userPrompt,
    });
  });
}
