#!/usr/bin/env node
/**
 * PM Codex Bridge — the hub (Phase 2, propose and review).
 *
 * WHY THIS FILE EXISTS
 *
 * The bridge used to be one program wearing two faces: an MCP server on stdio
 * for Claude, and a WebSocket server for the browser tab. That works when you
 * start it yourself from a terminal, because there is only ever one of it.
 *
 * It does not work when a host application owns the lifecycle. Cowork starts
 * this bridge four times in five seconds — once to probe it, then again for
 * real, and again per client. Only the first copy can own port 7799. The other
 * three carried on serving Claude while the browser talked to a copy they could
 * not see, and every diagnostic reported a healthy bridge. That cost two
 * sessions.
 *
 * So the two jobs are now separate:
 *
 *   - This file owns the browser. One copy. It holds port 7799 and nothing else
 *     may. If a second copy starts, it finds the port taken and exits quietly,
 *     because the copy already running is doing the job correctly.
 *   - server.mjs is a thin client of this file. It owns nothing and remembers
 *     nothing, so any number of copies can run at once and every one works.
 *
 * Nothing here writes. There is no path from this file to Google Sheets. Claude
 * can now propose changes, but a proposal is a row waiting for the user's
 * approve button. The browser remains the only thing that ever writes to your
 * database, and the user remains the only one who decides that it should.
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'node:net';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';
import { loadConfig, hubSocketPath, makeLogger, HUB_PROTOCOL, APP_PORT } from './config.mjs';

const config = loadConfig();
const log = makeLogger('hub');
const SOCK = hubSocketPath(config);
const STARTED_AT = new Date().toISOString();

/* ----------------------------------------------------------- the app side */

let appSocket = null;
let appInfo = null;
let lastScreen = null;
let nextRequestId = 1;
const pending = new Map();

/**
 * The sign-off mailbox. Phase 2.
 *
 * When the user approves or rejects a change request that Claude proposed, the
 * app used to answer Gemini. Gemini did not make that proposal, so it had
 * nothing useful to say. The app now posts the outcome here instead.
 *
 * MCP has no way to interrupt a conversation, so an outcome cannot be pushed to
 * Claude the moment it happens. It waits here and rides out on the reply to the
 * next tool call, whatever that call was.
 *
 * Each MCP server copy keeps its own cursor, so every copy sees every outcome
 * exactly once. Old ones are dropped, because a sign-off nobody collected
 * within half an hour is history, not news.
 */
const OUTCOME_KEEP = 20;
const OUTCOME_TTL_MS = 30 * 60 * 1000;
let outcomeSeq = 0;
let acrOutcomes = [];

function recordOutcome(outcome) {
  acrOutcomes.push({ seq: ++outcomeSeq, at: Date.now(), outcome });
  if (acrOutcomes.length > OUTCOME_KEEP) acrOutcomes = acrOutcomes.slice(-OUTCOME_KEEP);
}

function outcomesSince(cursor) {
  const floor = Date.now() - OUTCOME_TTL_MS;
  acrOutcomes = acrOutcomes.filter((o) => o.at >= floor);
  return acrOutcomes.filter((o) => o.seq > cursor);
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: config.port });

wss.on('connection', (socket, req) => {
  const origin = req.headers.origin || '(none)';

  if (!config.allowedOrigins.includes(origin)) {
    log.warn(`refused connection from disallowed origin: ${origin}`);
    socket.close(1008, 'origin not allowed');
    return;
  }

  // One tab owns the bridge. A second connection replaces the first, which is
  // the behaviour you want when you reload the app.
  if (appSocket && appSocket.readyState === appSocket.OPEN) {
    log.warn('a new tab connected; dropping the previous one');
    try { appSocket.close(1000, 'replaced by a newer tab'); } catch {}
  }

  appSocket = socket;
  log.warn(`app connected from ${origin}`);

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      log.warn('ignored a malformed message from the app');
      return;
    }

    if (msg.type === 'hello') {
      appInfo = msg.info || null;
      log.warn(`app says hello: ${JSON.stringify(appInfo)}`);
      return;
    }

    if (msg.type === 'screen') {
      lastScreen = msg.screen || null;
      return;
    }

    if (msg.type === 'acrOutcome') {
      recordOutcome(msg.outcome || null);
      log.warn(`the user signed off a Claude change request: ${JSON.stringify(msg.outcome?.acrId || '')}`);
      return;
    }

    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.ok) waiter.resolve(msg.data);
    else waiter.reject(new Error(msg.error || 'the app reported an unspecified error'));
  });

  socket.on('close', () => {
    if (appSocket === socket) {
      appSocket = null;
      appInfo = null;
      log.warn('app disconnected');
    }
  });

  socket.on('error', (e) => log.warn(`socket error: ${e.message}`));
});

