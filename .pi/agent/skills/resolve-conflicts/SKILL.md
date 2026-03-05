---
name: resolve-conflicts
description: Resolve Git merge conflicts by intelligently combining changes from both branches. Use when the user mentions merge conflicts. Follows a plan-first approach with structured resolution for imports, tests, lock files, configuration, and deleted-but-modified files.
license: MIT
compatibility: opencode
metadata:
  category: git
  workflow: merge
---

# Git Conflict Resolution

Resolve Git merge conflicts by intelligently combining changes from both branches while preserving the intent of both changes. This skill follows a plan-first approach: assess conflicts, create a detailed resolution plan, get approval, then execute.

## Core Principles

1. **Plan Before Executing**: Always create a structured resolution plan and get user approval before making changes
2. **Prefer Both Changes**: Default to keeping both changes unless they directly contradict
3. **Merge, Don't Choose**: Especially for imports, tests, and configuration
4. **Regenerate Generated Files**: Never manually merge generated files - always regenerate them from their sources
5. **Validate with Tests**: Always run tests after resolution
6. **Explain All Resolutions**: For each conflict resolved, provide a one-line explanation of the resolution strategy
7. **Ask When Unclear**: When the correct resolution isn't clear from the diff, present options to the user and ask for their choice

## Workflow

### Step 1: Assess the Conflict Situation

Run initial checks to understand the conflict scope:

```bash
git status
```

Identify and categorize all conflicted files:

- Regular file conflicts (both modified)
- Deleted-modified conflicts (one deleted, one modified)
- Generated file conflicts (lock files, build artifacts, generated code)
- Test file conflicts
- Import/configuration conflicts
- Binary file conflicts

For each conflicted file, gather information:

- File type and purpose
- Nature of the conflict (content, deletion, type change)
- Scope of changes (lines changed, sections affected)
- Whether the file is generated or hand-written

### Step 2: Create Merge Resolution Plan

Based on the assessment, create a structured plan before resolving any conflicts. Present the plan in the following markdown format:

```markdown
## Merge Resolution Plan

### Conflict Summary

- **Total conflicted files**: [N]
- **Deleted-modified conflicts**: [N]
- **Generated files**: [N]
- **Regular conflicts**: [N]

### Resolution Strategy by File

#### 1. [File Path]

**Conflict Type**: [deleted-modified / generated / imports / tests / code logic / config / struct / binary]
**Strategy**: [Brief description of resolution approach]
**Rationale**: [Why this strategy is appropriate]
**Risk**: [Low/Medium/High] - [Brief risk description]
**Action Items**:

- [ ] [Specific action 1]
- [ ] [Specific action 2]

### Execution Order

1. **Phase 1: Deleted-Modified Files** - Handle deletions and backups first
2. **Phase 2: Generated Files** - Regenerate from source
3. **Phase 3: Low-Risk Merges** - Imports, tests, documentation
4. **Phase 4: High-Risk Merges** - Code logic, configuration, structs
5. **Phase 5: Validation** - Compile, test, verify

### Questions/Decisions Needed

- [ ] **[File/Decision]**: [Question for user] (Options: 1, 2, 3)

### Validation Steps

- [ ] Compile project
- [ ] Run test suite
- [ ] Manual verification of high-risk changes
```

**Present this plan to the user** and wait for their approval before proceeding with resolution.

### Step 3: Handle Deleted-Modified Files

**Execute this phase only after the plan is approved.**

For deleted-but-modified files (status: DU, UD, DD, UA, AU):

1. Create timestamped backups of modified content
2. Analyze potential relocation targets
3. Decide whether to keep or delete the file
4. If keeping, apply modifications to the new location

```bash
# Check for deleted-modified conflicts
git status --porcelain | grep -E "^(DU|UD|DD|UA|AU)"

# Backup modified content before resolving
git show :2:path/to/file > path/to/file.backup.ours
git show :3:path/to/file > path/to/file.backup.theirs
```

### Step 4: Execute Resolution Plan

**Follow the execution order defined in your plan.** For each conflicted file, apply the appropriate resolution pattern. **For every conflict you resolve, provide a one-line explanation.**

#### When Resolution is Unclear

When you cannot determine the correct resolution from the diff alone:

1. **Present the conflict** to the user with the conflicting code from both sides
2. **Provide numbered options** for resolution
3. **Explain each option** clearly
4. **Ask the user to choose**
5. **Apply similar reasoning** to subsequent related conflicts

#### Resolution Patterns

##### Imports/Dependencies

**Goal**: Merge all unique imports from both branches.

1. Extract all imports from both sides
2. Remove duplicates
3. Group by module/package
4. Follow language-specific style (alphabetize, group std/external/internal)

**Explanation template**: "Merging imports by combining unique imports from both branches and grouping by module"

##### Tests

**Goal**: Include all test cases and test data from both branches.

1. Keep all test functions unless they test the exact same thing
2. Merge test fixtures and setup functions
3. Combine assertions from both sides
4. If test names conflict but test different behaviors, rename to clarify

**Explanation template**: "Including all test cases from both branches and combining test fixtures"

##### Generated Files

