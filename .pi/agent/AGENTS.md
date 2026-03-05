# Global Rules for AGENT
- User is on a Windows machine.
- They use `pwsh` not `cmd` or `powershell` in their terminal.
- By default pi use `bash` from Git for Windows, don't trying to run pwsh script with the bash tool.
- Use `pwsh` only when the user explicitly tell you to run powershell script or when something needed to be run in powershell.
- For pi internals tasks only, pi-mono repo is in `$HOME/repo/public/pi-mono` folder
- Avoid recency bias in writeups: For documentation, comments, PR summaries, and commit messages, review the full change set and prioritize by overall impact—not just the most recently touched files or recently discussed topics.
- User dotfiles is bare repo located at `$HOME/.dotfiles` and the actual files are in `$HOME`.
- if `dot` is a pwsh function that for the .dotfiles repo, use `dot` instead of `git` when the user is working with their dotfiles.
# NOTE: I'm treating this as a hard rule now:
- Projects is pre-lauch
- 0 existing users
- Optimize for fastest crash elmination, not cautious rollout, fallback is explicitly prohibited.