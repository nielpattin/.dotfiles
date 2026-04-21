# Dotfiles

Mostly tracked in the [Tracked File](tracked.yaml)

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


## Sync the home to the dotfiles repo

 ```bash
   python "$HOME/.dotfiles/scripts/sync_from_home.py"
 ```

 Dry run:

 ```bash
   python "$HOME/.dotfiles/scripts/sync_from_home.py" --dry-run
 ```

 Useful flags:

 ```bash
   python "$HOME/.dotfiles/scripts/sync_from_home.py" --no-prune
   python "$HOME/.dotfiles/scripts/sync_from_home.py" --strict-missing
 ```