#!/usr/bin/env bun
/**
 * task-loop: Run /complete-next-task in a loop until PRD is complete
 */

// ============================================================================
// Configuration
// ============================================================================

export const VERSION = "1.2.0";
const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_MODEL = "prox/gemini-3-flash";
const DEFAULT_AGENT = "rush";

const ON_COMPLETE_ACTIONS = {
  squash: "1",
  merge: "2",
  pr: "3",
  leave: "4",
  ask: null,
} as const;

type OnCompleteAction = keyof typeof ON_COMPLETE_ACTIONS;

const OPENCODE_PERMISSION = JSON.stringify({
  bash: "allow",
  edit: "allow",
  write: "allow",
  read: "allow",
  todowrite: "allow",
  todoread: "allow",
});

// Use isolated config - ignore project configs
const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? "";
const TASK_LOOP_CONFIG = `${HOME_DIR}/.local/bin/task-loop.jsonc`;

// ============================================================================
// Notifications
// ============================================================================

async function playSuccessSound(mute: boolean) {
  if (mute) return;
  
  const soundFile = `${HOME_DIR}/.config/opencode/assets/sounds_gow_active_reload.mp3`;
  
  try {
    // Try common Linux audio players in order of preference
    const players = [
      ["mpv", "--no-video", soundFile],
      ["paplay", soundFile],
      ["ffplay", "-nodisp", "-autoexit", soundFile],
      ["aplay", soundFile], // WAV only fallback
    ];
    
    for (const [player, ...args] of players) {
      if (!player) continue;
      try {
        const proc = Bun.spawn([player, ...args], { stdout: "ignore", stderr: "ignore" });
        await proc.exited;
        return; // Success, exit early
      } catch {
        continue; // Try next player
      }
    }
  } catch (e) {
    // Silent fail - sound is non-critical
    console.error("Sound error:", e);
  }
}

