---@type LazySpec
return {
  {
    "brianhuster/live-preview.nvim",
    dependencies = {
      "folke/snacks.nvim",
    },
    config = function()
      require("livepreview.config").set {
        browser = "default",
        dynamic_root = false,
        sync_scroll = true,
        picker = "snacks.picker",
      }
    end,
  },
}
