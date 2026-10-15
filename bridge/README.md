# PM Codex Bridge

The small program that lets Claude read your PM Codex project and propose changes to it.

## Install

In Pinokio → PM Codex, click **Connect to Claude**. Claude desktop shows an install window; click
**Install**. That makes the extension for *this* computer (`tools/build-mcpb.mjs` writes
`pm-codex-bridge.mcpb` from `manifest.template.json`). After an **Update** that changed this folder,
quit and reopen Claude desktop. Then, in Claude, say: **"Start a PM Codex session."**

## What it does

Claude asks the bridge a question. The bridge asks your open PM Codex tab
(`http://localhost:7800`). The tab answers from its live state. Claude can **propose** changes; each
proposal appears in the app with Approve, Review and Reject, and nothing changes until you sign off.
The outcome reaches Claude on its next tool call. The bridge never touches Google Sheets — the app
in your browser is the only thing that writes to your data.

## Two parts, and why

| File | Job |
|---|---|
| `hub.mjs` | Owns the connection to your browser. **One copy, ever.** Holds port 7799. |
| `server.mjs` | The face Claude sees. Owns nothing. **Any number of copies.** |
| `config.mjs` | Settings, logging, and `HUB_PROTOCOL`. Shared by both. |

Claude desktop starts the server several times in a few seconds. Only one process can hold port
7799, so the browser connection lives in the hub and every server copy talks to it. The first hub
wins the port; others exit quietly. An older hub stands down when a server with a newer
`HUB_PROTOCOL` reaches it — **bump `HUB_PROTOCOL` whenever `hub.mjs`, or anything the hub reads at
start, changes**, because restarting Claude desktop does not restart the hub.

## Editing how Claude behaves

`directive.md` is the assistant's standing brief. Edit it and save; it takes effect in your next new
conversation, with no restart. Anything inside `<!-- ... -->` is a note to you and is stripped out.

## Settings

`config.json` (optional, not in git):

| Setting | Meaning |
|---|---|
| `port` | Where the hub listens for your browser. Default 7799. |
| `allowedOrigins` | Which web addresses may connect. Default: the local app, `http://localhost:7800` and `http://127.0.0.1:7800` — or the port in `PM_CODEX_PORT`, which **Connect to Claude** passes in. |
| `requestTimeoutMs` | How long to wait for the tab. Default 15000. |
| `snapshotBudgetChars` | How much of the project one tool result may carry. Default 45000. |

A web page cannot fake its address on this kind of connection, so the allowlist is real protection.

## If something seems wrong

Ask Claude for **`bridge_status`**, then read **`bridge.log`** in this folder — every part writes
there, because Claude desktop discards the bridge's error output. Common causes:

1. The PM Codex tab is not open, or needs a reload.
2. The app was opened at a different address (use `http://localhost:7800`).
3. Claude desktop was not reopened after an update that changed this folder.

## Tests

- `node test/e2e.mjs` — full check with a simulated app. Needs nothing running.
- `node test/mcpb-test.mjs` — the extension builder and the allowed addresses.
- `node test/live.mjs` — drives the real bridge against your real open tab.
