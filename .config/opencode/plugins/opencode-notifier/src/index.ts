import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { basename } from "path"
import { loadConfig, isEventSoundEnabled, isEventNotificationEnabled, getMessage, getSoundPath } from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { runCommand } from "./command"

function getNotificationTitle(config: NotifierConfig, projectName: string | null): string {
  if (config.showProjectName && projectName) {
    return `OpenCode (${projectName})`
  }
  return "OpenCode"
}

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  elapsedSeconds?: number | null
): Promise<void> {
  const promises: Promise<void>[] = []

  const message = getMessage(config, eventType)

  if (isEventNotificationEnabled(config, eventType)) {
    const title = getNotificationTitle(config, projectName)
    promises.push(sendNotification(title, message, config.timeout))
  }

  if (isEventSoundEnabled(config, eventType)) {
    // Skip sounds during startup grace period to avoid playing on OpenCode launch
    const isInStartupGracePeriod = Date.now() - PLUGIN_START_TIME < STARTUP_GRACE_PERIOD_MS
    if (!isInStartupGracePeriod) {
      const customSoundPath = getSoundPath(config, eventType)
      promises.push(playSound(eventType, customSoundPath, config.volume))
    }
  }

  const minDuration = config.command?.minDuration
  const shouldSkipCommand =
    typeof minDuration === "number" &&
    Number.isFinite(minDuration) &&
    minDuration > 0 &&
    typeof elapsedSeconds === "number" &&
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds < minDuration

  if (!shouldSkipCommand) {
    runCommand(config, eventType, message)
  }

  await Promise.allSettled(promises)
}

function getSessionIDFromEvent(event: any): string | null {
  const sessionID = event?.properties?.sessionID || event?.properties?.session_id || event?.sessionID || event?.session_id
  if (typeof sessionID === "string" && sessionID.length > 0) {
    return sessionID
  }
  return null
}

async function getElapsedSinceLastPrompt(
  client: PluginInput["client"],
  sessionID: string
): Promise<number | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = response.data ?? []

    let lastUserMessageTime: number | null = null
    for (const msg of messages) {
      const info = msg.info
      if (info.role === "user" && typeof info.time?.created === "number") {
        if (lastUserMessageTime === null || info.time.created > lastUserMessageTime) {
          lastUserMessageTime = info.time.created
        }
      }
    }

    if (lastUserMessageTime !== null) {
      return (Date.now() - lastUserMessageTime) / 1000
    }
  } catch {
  }

  return null
}

async function isChildSession(
  client: PluginInput["client"],
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.get({ path: { id: sessionID } })
    const parentID = response.data?.parentID
    return !!parentID
  } catch {
    return false
  }
}

async function handleEventWithElapsedTime(
  client: PluginInput["client"],
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  event: unknown
): Promise<void> {
  const minDuration = config.command?.minDuration
  const shouldLookupElapsed =
    !!config.command?.enabled &&
    typeof config.command?.path === "string" &&
    config.command.path.length > 0 &&
    typeof minDuration === "number" &&
    Number.isFinite(minDuration) &&
    minDuration > 0

  let elapsedSeconds: number | null = null
  if (shouldLookupElapsed) {
    const sessionID = getSessionIDFromEvent(event)
    if (sessionID) {
      elapsedSeconds = await getElapsedSinceLastPrompt(client, sessionID)
    }
  }

  await handleEvent(config, eventType, projectName, elapsedSeconds)
}

// Global state to track cancellations and suppress overlapping notifications
const lastSessionErrorTime: Record<string, number> = {}
const cancelledSessions: Record<string, boolean> = {}

// Startup grace period - suppress sounds for first 3 seconds after plugin loads
const PLUGIN_START_TIME = Date.now()
const STARTUP_GRACE_PERIOD_MS = 3000

export const NotifierPlugin: Plugin = async ({ client, directory }) => {
  const projectName = directory ? basename(directory) : null

  return {
    event: async ({ event }) => {
      const config = loadConfig()
      const type = event.type
      const props = (event as any).properties
      const sessionID = getSessionIDFromEvent(event)

      // CRITICAL: Synchronously flag the session as having an error/cancellation
      if (type === "session.error" && sessionID) {
        lastSessionErrorTime[sessionID] = Date.now()
        
        const error = props?.error
        const errorMessage = (error?.message || "").toLowerCase()
        const errorName = (error?.name || "")
        
        if (errorName === "MessageAbortedError" || 
            errorName === "AbortError" ||
            errorMessage.includes("abort") ||
            errorMessage.includes("cancel") ||
            errorMessage.includes("interrupted")) {
          cancelledSessions[sessionID] = true
        }
      }

      if (type === "permission.updated" || (event as any).type === "permission.asked") {
        await handleEventWithElapsedTime(client, config, "permission", projectName, event)
      }

      if (type === "session.idle") {
        if (sessionID) {
          // Add a small delay to ensure session.error event handler (which is likely running in parallel)
          // has had time to update the shared state.
          await new Promise(resolve => setTimeout(resolve, 300))

          const now = Date.now()
          const lastError = lastSessionErrorTime[sessionID] || 0
          const wasCancelled = cancelledSessions[sessionID]
          
          if (now - lastError < 5000 || wasCancelled) {
            // Suppress the "finished" notification if an error/cancellation just occurred
            delete cancelledSessions[sessionID]
            return
          }

          // Double check the last message to see if it was an error
          try {
            const response = await client.session.messages({ path: { id: sessionID }, query: { limit: 1 } })
            const lastMsg = response.data?.[0]
            if (lastMsg?.info.role === "assistant" && lastMsg.info.error) {
              const err = lastMsg.info.error as any
              const isErrCancel = err.name === "MessageAbortedError" || 
                                 err.name === "AbortError" ||
                                 (err.message || "").toLowerCase().includes("abort") ||
                                 (err.message || "").toLowerCase().includes("cancel")
              if (isErrCancel) return
            }
          } catch {}

          const isChild = await isChildSession(client, sessionID)
          if (!isChild) {
            await handleEventWithElapsedTime(client, config, "complete", projectName, event)
          } else {
            await handleEventWithElapsedTime(client, config, "subagent_complete", projectName, event)
          }
        } else {
          await handleEventWithElapsedTime(client, config, "complete", projectName, event)
        }
      }

      if (type === "session.error") {
        const wasCancelled = sessionID ? cancelledSessions[sessionID] : false
        if (wasCancelled) return // Don't notify for interruptions

        await handleEventWithElapsedTime(client, config, "error", projectName, event)
      }
    },
    "permission.ask": async () => {
      const config = loadConfig()
      await handleEvent(config, "permission", projectName, null)
    },
    "tool.execute.before": async (input) => {
      const config = loadConfig()
      if (input.tool === "question") {
        await handleEvent(config, "question", projectName, null)
      }
    },
  }
}

export default NotifierPlugin
