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
    "delegationMode": "spawn"
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
      "delegationMode": "fork"
    },
    {
      "agent": "reviewer",
      "summary": "Review",
      "task": "Review the patch"
    }
  ]
}
```

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
- `skills` is rejected
- payload `extension` / `extensions` is rejected
- top-level `{ agent, summary, task }` is rejected
- legacy `tasks` payload is rejected
- legacy top-level `mode: "spawn" | "fork"` payload model is rejected (use shape `mode` + per-operation `delegationMode`)

## Settings panel (`/task-config`)

Use `/task-config` for per-agent defaults outside the LLM payload.

The command opens a centered overlay panel (not an inline prompt widget).

Current minimal options:

- default skills (multi-select picker; space toggles, enter saves, clear-all/manual-entry/back actions)
- enabled extensions (multi-select picker; space toggles, enter saves, inherit/none/manual-entry/back actions)

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

- payload `skill` stays singular (`string`) and replaces configured default skills for that run
- if payload `skill` is omitted, frontmatter default skills are used
- payload `skill` is never merged with frontmatter defaults
- default-skills picker uses discovered installed skills for the current cwd
- picker navigation supports arrows, plus page/home/end-style jumps (PageUp/PageDown/Home/End where available, with Ctrl+B/Ctrl+F/Ctrl+A/Ctrl+E equivalents)
- when no discovered skills exist, Enter defaults to manual entry (does not immediately clear skills)
- extension picker uses discovered extensions as the primary flow and supports manual entry for custom names
- extension selection stays in agent config/frontmatter, not payload
- extension picker supports both inherit (clear override) and none (persist `extensions: []`)

## Agent files

Task agents are markdown files with frontmatter.

- User agents: `~/.pi/agent/agents/*.md`
- Project agents: `.pi/agents/*.md`

Project agents require confirmation before execution.

## Tests

```bash
bun test extensions/subagent/tool.test.ts      # public contract
bun test extensions/subagent/runner.test.ts
bun test extensions/subagent/render.test.ts
bun test extensions/subagent/agents.test.ts
bun test extensions/subagent/taskconfig.test.ts
```
