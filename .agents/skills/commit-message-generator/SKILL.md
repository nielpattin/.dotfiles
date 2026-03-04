---
name: commit-message-generator
description: Summarize modified files and craft a commit message following conventional commit style
---

## Purpose

- Inspect local changes, staged files, and diff-stat output
- Give a concise summary of what has changed in bullet points
- Craft a commit message matching the existing style shown in the recent log output, following git commit conventions
- Present the summary + proposed message to the user

## Commit Message Format

The commit message must include a prefix:
- `feat` - new feature
- `fix` - bug fix
- `build` - build system changes
- `chore` - maintenance tasks
- `ci` - CI/CD changes
- `docs` - documentation only
- `style` - formatting, no code change
- `refactor` - code restructuring
- `perf` - performance improvements
- `test` - adding/fixing tests
- `revert` - reverting changes

Use `BREAKING CHANGE: ()` in the body only if there is a breaking change.

Use `feat(scope): ` or `fix(scope): ` if a scope is applicable.

## Instructions

1. Analyze the status and diff-stat output
2. Summarize the intent of the changes in bullet points (one bullet per logical change)
3. Deduce the prevailing commit style from the recent log (tense, prefixes, etc.)
4. Compose a concise subject line (<=72 chars) following that style
5. Include an optional body (if needed) to explain reasoning or context
6. Be specific - avoid generic messages like "improved agent experience"

## Response Format

Present the response in this structure:

### Change Summary Details
- Summarize change 1
- Summarize change 2

### Proposed Commit Message
```txt
<subject line>

- <optional body 1>
- <optional body 2>
- ...
```
