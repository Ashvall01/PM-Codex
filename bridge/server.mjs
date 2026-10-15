#!/usr/bin/env node
/**
 * PM Codex Bridge — the MCP server (Phase 1, read-only).
 *
 * This file is the face Claude sees. It owns nothing: no port, no socket, no
 * memory of your project. Every question it is asked, it forwards to the hub
 * (hub.mjs), which owns the single connection to your browser tab.
 *
 * That split is the whole point. A host application may start this file many
 * times over — Cowork starts it four times in five seconds — and because no
 * copy owns anything, every copy works. The old design put the browser socket
 * in this file, so the first copy won and the rest became silent dead ends.
 *
 * If no hub is running, the first tool call starts one and waits for it. You
 * never have to start anything by hand.
 *
 * Phase 1 exposes reads only. Nothing in this file, and nothing in the hub, can
 * modify project data.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { loadConfig, hubSocketPath, makeLogger, HUB_PROTOCOL, HERE } from './config.mjs';

const config = loadConfig();
const log = makeLogger('mcp');
const SOCK = hubSocketPath(config);
const HUB_PATH = join(HERE, 'hub.mjs');
const STARTED_AT = new Date().toISOString();

let hubStatus = null; // whatever the hub last told us about itself

/**
 * The master directive. Lives in a plain file precisely so it can be edited and
 * reloaded without rebuilding the app — the whole point of moving it out of the
 * front-end source. Re-read on every call so edits take effect on the next new
 * conversation rather than requiring a restart.
 */
function loadDirective() {
  const path = join(HERE, 'directive.md');
  if (!existsSync(path)) return '(No directive file found at bridge/directive.md.)';
  try {
    // HTML comments in that file are notes to whoever edits it, not instructions
    // for the assistant. Sending them would waste context and invite confusion.
    return readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  } catch (e) {
    return `(bridge/directive.md could not be read: ${e.message})`;
  }
}

/* -------------------------------------------------------------- hub client */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let hubSocket = null;
let connecting = null;
let nextRequestId = 1;
const waiting = new Map();

function detach(reason) {
  if (hubSocket) {
    try { hubSocket.destroy(); } catch {}
    hubSocket = null;
  }
  for (const [id, waiter] of waiting) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error(reason));
    waiting.delete(id);
  }
}

function attach(socket) {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      collectSignOffs(msg);
      const waiter = waiting.get(msg.id);
      if (!waiter) continue;
      waiting.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.ok) waiter.resolve(msg.data);
      else waiter.reject(new Error(msg.error || 'the hub reported an unspecified error'));
    }
  });
  socket.on('close', () => detach('the connection to the bridge hub closed mid-request'));
  socket.on('error', () => detach('the connection to the bridge hub failed mid-request'));
}

function connectOnce() {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCK);
    const onError = (e) => { socket.destroy(); reject(e); };
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

/**
 * Which program to run the hub with.
 *
 * NEVER the host application's own binary. Inside Claude, process.execPath is
 * "Claude Helper (Plugin)". Launching that as a detached process makes macOS
 * see a second copy of a Claude helper starting by itself, and it asks the user
 * for their keychain password before it will run. The user then gets a password
 * prompt they did not ask for, from a bridge that has no business near their
 * keychain, and the hub sits blocked behind the dialog looking like a crash.
 *
 * So: a real node binary, always. The host's binary is used only in the case
 * where it genuinely is node.
 */
function looksLikeNode(path) {
  return /^node(\.exe)?$/i.test((path || '').split('/').pop() || '');
}

function isApplicationBinary(path) {
  return /\.app\//.test(path || '');
}

function nodeCandidates() {
  const seen = new Set();
  const list = [];
  const push = (c) => { if (c && !seen.has(c)) { seen.add(c); list.push(c); } };

  const exe = process.execPath;
  if (looksLikeNode(exe)) push(exe);            // it really is node — use it
  push('/usr/local/bin/node');
  push('/opt/homebrew/bin/node');
  push('/usr/bin/node');
  push('node');                                  // whatever PATH offers
  if (!looksLikeNode(exe) && !isApplicationBinary(exe)) push(exe);  // last resort
  return list;
}

let spawnAttempt = 0;

