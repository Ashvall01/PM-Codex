/**
 * PM Codex Bridge — settings and housekeeping shared by the hub and the MCP
 * server. Neither of them owns this; both read it.
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { userInfo } from 'node:os';
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
// 6 — Windows. The hub's address for the MCP servers is a named pipe there
//     (hubSocketPath below), and hub.mjs no longer treats the address as a
//     file it may delete. Nothing changes on macOS beyond the stand-down.
//
// BUMP THIS EVERY TIME hub.mjs CHANGES, however small the change.
// The hub is a long-lived process that owns port 7799. Restarting the Claude
// desktop app restarts server.mjs and NOT the hub, so an old hub keeps running
// against a new server and the change silently does nothing. This number is the
// only thing that stands the old one down. Measured on 7 Sep: hub.mjs was edited,
// the desktop app was restarted, and the hub from three hours earlier was still
// serving.
export const HUB_PROTOCOL = 6;

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
 * macOS and Linux: a Unix socket. Deliberately NOT in os.tmpdir() — on macOS a
 * program started by an application and the same program started from Terminal
 * get different temporary folders, so they would never find each other. /tmp is
 * the same for everyone, and the user id keeps two accounts on one Mac apart.
 *
 * Windows: a named pipe. Windows has no /tmp and no user id; a pipe name is the
 * same from every program on the machine, and the account name keeps two
 * accounts apart. A pipe is not a file: it is gone the moment the hub exits, so
 * there is never a leftover to clear (see isNamedPipe).
 */
export function hubSocketPath(config, platform = process.platform) {
  if (config.hubSocketPath) return config.hubSocketPath;
  if (platform === 'win32') return `\\\\.\\pipe\\pm-codex-bridge-${accountTag()}`;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'x';
  return `/tmp/pm-codex-bridge-${uid}.sock`;
}

/** True for a Windows named pipe, which must never be unlinked or chmod-ed. */
export function isNamedPipe(address) {
  return /^\\\\[.?]\\pipe\\/i.test(String(address || ''));
}

/** The account name, cut down to what a pipe name can safely hold. */
function accountTag() {
  let name = '';
  try { name = userInfo().username; } catch { /* no account record — fall through */ }
  name = name || process.env.USERNAME || process.env.USER || 'x';
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'x';
}

/** The file name at the end of a path written with either kind of slash. */
function baseName(p) {
  return String(p || '').split(/[\\/]/).pop() || '';
}

export function looksLikeNode(p) {
  return /^node(\.exe)?$/i.test(baseName(p));
}

/**
 * Which programs to try, in order, when a hub has to be started.
 *
 * NEVER the host application's own binary first. Inside Claude,
 * process.execPath is "Claude Helper (Plugin)". Launching that as a detached
 * process makes macOS see a second copy of a Claude helper starting by itself,
 * and it asks the user for their keychain password before it will run. The
 * user then gets a password prompt they did not ask for, from a bridge that has
 * no business near their keychain, and the hub sits blocked behind the dialog
 * looking like a crash.
 *
 * So: a real node binary, always.
 *
 *   1. PM_CODEX_NODE — the Node that ran "Connect to Claude", written into the
 *      extension by tools/build-mcpb.mjs. That is Pinokio's own Node, the one
 *      that installed and runs the app, so it is there on every computer that
 *      has PM Codex — including one with no other Node anywhere, where the
 *      fixed folders below hold nothing.
 *   2. This process, when it really is node.
 *   3. The usual install folders for this system.
 *   4. `node`, for whatever PATH offers.
 *   5. Last resort: this process run as node (ELECTRON_RUN_AS_NODE) — never a
 *      macOS .app binary, for the keychain reason above.
 */
export function nodeCandidates({
  execPath = process.execPath,
  platform = process.platform,
  env = process.env,
  exists = existsSync,
} = {}) {
  const seen = new Set();
  const list = [];
  const push = (c) => { if (c && !seen.has(c)) { seen.add(c); list.push(c); } };
  const pushIfThere = (c) => { if (c && exists(c)) push(c); };

  pushIfThere(env.PM_CODEX_NODE);
  if (looksLikeNode(execPath)) push(execPath);
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Programs`]) {
      if (base) pushIfThere(`${base}\\nodejs\\node.exe`);
    }
  } else {
    push('/usr/local/bin/node');
    push('/opt/homebrew/bin/node');
    push('/usr/bin/node');
  }
  push('node');
  if (!looksLikeNode(execPath) && !/\.app\//.test(execPath || '')) push(execPath);
  return list;
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
