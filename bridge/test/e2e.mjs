/**
 * End-to-end test of the bridge, with no browser involved.
 *
 * Speaks real MCP over stdio to real server processes on one side, and connects
 * a fake PM Codex tab on the other. If this passes, the only thing left to
 * prove is the browser half.
 *
 * The section that matters most is the last one. A host application starts the
 * MCP server many times over — Cowork starts it four times in five seconds —
 * and the old single-process design meant only the first copy could reach the
 * browser while the rest became silent dead ends that still reported success.
 * "four copies at once" is the regression test for that, and it is the reason
 * hub.mjs exists.
 */

import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { loadConfig, hubSocketPath } from '../config.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const config = loadConfig();
const SOCK = hubSocketPath(config);
const ORIGIN = config.allowedOrigins[0];

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask any hub left over from an earlier run to stand down, so we start clean. */
function stopAnyHub() {
  return new Promise((resolve) => {
    const s = connect(SOCK);
    const done = () => { try { s.destroy(); } catch {} resolve(); };
    s.once('error', done);
    s.once('connect', () => {
      s.write(JSON.stringify({ id: 1, op: '__shutdown__' }) + '\n');
      setTimeout(done, 300);
    });
    setTimeout(done, 1500);
  });
}

/* ---------------------------- an MCP client ------------------------------- */

