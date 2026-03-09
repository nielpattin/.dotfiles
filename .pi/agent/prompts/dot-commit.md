---
description: Run worker subagent to commit staged dotfiles changes with dot
---

<raw_args>$@</raw_args>

Call the `task` tool with exactly one worker task.

Build the worker `task` as a detailed commit request that:
- commits the already staged changes in the dotfiles repository
- inspects the staged diff before choosing the commit message
- uses `pwsh -NoLogo -Command "dot <args>"` for every repository operation instead of plain `git`
- writes a conventional commit message in the format `chore(dotfiles): <subject>`
- includes the exact `<raw_args>` text as extra commit guidance when it is non-empty after trimming
- uses exactly `Execute your dotfiles commit workflow now.` when `<raw_args>` is empty after trimming

THIS IS THE FORMAT OF TASK TOOL YOU SHOULD USE. FOLLOW THIS EXACTLY:
```json
{
  "agent": "worker",
  "summary": "<one-line summary of the commit task>",
  "task": "<detailed worker instructions>",
  "skills": ["writing-git-commits"]
}
```