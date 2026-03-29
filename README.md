# Dotfiles

This is some normal Windows dotfile lol, nothing to see here...

## Setup

Use the wrapper scripts in `~/.local/bin` so `dot` works in both pwsh and Git Bash:

- `C:\Users\niel\.local\bin\dot.cmd`
- `C:\Users\niel\.local\bin\dot`

They both run the bare repo with `$HOME` as the work tree.

```bash
dot status
dot add -u
dot commit -m "chore(dotfiles): update config"
```

## Workflow daily usage:
```bash
dot status
dot add -u # stage tracked changes that are added to this dotfiles repo
dot add -f <file> # stage new file to be tracked FORCEFULLY
dot commit -m "chore(dotfiles): update config"
dot push
```

## Bootstrap on a new machine

```bash
git clone --bare <your-repo-url> "$HOME/.dotfiles"
git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" checkout
```

Then make local tools like VS Code see the repo from `$HOME`:

```pwsh
"gitdir: $($HOME -replace '\\','/')/.dotfiles" | Set-Content "$HOME/.git"

dot config core.bare false
dot config core.worktree "$HOME"
dot config status.showUntrackedFiles no
```

## VS Code setup

No workspace file is needed.

1. In VS Code user settings, set:

```json
"git.openRepositoryInParentFolders": "always"
```

2. Open the dotfiles repo by opening `$HOME`:

```pwsh
code $HOME
```

or use your helper:

```pwsh
dot-code
```

## Pre-winget setup

### Update Winget to latest

```pwsh
& "$HOME\.local\bin\install-winget-latest.ps1" # This script checks for the latest version of winget on github and installs it if needed
```

## Mid-Winget setup
In pwsh, run the following to install tools with winget. This will be faster than installing them manually, and ensures they are added to PATH correctly.
```bash
winget install --id Git.Git -e -i
winget install --id GitHub.cli -e
winget install --id jdx.mise -e


winget install --id BurntSushi.ripgrep.MSVC -e
winget install --id junegunn.fzf -e
winget install --id  sharkdp.fd -e
winget install --id BtbN.FFmpeg.GPL.8.0 -e
winget install --id Microsoft.PowerShell -e

winget install --id Starship.Starship -e
winget install --id eza-community.eza -e
winget install --id ajeetdsouza.zoxide -e
winget install --id Microsoft.PowerToys -e

winget install --id Microsoft.WindowsTerminal -e
winget install --id ShareX.ShareX -e
winget install --id Microsoft.VisualStudioCode -e
winget install --id DuongDieuPhap.ImageGlass -e

winget install --id OpenJS.NodeJS.LTS -e -i
winget install --id pnpm.pnpm -e
winget install --id Oven-sh.Bun -e
winget install --id GoLang.Go -e

# Optional, for me:
winget install --id JohnMacFarlane.Pandoc -e
```

## Post-winget PATH setup (run in pwsh)

After installing tools, run this once in `pwsh` to refresh and persist the user PATH safely.
It preserves existing user PATH entries and adds the common directories used in this setup.

```pwsh
& "$HOME\.local\bin\refresh-user-path.ps1"
```

Then open a new terminal.