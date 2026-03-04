# PI CONFIG (DOTFILES)

Pi config in this repo is source-managed by chezmoi.

- Source path: `~/.local/share/chezmoi/dot_pi`
- Live path: `~/.pi`

## Rules (Pi scope)

- Make tracked Pi changes here in `dot_pi/`, then run `chezmoi apply`.
- Do not keep long-lived manual edits only in `~/.pi`.
- Use `~/.local/share/chezmoi/tmp` for temporary downloads/clones/extracts (`curl`, `wget`, `gh repo clone`, `uvx github-dlr ...`).
- Copy only intentional final files from `tmp/` into `dot_pi/`.

## Quick map

- `agent/settings.json` — Pi behavior defaults
- `agent/extensions/` — local extensions
- `agent/skills/` — local skills
- `agent/themes/` — local themes

## Validate after edits

- `chezmoi diff`
- `chezmoi apply`
- For TS changes in `dot_pi/agent/`:
  - `cd "$HOME/.local/share/chezmoi/dot_pi/agent" && pnpm exec tsc -p tsconfig.json --noEmit`

For shared repo rules, see root `AGENTS.md`.
