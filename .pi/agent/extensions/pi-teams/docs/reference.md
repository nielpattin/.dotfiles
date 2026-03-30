# pi-teams reference

Accurate tool and behavior reference for the local `pi-teams` extension in this repo.

## Runtime target

- Windows Terminal only
- Local extension only

## Team tools

### `team_create`
Create a team.

Parameters:
- `team_name` string
- `description` string optional
- `default_model` string optional
- `separate_windows` boolean optional

### `team_stop`
Stop teammate processes and keep team state on disk.

Parameters:
- `team_name` string

### `team_resume`
Respawn teammates that are stopped, dead, or stale.

Parameters:
- `team_name` string

### `team_shutdown`
Permanently delete the team and its saved state.

Parameters:
- `team_name` string

### `list_runtime_teams`
List saved runtime teams and summarize whether each team is running, stopped, partially running, or empty.

Parameters:
- none

### `cleanup_agent_sessions`
Remove orphaned `~/.pi/agent/teams/*` session folders older than the configured age.

Parameters:
- `max_age_hours` number optional

## Teammate tools

### `spawn_teammate`
Spawn a teammate in a Windows Terminal pane or separate window.

Parameters:
- `team_name` string
- `name` string
- `prompt` string
- `cwd` string
- `model` string optional
- `thinking` one of `off | minimal | low | medium | high`
- `plan_mode_required` boolean optional
- `separate_window` boolean optional

Notes:
- If `model` is provided without a provider prefix, the extension tries to resolve it from `pi --list-models`.
- If a teammate with the same name already exists, the old process is replaced.

### `spawn_lead_window`
Open the team lead in a separate Windows Terminal window.

Parameters:
- `team_name` string
- `cwd` string optional

### `check_teammate`
Inspect one teammate.

Parameters:
- `team_name` string
- `agent_name` string

Returned health values:
- `healthy`
- `starting`
- `stale`
- `stalled`
- `dead`
- `stopped`

Meaning:
- `healthy` means PID is alive and heartbeat is recent
- `starting` means process exists but the agent loop is not ready yet
- `stale` means process exists but runtime state is too old
- `stalled` means startup has not completed and unread work is waiting
- `dead` means the PID is gone
- `stopped` means the teammate was intentionally stopped

### `process_shutdown_approved`
Remove a finished teammate from the team.

Parameters:
- `team_name` string
- `agent_name` string

## Messaging tools

### `send_message`
Send one message to one recipient.

Parameters:
- `team_name` string
- `recipient` string
- `content` string
- `summary` string

### `broadcast_message`
Send one message to all team members except the sender.

Parameters:
- `team_name` string
- `content` string
- `summary` string
- `color` string optional

### `read_inbox`
Read inbox messages.

Parameters:
- `team_name` string
- `agent_name` string optional
- `unread_only` boolean optional, default `true`

Bootstrap behavior:
- if a fresh teammate session has prior inbox history, its first inbox read replays the full inbox history for that teammate
- if there is no prior inbox history, the teammate skips inbox bootstrap and starts from its initial assignment
- after bootstrap, idle polling continues to use unread-only reads

## Task tools

### `task_create`
Create a task.

Parameters:
- `team_name` string
- `subject` string
- `description` string

### `task_read`
Read one task.

Parameters:
- `team_name` string
- `task_id` string

### `task_list`
List all tasks for a team.

Parameters:
- `team_name` string

### `task_update`
Update task status or owner.

Parameters:
- `team_name` string
- `task_id` string
- `status` one of `pending | planning | in_progress | completed | deleted` optional
- `owner` string optional

Hook behavior:
- when a task becomes `completed`, `.pi/team-hooks/task_completed.sh` is executed if present

### `task_submit_plan`
Submit a plan for a task.

Parameters:
- `team_name` string
- `task_id` string
- `plan` string

Behavior:
- sets task status to `planning`
- stores the submitted plan

### `task_evaluate_plan`
Approve or reject a submitted plan.

Parameters:
- `team_name` string
- `task_id` string
- `action` one of `approve | reject`
- `feedback` string optional and required for rejection

Behavior:
- approve: moves task to `in_progress` and clears feedback
- reject: keeps task in `planning` and stores `planFeedback`

## Template tools

### `list_predefined_teams`
List predefined team templates discovered from `teams.yaml` files.

### `list_predefined_agents`
List predefined agent definitions discovered from markdown files.

### `create_predefined_team`
Create a team from a predefined template and spawn each teammate.

Parameters:
- `team_name` string
- `predefined_team` string
- `cwd` string
- `default_model` string optional
- `separate_windows` boolean optional

### `save_team_as_template`
Save a runtime team as a reusable template.

Parameters:
- `team_name` string
- `template_name` string
- `description` string optional
- `scope` one of `user | project` optional

## Plan approval feature

Use `plan_mode_required: true` on `spawn_teammate` when you want implementation to pause for review first.

Flow:
1. teammate receives the task
2. teammate calls `task_submit_plan`
3. lead reviews the plan
4. lead calls `task_evaluate_plan`
5. approved work moves to `in_progress`

## Runtime and liveness

The extension treats PID plus runtime heartbeat as the source of truth.

Stored runtime fields include:
- `sessionId`
- `pid`
- `startedAt`
- `lastHeartbeatAt`
- `lastInboxReadAt`
- `bootstrapPending`
- `ready`
- `lastError`

Window or pane identifiers are used for cleanup only.

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
