---
name: update-pi
description: AI-guided Pi update workflow with step-by-step command execution and verification gates after each step (global pnpm package + pi-mono upstream sync + extension API impact scan + merge to fix-windows-paste-image + dist rebuild).
---

# Update Pi (AI-Verified, Step-by-Step)

Use this skill when updating this machine’s Pi setup and **verify each step before moving on**.

## Critical rule
Do **not** run a one-shot script for this workflow.
Run one command group at a time, inspect output, verify invariants, then continue.

## Scope (only these targets)
- Global package: `@mariozechner/pi-coding-agent` (pnpm global)
- Repo: `/c/Users/niel/repo/public/pi-mono`
- Branch flow: `main` <- `upstream/main`, then merge `main` -> `fix-windows-paste-image`
- Build target: `packages/coding-agent/dist/cli.js`
- Local extensions dir for compatibility scan/update: `/c/Users/niel/.pi/agent/extensions`

## Step-by-step workflow

### 0) Preflight checks

Run:

```bash
cd /c/Users/niel/repo/public/pi-mono
git rev-parse --is-inside-work-tree
git status --porcelain
git remote -v
```

Verify:
- repo exists and is git repo
- working tree is clean
- `upstream` and `origin` remotes both exist

If any check fails, stop and report.

---

### 1) Inspect versions + `.pi` config (no changes)

Run:

```bash
npm view @mariozechner/pi-coding-agent version
pnpm list -g --depth -1 --json
cd /c/Users/niel/.pi/agent
test -f settings.json
test -f package.json
node -e "const p=require('./package.json'); const d=p.dependencies||{}; const n=['@mariozechner/pi-ai','@mariozechner/pi-coding-agent','@mariozechner/pi-tui']; const miss=n.filter(x=>!d[x]); if(miss.length){console.error('missing deps:',miss.join(',')); process.exit(1)}; console.log('piDepsOK')"
rg -n "function p|packages/coding-agent/dist/cli.js" /c/Users/niel/Documents/PowerShell/Microsoft.PowerShell_profile.ps1
```

Verify:
- latest npm version captured
- current global version parsed successfully
- `.pi/agent/settings.json` and `.pi/agent/package.json` exist
- `.pi/agent/package.json` has all three `@mariozechner/pi-*` deps
- PowerShell profile still points `p` to `pi-mono/packages/coding-agent/dist/cli.js`

Decide:
- if global drift exists, plan update in step 8

---

### 2) Fetch and inspect branch divergence

Run:

```bash
git fetch upstream --prune
git fetch origin --prune
git rev-parse --short main
git rev-parse --short upstream/main
git rev-list --count main..upstream/main
git rev-list --count upstream/main..main
```

Verify:
- `upstream/main` exists
- behind/ahead counts are known
- record `main` SHA from this step as `<MAIN_BEFORE_SHA>` for compatibility diff range

---

### 3) Sync local main from upstream/main

Run:

```bash
git switch main
git merge --ff-only upstream/main
```

Verify:

```bash
git rev-parse --short main
git rev-parse --short upstream/main
```

Pass condition:
- SHAs match exactly

If not, stop.

---

### 4) Extension API change audit + impact scan (checkpoint)

Goal:
- detect extension API/docs changes between `<MAIN_BEFORE_SHA>` and `upstream/main`
- scan local extensions for potential impact
- produce summary before any extension edits

Run:

