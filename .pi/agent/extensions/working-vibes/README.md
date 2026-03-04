# working-vibes

AI-powered themed working messages for Pi.

This extension adds `/vibe` and sets a themed "Working..." message once per turn (e.g. `pirate`, `star trek`, `zen`, `noir`).

---

## Features

- `/vibe <theme>` to enable themed working messages
- `/vibe off` to disable
- `/vibe mode generate|file`
- `/vibe model <provider/modelId>`
- `/vibe generate <theme> [count]` to pre-generate vibe files
- Event-based vibes (no timer): update at turn start, and in file mode also on tool calls
- File mode for instant, offline, zero-cost vibes

---

## Commands

- `/vibe`
  - Shows current theme/mode/model
- `/vibe <theme>`
  - Enables a theme
- `/vibe off`
  - Disables vibes
- `/vibe mode generate`
  - On-demand AI generation
- `/vibe mode file`
  - Uses `~/.pi/agent/vibes/<theme>.txt`
- `/vibe model <provider/modelId>`
  - Set generation model
- `/vibe generate <theme> [count]`
  - Generate vibe lines and save to file (default `count=100`)

---

## Settings

Configured via `~/.pi/agent/settings.json`:

```json
{
  "workingVibe": "star trek",
  "workingVibeMode": "generate",
  "workingVibeModel": "anthropic/claude-haiku-4-5",
  "workingVibeFallback": "Working",
  "workingVibePrompt": "Generate a {theme} loading message for: {task}",
  "workingVibeMaxLength": 65
}
```

---

## File structure

- `index.ts` — extension entrypoint, event hooks, `/vibe` command
- `manager.ts` — generation engine, config, cache, file-mode logic

---

## Notes

- Autoload location:
  - `~/.pi/agent/extensions/working-vibes/index.ts`