/**
 * Start a hub in the background. Safe to call from several copies at once: the
 * hub that loses the race for port 7799 exits by itself without complaint.
 *
 * The child's output goes to bridge.log, NOT to /dev/null. A hub that dies on
 * startup — a missing module, a binary that will not run a script — says why on
 * stderr and then is gone. Discarding that is how you end up staring at an
 * empty log wondering why nothing started.
 */
function spawnHub() {
  const candidates = nodeCandidates();
  const exe = candidates[spawnAttempt % candidates.length];
  spawnAttempt++;
  try {
    const out = openSync(join(HERE, 'bridge.log'), 'a');
    const child = spawn(exe, [HUB_PATH], {
      cwd: HERE,
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PM_CODEX_BRIDGE_LOG_IS_STDERR: '1' },
    });
    child.on('error', (e) => log.warn(`hub failed to start with "${exe}": ${e.message}`));
    child.unref();
    log.warn(`no hub was running; starting one with "${exe}"`);
  } catch (e) {
    log.warn(`could not start a hub with "${exe}": ${e.message}`);
  }
}

const NO_HUB =
  'The PM Codex bridge hub could not be started, so there is nothing to read from. ' +
  'This is a fault in the bridge itself rather than anything the user did. ' +
  'bridge/bridge.log records what happened.';

async function ensureHub() {
  if (hubSocket && !hubSocket.destroyed) return hubSocket;
  if (connecting) return connecting;

  connecting = (async () => {
    for (let attempt = 0; attempt < 28; attempt++) {
      try {
        const socket = await connectOnce();
        attach(socket);
        hubSocket = socket;
        await handshake();
        return hubSocket;
      } catch {
        // A spawn every fourth try, so each attempt gets a moment to bind the
        // port before the next candidate program is tried.
        if (attempt % 4 === 0) spawnHub();
        await sleep(250);
      }
    }
    throw new Error(NO_HUB);
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

/**
 * Check that the hub speaks our language. A hub left running from an older
 * edit of these files is asked to stand down, and the next attempt starts a
 * current one. Without this, editing hub.mjs would leave a stale copy holding
 * the port and you would be back to hunting processes by hand.
 */
async function handshake() {
  const status = await send('__status__', {}, 5000);
  hubStatus = status;
  if (status.protocol !== HUB_PROTOCOL) {
    log.warn(`hub speaks protocol ${status.protocol}, this server speaks ${HUB_PROTOCOL} — asking it to stand down`);
    try { await send('__shutdown__', {}, 3000); } catch {}
    detach('the hub was replaced with a newer one');
    await sleep(400);
    throw new Error('hub protocol mismatch; retrying with a fresh hub');
  }
}

function send(op, params = {}, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!hubSocket || hubSocket.destroyed) {
      reject(new Error('not connected to the bridge hub'));
      return;
    }
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`The bridge hub did not answer "${op}" in time.`));
    }, timeoutMs ?? config.requestTimeoutMs + 5000);

    waiting.set(id, { resolve, reject, timer });
    try {
      hubSocket.write(JSON.stringify({ id, op, params }) + '\n');
    } catch (e) {
      waiting.delete(id);
      clearTimeout(timer);
      reject(e);
    }
  });
}

async function callApp(op, params = {}) {
  await ensureHub();
  return send(op, params);
}

/* --------------------------------------------------------------- sign-offs */

/**
 * Outcomes of change requests Claude proposed, collected from hub replies and
 * held until the next tool result can carry them to Claude.
 */
let pendingSignOffs = [];

/**
 * How long an undelivered outcome is worth carrying.
 *
 * The hub expires its mailbox; this queue did not, so an outcome picked up
 * during a handshake could sit here indefinitely and surface much later. An
 * old sign-off is not news, and reporting one as if it just happened is how
 * you end up acting on something already undone.
 */
const SIGN_OFF_MAX_AGE_MS = 30 * 60 * 1000;

function collectSignOffs(msg) {
  if (Array.isArray(msg?.signOffs) && msg.signOffs.length) {
    const now = Date.now();
    pendingSignOffs = pendingSignOffs.concat(msg.signOffs.map((o) => ({ received: now, outcome: o })));
  }
}

