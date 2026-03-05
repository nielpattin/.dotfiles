---
name: prd-task
description: Convert markdown PRDs to executable JSON format. Use after creating a PRD with the prd skill to generate the prd.json for autonomous task completion.
---

# PRD Task Skill

Convert markdown PRDs to executable JSON format for autonomous task completion.

The PRD defines the **end state** via tasks with verification steps. The agent decides HOW to get there.

## Workflow

1. User requests: "Convert prd-<name>.md"
2. Read the markdown PRD
3. Extract tasks with verification steps
4. Create `.opencode/state/<prd-name>/` directory
5. Move markdown PRD to `.opencode/state/<prd-name>/prd.md`
6. Output JSON to `.opencode/state/<prd-name>/prd.json`
7. Create empty `.opencode/state/<prd-name>/progress.txt`

State folder structure:

```
.opencode/state/<prd-name>/
├── prd.md       # Original markdown PRD (moved)
├── prd.json     # Converted JSON for task execution
└── progress.txt # Empty file to track progress
```

## Input Format

Expects markdown PRD with tasks:

```markdown
# PRD: <Feature Name>

## Tasks

### User Registration [functional]
User can register with email and password.

**Verification:**
- POST /api/auth/register with valid email/password
- Verify 201 response with user object
- Attempt duplicate email, verify 409
```

## Output Format

```json
{
  "prdName": "<prd-name>",
  "tasks": [
    {
      "id": "functional-1",
      "category": "functional",
      "description": "User can register with email and password",
      "steps": [
        "POST /api/auth/register with valid email/password",
        "Verify 201 response with user object",
        "Attempt duplicate email, verify 409"
      ],
      "passes": false
    }
  ],
  "context": {
    "patterns": ["API routes: src/routes/items.ts"],
    "keyFiles": ["src/db/schema.ts"],
    "nonGoals": ["OAuth/social login"]
  }
}
```

## Schema Details

### Task Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | e.g. "db-1", "api-auth" |
| `category` | string | "functional", "ui", "api", etc. |
| `description` | string | What the task does when complete |
| `steps` | string[] | **Verification steps** - how to test |
| `passes` | boolean | Set `true` when ALL steps verified |

## Conversion Rules

### Task Sizing
- One logical change per task
- Split large sections into multiple tasks
- Each task completable in one commit

### Tasks from Markdown
- Each `### Title [category]` becomes a task
- Generate `id` as `<category>-<number>`
- Text after title is the `description`
- Items under `**Verification:**` become `steps`
- `passes` always starts as `false`

## Field Rules

**READ-ONLY except:**
- `passes`: Set to `true` when ALL verification steps pass

**NEVER edit or remove tasks**

## After Conversion

Tell the user:

```
PRD converted to .opencode/state/<prd-name>/
  - prd.md (moved)
  - prd.json (generated)
  - progress.txt (empty)

Tasks: X total

To complete tasks:
  /complete-next-task <prd-name>
```
