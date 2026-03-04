# welcome

Startup welcome UI extension for Pi.

Shows a branded welcome experience when a session starts, including model/provider info, quick tips, loaded counts, and recent sessions.

---

## What it does

On `session_start` (with UI enabled), this extension renders one of two startup modes:

1. **Overlay mode** (default)
   - Centered welcome box
   - Auto-dismiss countdown (30s)
   - Dismisses on keypress, user input, tool activity, or agent start

2. **Header mode** (`quietStartup: true`)
   - Persistent compact welcome header at top
   - Removed automatically on first interaction

---

## Configuration

Set in:

`~/.pi/agent/settings.json`

```json
{
  "quietStartup": true
}
```

- `true` → compact header mode
- `false` / unset → full overlay mode

---

## Display content

The welcome UI includes:

- Current **model** and **provider**
- Quick **keyboard/command tips**
- Loaded counts for:
  - context files
  - extensions
  - skills
  - prompt templates
- Up to 3 **recent sessions** (with relative time)

---

## Behavior rules

The extension avoids noisy/late popups:

- Skips overlay if session already has activity
- Skips if agent is already streaming
- Supports early dismissal race conditions safely
- Auto-cleans timers/callbacks on dispose

---

## File structure

- `index.ts` — full extension implementation (rendering + discovery + event handling)

---

## Operational notes

- Local autoload path:
  - `~/.pi/agent/extensions/welcome/index.ts`
- Uses root dependencies from `~/.pi/agent`
- No slash command required (fully automatic)

---

## Troubleshooting

- **Welcome doesn’t appear**
  - Ensure UI mode is active and extension file is in the autoload path.
- **Overlay disappears immediately**
  - Expected if input/agent/tool activity begins quickly.
- **Need quieter startup**
  - Set `quietStartup: true` for header-only mode.
