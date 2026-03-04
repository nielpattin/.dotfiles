# Dotfiles

This is some normal Windows dotfile lol, nothing to see here...

## Setup

Use your `dot` function/alias (preferred), or equivalent Git command:

```ps1
function dot {
    git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" $args
}
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