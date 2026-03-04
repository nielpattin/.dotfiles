# powerline-footer

Powerline-style status UI for Pi that renders directly inside the editor chrome.

This extension adds a compact, high-signal status line (model, thinking, path, git/VCS, context, token/cache/cost stats) and a responsive secondary row for overflow/status messages.

---

## Why this exists

Pi’s default footer is functional, but this extension is optimized for:

- **Fast scanning** of current model/session context
- **Git-aware editing** with lightweight branch/dirty indicators
- **Responsive layout** that adapts to narrow terminals
- **Low visual noise** with configurable presets

---

## Features

- **Embedded status line** in custom editor rendering (not a detached footer)
- **Preset-based layouts** (`default`, `minimal`, `compact`, `full`, `nerd`, `ascii`, `custom`)
- **Git/VCS segment** with branch + staged/unstaged/untracked counters
- **Dedicated second-row session label** (full session name shown below editor when available)
- **Context/tokens/cost/cache segments** pulled from session usage
- **Thinking-level segment** (rainbow on `high`/`xhigh`)
- **Responsive overflow row** below editor for extra segments
- **Extension status row** above editor for notification-style statuses (`[ext] ...`)
- **Fast VCS cache + invalidation** on write/edit and git branch-changing commands

---

## Command

### `/powerline`

- `/powerline` → toggle on/off
- `/powerline on` → force enable
- `/powerline off` → force disable
- `/powerline <preset>` → switch preset

Available presets:

- `default`
- `minimal`
- `compact`
- `full`
- `nerd`
- `ascii`
- `custom`

---

## Configuration

### Nerd font behavior

Set env var to force icon mode:

- `POWERLINE_NERD_FONTS=1` → force nerd icons
- `POWERLINE_NERD_FONTS=0` → force ASCII fallback

Auto-detection supports common terminals (iTerm/WezTerm/Kitty/Ghostty/Alacritty).

### Theme overrides

Optional file:

`~/.pi/agent/extensions/powerline-footer/theme.json`

Example:

```json
{
  "colors": {
    "pi": "accent",
    "model": "#d787af",
    "path": "#00afaf",
    "gitClean": "success",
    "gitDirty": "warning",
    "contextWarn": "warning",
    "contextError": "error"
  }
}
```

---

## File structure

- `index.ts` — extension entrypoint, command wiring, custom editor integration
- `types.ts` — shared types and segment contracts
- `presets.ts` — preset definitions
- `segments.ts` — segment renderers
- `separators.ts` — separator styles
- `icons.ts` — icon sets + nerd/ascii detection
- `theme.ts` — semantic color resolution + overrides
- `vcs-status.ts` — git branch/status caching

---

## Operational notes

- Uses root agent dependencies from `~/.pi/agent` (no per-extension package needed).
- Designed for local extension autoload via:
  - `~/.pi/agent/extensions/powerline-footer/index.ts`
- If UI behaves oddly after major changes, restart Pi session.

---

## Troubleshooting

- **No icons / broken glyphs**
  - Set `POWERLINE_NERD_FONTS=0` or switch terminal font.
- **Git status not updating**
  - Run any command that triggers render, or toggle `/powerline` once.
- **Too much data in status line**
  - Use `/powerline minimal` or `/powerline compact`.
