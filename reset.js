// PM Codex — reset. PLAN.md section 22.5.
// Removes installed packages and the build, so Install starts clean.
// Your Gemini key (secrets/, or ENVIRONMENT on older installs) and your data (Google Sheet) are not touched.
// The work is in launcher/reset.mjs (Node), so it runs the same on macOS and Windows.
module.exports = {
  version: "3.7",
  run: [
    { method: "shell.run", params: { message: "node launcher/reset.mjs", path: "." } }
  ]
}
