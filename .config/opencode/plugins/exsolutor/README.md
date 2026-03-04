# Exsolutor

Multi-agent system for OpenCode (Amp-style).

## Structure

```
Tab cycles: smart ↔ rush ↔ deep

Subagents (via Task tool):
├── oracle (thinking model - deep reasoning)
└── librarian (fast model - exploration)
```

## Install

```bash
cd ~/.config/opencode/plugin/exsolutor
bun install && bun run build
```

Add to `opencode.jsonc`:
```json
{ "plugin": ["./plugin/exsolutor"] }
```

## Usage

- **Tab**: Cycle between smart/rush/deep
- **Subagent dispatch**: `task({ subagent_type: "oracle", prompt: "..." })`

## License

MIT
