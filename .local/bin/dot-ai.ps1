param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraInstructions
)

if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
    Write-Error "pi CLI not found in PATH."
    exit 1
}

$prompt = @"
You are committing changes for a bare dotfiles repository.

Repository setup:
- GIT_DIR: $HOME/.dotfiles
- GIT_WORK_TREE: $HOME
- Treat: `--git-dir="$HOME/.dotfiles" --work-tree="$HOME"` as the prefix for all git commands.
- Use -f when adding files to staged.
- Use `git <prefix> ls-files --others --exclude-standard` to show untracked files.

Do the following workflow exactly. DO NOT run cd. Always use the git prefix.

```bash
# 1) Inspect current state
git <prefix> status --porcelain
git <prefix> ls-files --others --exclude-standard

# 2) If there are no staged changes, report "Nothing to commit" and stop without error
git <prefix> --no-pager diff --cached --name-status

# 3) Analyze staged changes file-by-file before staging any new commit chunk
git <prefix> --no-pager diff --cached <file>

# 4) MANDATORY split plan
#    - Build a commit plan first.
#    - Plan must contain 2+ commits whenever there are unrelated changes (different feature areas, config vs code, refactor vs behavior change, rename/move vs logic changes).
#    - NEVER commit everything in one commit when multiple logical groups exist.

# 5) Stage only one logical group at a time
git <prefix> reset
git <prefix> add -f <files-for-group-1>
git <prefix> --no-pager diff --cached --name-status
git <prefix> --no-pager diff --cached <each-file-in-group-1>

# 6) Commit that one logical group
git <prefix> commit -m "<conventional-commit>" -m "<single-paragraph body>"

# 7) Repeat reset/add/diff/commit for remaining logical groups until clean
git <prefix> reset
git <prefix> add -f <files-for-group-2>
...

# 8) Final check
git <prefix> status --porcelain
```

Rules:
- Follow Conventional Commits: type(optional-scope): short summary
- Keep summary concise and specific
- Commit body must be one paragraph and explain what changed and why
- If there is nothing to commit, report that and stop without error
- Do not create one giant commit when there are multiple logical changes
- If you choose a single commit, explicitly justify why all changes are one inseparable logical unit
- Do not include untracked files unless explicitly requested

Required response format:

Summary of changes:
- 
Conventional Commit messages:
- 
Command run:
- 
"@

if ($ExtraInstructions.Count -gt 0) {
    $prompt += "`n`nAdditional user instructions:`n" + ($ExtraInstructions -join ' ')
}

$env:GIT_DIR = "$HOME/.dotfiles"
$env:GIT_WORK_TREE = "$HOME"

Push-Location $HOME
try {
    pi --thinking medium --tools "read,bash" --provider openai-codex --model gpt-5.3-codex --no-extensions --no-prompt-templates --no-skills $prompt
}
finally {
    Pop-Location
    Remove-Item Env:GIT_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:GIT_WORK_TREE -ErrorAction SilentlyContinue
}