async function sendDiscordNotification(enable: boolean, feature: string) {
  if (!enable) return;
  
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("[Discord] Error: DISCORD_WEBHOOK_URL not found in environment.");
    return;
  }

  const payload = {
    embeds: [{
      title: `✅ PRD Complete: ${feature}`,
      color: 0x00ff00, // Green
      fields: [
        { name: "Project", value: process.cwd(), inline: false },
        { name: "Status", value: "All tasks passed", inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log("[Discord] Notification sent.");
  } catch (e) {
    console.error("[Discord] Failed to send notification:", e);
  }
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface Args {
  feature: string;
  maxIterations: number;
  onComplete: OnCompleteAction;
  model: string;
  agent: string;
  continueSession: boolean;
  discord: boolean;
  mute: boolean;
}

function parseArgs(): Args {
  const args = Bun.argv.slice(2);
  let feature: string | null = null;
  let maxIterations = DEFAULT_MAX_ITERATIONS;
  let onComplete: OnCompleteAction = "squash";
  let model: string = DEFAULT_MODEL;
  let agent: string = DEFAULT_AGENT;
  let continueSession = false;
  let discord = false;
  let mute = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg.startsWith("--model=")) {
      model = arg.split("=")[1] ?? DEFAULT_MODEL;
    } else if (arg === "--model" || arg === "-m") {
      const val = args[++i];
      if (val !== undefined) model = val;
    } else if (arg.startsWith("--agent=")) {
      agent = arg.split("=")[1] ?? DEFAULT_AGENT;
    } else if (arg === "--agent" || arg === "-a") {
      const val = args[++i];
      if (val !== undefined) agent = val;
    } else if (arg === "--continue" || arg === "-c") {
      continueSession = true;
    } else if (arg === "--discord") {
      discord = true;
    } else if (arg === "--mute") {
      mute = true;
    } else if (arg.startsWith("--on-complete=")) {
      const value = arg.split("=")[1] as OnCompleteAction;
      if (ON_COMPLETE_ACTIONS.hasOwnProperty(value)) {
        onComplete = value;
      } else {
        console.error(`Error: Invalid --on-complete value: ${value}`);
        process.exit(1);
      }
    } else if (arg === "--on-complete") {
      const value = args[++i] as OnCompleteAction;
      if (ON_COMPLETE_ACTIONS.hasOwnProperty(value)) {
        onComplete = value;
      } else {
        console.error(`Error: Invalid --on-complete value: ${value}`);
        process.exit(1);
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      console.log(`task-loop v${VERSION}`);
      process.exit(0);
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      feature = arg;
    }
  }

  if (!feature) {
    printHelp();
    process.exit(1);
  }

  return { feature, maxIterations, onComplete, model, agent, continueSession, discord, mute };
}

function printHelp() {
  console.log(`
task-loop: Run /complete-next-task in a loop until PRD is complete

Usage:
  task-loop <feature> [options]

Options:
  --model, -m MODEL     Model to use (default: ${DEFAULT_MODEL})
  --agent, -a AGENT     Agent to use (default: ${DEFAULT_AGENT})
  --continue, -c        Continue last session
  --on-complete=ACTION  squash|merge|pr|leave (default: squash)
  --discord             Send Discord notification on completion (requires DISCORD_WEBHOOK_URL)
  --mute                Disable completion sound
  --version, -v         Show version
  --help, -h            Show this help
`);
}

// ============================================================================
// Logic (Exported for Testing)
// ============================================================================

export function findPrdJson(feature: string, baseDir: string = process.cwd()): string | null {
  let dir = baseDir;
  for (let i = 0; i < 10; i++) {
    const prdPath = `${dir}/.opencode/state/${feature}/prd.json`;
    if (Bun.file(prdPath).size > 0) return prdPath;
    const parent = dir.split("/").slice(0, -1).join("/");
    if (parent === "" || parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function isPrdComplete(prdPath: string): Promise<boolean> {
  try {
    const prd = await Bun.file(prdPath).json();
    return Array.isArray(prd.tasks) && prd.tasks.every((t: any) => t.passes === true);
  } catch {
    return false;
  }
}

export function processOutput(chunk: Uint8Array): string {
  let str = new TextDecoder().decode(chunk);
  str = str.replace(/\*\*/g, ""); // Strip bold
  str = str.replace(/\x1b\[30m/g, "\x1b[32m"); // Black -> Green
  return str;
}

// ============================================================================
// Execution
// ============================================================================

async function runOpencode(cmd: string, env: Record<string, string | undefined>): Promise<void> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, FORCE_COLOR: "1" },
  });

  const streamStdout = async () => {
    for await (const chunk of proc.stdout) {
      process.stdout.write(processOutput(chunk));
    }
  };

  const streamStderr = async () => {
    for await (const chunk of proc.stderr) {
      process.stderr.write(processOutput(chunk));
    }
  };

  await Promise.all([streamStdout(), streamStderr()]);
  await proc.exited;
}

// ============================================================================
// Main Loop
// ============================================================================

export async function runLoop() {
  // If being run directly (not via bun test)
  if (import.meta.main) {
    const { feature, onComplete, model, agent, continueSession, discord, mute } = parseArgs();

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Task Loop: ${feature} (v${VERSION})`);
    console.log(`Model: ${model}`);
    console.log(`Agent: ${agent}`);
    console.log(`Continue: ${continueSession}`);
    console.log(`Notifications: Sound=${!mute}, Discord=${discord}`);
    console.log(`${"=".repeat(60)}\n`);

    const prdPath = findPrdJson(feature);

    for (let i = 1; ; i++) {
      console.log(`\nIteration ${i}\n${"─".repeat(60)}`);

      let cmd: string;
      if (continueSession && i > 1) {
        cmd = `opencode run --model ${model} --agent ${agent} --continue "Continue to the next task from the PRD"`;
      } else {
        const cFlag = continueSession ? "--continue" : "";
        cmd = `opencode run --model ${model} --agent ${agent} ${cFlag} --command complete-next-task ${feature}`;
      }

      await runOpencode(cmd, {
        ...process.env,
        OPENCODE_PERMISSION,
        OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      });

      if (prdPath && await isPrdComplete(prdPath)) {
        console.log(`\n${"=".repeat(60)}\nPRD ${feature} COMPLETE!\n${"=".repeat(60)}`);
        
        // Notifications
        await playSuccessSound(mute);
        await sendDiscordNotification(discord, feature);

        if (onComplete !== "ask") {
          const choice = ON_COMPLETE_ACTIONS[onComplete];
          console.log(`Auto-finalizing with choice "${choice}" (${onComplete})...`);
          const replyCmd = `opencode run -c "${choice}"`;
          await runOpencode(replyCmd, {
            ...process.env,
            OPENCODE_PERMISSION,
            OPENCODE_DISABLE_PROJECT_CONFIG: "true",
          });
        }
        process.exit(0);
      }

      console.log("\nWaiting 1s before next iteration...");
      await Bun.sleep(1000);
    }
  }
}

runLoop().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
