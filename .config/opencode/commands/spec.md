---
description: Create a plan, get approval, then convert to Overseer tasks
---

Run a professional planning workflow with an approval gate.

Workflow:

1. Load the planner skill:

```javascript
skill({ name: "spec-planner" })
```

2. Create or update a plan file in Overseer-compatible format.
   - Default path: `docs/plans/<kebab-case-request>-plan.md`
   - First heading: `# Plan: <Title>`
   - Each implementation step must include `Done when: ...`

3. Show the user:
   - plan file path
   - concise plan summary (scope, structure, key risks)

4. Ask for approval before task conversion:
   - "Approve this plan? (yes/no)"

5. If user says **yes**:
   - Load conversion skill and convert plan into Overseer tasks:

```javascript
skill({ name: "overseer-plan" })
```

   - During review, keep analysis local-first (plan/repo/skills). Use web only for missing project-domain facts.

   - Return created root task/milestone ID and breakdown summary.

6. If user says **no** or provides feedback:
   - Refine the same plan file using the feedback.
   - Re-present summary and ask for approval again.
   - Do not create Overseer tasks until approved.

Constraints:
- Planning only until explicit approval.
- Do not implement product code.
- Keep responses concise and decision-oriented.

<user-request>
$ARGUMENTS
</user-request>
