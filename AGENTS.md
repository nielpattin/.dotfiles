Guidance for coding agents working in this home dotfiles setup.

Repository model

- This is a **bare dotfiles repo**.
- Git metadata lives in: `$HOME/.dotfiles`
- Working tree is: `$HOME`

```bash
git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" <command>
```

Safety rules

- Do not run destructive Git commands unless explicitly requested.
- Review changes before commit.
- Avoid adding machine-specific secrets, tokens, or private keys.
- Keep commits focused and clearly scoped.
- Must use -f flag to add files cuz by default we ignore everything except tracked files.

Dotfiles scope

Typical tracked files include shell config, editor config, terminal config, and tool settings located under `$HOME`.
Run this to see all files that are currently tracked:

```bash
git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" ls-files
```