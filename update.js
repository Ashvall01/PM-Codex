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
//
// The git logic is in launcher/update.mjs (Node), not in a shell line here:
// every line below must read the same in macOS's shell and Windows' cmd.exe.
module.exports = {
  version: "3.7",
  run: [
    { method: "shell.run", params: { message: "node launcher/update.mjs", path: "." } },
    { method: "shell.run", params: { message: "npm install --no-audit --no-fund", path: "source" } },
    { method: "shell.run", params: { message: "npm run build", path: "source", env: { GEMINI_API_KEY: "" } } },
    { method: "shell.run", params: { message: "npm install --no-audit --no-fund", path: "bridge" } },
    { method: "shell.run", params: { message: "node launcher/update.mjs done", path: "." } }
  ]
}
