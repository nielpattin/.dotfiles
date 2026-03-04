import type { Plugin } from "@opencode-ai/plugin";
import type { Config, AgentConfig } from "@opencode-ai/sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import stripJsonComments from "strip-json-comments";

// Extended permission type - SDK types don't include all runtime-supported fields
type PermissionAction = "allow" | "deny" | "ask";
type AgentPermission = {
  read?: PermissionAction;
  edit?: PermissionAction;
  glob?: PermissionAction;
  grep?: PermissionAction;
  list?: PermissionAction;
  bash?: PermissionAction | Record<string, PermissionAction>;
  task?: PermissionAction;
  external_directory?: PermissionAction;
  todowrite?: PermissionAction;
  todoread?: PermissionAction;
  question?: PermissionAction;
  webfetch?: PermissionAction;
  websearch?: PermissionAction;
  codesearch?: PermissionAction;
  lsp?: PermissionAction;
  skill?: PermissionAction;
  doom_loop?: PermissionAction;
};

interface ExsolutorConfig {
  models?: {
    // Primary agents
    smart?: string;
    rush?: string;
    deep?: string;
    // Subagents
    oracle?: string;
    librarian?: string;
  };
}

const DEFAULT_CONFIG: ExsolutorConfig = {
  models: {
    // Primary agents
    smart: "openai/gpt-5.3-codex",
    rush: "kimi-for-coding/k2p5",
    deep: "openai/gpt-5.3-codex",
    // Subagents
    oracle: "kimi-for-coding/k2p5",
    librarian: "llm-proxy/cli_gemini-3-flash",
  },
};

function loadConfig(projectDir: string): ExsolutorConfig {
  // Try project-level config first, then global
  // Support both .json and .jsonc extensions
  const configDirs = [projectDir, join(process.env.HOME || "", ".config/opencode")];
  const extensions = ["exsolutor.jsonc", "exsolutor.json"];

  for (const dir of configDirs) {
    for (const ext of extensions) {
      const configPath = join(dir, ext);
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, "utf-8");
          const stripped = stripJsonComments(content);
          const userConfig = JSON.parse(stripped) as Partial<ExsolutorConfig>;
          return {
            models: {
              ...DEFAULT_CONFIG.models,
              ...userConfig.models,
            },
          };
        } catch {
          // Ignore parse errors, try next
        }
      }
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Exsolutor Plugin for OpenCode
 *
 * Registers:
 * - Primary agents (Tab cycles): smart, rush, deep
 * - Subagents (Task dispatches): oracle, librarian
 *
 * Config: exsolutor.jsonc or exsolutor.json (project or ~/.config/opencode/)
 */
