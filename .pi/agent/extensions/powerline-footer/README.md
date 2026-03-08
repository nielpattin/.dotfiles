# powerline-footer

Lean powerline-style status UI for Pi that renders inside the editor chrome.

## What it shows

Top row:
- pi icon
- model
- thinking level
- cost
- path
- git branch + file status
- context usage

Extra rows:
- compact extension statuses below the editor when they overflow
- notification-style statuses above the editor when they start with `[...]`

## Behavior

- Always enabled when the extension loads
- Uses one fixed layout
- Keeps Pi's default top/bottom prompt borders
- Removes the custom left/right prompt border
- No slash command or runtime toggle
- Runtime code is consolidated into `index.ts`

## Path behavior

Inside your home directory:
- home -> `~`
- one level down -> `~/name`
- two levels down -> `~/name/child`
- deeper than that -> just the current folder name

Outside your home directory:
- shows just the current folder name

## Configuration

Optional theme override file:

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

Nerd font icons are always used.

## Files

- `index.ts` — all runtime logic
- `README.md`
