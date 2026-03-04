---
name: prd
description: Create Product Requirements Documents (PRDs) that define the end state of a feature. Use when planning new features, migrations, or refactors. Generates structured PRDs with acceptance criteria.
---

# PRD Creation Skill

Create Product Requirements Documents suitable for RFC review.

The PRD describes WHAT to build and WHY, not HOW or in WHAT ORDER.

## Workflow

### Check for Roadmap Feature Reference

If argument matches `<project>/<feature-id>` pattern (e.g., `my-app/F3`):

1. Read `.opencode/state/<project>/roadmap.md`
2. Parse feature tables to find matching ID
3. Extract: name, description, size, dependencies
4. **Validate dependencies** (see below)
5. Pre-populate PRD context
6. Ask fewer questions (basics already known)
7. Save to `.opencode/state/<project>-<feature-id>/prd.md`
8. Update roadmap: set feature status to `prd`

### Dependency Validation (Step 4)

Before creating PRD, check if dependencies are complete:

1. Parse the `Dependencies` column for this feature (e.g., "F1, F2")
2. For each dependency, find its status in the roadmap
3. If ANY dependency is NOT `done`:

```
⚠️  DEPENDENCY WARNING

Feature F5 depends on:
  - F2 (User Login): done ✓
  - F3 (Core CRUD): in-progress ⚠️

F3 is not complete. Building F5 now may cause:
  - Rework if F3 changes
  - Blocked integration points
  - Wasted effort

Options:
  1. Continue anyway (risky)
  2. Work on F3 first (recommended)
  3. Cancel

What would you like to do?
```

4. If user chooses to continue, proceed with warning noted
5. If all dependencies are `done`, proceed without warning

### Standard Workflow

1. User requests: "Create a PRD for [feature]"
2. **Ask clarifying questions** to build full understanding
3. **Explore codebase** to understand patterns, constraints, dependencies
4. Generate markdown PRD to `prd-<feature-name>.md` in project root

## Clarifying Questions

Ask across these domains (5-7 max):

### Problem & Motivation
- What problem does this solve? Who experiences it?
- What's the cost of NOT solving this?
- Why now?

### End State & Success
- What does "done" look like?
- How will users interact with it?

### Scope & Boundaries
- What's explicitly OUT of scope?
- What's deferred to future iterations?

### Constraints
- Performance/security/compatibility requirements?

### Risks
- What could go wrong? Technical risks?
- External dependencies?

## Output Format

Save to `prd-<feature-name>.md`:

```markdown
# PRD: <Feature Name>

**Date:** <YYYY-MM-DD>

---

## Problem Statement

### What problem are we solving?
Clear description with user/business impact.

### Why now?
What triggered this work?

### Who is affected?
- **Primary users:** Description
- **Secondary users:** Description

---

## Proposed Solution

### Overview
One paragraph describing the feature when complete.

### User Experience (if applicable)
User flows for primary scenarios.

---

## End State

When complete:
- [ ] Capability 1 exists and works
- [ ] All acceptance criteria pass
- [ ] Tests cover new functionality

---

## Acceptance Criteria

### Feature: <Name>
- [ ] Criterion 1
- [ ] Criterion 2

---

## Technical Context

### Existing Patterns
- Pattern: `src/path/example.ts` - Why relevant

### Key Files
- `src/relevant/file.ts` - Description

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Risk 1 | High/Med/Low | High/Med/Low | Strategy |

---

## Non-Goals (v1)

- Thing we're not building - why deferred

---

## Open Questions

| Question | Owner | Status |
|----------|-------|--------|
| Question 1 | Name | Open |
```

## Key Principles

- **Problem Before Solution**: Lead with the problem
- **Define End State, Not Process**: Don't prescribe implementation order
- **Technical Context Enables Autonomy**: Show patterns to follow
- **Non-Goals Prevent Scope Creep**: Explicit boundaries

## After PRD Creation

### If From Roadmap

Tell the user:

```
PRD saved to .opencode/state/<project>-<feature-id>/prd.md
Roadmap updated: <feature-id> status → prd

To convert to executable tasks:
  /prd-task <project>-<feature-id>
```

### If Standalone

Tell the user:

```
PRD saved to prd-<name>.md

To convert to executable tasks:
  /prd-task <name>
```