function startServer({ quiet = false } = {}) {
  const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (!quiet) proc.stderr.on('data', (d) => process.stdout.write(`      [server] ${d.toString().trim()}\n`));
  else proc.stderr.resume();

  let buffer = '';
  const waiters = new Map();
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const w = waiters.get(msg.id);
      if (w) { waiters.delete(msg.id); w(msg); }
    }
  });

  let rpcId = 0;
  const rpc = (method, params) => {
    const id = ++rpcId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout on ${method}`)), 25000);
      waiters.set(id, (m) => { clearTimeout(timer); resolve(m); });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  };
  const notify = (method, params) =>
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

  const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });

  return { proc, rpc, notify, call, kill: () => proc.kill() };
}

async function handshake(client) {
  const init = await client.rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'bridge-test', version: '1' },
  });
  client.notify('notifications/initialized');
  return init;
}

const textOf = (r) => r?.result?.content?.map((c) => c.text).join('\n') ?? '';
const jsonOf = (r) => { try { return JSON.parse(textOf(r)); } catch { return null; } };

/* ------------------------------ fake PM Codex tab ------------------------- */

/**
 * A stand-in for the browser tab.
 *
 * `rude: true` makes it ignore the maxChars the bridge sends, the way an older
 * build of the app would. That is what enforceCeiling in server.mjs exists for,
 * so it needs a way to happen on purpose.
 */
/** What the last discardChange carried, so a test can see the bridge passed it on. */
let lastDiscardParams = null;

const ALLOWED = new Set(['addTask', 'updateTask', 'updateProjectRisk', 'addProjectRisk', 'updateCodexPage', 'archiveTask', 'unarchiveTask', 'editTaskComment', 'flagTask', 'unflagTask', 'archiveProjectRisk']);

function fakeApp(origin, { rude = false } = {}) {
  let acr = null;
  const MODULES = {
    stakeholders: '=== STAKEHOLDERS (1) ===\nid | name\nSTK1 | [Client_A]',
    deliverables: '=== DELIVERABLES (2) ===\nid | title\nDEL1 | Migration plan\nDEL2 | Cutover runbook',
    risks: '=== RISKS (1) ===\nid | description\nRSK1 | Vendor SLA gap for [Client_A]',
  };
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}`, { origin });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', info: { app: 'FakePMCodex' } }));
      ws.send(JSON.stringify({ type: 'screen', screen: { module: 'risks', path: '/risks', activeProjectName: 'Apollo Migration' } }));
      // The user pressing Approve, as far as the bridge is concerned.
      ws.signOff = (outcome) => ws.send(JSON.stringify({ type: 'acrOutcome', outcome }));
      setTimeout(() => resolve(ws), 150);
    });
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const req = JSON.parse(raw.toString());
      if (typeof req.id !== 'number') return;
      const reply = (ok, payload) =>
        ws.send(JSON.stringify(ok ? { id: req.id, ok: true, data: payload } : { id: req.id, ok: false, error: payload }));

      if (req.op === 'getState') {
        const head = '=== PROJECT ===\nApollo Migration\n\n' + MODULES.risks;
        if (rude) return reply(true, head + '\n' + 'X'.repeat(200000));
        const budget = req.params?.maxChars;
        // Small enough to fit any sane budget, so the only way a module gets
        // held back here is if the bridge asked for something tiny.
        if (budget && budget < 400) {
          return reply(true, head + '\n\n=== DELIVERABLES (2) — HELD BACK ===\nCall get_module("deliverables").');
        }
        return reply(true, head + '\n\n' + MODULES.deliverables);
      }
      if (req.op === 'getModule') {
        const m = MODULES[req.params?.module];
        return m ? reply(true, m) : reply(false, `unknown module ${req.params?.module}`);
      }
      if (req.op === 'getFieldSchema') {
        const SCHEMAS = {
          risks: {
            module: 'risks',
            actions: ['addProjectRisk', 'updateProjectRisk', 'deleteProjectRisk'],
            fields: [
              { field: 'impactLevel', label: 'Impact Level', kind: 'enum', values: ['Positive (Opportunity)', 'Low', 'Moderate', 'High', 'Critical', 'Catastrophic'] },
              { field: 'probability', label: 'Probability', kind: 'enum', values: ['Rare', 'Low', 'Moderate', 'High', 'Almost Certain', 'Uncertain'] },
              { field: 'riskValue', label: 'Risk Value', kind: 'computed' },
            ],
            riskMatrix: { impactLevels: ['Low', 'Moderate', 'High'], probabilityLevels: ['Rare', 'Moderate', 'High'], riskValues: ['Low', 'Medium', 'High'], matrix: { Low: { Rare: 'Lowest' } }, rule: 'riskValue = matrix[impact][probability]' },
          },
          tasks: {
            module: 'tasks',
            actions: ['addTask', 'updateTask', 'deleteTask'],
            fields: [{ field: 'status', label: 'Status', kind: 'enum', values: ['Open', 'In Progress', 'On Hold', 'Blocked', 'Done', 'Dropped'] }],
          },
        };
        const schema = SCHEMAS[req.params?.module];
        return reply(true, schema || { module: req.params?.module, actions: [], fields: [], note: `No field rules recorded for module "${req.params?.module}".` });
      }
      if (req.op === 'listProjects') return reply(true, { activeProjectId: 'p1', projects: [{ id: 'p1', name: 'Apollo Migration', isActive: true }] });
      if (req.op === 'readItem') return reply(true, { id: req.params.id, type: req.params.type, riskDescription: 'Vendor SLA gap', owner: '[Client_A]' });
      if (req.op === 'search') return reply(true, { query: req.params.query, totalMatches: 1, results: { risks: [{ id: 'RSK1', riskDescription: 'Vendor SLA gap' }] }, archivedTasksNotSearched: 1 });
      // The archive. Deliberately holds a record that appears in NO module
      // above, so a check can prove read_archive reaches something the
      // snapshot does not.
      if (req.op === 'readArchive') {
        // Two archives since 12 Sep. The deliverables one lists SUBTREE ROOTS
        // only, and says how many records came with each root.
        const ARCHIVES = {
          tasks: [{ id: 'TSK9', type: 'Issue', description: 'Retired printer queue', status: 'Dropped', owner: '[Client_A]', archivedDate: '2026-09-01' }],
          deliverables: [{ id: 'DEL4', title: 'Retired vendor pack', status: 'Signed Off', owner: '[Client_A]', archivedWithIt: 2, archivedDate: '2026-09-02' }],
          risks: [{ id: 'RSK7', riskId: 'R-7', description: 'Settled vendor lock-in', status: 'Mitigated', owner: '[Client_A]', value: 'Low', archivedDate: '2026-10-06' }],
        };
        const mod = req.params?.module;
        const records = ARCHIVES[mod];
        if (!records) return reply(false, `no archive for module ${mod}`);
        const q = String(req.params?.query || '').toLowerCase();
        const text = (r) => String(r.description || r.title || '').toLowerCase();
        const matched = q ? records.filter((r) => text(r).includes(q)) : records;
        return reply(true, { module: mod, totalArchived: records.length, matched: matched.length, returned: matched.length, records: matched });
      }

      // --- Phase 2. A minimal stand-in for the change-request store. -------
      if (req.op === 'proposeChanges') {
        const bad = (req.params?.changes || []).filter((c) => !ALLOWED.has(c.action));
        if (bad.length) return reply(false, `cannot be applied by the approve button: ${bad.map((b) => b.action).join(', ')}`);
        acr = {
          id: 'acr1',
          status: 'pending',
          origin: 'claude',
          changes: (req.params.changes || []).map((c, i) => ({
            id: `chg${i + 1}`,
            title: c.title || `${c.action} action`,
            action: c.action,
            approved: true,
            args: c.args,
          })),
        };
        return reply(true, { acrId: acr.id, status: 'pending', proposed: acr.changes.map(({ id, title, action }) => ({ id, title, action })) });
      }
      if (req.op === 'acrStatus') {
        if (!acr) return reply(true, { total: 0, shown: 0, acrs: [] });
        if (req.params?.acrId) return reply(true, acr);
        return reply(true, { total: 1, shown: 1, acrs: [acr] });
      }
      if (req.op === 'capabilities') {
        return reply(true, { acrEditGuard: true });
      }
      if (req.op === 'discardChange') {
        lastDiscardParams = req.params || {};
        if (!acr) return reply(false, 'There is no pending change request of yours to take anything out of.');
        const before = acr.changes.length;
        acr.changes = acr.changes.filter((c) => c.id !== req.params?.changeId);
        if (acr.changes.length === before) return reply(true, { error: `No proposed change found with id "${req.params?.changeId}".` });
        const remaining = acr.changes.map(({ id, title, action }) => ({ id, title, action }));
        if (!acr.changes.length) acr = null;
        return reply(true, { acrId: 'acr1', removed: req.params.changeId, remaining });
      }
      return reply(false, `unknown op ${req.op}`);
    });
  });
}

