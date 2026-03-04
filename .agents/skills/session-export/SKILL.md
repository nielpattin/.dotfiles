---
name: session-export
description: Update GitHub PR or GitLab MR descriptions with AI session export summaries. Use when user asks to add session summary to PR/MR, document AI assistance, or export conversation summary.
---

# Session Export

Update PR/MR descriptions with a structured summary of the AI-assisted conversation.

## Output Format

```markdown
> [!NOTE]
> This PR was written with AI assistance.

<details><summary>AI Session Export</summary>
<p>

```json
{
  "info": {
    "title": "<brief task description>",
    "agent": "opencode",
    "models": ["<model(s) used>"]
  },
  "summary": [
    "<action 1>",
    "<action 2>"
  ]
}
```

</p>
</details>
```

## Workflow

### 1. Export Session Data

Get session data using OpenCode CLI:

```bash
opencode export [sessionID]
```

Returns JSON with session info including models used.

### 2. Generate Summary JSON

- **title**: 2-5 word task description (lowercase)
- **agent**: always "opencode"
- **models**: array from export data
- **summary**: array of terse action statements
  - Use past tense ("added", "fixed", "created")
  - Start with "user requested..." or "user asked..."
  - Chronological order
  - Max 25 turns
  - **NEVER include sensitive data**: API keys, secrets, passwords

### 3. Update PR/MR Description

**GitHub:**
```bash
# Get existing description
EXISTING=$(gh pr view <PR_NUMBER> --json body -q '.body')

# Update with session export appended
gh pr edit <PR_NUMBER> --body "$EXISTING

> [!NOTE]
> This PR was written with AI assistance.

<details><summary>AI Session Export</summary>
...
</details>"
```

**GitLab:**
```bash
# Get existing description
EXISTING=$(glab mr view <MR_NUMBER> --output json | jq -r '.description')

# Update
glab mr update <MR_NUMBER> --description "$EXISTING

> [!NOTE]
> This MR was written with AI assistance.
..."
```

### 4. Preserve Existing Content

Always fetch and preserve existing PR/MR description. Append session export after existing content.

## Example Summary

```json
{
  "info": {
    "title": "dark mode implementation",
    "agent": "opencode",
    "models": ["claude sonnet 4"]
  },
  "summary": [
    "user requested dark mode toggle in settings",
    "agent explored existing theme system",
    "agent created ThemeContext for state management",
    "agent added DarkModeToggle component",
    "agent ran tests and fixed 2 failures",
    "agent committed changes"
  ]
}
```

## Security

**NEVER include in summary:**
- API keys, tokens, secrets
- Passwords, credentials
- Environment variable values
- Private URLs with auth tokens
- Personal identifiable information
