# PM Codex

A project management app with an AI assistant. It runs on your own computer, keeps your data in
your own Google Sheet, and works with Claude.

**[See it in action →](https://ashvall01.github.io/PM-Codex/)** A live demo of the real app with a sample project.

- **Plan:** timeline with Gantt and an Excel-style activity sheet, deliverables, billing.
- **Track:** tasks and issues, risks with a heat map, stakeholders, documents.
- **Meetings:** minutes of meeting with action items you push to the task tracker.
- **Codex:** a knowledge base the AI reads before it suggests anything.
- **AI that asks first:** Claude (through the bridge) and the built-in Gemini assistant *propose*
  changes. Nothing changes until you review and sign off.
- **Privacy glossary:** names you list are swapped for tokens before anything reaches the AI.

## What you need

- A Mac (Windows comes later).
- [**Pinokio**](https://pinokio.co) — the free app that installs and runs local apps.
- A Google account, for your own Google Sheet.
- Optional: a **Gemini API key** ([Google AI Studio](https://aistudio.google.com/apikey)), to turn on
  the Gemini features.
- Optional: the **Claude desktop app**, to work with Claude.

## Install

1. In Pinokio, open **Discover**, search for **PM Codex** — or download from URL:
   `https://github.com/Ashvall01/PM-Codex`
2. Click **Install**.
3. Click **Start**. Pinokio asks for a Gemini key — optional. Leave it empty to skip Gemini.
4. Click **Open PM Codex**. The app opens at **http://localhost:7800**.

## Set up your data

The first time, the Setup Wizard shows you what to do: make a Google Sheet, paste the script it shows
into **Extensions → Apps Script**, deploy it as a **Web app** with access set to **Anyone**, and paste
the web app address into the wizard.

**Keep that address private.** Anyone who has it can read your data.

## Connect to Claude

1. Install the [Claude desktop app](https://claude.ai/download).
2. In Pinokio → PM Codex, click **Connect to Claude**. Claude desktop shows an install window; click
   **Install**.
3. Keep PM Codex open in your browser. In a new Claude conversation, say:
   **"Start a PM Codex session."**

Claude reads your project and files its changes as one change request. You review it in the app —
Approve, Review line by line, or Reject.

## Three rules

1. **Open the app in one browser tab only.** Each tab saves your whole Sheet, so two tabs overwrite
   each other.
2. **Always use http://localhost:7800.** Not Pinokio's `https://…localhost` link — a different address
   starts an empty app.
3. **Your Gemini key stays on your computer**, in Pinokio → PM Codex → Configure. Change it there,
   then restart the app.

## Update

Pinokio → **Update**, then **Start** again. If Claude is connected, quit and reopen Claude desktop.
**Go back to last good version** returns to the newest release marked as verified.

## For developers

| Folder | What it is |
|---|---|
| `source/` | The app (React + Vite) |
| `source/server.mjs` | The local server: serves the app and forwards Gemini calls with the key |
| `bridge/` | The MCP bridge that lets Claude read the project and propose changes |
| `bridge/directive.md` | The assistant's standing brief — edit it to change how Claude behaves |

- Build and run: `cd source && npm install && npm run build && npm start`
- Tests: `npm run lint`, `npm run test:proxy`, and the suites in `source/test/` and `bridge/test/`.
- Rules for coding agents: `source/AGENTS.md`.
- Code comments that cite `PLAN.md` point to the maintainer's design notes, which are not published.

## Support

PM Codex is free and open source. If you find it useful, you can [support its development](https://ko-fi.com/aldoveraldi).

## Licence

Copyright (C) 2026 Aldo Veraldi

PM Codex is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. It is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.
