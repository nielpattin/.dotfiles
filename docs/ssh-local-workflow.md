# SSH is local-only (not managed by chezmoi)

This dotfiles repo does **not** manage `~/.ssh`.

## Why

- SSH keys are machine-sensitive and high-risk.
- Avoid accidental key rotation, overwrite, or cross-machine leakage from config sync.

## New machine checklist

1. Install OpenSSH client.
2. Restore/import your SSH private keys from your secure backup process.
3. Restore/import your SSH config and known_hosts (optional but recommended).
4. Set strict permissions on Linux:
   - `chmod 700 ~/.ssh && chmod 600 ~/.ssh/*`
5. Verify access:
   - `ssh -T git@github.com`

## Local bridge example

If you connect from one local machine environment to another local machine environment, keep those bridge keys local too.

- Example private key: `~/.ssh/local_bridge_key`
- Example authorized key target: `~/.ssh/authorized_keys`

Do **not** commit either file into this repo.
