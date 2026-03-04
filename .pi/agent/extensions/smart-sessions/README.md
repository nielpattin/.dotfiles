# smart-sessions

Pi extension to auto-name sessions from the first real prompt (including `/skill:<name> ...`).

## What it does

- Detects the first meaningful `input` in a session
- Supports `/skill:<name> <prompt>` and prefixes titles with `[skill]`
- Ignores slash commands like `/model`, `/name`, etc. (except `/skill:...`)
- Sets an immediate fallback title from the first 60 chars so the sidebar updates instantly
- Generates a better title in the background with an opencode-style title prompt
- Cleans model output before setting final title:
  - strips `<think>...</think>` blocks
  - takes first non-empty line
  - removes trailing `. ! ?`
  - trims surrounding quotes
  - clamps to 100 chars max

## Manual command

Use `/autoname-sessions` to force naming when auto-naming did not trigger (for example, command-heavy starts).

- `/autoname-sessions` -> uses the first user message in the current branch
- `/autoname-sessions <text>` -> uses the provided text
- `/autoname-sessions /skill:<name> <prompt>` -> applies `[skill]` prefix and names from prompt

## Title prompt behavior

The model is instructed to:

- Use the same language as the user input
- Keep titles concise and natural (prefer 3-8 words, max 10)
- Focus on the main intent/task
- Preserve technical terms, filenames, error codes, and numbers
- Avoid tool names and quotes
- Return a meaningful title even for short/casual input (for example: `Greeting`)

## Model selection logic

Uses explicit provider mapping first, then fallback:

1. `openai-codex` -> `gpt-5.1-codex-mini`
2. `google-gemini-cli` -> `gemini-2.5-flash`
3. Otherwise (or if mapped model is unavailable) -> current active model

## Files

- `index.ts` — extension entrypoint
- `AGENTS.md` — local maintenance notes
- `README.md` — behavior and usage

## Enable

Add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "+extensions\\smart-sessions\\index.ts"
  ]
}
```

Then run `/reload` in Pi.
