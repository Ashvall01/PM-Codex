/**
 * PM Codex Bridge — settings and housekeeping shared by the hub and the MCP
 * server. Neither of them owns this; both read it.
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Bumped whenever the hub and the MCP server stop understanding each other.
 * A server that meets a hub of a different protocol asks it to stand down and
 * starts a fresh one, so editing this file never leaves you with a stale hub
 * you have to hunt down and kill by hand.
 */
// 2 — Phase 2. The hub carries a sign-off mailbox on every reply, so a hub
//     still speaking 1 must stand down rather than swallow the outcomes.
// 3 — the mailbox count was renamed to signOffsInMailbox.
// 4 — a new client's cursor starts at the current sequence, so a restart no
//     longer replays sign-offs the user has already dealt with.
// 5 — the app runs on this computer (http://localhost:7800). The hub reads
//     allowedOrigins once, at start, so an older hub would keep refusing the
//     new address; this bump stands it down.
//
// BUMP THIS EVERY TIME hub.mjs CHANGES, however small the change.
// The hub is a long-lived process that owns port 7799. Restarting the Claude
// desktop app restarts server.mjs and NOT the hub, so an old hub keeps running
// against a new server and the change silently does nothing. This number is the
// only thing that stands the old one down. Measured on 7 Sep: hub.mjs was edited,
// the desktop app was restarted, and the hub from three hours earlier was still
// serving.
export const HUB_PROTOCOL = 5;

// The local app's port. Pinokio runs the app on 7800 unless PM_CODEX_PORT is
// set; "Connect to Claude" writes the same value into the extension's
// environment, so the bridge and the app always agree.
export const APP_PORT = Number(process.env.PM_CODEX_PORT) || 7800;

const defaultConfig = {
  // The hub listens here for the browser.
  port: 7799,
  // A browser cannot forge the Origin header on a WebSocket, so an allowlist is
  // a real defence against a hostile web page reaching this server. Only the
  // local app, on its own port, may connect. (PLAN.md section 22.)
  allowedOrigins: [
    `http://localhost:${APP_PORT}`,
    `http://127.0.0.1:${APP_PORT}`,
  ],
  requestTimeoutMs: 15000,
  /**
   * How much of the project skeleton may come back in one tool result.
   *
   * The host caps a tool result by TOKENS, not characters, and does not say
   * where the line is. What is known: 62,046 characters of this text was
   * refused, and 37,270 went through. 45,000 sits between the two with room to
   * spare, and it is a character count because that is the only thing either
   * end of this bridge can actually measure.
   *
   * The app trims itself to this figure by holding back whole modules and
   * saying which. The MCP server enforces it a second time on the way out, in
   * case the app is an older build that ignores the budget. Lower it if a
   * session start is ever refused; raise it to fit more in one call.
   */
  snapshotBudgetChars: 45000,
  // Where the MCP servers reach the hub. Null means "work it out below".
  hubSocketPath: null,
};

export function loadConfig() {
  const path = join(HERE, 'config.json');
  if (!existsSync(path)) return { ...defaultConfig };
  try {
    return { ...defaultConfig, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    process.stderr.write(`[bridge] config.json could not be read (${e.message}); using defaults\n`);
    return { ...defaultConfig };
  }
}

/**
 * The address the MCP servers use to reach the hub.
 *
 * Deliberately NOT os.tmpdir(). On macOS a program started by an application
 * and the same program started from Terminal get different temporary folders,
 * so they would never find each other. /tmp is the same for everyone, and the
 * user id keeps two accounts on one Mac apart.
 */
export function hubSocketPath(config) {
  if (config.hubSocketPath) return config.hubSocketPath;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'x';
  return `/tmp/pm-codex-bridge-${uid}.sock`;
}

/**
 * Every copy of every part says who it is on every line it writes.
 *
 * The host application discards stderr, which is how a silent port collision
 * stayed invisible across two sessions. bridge.log cannot be discarded.
 */
export function makeLogger(role) {
  const id = `${role}:${process.pid}`;
  const logFile = join(HERE, 'bridge.log');
  // A hub started by server.mjs already has its stderr pointed at bridge.log,
  // so appending as well would write every line twice. A hub started by hand
  // (npm run hub) has no such redirect and does need the append.
  const stderrAlreadyGoesToTheLog = process.env.PM_CODEX_BRIDGE_LOG_IS_STDERR === '1';

  return {
    id,
    warn(msg) {
      const line = `${new Date().toISOString()} [${id}] ${msg}\n`;
      process.stderr.write(`[bridge] ${line}`);
      if (stderrAlreadyGoesToTheLog) return;
      try { appendFileSync(logFile, line); } catch {}
    },
  };
}
