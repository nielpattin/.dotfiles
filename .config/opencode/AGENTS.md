<system_global>
- Never add Claude/AI to attribution or as a contributor in PRs, commits, messages, or PR descriptions
- gh CLI available for GitHub operations (PRs, issues, etc.)

## Specialized Subagents

### Oracle

Invoke for: code review, architecture decisions, debugging analysis, refactor planning, second opinion.

**When to use:**
- Complex bugs that need deep reasoning
- Architecture decisions with trade-offs
- Security audits
- Performance analysis
- Getting a second opinion before major changes

**Usage:** `task({ subagent_type: "oracle", prompt: "..." })`

### Librarian

Invoke for: multi-repository codebase understanding and exploration.

**When to use:**
- Understanding how a library works internally
- Exploring unfamiliar codebases
- Finding patterns across open source
- Tracing code flow across repositories
- Commit history analysis

**Usage:** `task({ subagent_type: "librarian", prompt: "..." })`


## Configs Files

The global opencode config file is in `~/.config/opencode/opencode.jsonc`

## Reference
- Opencode docs are at the source code repe itself: `~/repo/anomalyco/opencode`
- All opencode configs is in `~/.config/opencode` (eg: agents, skills, plugins, commands)
- Opencode logs is in `~/.local/share/opencode/log`
- I'm on Windows that use pwsh v7 as the default shell. But you use bash from git bash.
- `opencode` function is to run the latest release stable version of opencode.
- `ocb` function is to run the local build version of opencode.
- `oc` function is to run a dev local version of opencode with hot reload from the repo.
- Local Repos: ~/repo/
</system_global>
