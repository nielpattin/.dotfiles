import type { Message } from "@mariozechner/pi-ai";
import type { SingleResult } from "../types.js";

export function parseStreamEvent(line: string, result: SingleResult): boolean {
  if (!line.trim()) return false;

  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }

  const now = Date.now();
  result.updatedAt = now;

  if (event.type === "session") {
    if (typeof event.id === "string" && !result.sessionId) result.sessionId = event.id;
    if (typeof event.name === "string" && event.name.trim()) {
      result.sessionName = event.name.trim();
    }
    return true;
  }

  if (event.type === "tool_execution_start") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    const toolName = typeof event.toolName === "string" ? event.toolName : null;
    const toolArgs =
      typeof event.args === "object" && event.args !== null
        ? (event.args as Record<string, unknown>)
        : {};

    if (toolName) {
      result.activeTool = {
        toolCallId,
        name: toolName,
        args: toolArgs,
        startedAt: now,
      };

      const alreadySeen = result.messages.some((msg: any) => {
        if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) {
          return false;
        }
        return msg.content.some((part: any) => {
          if (!part || part.type !== "toolCall") return false;
          if (toolCallId && typeof part.id === "string") {
            return part.id === toolCallId;
          }
          return part.name === toolName;
        });
      });

      if (!alreadySeen) {
        const syntheticToolCall = {
          type: "toolCall",
          ...(toolCallId ? { id: toolCallId } : {}),
          name: toolName,
          arguments: toolArgs,
        };

        result.messages.push({
          role: "assistant",
          content: [syntheticToolCall],
          timestamp: now,
        } as unknown as Message);
      }
      return true;
    }
  }

  if (event.type === "tool_execution_end") {
    const toolCallId =
      typeof event.toolCallId === "string" ? event.toolCallId : undefined;
    const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
    const activeTool = result.activeTool;

    if (activeTool) {
      const sameCall = toolCallId && activeTool.toolCallId === toolCallId;
      const sameName = toolName && activeTool.name === toolName;
      if (sameCall || sameName || (!toolCallId && !toolName)) {
        result.lastTool = {
          ...activeTool,
          finishedAt: now,
        };
        result.activeTool = undefined;
        return true;
      }
    }

    if (toolName) {
      result.lastTool = {
        toolCallId,
        name: toolName,
        args:
          typeof event.args === "object" && event.args !== null
            ? (event.args as Record<string, unknown>)
            : {},
        startedAt: now,
        finishedAt: now,
      };
      return true;
    }
  }

  if (event.type === "message_end" && event.message) {
    const msg = event.message as Message;
    result.messages.push(msg);

    if (msg.role === "assistant") {
      result.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        result.usage.input += usage.input || 0;
        result.usage.output += usage.output || 0;
        result.usage.cacheRead += usage.cacheRead || 0;
        result.usage.cacheWrite += usage.cacheWrite || 0;
        result.usage.cost += usage.cost?.total || 0;
        result.usage.contextTokens = usage.totalTokens || 0;
      }
      if (!result.model && msg.model) result.model = msg.model;
      if (!result.provider && typeof (msg as any).provider === "string") {
        result.provider = (msg as any).provider;
      }
      if (msg.stopReason) result.stopReason = msg.stopReason;
      if (msg.errorMessage) result.errorMessage = msg.errorMessage;
    }
    return true;
  }

  if (event.type === "tool_result_end" && event.message) {
    result.messages.push(event.message as Message);
    return true;
  }

  return false;
}
