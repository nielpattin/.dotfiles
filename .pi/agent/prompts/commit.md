---
description: Run worker subagent to commit staged changes in the current repo
---

<raw_args>$@</raw_args>

Call the `task` tool with exactly one worker task.

Build the worker `task` as a detailed commit request that:
- commits the already staged changes in the current repository
- inspects the staged diff before choosing the commit message
- uses normal `git` commands for this repository
- writes a conventional commit message that matches the staged changes
- includes the exact `<raw_args>` text as extra commit guidance when it is non-empty after trimming
- uses exactly `Execute your commit workflow now.` when `<raw_args>` is empty after trimming

Use this shape:

```json
{
  "agent": "worker",
  "summary": "Commit staged changes",
  "task": "<detailed worker instructions>",
  "skills": ["writing-git-commits"]
}
```