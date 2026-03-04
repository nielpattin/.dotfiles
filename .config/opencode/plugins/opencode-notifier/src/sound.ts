import { homedir, platform } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"
import { spawn } from "child_process"
import type { EventType } from "./config"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEBOUNCE_MS = 1000

const lastSoundTime: Record<string, number> = {}

function normalizePath(p: string): string {
  let normalized = p
  if (p.startsWith("~/")) {
    normalized = join(homedir(), p.slice(2))
  } else if (platform() === "win32" && p.startsWith("/home/niel/")) {
    // Translate linux-style paths to windows ones
    normalized = join(homedir(), p.slice(11)).replace(/\//g, "\\")
  }
  return normalized
}

function getBundledSoundPath(event: EventType): string {
  const soundFilename = `${event}.wav`
  const possiblePaths = [
    join(__dirname, "..", "sounds", soundFilename),
    join(__dirname, "sounds", soundFilename),
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return join(__dirname, "..", "sounds", soundFilename)
}

function getSoundFilePath(event: EventType, customPath: string | null): string | null {
  if (customPath) {
    const p = normalizePath(customPath)
    if (existsSync(p)) {
      return p
    }
  }

  const bundledPath = getBundledSoundPath(event)
  if (existsSync(bundledPath)) {
    return bundledPath
  }

  return null
}

async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "ignore",
      detached: false
    })

    proc.on("error", (err) => {
      reject(err)
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command exited with code ${code}`))
      }
    })
  })
}

async function playOnLinux(soundPath: string): Promise<void> {
  const players = [
    { command: "paplay", args: [soundPath] },
    { command: "aplay", args: [soundPath] },
    { command: "mpv", args: ["--no-video", "--no-terminal", soundPath] },
    { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", soundPath] },
  ]

  for (const player of players) {
    try {
      await runCommand(player.command, player.args)
      return
    } catch {
      continue
    }
  }
}

async function playOnMac(soundPath: string): Promise<void> {
  await runCommand("afplay", [soundPath])
}

async function playOnWindows(soundPath: string, volume: number): Promise<void> {
  const isWav = soundPath.toLowerCase().endsWith(".wav")
  // Escape for PowerShell: single quotes inside single quotes are escaped with ''
  const escapedPath = soundPath.replace(/'/g, "''")
  
  if (isWav) {
    // Note: Media.SoundPlayer doesn't support volume control
    // For volume control on WAV, we'd need a different approach
    const script = `(New-Object Media.SoundPlayer '${escapedPath}').PlaySync()`
    await runCommand("powershell", ["-NoProfile", "-NonInteractive", "-Command", script])
  } else {
    // Robust MP3 playback using PowerShell and PresentationCore with volume control
    const script = `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName PresentationCore
      $player = New-Object System.Windows.Media.MediaPlayer
      $player.Volume = ${volume}
      $player.Open('${escapedPath}')
      $player.Play()
      # Wait for playback to finish or at least for 10 seconds max
      $timeout = 10
      $elapsed = 0
      while ($player.NaturalDuration.HasTimeSpan -eq $false -and $elapsed -lt 2) {
        Start-Sleep -Milliseconds 100
        $elapsed += 0.1
      }
      if ($player.NaturalDuration.HasTimeSpan) {
        $wait = $player.NaturalDuration.TimeSpan.TotalSeconds
        Start-Sleep -Seconds $wait
      } else {
        # Fallback wait if metadata couldn't be loaded
        Start-Sleep -Seconds 5
      }
    `
    await runCommand("powershell", ["-NoProfile", "-NonInteractive", "-Sta", "-Command", script])
  }
}

export async function playSound(
  event: EventType,
  customPath: string | null,
  volume: number = 0.5
): Promise<void> {
  const now = Date.now()
  if (lastSoundTime[event] && now - lastSoundTime[event] < DEBOUNCE_MS) {
    return
  }
  lastSoundTime[event] = now

  const soundPath = getSoundFilePath(event, customPath)

  if (!soundPath) {
    return
  }

  const os = platform()

  try {
    switch (os) {
      case "darwin":
        await playOnMac(soundPath)
        break
      case "linux":
        await playOnLinux(soundPath)
        break
      case "win32":
        await playOnWindows(soundPath, volume)
        break
      default:
        break
    }
  } catch (err) {
    // Log to console for debugging
    console.error(`[Notifier] Sound playback failed for ${soundPath}:`, err)
  }
}