/* ---------------------------------- run ----------------------------------- */

await stopAnyHub();
await sleep(300);

const main = startServer();
const init = await handshake(main);

check('MCP handshake', !!init?.result?.serverInfo, init?.result?.serverInfo?.name);
check('server sends standing instructions', /start_session first/i.test(init?.result?.instructions || ''),
  `${(init?.result?.instructions || '').length} chars`);

const tools = await main.rpc('tools/list', {});
const names = (tools?.result?.tools || []).map((t) => t.name).sort();
check('tools advertised', names.length === 13, names.join(', '));
check('read_archive is one of them', names.includes('read_archive'), names.join(', '));
check('get_module is offered', names.includes('get_module'));
check('get_field_schema is offered', names.includes('get_field_schema'), names.join(', '));

// --- the server starts a hub by itself, with nothing running ---------------
const statusOffline = await main.call('bridge_status');
const offline = jsonOf(statusOffline);
check('starts a hub on its own', offline?.hubReachable === true, `hub pid ${offline?.hubPid}`);
check('reports no tab while none is open', offline?.appConnected === false);

// --- with no app connected, every read must fail informatively -------------
const noApp = await main.call('start_session');
check('fails clearly when no tab is connected',
  noApp?.result?.isError === true && /not connected/i.test(textOf(noApp)),
  textOf(noApp).slice(0, 60) + '…');

// --- a page from an origin we do not trust must be refused -----------------
let rejected = false;
try {
  const bad = new WebSocket(`ws://127.0.0.1:${config.port}`, { origin: 'https://evil.example.com' });
  await new Promise((res) => {
    bad.on('close', (code) => { rejected = code === 1008; res(); });
    bad.on('error', () => { rejected = true; res(); });
    setTimeout(res, 2500);
  });
} catch { rejected = true; }
check('rejects an untrusted origin', rejected);

// --- now connect the fake tab ---------------------------------------------
const app = await fakeApp(ORIGIN);

const session = await main.call('start_session');
const sessionText = textOf(session);
check('start_session returns the directive', /MASTER DIRECTIVE/.test(sessionText) && /cartridge/i.test(sessionText));
check('start_session returns the project snapshot', /Apollo Migration/.test(sessionText));
check('start_session reports the current screen', /risks/.test(sessionText));
check('directive states that Claude proposes and the user decides',
  /propose/i.test(sessionText) && /nothing has changed/i.test(sessionText));