/** Formats and clears whatever sign-offs are waiting. Empty string when none. */
function drainSignOffNotice() {
  if (!pendingSignOffs.length) return '';
  const floor = Date.now() - SIGN_OFF_MAX_AGE_MS;
  const items = pendingSignOffs.filter((e) => e.received >= floor).map((e) => e.outcome);
  pendingSignOffs = [];
  if (!items.length) return '';

  const lines = ['', '=== THE USER HAS SIGNED OFF A CHANGE REQUEST YOU PROPOSED ==='];
  for (const o of items) {
    lines.push('');
    lines.push(`Request ${o?.acrId || '(unknown)'} — ${o?.status || 'decided'} at ${o?.at || 'an unrecorded time'}.`);
    for (const c of o?.applied || []) lines.push(`  APPLIED  — ${c.title}${c.edited ? ' (the user edited it first)' : ''}`);
    for (const c of o?.rejected || []) lines.push(`  REJECTED — ${c.title}`);
  }
  lines.push('');
  lines.push('This happened after your last message, not because of the call you just made.');
  lines.push('Acknowledge it to the user. Anything marked APPLIED is now live in the project, so');
  lines.push('call refresh_state before you rely on the snapshot you already have.');
  lines.push('=== END OF SIGN-OFF NOTICE ===');
  return lines.join('\n');
}

/* ------------------------------------------------------------ mcp plumbing */

/**
 * The last line of defence on payload size.
 *
 * The app trims itself to the budget and says which modules it held back. This
 * is what happens when it does not — an older build that ignores maxChars, or a
 * single module larger than the whole budget. Cutting at a line boundary and
 * saying so is worse than a clean trim, but it is far better than the host
 * refusing the result, which is how this whole problem started.
 */
function enforceCeiling(text, budget) {
  if (typeof text !== 'string' || !budget || text.length <= budget) return text;

  const notice = [
    '',
    '=== NOTICE — THIS RESULT WAS CUT SHORT ===',
    `The app returned ${text.length.toLocaleString()} characters; this bridge allows ${budget.toLocaleString()}.`,
    'Everything above this line is complete. Everything after it is missing, and this bridge',
    'cannot say what it was. Use search_project and read_item to reach anything you expected',
    'to see here, and treat nothing below as absent until you have looked for it.',
  ].join('\n');

  const room = budget - notice.length;
  // Cut on a line boundary so the last row is whole — but only if there is one
  // nearby. A payload with few newlines in it would otherwise throw away most
  // of the budget to find one, which is how you turn a trim into a blackout.
  const boundary = text.lastIndexOf('\n', room);
  const cut = boundary > room * 0.8 ? boundary : room;
  return text.slice(0, cut) + notice;
}

const asText = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const asError = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/** Wraps a handler so a dropped tab reads as a clear instruction, not a stack trace. */
function guarded(fn) {
  return async (args) => {
    try {
      const value = await fn(args);
      const notice = drainSignOffNotice();
      if (!notice) return asText(value);
      const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return asText(`${body}\n${notice}`);
    } catch (e) {
      // A failed call still delivers the news. Losing a sign-off because a
      // tab was mid-reload is exactly the kind of silent gap this phase is
      // meant to close.
      const notice = drainSignOffNotice();
      return asError(notice ? `${e.message}\n${notice}` : e.message);
    }
  };
}

/**
 * Read-only operations used to work out which bridge client the tab is running.
 * Add one whenever a new operation lands in bridgeClient.ts, so a partial
 * deploy is caught by bridge_status instead of by a confusing failure later.
 */
const CLIENT_PROBES = [
  { name: 'acrStatus', params: { limit: 1 } },
  // Added 12 Sep with the archive. A tab running the old client answers
  // "unknown operation" here, which is the whole point: bridge_status says the
  // upload is half done instead of read_archive failing mysteriously later.
  { name: 'readArchive', params: { module: 'tasks', limit: 1 } },
  // Deliverables joined the archive later the same day. Two probes now share an
  // operation NAME, so each carries its own `key` — without it the second would
  // overwrite the first in the report and the tasks probe would vanish.
  // This one is what catches a half-done upload: an older bundle answers
  // 'tasks' happily and rejects 'deliverables'.
  { key: 'readArchiveDeliverables', name: 'readArchive', params: { module: 'deliverables', limit: 1 } },
  // Added 6 Oct 2026 with the risk archive.
  { key: 'readArchiveRisks', name: 'readArchive', params: { module: 'risks', limit: 1 } },
  // Added 22 Sep with get_field_schema (Phase 3's last item).
  { name: 'getFieldSchema', params: { module: 'risks' } },
  // Added 30 Sep with the guard on the user's edits to a pending line. A tab
  // without it withdraws and merges over those edits with no check, so a
  // false here matters more than it looks.
  { key: 'acrEditGuard', name: 'capabilities' },
];

