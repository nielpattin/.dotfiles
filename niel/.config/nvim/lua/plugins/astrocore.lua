---@type LazySpec
return {
  "AstroNvim/astrocore",
  ---@type AstroCoreOpts
  opts = {
    options = {
      opt = {
        number = true,
        relativenumber = true,
        wrap = true,
        linebreak = true,
        breakindent = true,
        shell = "pwsh",
        shellcmdflag = "-NoLogo -NoProfile -ExecutionPolicy RemoteSigned -Command [Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();$PSDefaultParameterValues['Out-File:Encoding']='utf8';$PSStyle.OutputRendering='PlainText';",
        shellpipe = "> %s 2>&1",
        shellquote = "",
        shellxquote = "",
        shelltemp = false,
      },
    },
  },
}