const item = await main.call('read_item', { items: [{ type: 'risk', id: 'RSK1' }] });
check('read_item round-trips', /Vendor SLA gap/.test(textOf(item)));
check('masked identities pass through untouched', /\[Client_A\]/.test(textOf(item)));

// One call, several records. The point is the user's activity log: ten reads
// showing as ten identical rows is noise they cannot skim.
const batch = await main.call('read_item', {
  items: [
    { type: 'risk', id: 'RSK1' },
    { type: 'task', id: 'TSK1' },
    { type: 'deliverable', id: 'DEL1' },
  ],
});
const batchText = textOf(batch);
check('read_item reads a batch in one call', /"requested": 3/.test(batchText));
check('a batch keeps every record', (batchText.match(/Vendor SLA gap/g) || []).length >= 3);

const partial = await main.call('read_item', {
  items: [{ type: 'risk', id: 'RSK1' }, { type: 'risk', id: 'NOPE' }],
});
check('one bad id does not sink the batch',
  /Vendor SLA gap/.test(textOf(partial)) && /"requested": 2/.test(textOf(partial)));

const tooMany = await main.call('read_item', {
  items: Array.from({ length: 30 }, () => ({ type: 'risk', id: 'RSK1' })),
});
check('read_item refuses an oversized batch',
  !!tooMany?.error || tooMany?.result?.isError === true,
  (tooMany?.error?.message || 'rejected by schema').slice(0, 50));

const found = await main.call('search_project', { query: 'vendor' });
check('search_project round-trips', /totalMatches/.test(textOf(found)));

const projects = await main.call('list_projects');
check('list_projects round-trips', /Apollo Migration/.test(textOf(projects)));

const screen = await main.call('get_current_screen');
check('get_current_screen reports the module', /risks/.test(textOf(screen)));

const statusOnline = jsonOf(await main.call('bridge_status'));
check('bridge_status sees the tab', statusOnline?.appConnected === true);
check('bridge_status declares proposal-only write access',
  /proposals only/i.test(String(statusOnline?.writeAccess)));
check('bridge_status probes what the tab can actually do',
  statusOnline?.clientSupports?.acrStatus === true,
  JSON.stringify(statusOnline?.clientSupports));
check('bridge_status probes the archive operation too',
  statusOnline?.clientSupports?.readArchive === true,
  JSON.stringify(statusOnline?.clientSupports));
// Two probes share the readArchive operation name, so each has its own key.
// This one is what catches a bundle that has the archive but not the
// deliverables half of it — the half-done upload of 12 Sep.
check('bridge_status probes the deliverables archive separately',
  statusOnline?.clientSupports?.readArchiveDeliverables === true,
  JSON.stringify(statusOnline?.clientSupports));
check('bridge_status probes the guard on the user\'s edits',
  statusOnline?.clientSupports?.acrEditGuard === true,
  JSON.stringify(statusOnline?.clientSupports));
check('bridge_status probes get_field_schema too',
  statusOnline?.clientSupports?.getFieldSchema === true,
  JSON.stringify(statusOnline?.clientSupports));
check('the mailbox count is named for what it counts',
  typeof statusOnline?.signOffsInMailbox === 'number');

/* ------------------- the session-start budget and its valve --------------- */

// The bridge must TELL the app how much room there is. Without that the app
// cannot trim itself, and the whole safety valve is decoration.
const budgeted = textOf(await main.call('start_session'));
check('start_session sends the app a character budget', /Migration plan/.test(budgeted),
  'app answered a budgeted getState');
check('start_session stays under the ceiling', budgeted.length <= config.snapshotBudgetChars,
  `${budgeted.length} of ${config.snapshotBudgetChars} chars`);

const mod = await main.call('get_module', { module: 'deliverables' });
check('get_module round-trips', /Cutover runbook/.test(textOf(mod)));
check('get_module passes masked identities through untouched',
  /\[Client_A\]/.test(textOf(await main.call('get_module', { module: 'stakeholders' }))));

/* ------------------------------ field schema ------------------------------ */
// Phase 3's last item: the exact rules behind a value, so a proposal cannot
// fail silently by sending "Medium" where the store only ever had "Moderate".

