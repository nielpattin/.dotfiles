---
description: Complete the next incomplete task from a PRD
---

Complete one task from a PRD file. Implements the next task with `passes: false`, runs feedback loops, and commits.

## CRITICAL RULE

**NEVER commit `.opencode/` files.** They are internal state tracking, globally gitignored. Only commit source code changes.

## Usage

```
/complete-next-task <prd-name>
```

Where `<prd-name>` matches `.opencode/state/<prd-name>/prd.json`

## Before Starting

First, invoke the skill tool to detect the VCS:

```
skill({ name: 'vcs-detect' })
```

Use the detected VCS (jj or git) for all version control operations.

## File Locations

**IMPORTANT**: The `.opencode/state/` directory may not be at cwd. Search for it:

1. Start at cwd
2. Check if `.opencode/state/<prd-name>/prd.json` exists
3. If not, go up one directory
4. Repeat until found or reaching filesystem root

Once found, use **absolute paths** for all file operations:

```
<state-dir>/
├── prd.json     # Task list with passes field
└── progress.txt # Cross-iteration memory
```

## Process

### 1. Get Bearings

- Read progress file
- **CHECK 'Codebase Patterns' SECTION FIRST**
- Read PRD - find next task with `passes: false`
- **Task Priority** (highest to lowest):
  1. Architecture/core abstractions
  2. Integration points
  3. Spikes/unknowns
  4. Standard features
  5. Polish/cleanup
- Check recent history (jj: `jj log --limit 10`, git: `git log --oneline -10`)

### 2. Initialize Progress (if needed)

If progress.txt doesn't exist, create it:

```markdown
# Progress Log

PRD: <name>
Started: <date>

## Codebase Patterns
---
```

### 3. Branch Setup

**Do NOT create a new branch for each task.** The feature branch was created by `/prd-task`.

Just verify you're on the correct feature branch:

**Git:**
```bash
git branch --show-current
# Should be: feat/<feature-name>
# If not: git checkout feat/<feature-name>
```

**Jujutsu:**
```bash
jj log --limit 1
```

All task commits go to this ONE branch.

### 4. Implement Task

Work on the single task until verification steps pass.

### 5. Feedback Loops (REQUIRED)

Before committing, run ALL applicable:
- Type checking
- Tests
- Linting
- Formatting

**Do NOT commit if any fail.** Fix issues first.

### 6. Update PRD

Set the task's `passes` field to `true` in the PRD file.

**NOTE:** `.opencode/` files are INTERNAL state. Do NOT commit them. They are automatically gitignored.

### 7. Update Progress

Append to progress.txt:

```markdown
## Task - [task.id]
- What was implemented
- Files changed
- **Learnings:** patterns, gotchas
```

If you discover a **reusable pattern**, also add to `## Codebase Patterns` at the TOP.

### 8. Commit

**Commit ONLY the source code changes.**

The `.opencode/` folder is internal state tracking and is globally gitignored. Git will automatically exclude it.

**Git:**
```bash
git add -A
git commit -m 'feat(<scope>): <description>'
```

**Jujutsu:**
```bash
jj describe -m 'feat(<scope>): <description>' && jj bookmark create <prd>/<task-id> && jj new
```

**NOTE:** If Git outputs warnings about "ignored" files, this is expected - `.opencode/` is gitignored. These warnings do NOT indicate failure. Proceed normally.

## Completion

If all tasks have `passes: true`:

### 1. Update Roadmap Status (Auto-Sync)

**These updates are for internal tracking only. Do NOT commit `.opencode/` files.**

Check if this is a roadmap-linked feature (name matches `<project>-F<id>` pattern):

1. Parse project name and feature ID from prd-name
2. Find `.opencode/state/<project>/roadmap.md`
3. Update the feature's status from `in-progress` to `done`
4. Add completion date to notes.md (if exists)

These files are gitignored - no commit needed for state updates.

### 2. Find Unblocked Features

After marking feature done:

1. Read roadmap and find ALL features with `planned` or `prd` status
2. For each, check if their dependencies are now ALL `done`
3. List newly unblocked features

### 3. Offer Merge Options

**Ask the user how they want to finalize the feature.**

**OUTPUT FORMATTING:**
- **USE** markdown headers (`##`) for sections
- **USE** **bold** for emphasis
- **USE** bullet lists with hyphens (`-`)
- **DO NOT** use horizontal rules (`---`)
- **DO NOT** wrap output in code blocks
- **DO NOT** use decorative separators like `━━━`

Example prompt:

✓ <prd-name> COMPLETE

Feature branch: feat/<feature-name>
Commits: X commits on this branch

HOW DO YOU WANT TO FINALIZE?

1. SQUASH & MERGE (recommended for clean history)
   - Combine all X commits into 1 commit
   - Merge to main branch
   - Delete feature branch

2. MERGE (keep individual commits)
   - Keep all X commits as-is
   - Merge to main branch
   - Delete feature branch

3. CREATE PR (for code review)
   - Push branch to remote
   - Open pull request
   - You decide squash/merge later

4. LEAVE AS-IS (manual handling)
   - Keep branch, do nothing
   - You handle merge/PR yourself

Choice [1/2/3/4]:

### 4. Execute User Choice

**Option 1: Squash & Merge**
```bash
# Git
git checkout main
git merge --squash feat/<feature-name>
git commit -m 'feat(<scope>): <feature-description>'
git branch -d feat/<feature-name>
```

**Option 2: Merge (keep commits)**
```bash
# Git
git checkout main
git merge feat/<feature-name>
git branch -d feat/<feature-name>
```

**Option 3: Create PR**
```bash
# Git
git push -u origin feat/<feature-name>
gh pr create --title 'feat(<scope>): <feature-description>' --body '<auto-generated summary>'
```

**Option 4: Leave as-is**
Just output the completion message, don't touch git.

### 5. Output Final Message

**OUTPUT FORMATTING:**
- **USE** markdown headers (`##`) for sections
- **USE** **bold** for emphasis
- **USE** bullet lists with hyphens (`-`)
- **DO NOT** use horizontal rules (`---`)
- **DO NOT** wrap output in code blocks
- **DO NOT** use decorative separators like `━━━`

Example (output as plain text, not code block):

✓ <prd-name> COMPLETE

Action taken: [Squashed & merged / Merged / PR created / Left as-is]
Roadmap updated: <feature-id> status → done

UNBLOCKED FEATURES

The following features can now be started:

  F5: Email Notifications (v1.1, Size: M)
      Dependencies: F1 ✓

  F7: Search (v1.1, Size: M)
      Dependencies: F3 ✓

Recommended next:
  /prd <project>/F5  (highest priority unblocked)


If no features are unblocked:

✓ <prd-name> COMPLETE

Action taken: [Squashed & merged / Merged / PR created / Left as-is]
Roadmap updated: <feature-id> status → done

No new features unblocked.
Check /roadmap-status <project> for overall progress.

## First Task Status Sync

When starting the FIRST task of a feature:

1. Check if this is a roadmap-linked feature
2. If status is `prd`, update to `in-progress`
3. Add start date to notes.md (if exists)

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden.
Patterns you establish will be copied. Corners you cut will be cut again.
Fight entropy. Leave the codebase better than you found it.

<user-request>
$ARGUMENTS
</user-request>
