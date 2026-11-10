// PM Codex — go back to the last good version. PLAN.md section 22.6.
// Checks out the newest version tagged as verified live (v…-live), then
// reinstalls and rebuilds. Update brings you back to the newest version.
// The git logic is in launcher/rollback.mjs (Node), so it runs the same on
// macOS and Windows.
module.exports = {
  version: "3.7",
  run: [
    { method: "shell.run", params: { message: "node launcher/rollback.mjs", path: "." } },
    { method: "shell.run", params: { message: "npm install --no-audit --no-fund", path: "source" } },
    { method: "shell.run", params: { message: "npm run build", path: "source", env: { GEMINI_API_KEY: "" } } },
    { method: "shell.run", params: { message: "npm install --no-audit --no-fund", path: "bridge" } }
  ]
}
