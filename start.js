// PM Codex — start. PLAN.md section 22.5.
// Runs the local server on the fixed port (7800 unless PM_CODEX_PORT is set).
// The Gemini key is optional and is NOT asked for here: Pinokio's form would
// not let Start go on without it. The user adds it in the app (setup wizard
// or Settings → Gemini); the server keeps it in secrets/, on this computer
// only. A key already in this app's ENVIRONMENT file still works.
module.exports = {
  version: "3.7",
  daemon: true,
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