const riskSchema = jsonOf(await main.call('get_field_schema', { module: 'risks' }));
check('get_field_schema returns the risk enum fields',
  Array.isArray(riskSchema?.fields) && riskSchema.fields.some((f) => f.field === 'impactLevel' && Array.isArray(f.values)),
  JSON.stringify(riskSchema));
check('get_field_schema flags riskValue as computed, not settable',
  riskSchema?.fields?.find((f) => f.field === 'riskValue')?.kind === 'computed');
check('get_field_schema carries the live risk matrix',
  !!riskSchema?.riskMatrix?.matrix, JSON.stringify(riskSchema?.riskMatrix));
check('get_field_schema lists the actions that write this module',
  riskSchema?.actions?.includes('updateProjectRisk'), JSON.stringify(riskSchema?.actions));

const tasksSchema = jsonOf(await main.call('get_field_schema', { module: 'tasks' }));
check('get_field_schema answers a second module independently',
  tasksSchema?.module === 'tasks' && tasksSchema.fields?.some((f) => f.field === 'status'),
  JSON.stringify(tasksSchema));

const unknownSchema = await main.call('get_field_schema', { module: 'nonsense' });
const schemaRefused = !!unknownSchema?.error || unknownSchema?.result?.isError === true || /invalid|unknown/i.test(textOf(unknownSchema));
check('get_field_schema refuses a module outside its enum', schemaRefused,
  (unknownSchema?.error?.message || textOf(unknownSchema) || 'rejected by schema').slice(0, 60));

/* ------------------------------ the archive ------------------------------- */
// The archive is left out of the snapshot and out of search on purpose, so
// read_archive is the only way to it. These checks prove the way in exists and
// that it reaches something no other read does.

const snapshotText = textOf(await main.call('refresh_state'));
const archiveRead = textOf(await main.call('read_archive', { module: 'tasks' }));
check('read_archive returns an archived record', /Retired printer queue/.test(archiveRead));
check('and that record is in no module of the snapshot',
  !/Retired printer queue/.test(snapshotText));
check('read_archive passes masked identities through untouched',
  /\[Client_A\]/.test(archiveRead));
check('read_archive takes a keyword',
  /Retired printer queue/.test(textOf(await main.call('read_archive', { module: 'tasks', query: 'printer' }))));
const emptyQuery = textOf(await main.call('read_archive', { module: 'tasks', query: 'nothing matches this' }));
check('a query that matches nothing still says how big the archive is',
  /"totalArchived":\s*1/.test(emptyQuery) && /"matched":\s*0/.test(emptyQuery), emptyQuery.slice(0, 80));

// Deliverables got its own archive on 12 Sep, so it is no longer the example
// of a module without one. Documents still is, so this check should keep
// working for a while. (Risks joined the archive on 6 Oct 2026.)
check('read_archive reads the deliverables archive',
  /Retired vendor pack/.test(textOf(await main.call('read_archive', { module: 'deliverables' }))));
check('the deliverables archive says how many records came with a root',
  /"archivedWithIt":\s*2/.test(textOf(await main.call('read_archive', { module: 'deliverables' }))));

check('read_archive reads the risks archive',
  /Settled vendor lock-in/.test(textOf(await main.call('read_archive', { module: 'risks' }))));

const badArchive = await main.call('read_archive', { module: 'documents' });
const archiveRefused = !!badArchive?.error || badArchive?.result?.isError === true || /invalid|unknown|no archive/i.test(textOf(badArchive));
check('read_archive refuses a module that has no archive', archiveRefused,
  (badArchive?.error?.message || textOf(badArchive) || 'rejected by schema').slice(0, 60));

const archiveProposal = await main.call('propose_changes', {
  changes: [{ action: 'archiveTask', args: { id: 'TSK1' }, title: 'Archive a finished task' }],
});
check('archiveTask can be proposed', /pending/.test(textOf(archiveProposal)), textOf(archiveProposal).slice(0, 80));

// Added 6 Oct 2026: comment edits, flags and the risk archive travel the same road.
const newActions = await main.call('propose_changes', {
  changes: [
    { action: 'editTaskComment', args: { id: 'TSK1', commentId: 'c-1', text: 'Reworded' }, title: 'Reword a comment' },
    { action: 'flagTask', args: { id: 'TSK1' }, title: 'Flag a task' },
    { action: 'archiveProjectRisk', args: { id: 'RSK1' }, title: 'Archive a settled risk' },
  ],
});
check('comment edits, flags and risk archiving can be proposed', /pending/.test(textOf(newActions)), textOf(newActions).slice(0, 80));

