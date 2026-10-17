// PM Codex — Pinokio launcher menu. PLAN.md section 22.5.
const path = require("path")

module.exports = {
  version: "3.7",
  title: "PM Codex",
  description: "Project management with an AI assistant. Runs on this computer; your data stays in your own Google Sheet; works with Claude. Live demo: ashvall01.github.io/PM-Codex",
  icon: "icon.png",
  menu: async (kernel, info) => {
    const busy = [
      ["install.js", "fa-solid fa-plug", "Installing…"],
      ["update.js", "fa-solid fa-rotate", "Updating…"],
      ["rollback.js", "fa-solid fa-clock-rotate-left", "Going back…"],
      ["reset.js", "fa-solid fa-broom", "Resetting…"],
      ["connect.js", "fa-solid fa-link", "Connecting to Claude…"],
    ]
    for (const [file, icon, text] of busy) {
      if (info.running(file)) return [{ default: true, icon, text, href: file }]
    }

    const installed = info.exists("source/node_modules") && info.exists("source/dist")
    if (!installed) return [{ default: true, icon: "fa-solid fa-plug", text: "Install", href: "install.js" }]

    const connect = { icon: "fa-solid fa-link", text: "Connect to Claude", href: "connect.js" }

    if (info.running("start.js")) {
      let local = null
      if (typeof info.local === "function") local = info.local("start.js")
      if (!local && kernel.memory && kernel.memory.local) local = kernel.memory.local[path.resolve(__dirname, "start.js")]
      const items = []
      if (local && local.url) {
        items.push({ default: true, icon: "fa-solid fa-rocket", text: "Open PM Codex", href: local.url })
      }
      items.push(connect)
      items.push({ icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" })
      return items
    }

    return [
      { default: true, icon: "fa-solid fa-power-off", text: "Start", href: "start.js" },
      connect,
      { icon: "fa-solid fa-rotate", text: "Update", href: "update.js" },
      { icon: "fa-solid fa-clock-rotate-left", text: "Go back to last good version", href: "rollback.js" },
      { icon: "fa-solid fa-broom", text: "Reset (reinstall packages)", href: "reset.js" },
    ]
  }
}
