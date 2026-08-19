# Neovim configuration

Personal AstroNvim v6 configuration for Windows.

## Requirements

- Neovim 0.11 or newer
- Git
- A Nerd Font
- GCC available on `PATH`
- A modern web browser

## Languages

The configuration supports Astro, TypeScript, JavaScript, Go, Python, CSS, HTML, Lua, Markdown, TOML, YAML, JSON, JSONC, INI, shell scripts, PowerShell, and SQL.

## Configuration diagram

```mermaid
flowchart TD
  NVIM["Neovim 0.11+"] --> INIT["init.lua<br/>Bootstrap lazy.nvim"]
  INIT --> LAZY["lua/lazy_setup.lua<br/>Load AstroNvim v6"]
  LAZY --> POLISH["lua/polish.lua<br/>Use GCC for Treesitter builds"]

  LOCK["lazy-lock.json<br/>Pinned plugin revisions"] -.-> LAZY

  LAZY --> ASTRO["AstroNvim defaults<br/>Current colorscheme and clipboard"]
  LAZY --> PLUGINS

  subgraph PLUGINS["lua/plugins"]
    CORE["astrocore.lua<br/>Relative numbers and wrapped lines"]
    LSP["astrolsp.lua<br/>LSP integration and no format-on-save"]
    MASON["mason.lua<br/>Install development tools"]
    TREESITTER["treesitter.lua<br/>Install syntax parsers"]
    MARKDOWN["render-markdown.lua<br/>Render Markdown buffers"]
    PREVIEW["live-preview.lua<br/>Live browser preview"]
  end

  MASON --> SERVERS["Language servers<br/>Astro, TS/JS, Go, Python, web, Lua,<br/>Markdown, TOML, YAML, JSON, shell,<br/>PowerShell, and SQL"]
  MASON --> LINTERS["Linters<br/>Oxlint and Ruff"]
  MASON --> TSCLI["tree-sitter-cli"]

  TREESITTER --> PARSERS["Treesitter parsers<br/>Configured languages and file types"]
  POLISH --> TSCLI
  TSCLI --> PARSERS

  MARKDOWN --> TREESITTER
  MARKDOWN --> ICONS["mini.icons"]
  PREVIEW --> SNACKS["snacks.nvim picker"]
  PREVIEW --> BROWSER["Browser<br/>Live Markdown and Mermaid rendering"]
```

## Markdown preview

Open a Markdown file and start its live browser preview:

```vim
:LivePreview start
```

The preview updates while you type and renders fenced `mermaid` diagrams. Stop the preview server with:

```vim
:LivePreview close
```

Check the integration with `:checkhealth livepreview`.

## Maintenance

Run these commands inside Neovim:

```vim
:Lazy sync
:Mason
:TSUpdate
:checkhealth
```

Plugins are pinned in `lazy-lock.json` for reproducible installations.