const badModule = await main.call('get_module', { module: 'nonsense' });
const refused = !!badModule?.error || badModule?.result?.isError === true || /invalid|unknown/i.test(textOf(badModule));
check('get_module refuses an unknown module', refused,
  (badModule?.error?.message || textOf(badModule) || 'rejected by schema').slice(0, 60));

// --- the only write is a proposal ------------------------------------------
// Phase 1 asserted that no write tool existed at all. Phase 2 asserts the
// narrower thing that still matters: nothing here edits a record directly.
// propose_changes files a row for the user; anything named add/update/delete
// would not.
const directWrites = names.filter((n) => /^(add|create|update|delete|set)_/i.test(n));
check('no tool changes a record directly', directWrites.length === 0, directWrites.join(', ') || 'none');
check('propose_changes is offered', names.includes('propose_changes'));
check('discard_change is offered', names.includes('discard_change'));
check('get_acr_status is offered', names.includes('get_acr_status'));

// --- Phase 2: propose, review, withdraw ------------------------------------
const proposed = jsonOf(await main.call('propose_changes', {
  changes: [
    { action: 'updateProjectRisk', args: { id: 'RSK1', mitigation: 'Book a buffer sprint' }, title: 'Add a mitigation to the SLA risk' },
    { action: 'addTask', args: { title: 'Confirm vendor SLA' }, title: 'Create task: confirm vendor SLA' },
  ],
}));
check('propose_changes files one request for two edits',
  proposed?.status === 'pending' && proposed?.proposed?.length === 2, proposed?.acrId);

const refusedAction = await main.call('propose_changes', {
  changes: [{ action: 'reorderTimelineRow', args: { id: 'ACT1' } }],
});
check('propose_changes refuses an action the approve button cannot apply',
  /cannot be applied/i.test(textOf(refusedAction)));

const acrList = jsonOf(await main.call('get_acr_status'));
check('get_acr_status lists the pending request', acrList?.acrs?.[0]?.status === 'pending');
check('get_acr_status marks the request as Claude\u2019s', acrList?.acrs?.[0]?.origin === 'claude');

const acrOne = jsonOf(await main.call('get_acr_status', { acrId: 'acr1' }));
check('get_acr_status returns the arguments when asked for one request',
  /Book a buffer sprint/.test(JSON.stringify(acrOne?.changes || [])));

const discarded = jsonOf(await main.call('discard_change', { changeId: 'chg2' }));
check('discard_change withdraws one line and leaves the rest',
  discarded?.removed === 'chg2' && discarded?.remaining?.length === 1);

check('discard_change does not claim the user\'s say-so unless told to',
  lastDiscardParams?.discardUserEdit === undefined, JSON.stringify(lastDiscardParams));

const missingLine = await main.call('discard_change', { changeId: 'nope', discardUserEdit: true });
check('discard_change passes the user\'s say-so through to the tab',
  lastDiscardParams?.discardUserEdit === true, JSON.stringify(lastDiscardParams));
check('discard_change refuses a change id that is not there',
  /No proposed change found/i.test(textOf(missingLine)));

// --- Phase 2: the sign-off finds its way back to Claude --------------------
// MCP cannot interrupt a conversation, so the outcome must ride out on the
// next tool result, whatever that result was. This is the whole reason the
// approve button no longer answers Gemini.
app.signOff({
  acrId: 'acr1',
  status: 'approved',
  at: new Date().toISOString(),
  applied: [{ title: 'Add a mitigation to the SLA risk', action: 'updateProjectRisk' }],
  rejected: [],
});
await sleep(200);
const carrier = textOf(await main.call('list_projects'));
check('a sign-off rides out on the next tool result', /SIGNED OFF A CHANGE REQUEST/i.test(carrier));
check('the sign-off notice names what was applied', /Add a mitigation to the SLA risk/.test(carrier));
check('the sign-off notice tells Claude to refresh', /refresh_state/.test(carrier));

const second = textOf(await main.call('list_projects'));
check('a sign-off is delivered once, not on every call afterwards',
  !/SIGNED OFF A CHANGE REQUEST/i.test(second));

