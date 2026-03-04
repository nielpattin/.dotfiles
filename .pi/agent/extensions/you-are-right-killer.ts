/**
 * Subtle Reminders Extension
 *
 * Detects when the model uses reflexive agreement phrases like:
 * - "You are right"
 * - "You're right"
 * - "You are absolutely right"
 * - Similar variations
 *
 * When detected during streaming, immediately aborts and sends a reminder.
 * Only reminds once per 10 messages to avoid spam.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { appendFile, writeFile } from "node:fs/promises";

const LOG_FILE = "/tmp/subtle.log";
const ENABLE_DEBUG = false;

function log(message: string) {
  if (!ENABLE_DEBUG) return;
  const timestamp = new Date().toISOString();
  appendFile(LOG_FILE, `[${timestamp}] ${message}\n`).catch(() => {});
}

// Phrases that trigger the reminder (case-insensitive)
const REFLEXIVE_PHRASES = [
  /\byou are right\b/i,
  /\byou're right\b/i,
  /\byou're correct\b/i,
  /\byou are correct\b/i,
  /\byou're absolutely right\b/i,
  /\byou are absolutely right\b/i,
  /\bthat's right\b/i,
  /\bthats right\b/i,
  /\byou got it right\b/i,
  /\byou've got it right\b/i,
];

const REMINDER_MESSAGE = `STOP USING REFLEXIVE AGREEMENT PHRASES. STOP SAYING "YOU ARE RIGHT" to the user or similar.

Avoid reflexive agreement phrases like "you are right" or "absolutely correct."

Instead, engage thoughtfully: analyze the user's reasoning, identify potential improvements, 
or provide substantive confirmation when their approach is sound.

When the user presents a valid solution:

- Acknowledge the correctness with specific technical reasoning
- Consider edge cases, alternative approaches, or potential optimizations
- Build collaboratively rather than merely agreeing

When the user's approach has issues:
- Identify specific problems or gaps
- Suggest concrete improvements
- Explain the technical reasoning behind your analysis
`;

// Custom message type for tracking reminders
const REMINDER_CUSTOM_TYPE = "stop-reflexive-reminders";

// Track streaming state
let currentMessageBuffer = "";
let lastReminderIndex = -1;
let alreadyInterrupted = false;

function hasReflexivePhrase(text: string): boolean {
  return REFLEXIVE_PHRASES.some((pattern) => pattern.test(text));
}

export default function subtleRemindersExtension(pi: ExtensionAPI) {
  // Clear log file on startup
  if (ENABLE_DEBUG) {
    writeFile(LOG_FILE, "=== Subtle Reminders Extension Started ===\n").catch(
      () => {}
    );
  }

  // Listen to streaming updates for real-time detection
  pi.on("message_update", async (event, ctx) => {
    const message = event.message as AgentMessage & { customType?: string };

    log(
      `[message_update] role=${message.role}, customType=${message.customType}, eventType=${event.assistantMessageEvent.type}`
    );

    // Only process assistant messages (not reminders we injected)
    if (
      message.role !== "assistant" ||
      message.customType === REMINDER_CUSTOM_TYPE
    ) {
      log(
        `[message_update] SKIPPING - not an assistant message or is a reminder`
      );
      return;
    }

    // Accumulate streaming text
    if (event.assistantMessageEvent.type === "text_delta") {
      const delta = event.assistantMessageEvent.delta;
      currentMessageBuffer += delta;
      log(
        `[message_update] text_delta: "${delta}" | buffer now: "${currentMessageBuffer}"`
      );

      // Check for reflexive phrases in real-time
      if (hasReflexivePhrase(currentMessageBuffer)) {
        log(
          `[TRIGGER] Matched reflexive phrase in buffer: "${currentMessageBuffer}"`
        );

        // Reset buffer to avoid re-triggering
        currentMessageBuffer = "";

        // Abort first to stop the bad response
        ctx.abort();

        log(`[TRIGGER] Aborted streaming`);

        // Send interruption as hidden custom message
        const interruptionMessage = `I interrupted your response because you were about to use a reflexive agreement phrase ("you are right", etc.).

${REMINDER_MESSAGE}

Please provide a new response following these guidelines.`;

        // Use setTimeout to ensure abort completes before sending message
        setTimeout(() => {
          pi.sendMessage(
            {
              customType: REMINDER_CUSTOM_TYPE,
              content: interruptionMessage,
              display: false,
            },
            { triggerTurn: true }
          );
          log(`[TRIGGER] Sent hidden message to trigger new turn`);
        }, 10);
      }
    }
  });

  // Reset buffer on any message start (user, assistant, or toolResult)
  pi.on("message_start", async (event, ctx) => {
    log(`[message_start] role=${event.message.role}`);
    currentMessageBuffer = "";
    log(`[message_start] Reset buffer for new message`);
  });
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text || "")
      .join(" ");
  }
  return "";
}