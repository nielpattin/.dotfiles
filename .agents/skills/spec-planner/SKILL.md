---
name: spec-planner
description: Dialogue-driven spec development through skeptical questioning and iterative refinement, adapted for Overseer plan-to-task workflows.
license: MIT
metadata:
  author: niel
  version: "1.2.0"
---

# Spec Planner (Overseer Mode)

Produce implementation-ready specs through dialogue, discovery, and honest trade-off analysis.

This skill creates planning artifacts only. It does not implement code.

## Core Philosophy

- Dialogue over deliverables
- Skeptical by default
- Second-order thinking (maintenance and downstream impact)
- Plans must be conversion-ready for `/overseer-plan`

## Workflow Phases

```
CLARIFY -> DISCOVER -> DRAFT -> REFINE -> HANDOFF
   ^                                      |
   |---------- gaps found ----------------|
```

## Workflow

### Phase 1: Clarify

Before drafting, resolve unknowns that materially change approach.

Focus on:
- scope boundaries
- motivation and expected outcome
- technical and rollout constraints
- success criteria and non-goals

Ask targeted clarifying questions when ambiguity would change design. If repo context makes defaults obvious, proceed.

Good categories to probe:

| Category | Example |
|----------|---------|
| Scope | "Which user roles are included in v1?" |
| Constraints | "Must this preserve current API response shape?" |
| Success | "What user-visible behavior proves this is done?" |
| Risk | "Any migration/rollback requirements for release?" |

### Phase 2: Discover

Inspect relevant code areas and existing patterns:
- similar feature implementations
- integration points and dependencies
- data/API boundaries
- testing patterns

If unfamiliar technology is central to the request, consult Librarian before proposing the final shape.

### Phase 3: Draft

Choose structure based on complexity:
- **No breakdown**: 1-2 cohesive steps
- **With breakdown**: 3-7 implementation steps
- **Epic-level**: phased sections with sub-items

Use this planning sequence:
1. Problem definition
2. Constraints inventory
3. Solution options (simple, balanced, full)
4. Trade-off summary
5. Recommended approach

Every step must be atomic and committable, with clear dependency ordering.

Overseer conversion contract:
- First heading: `# Plan: <Feature Title>`
- Every implementation step includes: `Done when: <observable verification criteria>`
- Include concrete files/modules and validation strategy

### Phase 4: Refine

Run completeness checks before handoff:

| Criterion | Check |
|-----------|-------|
| Scope bounded | Deliverables and non-goals are explicit |
| Ambiguity resolved | No unresolved "TBD" for core behavior |
| Acceptance testable | `Done when:` is pass/fail and observable |
| Dependencies ordered | Execution sequence is clear |
| Verification concrete | Automated + manual checks listed |
| Risks captured | At least 2 practical risks with mitigation |
| Rollback defined | Safe revert path exists |

If any criterion fails, revise the plan before presenting it.

### Phase 5: Handoff

Return concise summary for approval gate:
- plan file path
- selected structure (`no breakdown` | `with breakdown` | `epic-level`)
- 3-5 bullet summary of scope, major steps, and risks

Do not convert to tasks in this skill. Conversion happens only after user approval via `/overseer-plan`.

## Overseer Compatibility Contract (Hard Requirements)

1. First heading must be exactly:

```markdown
# Plan: <Feature Title>
```

2. Every implementation step must contain:

```markdown
Done when: <observable verification criteria>
```

3. Include concrete technical details:
- file paths/modules
- data/API changes (if applicable)
- dependency ordering and blockers

4. Include verification plan:
- automated checks (tests/build/typecheck)
- manual scenarios

## Default Output Path

If user does not provide a path:
`docs/plans/<kebab-case-request>-plan.md`

If refining, update the same file by default.

## Recommended Plan Template

```markdown
# Plan: <Feature Title>

**Generated**: <YYYY-MM-DD>
**Complexity**: <Low|Medium|High>

## Overview
<What we are building and why>

## Scope
- In scope: ...
- Out of scope: ...

## Constraints
- <technical, compatibility, security, performance constraints>

## Implementation
1. <Step title>
   - Files/Areas: <paths>
   - Details: <approach>
   - Done when: <objective criteria>

2. <Step title>
   - Files/Areas: <paths>
   - Details: <approach>
   - Done when: <objective criteria>

## Verification
- Automated: <commands/tests>
- Manual: <scenarios>

## Risks and Mitigations
- <risk> -> <mitigation>

## Rollback
- <how to revert safely>
```

## Writing Standards

- Use imperative step names (`Add`, `Implement`, `Refactor`, `Validate`)
- Avoid vague wording (`improve`, `etc.`)
- Keep each step independently testable
- Prefer explicit file paths to generic component names
- Keep prose concise and operational

## Final Output Format

When done, return:

```
=== Plan Ready for Approval ===

Plan file: <path>
Structure: <no breakdown | with breakdown | epic-level>

Summary:
- <scope>
- <major implementation direction>
- <verification highlights>
- <key risks>
```
