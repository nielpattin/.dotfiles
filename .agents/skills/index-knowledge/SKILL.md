---
name: index-knowledge
description: Generate hierarchical AGENTS.md knowledge base for a codebase. Creates root + complexity-scored subdirectory documentation.
---

# index-knowledge

Generate hierarchical AGENTS.md files. Root + complexity-scored subdirectories.

## Usage

```
--create-new   # Read existing → remove all → regenerate from scratch
--max-depth=2  # Limit directory depth (default: 5)
```

Default: Update mode (modify existing + create new where warranted)

---

## Workflow (High-Level)

1. **Discovery + Analysis** (concurrent)
   - Launch parallel explore agents (multiple Task calls in one message)
   - Main session: bash structure + read existing AGENTS.md
2. **Score & Decide** - Determine AGENTS.md locations from merged findings
3. **Generate** - Root first, then subdirs in parallel
4. **Review** - Deduplicate, trim, validate

---

## Phase 1: Discovery + Analysis (Concurrent)

### Launch Parallel Explore Agents

Multiple Task calls in a single message execute in parallel:

```
Task(description="project structure", subagent_type="explore",
  prompt="Project structure: PREDICT standard patterns → REPORT deviations only")

Task(description="entry points", subagent_type="explore",
  prompt="Entry points: FIND main files → REPORT non-standard organization")

Task(description="conventions", subagent_type="explore",
  prompt="Conventions: FIND config files → REPORT project-specific rules")

Task(description="anti-patterns", subagent_type="explore",
  prompt="Anti-patterns: FIND 'DO NOT', 'NEVER', 'ALWAYS' comments → LIST forbidden patterns")
```

### Main Session: Concurrent Analysis

**While Task agents execute**, main session does:

```bash
# Directory depth + file counts
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' | head -30

# Files per directory (top 30)
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Existing AGENTS.md / CLAUDE.md
find . -type f \( -name "AGENTS.md" -o -name "CLAUDE.md" \) -not -path '*/node_modules/*' 2>/dev/null
```

---

## Phase 2: Scoring & Location Decision

### Scoring Matrix

| Factor | Weight | High Threshold |
|--------|--------|----------------|
| File count | 3x | >20 |
| Subdir count | 2x | >5 |
| Code ratio | 2x | >70% |
| Unique patterns | 1x | Has own config |
| Module boundary | 2x | Has index.ts/__init__.py |

### Decision Rules

| Score | Action |
|-------|--------|
| **Root (.)** | ALWAYS create |
| **>15** | Create AGENTS.md |
| **8-15** | Create if distinct domain |
| **<8** | Skip (parent covers) |

---

## Phase 3: Generate AGENTS.md

### Root AGENTS.md Template

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}

## OVERVIEW
{1-2 sentences: what + core stack}

## STRUCTURE
{root}/
├── {dir}/    # {non-obvious purpose only}
└── {entry}

## WHERE TO LOOK
| Task | Location | Notes |

## CONVENTIONS
{ONLY deviations from standard}

## ANTI-PATTERNS (THIS PROJECT)
{Explicitly forbidden here}

## COMMANDS
{dev/test/build}
```

**Quality gates**: 50-150 lines, no generic advice, no obvious info.

### Subdirectory AGENTS.md (Parallel)

Launch general agents for each location in ONE message:

```
Task(description="AGENTS.md for src/hooks", subagent_type="general",
  prompt="Generate AGENTS.md for: src/hooks - 30-80 lines max - NEVER repeat parent")
```

---

## Phase 4: Review & Deduplicate

For each generated file:
- Remove generic advice
- Remove parent duplicates
- Trim to size limits
- Verify telegraphic style

---

## Anti-Patterns

- **Sequential execution**: MUST parallel (multiple Task calls in one message)
- **Ignoring existing**: ALWAYS read existing first
- **Over-documenting**: Not every dir needs AGENTS.md
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects
- **Verbose style**: Telegraphic or die