**Goal**: Regenerate any generated files to include changes from both branches.

A file is generated if it:
- Is produced by a build tool, compiler, or code generator
- Has a source file or configuration that defines it
- Contains headers/comments indicating it's auto-generated
- Common examples: lock files, protobuf outputs, GraphQL schema files

**Approach:**

1. Choose either version temporarily:
   ```bash
   git checkout --ours <generated-file>    # or --theirs
   ```

2. Regenerate from source:
   ```bash
   # Package manager lock files
   cargo update                       # for Cargo.lock
   npm install                        # for package-lock.json
   yarn install                       # for yarn.lock
   pnpm install                       # for pnpm-lock.yaml
   bundle install                     # for Gemfile.lock

   # Code generation
   npm run generate                   # for codegen scripts
   make generate                      # for Makefile-based generation
   ```

3. Stage the regenerated file:
   ```bash
   git add <generated-file>
   ```

**Explanation template**: "Regenerating [file] from source to include changes from both branches"

##### Configuration Files

**Goal**: Merge configuration values from both branches.

1. Include all keys from both sides
2. For conflicting values, choose based on:
   - Newer/more recent value
   - Safer/more conservative value
   - Production requirements
3. Document choice in commit message

**Explanation template**: "Merging all config keys and choosing [current/incoming] value for [key]"

##### Code Logic

**Goal**: Understand intent of both changes and combine if possible.

1. Analyze what each branch is trying to achieve
2. If changes are orthogonal (different concerns), merge both
3. If changes conflict (same concern, different approach):
   - Review commit messages for context
   - Choose the approach that matches requirements
   - Test both approaches if unclear

**Explanation template**: "Merging both changes as they address different concerns" OR "Choosing [current/incoming] approach for [reason]"

##### Struct/Type Definitions

**Goal**: Include all fields from both branches.

1. Merge all fields
2. If field types conflict, analyze which is more appropriate
3. Fix all compilation errors from updated struct
4. Update tests to use new fields

**Explanation template**: "Including all fields from both branches in struct definition"

### Step 5: Validate Resolution

After completing all resolution phases, validate that all conflicts are resolved:

```bash
# Check for remaining conflict markers
git diff --check

# Search for conflict markers
git grep -n "<<<<<<< HEAD"
git grep -n "======="
git grep -n ">>>>>>>"

# Check git status
git status
```

### Step 6: Compile and Test

Build and test to ensure the resolution is correct:

```bash
# Run appropriate test command for the project
cargo test          # Rust
npm test            # Node.js
pytest              # Python
go test ./...       # Go
```

If tests fail:

1. Review the failure - is it from merged code or conflict resolution?
2. Check if both branches' tests pass individually
3. Fix integration issues between the merged changes
4. Re-run tests until all pass

### Step 7: Finalize

Once all conflicts are resolved and tests pass, commit:

```bash
# Review the changes
git diff --cached

# Commit with descriptive message
git commit -m "Resolve merge conflicts: [describe key decisions]

Key decisions:
- [Decision 1]
- [Decision 2]
- [Decision 3]"
```

## Special Scenarios

### Binary Files in Conflict

Binary files cannot be merged. Choose one version:

```bash
git checkout --ours path/to/binary    # keep our version
# or
git checkout --theirs path/to/binary  # keep their version
```

### Mass Rename/Refactoring Conflicts

If one branch renamed/refactored many files while another modified them:

1. Accept the rename/refactoring (structural change)
2. Apply the modifications to the new structure
3. Use backups to guide the application

### Submodule Conflicts

```bash
# Check submodule status
git submodule status

# Update to the correct commit
cd path/to/submodule
git checkout <desired-commit>
cd ../..
git add path/to/submodule
```

## Troubleshooting

### "Both Added" Conflicts (AA)

Both branches added a new file with the same name but different content:

1. Review both versions
2. If they serve the same purpose, merge their content
3. If they serve different purposes, rename one

### Whitespace-Only Conflicts

If conflicts are only whitespace differences:

```bash
git merge -Xignore-space-change <branch>
```

### Persistent Conflict Markers

If validation shows conflict markers but you think you resolved them:

1. Search for the exact marker strings: `git grep -n "<<<<<<< HEAD"`
2. Some markers might be in strings or comments - resolve those too
3. Check for hidden characters or encoding issues

## Quick Reference

| Conflict Type    | Strategy                                | Explanation Template                                              |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Imports          | Merge all, deduplicate, group by module | "Merging imports by combining unique imports from both branches"  |
| Tests            | Keep all, merge fixtures                | "Including all test cases from both branches"                     |
| Generated files  | Regenerate from source                  | "Regenerating [file] from source"                                 |
| Config           | Merge keys, choose newer values         | "Merging all config keys and choosing [value] for [key]"          |
| Code logic       | Analyze intent, merge if orthogonal     | "Merging both changes" OR "Choosing [approach] for [reason]"      |
| Structs          | Include all fields                      | "Including all fields from both branches"                         |
| Deleted-modified | Backup, analyze, apply to new location  | "Applying modifications to new location"                          |
| Binary files     | Choose one version                      | "Keeping [current/incoming] version of binary file"               |
