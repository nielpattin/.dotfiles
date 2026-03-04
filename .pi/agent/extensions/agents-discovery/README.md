# agents-discovery

Auto-loads subdirectory `AGENTS.md` files when the agent reads files under those directories.

## Why

Pi loads `AGENTS.md` from global + cwd ancestors at startup/reload. It does not natively inject descendant directory `AGENTS.md` on file read.

This extension bridges that gap (similar to opencode behavior):
- Hooks `tool_result` for successful `read` calls
- Walks from read target directory up to current `cwd`
- Finds unseen `AGENTS.md` files
- Appends them as `<system-reminder>` text in the read result

## Behavior

- Session-scoped dedupe (each discovered `AGENTS.md` is injected once per session)
- Resets on `session_start` and `session_switch`
- Skips global/cwd/ancestor `AGENTS.md` already loaded by Pi
- Only discovers paths inside current `cwd`

## Enable

Add to `dot_pi/agent/settings.json` extensions list:

```json
"+extensions\\agents-discovery\\index.ts"
```
