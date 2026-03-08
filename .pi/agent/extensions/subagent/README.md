# Pi Task

**Delegate tasks to specialized task agents with configurable context modes (`spawn` / `fork`).**

There are many task extensions for pi, this one is mine.

## Why Pi Task

**Specialization** — Use tailored agents for specific tasks like refactoring, documentation, or research.

**Context Control** — Choose `spawn` (fresh context) or `fork` (inherit current session context), depending on the task.

**Parallel Execution** — Run multiple agents at once.

**A Simpler Fork** — This extension intentionally trims features from other implementations (like chaining and scope selectors) to keep the surface area small and predictable. If you want the minimal, “just delegate” experience, this is it.

## Configuration

### Delegation Depth (Nested Tasks)

By default, this extension allows only one delegation hop:

- Main agent runs at depth `0` and can call `task`
- Child task agents run at depth `1` and **cannot** call `task` again

This prevents accidental recursive spawning by default.

You can override the limit with either:

- CLI flag: `--task-max-depth <n>`
- Environment variable: `PI_TASK_MAX_DEPTH=<n>`

`n` must be a non-negative integer.

`PI_TASK_DEPTH` is managed internally and propagated automatically to child task processes.

Examples:

```bash
# Default behavior (equivalent): max depth 1
pi

# Allow one nested level (main -> child -> grandchild)
pi --task-max-depth 2

# Disable task delegation entirely
pi --task-max-depth 0
```

### Context Mode (`spawn` vs `fork`)

`task` supports a top-level `mode` switch:

- `spawn` (default) — Child receives only the task string (`Task: ...`). Best for isolated, reproducible work; typically lower token/cost and less context leakage.
- `fork` — Child receives a forked snapshot of the current session context **plus** the task string. Best for follow-up work that depends on prior context; typically higher token/cost and may include sensitive context.

Quick rule of thumb:

- Start with `spawn` for one-off tasks.
- Use `fork` when the delegated task depends on the current session's prior discussion, reads, or decisions.

Examples:

```json
{ "agent": "worker", "task": "Document the API", "summary": "API docs pass", "mode": "spawn" }
```

```json
{ "agent": "reviewer", "task": "Double-check this migration", "summary": "Migration review", "mode": "fork" }
```

If omitted, mode defaults to `spawn`.

`summary` is required for each delegated task. It controls the task card header (`<AgentName> — <summary>`) and does not change the delegated `task` prompt.

### Task Agent Definitions

Task Agents are defined as Markdown files with YAML frontmatter.

**User Agents:** `~/.pi/agent/agents/*.md`
**Project Agents:** `.pi/agents/*.md`

The extension always loads agents from both locations. If a project agent shares a name with a user agent, the project agent wins. When project agents are requested, Pi will prompt for confirmation before running them.

Example agent (`~/.pi/agent/agents/worker.md`):

```markdown
---
name: worker
description: Expert worker agent for handling tasks
model: openai-codex/gpt-5.3-codex
tools: read, write
---

You are an expert technical worker. Your task is to handle and complete tasks efficiently and accurately.
```

### Frontmatter Fields

| Field         | Required | Default                          | Description                                                                                                                                                                |
| ------------- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Yes      | —                                | Agent identifier used in tool calls (must match exactly)                                                                                                                   |
| `description` | Yes      | —                                | What the agent does (shown to the main agent)                                                                                                                              |
| `model`       | No       | Uses the default pi model        | Overrides the model for this agent. You can include a provider prefix (e.g. `openai-codex/gpt-5.3-codex` or `openrouter/claude-3.5-sonnet`) to force a specific provider. |
| `thinking`    | No       | Uses Pi's default thinking level | Sets the thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`). Equivalent to `--thinking`.                                                                  |
| `tools`       | No       | `read,bash,edit,write`           | Comma-separated list of **built-in** tools to enable for this agent. If omitted, defaults apply.                                                                           |

Notes:

- `model` accepts `provider/model` syntax — this is a Pi feature. Use it when multiple providers offer the same model ID.
- `thinking` uses the same values as Pi's `--thinking` flag; it's recommended to set it explicitly since thinking support varies by model.
- `tools` only controls built-in tools. Extension tools remain available unless extensions are disabled.
- The Markdown body below the frontmatter becomes the agent's system prompt and is **appended** to Pi's default system prompt (it does **not** replace it).

### Writing a Good Agent File

- **Description matters** — the main agent uses the `description` to decide which task to call, so be specific about what the agent is good at.
- **Tool scope is optional but helpful** — reducing tools can keep the agent focused, but you can leave defaults if unsure.
- **Model + thinking is the power combo** — selecting the right model and thinking level is often the biggest quality boost.

### Available Built-in Tools

Available Tools (default: `read`, `bash`, `edit`, `write`):

