# btw — Side Conversations for pi

A pi extension that lets you have a separate, parallel conversation with the LLM while the main agent is working. Think of it as whispering to an assistant without interrupting the one doing the actual work.

## Why?

When pi is in the middle of a long task, you often want to:
- Ask clarifying questions about what it's doing
- Think through next steps or plan ahead
- Get a quick answer without derailing the main session

`/btw` gives you a side channel for all of this. The main agent never sees your side conversation — it keeps working undisturbed.

## Commands

| Command | Description |
|---------|-------------|
| `/btw <message>` | Send a message in the side conversation. Streams the response in a widget above the editor. Works while the agent is running. |
| `/btw:new [message]` | Start a fresh side thread. Optionally kick it off with a message. Clears the previous thread. |
| `/btw:clear` | Dismiss the widget and clear the current thread. |
| `/btw:inject [instructions]` | Inject the full btw thread into the main agent's context as a user message. Optionally add instructions like "implement this plan". Clears the widget after. |
| `/btw:summarize [instructions]` | Summarize the btw thread via LLM, then inject the summary into the main agent's context. Lighter weight than full inject. Clears the widget after. |

## How it works

### Side conversation

Each `/btw` call builds context from:
1. **Main session messages** — the current branch conversation (user + assistant messages)
2. **Previous btw thread** — all prior btw exchanges in the current thread

The btw agent sees everything the main agent has done, plus your ongoing side conversation. A system prompt tells it this is an aside — it won't try to pick up or continue unfinished work from the main session.

The response streams in a bordered widget above the editor using the active model and thinking level. Multiple `/btw` calls accumulate in the widget, separated by dividers.

### Continuous threads

The btw thread is continuous by default. Each `/btw` call sees all prior btw Q&As, so you can have a multi-turn side conversation. Use `/btw:new` to start fresh.

### Bringing context back

When you've worked something out in the side conversation and want the main agent to act on it:
- `/btw:inject` — sends the full thread verbatim as a user message (delivered as a follow-up after the agent finishes)
- `/btw:summarize` — LLM-summarizes the thread first (using low reasoning), then injects the summary
- Both accept optional instructions: `/btw:inject implement the auth plan we discussed`
- Both clear the widget and reset the thread after injecting

### Persistence

- Btw entries (question, thinking, answer, model) are persisted in the session file via `appendEntry`
- These are `custom` entries — invisible to the TUI conversation thread and the main agent's context
- Thread reset markers (`btw-reset`) are also persisted, so `/btw:clear`, `/btw:new`, `/btw:inject`, and `/btw:summarize` resets survive restarts
- On session restore, the widget reappears with the active thread if one exists
- In-memory thread state (`pendingBtwThread`) tracks completed exchanges for continuity between `/btw` calls before they're persisted, so rapid-fire btw calls during a single agent run see each other's results

### Widget

- Renders above the editor as a component (no line limit)
- Bordered box with `╭╰│` left border
- User messages shown with green `›` prefix
- Thinking content shown in dim italic with `│` on the first line
- Answer text shown with `│` on the first line, subsequent lines flow freely (terminal handles wrapping)
- Streaming cursor `▍` shown while thinking or answering
- Status line shown at bottom of widget during `/btw:summarize`
- `/btw:clear` to dismiss and reset thread

## Architecture

```
┌─────────────────────────────────────────────┐
│ Main pi session                             │
│  User ↔ Agent (read, bash, edit, write...)  │
│                                             │
│  /btw fires a separate streamSimple() call  │
│  using the same model, thinking level,      │
│  and conversation context + a system prompt │
│  that frames it as an aside conversation    │
│                                             │
│  btw responses stream into a widget         │
│  above the editor — never enter the main    │
│  agent's context                            │
│                                             │
│  /btw:inject or /btw:summarize sends the    │
│  btw thread to the main agent via           │
│  sendUserMessage (deliverAs: "followUp")    │
│  then resets the thread                     │
└─────────────────────────────────────────────┘
```

## Session storage

Btw uses two custom entry types in the session JSONL:
- `btw` — stores `{ question, thinking, answer, model }` for each completed exchange
- `btw-reset` — stores `{ timestamp }` to mark thread boundaries

These are `custom` entries (not `custom_message`), so they don't appear in the TUI conversation or the agent's LLM context.