/** How many records one read_item call may fetch. */
const READ_BATCH_MAX = 25;

const server = new McpServer(
  { name: 'pm-codex-bridge', version: '0.4.0' },
  {
    instructions: [
      'You are connected to PM Codex, a project management app the user runs in their browser.',
      '',
      'ALWAYS call start_session first, before answering anything about the project. It returns',
      'the master directive that governs how you behave here, along with a snapshot of the',
      'current project. Do not answer project questions from memory or assumption before that.',
      '',
      'You may PROPOSE changes, but you may never make one. propose_changes files a batch of edits',
      'as a single change request. The user approves or rejects it in the app, with the same buttons',
      'they have always used. Until they do, nothing has changed. Never tell the user a change is',
      'done because you proposed it. Read the records you are about to change first — read_item or',
      'get_module — because a proposal built on the summary alone will overwrite fields you never saw.',
      'Before proposing a value for a field you are not sure of — a status, an impact level, a',
      'risk\'s probability — call get_field_schema for that module. A value spelled slightly wrong',
      '(the wrong Low/Medium/High scale, for example) can fail an add or update silently.',
      'The outcome of a sign-off reaches you attached to your next tool result.',
      '',
      'Tasks, issues, deliverables and risks can be ARCHIVED. An archived record is NOT in the snapshot',
      'and NOT in search_project — read_archive is the only way to list them. read_item still works',
      'on one. An archived record is read-only: propose unarchiveTask, unarchiveDeliverable or',
      'unarchiveProjectRisk before proposing any change to it. A deliverable archives together with every',
      'sub-deliverable nested beneath it, and they come back together, so one archive line can move',
      'several records.',
      '',
      'A comment already on a task or deliverable can be edited: read_item lists each comment with its',
      'id, then propose editTaskComment or editDeliverableComment with { id, commentId, text } — the whole',
      'new text. It can be any comment, the user\'s included; the user sees old and new and signs off.',
      'A task can be flagged or unflagged with flagTask / unflagTask { id }; read_item shows isFlagged.',
      '',
      'Names and organisations may appear as placeholder tokens such as [Client_A]. That is the',
      'app masking real identities before they reach you. Use the tokens as-is; the app turns them',
      'back into real names in its own interface. Never guess what a token stands for.',
    ].join('\n'),
  }
);

server.registerTool(
  'start_session',
  {
    title: 'Start a PM Codex session',
    description:
      'Call this FIRST in any conversation about the project. Returns the master directive, a full snapshot of the active project, and what the user is currently looking at. Everything it returns stays in context, so you do not need to call it again unless the project changes substantially.',
    inputSchema: {},
  },
  guarded(async () => {
    await ensureHub();

    // The directive and the section labels share the budget with the snapshot,
    // so the app is told how much room is actually left rather than the whole
    // figure. Measured, not guessed — the directive is a local file.
    const directive = loadDirective();
    const overhead = directive.length + 600;
    const roomForSnapshot = Math.max(4000, config.snapshotBudgetChars - overhead);

    // Both in one go, and both fresh. Reading the screen from a status cached
    // earlier in the process reports where the user was when this copy of the
    // server started, which may be long before they opened anything.
    const [status, snapshot] = await Promise.all([
      send('__status__'),
      send('getState', { maxChars: roomForSnapshot }),
    ]);
    hubStatus = status;
    const screen = status.currentScreen ?? null;
    return enforceCeiling([
      '=== MASTER DIRECTIVE ===',
      directive,
      '',
      '=== CURRENT SCREEN ===',
      screen ? JSON.stringify(screen) : '(the app has not reported a screen yet)',
      '',
      '=== PROJECT SNAPSHOT ===',
      snapshot,
      '',
      '=== NOTE ===',
      'This snapshot is a summary. Use read_item to pull the full detail of anything you intend to reason about seriously, and search_project to find things by keyword. If any module above says HELD BACK, call get_module for it before you say anything about that module. You may propose changes with propose_changes, but you cannot make one — the user approves them in the app.',
    ].join('\n'), config.snapshotBudgetChars);
  })
);

