---
name: skill-creator
description: Guide for creating effective skills. Use when users want to create a new skill or update an existing skill that extends agent capabilities with specialized knowledge, workflows, or tool integrations.
---

# Skill Creator

This skill provides guidance for creating effective skills.

> **CRITICAL: YAML FRONTMATTER REQUIRED**
> Every SKILL.md **MUST** begin with YAML frontmatter on line 1.
> ```yaml
> ---
> name: skill-name
> description: One-line description
> ---
> ```

## About Skills

Skills are modular packages that extend an agent's capabilities by providing specialized knowledge, workflows, and tools.

### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/      - Executable code
    ├── references/   - Documentation
    └── assets/       - Templates, icons
```

### Requirements

- `SKILL.md` should be **<200 lines**
- Each script/reference file also **<200 lines**
- Use **progressive disclosure** - split into multiple files
- Prefer nodejs/python scripts over bash (Windows compatibility)

## Skill Creation Process

### Step 1: Understand with Concrete Examples

Ask questions like:
- "What functionality should this skill support?"
- "Can you give examples of how it would be used?"
- "What would trigger this skill?"

### Step 2: Plan Reusable Contents

For each example, identify:
- Scripts for repetitive code
- References for documentation
- Assets for templates

### Step 3: Initialize the Skill

Create the directory structure:

```bash
mkdir -p skill-name/{scripts,references,assets}
touch skill-name/SKILL.md
```

### Step 4: Edit the Skill

**Writing Style:** Use **imperative/infinitive form** (verb-first), not second person.

Answer these questions:
1. What is the purpose?
2. When should it be used?
3. How should the agent use it?

### Step 5: Validate

Before packaging, verify:
- [ ] SKILL.md starts with `---` (line 1)
- [ ] `name:` field present, matches directory
- [ ] `description:` field present with triggers
- [ ] Closing `---` after frontmatter
- [ ] No XML-style tags
- [ ] Under 200 lines
- [ ] All referenced files exist

## SKILL.md Template

```markdown
---
name: my-skill
description: What this skill does and when to use it.
---

# Skill Name

Brief overview.

## When to Use

- Trigger condition 1
- Trigger condition 2

## Workflow

1. Step one
2. Step two

## References

- `./references/guide.md` - Detailed guide
- `./scripts/helper.py` - Helper script
```

## Progressive Disclosure

1. **Metadata** - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words)
3. **Bundled resources** - As needed (unlimited)

## Anti-Patterns

- XML-style tags (`<purpose>`, `<references>`)
- Missing frontmatter delimiters
- Frontmatter not at line 1
- Overly long SKILL.md (>200 lines)
- Duplicating info in SKILL.md and references
