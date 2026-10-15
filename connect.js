// PM Codex — Connect to Claude. PLAN.md section 22.15.
// Makes the Claude desktop extension for this computer, then opens it, so
// Claude desktop shows its install window. Click Install there.
// Run it again after an Update that changed the bridge, or after changing
// PM_CODEX_PORT. (macOS first; Windows later.)
module.exports = {
  version: "3.7",
  run: [
    { method: "shell.run", params: { message: "node bridge/tools/build-mcpb.mjs", path: "." } },
    {
      method: "shell.run",
      params: {
        message: "open pm-codex-bridge.mcpb && echo 'PM Codex: Claude desktop should now show an install window. Click Install. Then start a new Claude conversation and say: Start a PM Codex session.' || echo 'PM Codex: could not open the extension. Install the Claude desktop app, then click Connect to Claude again.'",
        path: "."
      }
    }
  ]
}