server.registerTool(
  'read_item',
  {
    title: 'Read records in full',
    description:
      'Full detail of one or more records — the descriptions, remarks and comments that the snapshot strips out. Use this before drawing any conclusion about a specific item. Ask for EVERY record you need in ONE call: a batch costs the same as a single read and keeps the user\'s activity log readable. Types may be mixed in one batch.',
    inputSchema: {
      items: z
        .array(
          z.object({
            type: z
              .enum(['task', 'deliverable', 'risk', 'document', 'stakeholder', 'codexPage', 'mom', 'timelineActivity', 'milestone'])
              .describe('Which kind of record to read.'),
            id: z.string().describe('The record id, as it appears in the project snapshot.'),
          })
        )
        .min(1)
        .max(READ_BATCH_MAX)
        .describe(`The records to read, up to ${READ_BATCH_MAX} at a time. One entry reads one record; several entries read them all in one go.`),
    },
  },
  guarded(async (args) => {
    const items = args?.items || [];

    // The hub matches replies by id, so these can all be in flight at once.
    // A record that cannot be found comes back as its own error rather than
    // failing the batch — one bad id must not cost the other nine reads.
    const results = await Promise.all(
      items.map((it) =>
        callApp('readItem', it).then(
          (data) => ({ type: it.type, id: it.id, data }),
          (e) => ({ type: it.type, id: it.id, error: e.message })
        )
      )
    );

    // If EVERY read failed, the fault is the call, not the records — a closed
    // tab fails all of them the same way. Returning that as a successful result
    // full of error objects is exactly the quiet failure this bridge keeps
    // getting caught by, so it is raised as a real error instead.
    const failed = results.filter((r) => r.error);
    if (failed.length === results.length) throw new Error(failed[0].error);

    if (results.length === 1) return results[0].data;
    return enforceCeiling(
      JSON.stringify({ requested: results.length, records: results }, null, 2),
      config.snapshotBudgetChars
    );
  })
);

server.registerTool(
  'search_project',
  {
    title: 'Search the whole project',
    description:
      'Keyword search across tasks, deliverables, risks, stakeholders, codex pages, meeting minutes and the timeline at once. Use this to check whether something already exists before assuming it does not.',
    inputSchema: {
      query: z.string().describe('Words to look for. Case-insensitive, matched as a substring.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum results per module. Defaults to 10.'),
    },
  },
  guarded((args) => callApp('search', args))
);

server.registerTool(
  'read_archive',
  {
    title: 'Read archived records',
    description:
      'The archived records of one module, newest archive first. Archived records are deliberately left out of the project snapshot and out of search_project, so this is the only way to list them. Use it when the user asks about finished, dropped or "old" work, or when something you expected to find is not in the snapshot. An archived record is READ-ONLY: propose unarchiveTask, unarchiveDeliverable or unarchiveProjectRisk before proposing any other change to it. read_item still returns one in full by its id. For deliverables only SUBTREE ROOTS are listed: a sub-deliverable archived with its parent is filed under that parent rather than listed separately, and restoring the parent restores it too.',
    inputSchema: {
      module: z
        .enum(['tasks', 'deliverables', 'risks'])
        .describe('Which archive to read. Tasks and issues, deliverables, or risks.'),
      query: z
        .string()
        .optional()
        .describe('Optional words to look for. Case-insensitive, matched as a substring of the description, owner, remarks, source, status or type.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many records to return. Default 25, maximum 100.'),
    },
  },
  guarded(async (args) => enforceCeiling(await callApp('readArchive', args), config.snapshotBudgetChars))
);

server.registerTool(
  'get_current_screen',
  {
    title: 'See what the user is looking at',
    description:
      'The module the user currently has open and, where applicable, the record they have selected. Use this to resolve vague references like "this task" or "add two days to this".',
    inputSchema: {},
  },
  guarded(async () => {
    await ensureHub();
    const status = await send('__status__');
    hubStatus = status;
    if (!status.appConnected) throw new Error(status.hint || 'PM Codex is not connected to the bridge. Ask the user to open or reload the tab.');
    return status.currentScreen || '(the app has not reported a screen yet — ask the user to click something)';
  })
);

server.registerTool(
  'list_projects',
  {
    title: 'List projects',
    description:
      'Every project in the app, marking which one is active. Reads are scoped to the active project; the user switches it in the app.',
    inputSchema: {},
  },
  guarded(() => callApp('listProjects'))
);

