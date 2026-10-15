// PM Codex — install. PLAN.md section 22.5.
// Installs the app's and the bridge's packages, and builds the app. The build runs with the Gemini
// key blanked, so the key can never end up inside the built page.
module.exports = {
  version: "3.7",
  run: [
    {
      method: "shell.run",
      params: { message: ["node --version", "npm --version", "npm install --no-audit --no-fund"], path: "source" }
    },
    {
      method: "shell.run",
      params: { message: "npm run build", path: "source", env: { GEMINI_API_KEY: "" } }
    },
    {
      method: "shell.run",
      params: { message: "npm install --no-audit --no-fund", path: "bridge" }
    }
  ]
}
