<p align="center">
  <img src="apps/marketing/public/og-image.webp" alt="Plannotator" width="80%" />
</p>

# Plannotator

Interactive Plan Review for OpenCode. Mark up and refine your plans using a visual UI and seamlessly integrate with your agent.

<td align="center">
<h3>OpenCode</h3>
<a href="https://youtu.be/_N7uo0EFI-U">
<img src="apps/marketing/public/youtube-opencode.png" alt="OpenCode Demo" width="100%" />
</a>
<p><a href="https://youtu.be/_N7uo0EFI-U">Watch Demo</a></p>
</td>

**Features:**

 - **Code Review** *(Jan 2026)* — Run `/plannotator-review` to review git diffs with inline annotations (select line numbers to annotate), switch between diff views, and send feedback to your agent
 - Attach and annotate images with your feedback (pen, arrow, circle tools)
 - Auto-save approved plans to [Obsidian](https://obsidian.md/) and [Bear Notes](https://bear.app/)

## Install for OpenCode

Add to your `opencode.jsonc`:

```jsonc
{
  "plugin": ["@plannotator/opencode@0.6.6"]
}
```

**Update the plugin:**
Restart OpenCode to pull the 0.6.6 version of the `@plannotator/opencode` plugin.

---

## How It Works

When your AI agent finishes planning, Plannotator:

1. Opens the Plannotator UI in your browser
2. Lets you annotate the plan visually (delete, insert, replace, comment)
3. **Approve** → Agent proceeds with implementation (with your notes)
4. **Request changes** → Your annotations are sent back as structured feedback

---

## License

**Copyright (c) 2025 backnotprop.**

This project is licensed under the **Business Source License 1.1 (BSL)**.
