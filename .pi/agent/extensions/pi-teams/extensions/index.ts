import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import * as paths from "../src/utils/paths";
import * as teams from "../src/utils/teams";
import * as tasks from "../src/utils/tasks";
import * as messaging from "../src/utils/messaging";
import * as runtime from "../src/utils/runtime";
import type { Member, TeamConfig } from "../src/utils/models";
import { getTerminalAdapter } from "../src/adapters/terminal-registry";
import * as predefined from "../src/utils/predefined-teams";
import {
  buildInboxWakeupMessage,
  buildLeadSystemPrompt,
  buildTeammateSystemPrompt,
} from "../src/utils/prompts";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const objectSchema = (...args: any[]): any => (Type.Object as any)(...args);
const enumSchema = (...args: any[]): any => (StringEnum as any)(...args);

interface InboxRenderDetails {
  teamName: string;
  targetAgent: string;
  unreadOnly: boolean;
  bootstrapReplay?: boolean;
  messages: Array<{
    from: string;
    text: string;
    timestamp: string;
    read: boolean;
    summary?: string;
    color?: string;
  }>;
}

function renderSingleLine(text: string) {
  return {
    render(width: number) {
      return [truncateToWidth(text, width)];
    },
    invalidate() {},
  };
}

function formatInboxTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function summarizeInboxMessage(message: { summary?: string; text: string }): string {
  const summary = message.summary?.trim();
  if (summary) return summary;
  const firstLine = message.text.split(/\r?\n/, 1)[0]?.trim() || "";
  return firstLine || "(empty message)";
}

function buildInboxCollapsedText(details: InboxRenderDetails, theme: any): string {
  const count = details.messages.length;
  if (count === 0) {
    return theme.fg("dim", "empty  ctrl+o expand");
  }

  const latest = details.messages[details.messages.length - 1]!;
  const prefix = count === 1
    ? "1 message from "
    : `${count} messages, latest from `;
  return [
    theme.fg("muted", prefix),
    theme.fg("accent", latest.from),
    theme.fg("muted", ` at ${formatInboxTime(latest.timestamp)}`),
    theme.fg("dim", "  ctrl+o expand"),
  ].join("");
}

function buildInboxExpandedText(details: InboxRenderDetails, theme: any): string {
  if (details.messages.length === 0) {
    return theme.fg("dim", `No messages for ${details.targetAgent} on team '${details.teamName}'.`);
  }

  const lines: string[] = [];

  details.messages.forEach((message, index) => {
    lines.push("");
    lines.push(
      theme.fg("accent", `#${index + 1} ${message.from}`) +
      theme.fg("muted", ` at ${formatInboxTime(message.timestamp)}`)
    );
    lines.push(theme.fg("dim", `summary: ${summarizeInboxMessage(message)}`));
    if (message.text.trim()) {
      lines.push(message.text);
    }
  });

  return lines.join("\n");
}

/**
 * Build the command used to relaunch pi for teammate processes.
 *
 * There are three common cases:
 * - npm/node install: pi runs as `node .../dist/cli.js`
 * - standalone compiled binary: process.execPath is the actual `pi` executable
 * - shim-based installs (e.g. Volta): process.execPath is `node` and argv[1]
 *   may be a shim path, so the safest relaunch command is plain `pi`
 */
function getPiLaunchCommand(): string {
  const argv1 = process.argv[1];
  const execPath = process.execPath;

  // Regular Node install: relaunch the actual CLI script with node.
  if (argv1) {
    const ext = path.extname(argv1).toLowerCase();
    const looksLikeScript = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(ext)
      || /(?:^|[/\\])dist[/\\]cli\.js$/i.test(argv1);

    if (looksLikeScript) {
      return `node ${JSON.stringify(argv1)}`;
    }
  }

  // Standalone binary install: execPath is the pi executable itself.
  if (execPath) {
    const base = path.basename(execPath).toLowerCase();
    if (base !== "node" && base !== "node.exe" && base !== "bun" && base !== "bun.exe") {
      return JSON.stringify(execPath);
    }
  }

  // Shim-based installs (like Volta) are safest to relaunch through PATH.
  return "pi";
}

// Cache for available models
let availableModelsCache: Array<{ provider: string; model: string }> | null = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60000; // 1 minute

/**
 * Query available models from pi --list-models
 */
function getAvailableModels(): Array<{ provider: string; model: string }> {
  const now = Date.now();
  if (availableModelsCache && now - modelsCacheTime < MODELS_CACHE_TTL) {
    return availableModelsCache;
  }

  try {
    const result = spawnSync("pi", ["--list-models"], {
      encoding: "utf-8",
      timeout: 10000,
    });

    if (result.status !== 0 || !result.stdout) {
      return [];
    }

    const models: Array<{ provider: string; model: string }> = [];
    const lines = result.stdout.split("\n");

    for (const line of lines) {
      // Skip header line and empty lines
      if (!line.trim() || line.startsWith("provider")) continue;

      // Parse: provider model context max-out thinking images
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const provider = parts[0];
        const model = parts[1];
        if (provider && model) {
          models.push({ provider, model });
        }
      }
    }

    availableModelsCache = models;
    modelsCacheTime = now;
    return models;
  } catch (e) {
    return [];
  }
}

/**
 * Provider priority list - OAuth/subscription providers first (cheaper), then API-key providers
 */
const PROVIDER_PRIORITY = [
  // OAuth / Subscription providers (typically free/cheaper)
  "google-gemini-cli",  // Google Gemini CLI - OAuth, free tier
  "github-copilot",     // GitHub Copilot - subscription
  "kimi-sub",           // Kimi subscription
  // API key providers
  "anthropic",
  "openai",
  "google",
  "zai",
  "openrouter",
  "azure-openai",
  "amazon-bedrock",
  "mistral",
  "groq",
  "cerebras",
  "xai",
  "vercel-ai-gateway",
];

/**
 * Find the best matching provider for a given model name.
 * Returns the full provider/model string or null if not found.
 */
