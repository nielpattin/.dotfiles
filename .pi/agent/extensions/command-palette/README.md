# Command Palette Extension

Adds a modular command palette with provider sections.

## Default hotkey

- `Ctrl+P` (captured via terminal input listener)

## Commands

- `/palette` — Open command palette
- `/command-palette` — Alias
- `/palette-config` — Manage visibility filters

## Config file

- Path: `~/.pi/agent/command-palette.json`
- Schema:

```json
{
  "version": 1,
  "hiddenProviders": [],
  "hiddenActions": []
}
```

## Provider API (for other extensions)

Import from `./command-palette/registry.js`:

```ts
import { registerCommandPaletteProvider } from "./command-palette/registry.js";

const unregister = registerCommandPaletteProvider({
  id: "my-provider",
  section: "My Section",
  source: "my-extension",
  order: 50,
  getActions: (ctx) => [
    {
      id: "do-thing",
      label: "Do thing",
      description: "Run my action",
      invoke: async (ctx) => {
        ctx.ui.notify("Done", "info");
      },
    },
  ],
});
```

Call `unregister()` on `session_shutdown`.
