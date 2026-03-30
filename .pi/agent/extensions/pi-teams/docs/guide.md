# pi-teams guide

Usage guide for the local `pi-teams` extension in this repo.

## Requirements

- Windows
- Windows Terminal
- `pi` available in PATH for the spawned sessions

## Basic workflow

1. Open `pi` inside Windows Terminal.
2. Create a team.
3. Spawn one or more teammates.
4. Create tasks or send messages.
5. Stop or resume the team later.

## Example

Create a team:

```text
Create a team named 'code-review'
```

Spawn a reviewer:

```text
Spawn a teammate named 'reviewer' in the current folder and tell them to inspect the extension runtime
```

Create a task:

```text
Create a task for reviewer: 'Review runtime heartbeat and inbox behavior'
```

Check teammate status:

```text
Check teammate 'reviewer'
```

Stop and resume:

```text
Stop team 'code-review'
Resume team 'code-review'
```

## Plan approval workflow

Use this when you want a checkpoint before code changes.

Spawn with plan mode:

```text
Spawn a teammate named 'refactor-bot' and require plan approval before they make any changes
```

Expected flow:
- teammate gets the task
- teammate submits a plan with `task_submit_plan`
- lead reviews with `task_evaluate_plan`
- approval moves work to `in_progress`
- rejection keeps the task in `planning` and stores feedback

## Messaging behavior

### Normal polling

Idle teammates are woken by unread messages.

### First inbox read in a fresh session

A resumed or respawned teammate does not remember earlier conversation state. If that new session already has inbox history, its first inbox read replays the full inbox history for that teammate. If there is no inbox history yet, it starts from its initial assignment and skips inbox bootstrap.

After that bootstrap read, normal unread-only polling continues.

## Team resume behavior

`team_resume` respawns teammates that are:
- stopped
- dead
- stale

Teammates that are already healthy or still starting are left alone.

## Health states

`check_teammate` can report:
- `healthy`
- `starting`
- `stale`
- `stalled`
- `dead`
- `stopped`

Interpretation:
- `healthy` means the PID is alive and the heartbeat is fresh
- `starting` means the process exists but the agent loop is not ready yet
- `stale` means the process exists but runtime state is too old
- `stalled` means startup has not completed and unread work is waiting
- `dead` means the process exited
- `stopped` means the team intentionally shut it down

## Hooks

When a task moves to `completed`, the extension runs:

```text
.pi/team-hooks/task_completed.sh
```

The task JSON is passed as the first argument.

## Troubleshooting

### No terminal adapter detected

Run the lead session from Windows Terminal.

### Resumed teammate looks out of sync

If that new session has prior inbox history, its first inbox read should replay the full inbox. If it does not, check the runtime file in:

```text
~/.pi/teams/<team-name>/runtime/<agent>.json
```

### Team says a teammate is dead or stale

Check:
- `~/.pi/teams/<team-name>/<agent>.pid`
- `~/.pi/teams/<team-name>/runtime/<agent>.json`

Liveness is based on PID and heartbeat, not pane id strings.
