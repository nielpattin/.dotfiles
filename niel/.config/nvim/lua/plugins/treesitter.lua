---@type LazySpec
return {
  "AstroNvim/astrocore",
  ---@type AstroCoreOpts
  opts = {
    treesitter = {
      highlight = true,
      indent = true,
      auto_install = true,
      ensure_installed = {
        "astro",
        "typescript",
        "tsx",
        "javascript",
        "go",
        "gomod",
        "gosum",
        "gowork",
        "python",
        "css",
        "html",
        "lua",
        "markdown",
        "markdown_inline",
        "toml",
        "yaml",
        "json",
        "ini",
        "bash",
        "powershell",
        "sql",
        "vim",
        "vimdoc",
        "query",
      },
    },
  },
}
