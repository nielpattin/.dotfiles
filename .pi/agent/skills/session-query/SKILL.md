---
name: session-query
description: Search and query previous pi sessions for context, decisions, code changes, or other information. Use when you need to look up what happened in a parent session or any other session file.
disable-model-invocation: true
---

# Session Query

Use Pi session history tools in two steps:

1. `session_search` to discover relevant sessions/branches.
2. `session_query` to ask detailed questions about one result.

## Tools

### `session_search(...)`

Search across `~/.pi/agent/sessions`.

Common params:
- `keyword`
- `file`
- `after` / `before` (`YYYY-MM-DD`, `7d`, `2w`)
- `workspace`
- `all_workspaces`
- `limit`

### `session_query(...)`

Ask a specific question about one session.

Supported params:
- `question` (required)
- `sessionPath` (legacy / direct path)
- `sessionId` (from `session_search`)
- `branchLeafId` (optional, from `session_search`)
- `maxMessages` (optional)

## Examples

```text
session_search({ keyword: "permissions extension", workspace: "chezmoi" })
session_query({ sessionId: "<session-id>", branchLeafId: "<leaf-id>", question: "What approach did we choose?" })
session_query({ sessionPath: "$HOME/.pi/agent/sessions/.../session.jsonl", question: "What files were modified?" })
```

If a session was handed off with a `Parent session:` line, use that path directly with `session_query`.
