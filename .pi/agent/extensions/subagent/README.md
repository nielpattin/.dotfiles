# Pi Task

Delegate work to specialized agents through one tool: `task`.

## Public tool contract

`task` has exactly 2 public modes.

### 1) Single

```json
{
  "mode": "single",
  "operation": {
    "agent": "worker",
    "summary": "README pass",
    "task": "Rewrite README examples",
    "cwd": "/repo/docs",
    "skill": "triage-expert",
    "delegationMode": "spawn",
    "background": false
  }
}
```

### 2) Parallel

```json
{
  "mode": "parallel",
  "operations": [
    {
      "agent": "worker",
      "summary": "Unit tests",
      "task": "Add missing tests",
      "delegationMode": "fork",
      "background": true
    },
    {
      "agent": "reviewer",
      "summary": "Review",
      "task": "Review the patch"
    }
  ]
}
```

### Background task tracking

When `background: true` is used:

- `task` keeps the immediate tool-visible queue echo minimal (`Background task session ids: ...`) while the assistant provides the user-facing kickoff message
- tool result details include `backgroundTasks` + `backgroundTrackingHint`
- completion is pushed back into the originating session as two messages:
  - visible UX status line only (completion notice using the child session id, e.g. `✓ Fetching <child-session-id>`; no verbose payload/output block)
  - hidden control message (`triggerTurn: true`) with a structured JSON payload that instructs the main agent to call `task_result` first, then reply immediately
- completion events are written to a durable per-session inbox (`~/.pi/agent/state/subagent/background-inbox`) and flushed when that session is active
- task metadata is persisted per delegated run, and full transcript is persisted as a child Pi session file so `/tasks` and `task_result` can recover background completions after reload
- control payload includes a `task_result` call template using the child session id (`sessionId` + small `waitMs` for race safety); inline completion text is fallback context only, not the primary handoff path

## Validation rules

- `mode` is required and must be `single` or `parallel`
- `single`:
  - requires `operation`
  - forbids `operations`
- `parallel`:
  - requires non-empty `operations`
  - forbids `operation`
- each operation requires non-empty `agent`, `summary`, and `task`
- `skill` is optional and singular (`string` only)
- `delegationMode` is optional per operation (`"spawn" | "fork"`), defaults to `"spawn"`
- `background` is optional per operation (`boolean`), defaults to `false`
- `skills` is rejected
- payload `extension` / `extensions` is rejected
- top-level `{ agent, summary, task }` is rejected
- legacy `tasks` payload is rejected
- legacy top-level `mode: "spawn" | "fork"` payload model is rejected (use shape `mode` + per-operation `delegationMode`)

## Programmatic task result lookup (`task_result`)

Use `task_result` to fetch a delegated task by child session id.

```json
{
  "sessionId": "<child-session-id>",
  "waitMs": 10000,
  "pollIntervalMs": 250
}
```

- `waitMs` is optional (default `0` for immediate lookup)
- `pollIntervalMs` is optional and used only when waiting
- returns task ref + loaded result when available
- includes `details.handoff` with machine-friendly readiness fields:
  - `state`: `ready` | `running` | `missing` | `empty`
  - `usableForReply`: whether result is ready for immediate user response
  - `outputSource`: `output` | `error` | `none`
  - `outputSnippet`: short inline summary
- when a task is still running, response text explicitly says it is still running and points to `waitMs`/`/tasks`
- when complete, response text includes a short output/error snippet when available

## Agents panel (`/agents`)

Use `/agents` for per-agent settings outside the LLM payload.

The command opens a centered overlay panel (not an inline prompt widget).

Current minimal options:

- skills (multi-select picker; space toggles, enter saves, clear-all/manual-entry/back actions)
- extensions (multi-select picker; space toggles, enter saves, inherit/none/manual-entry/back actions)

Settings are persisted directly into the selected agent file frontmatter (`skills`, `extensions`).

Example agent frontmatter:

```yaml
---
name: worker
description: General worker
skills:
  - triage-expert
  - frontend-design
extensions:
  - rtk
  - read-map
---
```

Behavior:

- payload `skill` stays singular (`string`) and replaces configured skills for that run
- if payload `skill` is omitted, frontmatter `skills` are used
- payload `skill` is never merged with frontmatter `skills`
- skills picker uses discovered installed skills for the current cwd
- picker navigation supports arrows, plus page/home/end-style jumps (PageUp/PageDown/Home/End where available, with Ctrl+B/Ctrl+F/Ctrl+A/Ctrl+E equivalents)
- when no discovered skills exist, Enter defaults to manual entry (does not immediately clear skills)
- extension picker uses discovered extensions as the primary flow and supports manual entry for custom names
- extension selection stays in agent config/frontmatter, not payload
- extension picker supports both inherit (clear override) and none (persist `extensions: []`)

## Tasks panel (`/tasks`)

Use `/tasks` to inspect delegated runs in a centered overlay panel.

- list view and task detail view both run inside the same centered overlay flow
- list view shows child session id, agent, summary, task preview, status, timing, model/provider (when available), delegation mode
- Enter opens a full task detail view
- detail view loads by child session id from tracked metadata and lazy-loads transcript/details from the delegated child session file
- Left/Right switches previous/next task while staying inside detail view
- detail transcript auto-scroll is ON by default and follows newest output
- press `A` in detail view to toggle auto-scroll ON/OFF (OFF enables manual Up/Down/PgUp/PgDn/Home/End inspection without snapping back)
- detail view surfaces session id, prompt/input/output, tool calls/results, usage, and error data when available

## Agent files

Task agents are markdown files with frontmatter.

- User agents: `~/.pi/agent/agents/*.md`
- Project agents: `.pi/agents/*.md`

Project agents require confirmation before execution.

