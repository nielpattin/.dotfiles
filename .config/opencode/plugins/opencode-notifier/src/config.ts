import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export type EventType = "permission" | "complete" | "subagent_complete" | "error" | "question"

export interface EventConfig {
  sound: boolean
  notification: boolean
}

export interface CommandConfig {
  enabled: boolean
  path: string
  args?: string[]
  minDuration?: number
}

export interface NotifierConfig {
  sound: boolean
  notification: boolean
  volume: number
  timeout: number
  showProjectName: boolean
  command: CommandConfig
  events: {
    permission: EventConfig
    complete: EventConfig
    subagent_complete: EventConfig
    error: EventConfig
    question: EventConfig
  }
  messages: {
    permission: string
    complete: string
    subagent_complete: string
    error: string
    question: string
  }
  sounds: {
    permission: string | null
    complete: string | null
    subagent_complete: string | null
    error: string | null
    question: string | null
  }
}

const DEFAULT_EVENT_CONFIG: EventConfig = {
  sound: true,
  notification: true,
}

const DEFAULT_CONFIG: NotifierConfig = {
  sound: true,
  notification: true,
  volume: 0.5,
  timeout: 5,
  showProjectName: true,
  command: {
    enabled: false,
    path: "",
    minDuration: 0,
  },
  events: {
    permission: { ...DEFAULT_EVENT_CONFIG },
    complete: { ...DEFAULT_EVENT_CONFIG },
    subagent_complete: { sound: false, notification: false },
    error: { ...DEFAULT_EVENT_CONFIG },
    question: { ...DEFAULT_EVENT_CONFIG },
  },
  messages: {
    permission: "Session needs permission",
    complete: "Session has finished",
    subagent_complete: "Subagent task completed",
    error: "Session encountered an error",
    question: "Session has a question",
  },
  sounds: {
    permission: null,
    complete: null,
    subagent_complete: null,
    error: null,
    question: null,
  },
}

function getConfigPath(): string {
  // Try .jsonc first (JSON with comments), then fall back to .json
  const jsoncPath = join(homedir(), ".config", "opencode", "opencode-notifier.jsonc")
  const jsonPath = join(homedir(), ".config", "opencode", "opencode-notifier.json")
  
  if (existsSync(jsoncPath)) {
    return jsoncPath
  }
  return jsonPath
}

function parseEventConfig(
  userEvent: any,
  defaultConfig: EventConfig
): EventConfig {
  if (userEvent === undefined) {
    return defaultConfig
  }

  if (typeof userEvent === "boolean") {
    return {
      sound: userEvent,
      notification: userEvent,
    }
  }

  return {
    sound: userEvent.sound ?? defaultConfig.sound,
    notification: userEvent.notification ?? defaultConfig.notification,
  }
}

export function loadConfig(): NotifierConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    let fileContent = readFileSync(configPath, "utf-8")
    
    // EXTREMELY ROBUST JSONC CLEANING
    // 1. Strip block comments
    fileContent = fileContent.replace(/\/\*[\s\S]*?\*\//g, "")
    // 2. Strip line comments (but not inside URLs)
    // This is tricky, let's just strip everything after // if it's not preceded by : (to avoid http://)
    // Actually, safer: just strip // if it's at the end of a line or after a space
    fileContent = fileContent.replace(/(^|\s)\/\/.*/g, "")
    // 3. Strip trailing commas before ] or }
    fileContent = fileContent.replace(/,(\s*[\]}])/g, "$1")
    
    const userConfig = JSON.parse(fileContent)

    const globalSound = userConfig.sound ?? DEFAULT_CONFIG.sound
    const globalNotification = userConfig.notification ?? DEFAULT_CONFIG.notification

    const defaultWithGlobal: EventConfig = {
      sound: globalSound,
      notification: globalNotification,
    }

    const userCommand = userConfig.command ?? {}
    const commandArgs = Array.isArray(userCommand.args)
      ? userCommand.args.filter((arg: unknown) => typeof arg === "string")
      : undefined

    const commandMinDuration =
      typeof userCommand.minDuration === "number" &&
      Number.isFinite(userCommand.minDuration) &&
      userCommand.minDuration > 0
        ? userCommand.minDuration
        : 0

    const volume = typeof userConfig.volume === "number" && userConfig.volume >= 0 && userConfig.volume <= 1
      ? userConfig.volume
      : DEFAULT_CONFIG.volume

    const config: NotifierConfig = {
      sound: globalSound,
      notification: globalNotification,
      volume: volume,
      timeout:
        typeof userConfig.timeout === "number" && userConfig.timeout > 0
          ? userConfig.timeout
          : DEFAULT_CONFIG.timeout,
      showProjectName: userConfig.showProjectName ?? DEFAULT_CONFIG.showProjectName,
      command: {
        enabled: typeof userCommand.enabled === "boolean" ? userCommand.enabled : DEFAULT_CONFIG.command.enabled,
        path: typeof userCommand.path === "string" ? userCommand.path : DEFAULT_CONFIG.command.path,
        args: commandArgs,
        minDuration: commandMinDuration,
      },
      events: {
        permission: parseEventConfig(userConfig.events?.permission ?? userConfig.permission, defaultWithGlobal),
        complete: parseEventConfig(userConfig.events?.complete ?? userConfig.complete, defaultWithGlobal),
        subagent_complete: parseEventConfig(userConfig.events?.subagent_complete ?? userConfig.subagent_complete, { sound: false, notification: false }),
        error: parseEventConfig(userConfig.events?.error ?? userConfig.error, defaultWithGlobal),
        question: parseEventConfig(userConfig.events?.question ?? userConfig.question, defaultWithGlobal),
      },
      messages: {
        permission: userConfig.messages?.permission ?? DEFAULT_CONFIG.messages.permission,
        complete: userConfig.messages?.complete ?? DEFAULT_CONFIG.messages.complete,
        subagent_complete: userConfig.messages?.subagent_complete ?? DEFAULT_CONFIG.messages.subagent_complete,
        error: userConfig.messages?.error ?? DEFAULT_CONFIG.messages.error,
        question: userConfig.messages?.question ?? DEFAULT_CONFIG.messages.question,
      },
      sounds: {
        permission: userConfig.sounds?.permission ?? DEFAULT_CONFIG.sounds.permission,
        complete: userConfig.sounds?.complete ?? DEFAULT_CONFIG.sounds.complete,
        subagent_complete: userConfig.sounds?.subagent_complete ?? DEFAULT_CONFIG.sounds.subagent_complete,
        error: userConfig.sounds?.error ?? DEFAULT_CONFIG.sounds.error,
        question: userConfig.sounds?.question ?? DEFAULT_CONFIG.sounds.question,
      },
    }
    return config
  } catch {
    return DEFAULT_CONFIG
  }
}

export function isEventSoundEnabled(config: NotifierConfig, event: EventType): boolean {
  return config.sound && config.events[event].sound
}

export function isEventNotificationEnabled(config: NotifierConfig, event: EventType): boolean {
  return config.notification && config.events[event].notification
}

export function getMessage(config: NotifierConfig, event: EventType): string {
  return config.messages[event]
}

export function getSoundPath(config: NotifierConfig, event: EventType): string | null {
  return config.sounds[event]
}
