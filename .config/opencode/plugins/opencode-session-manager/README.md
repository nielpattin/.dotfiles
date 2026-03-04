# opencode-session-manager

Standalone session management tools for OpenCode. This plugin allows you to explore, search, and inspect your session history directly from within OpenCode.

## Features

- **List Sessions**: View all your previous sessions with message counts and timestamps.
- **Read Messages**: Retrieve the conversation history from any session.
- **Search History**: Search for specific text or concepts across all your stored sessions.
- **Session Info**: Get detailed metadata about a session, including agents used and task progress.

## Tools

| Tool | Description |
|------|-------------|
| `session_list` | List available sessions with optional date filtering. |
| `session_read` | Read messages from a specific session (includes todos and transcripts). |
| `session_search` | Search for text across all sessions or within a specific one. |
| `session_info` | Get detailed metadata about a specific session. |

## Installation

Add the following to your `opencode.jsonc` file:

```jsonc
{
  "plugin": [
    "./plugin/opencode-session-manager"
  ]
}
```

## Development

To build the plugin:

```bash
cd plugin/opencode-session-manager
bun install
bun run build
```
