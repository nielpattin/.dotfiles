# AGENTS.md

Scope: applies to everything under `~/.pi`.

## What this folder is

- `~/.pi/agent` is the main Bun + TypeScript workspace in this tree.
- Most code changes here are Pi extensions, prompts, skills, themes, and local agent config.
- Treat this folder as user-owned config + code, not a generic app repo.

## Work rules for `~/.pi`

- Keep changes focused and local to the requested area.
- Do not touch user data files unless the user asks.
  - Examples: `auth.json`, `sessions/`, `prompt-stash.jsonl`, cache-like files.
- Do not add secrets, tokens, keys, or machine-specific private data.

## Code changes in `~/.pi/agent`

- Use Bun for tests and tooling.
- TypeScript settings live in `~/.pi/agent/tsconfig.json`.
- After changing extension code, run targeted validation for the changed area when possible.

Common commands from `~/.pi/agent`:

```bash
bun test extensions/<name>/<file>.test.ts
bun x tsc --noEmit
```

## Tests

- Prefer small, behavior-based tests.
- Test names should describe the behavior being verified, not just the function name.
- Add targeted tests before widening scope.
- For large files, thin smoke coverage is not enough; cover important branches and failure paths.

### Temp files in tests

- Never hardcode temp paths.
- Always use Node APIs for OS-native temp locations.
- Use:
  - `os.tmpdir()`
  - `fs.mkdtempSync()` / `fs.mkdtemp()`
  - `path.join()`
  - other `node:path` helpers as needed

## README / docs style

- Keep docs human, direct, and short.
- Avoid bloated AI-style explanations.
- Prefer concise bullets over long prose.
- When documenting tests, list:
  - the test name
  - the behavior it covers
- Do not dump implementation detail unless it helps someone maintain the code.

Good test doc style:

- `unknown agent rejection` — fails before spawn when the requested agent does not exist
- `parent abort` — cancels the child process and returns an aborted result

## Extension work

When editing `~/.pi/agent/extensions/*`:

- keep tool schemas and README examples in sync
- keep renderer behavior aligned with actual runtime behavior
- prefer targeted tests for runner/validation/rendering changes
- if a feature is removed, remove its docs, tests, and UI references too
