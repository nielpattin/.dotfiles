---
description: Run commit-writer subagent in spawn mode
---
Prepare one `subagent` tool call.

RAW_ARGS (verbatim from `/commit`):
<raw_args>$@</raw_args>

Set `task` using this rule:
- If `<raw_args>` is non-empty after trimming whitespace, use that exact text.
- Otherwise, use exactly: `Execute your commit-writer workflow now.`

Then call `subagent` with exactly:
- `agent`: `commit-writer`
- `mode`: `spawn`
- `task`: value from the rule above

Return only the tool call.