server.registerTool(
  'refresh_state',
  {
    title: 'Re-read the project snapshot',
    description:
      'Pulls a fresh snapshot. Use after the user says they have changed something in the app, or when a previous read looks stale.',
    inputSchema: {},
  },
  guarded(async () =>
    enforceCeiling(await callApp('getState', { maxChars: config.snapshotBudgetChars }), config.snapshotBudgetChars)
  )
);

server.registerTool(
  'get_module',
  {
    title: 'Read one module of the project in full',
    description:
      'One whole module of the project snapshot — every record in it, at skeleton detail. Call this for any module the snapshot marks HELD BACK, before saying anything about that module. Also useful on its own when you want one module without re-reading the whole project.',
    inputSchema: {
      module: z
        .enum(['project', 'stakeholders', 'billing', 'timeline', 'tasks', 'deliverables', 'risks', 'documents', 'moms', 'codex'])
        .describe('Which module to read. The name is printed in the HELD BACK notice.'),
    },
  },
  guarded(async (args) =>
    enforceCeiling(await callApp('getModule', args), config.snapshotBudgetChars)
  )
);

server.registerTool(
  'get_field_schema',
  {
    title: 'Field rules for a module',
    description:
      "The constrained fields for one module: exact enum values a proposal must match, fields the store computes itself that a proposal should never set, and (for risks) the live impact-by-probability matrix. Call this before propose_changes for any status, level or risk field — a value spelled slightly differently from the store's own list (the app's generic Low/Medium/High scale instead of a risk's Impact/Probability scale, for example) can fail an add or update with no visible error.",
    inputSchema: {
      module: z
        .enum(['project', 'stakeholders', 'billing', 'timeline', 'tasks', 'deliverables', 'risks', 'documents', 'moms', 'codex'])
        .describe('Which module\'s field rules to read. Same names as get_module.'),
    },
  },
  guarded((args) => callApp('getFieldSchema', args))
);

server.registerTool(
  'propose_changes',
  {
    title: 'Propose a batch of changes',
    description:
      'Files a batch of edits as ONE Assistant Change Request for the user to approve or reject in the app. Archiving is here too: archiveTask / archiveDeliverable / archiveProjectRisk put a record away, the matching unarchive action brings it back, and an archived record is read-only until it is restored — an update, comment, comment edit or flag aimed at one is refused. Comments and flags: editTaskComment / editDeliverableComment { id, commentId, text } change a comment already on the record (read_item gives each comment its id), and flagTask / unflagTask { id } set the flag on a task. This does NOT change the project. Nothing happens until the user signs off, and you find out on your next tool call. Read every record you intend to change first — an update carries only the fields you send, so proposing from the summary alone loses detail you never looked at. Ids may be the aliases you saw in the snapshot; they are translated here. A change aimed at a record that does not exist (deleted since you read it, or a wrong id) refuses the whole batch. While a request is pending, a new proposal for a record already in it is merged into that line — unless the user has edited the line, in which case the batch is refused and the error carries the user\'s version.',
    inputSchema: {
      changes: z
        .array(
          z.object({
            action: z
              .string()
              .describe('The action name, for example addTask, updateProjectRisk, updateCodexPage. An action the approve button cannot carry out is refused, and the error lists the ones it can.'),
            args: z
              .record(z.any())
              .describe('The arguments for that action. For an update, include id plus only the fields that change.'),
            title: z
              .string()
              .optional()
              .describe('A short plain-language title for this one change, as the user will read it in the review list. Omit to let the app write one.'),
          })
        )
        .min(1)
        .describe('The batch. Related edits belong in one call so the user reviews them together.'),
    },
  },
  guarded((args) => callApp('proposeChanges', args))
);

server.registerTool(
  'discard_change',
  {
    title: 'Withdraw one proposed change',
    description:
      'Takes a single line back out of your pending change request, for when the user says one item is wrong but the rest is fine. Call get_acr_status first to get the change id. Withdrawing the last line removes the whole request. A withdrawn line is deleted, not kept anywhere. A line the user has edited in the app (get_acr_status marks it userEdited) is theirs: withdrawing it is refused, and the refusal gives you their version to build on.',
    inputSchema: {
      changeId: z.string().describe('The id of the proposed change, from get_acr_status.'),
      acrId: z
        .string()
        .optional()
        .describe('The change request it belongs to. Optional; used only to check you mean the request that is actually pending.'),
      discardUserEdit: z
        .boolean()
        .optional()
        .describe('Only when the user has told you to throw away their own edit to this line. Without it, a line the user edited is never withdrawn.'),
    },
  },
  guarded((args) => callApp('discardChange', args))
);

