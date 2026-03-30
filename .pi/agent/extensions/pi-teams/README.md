# pi-teams

Local Pi extension for coordinating multiple agents in **Windows Terminal**.

## Scope

This extension is local to this repo. It is not a published package and should not advertise npm install instructions.

## What it does

- Creates persistent teams
- Spawns teammates in Windows Terminal panes or separate windows
- Stores shared inboxes, tasks, and runtime status under `~/.pi`
- Supports plan approval before implementation
- Can stop and later resume teams
- Replays full inbox context only when a new teammate session has prior inbox history

## Supported terminal

- Windows Terminal only

## Main tools

### Team lifecycle
- `team_create`
- `team_stop`
- `team_resume`
- `team_shutdown`
- `list_runtime_teams`
- `cleanup_agent_sessions`

### Teammates
- `spawn_teammate`
- `spawn_lead_window`
- `check_teammate`
- `process_shutdown_approved`

### Messaging
- `send_message`
- `broadcast_message`
- `read_inbox`

### Tasks
- `task_create`
- `task_read`
- `task_list`
- `task_update`
- `task_submit_plan`
- `task_evaluate_plan`

### Templates
- `list_predefined_teams`
- `list_predefined_agents`
- `create_predefined_team`
- `save_team_as_template`

## Quick usage

1. Open `pi` inside Windows Terminal.
2. Create a team.
3. Spawn teammates.
4. Create tasks or send messages.
5. Stop or resume the team as needed.

Example flow:

```text
Create a team named 'review-team'
Spawn a teammate named 'reviewer' in the current folder and ask them to audit the extension
Create a task for the reviewer to inspect runtime and messaging behavior
```

## Plan approval mode

Use `plan_mode_required: true` when spawning a teammate if you want a review gate before implementation.

Flow:
- teammate receives task
- teammate calls `task_submit_plan`
- lead reviews with `task_evaluate_plan`
- approval moves the task to `in_progress`
- rejection keeps the task in `planning` and stores feedback

## Inbox bootstrap behavior

A teammate session has no memory of earlier turns. If that new session already has inbox history, its first inbox read replays the full inbox history for that teammate. If there is no inbox history yet, the teammate starts from its initial assignment and skips inbox bootstrap. After bootstrap, idle polling continues to look only for unread messages.

## Data layout

```text
~/.pi/
├── teams/
│   └── <team-name>/
│       ├── config.json
│       ├── lead-session.json
│       ├── <agent>.pid
│       ├── inboxes/
│       │   └── <agent>.json
│       └── runtime/
│           └── <agent>.json
└── tasks/
    └── <team-name>/
        └── <task-id>.json
```

## Notes

- Liveness is tracked from teammate PID and runtime heartbeat.
- Window and pane identifiers are used for cleanup only.
- This repo still contains some historical research notes, but the supported runtime target is Windows Terminal only.
