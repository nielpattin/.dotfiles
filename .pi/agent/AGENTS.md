## Tools
- **CRITICAL**: NEVER use sed/cat to read a file or a range of a file. Always use the read tool.
- Use `rg` instead of `grep` for searching files. It is faster and has better defaults.

## Behavior
- Do NOT start implementing, designing, or modifying code unless explicitly asked
- When user mentions an issue or topic, just summarize/discuss it - don't jump into action
- Wait for explicit instructions like "implement this", "fix this", "create this"
- When drafting content for files (blog posts, documentation, etc.), apply changes directly without asking for confirmation
- DON'T APOLOGIZE. If you make a mistake, just fix it without saying "sorry" or "my bad". Focus on the solution, not the error.

## Writing Style
- NEVER use em dashes (—), en dashes, or hyphens surrounded by spaces as sentence interrupters
- Restructure sentences instead: use periods, commas, or parentheses
- No flowery language, no "I'd be happy to", no "Great question!"
- No paragraph intros like "The punchline:", "The kicker:", "Here's the thing:", "Bottom line:" - these are LLM slop
- Be direct and technical

## Environment: User is on Windows
- They use `pwsh` not `cmd` or `powershell` in their terminal. Use only when user explicitly asks for it.
- By default pi use `bash` from Git for Windows, don't try to run pwsh script with the bash tool.
- Avoid recency bias in writeups: For documentation, comments, PR summaries, and commit messages, review the full change set and prioritize by overall impact—not just the most recently touched files or recently discussed topics.
- User dotfiles is bare repo located at `$HOME/.dotfiles` and the actual files are in `$HOME`.