server.registerTool(
  'get_acr_status',
  {
    title: 'Read change requests',
    description:
      'The Assistant Change Requests in the active project: what has been proposed, what the user approved, and what they rejected. Without an acrId you get a list, newest first, with a one-line title per proposed change. With an acrId you get that one request in full, including the arguments of every change. A line the user edited in the app is marked userEdited: its args are the user\'s version and proposedArgs is what you sent. Call this before discarding or re-proposing a change, and before telling the user what is waiting for them.',
    inputSchema: {
      acrId: z
        .string()
        .optional()
        .describe('Read one change request in full. Omit to list them.'),
      limit: z
        .number()
        .int()
        .optional()
        .describe('How many requests to list. Default 10, maximum 50. Ignored when acrId is given.'),
    },
  },
  guarded((args) => callApp('acrStatus', args))
);

server.registerTool(
  'bridge_status',
  {
    title: 'Check the bridge connection',
    description:
      'Whether the PM Codex tab is currently connected, and which parts of the bridge are running. Use this to diagnose why other tools are failing before telling the user something is broken.',
    inputSchema: {},
  },
  async () => {
    const me = { mcpServerPid: process.pid, mcpServerStartedAt: STARTED_AT, protocol: HUB_PROTOCOL };

    let status;
    try {
      await ensureHub();
      status = await send('__status__');
      hubStatus = status;
    } catch (e) {
      // bridge_status does not go through guarded(), so it has to drain the
      // queue itself. It did not, and a sign-off collected during a handshake
      // waited here until some other tool happened to be called.
      const failNotice = drainSignOffNotice();
      return asText({
        ...me,
        hubReachable: false,
        appConnected: false,
        signOffNotice: failNotice || undefined,
        writeAccess: 'proposals only — the user approves in the app',
        phase: 'Phase 2 — propose and review',
        problem: e.message,
        hint: 'The hub is the part that talks to the browser. Without it nothing can be read. bridge/bridge.log says why it did not start.',
      });
    }

    // What the tab can actually do beats what it says it is. The phase string
    // in the hello message does not change between builds of the same phase,
    // so on 7 Sep it could not confirm a client upload had landed. Asking the
    // tab to perform a read-only operation that only the current client knows
    // is exact. It catches a client missing an operation; it cannot catch one
    // whose behaviour changed but whose operations did not — that still needs
    // a live test.
    let clientSupports = null;
    if (status.appConnected) {
      clientSupports = {};
      for (const op of CLIENT_PROBES) {
        // `key` where two probes share an operation name, so neither is lost.
        const key = op.key || op.name;
        try {
          await send(op.name, op.params);
          clientSupports[key] = true;
        } catch (e) {
          // "no archive for module X" is an older client answering an operation
          // it has with a module it does not, which is exactly the half-done
          // upload this probe is here to name.
          clientSupports[key] = /unknown operation|no archive for module/i.test(e.message)
            ? false
            : `could not tell: ${e.message}`;
        }
      }
    }

    return asText({
      ...me,
      hubReachable: true,
      clientSupports,
      clientSupportsNote: 'Read-only probes of the tab. A false here means the tab is running an older bridge client than this server, and nothing else it reports can be trusted until it is redeployed and reloaded.',
      hubPid: status.hubPid,
      hubStartedAt: status.hubStartedAt,
      mcpClientsOnThisHub: status.mcpClients,
      listeningOn: status.listeningOn,
      appConnected: status.appConnected,
      app: status.app,
      currentScreen: status.currentScreen,
      writeAccess: 'proposals only — the user approves in the app',
      phase: 'Phase 2 — propose and review',
      signOffsInMailbox: status.signOffsInMailbox,
      signOffsNote: 'How many outcomes the mailbox is holding, not how many are undelivered. A delivered one still counts until its 30-minute life runs out.',
      signOffNotice: drainSignOffNotice() || undefined,
      hint: status.appConnected ? undefined : 'Ask the user to open or reload the PM Codex tab.',
    });
  }
);

/* ------------------------------------------------------------------ launch */

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
