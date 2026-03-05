local wezterm = require 'wezterm'

local config = {}
if wezterm.config_builder then
  config = wezterm.config_builder()
  config:set_strict_mode(true)
end
-- Windows profile
config.default_prog = { 'pwsh.exe', '-NoLogo' }
config.wsl_domains = wezterm.default_wsl_domains()

local launch_menu = {
  { label = 'PowerShell (pwsh)', args = { 'pwsh.exe', '-NoLogo' } },
  { label = 'Command Prompt (cmd)', args = { 'cmd.exe' } },
}

for _, dom in ipairs(config.wsl_domains) do
  table.insert(launch_menu, {
    label = 'WSL: ' .. dom.distribution,
    args = { 'wsl.exe', '-d', dom.distribution },
  })
end

config.launch_menu = launch_menu

config.color_scheme = 'Catppuccin Macchiato'
config.font = wezterm.font_with_fallback({
  'JetBrainsMono Nerd Font',
  'Noto Color Emoji',
})
config.font_size = 10
config.front_end = 'WebGpu'
config.default_cwd = wezterm.home_dir
config.scrollback_lines = 50000
config.enable_scroll_bar = true
config.tab_bar_at_bottom = false
config.use_fancy_tab_bar = false
config.hide_tab_bar_if_only_one_tab = false
config.adjust_window_size_when_changing_font_size = true
config.custom_block_glyphs = false
config.window_padding = {
  left = 8,
  right = 8,
  top = 6,
  bottom = 6,
}

config.keys = {
  {
    key = 'P',
    mods = 'CTRL|SHIFT',
    action = wezterm.action.ShowLauncherArgs {
      flags = 'FUZZY|TABS|DOMAINS|LAUNCH_MENU_ITEMS|COMMANDS',
      title = 'WezTerm Launcher',
    },
  },
}

return config
