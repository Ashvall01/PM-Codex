// PM Codex — start. PLAN.md section 22.5.
// Runs the local server on the fixed port (7800 unless PM_CODEX_PORT is set).
// The Gemini key is optional. It is asked for once and kept in this app's
// ENVIRONMENT file, on this computer only. Only the server reads it.
module.exports = {
  version: "3.7",
  daemon: true,
  env: [{
    key: "GEMINI_API_KEY",
    title: "Gemini API key",
    description: "Optional. Turns on the Gemini features; Claude works without it. The key stays on this computer. Make one at https://aistudio.google.com/apikey"
  }],
  run: [
    {
      method: "shell.run",
      params: {
        message: "node server.mjs",
        path: "source",
        on: [{ event: "/http:\\/\\/localhost:\\d+/", done: true }]
      }
    },
    {
      method: "local.set",
      params: { url: "{{input.event[0]}}" }
    }
  ]
}
