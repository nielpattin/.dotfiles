# session-query

Pi extension for session history discovery and deep Q&A.

## Tools

- `session_search`
  - Fast, deterministic search across `~/.pi/agent/sessions`
  - Filters: `keyword`, `file`, `after`, `before`, `workspace`, `all_workspaces`, `limit`
  - Returns `session_id`, `session_path`, and `branch_leaf_id` candidates

- `session_query`
  - LLM-powered Q&A on one chosen session/branch
  - Backward compatible with legacy inputs (`sessionPath + question`)
  - Also supports `sessionId` and optional `branchLeafId` (from `session_search`)

## Recommended flow

1. Run `session_search` to find the right branch/session.
2. Run `session_query` on that result for targeted questions.

## Examples

```text
session_search({ keyword: "rewind extension", workspace: "chezmoi" })
session_query({ sessionId: "<id>", branchLeafId: "<leaf>", question: "What files were changed?" })
```
