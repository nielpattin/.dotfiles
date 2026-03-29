# dot-ai usage examples:
#   dot-ai "only commit nvim changes"
#   dot-ai "only commit nvim changes" -- --model anthropic/claude-sonnet-4 --thinking high
#   dot-ai -- --provider openai-codex --model gpt-5.3-codex
#
# Rules:
#   - args before `--` become extra instructions added to the prompt
#   - args after `--` are passed directly to `pi`

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RawArgs
)

if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
    Write-Error "pi CLI not found in PATH."
    exit 1
}

if ($null -eq $RawArgs) {
    $RawArgs = @()
}

$Instructions = @()
$PiArgs = @()
$separatorIndex = [System.Array]::IndexOf($RawArgs, '--')

if ($separatorIndex -ge 0) {
    if ($separatorIndex -gt 0) {
        $Instructions = $RawArgs[0..($separatorIndex - 1)]
    }

    if ($separatorIndex -lt ($RawArgs.Count - 1)) {
        $PiArgs = $RawArgs[($separatorIndex + 1)..($RawArgs.Count - 1)]
    }
}
else {
    $Instructions = $RawArgs
}

$prompt = @"
You are committing changes for the dotfiles repository.

Repository setup:
- Working directory: $HOME
- Use the `dot` CLI for all repository operations.
- Do NOT use raw `git` for this repo.
- Do NOT use `--git-dir` or `--work-tree`.
- Use `dot ls-files --others --exclude-standard` to show untracked files.
- Use `dot add -f` when adding new files to this repo.

Do the following workflow exactly.

```bash
# 1) Inspect current state
dot status --porcelain
dot ls-files --others --exclude-standard

# 2) If there are no staged changes, report "Nothing to commit" and stop without error
dot --no-pager diff --cached --name-status

# 3) Analyze staged changes file-by-file before staging any new commit chunk
dot --no-pager diff --cached <file>

# 4) MANDATORY split plan
#    - Build a commit plan first.
#    - Plan must contain 2+ commits whenever there are unrelated changes (different feature areas, config vs code, refactor vs behavior change, rename/move vs logic changes).
#    - NEVER commit everything in one commit when multiple logical groups exist.

# 5) Stage only one logical group at a time
dot reset
dot add -f <files-for-group-1>
dot --no-pager diff --cached --name-status
dot --no-pager diff --cached <each-file-in-group-1>

# 6) Commit that one logical group
dot commit -m "<conventional-commit>" -m "<single-paragraph body>"

# 7) Repeat reset/add/diff/commit for remaining logical groups until clean
dot reset
dot add -f <files-for-group-2>
...

# 8) Final check
dot status --porcelain
```

Rules:
- Follow Conventional Commits: type(optional-scope): short summary
- Keep summary concise and specific
- Commit body must be one paragraph and explain what changed and why
- If there is nothing to commit, report that and stop without error
- Do not create one giant commit when there are multiple logical changes
- If you choose a single commit, explicitly justify why all changes are one inseparable logical unit
- Do not include untracked files unless explicitly requested
- Do not run cd

Required response format:

Summary of changes:
- 
Conventional Commit messages:
- 
Command run:
- 
"@

if ($Instructions.Count -gt 0) {
    $prompt += "`n`nAdditional user instructions:`n" + ($Instructions -join ' ')
}

$defaultPiArgs = @(
    '--thinking', 'medium',
    '--tools', 'read,bash',
    '--provider', 'openai-codex',
    '--model', 'gpt-5.4-mini',
    '--no-extensions',
    '--no-prompt-templates',
    '--no-skills'
)

$allPiArgs = $defaultPiArgs + $PiArgs + @($prompt)

$exitCode = 0

Push-Location $HOME
try {
    & pi @allPiArgs
    if ($null -ne $LASTEXITCODE) {
        $exitCode = $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

exit $exitCode
