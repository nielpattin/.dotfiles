# handoff

Standalone local Pi extension migrated from `git:github.com/nielpattin/pi-amplike`.

## What it does

Creates a focused **new session handoff** from the current conversation by generating a self-contained prompt with:

- `## Context` summary (decisions/findings)
- `Files involved` list
- `## Pending Tasks` checklist of unfinished work
- `## Task` section based on your handoff goal

The generated prompt is then sent in a fresh session linked to the parent session.

## Interfaces

- Slash command: `/handoff <goal>`
- Tool: `handoff({ goal })` (used only when the user explicitly requests handoff)

## Files

- `index.ts` - extension entrypoint
- `package.json` - local package metadata
- `tsconfig.json` - type-check settings

## Setup

```bash
pnpm install
```