function resolveModelWithProvider(modelName: string): string | null {
  // If already has provider prefix, return as-is
  if (modelName.includes("/")) {
    return modelName;
  }

  const availableModels = getAvailableModels();
  if (availableModels.length === 0) {
    return null;
  }

  const lowerModelName = modelName.toLowerCase();

  // Find all exact matches (case-insensitive) and sort by provider priority
  const exactMatches = availableModels.filter(
    (m) => m.model.toLowerCase() === lowerModelName
  );

  if (exactMatches.length > 0) {
    // Sort by provider priority (lower index = higher priority)
    exactMatches.sort((a, b) => {
      const aIndex = PROVIDER_PRIORITY.indexOf(a.provider);
      const bIndex = PROVIDER_PRIORITY.indexOf(b.provider);
      // If provider not in priority list, put it at the end
      const aPriority = aIndex === -1 ? 999 : aIndex;
      const bPriority = bIndex === -1 ? 999 : bIndex;
      return aPriority - bPriority;
    });
    const bestMatch = exactMatches[0]!;
    return `${bestMatch.provider}/${bestMatch.model}`;
  }

  // Try partial match (model name contains the search term)
  const partialMatches = availableModels.filter((m) =>
    m.model.toLowerCase().includes(lowerModelName)
  );

  if (partialMatches.length > 0) {
    for (const preferredProvider of PROVIDER_PRIORITY) {
      const match = partialMatches.find(
        (m) => m.provider === preferredProvider
      );
      if (match) {
        return `${match.provider}/${match.model}`;
      }
    }
    // Return first match if no preferred provider found
    const firstMatch = partialMatches[0]!;
    return `${firstMatch.provider}/${firstMatch.model}`;
  }

  return null;
}

/**
 * Find the team this session is the lead for (if any).
 * Checks the lead-session.json file to match PID.
 */