/** The message every tool returns when there is no tab to ask. */
const NOT_CONNECTED =
  'PM Codex is not connected to the bridge. The app has to be open in a browser tab for me to read anything. ' +
  `Ask the user to start PM Codex in Pinokio and open it (http://localhost:${APP_PORT}); if it is already open, to reload the tab. ` +
  `If they opened a different address (such as a https://…localhost link), they should open http://localhost:${APP_PORT} instead.`;

function callApp(op, params = {}) {
  return new Promise((resolve, reject) => {
    if (!appSocket || appSocket.readyState !== appSocket.OPEN) {
      reject(new Error(NOT_CONNECTED));
      return;
    }
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`The app did not answer "${op}" within ${config.requestTimeoutMs / 1000}s. It may be busy or mid-reload.`));
    }, config.requestTimeoutMs);

    pending.set(id, { resolve, reject, timer });
    appSocket.send(JSON.stringify({ id, op, params }));
  });
}

/* ----------------------------------------------------------- the MCP side */

function status() {
  return {
    protocol: HUB_PROTOCOL,
    hubPid: process.pid,
    hubStartedAt: STARTED_AT,
    socketPath: SOCK,
    listeningOn: `ws://127.0.0.1:${config.port}`,
    appConnected: !!appSocket && appSocket.readyState === appSocket.OPEN,
    app: appInfo,
    currentScreen: lastScreen,
    mcpClients: clients.size,
    signOffsInMailbox: acrOutcomes.length,
  };
}

const clients = new Set();

function handleClient(sock) {
  clients.add(sock);
  let buffer = '';
  // Starts at the current sequence, NOT at zero.
  //
  // A cursor of zero replays the whole mailbox to any client that connects, and
  // a restarted desktop app is a new client. On 7 Sep that re-delivered two
  // rejections the user had already dealt with half an hour earlier, into a
  // conversation that had moved on. A stale "the user approved X" is worse than
  // a missed one: it invites acting on something already undone.
  //
  // So a client hears what happens while it is listening, and nothing else. The
  // narrow loss — a sign-off landing in the gap between a restart and the next
  // tool call — is recoverable with get_acr_status, which reads the truth.
  let outcomeCursor = outcomeSeq;

  const send = (obj) => {
    // Piggyback, not a push: the sign-off leaves on the next reply this client
    // was already waiting for, so it costs no extra round trip and it cannot
    // hang if nothing is listening.
    try {
      const fresh = outcomesSince(outcomeCursor);
      if (fresh.length) {
        outcomeCursor = fresh[fresh.length - 1].seq;
        obj = { ...obj, signOffs: fresh.map((o) => o.outcome) };
      }
    } catch {}
    try { sock.write(JSON.stringify(obj) + '\n'); } catch {}
  };

  sock.on('data', (chunk) => {
    buffer += chunk.toString();
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      if (line.trim()) void handleLine(line, send);
    }
  });

  sock.on('close', () => clients.delete(sock));
  sock.on('error', () => clients.delete(sock));
}

async function handleLine(line, send) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.op === '__status__') {
    send({ id: msg.id, ok: true, data: status() });
    return;
  }

  // Only ever used by a server that finds a hub speaking an older protocol.
  // It stands the old one down and starts a fresh one, so editing hub.mjs does
  // not leave a stale copy you have to hunt for.
  if (msg.op === '__shutdown__') {
    log.warn('a newer MCP server asked this hub to stand down');
    send({ id: msg.id, ok: true, data: 'standing down' });
    setTimeout(() => process.exit(0), 100);
    return;
  }

  try {
    send({ id: msg.id, ok: true, data: await callApp(msg.op, msg.params || {}) });
  } catch (e) {
    send({ id: msg.id, ok: false, error: e.message });
  }
}

/* ------------------------------------------------------------------ launch */

/**
 * The TCP port is the real lock. Only one process on the machine can hold it,
 * so whoever wins it is the hub and everyone else stands down. The socket file
 * is opened only after that is settled, which means a leftover socket file can
 * be cleared away safely — by that point we know no live hub is using it.
 */
wss.on('listening', () => {
  log.warn(`hub listening for the app on ws://127.0.0.1:${config.port} — propose-and-review phase`);

  if (existsSync(SOCK)) {
    try { unlinkSync(SOCK); } catch (e) { log.warn(`could not clear the old socket file: ${e.message}`); }
  }

  const clientServer = createServer(handleClient);

  clientServer.on('error', (e) => {
    log.warn(`could not open the MCP socket at ${SOCK}: ${e.message}`);
    process.exit(1);
  });

  clientServer.listen(SOCK, () => {
    try { chmodSync(SOCK, 0o600); } catch {}
    log.warn(`hub ready for MCP servers on ${SOCK}`);
  });
});

wss.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Not a fault. Another hub is already doing this job.
    log.warn(`port ${config.port} is already held by another hub — standing down`);
    process.exit(0);
  }
  log.warn(`hub websocket error: ${e.message}`);
  process.exit(1);
});

const shutdown = () => {
  try { wss.close(); } catch {}
  try { if (existsSync(SOCK)) unlinkSync(SOCK); } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
