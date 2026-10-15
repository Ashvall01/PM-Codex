// PM Codex — update. PLAN.md section 22.5.
// Gets the newest code from GitHub, then reinstalls and rebuilds.
// Restart the app afterwards.
//
// After "Go back to last good version" the copy is on a tag; Update returns
// it to main first. A branch chosen in GitHub Desktop is left as it is.
//
// The public repo needs no sign-in. A copy cloned from a private repo may: if
// the download fails, the step says so and carries on — pull in GitHub
// Desktop instead, and run Update again to rebuild.
module.exports = {
  version: "3.7",
  run: [
    {
      method: "shell.run",
      params: {
        message: "(git symbolic-ref -q HEAD >/dev/null || git checkout --quiet main) && git pull --ff-only || echo 'PM Codex: could not download updates here. If this copy came from GitHub Desktop, click Fetch origin / Pull there, then run Update again.'",
        path: ".",
        env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }
      }
    },
    { method: "shell.run", params: { message: "npm install --no-audit --no-fund", path: "source" } },
    { method: "shell.run", params: { message: "npm run build", path: "source", env: { GEMINI_API_KEY: "" } } },
    {
      method: "shell.run",
      params: {
        message: "npm install --no-audit --no-fund && echo 'PM Codex: updated. Start the app again. If Claude is connected, quit and reopen the Claude desktop app so it uses the new bridge.'",
        path: "bridge"
      }
    }
  ]
}