export const ExsolutorPlugin: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);

  return {
    config: async (cfg: Config) => {
      cfg.agent = cfg.agent || {};

      // Helper to register agents with type safety
      const register = (name: string, agent: AgentConfig & { permission?: AgentPermission }) => {
        if (cfg.agent) cfg.agent[name] = agent as AgentConfig;
      };

      // ============================================
      // PRIMARY AGENTS (Tab cycles through these)
      // ============================================

      register("smart", {
        mode: "primary",
        // model: config.models?.smart,  // Let CLI --model take precedence
        description: "Balanced mode - standard context and reasoning",
        color: "#3B82F6",
        prompt: `Mode: smart (balanced)
- Use standard context and reasoning.
- Balance speed and quality.
- Default for most tasks.`,
      });

      register("rush", {
        mode: "primary",
        // model: config.models?.rush,  // Let CLI --model take precedence
        description: "Fast execution with minimal verification",
        color: "#EF4444",
        prompt: `Mode: rush (fast)
- Minimize context gathering.
- Execute quickly.
- Skip extensive verification.
- Shortest possible responses.`,
      });

      register("deep", {
        mode: "primary",
        // model: config.models?.deep,  // Let CLI --model take precedence
        description: "Extended thinking with Oracle for complex analysis",
        color: "#8B5CF6",
        prompt: `Mode: deep (thorough)
- Extended thinking enabled.
- Use Oracle subagent for complex architectural analysis.
- Verify assumptions extensively with tools.
- Consider edge cases and structural impact.`,
      });

      // ============================================
      // SUBAGENTS (Task tool dispatches to these)
      // ============================================

      register("oracle", {
        mode: "subagent",
        model: config.models?.oracle,
        description: "Advanced reasoning for audits, debugging, architecture decisions, code review. Use PROACTIVELY for complex bugs or second opinions.",
        permission: {
          read: "allow",
          glob: "allow",
          grep: "allow",
          list: "allow",
          lsp: "allow",
          edit: "deny",
          bash: "deny",
          websearch: "deny",
          skill: "deny",
          question: "deny",
          task: "deny",
          external_directory: "deny",
          todoread: "deny",
          todowrite: "deny",
        },
        prompt: `You are Oracle, an expert AI advisor with advanced reasoning capabilities.

## Role

Provide high-quality technical guidance, code reviews, architectural advice, and strategic planning.

You are invoked zero-shot - no follow-up questions possible. Provide a complete, actionable answer.

## Operating Principles

1. Default to simplest viable solution
2. Prefer minimal, incremental changes that reuse existing patterns
3. Optimize for maintainability over theoretical scalability
4. One primary recommendation - alternatives only if trade-offs differ materially
5. Calibrate depth to scope

## Effort Estimates

- **S** (<1 hour) - trivial, single-location change
- **M** (1-3 hours) - moderate, few files
- **L** (1-2 days) - significant, cross-cutting
- **XL** (>2 days) - major refactor or new system

## Response Format

### 1. TL;DR
1-3 sentences with the recommended approach.

### 2. Recommendation
Numbered steps or checklist. Include diffs/snippets as needed.

### 3. Rationale
Brief justification.

### 4. Risks & Guardrails
Key caveats and mitigations.

### 5. When to Reconsider
Triggers that justify revisiting.

## Communication

- Be concise, skip flattery
- Use hyphens (-) for lists, NEVER asterisks
- Include file:line references

**IMPORTANT:** Only your last message is returned. Make it comprehensive and actionable.`,
      });

      register("librarian", {
        mode: "subagent",
        model: config.models?.librarian,
        description: "Multi-repository codebase exploration. Research library internals, find patterns, compare implementations.",
        permission: {
          read: "allow",
          glob: "allow",
          grep: "allow",
          list: "allow",
          lsp: "allow",
          edit: "deny",
          bash: "deny",
          websearch: "deny",
          skill: "deny",
          question: "deny",
          task: "deny",
          external_directory: "deny",
          todoread: "deny",
          todowrite: "deny",
        },
        prompt: `You are Librarian, a multi-repository codebase understanding agent.

## Role

Explore, understand, and explain codebases - both local and remote repositories.

You are invoked zero-shot - provide a complete, final answer. No follow-up questions possible.

## Key Responsibilities

- **Repository Exploration**: Map out unfamiliar codebases and explain structure
- **Library Internals**: Understand how external libraries/SDKs work internally
- **Pattern Discovery**: Identify how features are implemented
- **Flow Tracing**: Trace execution paths across multiple files or repositories
- **Cross-Repo Analysis**: Compare implementations, find patterns across open source

## Execution

1. Use tools extensively - Read files, search code, explore thoroughly
2. Run in parallel - Execute multiple independent searches concurrently
3. Be comprehensive but focused - Cover the question fully, skip tangents
4. Go deep - Don't stop at surface level, trace through the full flow

## Response Format

### Answer
Direct response to the question.

### Key Findings
- Finding with \`file:line\` reference
- Pattern or implementation detail
- Architecture insight

### Relevant Files
List of discovered files with brief descriptions.

## Communication

- Be direct, skip flattery
- Cite file paths and line numbers
- Use hyphens for lists

**IMPORTANT:** Only your last message is returned. Make it complete and actionable.`,
      });
    },
  };
};

export default ExsolutorPlugin;
