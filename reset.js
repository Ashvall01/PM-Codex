// PM Codex — reset. PLAN.md section 22.5.
// Removes installed packages and the build, so Install starts clean.
// Your Gemini key (secrets/, or ENVIRONMENT on older installs) and your data (Google Sheet) are not touched.
module.exports = {
  version: "3.7",
  run: [
    { method: "shell.run", params: { message: "rm -rf source/node_modules source/dist bridge/node_modules && echo 'PM Codex: reset done. Click Install.'", path: "." } }
  ]
}
