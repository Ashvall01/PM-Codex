// PM Codex — go back to the last good version. PLAN.md section 22.6.
// Checks out the newest version tagged as verified live (v…-live), then
// reinstalls and rebuilds. Update brings you back to the newest version.
module.exports = {
  version: "3.7",
  run: [
    {
      method: "shell.run",
      params: {
        message: "TAG=$(git tag -l 'v*-live' --sort=-v:refname | head -n1); if [ -z \"$TAG\" ]; then echo 'PM Codex: there is no known-good version yet. Nothing changed.'; else git checkout --quiet \"$TAG\" && echo \"PM Codex: now on $TAG. Restart the app. Update brings you back to the newest version.\"; fi",
        path: "."
      }
    },
    { method: "shell.run", params: { message: "npm install --no-audit --no-fund", path: "source" } },
    { method: "shell.run", params: { message: "npm run build", path: "source", env: { GEMINI_API_KEY: "" } } },
    { method: "shell.run", params: { message: "npm install --no-audit --no-fund", path: "bridge" } }
  ]
}