- `read` — Read file contents
- `bash` — Execute bash commands
- `edit` — Edit files with find/replace
- `write` — Write files (creates/overwrites)
- `grep` — Search file contents (read-only, off by default)
- `find` — Find files by glob pattern (read-only, off by default)
- `ls` — List directory contents (read-only, off by default)

Tip: for a read-only tool selection, use `read,find,ls,grep`. As soon as you include `edit`, `write`, or `bash`, the agent can practically go wild.

## How Communication Works

### The Isolation Model

Each task always runs in a **separate `pi` process**:

- ❌ No shared memory/state with the parent process
- ❌ No visibility into sibling task agents
- ✅ Its own model/tool/runtime loop
- ✅ Started with `PI_OFFLINE=1` to skip startup network operations and reduce spawn latency

What it can see depends on `mode`:

- `spawn` (default)
  - ✅ Receives: task system prompt + `Task: ...`
  - ❌ Does **not** receive parent session history
- `fork`
  - ✅ Receives: forked snapshot of current parent session context + `Task: ...`

### What Gets Sent to Task Agents

#### `spawn` mode (default)

`task({ agent: "writer", task: "Document the API" })` sends:

```
[System Prompt from ~/.pi/agent/agents/writer.md]

User: Task: Document the API
```

No parent conversation history is included. In `spawn`, include all required context in `task`.

#### `fork` mode

`task({ agent: "writer", task: "Document the API", mode: "fork" })` sends:

```
[Forked snapshot of current session context]
[System Prompt from ~/.pi/agent/agents/writer.md]

User: Task: Document the API
```

Note: `fork` copies session context, not transient runtime-only prompt mutations from the parent process.

### What Comes Back to the Main Agent

| Data                        | Main Agent Sees          | TUI Shows              |
| --------------------------- | ------------------------ | ---------------------- |
| Final text output           | ✅ Yes — full, unbounded | ✅ Yes                 |
| Tool calls made by task agent | ❌ No                    | ✅ Yes (expanded view) |
| Token usage / cost          | ❌ No                    | ✅ Yes                 |
| Reasoning/thinking steps    | ❌ No                    | ❌ No                  |
| Error messages              | ✅ Yes (on failure)      | ✅ Yes                 |

**Key point:** The main agent receives **only the final assistant text** from each task. Not the tool calls, not the reasoning, not the intermediate steps. This prevents context pollution while still giving you the results.

### Parallel Mode Behavior

When running multiple agents in parallel:

- All task agents start simultaneously (up to 4 concurrent)
- The top-level `mode` applies to all tasks in that call
- Main agent receives a combined result after all finish:

```
Parallel: 3/3 succeeded

[writer] completed: Full output text here...
[tester] completed: Full output text here...
[reviewer] completed: Full output text here...
```

## Features

- **Auto-Discovery** — Agents are found at startup and their descriptions are injected into the main agent's system prompt.
- **Context Mode Switch** — `spawn` (fresh context) and `fork` (session snapshot + task) per call.
- **Depth Guard** — Delegation depth is limited by default to prevent recursive task spawning.
- **Streaming Updates** — Watch task progress in real-time as tool calls and outputs stream in.
- **Rich TUI Rendering** — Collapsed/expanded views with usage stats, tool call previews, and markdown output.
- **Security Confirmation** — Project-local agents require explicit user approval before execution.

## Project Structure

```
index.ts       — Extension entry point: lifecycle hooks, tool registration, mode orchestration
agents.ts      — Agent discovery: reads and parses .md files from user/project directories
runner.ts      — Process runner: starts `pi` subprocesses in spawn/fork context modes and streams JSON events
render.ts      — TUI rendering: renderCall and renderResult for the task tool
types.ts       — Shared types and pure helper functions
runner.test.ts — Bun tests for runner lifecycle behavior
```

## Tests

Run:

```bash
bun test extensions/subagent/runner.test.ts
```

Current tests:

- **successful child run** — child process completes, output is captured, and task env vars are passed through
- **unknown agent rejection** — fails before spawn when the requested agent does not exist
- **fork requires snapshot** — rejects `fork` mode when no parent session snapshot is provided
- **streamed event parsing** — reads session, tool, tool-result, and assistant events into the final result
- **spawn startup error** — surfaces child process startup failures
- **stderr + non-zero exit** — preserves child stderr and exit code on failure
- **skill loading** — loads skill content, records skill metadata, and uses task cwd for lookup
- **temp file cleanup** — creates and removes temp files for system prompt and fork session input
- **parent abort** — sends `SIGTERM` and returns an aborted result
- **`mapConcurrent` ordering + limit** — keeps result order and respects the concurrency cap
- **`mapConcurrent` empty input** — returns an empty array when there is no work
