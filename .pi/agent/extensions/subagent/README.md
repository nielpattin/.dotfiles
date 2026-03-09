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

### Parallel Batch Size and Concurrency

Parallel execution has two separate controls:

- `--task-max-parallel <n>` / `PI_TASK_MAX_PARALLEL=<n>`
  - maximum number of tasks allowed in one parallel batch
  - default: `8`
- `--task-concurrency <n>` / `PI_TASK_CONCURRENCY=<n>`
  - maximum number of child agents actively running at once
  - default: `4`

`n` must be a positive integer for both settings.

Precedence for both settings:

- CLI flag wins when present
- otherwise the runtime flag value is used
- otherwise the environment variable is used
- otherwise the default is used

The two controls are intentionally different:

- `task-max-parallel` limits how large one `tasks: [...]` batch is allowed to be
- `task-concurrency` limits how many of those accepted tasks run simultaneously

Examples:

```bash
# Keep the default batch cap, but only run two child agents at once
pi --task-concurrency 2

# Allow up to 12 tasks in one batch, but still only run 3 at a time
pi --task-max-parallel 12 --task-concurrency 3
```

If `task-concurrency` is set higher than `task-max-parallel`, it is clamped down to the resolved task cap.

### Context Mode (`spawn` vs `fork`)

`task` supports a top-level `mode` switch:

- `spawn` (default) — Child receives only the task string (`Task: ...`). Best for isolated, reproducible work; typically lower token/cost and less context leakage.
- `fork` — Child receives a forked snapshot of the current session context **plus** the task string. Best for follow-up work that depends on prior context; typically higher token/cost and may include sensitive context.
- In parallel mode, `tasks[i].mode` can override the top-level `mode` for that task only.

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

```json
{
  "tasks": [
    { "agent": "writer", "task": "Draft the changelog", "summary": "Changelog", "mode": "spawn" },
    { "agent": "reviewer", "task": "Review the release notes", "summary": "Release review" }
  ],
  "mode": "fork"
}
```

If omitted, mode defaults to `spawn`.

Precedence rule for parallel batches:

- `tasks[i].mode` wins when present
- otherwise the top-level `mode` is used
- if neither is set, the task runs in `spawn`

`summary` is required for each delegated task. It controls the task card header (`<AgentName> — <summary>`) and does not change the delegated `task` prompt.

### Smoke tests

These examples are meant to be copy/paste setup checks. They assume you already have a user agent named `worker` configured.

#### Single-task smoke test

```json
{ "agent": "worker", "summary": "Smoke test", "task": "Reply with exactly: smoke ok" }
```

What you should see:

- one task card titled `Worker — Smoke test`
- a short final response close to `smoke ok`
- no validation error about missing required fields

#### Parallel smoke test

```json
{
  "tasks": [
    { "agent": "worker", "summary": "Smoke A", "task": "Reply with exactly: parallel a ok" },
    { "agent": "worker", "summary": "Smoke B", "task": "Reply with exactly: parallel b ok" }
  ]
}
```

What you should see:

- two task cards running under one parallel batch
- a final summary that starts with something like `Parallel: 2/2 succeeded`
- one result line for `Smoke A` and one for `Smoke B`

Notes:

- If you use different agent names locally, replace `worker` with one that exists in your setup.
- For the cleanest smoke test, prefer user agents over project-local agents so you do not hit the confirmation prompt.
- `fork` mode is better verified after you already have some session history; start with `spawn` for first-run checks.

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
skills: [triage-expert]
extensions: rtk, read-map
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
| `tools`       | No       | `read,bash,edit,write`           | Comma-separated list or string array of **built-in** tools to enable for this agent. If omitted, defaults apply.                                                          |
| `skills`      | No       | none                             | Single Pi skill name to preload for this agent. Accepts either a comma-separated string or a string array; if multiple skills are listed, Pi keeps only the first. |
| `extensions`  | No       | all/default extensions           | Extension sources to enable for this agent. Accepts either a comma-separated string or a string array. Omitted means inherit Pi's default extension loading. A blank YAML value (`extensions:`) or `[]` disables all extensions for that child. `extensions: ""` is treated the same as omission/default loading. |

Notes:

- `model` accepts `provider/model` syntax — this is a Pi feature. Use it when multiple providers offer the same model ID.
- `thinking` uses the same values as Pi's `--thinking` flag; it's recommended to set it explicitly since thinking support varies by model.
- `tools` only controls built-in tools.
- `extensions` only overrides child extension loading when it is explicitly set on the agent file:
  - omitted → inherit Pi's default/all extension loading
  - `extensions:` or `extensions: []` → pass `--no-extensions` and load none
  - non-empty list → pass `--no-extensions` plus repeated `-e <extension>` flags
  - `extensions: ""` → treat like omission/default loading
