---
name: tracer-bullet
description: Design large project architecture with thin end-to-end slices. Use for greenfield projects or major rewrites requiring 3000+ lines. Creates executable slices that prove architecture works before heavy investment.
---

# Tracer Bullet Development

Build a thin, functional slice touching all layers before adding features.

From *The Pragmatic Programmer*: Fire tracer bullets to see where they land, then adjust aim. Unlike prototypes, tracer code is production-quality and stays in the codebase.

## When to Use

- Greenfield projects (new codebase from scratch)
- Major rewrites or migrations
- Projects estimated at 3000+ lines
- High uncertainty about architecture decisions
- Multiple integration points to validate

## When NOT to Use

- Single feature additions → use `/prd` instead
- Small bug fixes or refactors
- Well-understood, low-risk changes

## Workflow

### Phase 1: Discovery

**Greenfield:**
- Define target technology stack
- Identify external dependencies
- Sketch initial layer boundaries

**Existing Codebase:**
- Explore with parallel agents (like index-knowledge)
- Map existing layers and patterns
- Identify integration points

### Phase 2: Architecture Design (Interactive)

Ask clarifying questions one at a time:

**System Boundaries**
- What are the system inputs/outputs?
- Who/what consumes this system?

**Layer Decisions**
- What layers does this system need?
- What technology for each layer?

**Integration Points**
- What external services/APIs?
- What data stores?

**Risks**
- What's the riskiest technical decision?
- What has the team never done before?

Present architecture in sections (200-300 words each), validate incrementally.

### Phase 3: Slice Planning

Define thin end-to-end slices ordered by:

1. **Infrastructure** - Build, deploy, layers connect (always first)
2. **Highest Risk** - Validate uncertain decisions early
3. **Core Domain** - Primary business entity flow
4. **Integration** - Third-party connections
5. **Secondary Features** - Build on proven foundation

Each slice must:
- Touch ALL layers minimally
- Be verifiable independently
- Produce working code (not stubs)
- Estimate 200-500 lines

### Phase 4: Output

Create state directory:

```
.opencode/state/tracer-<name>/
├── architecture.md    # Architecture document
├── tracer.json        # Executable slices
└── progress.txt       # Cross-iteration memory
```

## Output Formats

### tracer.json Schema

```json
{
  "projectName": "<name>",
  "type": "tracer-bullet",
  "stack": { "frontend": "...", "api": "...", "database": "..." },
  "layers": [
    { "id": "frontend", "name": "...", "entryPoint": "...", "technology": "..." }
  ],
  "slices": [
    {
      "id": "slice-1",
      "name": "Hello World E2E",
      "description": "Minimal path proving all layers connect",
      "priority": 1,
      "risk": "high",
      "category": "infrastructure",
      "touchesLayers": ["frontend", "api", "service", "data"],
      "tasks": ["..."],
      "verification": ["..."],
      "estimatedLines": "200-300",
      "passes": false
    }
  ],
  "context": { "patterns": [], "keyFiles": [], "nonGoals": [] }
}
```

### architecture.md Template

See `./reference/architecture-template.md` for full template.

## Integration with Existing Workflow

After tracer bullet creation:

```
/complete-next-task tracer-<name>
```

The `complete-next-task` command works with tracer.json because:
- `slices[].tasks` maps to verification steps
- `slices[].passes` tracks completion
- State folder structure is identical

## Slice Execution Rules

When executing slices via `complete-next-task`:

1. Read `progress.txt` for context from previous slices
2. Implement ALL tasks in the slice
3. Run verification steps
4. Update `passes: true` when ALL verifications pass
5. Append learnings to `progress.txt`
6. Commit with: `feat(<layer>): <slice-name>`

## Reference Files

Read these for detailed guidance:

| File | When to Read |
|------|--------------|
| `./reference/architecture-template.md` | Creating architecture.md |
| `./reference/slice-patterns.md` | Planning slices by project type |
| `./reference/layer-catalog.md` | Defining layers and boundaries |

## After Completion

When all slices have `passes: true`:

```
tracer-<name> COMPLETE

Architecture validated. Skeleton is production-ready.
Continue with feature PRDs or extend slices.
```

## Key Principles

- **Thin over complete**: Minimal code proving connections
- **Risk-first**: Validate unknowns before building features
- **Production-quality**: No throwaway code, no stubs
- **All layers**: Every slice must touch every layer
- **Verifiable**: Each slice has testable acceptance criteria
