---
name: roadmap
description: Create complete product roadmap with all features. Use AFTER /tracer skeleton is done, BEFORE individual /prd commands. Defines all features upfront with priorities, dependencies, and versions.
---

# Product Roadmap

Define ALL features for a product upfront, so you never have to improvise.

## When to Use

- After `/tracer` skeleton is complete
- Before any `/prd` for individual features
- When you want to plan the entire product scope
- To add new features to existing roadmap (`--add` flag)

## When NOT to Use

- No architecture yet → use `/tracer` first
- Planning a single feature → use `/prd` directly

## Workflow

### Phase 1: Context Gathering

Check for existing context:
- Read `.opencode/state/tracer-<project>/architecture.md` if exists
- Understand system boundaries and layers
- If no tracer exists, ask about the project

### Phase 1b: Project Type Detection

Ask: "What type of project is this?"
- SaaS Web Application
- REST API / Backend Service
- CLI Tool
- E-Commerce Platform
- Mobile App
- Other (custom)

If matches a template from `./reference/project-templates.md`:
1. Offer: "I have a template for [type]. Use it as a starting point?"
2. If yes, load template features for review
3. Let user check/uncheck applicable features
4. Add project-specific features on top

### Phase 2: Vision & Personas

Ask one question at a time:

**Vision:**
- "What does this product do in one sentence?"
- "What problem does it solve?"
- "What does success look like?"

**Personas:**
- "Who uses this product?"
- For each persona: "What do they need to accomplish?"

### Phase 3: Feature Elicitation (Systematic)

Use `./reference/elicitation-questions.md` for comprehensive coverage.

For each persona, map their journey:
1. "What's the first thing they do?"
2. "Then what?" (repeat)
3. "What features enable each step?"

Cover system-level features:
- Admin/management
- Integrations
- Security/compliance

### Phase 4: Prioritization & Grouping

Group features into versions:
- **MVP**: Must ship for launch
- **v1.1**: Soon after launch
- **v2**: Future major version
- **Backlog**: Someday/maybe

For each feature, capture:
- ID: `F1`, `F2`, etc.
- Name: Short descriptive name
- Description: One sentence
- Size: S / M / L / XL
- Dependencies: Which features must come first
- Status: `planned` (default)

See `./reference/prioritization-frameworks.md` for techniques.

### Phase 5: Output

Create state directory with roadmap and notes:

```
.opencode/state/<project>/
├── roadmap.md     # Feature roadmap
└── notes.md       # Feature log and learnings
```

See `./reference/roadmap-template.md` for roadmap format.
See `./reference/notes-template.md` for notes format.

Notes file is automatically updated by `/complete-next-task` with start/completion dates.

## Adding Features Later

When user runs `/roadmap <project> --add`:

1. Read existing `.opencode/state/<project>/roadmap.md`
2. Ask about new features to add
3. Assign next available ID (F5, F6, etc.)
4. Determine version and dependencies
5. Update roadmap.md

## Status Tracking

Features have status that updates automatically:

| Status        | Set By                                 |
|---------------|----------------------------------------|
| `planned`     | `/roadmap` (default)                   |
| `prd`         | `/prd <project>/<feature-id>`          |
| `in-progress` | `/complete-next-task` (first task)     |
| `done`        | `/complete-next-task` (all tasks pass) |
| `cut`         | Manual edit                            |

## Integration with /prd

When user runs `/prd <project>/F3`:

1. Read `.opencode/state/<project>/roadmap.md`
2. Find feature F3
3. Pre-populate PRD with:
   - Feature name
   - Description
   - Dependencies
   - Size context
4. After PRD created, update roadmap status to `prd`

## After Roadmap Creation

Tell the user:

```
Roadmap saved to .opencode/state/<project>/roadmap.md
Notes file created: .opencode/state/<project>/notes.md

Features: X total
  MVP: Y features
  v1.1: Z features
  v2: W features
  Backlog: V features

Next steps:
  /roadmap-status <project>    # Check progress
  /roadmap-diagram <project>   # Generate visual diagram
  /prd <project>/F1            # Start building
```

## Key Principles

- **Complete over perfect**: Capture all features, refine later
- **Systematic elicitation**: Use question frameworks, don't improvise
- **Dependencies matter**: Order affects what you can build when
- **Status is automatic**: Roadmap updates as you progress
- **Use templates**: Start with project-type templates when available

## Reference Files

| File | Purpose |
|------|---------|
| `./reference/roadmap-template.md` | Full roadmap markdown template |
| `./reference/notes-template.md` | Feature log and learnings template |
| `./reference/elicitation-questions.md` | Systematic question bank |
| `./reference/prioritization-frameworks.md` | MoSCoW, RICE, sizing |
| `./reference/project-templates.md` | Pre-built feature lists by project type |
