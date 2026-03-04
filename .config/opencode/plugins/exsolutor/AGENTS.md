# Exsolutor

Multi-agent system for OpenCode inspired by Amp's architecture.

## Agents

### Primary (Tab cycles through these)

| Agent | Color | Description |
|-------|-------|-------------|
| smart | Blue | Balanced mode - standard context and reasoning |
| rush | Red | Fast execution with minimal verification |
| deep | Purple | Extended thinking, use Oracle for complex analysis |

### Subagents (Task tool dispatches)

| Agent | Model | Description |
|-------|-------|-------------|
| oracle | prox/claude-opus-4-5-thinking | Deep reasoning, architecture, debugging, code review |
| librarian | prox/cli_gemini-3-flash | Codebase exploration, library internals, cross-repo patterns |

## Usage

### Mode Switching
Press **Tab** to cycle between smart, rush, and deep modes.

### Subagent Dispatch
The main agent decides when to dispatch. Example:
```
task({ subagent_type: "oracle", prompt: "Is this auth secure?" })
task({ subagent_type: "librarian", prompt: "How does express-jwt work?" })
```

## Installation

Add to `opencode.jsonc`:
```json
{
  "plugin": ["./plugin/exsolutor"]
}
```

Build:
```bash
cd ~/.config/opencode/plugin/exsolutor
bun install && bun run build
```