function findLeadTeamForSession(): string | null {
  try {
    const teamsDir = paths.TEAMS_DIR;
    if (!fs.existsSync(teamsDir)) return null;

    for (const teamDir of fs.readdirSync(teamsDir)) {
      const sessionFile = paths.leadSessionPath(teamDir);
      if (fs.existsSync(sessionFile)) {
        try {
          const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
          if (session.pid === process.pid) {
            return teamDir;
          }
        } catch {
          // Ignore corrupted session files
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Register this session as the lead for a team.
 */
function registerLeadSession(teamName: string) {
  const sessionFile = paths.leadSessionPath(teamName);
  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({
    pid: process.pid,
    startedAt: Date.now(),
  }));
}

/**
 * Check if a process with the given PID is still alive.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check if process exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up a stale team if the lead process is dead.
 * Kills all teammate panes/windows and removes all state files.
 * Returns true if cleanup was performed, false otherwise.
 */
function cleanupStaleTeam(teamName: string, terminal: any): boolean {
  const sessionFile = paths.leadSessionPath(teamName);
  const configFile = paths.configPath(teamName);
  
  if (!fs.existsSync(sessionFile) || !fs.existsSync(configFile)) {
    return false;
  }
  
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    
    // Only cleanup if the lead PID is actually dead
    if (session.pid && !isPidAlive(session.pid)) {
      // Read config to get member info for cleanup
      try {
        const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
        
        // Kill all teammate panes/windows
        for (const member of config.members || []) {
          if (member.name === "team-lead") continue;
          
          // Kill via PID file
          const pidFile = path.join(paths.teamDir(teamName), `${member.name}.pid`);
          if (fs.existsSync(pidFile)) {
            try {
              const pid = fs.readFileSync(pidFile, "utf-8").trim();
              process.kill(parseInt(pid), "SIGKILL");
              fs.unlinkSync(pidFile);
            } catch {}
          }
          
          // Kill via terminal adapter
          if (terminal) {
            if (member.windowId) {
              try { terminal.killWindow(member.windowId); } catch {}
            }
            if (member.paneId) {
              try { terminal.kill(member.paneId); } catch {}
            }
          }
        }
      } catch {}
      
      // Delete entire team directory
      const teamDirectory = paths.teamDir(teamName);
      if (fs.existsSync(teamDirectory)) {
        fs.rmSync(teamDirectory, { recursive: true });
      }
      
      // Delete tasks directory
      const tasksDirectory = paths.taskDir(teamName);
      if (fs.existsSync(tasksDirectory)) {
        fs.rmSync(tasksDirectory, { recursive: true });
      }
      
      return true;
    }
  } catch {}
  
  return false;
}

/**
 * Clean up orphaned agent session folders from ~/.pi/agent/teams/
 * These are created by the pi core system when agents are spawned.
 * We remove folders that are older than 24 hours to avoid deleting active sessions.
 * Returns the number of folders cleaned up.
 */
function cleanupAgentSessionFolders(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const agentTeamsDir = path.join(os.homedir(), ".pi", "agent", "teams");
  if (!fs.existsSync(agentTeamsDir)) return 0;

  let cleaned = 0;
  const now = Date.now();

  for (const dir of fs.readdirSync(agentTeamsDir)) {
    const sessionDir = path.join(agentTeamsDir, dir);
    const configFile = path.join(sessionDir, "config.json");

    try {
      // Check if this is a directory with a config.json
      if (!fs.statSync(sessionDir).isDirectory()) continue;
      if (!fs.existsSync(configFile)) continue;

      // Read the config to check the creation time
      const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      const createdAt = config.createdAt ? new Date(config.createdAt).getTime() : 0;

      // If the folder is older than maxAgeMs, delete it
      if (createdAt > 0 && (now - createdAt) > maxAgeMs) {
        fs.rmSync(sessionDir, { recursive: true });
        cleaned++;
      }
    } catch {
      // Ignore errors for individual folders
    }
  }

  return cleaned;
}

export default function (pi: ExtensionAPI) {
  const isTeammate = !!process.env.PI_AGENT_NAME;
  const agentName = process.env.PI_AGENT_NAME || "team-lead";
  const envTeamName = process.env.PI_TEAM_NAME;
  const teammateSessionId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  // For leads without PI_TEAM_NAME, check if we're registered as lead for a team
  const detectedTeamName = envTeamName || findLeadTeamForSession();
  let teamName = detectedTeamName;

  const terminal = getTerminalAdapter();
  const IDLE_INBOX_POLL_INTERVAL_MS = 5000;

  // Track whether lead inbox polling has been started (to avoid duplicates)
  let leadPollingStarted = false;
  let sessionCtx: any = null;

  /**
   * Start inbox polling for the team lead.
   * Called when a team is created or when the lead reconnects to an existing team.
   * Requires sessionCtx to be set (from session_start).
   */
  function startLeadInboxPolling() {
    if (leadPollingStarted || isTeammate || !sessionCtx) return;
    leadPollingStarted = true;

    setInterval(async () => {
      if (!teamName) return;
      if (sessionCtx.isIdle()) {
        try {
          const unread = await messaging.readInbox(teamName, agentName, true, false);
          if (unread.length > 0) {
            pi.sendUserMessage(buildInboxWakeupMessage(teamName, unread.length), { deliverAs: "followUp" });
          }
        } catch {
          // Ignore errors for lead polling
        }
      }
    }, IDLE_INBOX_POLL_INTERVAL_MS);
  }

  function teammateHasInboxHistory(teamName: string, agentName: string): boolean {
    const inboxFile = paths.inboxPath(teamName, agentName);
    if (!fs.existsSync(inboxFile)) return false;

    try {
      const messages = JSON.parse(fs.readFileSync(inboxFile, "utf-8"));
      return Array.isArray(messages) && messages.length > 0;
    } catch {
      return false;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    paths.ensureDirs();
    sessionCtx = ctx;

    if (isTeammate) {
      const hasInboxHistory = !!teamName && teammateHasInboxHistory(teamName, agentName);
      if (teamName) {
        const pidFile = path.join(paths.teamDir(teamName), `${agentName}.pid`);
        fs.writeFileSync(pidFile, process.pid.toString());
        await runtime.writeRuntimeStatus(teamName, agentName, {
          sessionId: teammateSessionId,
          pid: process.pid,
          startedAt: Date.now(),
          lastHeartbeatAt: Date.now(),
          bootstrapPending: hasInboxHistory,
          ready: false,
          lastError: undefined,
        });
      }
      ctx.ui.notify(`Teammate: ${agentName} (Team: ${teamName})`, "info");
      ctx.ui.setStatus("00-pi-teams", `[${agentName.toUpperCase()}]`);

      if (terminal) {
        const fullTitle = teamName ? `${teamName}: ${agentName}` : agentName;
        const setIt = () => {
          if ((ctx.ui as any).setTitle) (ctx.ui as any).setTitle(fullTitle);
          terminal.setTitle(fullTitle);
        };
        setIt();
        setTimeout(setIt, 500);
        setTimeout(setIt, 2000);
        setTimeout(setIt, 5000);
      }

      if (hasInboxHistory) {
        setTimeout(() => {
          pi.sendUserMessage("Replay the prior inbox context once to understand the conversation.", { deliverAs: "followUp" });
        }, 1000);
      }

      // Inbox polling for teammates
      if (teamName) {
        setInterval(async () => {
          if (ctx.isIdle()) {
            try {
              const unread = await messaging.readInbox(teamName!, agentName, true, false);
              await runtime.writeRuntimeStatus(teamName!, agentName, {
                lastHeartbeatAt: Date.now(),
              });
              if (unread.length > 0) {
                pi.sendUserMessage(buildInboxWakeupMessage(teamName!, unread.length), { deliverAs: "followUp" });
              }
            } catch (e) {
              await runtime.writeRuntimeStatus(teamName!, agentName, {
                lastHeartbeatAt: Date.now(),
                lastError: runtime.createRuntimeError(e),
              });
            }
          }
        }, IDLE_INBOX_POLL_INTERVAL_MS);
      }
    } else if (teamName) {
      // Lead reconnecting to an existing team
      ctx.ui.setStatus("pi-teams", `Lead @ ${teamName}`);
      startLeadInboxPolling();
    }
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (isTeammate) {
      const fullTitle = teamName ? `${teamName}: ${agentName}` : agentName;
      if ((ctx.ui as any).setTitle) (ctx.ui as any).setTitle(fullTitle);
      if (terminal) terminal.setTitle(fullTitle);
      if (teamName) {
        await runtime.writeRuntimeStatus(teamName, agentName, {
          lastHeartbeatAt: Date.now(),
        });
      }
    }
  });

  let firstTurn = true;
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!firstTurn || !teamName) return;
    firstTurn = false;

    if (isTeammate) {
      await runtime.writeRuntimeStatus(teamName, agentName, {
        lastHeartbeatAt: Date.now(),
      });

      let member: Member | undefined;
      try {
        const teamConfig = await teams.readConfig(teamName);
        member = teamConfig.members.find(m => m.name === agentName);
      } catch {
        // Ignore missing team config during startup.
      }

      return {
        systemPrompt: buildTeammateSystemPrompt(
          event.systemPrompt,
          teamName,
          agentName,
          member,
          teammateHasInboxHistory(teamName, agentName)
        ),
      };
    }

    return {
      systemPrompt: buildLeadSystemPrompt(event.systemPrompt, teamName),
    };
  });

  pi.on("session_shutdown", async () => {
    if (!isTeammate || !teamName) return;

    const pidFile = path.join(paths.teamDir(teamName), `${agentName}.pid`);
    try {
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {}

    try {
      await runtime.deleteRuntimeStatus(teamName, agentName);
    } catch {}

    try {
      await teams.updateMember(teamName, agentName, {
        paneId: "",
        windowId: undefined,
        isActive: false,
      });
    } catch {}
  });

  function buildPiCommand(model?: string, thinking?: Member["thinking"]): string {
    const piBinary = getPiLaunchCommand();

    if (model) {
      let cmd = `${piBinary} --model ${model}`;
      if (thinking) cmd += ` --thinking ${thinking}`;
      return cmd;
    }

    if (thinking) {
      return `${piBinary} --thinking ${thinking}`;
    }

    return piBinary;
  }

  type MemberHealth = "healthy" | "starting" | "stale" | "dead" | "stopped";

  function readRuntimeStatusSnapshot(teamName: string, memberName: string): runtime.AgentRuntimeStatus | null {
    const runtimeFile = paths.runtimeStatusPath(teamName, memberName);
    if (!fs.existsSync(runtimeFile)) return null;

    try {
      return JSON.parse(fs.readFileSync(runtimeFile, "utf-8")) as runtime.AgentRuntimeStatus;
    } catch {
      return null;
    }
  }

  function getMemberSnapshot(teamName: string, member: Member) {
    const pidFile = path.join(paths.teamDir(teamName), `${member.name}.pid`);
    let pid: number | null = null;
    let pidAlive = false;

    if (fs.existsSync(pidFile)) {
      try {
        const parsed = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
        if (!Number.isNaN(parsed)) {
          pid = parsed;
          pidAlive = isPidAlive(parsed);
        }
      } catch {}
    }

    const runtimeStatus = readRuntimeStatusSnapshot(teamName, member.name);
    const now = Date.now();
    const hasRecentHeartbeat = !!runtimeStatus?.lastHeartbeatAt
      && (now - runtimeStatus.lastHeartbeatAt) <= runtime.HEARTBEAT_STALE_MS;

    let health: MemberHealth;
    if (member.isActive === false) {
      health = "stopped";
    } else if (!pidAlive) {
      health = "dead";
    } else if (!runtimeStatus || !runtimeStatus.ready) {
      const startedAt = runtimeStatus?.startedAt || member.joinedAt;
      health = (now - startedAt) > runtime.STARTUP_STALL_MS ? "stale" : "starting";
    } else if (!hasRecentHeartbeat) {
      health = "stale";
    } else {
      health = "healthy";
    }

    return {
      pid,
      pidAlive,
      runtimeStatus,
      hasRecentHeartbeat,
      health,
    };
  }

  async function getTeamRuntimeState(teamName: string): Promise<"running" | "stopped" | "partially_running" | "empty"> {
    const config = await teams.readConfig(teamName);
    const teammates = config.members.filter(m => m.agentType === "teammate");
    if (teammates.length === 0) return "empty";

    const activeCount = teammates.filter(m => {
      const health = getMemberSnapshot(teamName, m).health;
      return health === "healthy" || health === "starting";
    }).length;

    if (activeCount === 0) return "stopped";
    if (activeCount === teammates.length) return "running";
    return "partially_running";
  }

  async function markMemberStopped(teamName: string, memberName: string) {
    await teams.updateMember(teamName, memberName, {
      paneId: "",
      windowId: undefined,
      isActive: false,
    });
  }

  async function killTeammate(teamName: string, member: Member) {
    if (member.name === "team-lead") return;

    const pidFile = path.join(paths.teamDir(teamName), `${member.name}.pid`);
    if (fs.existsSync(pidFile)) {
      try {
        const pid = fs.readFileSync(pidFile, "utf-8").trim();
        process.kill(parseInt(pid), "SIGKILL");
        fs.unlinkSync(pidFile);
      } catch {
        // ignore
      }
    }

    if (member.windowId && terminal) {
      terminal.killWindow(member.windowId);
    }

    if (member.paneId && terminal) {
      terminal.kill(member.paneId);
    }

    await runtime.deleteRuntimeStatus(teamName, member.name);
  }

  async function spawnMemberProcess(teamConfig: TeamConfig, member: Member, forceSeparateWindow?: boolean) {
    if (!terminal) {
      throw new Error("No terminal adapter detected.");
    }

    const useSeparateWindow = forceSeparateWindow ?? (member.backendType === "window"
      ? true
      : member.backendType === "pane"
        ? false
        : (teamConfig.separateWindows ?? false));

    if (useSeparateWindow && !terminal.supportsWindows()) {
      throw new Error(`Separate windows mode is not supported in ${terminal.name}.`);
    }

    const piCmd = buildPiCommand(member.model, member.thinking);
    const env: Record<string, string> = {
      ...process.env,
      PI_TEAM_NAME: teamConfig.name,
      PI_AGENT_NAME: member.name,
    };

    let terminalId = "";
    let isWindow = false;

    if (useSeparateWindow) {
      isWindow = true;
      terminalId = terminal.spawnWindow({
        name: member.name,
        cwd: member.cwd,
        command: piCmd,
        env,
        teamName: teamConfig.name,
      });
    } else {
      terminalId = terminal.spawn({
        name: member.name,
        cwd: member.cwd,
        command: piCmd,
        env,
      });
    }

    await teams.updateMember(teamConfig.name, member.name, {
      joinedAt: Date.now(),
      paneId: isWindow ? "" : terminalId,
      windowId: isWindow ? terminalId : undefined,
      backendType: isWindow ? "window" : "pane",
      isActive: true,
    });

    return { terminalId, isWindow };
  }

  // Tools
  pi.registerTool({
    name: "team_create",
    label: "Create Team",
    description: "Create a new agent team.",
    parameters: objectSchema({
      team_name: Type.String(),
      description: Type.Optional(Type.String()),
      default_model: Type.Optional(Type.String()),
      separate_windows: Type.Optional(Type.Boolean({ default: false, description: "Open teammates in separate OS windows instead of panes" })),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      // Auto-cleanup stale team if the previous lead process is dead
      // This handles the case where a session was aborted and restarted
      if (teams.teamExists(params.team_name)) {
        cleanupStaleTeam(params.team_name, terminal);
        if (teams.teamExists(params.team_name)) {
          const state = await getTeamRuntimeState(params.team_name);
          throw new Error(`Team "${params.team_name}" already exists and is ${state}. Use team_resume({ team_name: "${params.team_name}" }) to continue it.`);
        }
      }
      
      const config = teams.createTeam(params.team_name, "local-session", "lead-agent", params.description, params.default_model, params.separate_windows);
      // Register this session as the lead so it can receive inbox messages
      registerLeadSession(params.team_name);
      // Update teamName and start inbox polling for the lead
      teamName = params.team_name;
      startLeadInboxPolling();
      return {
        content: [{ type: "text", text: `Team ${params.team_name} created.` }],
        details: { config },
      };
    },
  });

  pi.registerTool({
    name: "spawn_teammate",
    label: "Spawn Teammate",
    description: "Spawn a new teammate in a terminal pane or separate window. If specifying a model, use an exact provider/model or exact listed model name. Do not guess model names.",
    promptGuidelines: [
      "If you specify the model parameter, use an exact provider/model or exact listed model name from `pi --list-models`. Do not guess or normalize model names yourself.",
      "If the user mentions a model loosely and you are not certain of the exact name, first check available models with `pi --list-models` via bash, then pass the exact value to this tool. If you cannot verify it, omit the model parameter and explain that you used the team default.",
    ],
    parameters: objectSchema({
      team_name: Type.String(),
      name: Type.String(),
      prompt: Type.String(),
      cwd: Type.String(),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(enumSchema(["off", "minimal", "low", "medium", "high"])),
      plan_mode_required: Type.Optional(Type.Boolean({ default: false })),
      separate_window: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const safeName = paths.sanitizeName(params.name);
      const safeTeamName = paths.sanitizeName(params.team_name);

      if (!teams.teamExists(safeTeamName)) {
        throw new Error(`Team ${params.team_name} does not exist`);
      }

      if (!terminal) {
        throw new Error("No terminal adapter detected.");
      }

      const teamConfig = await teams.readConfig(safeTeamName);
      
      // Check if a teammate with this name already exists - kill them first
      // This handles the case where the user aborts mid-execution and restarts
      const existingMember = teamConfig.members.find(m => m.name === safeName && m.agentType === "teammate");
      if (existingMember) {
        await killTeammate(safeTeamName, existingMember);
        await teams.removeMember(safeTeamName, safeName);
      }
      
      let chosenModel = params.model || teamConfig.defaultModel;

      // Resolve model to provider/model format
      if (chosenModel) {
        if (!chosenModel.includes('/')) {
          // Try to resolve using available models from pi --list-models
          const resolved = resolveModelWithProvider(chosenModel);
          if (resolved) {
            chosenModel = resolved;
          } else if (teamConfig.defaultModel && teamConfig.defaultModel.includes('/')) {
            // Fall back to team default provider
            const [provider] = teamConfig.defaultModel.split('/');
            chosenModel = `${provider}/${chosenModel}`;
          }
        }
      }

      const useSeparateWindow = params.separate_window ?? teamConfig.separateWindows ?? false;

      const member: Member = {
        agentId: `${safeName}@${safeTeamName}`,
        name: safeName,
        agentType: "teammate",
        model: chosenModel,
        joinedAt: Date.now(),
        paneId: "",
        cwd: params.cwd,
        subscriptions: [],
        prompt: params.prompt,
        color: "blue",
        thinking: params.thinking,
        planModeRequired: params.plan_mode_required,
        backendType: useSeparateWindow ? "window" : "pane",
        isActive: true,
      };

      await teams.addMember(safeTeamName, member);

      let terminalId = "";
      let isWindow = false;

      try {
        ({ terminalId, isWindow } = await spawnMemberProcess(teamConfig, member, useSeparateWindow));
      } catch (e) {
        throw new Error(`Failed to spawn ${terminal.name} ${useSeparateWindow ? 'window' : 'pane'}: ${e}`);
      }

      return {
        content: [{ type: "text", text: `Teammate ${params.name} spawned in ${isWindow ? 'window' : 'pane'} ${terminalId}.` }],
        details: { agentId: member.agentId, terminalId, isWindow },
      };
    },
  });

  pi.registerTool({
    name: "spawn_lead_window",
    label: "Spawn Lead Window",
    description: "Open the team lead in a separate OS window.",
    parameters: objectSchema({
      team_name: Type.String(),
      cwd: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const safeTeamName = paths.sanitizeName(params.team_name);
      if (!teams.teamExists(safeTeamName)) throw new Error(`Team ${params.team_name} does not exist`);
      if (!terminal || !terminal.supportsWindows()) throw new Error("Windows mode not supported.");

      const teamConfig = await teams.readConfig(safeTeamName);
      const cwd = params.cwd || process.cwd();
      const piBinary = getPiLaunchCommand();
      let piCmd = piBinary;
      if (teamConfig.defaultModel) {
        // Use the combined --model provider/model format
        piCmd = `${piBinary} --model ${teamConfig.defaultModel}`;
      }

      const env = { ...process.env, PI_TEAM_NAME: safeTeamName, PI_AGENT_NAME: "team-lead" };
      try {
        const windowId = terminal.spawnWindow({ name: "team-lead", cwd, command: piCmd, env, teamName: safeTeamName });
        await teams.updateMember(safeTeamName, "team-lead", { windowId });
        return { content: [{ type: "text", text: `Lead window spawned: ${windowId}` }], details: { windowId } };
      } catch (e) {
        throw new Error(`Failed: ${e}`);
      }
    }
  });

  pi.registerTool({
    name: "send_message",
    label: "Send Message",
    description: "Send a message to a teammate.",
    promptGuidelines: [
      "After sending a progress or completion update and waiting for a reply, stop and let the extension's automatic inbox polling wake the teammate later.",
      "Do not follow send_message with manual read_inbox polling loops or sleep commands unless the user explicitly asks for that behavior.",
    ],
    parameters: objectSchema({
      team_name: Type.String(),
      recipient: Type.String(),
      content: Type.String(),
      summary: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      await messaging.sendPlainMessage(params.team_name, agentName, params.recipient, params.content, params.summary);
      return {
        content: [{ type: "text", text: `Message sent to ${params.recipient}.` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "broadcast_message",
    label: "Broadcast Message",
    description: "Broadcast a message to all team members except the sender.",
    parameters: objectSchema({
      team_name: Type.String(),
      content: Type.String(),
      summary: Type.String(),
      color: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      await messaging.broadcastMessage(params.team_name, agentName, params.content, params.summary, params.color);
      return {
        content: [{ type: "text", text: `Message broadcasted to all team members.` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "read_inbox",
    label: "Read Inbox",
    description: "Read messages from an agent's inbox.",
    promptGuidelines: [
      "For teammates, use this once at startup only when there is prior inbox history to replay for the new session.",
      "After startup, only call this when you have a concrete reason to believe unread messages exist.",
      "Do not use this tool in manual polling loops. Teammates are automatically woken by the extension's 10-second idle inbox polling.",
    ],
    parameters: objectSchema({
      team_name: Type.String(),
      agent_name: Type.Optional(Type.String({ description: "Whose inbox to read. Defaults to your own." })),
      unread_only: Type.Optional(Type.Boolean({ default: true })),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const targetAgent = params.agent_name || agentName;
      let unreadOnly = params.unread_only ?? true;
      let bootstrapReplay = false;

      if (isTeammate && teamName && params.team_name === teamName && targetAgent === agentName) {
        const runtimeStatus = await runtime.readRuntimeStatus(teamName, agentName);
        bootstrapReplay = !!runtimeStatus?.bootstrapPending;
        if (bootstrapReplay) {
          unreadOnly = false;
        }
      }

      const msgs = await messaging.readInbox(params.team_name, targetAgent, unreadOnly);

      if (isTeammate && teamName && params.team_name === teamName && targetAgent === agentName) {
        await runtime.writeRuntimeStatus(teamName, agentName, {
          lastHeartbeatAt: Date.now(),
          lastInboxReadAt: Date.now(),
          bootstrapPending: false,
          ready: true,
          lastError: undefined,
        });
      }

      return {
        content: [{ type: "text", text: JSON.stringify(msgs, null, 2) }],
        details: {
          teamName: params.team_name,
          targetAgent,
          unreadOnly,
          bootstrapReplay,
          messages: msgs,
        },
      };
    },
    renderCall(_args, theme) {
      return renderSingleLine(theme.fg("toolTitle", theme.bold("read_inbox")));
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as InboxRenderDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (!expanded) {
        return renderSingleLine(buildInboxCollapsedText(details, theme));
      }

      return new Text(buildInboxExpandedText(details, theme), 0, 0);
    },
  });

  pi.registerTool({
    name: "task_create",
    label: "Create Task",
    description: "Create a new team task.",
    parameters: objectSchema({
      team_name: Type.String(),
      subject: Type.String(),
      description: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const task = await tasks.createTask(params.team_name, params.subject, params.description);
      return {
        content: [{ type: "text", text: `Task ${task.id} created.` }],
        details: { task },
      };
    },
  });

  pi.registerTool({
    name: "task_submit_plan",
    label: "Submit Plan",
    description: "Submit a plan for a task, updating its status to 'planning'.",
    parameters: objectSchema({
      team_name: Type.String(),
      task_id: Type.String(),
      plan: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const updated = await tasks.submitPlan(params.team_name, params.task_id, params.plan);
      return {
        content: [{ type: "text", text: `Plan submitted for task ${params.task_id}.` }],
        details: { task: updated },
      };
    },
  });

  pi.registerTool({
    name: "task_evaluate_plan",
    label: "Evaluate Plan",
    description: "Evaluate a submitted plan for a task.",
    parameters: objectSchema({
      team_name: Type.String(),
      task_id: Type.String(),
      action: enumSchema(["approve", "reject"]),
      feedback: Type.Optional(Type.String({ description: "Required for rejection" })),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const updated = await tasks.evaluatePlan(params.team_name, params.task_id, params.action as any, params.feedback);
      return {
        content: [{ type: "text", text: `Plan for task ${params.task_id} has been ${params.action}d.` }],
        details: { task: updated },
      };
    },
  });

  pi.registerTool({
    name: "task_list",
    label: "List Tasks",
    description: "List all tasks for a team.",
    parameters: objectSchema({
      team_name: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const taskList = await tasks.listTasks(params.team_name);
      return {
        content: [{ type: "text", text: JSON.stringify(taskList, null, 2) }],
        details: { tasks: taskList },
      };
    },
  });

  pi.registerTool({
    name: "task_update",
    label: "Update Task",
    description: "Update a task's status or owner.",
    parameters: objectSchema({
      team_name: Type.String(),
      task_id: Type.String(),
      status: Type.Optional(enumSchema(["pending", "planning", "in_progress", "completed", "deleted"])),
      owner: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const updated = await tasks.updateTask(params.team_name, params.task_id, {
        status: params.status as any,
        owner: params.owner,
      });
      return {
        content: [{ type: "text", text: `Task ${params.task_id} updated.` }],
        details: { task: updated },
      };
    },
  });

  pi.registerTool({
    name: "team_stop",
    label: "Stop Team (keep state)",
    description: "Stop all teammate processes and close their panes/windows, but keep team config, inboxes, and tasks so the team can be resumed later. Use this for close, stop, pause, suspend, or keep-for-later requests.",
    promptGuidelines: [
      "Use this tool when the user wants to close, stop, pause, suspend, or keep a team for later while preserving its saved state.",
      "Do not use this tool when the user explicitly asks to shut down, delete, remove, destroy, or permanently close the team.",
      "After calling this tool, the team should still appear in list_runtime_teams and can be brought back with team_resume.",
    ],
    parameters: objectSchema({
      team_name: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const safeTeamName = paths.sanitizeName(params.team_name);
      const config = await teams.readConfig(safeTeamName);
      const stopped: string[] = [];
      const alreadyStopped: string[] = [];

      for (const member of config.members) {
        if (member.name === "team-lead") continue;

        const snapshot = getMemberSnapshot(safeTeamName, member);
        if (snapshot.health !== "dead" && snapshot.health !== "stopped") {
          await killTeammate(safeTeamName, member);
          stopped.push(member.name);
        } else {
          await runtime.deleteRuntimeStatus(safeTeamName, member.name);
          const pidFile = path.join(paths.teamDir(safeTeamName), `${member.name}.pid`);
          try {
            if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
          } catch {}
          alreadyStopped.push(member.name);
        }

        await markMemberStopped(safeTeamName, member.name);
      }

      return {
        content: [{
          type: "text",
          text: `Team ${safeTeamName} stopped. Stopped ${stopped.length} teammate(s).${alreadyStopped.length > 0 ? ` ${alreadyStopped.length} already inactive.` : ""}`,
        }],
        details: { stopped, alreadyStopped },
      };
    },
  });

  pi.registerTool({
    name: "team_resume",
    label: "Resume Team",
    description: "Resume a stopped team by respawning any inactive or dead teammates from saved team config.",
    promptGuidelines: [
      "Use this tool to bring back a team that was previously stopped with team_stop.",
      "Do not use this tool for creating a new team.",
    ],
    parameters: objectSchema({
      team_name: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const safeTeamName = paths.sanitizeName(params.team_name);
      if (!terminal) {
        throw new Error("No terminal adapter detected.");
      }

      const config = await teams.readConfig(safeTeamName);
      registerLeadSession(safeTeamName);
      teamName = safeTeamName;
      startLeadInboxPolling();

      const resumed: string[] = [];
      const alreadyRunning: string[] = [];
      const skipped: Array<{ name: string; error: string }> = [];

      for (const member of config.members) {
        if (member.name === "team-lead") continue;

        const snapshot = getMemberSnapshot(safeTeamName, member);
        if (snapshot.health === "healthy" || snapshot.health === "starting") {
          alreadyRunning.push(member.name);
          continue;
        }

        if (!member.prompt || !member.cwd) {
          skipped.push({ name: member.name, error: "Missing saved prompt or cwd" });
          continue;
        }

        try {
          const pidFile = path.join(paths.teamDir(safeTeamName), `${member.name}.pid`);
          try {
            if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
          } catch {}
          await runtime.deleteRuntimeStatus(safeTeamName, member.name);
          await spawnMemberProcess(config, member);
          resumed.push(member.name);
        } catch (e) {
          skipped.push({ name: member.name, error: String(e) });
        }
      }

      const skippedText = skipped.length > 0
        ? ` Skipped ${skipped.length}: ${skipped.map(s => `${s.name} (${s.error})`).join(", ")}.`
        : "";

      return {
        content: [{
          type: "text",
          text: `Team ${safeTeamName} resumed. Respawned ${resumed.length} teammate(s).${alreadyRunning.length > 0 ? ` ${alreadyRunning.length} already running.` : ""}${skippedText}`,
        }],
        details: { resumed, alreadyRunning, skipped },
      };
    },
  });

  pi.registerTool({
    name: "team_shutdown",
    label: "Delete Team (permanent)",
    description: "Permanently delete the entire team. This kills teammate processes, closes panes/windows, removes the saved team config from ~/.pi/teams, and deletes team tasks. Use this when the user explicitly asks to shut down, delete, remove, destroy, or permanently close the team.",
    promptGuidelines: [
      "Use this tool when the user explicitly asks to shut down, delete, remove, destroy, or permanently close the team.",
      "If the user says close, stop, pause, suspend, or keep the team for later, use team_stop instead.",
    ],
    parameters: objectSchema({
      team_name: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const teamName = params.team_name;
      try {
        const config = await teams.readConfig(teamName);
        for (const member of config.members) {
          await killTeammate(teamName, member);
        }

        const leadMember = config.members.find(m => m.name === "team-lead");
        if (leadMember) {
          const leadPidFile = path.join(paths.teamDir(teamName), `team-lead.pid`);
          if (fs.existsSync(leadPidFile)) {
            try {
              const pid = fs.readFileSync(leadPidFile, "utf-8").trim();
              process.kill(parseInt(pid), "SIGKILL");
              fs.unlinkSync(leadPidFile);
            } catch {}
          }

          if (terminal) {
            if (leadMember.windowId) {
              try { terminal.killWindow(leadMember.windowId); } catch {}
            }
            if (leadMember.paneId) {
              try { terminal.kill(leadMember.paneId); } catch {}
            }
          }
        }

        const dir = paths.teamDir(teamName);
        const tasksDir = paths.taskDir(teamName);
        if (fs.existsSync(tasksDir)) fs.rmSync(tasksDir, { recursive: true });
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });

        // Clean up orphaned agent session folders (older than 1 hour)
        const cleanedSessions = cleanupAgentSessionFolders(60 * 60 * 1000);

        return {
          content: [{
            type: "text",
            text: `Team ${teamName} shut down.${cleanedSessions > 0 ? ` Cleaned up ${cleanedSessions} orphaned agent session folder(s).` : ""}`
          }],
          details: { cleanedSessions }
        };
      } catch (e) {
        throw new Error(`Failed to shutdown team: ${e}`);
      }
    },
  });

  pi.registerTool({
    name: "cleanup_agent_sessions",
    label: "Cleanup Agent Sessions",
    description: "Clean up orphaned agent session folders from ~/.pi/agent/teams/ that are older than a specified age.",
    parameters: objectSchema({
      max_age_hours: Type.Optional(Type.Number()),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const maxAgeHours = params.max_age_hours ?? 24;
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      const cleaned = cleanupAgentSessionFolders(maxAgeMs);
      return {
        content: [{
          type: "text",
          text: `Cleaned up ${cleaned} orphaned agent session folder(s) older than ${maxAgeHours} hour(s).`
        }],
        details: { cleaned, maxAgeHours }
      };
    },
  });

  pi.registerTool({
    name: "task_read",
    label: "Read Task",
    description: "Read details of a specific task.",
    parameters: objectSchema({
      team_name: Type.String(),
      task_id: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const task = await tasks.readTask(params.team_name, params.task_id);
      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        details: { task },
      };
    },
  });

  pi.registerTool({
    name: "check_teammate",
    label: "Check Teammate",
    description: "Check a single teammate's status.",
    parameters: objectSchema({
      team_name: Type.String(),
      agent_name: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const config = await teams.readConfig(params.team_name);
      const member = config.members.find(m => m.name === params.agent_name);
      if (!member) throw new Error(`Teammate ${params.agent_name} not found`);

      const snapshot = getMemberSnapshot(params.team_name, member);
      const alive = snapshot.health === "healthy" || snapshot.health === "starting";
      const unreadCount = (await messaging.readInbox(params.team_name, params.agent_name, true, false)).length;
      const now = Date.now();
      const startupStalled = snapshot.health === "starting"
        && unreadCount > 0
        && (now - member.joinedAt) > runtime.STARTUP_STALL_MS
        && !(snapshot.runtimeStatus?.ready);
      const health = startupStalled ? "stalled" : snapshot.health;

      const details = {
        alive,
        unreadCount,
        health,
        agentLoopReady: !!snapshot.runtimeStatus?.ready,
        hasRecentHeartbeat: snapshot.hasRecentHeartbeat,
        startupStalled,
        runtime: snapshot.runtimeStatus,
      };

      if (snapshot.health === "dead" && snapshot.runtimeStatus) {
        await runtime.deleteRuntimeStatus(params.team_name, params.agent_name);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
        details,
      };
    },
  });

  pi.registerTool({
    name: "process_shutdown_approved",
    label: "Process Shutdown Approved",
    description: "Process a teammate's shutdown.",
    parameters: objectSchema({
      team_name: Type.String(),
      agent_name: Type.String(),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const config = await teams.readConfig(params.team_name);
      const member = config.members.find(m => m.name === params.agent_name);
      if (!member) throw new Error(`Teammate ${params.agent_name} not found`);

      await killTeammate(params.team_name, member);
      await teams.removeMember(params.team_name, params.agent_name);
      return {
        content: [{ type: "text", text: `Teammate ${params.agent_name} has been shut down.` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "list_predefined_teams",
    label: "List Predefined Teams",
    description: "List all available predefined team configurations from teams.yaml files. These are team templates that can be instantiated with create_predefined_team.",
    parameters: objectSchema({}),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const projectDir = ctx.cwd;
      const predefinedTeams = predefined.getAllPredefinedTeams(projectDir);
      const agents = predefined.getAllAgentDefinitions(projectDir);
      
      const result = predefinedTeams.map(team => {
        const teamAgents = team.agents.map(agentName => {
          const agentDef = agents.find(a => a.name === agentName);
          return {
            name: agentName,
            description: agentDef?.description || "(agent definition not found)",
            found: !!agentDef,
          };
        });
        
        return {
          name: team.name,
          agents: teamAgents,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { teams: result },
      };
    },
  });

  pi.registerTool({
    name: "list_predefined_agents",
    label: "List Predefined Agents",
    description: "List all available predefined agent definitions from .md files. These can be used individually or as part of predefined teams.",
    parameters: objectSchema({}),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const projectDir = ctx.cwd;
      const agents = predefined.getAllAgentDefinitions(projectDir);
      
      const result = agents.map(agent => ({
        name: agent.name,
        description: agent.description,
        tools: agent.tools,
        model: agent.model,
        thinking: agent.thinking,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { agents: result },
      };
    },
  });

  pi.registerTool({
    name: "create_predefined_team",
    label: "Create Predefined Team",
    description: "Create a team from a predefined team configuration. Spawns all agents defined in the team template from teams.yaml. Each agent is spawned with its predefined prompt, tools, and settings.",
    parameters: objectSchema({
      team_name: Type.String({ description: "Name for the new team instance" }),
      predefined_team: Type.String({ description: "Name of the predefined team template from teams.yaml" }),
      cwd: Type.String({ description: "Working directory for spawned agents" }),
      default_model: Type.Optional(Type.String({ description: "Default model for agents without a specified model" })),
      separate_windows: Type.Optional(Type.Boolean({ default: false, description: "Open teammates in separate OS windows instead of panes" })),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const projectDir = ctx.cwd;
      const predefinedTeam = predefined.getPredefinedTeam(params.predefined_team, projectDir);
      
      if (!predefinedTeam) {
        const available = predefined.getAllPredefinedTeams(projectDir).map(t => t.name);
        throw new Error(`Predefined team "${params.predefined_team}" not found. Available teams: ${available.join(", ") || "none"}`);
      }

      if (!terminal) {
        throw new Error("No terminal adapter detected.");
      }

      if (teams.teamExists(params.team_name)) {
        cleanupStaleTeam(params.team_name, terminal);
        if (teams.teamExists(params.team_name)) {
          const state = await getTeamRuntimeState(params.team_name);
          throw new Error(`Team "${params.team_name}" already exists and is ${state}. Use team_resume({ team_name: "${params.team_name}" }) to continue it.`);
        }
      }

      // Create the team
      const config = teams.createTeam(params.team_name, "local-session", "lead-agent", `Predefined team: ${params.predefined_team}`, params.default_model, params.separate_windows);
      registerLeadSession(params.team_name);
      // Update teamName and start inbox polling for the lead
      teamName = params.team_name;
      startLeadInboxPolling();

      const agentDefinitions = predefined.getAllAgentDefinitions(projectDir);
      const spawnResults: Array<{ name: string; status: string; error?: string }> = [];

      // Spawn each agent in the predefined team
      for (const agentName of predefinedTeam.agents) {
        const agentDef = agentDefinitions.find(a => a.name === agentName);
        
        if (!agentDef) {
          spawnResults.push({ name: agentName, status: "skipped", error: "Agent definition not found" });
          continue;
        }

        try {
          const safeName = paths.sanitizeName(agentName);
          const safeTeamName = paths.sanitizeName(params.team_name);
          
          let chosenModel = agentDef.model || params.default_model || config.defaultModel;
          
          if (chosenModel && !chosenModel.includes('/')) {
            const resolved = resolveModelWithProvider(chosenModel);
            if (resolved) {
              chosenModel = resolved;
            } else if (config.defaultModel && config.defaultModel.includes('/')) {
              const [provider] = config.defaultModel.split('/');
              chosenModel = `${provider}/${chosenModel}`;
            }
          }

          const useSeparateWindow = params.separate_windows ?? config.separateWindows ?? false;

          const member: Member = {
            agentId: `${safeName}@${safeTeamName}`,
            name: safeName,
            agentType: "teammate",
            model: chosenModel,
            joinedAt: Date.now(),
            paneId: "",
            cwd: params.cwd,
            subscriptions: [],
            prompt: agentDef.prompt,
            color: "blue",
            thinking: agentDef.thinking,
            backendType: useSeparateWindow ? "window" : "pane",
            isActive: true,
          };

          await teams.addMember(safeTeamName, member);

          try {
            await spawnMemberProcess(config, member, useSeparateWindow);
            spawnResults.push({ name: agentName, status: "spawned", error: undefined });
          } catch (e) {
            spawnResults.push({ name: agentName, status: "error", error: `Failed to spawn: ${e}` });
          }
        } catch (e) {
          spawnResults.push({ name: agentName, status: "error", error: String(e) });
        }
      }

      const summary = spawnResults.map(r => `${r.name}: ${r.status}${r.error ? ` (${r.error})` : ""}`).join("\n");
      
      return {
        content: [{ type: "text", text: `Team "${params.team_name}" created from predefined team "${params.predefined_team}".\n\nAgent spawn results:\n${summary}` }],
        details: { teamName: params.team_name, predefinedTeam: params.predefined_team, results: spawnResults },
      };
    },
  });

  pi.registerTool({
    name: "save_team_as_template",
    label: "Save Team as Template",
    description: "Save a runtime team as a reusable predefined team template. Creates agent definition files and updates teams.yaml. Use this when you've created a team with custom prompts and want to reuse it later.",
    parameters: objectSchema({
      team_name: Type.String({ description: "Name of the runtime team to save" }),
      template_name: Type.String({ description: "Name for the template (e.g., 'modularization', 'frontend-team')" }),
      description: Type.Optional(Type.String({ description: "Description for the template" })),
      scope: Type.Optional(enumSchema(["user", "project"], { description: "Where to save: 'user' for global (~/.pi), 'project' for project-local (.pi). Defaults to 'user'." })),
    }),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const teamName = params.team_name;
      
      // Verify the team exists
      if (!teams.teamExists(teamName)) {
        throw new Error(`Team "${teamName}" does not exist. Use list_runtime_teams to see available teams.`);
      }

      // Read the team configuration
      const config = await teams.readConfig(teamName);
      
      // Check that there are teammates to save
      const teammates = config.members.filter(m => m.agentType === "teammate");
      if (teammates.length === 0) {
        throw new Error(`Team "${teamName}" has no teammates to save. Only teams with spawned teammates can be saved as templates.`);
      }

      // Save the team as a template
      const result = predefined.saveTeamTemplate(config, {
        templateName: params.template_name,
        description: params.description,
        scope: params.scope || "user",
        projectDir: ctx.cwd,
      });

      // Build summary message
      const agentSummary = result.savedAgents.map(a => 
        `  - ${a.name}: ${a.existed ? "updated" : "created"} at ${a.path}`
      ).join("\n");
      
      const message = `Team "${teamName}" saved as template "${params.template_name}".

Agents saved:
${agentSummary}

Template location: ${result.teamsYamlPath}

You can now use this template with:
  create_predefined_team({ team_name: "new-team", predefined_team: "${params.template_name}", cwd: "..." })`;

      return {
        content: [{ type: "text", text: message }],
        details: {
          teamName,
          templateName: params.template_name,
          agentsDir: result.agentsDir,
          teamsYamlPath: result.teamsYamlPath,
          savedAgents: result.savedAgents,
          templateExisted: result.templateExisted,
        },
      };
    },
  });

  pi.registerTool({
    name: "list_runtime_teams",
    label: "List Runtime Teams",
    description: "List all runtime team configurations from ~/.pi/teams/ and report whether each team is running, stopped, or partially running.",
    parameters: objectSchema({}),
    async execute(toolCallId, params: any, signal, onUpdate, ctx) {
      const runtimeTeams = predefined.listRuntimeTeams();
      
      if (runtimeTeams.length === 0) {
        return {
          content: [{ type: "text", text: "No runtime teams found. Create a team with team_create first." }],
          details: { teams: [] },
        };
      }

      const result = await Promise.all(runtimeTeams.map(async (team) => {
        let activeCount = 0;
        let inactiveCount = team.memberCount;
        let state: "running" | "stopped" | "partially_running" | "empty" = team.memberCount === 0 ? "empty" : "stopped";

        try {
          const config = await teams.readConfig(team.name);
          const teammates = config.members.filter(m => m.agentType === "teammate");
          activeCount = teammates.filter(m => {
            const health = getMemberSnapshot(team.name, m).health;
            return health === "healthy" || health === "starting";
          }).length;
          inactiveCount = Math.max(0, teammates.length - activeCount);

          if (teammates.length === 0) {
            state = "empty";
          } else if (activeCount === 0) {
            state = "stopped";
          } else if (activeCount === teammates.length) {
            state = "running";
          } else {
            state = "partially_running";
          }
        } catch {
          // Keep fallback values from runtimeTeams listing
        }

        return {
          name: team.name,
          description: team.description,
          memberCount: team.memberCount,
          activeCount,
          inactiveCount,
          state,
          createdAt: team.createdAt ? new Date(team.createdAt).toISOString() : undefined,
        };
      }));

      const summary = result.map(t => {
        const counts = t.memberCount > 0
          ? ` (${t.activeCount}/${t.memberCount} active)`
          : "";
        return `- ${t.name}: ${t.state}${counts}${t.description ? ` - ${t.description}` : ""}`;
      }).join("\n");

      return {
        content: [{ type: "text", text: `Runtime teams:\n${summary}` }],
        details: { teams: result },
      };
    },
  });
}