- `skills` are looked up using Pi's normal skill loader relative to the task's working directory (`task.cwd` when set, otherwise the parent `cwd`). Missing skills are reported as warnings, but the task still runs.
- The Markdown body below the frontmatter becomes the agent's system prompt and is **appended** to Pi's default system prompt (it does **not** replace it).

### Writing a Good Agent File

- **Description matters** — the main agent uses the `description` to decide which task to call, so be specific about what the agent is good at.
- **Tool scope is optional but helpful** — reducing tools can keep the agent focused, but you can leave defaults if unsure.
- **Model + thinking is the power combo** — selecting the right model and thinking level is often the biggest quality boost.

### Skills

If an agent declares `skills`, Pi Task reads that skill file up front and prepends it to the delegated prompt.

Supported syntaxes:

```yaml
skills: ui-design
```

```yaml
skills: [ui-design]
```

If multiple skills are listed in frontmatter, Pi Task keeps only the first entry.

Example:

```markdown
---
name: reviewer
description: Reviews code changes with a merge-conflict specialty
skills:
  - resolve-conflicts
  - writing-git-commits
---

Review the requested changes carefully and give concrete feedback.
```

At runtime, the delegated prompt becomes roughly:

```text
<skill name="resolve-conflicts" ...>...</skill>

Task: Review the requested changes
```

### Extensions

Agent files can also opt specific extensions into delegated subagents.

Supported syntaxes:

```yaml
extensions: rtk, read-map
```

```yaml
extensions: [rtk, read-map]
```

Extension loading behavior:

- omit `extensions` to inherit Pi's default/all extension loading
- set `extensions:` or `extensions: []` to load none
- set a non-empty list to load only those listed extensions
- `extensions: ""` behaves like omission/default loading

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

`task({ agent: "writer", summary: "API docs", task: "Document the API" })` sends:

```
[System Prompt from ~/.pi/agent/agents/writer.md]

User: Task: Document the API
```

No parent conversation history is included. In `spawn`, include all required context in `task`.

#### `fork` mode

`task({ agent: "writer", summary: "API docs", task: "Document the API", mode: "fork" })` sends:

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

- A batch can include up to 8 tasks by default (`--task-max-parallel` / `PI_TASK_MAX_PARALLEL`)
- Up to 4 child agents run concurrently by default (`--task-concurrency` / `PI_TASK_CONCURRENCY`)
- Each task uses `tasks[i].mode` when present; otherwise it falls back to the top-level `mode`
- Mixed `spawn` + `fork` batches share one parent snapshot build, and only `fork` tasks receive it
- Failed tasks are summarized with a failure category (`validation`, `startup`, `abort`, `runtime`)
- Main agent receives a combined result after all finish:

### Above-editor delegated-runs widget

When Pi UI is available, the extension also maintains a persistent `subagent-runs` widget above the editor:

- Tracks delegated runs across the session (not just one tool call)
- Shows at least `running` and `queued` counts plus capped run rows
- Updates live as partial activity/status events arrive
- Keeps recently finished rows visible briefly with explicit `✓ success`, `✕ error`, or `⏹ aborted` states
- Clears itself automatically when no active/recent runs remain
- If widget rendering fails once, task execution continues and future widget updates are disabled for safety

```
Parallel: 2/3 succeeded

[writer] completed: Full output text here...
[tester] runtime failed: Test suite exited with status 1
[reviewer] completed: Full output text here...
```

## Features

- **Auto-Discovery** — Agents are discovered on session start for UI visibility and refreshed before prompt injection/execution to stay aligned with the current filesystem state.
- **Context Mode Switch** — `spawn` (fresh context) and `fork` (session snapshot + task), with per-task overrides in parallel batches.
- **Configurable Parallel Limits** — Tune batch size and active child concurrency with `--task-max-parallel` / `PI_TASK_MAX_PARALLEL` and `--task-concurrency` / `PI_TASK_CONCURRENCY`.
- **Failure Categories** — Failed runs are normalized into `validation`, `startup`, `abort`, or `runtime` so summaries and cards are easier to triage.
- **Depth Guard** — Delegation depth is limited by default to prevent recursive task spawning.
- **Streaming Updates** — Watch task progress in real-time as tool calls and outputs stream in.
- **Session Run Widget** — Above-editor delegated-runs widget tracks queued/running/recent outcomes across the full session with short-lived completion states.
- **Rich TUI Rendering** — Collapsed/expanded views with task previews, usage stats, tool call previews, markdown output, and explicit failure categories.
- **Security Confirmation** — Project-local agents require explicit user approval before execution.

## Project Structure

