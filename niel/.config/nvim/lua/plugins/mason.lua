---@type LazySpec
return {
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    opts = {
      ensure_installed = {
        "astro-language-server",
        "typescript-language-server",
        "oxlint",
        "gopls",
        "basedpyright",
        "ruff",
        "css-lsp",
        "html-lsp",
        "lua-language-server",
        "marksman",
        "taplo",
        "yaml-language-server",
        "json-lsp",
        "bash-language-server",
        "powershell-editor-services",
        "sqls",
        "tree-sitter-cli",
      },
    },
  },
}