// A server copy that connects AFTER the fact must not be told about it. A
// restarted desktop app is exactly that, and on 7 Sep it replayed rejections
// the user had already dealt with into a conversation that had moved on.
const latecomer = startServer();
await handshake(latecomer);
const latecomerFirst = textOf(await latecomer.call('list_projects'));
check('a server that connects later is not told old news',
  !/SIGNED OFF A CHANGE REQUEST/i.test(latecomerFirst));

// bridge_status does not go through guarded(), so it has to drain the queue
// itself. It did not, and a sign-off could wait there indefinitely.
app.signOff({
  acrId: 'acr9',
  status: 'approved',
  at: new Date().toISOString(),
  applied: [{ title: 'Something the status tool must not swallow', action: 'addTask' }],
  rejected: [],
});
await sleep(200);
const viaStatus = textOf(await latecomer.call('bridge_status'));
check('bridge_status delivers a sign-off instead of swallowing it',
  /Something the status tool must not swallow/.test(viaStatus));
latecomer.kill();

/* ------------------- the regression that made the hub exist ---------------- */

// Four copies of the MCP server, started at once, exactly as the host does it.
// Under the old design the first copy took port 7799 and the other three became
// silent dead ends that still reported a healthy bridge. All four must now work,
// and all four must be talking to the same hub.
const crowd = [startServer({ quiet: true }), startServer({ quiet: true }), startServer({ quiet: true }), startServer({ quiet: true })];
await Promise.all(crowd.map(handshake));

const crowdStatus = await Promise.all(crowd.map((c) => c.call('bridge_status').then(jsonOf)));
const allSeeTab = crowdStatus.every((s) => s?.appConnected === true);
const hubPids = [...new Set(crowdStatus.map((s) => s?.hubPid))];

check('four copies at once — every copy reaches the tab', allSeeTab,
  crowdStatus.map((s) => (s?.appConnected ? 'ok' : 'DEAD')).join(', '));
check('four copies at once — all share one hub', hubPids.length === 1, `hub pids: ${hubPids.join(', ')}`);
check('four copies at once — no copy claims a port', crowdStatus.every((s) => s?.hubPid !== s?.mcpServerPid));

const crowdReads = await Promise.all(crowd.map((c) => c.call('list_projects').then(textOf)));
check('four copies at once — every copy can read', crowdReads.every((t) => /Apollo Migration/.test(t)),
  crowdReads.map((t) => (/Apollo Migration/.test(t) ? 'ok' : 'DEAD')).join(', '));

crowd.forEach((c) => c.kill());
await sleep(300);

// --- one copy going away must not disturb the others -----------------------
const survivor = jsonOf(await main.call('bridge_status'));
check('the hub survives its clients leaving', survivor?.appConnected === true);

// --- losing the tab mid-session must degrade cleanly -----------------------
app.close();
await sleep(500);
const afterDrop = await main.call('read_item', { items: [{ type: 'risk', id: 'RSK1' }] });
check('recovers cleanly when the tab closes',
  afterDrop?.result?.isError === true && /not connected/i.test(textOf(afterDrop)));

/* ---------- an app that ignores the budget must not break the session ------ */

// An older build of the app knows nothing about maxChars and answers with
// everything it has. The host would refuse a result that size, which is the
// failure this whole design exists to prevent. The bridge has to cut it itself.
const rudeApp = await fakeApp(ORIGIN, { rude: true });
const rude = textOf(await main.call('refresh_state'));
check('an over-budget app reply is cut, not refused', rude.length <= config.snapshotBudgetChars,
  `${rude.length} of ${config.snapshotBudgetChars} chars`);
// A trim that throws away the budget is a blackout wearing a trim's clothes.
check('a cut reply still fills the budget', rude.length > config.snapshotBudgetChars * 0.9,
  `${rude.length} of ${config.snapshotBudgetChars} chars`);
check('a cut reply says it was cut', /CUT SHORT/.test(rude));
check('a cut reply keeps the start of the payload', /Apollo Migration/.test(rude));
rudeApp.close();
await sleep(300);

/* --------------------------------- report --------------------------------- */

main.kill();
await stopAnyHub();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILURES:\n' + failed.map((f) => '  - ' + f.name).join('\n'));
  process.exit(1);
}
process.exit(0);