```bash
git diff --name-only <MAIN_BEFORE_SHA>..upstream/main -- packages/coding-agent/src/core/extensions packages/coding-agent/src/core/package-manager.ts packages/coding-agent/src/core/resource-loader.ts packages/coding-agent/docs/extensions.md packages/coding-agent/examples/extensions
git log --oneline <MAIN_BEFORE_SHA>..upstream/main -- packages/coding-agent/src/core/extensions packages/coding-agent/src/core/package-manager.ts packages/coding-agent/src/core/resource-loader.ts packages/coding-agent/docs/extensions.md packages/coding-agent/examples/extensions
if [ -d /c/Users/niel/.pi/agent/extensions ]; then echo extensionsDirFound; else echo extensionsDirMissing; fi
if [ -d /c/Users/niel/.pi/agent/extensions ]; then find /c/Users/niel/.pi/agent/extensions -mindepth 1 -maxdepth 1 -type d; fi
if [ -d /c/Users/niel/.pi/agent/extensions ]; then rg -n "register|slash|shortcut|keybinding|overlay|tool|permission|resource|command" /c/Users/niel/.pi/agent/extensions; fi
```

Verify:
- extension-related diff range was checked
- local extension directories were enumerated
- candidate usages in local extensions were scanned

Decision:
- if no extension API/docs changes are detected: PASS and continue automatically
- if extension API/docs changes are detected but no local extension is likely impacted: include in report and continue automatically
- if one or more local extensions are likely impacted:
  - provide a checkpoint summary with:
    - new commits / changed files
    - what changed in extension API/docs
    - which extension folders may be affected and why
    - proposed edits per extension
  - **ask user for confirmation before step 5**

---

### 5) Update affected local extensions (only after user confirmation)

Run for each affected extension folder:

```bash
cd <EXTENSION_DIR>
git rev-parse --is-inside-work-tree
git status --porcelain
```

Then:
- if folder is a git repo and clean, create a backup branch before edits
- apply minimal compatibility edits for the detected API changes
- validate each updated extension with its available project command(s) (`build`, `test`, or equivalent)

Verify:
- each affected extension has a clear change summary
- validation command(s) completed successfully (or explicitly reported if unavailable)

If any extension update fails, stop and report.

---

### 6) Push main to origin/main (always)

Run:

```bash
git push origin main
```

Verify:
- push succeeded with no rejected/non-fast-forward errors

---

### 7) Merge main into fix-windows-paste-image with checkpoint

Run:

```bash
git switch fix-windows-paste-image
git branch backup-fix-windows-paste-image-$(date +%Y%m%d-%H%M%S)
git merge --no-edit main
```

Verify:
- merge completed without conflicts
- current branch is still `fix-windows-paste-image`

If conflict occurs:
- stop immediately
- report files in conflict
- ask user whether to resolve now

---

### 8) Update global pnpm package only if drift exists

Run only when needed from step 1:

```bash
pnpm add -g @mariozechner/pi-coding-agent@<latest>
```

Verify:

```bash
pnpm list -g --depth -1 --json
```

Pass condition:
- global installed version equals latest

---

### 9) Rebuild dist used by `p` (npm workspace, not pnpm)

Run:

```bash
cd /c/Users/niel/repo/public/pi-mono
npm run -w @mariozechner/pi-coding-agent build
```

Verify (run only after build succeeds):

```bash
test -f packages/coding-agent/dist/cli.js
```

Pass condition:
- build command exits 0
- dist file exists

---

### 10) Final report
Provide a concise summary with:
- latest npm version
- global version before/after
- `.pi` config check result (settings/package/deps + `p` alias target)
- main before/after + upstream/main SHA
- extension API scan result (changed commits/files + impact status)
- affected local extensions and update result (if any)
- origin/main push result
- merge result on `fix-windows-paste-image`
- dist build status

## Behavior rules for agent

- After each step: print `Step N: PASS/FAIL` and why.
- Continue automatically to the next step on PASS; do not pause for confirmation between steps.
- **Only** pause for confirmation when step 4 finds likely impacted local extensions before performing step 5 updates.
- Step 6 push to `origin/main` is mandatory in this workflow; do not ask whether to push.
- On fail: stop, do not continue automatically.
- Never modify dotfiles clones or unrelated folders for this workflow.
- Never mask command failures with follow-up commands in the same shell block (e.g. `cmd && echo OK`).