```
index.ts       — Extension entry point: lifecycle hooks, tool registration, mode orchestration
agents.ts      — Agent discovery: reads and parses .md files from user/project directories
runner.ts      — Process runner: starts `pi` subprocesses in spawn/fork context modes and streams JSON events
render.ts      — TUI rendering: renderCall and renderResult for the task tool
types.ts       — Shared types and pure helper functions
index.test.ts  — Bun tests for tool validation, confirmation gates, and single/parallel orchestration
render.test.ts — Bun tests for collapsed/expanded rendering and status-state coverage
runner.test.ts — Bun tests for runner lifecycle behavior
```

## Tests

Run:

```bash
bun test extensions/subagent/agents.test.ts extensions/subagent/index.test.ts extensions/subagent/render.test.ts extensions/subagent/runner.test.ts
```

Current tests:

### `agents.test.ts`

- `parses skills/extensions from comma-separated strings and yaml arrays` — accepts both list syntaxes for agent frontmatter
- `preserves omitted vs explicitly empty extensions` — keeps `extensions` undefined when omitted and maps both `extensions:` and `extensions: []` to `[]`
- `treats extensions: "" like omission/default behavior without warning` — keeps the agent and leaves `extensions` unset so default extension loading still applies
- `keeps only the first listed skill without warning` — enforces the single-skill rule deterministically without rejecting the agent
- `warns on invalid skills types but keeps invalid extensions types silent` — preserves existing skill warnings while making NIE-20 extension parsing fall back quietly
- `lets project agents override user agents while preserving parsed extensions` — keeps the existing precedence rules while carrying parsed extension config through discovery

### `index.test.ts`

- `agent discovery + prompt injection` — discovers agents on session start and injects them into the main prompt
- `invalid mode rejection` — fails before execution when `mode` is not `spawn` or `fork`
- `mixed invocation rejection` — rejects calls that provide both single-task fields and `tasks[]`
- `incomplete single-task rejection` — requires `agent`, `summary`, and `task` together
- `invalid parallel task rejection` — rejects parallel items missing required fields
- `invalid per-task mode rejection` — rejects parallel items whose `mode` is not `spawn` or `fork`
- `fork snapshot failure` — blocks `fork` mode when session snapshot creation fails
- `parallel fork snapshot failure` — blocks mixed/defaulted parallel batches when any task needs fork context but snapshot creation fails
- `project agent decline` — cancels execution when the user rejects project-local agents
- `project agent non-UI block` — blocks project-local agents in non-UI mode unless confirmation is disabled
- `single-task execution wiring` — passes the resolved runner options and returns the final child output
- `categorized single-task failure summary` — includes the normalized failure category in single-task error text
- `uses env-configured parallel task limits` — reads batch-size and concurrency limits from env vars
- `lets task flags override env settings and clamps concurrency to the task cap` — prefers explicit flag values and keeps concurrency within the resolved batch cap
- `warns on invalid parallel settings and falls back to the defaults` — ignores bad values and falls back to the default cap (`8`) and concurrency (`4`)
- `parallel per-task mode precedence` — lets task-level mode override the top-level default and only forwards fork snapshots to fork tasks
- `parallel execution wiring` — runs tasks with the resolved concurrency, forwards fork snapshots, and aggregates results
- `categorized parallel failure summary` — includes normalized failure categories in parallel summaries
- `parallel task cap` — rejects batches above the resolved task cap

### `render.test.ts`

- `collapsed single-card states + task previews` — shows the right running, failed, and completed card status lines plus the collapsed task preview
- `narrow collapsed task preview` — collapses multiline task text into one stable preview line in narrow cards
- `expanded single details` — renders task, skills, tool trace, and final output sections
- `expanded failure details` — shows failure category separately from the raw error text
- `collapsed parallel summaries` — limits visible cards, shows task previews for visible cards, and shows the hidden-task count
- `mixed parallel mode labels` — shows each task's actual `spawn` / `fork` mode in the summary cards

### `runner.test.ts`

- `successful child run` — child process completes, output is captured, task env vars are passed through, and omitted `extensions` inherits the default Pi extension loading
- `explicit empty extensions` — passes `--no-extensions` when the agent explicitly sets `extensions: []`
- `explicit extension forwarding` — passes `--no-extensions` plus repeated `-e` flags when the agent lists extensions explicitly
- `unknown agent rejection` — fails before spawn when the requested agent does not exist and classifies it as validation
- `fork requires snapshot` — rejects `fork` mode when no parent session snapshot is provided and classifies it as validation
- `streamed event parsing` — reads session, tool, tool-result, and assistant events into the final result
- `spawn startup error` — surfaces child process startup failures and classifies them as startup
- `stderr + non-zero exit` — preserves child stderr, exit code, and classifies the failure as runtime
- `skill loading` — loads skill content, records skill metadata, and uses task cwd for lookup
- `temp file cleanup` — creates and removes temp files for system prompt and fork session input
- `parent abort` — sends `SIGTERM` and returns an abort-classified result
- `mapConcurrent ordering + limit` — keeps result order and respects the concurrency cap
- `mapConcurrent empty input` — returns an empty array when there is no work
