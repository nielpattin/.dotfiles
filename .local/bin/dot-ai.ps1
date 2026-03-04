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

Do the following exactly, DON'T FUCKING RUN cd commands or change directories, just use the --git-dir and --work-tree options with git commands:
1) Run: git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" status --short --branch
2) Run: git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" add -u
3) Run: git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" status --short
4) If there are no staged changes, report "Nothing to commit" and stop without error
5) Use these commands to analyze the staged changes before writing commit messages:
   - git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" diff --staged --name-status
   - git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" diff --staged
   - git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" log -n 20 --oneline
6) Split changes into multiple logical commits if needed
7) For each commit, write a Conventional Commit message and run: git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" commit -m "<your-conventional-commit-message>"

Rules:
- Follow Conventional Commits (type(optional-scope): short summary)
- Keep summary concise and specific
- Do not add untracked files with git -force, only stage modified and deleted files with git add -u
- If there is nothing to commit, report that and stop without error
- After done, I want this response format FOR EXAMPLE:

Summary of changes:
- Add description of change 1
Conventional Commit messages:
- <type(optional-scope): short summary>
Command run:
- git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" commit -

"@

if ($ExtraInstructions.Count -gt 0) {
    $prompt += "`n`nAdditional user instructions:`n" + ($ExtraInstructions -join ' ')
}

$env:GIT_DIR = "$HOME/.dotfiles"
$env:GIT_WORK_TREE = "$HOME"

Push-Location $HOME
try {
    pi --thinking medium --tools "read,bash" --provider openai-codex --model gpt-5.1-codex-mini --no-extensions --no-prompt-templates --no-skills -p $prompt
}
finally {
    Pop-Location
    Remove-Item Env:GIT_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:GIT_WORK_TREE -ErrorAction SilentlyContinue
}
