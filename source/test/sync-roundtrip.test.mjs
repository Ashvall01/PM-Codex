/**
 * THE SHEET ROUND TRIP — checks for saving to and loading from the Google Sheet.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every check stands for a way data used to be lost or changed on its way
 * through the Sheet, with nothing on screen to say so:
 *
 *   - A save the Sheet refused was counted as saved: the header said DB SYNCED
 *     and the start-up check then loaded the older Sheet copy over the edit.
 *   - Two saves at once could finish out of order and leave the older copy.
 *   - The timeline's holiday list was dropped on every reload.
 *   - A meeting time "10:00" came back as "1899-12-30T…".
 *   - An action item On Hold came back Open.
 *
 * The Sheet here is a stand-in that treats values the way Google Sheets and the
 * Apps Script do (see fakeSheet below). The runner sets the time zone to
 * Asia/Jakarta, whose 1899 offset (+07:07:12) is what makes the time serials odd.
 *
 * HOW TO RUN IT
 * -------------
 *   cd source && node test/run-sync-test.mjs
 */

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

// ------------------------------------------------------------ the fake Sheet
// Mirrors MOCK_GAS_SCRIPT plus Google Sheets' own coercion of cell values.
const sheet = {
  db: {},
  failWrites: false,      // Apps Script answers {status:'error'}
  httpStatus: 200,        // e.g. 500
  htmlReply: false,       // a Google sign-in page
  failReads: false,       // the Sheet cannot be reached for a read
  loadError: false,       // the script answers a read with {status:'error'}
  loads: 0,
  delayMs: 0,
  posts: 0,
  inFlight: 0,
  maxInFlight: 0,
};
const LMT_JAKARTA = (7 * 3600 + 7 * 60 + 12) * 1000;
const toCell = (val) => {
  if (Array.isArray(val) || (typeof val === 'object' && val !== null)) return JSON.stringify(val);
  if (typeof val === 'string') {
    if (/^\d+$/.test(val)) return { text: val };           // the script quotes digits
    if (/^[=+\-@]/.test(val)) return { text: val };        // and formula-like text
    if (val.startsWith("'")) return { text: val.slice(1) }; // apostrophe = text, not stored
    const t = val.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (t) {                                                 // Sheets makes "10:00" a time
      const ms = Date.UTC(1899, 11, 30, +t[1], +t[2], +(t[3] || 0)) - LMT_JAKARTA;
      return { date: new Date(ms).toISOString() };
    }
  }
  return val === undefined || val === null ? '' : val;
};
const fromCell = (c) => {
  if (c && typeof c === 'object' && 'text' in c) return c.text;
  if (c && typeof c === 'object' && 'date' in c) return c.date;
  if (typeof c === 'string' && (c.startsWith('[') || c.startsWith('{'))) { try { return JSON.parse(c); } catch { return c; } }
  return c;
};
const writeSheets = (payload) => {
  for (const [name, records] of Object.entries(payload)) {
    const headers = new Set();
    (records || []).forEach(r => Object.keys(r).forEach(k => headers.add(k)));
    sheet.db[name] = (records || []).map(r => Object.fromEntries([...headers].map(h => [h, toCell(r[h])])));
  }
};
const readSheets = () => Object.fromEntries(Object.entries(sheet.db).map(([n, rows]) =>
  [n, rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fromCell(v)])))]));

const reply = (status, body, type = 'application/json') => new Response(body, { status, headers: { 'Content-Type': type } });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if ((opts.method || 'GET') === 'POST') {
    sheet.posts++;
    sheet.inFlight++;
    sheet.maxInFlight = Math.max(sheet.maxInFlight, sheet.inFlight);
    try {
      if (sheet.delayMs) await new Promise(r => setTimeout(r, sheet.delayMs));
      if (sheet.httpStatus !== 200) return reply(sheet.httpStatus, 'Server error', 'text/plain');
      if (sheet.htmlReply) return reply(200, '<!DOCTYPE html><html><body>Sign in</body></html>', 'text/html');
      if (sheet.failWrites) return reply(200, JSON.stringify({ status: 'error', message: 'Exception: simulated failure' }));
      const incoming = JSON.parse(opts.body);
      // Google refuses a cell over 50,000 characters; the script reports it.
      for (const records of Object.values(incoming)) for (const r of records || []) for (const v of Object.values(r)) {
        const cell = Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
        if (cell.length > 50000) return reply(200, JSON.stringify({ status: 'error', message: 'Exception: Your input contains more than the maximum of 50000 characters in a single cell.' }));
      }
      writeSheets(incoming);
      return reply(200, JSON.stringify({ status: 'success' }));
    } finally {
      sheet.inFlight--;
    }
  }
  if (u.searchParams.get('action') === 'version') return reply(200, JSON.stringify({ version: '1.1.0-MVP' }));
  if (u.searchParams.get('action') === 'load') {
    if (sheet.failReads) throw new TypeError('Failed to fetch');
    if (sheet.loadError) return reply(200, JSON.stringify({ status: 'error', message: 'Exception: Service Spreadsheets timed out' }));
    sheet.loads++;
    return reply(200, JSON.stringify({ status: 'success', data: readSheets() }));
  }
  return reply(200, JSON.stringify({ status: 'ok' }));
};

// ------------------------------------------------------------------ the app
const { gasSyncService } = await import('./services/gasSyncService.js');
const { useAppStore } = await import('./store/appStore.js');
const { useTimelineStore } = await import('./store/timelineStore.js');
const { useTasksStore } = await import('./store/tasksStore.js');
const { useMomStore, normalizeMoMActionItemStatus } = await import('./store/momStore.js');
const { useSyncQueueStore } = await import('./store/syncQueueStore.js');
const { useCodexStore } = await import('./store/codexStore.js');
const { useRisksStore } = await import('./store/risksStore.js');
const { useAcrStore } = await import('./store/acrStore.js');

const URL_ = 'http://fake-sheet.test/exec';
const P = 'proj-1';
// The app logs as it saves; keep the output to the checks. Counted, so two
// overlapping runs do not restore each other's silence.
const realConsole = { log: console.log, error: console.error, warn: console.warn };
let quietDepth = 0;
const quiet = () => {
  if (quietDepth++ === 0) console.log = console.error = console.warn = () => {};
  return () => { if (--quietDepth === 0) Object.assign(console, realConsole); };
};
const run = async (fn) => { const restore = quiet(); try { return await fn(); } finally { restore(); } };

const resetAll = () => {
  sheet.db = {}; sheet.failWrites = false; sheet.httpStatus = 200; sheet.htmlReply = false; sheet.delayMs = 0; sheet.posts = 0; sheet.maxInFlight = 0;
  sheet.failReads = false; sheet.loadError = false; sheet.loads = 0;
  useAppStore.setState({ gasUrl: URL_, projects: [{ id: P, name: 'P', description: '', createdAt: 1 }], deletedRecordIds: [], syncStatus: 'idle', syncErrorMessage: null });
  useTimelineStore.setState({ projectTimelines: [] });
  useTasksStore.setState({ tasks: [] });
  useRisksStore.setState({ risks: [] });
  useMomStore.setState({ moms: [] });
  useCodexStore.setState({ pages: [] });
  useAcrStore.setState({ acrs: [] });
  useSyncQueueStore.setState({ jobs: [] });
  useAppStore.setState({ syncHeldBack: null });
  gasSyncService.allowLargeDeletionOnce = false;
  // The ordinary case: a browser that has read this Sheet before (an empty one).
  localStorage.setItem('pm-codex-sheet-row-counts', JSON.stringify({}));
  localStorage.setItem('pm-codex-sheet-row-counts-for', URL_);
};
/** A browser that has never read the Sheet: a new computer, another browser, cleared site data. */
const freshBrowser = () => {
  resetAll();
  localStorage.removeItem('pm-codex-sheet-row-counts');
  localStorage.removeItem('pm-codex-sheet-row-counts-for');
  useAppStore.setState({ projects: [] });
};
const task = (id, description) => ({ id, projectId: P, type: 'Action Item', createdDate: 1, description, status: 'Open', comments: [], linkedActivityIds: [] });

// ------------------------------------------------------------- fresh install
ok('a new install starts with no sample Codex pages', useCodexStore.getState().pages.length === 0,
   JSON.stringify(useCodexStore.getState().pages.map(p => p.title)));

// -------------------------------------------------------------- honest saves
resetAll();
useTasksStore.setState({ tasks: [task('t1', 'hello')] });
let saved = await run(() => gasSyncService.syncNow());
ok('a save the Sheet accepts reports success', saved === true && useAppStore.getState().syncStatus === 'synced');
ok('…and the record is in the Sheet', sheet.db.tasks?.[0]?.description === 'hello');

sheet.failWrites = true;
saved = await run(() => gasSyncService.syncNow());
ok('a save the Apps Script refuses is reported as failed', saved === false);
ok('…and the header shows the reason', useAppStore.getState().syncStatus === 'error'
   && /simulated failure/.test(useAppStore.getState().syncErrorMessage || ''), useAppStore.getState().syncErrorMessage);

sheet.failWrites = false; sheet.httpStatus = 500;
saved = await run(() => gasSyncService.syncNow());
ok('an HTTP error is a failed save', saved === false && useAppStore.getState().syncStatus === 'error');

sheet.httpStatus = 200; sheet.htmlReply = true;
saved = await run(() => gasSyncService.syncNow());
ok('a Google sign-in page instead of a save is a failed save', saved === false && /web page/.test(useAppStore.getState().syncErrorMessage || ''));
sheet.htmlReply = false;

// ------------------------------------------------------ the queue keeps work
resetAll();
useSyncQueueStore.getState().addJob('tasks', 't1', 'UPDATE', {});
sheet.failWrites = true;
await run(() => gasSyncService.processSyncQueue());
let jobs = useSyncQueueStore.getState().jobs;
ok('a failed save leaves the change waiting, not COMPLETED', jobs.length === 1 && jobs[0].status === 'PENDING' && jobs[0].retryCount === 1,
   JSON.stringify(jobs.map(j => [j.status, j.retryCount])));
for (let i = 0; i < 4; i++) await run(() => gasSyncService.processSyncQueue());
jobs = useSyncQueueStore.getState().jobs;
ok('after five failures the change is FAILED, still unsaved', jobs[0].status === 'FAILED');
ok('…and counts as unsaved work', await gasSyncService.hasUnsavedWork());
sheet.failWrites = false;
await run(() => gasSyncService.retryNow());
jobs = useSyncQueueStore.getState().jobs;
ok('RETRY sends it once the Sheet is back', jobs.every(j => j.status === 'COMPLETED') && useAppStore.getState().syncStatus === 'synced',
   JSON.stringify(jobs.map(j => j.status)));

// --------------------------------------------- start-up never loads over work
resetAll();
writeSheets({ tasks: [task('t1', 'old text in the Sheet')], projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] });
useTasksStore.setState({ tasks: [task('t1', 'NEW text only in this browser')] });
useSyncQueueStore.getState().addJob('tasks', 't1', 'UPDATE', {});
sheet.failWrites = true;
await run(() => gasSyncService.loadAll(URL_));
ok('when the waiting save fails at start-up, the Sheet copy is not loaded over it',
   useTasksStore.getState().tasks[0].description === 'NEW text only in this browser', useTasksStore.getState().tasks[0].description);

sheet.failWrites = false;
await run(() => gasSyncService.loadAll(URL_));
ok('once the Sheet accepts it, the edit is saved and survives the load',
   useTasksStore.getState().tasks[0].description === 'NEW text only in this browser'
   && sheet.db.tasks[0].description === 'NEW text only in this browser');

resetAll();
writeSheets({ tasks: [task('t1', 'old')], projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] });
useTasksStore.setState({ tasks: [task('t1', 'edited just before the tab closed')] });
useSyncQueueStore.setState({ jobs: [{ id: 'j1', timestamp: '', entityStore: 'tasks', entityId: 't1', actionType: 'UPDATE', payload: {}, status: 'SYNCING', retryCount: 0 }] });
await run(() => gasSyncService.loadAll(URL_));
ok('a save cut off when the tab closed is sent at the next start, not lost',
   sheet.db.tasks[0].description === 'edited just before the tab closed'
   && useTasksStore.getState().tasks[0].description === 'edited just before the tab closed');

// ------------------------------------------------------- one save at a time
resetAll();
useTasksStore.setState({ tasks: [task('t1', 'a')] });
sheet.delayMs = 40;
await run(() => Promise.all([gasSyncService.syncNow(), gasSyncService.syncNow(), gasSyncService.processSyncQueue()]));
ok('saves never overlap (each one wipes and rewrites every sheet)', sheet.maxInFlight === 1, `max ${sheet.maxInFlight} at once`);
useTasksStore.setState({ tasks: [task('t1', 'b')] });
const first = run(() => gasSyncService.syncNow());
useTasksStore.setState({ tasks: [task('t1', 'c')] });
const second = run(() => gasSyncService.syncNow());
await Promise.all([first, second]);
ok('the last save carries the newest state', sheet.db.tasks[0].description === 'c', sheet.db.tasks[0].description);

// --------------------------------------------------------------- holidays
resetAll();
useTimelineStore.setState({ projectTimelines: [{ projectId: P, activeRevisionId: 'r1', holidays: ['2026-10-20', '2026-12-25'],
  revisions: [{ id: 'r1', name: 'Plan', createdAt: 1, activities: [] }] }] });
await run(() => gasSyncService.syncNow());
useTimelineStore.setState({ projectTimelines: [] });
await run(() => gasSyncService.loadAll(URL_));
let tl = useTimelineStore.getState().projectTimelines[0];
ok('the holiday list comes back after a reload', JSON.stringify(tl?.holidays) === '["2026-10-20","2026-12-25"]', JSON.stringify(tl?.holidays));
await run(() => gasSyncService.syncNow());
ok('…and is still in the Sheet after the next save', /2026-10-20/.test(String(sheet.db.timelineRevisions[0].holidays)), String(sheet.db.timelineRevisions[0].holidays));


// ----------------------------------- archived risks, flags, edited comments
resetAll();
useRisksStore.setState({ risks: [
  { id: 'r1', projectId: P, riskId: 'R-1', riskDescription: 'live', status: 'Open', impactLevel: 'High', probability: 'Moderate', riskValue: 'High' },
  { id: 'r2', projectId: P, riskId: 'R-2', riskDescription: 'filed away', status: 'Mitigated', isArchived: true, archivedDate: 1790000000000 },
] });
useTasksStore.setState({ tasks: [{ ...task('t9', 'flagged one'), isFlagged: true,
  comments: [{ id: 'c1', text: 'reworded', timestamp: 5, author: 'User', editedAt: 9, editedBy: 'Assistant' }] }] });
await run(() => gasSyncService.syncNow());
useRisksStore.setState({ risks: [] });
useTasksStore.setState({ tasks: [] });
await run(() => gasSyncService.loadAll(URL_));
const rLoaded = useRisksStore.getState().risks;
const filed = rLoaded.find(r => r.id === 'r2');
const live = rLoaded.find(r => r.id === 'r1');
ok('an archived risk is still archived after a reload', !!filed && filed.isArchived === true && Number(filed.archivedDate) === 1790000000000, JSON.stringify(filed));
ok('an active risk stays active (never reads as archived)', !!live && !live.isArchived, JSON.stringify(live?.isArchived));
ok('getProjectRisks hides the archived one after a reload', useRisksStore.getState().getProjectRisks(P).length === 1);
const tLoaded = useTasksStore.getState().tasks[0];
ok('a flag survives a reload', tLoaded?.isFlagged === true, JSON.stringify(tLoaded?.isFlagged));
ok('an edited comment keeps its edit marks after a reload',
   tLoaded?.comments?.[0]?.text === 'reworded' && Number(tLoaded.comments[0].editedAt) === 9 && tLoaded.comments[0].editedBy === 'Assistant', JSON.stringify(tLoaded?.comments));

// ------------------------------------------------------------- meeting time
resetAll();
const mom = (id, time, actionItems = []) => ({ id, projectId: P, title: 'M', date: '2026-09-01', time, location: '', attendees: '', agenda: '', notes: '', keyDecisions: '', actionItems });
useMomStore.setState({ moms: [mom('m1', '10:00')] });
await run(() => gasSyncService.syncNow());
ok('a meeting time is stored as text, not turned into a time value', sheet.db.moms[0].time?.text === '10:00', JSON.stringify(sheet.db.moms[0].time));
useMomStore.setState({ moms: [] });
await run(() => gasSyncService.loadAll(URL_));
ok('…and reads back as 10:00', useMomStore.getState().moms[0]?.time === '10:00', useMomStore.getState().moms[0]?.time);

resetAll();
// A record already damaged the old way: 10:00 in Jakarta, as Sheets stored it.
sheet.db = { moms: [Object.fromEntries(Object.entries(mom('m1', '')).map(([k, v]) => [k, k === 'time' ? { date: '1899-12-30T02:52:48.000Z' } : toCell(v)]))],
             projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] };
await run(() => gasSyncService.loadAll(URL_));
ok('a time already stored as 1899-12-30T… is repaired to what the screen showed', useMomStore.getState().moms[0]?.time === '10:00', useMomStore.getState().moms[0]?.time);
ok('…and the repair is queued to be written back', useSyncQueueStore.getState().getPendingJobs().length === 1);
await run(() => gasSyncService.processSyncQueue());
ok('…and after that save the Sheet holds "10:00" as text', sheet.db.moms[0].time?.text === '10:00', JSON.stringify(sheet.db.moms[0].time));

// ------------------------------------------------------- action item status
resetAll();
ok('On Hold is a status an action item keeps', normalizeMoMActionItemStatus('On Hold') === 'On Hold' && normalizeMoMActionItemStatus('closed') === 'Done');
useMomStore.setState({ moms: [mom('m1', '09:30', [{ id: 'a1', description: 'x', assignee: 'y', status: 'On Hold' }])] });
await run(() => gasSyncService.syncNow());
useMomStore.setState({ moms: [] });
await run(() => gasSyncService.loadAll(URL_));
ok('an action item On Hold is still On Hold after a reload', useMomStore.getState().moms[0]?.actionItems[0]?.status === 'On Hold',
   useMomStore.getState().moms[0]?.actionItems[0]?.status);

// ------------------------------------------------ the large-deletion guard
resetAll();
const many = Array.from({ length: 30 }, (_, i) => task(`t${i}`, `task ${i}`));
writeSheets({ tasks: many, projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] });
await run(() => gasSyncService.loadAll(URL_));
ok('guard: a load brings every row in', useTasksStore.getState().tasks.length === 30);
// The browser's copy loses most of its tasks (storage cleared, a slip…).
useTasksStore.setState({ tasks: many.slice(0, 2) });
saved = await run(() => gasSyncService.syncNow());
ok('a save that would empty most of a sheet is held back', saved === false && sheet.db.tasks.length === 30,
   `saved=${saved}, sheet has ${sheet.db.tasks.length}`);
ok('…and the header says what and how many', /tasks & issues 30 → 2/.test(useAppStore.getState().syncHeldBack || '')
   && /held back/i.test(useAppStore.getState().syncErrorMessage || ''), useAppStore.getState().syncHeldBack);
useSyncQueueStore.getState().addJob('tasks', 't0', 'UPDATE', {});
await run(() => gasSyncService.processSyncQueue());
ok('…the queued change stays unsaved, the Sheet keeps all 30', sheet.db.tasks.length === 30
   && useSyncQueueStore.getState().jobs[0].status === 'PENDING');
await run(() => gasSyncService.confirmHeldSave());
ok('SAVE ANYWAY writes it', sheet.db.tasks.length === 2 && useAppStore.getState().syncHeldBack === null
   && useSyncQueueStore.getState().jobs.every(j => j.status === 'COMPLETED'), `sheet has ${sheet.db.tasks.length}`);
useTasksStore.setState({ tasks: many.slice(0, 1) });
saved = await run(() => gasSyncService.syncNow());
ok('…once: the next save is checked again, against the new count', saved === true && sheet.db.tasks.length === 1);

resetAll();
writeSheets({ tasks: many, projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] });
await run(() => gasSyncService.loadAll(URL_));
useTasksStore.setState({ tasks: many.slice(0, 22) });
saved = await run(() => gasSyncService.syncNow());
ok('ordinary deletions are not held back (30 → 22)', saved === true && sheet.db.tasks.length === 22);
useTasksStore.setState({ tasks: many.slice(0, 13) });
saved = await run(() => gasSyncService.syncNow());
ok('nor a big share of a small sheet (22 → 13 is 9 rows)', saved === true && sheet.db.tasks.length === 13);

// ------------------------------------- a browser that has never read the Sheet
// The Sheet is small on purpose: every sheet is under the guard's 10-row floor,
// so before this rule one edit in a new browser emptied all of it.
const theirSheet = () => writeSheets({
  projects: [{ id: P, name: 'P', description: '', createdAt: 1 }, { id: 'proj-2', name: 'Q', description: '', createdAt: 2 }],
  tasks: Array.from({ length: 6 }, (_, i) => task(`t${i}`, `task ${i}`)),
});
freshBrowser();
theirSheet();
useAppStore.setState({ projects: [{ id: 'proj-new', name: 'Made before the Sheet was read', description: '', createdAt: 3 }] });
useSyncQueueStore.getState().addJob('projects', 'proj-new', 'CREATE', {});
await run(() => gasSyncService.processSyncQueue());
ok('new browser: the first save reads the Sheet first', sheet.loads === 1, `loads=${sheet.loads}`);
ok('…the Sheet keeps every record it had', sheet.db.tasks.length === 6 && sheet.db.projects.some(p => p.id === 'proj-2'),
   `tasks ${sheet.db.tasks.length}, projects ${sheet.db.projects.map(p => p.id)}`);
ok('…and gains the record made in this browser', sheet.db.projects.some(p => p.id === 'proj-new') && sheet.db.projects.length === 3);
ok('…the browser now shows the Sheet\'s records too', useTasksStore.getState().tasks.length === 6 && useAppStore.getState().projects.length === 3);
ok('…and the change is marked saved', useSyncQueueStore.getState().jobs.find(j => j.entityId === 'proj-new')?.status === 'COMPLETED');

freshBrowser();
theirSheet();
sheet.failReads = true;
useAppStore.setState({ projects: [{ id: 'proj-new', name: 'N', description: '', createdAt: 3 }] });
saved = await run(() => gasSyncService.syncNow());
ok('new browser, Sheet unreachable: nothing is written', saved === false && sheet.posts === 0 && sheet.db.tasks.length === 6,
   `saved=${saved}, posts=${sheet.posts}`);
ok('…and the header says why, in plain words', useAppStore.getState().syncStatus === 'error'
   && /could not read your Google Sheet/.test(useAppStore.getState().syncErrorMessage || ''), useAppStore.getState().syncErrorMessage);
await run(() => gasSyncService.retryNow());
ok('…RETRY while it is still unreachable writes nothing either', sheet.posts === 0 && sheet.db.tasks.length === 6);
sheet.failReads = false;
await run(() => gasSyncService.retryNow());
ok('…once it can be read, RETRY merges and saves', sheet.db.tasks.length === 6 && sheet.db.projects.length === 3
   && useAppStore.getState().syncStatus === 'synced', `tasks ${sheet.db.tasks.length}, projects ${sheet.db.projects.length}`);

// An edit made here to a record the Sheet also holds, in a browser whose row
// counts are gone: the edit cannot be written first, so it must win the merge.
freshBrowser();
theirSheet();
useAppStore.setState({ projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] });
useTasksStore.setState({ tasks: [task('t0', 'edited here, not yet saved')] });
useSyncQueueStore.getState().addJob('tasks', 't0', 'UPDATE', {});
await run(() => gasSyncService.loadAll(URL_));
ok('never-read browser with unsaved work: its own edit survives the merge',
   useTasksStore.getState().tasks.find(t => t.id === 't0')?.description === 'edited here, not yet saved'
   && useTasksStore.getState().tasks.length === 6, JSON.stringify(useTasksStore.getState().tasks.map(t => t.description)));
ok('…and nothing was written before the read', sheet.posts === 0);
await run(() => gasSyncService.processSyncQueue());
ok('…then the edit reaches the Sheet, with the other five rows intact',
   sheet.db.tasks.length === 6 && sheet.db.tasks.find(t => t.id === 't0')?.description === 'edited here, not yet saved');

// Row counts remembered for one Sheet say nothing about another.
resetAll();
writeSheets({ tasks: [task('a1', 'in the first Sheet')], projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] });
await run(() => gasSyncService.loadAll(URL_));
const OTHER = 'http://fake-sheet.test/other/exec';
useAppStore.setState({ gasUrl: OTHER });
sheet.db = {};
writeSheets({ tasks: Array.from({ length: 4 }, (_, i) => task(`b${i}`, `other ${i}`)), projects: [{ id: 'proj-b', name: 'B', description: '', createdAt: 1 }] });
sheet.loads = 0; sheet.posts = 0;
saved = await run(() => gasSyncService.syncNow());
ok('after connecting a different Sheet, the first save reads it first', sheet.loads === 1 && saved === true, `loads=${sheet.loads}`);
ok('…so that Sheet\'s own records are still there', ['b0', 'b1', 'b2', 'b3'].every(id => sheet.db.tasks.some(t => t.id === id)) && sheet.db.projects.some(p => p.id === 'proj-b'),
   JSON.stringify(sheet.db.tasks.map(t => t.id)));

// A read the script answers with an error is an error, not "all saved".
resetAll();
theirSheet();
sheet.loadError = true;
let threw = false;
await run(() => gasSyncService.loadAll(URL_).catch(() => { threw = true; }));
ok('a read the script refuses is reported, not shown as saved', threw && useAppStore.getState().syncStatus === 'error'
   && /could not be read/.test(useAppStore.getState().syncErrorMessage || ''), useAppStore.getState().syncErrorMessage);
sheet.loadError = false;

// A browser at its storage limit: the Sheet is read, but the note that it was
// read cannot be stored. v1.3.0 then refused every save as "could not read".
{
  const realSetItem = localStorage.setItem;
  const full = (k, v) => { if (String(k).startsWith('pm-codex-sheet-row-counts')) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; } return realSetItem.call(localStorage, k, v); };

  // (1) An existing browser: counts from before the address was recorded, storage full.
  resetAll();
  writeSheets({ tasks: Array.from({ length: 6 }, (_, i) => task(`t${i}`, `task ${i}`)), projects: [{ id: P, name: 'P', description: '', createdAt: 1 }] });
  await run(() => gasSyncService.loadAll(URL_));
  localStorage.removeItem('pm-codex-sheet-row-counts-for');
  localStorage.setItem = full;
  useTasksStore.setState({ tasks: [...useTasksStore.getState().tasks, task('t-new', 'added with storage full')] });
  sheet.posts = 0; sheet.loads = 0;
  saved = await run(() => gasSyncService.syncNow());
  ok('storage full, existing browser: the save goes through', saved === true && sheet.db.tasks.length === 7 && useAppStore.getState().syncStatus === 'synced',
     `saved=${saved}, ${useAppStore.getState().syncErrorMessage}`);
  ok('…without reading the Sheet again first (it has read it)', sheet.loads === 0, `loads=${sheet.loads}`);

  // (2) A new browser, storage full from the start: reads first, then saves, and keeps saving.
  // (A new page: the in-memory counts last only as long as the page. A read
  // with storage working again clears them, as a reload would.)
  localStorage.setItem = realSetItem;
  await run(() => gasSyncService.loadAll(URL_));
  freshBrowser();
  theirSheet();
  localStorage.setItem = full;
  useAppStore.setState({ projects: [{ id: 'proj-new', name: 'N', description: '', createdAt: 3 }] });
  sheet.posts = 0; sheet.loads = 0;
  saved = await run(() => gasSyncService.syncNow());
  ok('storage full, new browser: it reads first, then the save goes through', saved === true && sheet.loads === 1 && sheet.db.tasks.length === 6 && sheet.db.projects.length === 3,
     `saved=${saved}, loads=${sheet.loads}, ${useAppStore.getState().syncErrorMessage}`);
  useTasksStore.setState({ tasks: [...useTasksStore.getState().tasks, task('t-more', 'second save')] });
  saved = await run(() => gasSyncService.syncNow());
  ok('…and the next save does not need another read', saved === true && sheet.loads === 1 && sheet.db.tasks.length === 7, `loads=${sheet.loads}`);
  // The guard still has its counts, from memory. (No change is waiting, so
  // the load below reads the Sheet rather than saving over it first.)
  useSyncQueueStore.setState({ jobs: [] });
  useTasksStore.setState({ tasks: [] });
  writeSheets({ tasks: Array.from({ length: 30 }, (_, i) => task(`g${i}`, `g ${i}`)), projects: sheet.db.projects.map(p => ({ id: p.id, name: p.name, description: '', createdAt: 1 })) });
  await run(() => gasSyncService.loadAll(URL_));
  useTasksStore.setState({ tasks: [] });
  saved = await run(() => gasSyncService.syncNow());
  ok('…and the large-deletion guard still works with storage full', saved === false && sheet.db.tasks.length === 30 && /tasks & issues 30 → 0/.test(useAppStore.getState().syncHeldBack || ''),
     `saved=${saved}, held=${useAppStore.getState().syncHeldBack}`);
  // Another Sheet is still "never read", storage full or not.
  useAppStore.setState({ gasUrl: 'http://fake-sheet.test/third/exec', syncHeldBack: null });
  sheet.loads = 0;
  await run(() => gasSyncService.syncNow());
  ok('…and a different Sheet is still read before its first save', sheet.loads === 1, `loads=${sheet.loads}`);
  localStorage.setItem = realSetItem;
  // Storage takes writes again: back to the stored counts.
  resetAll();
  await run(() => gasSyncService.loadAll(URL_));
}

// Two reads asked for at once are one read.
resetAll();
theirSheet();
await run(() => Promise.all([gasSyncService.loadAll(URL_), gasSyncService.loadAll(URL_)]));
ok('two loads asked for at once make one request', sheet.loads === 1, `loads=${sheet.loads}`);

// ------------------------------------------------------------ the cell limit
// One Sheet cell holds 50,000 characters. The stand-in refuses a longer one the
// way Google does, so a value that is not split fails here as it does there.
const longestCell = () => Math.max(0, ...Object.values(sheet.db).flatMap(rows => rows.flatMap(r => Object.values(r).map(c =>
  (typeof c === 'string' ? c : c && typeof c === 'object' ? String(c.text ?? c.date ?? '') : String(c)).length))));
const reload = async () => {            // what another browser, or the next start, would read
  useCodexStore.setState({ pages: [] }); useAcrStore.setState({ acrs: [] }); useTasksStore.setState({ tasks: [] });
  useSyncQueueStore.setState({ jobs: [] });
  await run(() => gasSyncService.loadAll(URL_));
};
const page = (content) => ({ id: 'c1', projectId: P, parentId: 'f1', title: 'Weekly status report', content, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' });

// The real case of 10 Nov 2026: a change request whose signed-off lines came to 66,657 characters.
resetAll();
const decided = Array.from({ length: 40 }, (_, i) => ({
  id: `d${i}`, name: 'updateMom', decision: i % 3 ? 'approved' : 'rejected', decidedAt: '2026-11-10T08:00:00.000Z',
  args: { id: `m${i}`, date: '2026-11-10', time: '10:00', discussion: `<p>It's line ${i} — “quoted”, [bracketed], {braced}, =formula, 'apostrophe'</p>`.repeat(14) },
  proposedArgs: { id: `m${i}`, discussion: `<p>original ${i}</p>`.repeat(20) },
}));
const acr = { id: '0bd2w3i', sessionId: 's1', projectId: P, origin: 'claude', status: 'approved', createdAt: '2026-11-10T07:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z', changes: [], decided };
ok('test set-up: the signed-off lines are longer than one cell', JSON.stringify(decided).length > 60000, String(JSON.stringify(decided).length));
useAcrStore.setState({ acrs: [acr] });
useTasksStore.setState({ tasks: [task('t1', 'an ordinary task')] });
saved = await run(() => gasSyncService.syncNow());
ok('a change request with a long signed-off list is saved (v1.3.0 refused the whole save)', saved === true && useAppStore.getState().syncStatus === 'synced',
   `saved=${saved}, ${useAppStore.getState().syncErrorMessage}`);
ok('…no cell in the Sheet is over the limit', longestCell() <= 50000, String(longestCell()));
ok('…the rest of the project is saved with it', sheet.db.tasks?.[0]?.description === 'an ordinary task');
await reload();
const back = useAcrStore.getState().acrs[0];
ok('…and reads back exactly as it was', JSON.stringify(back?.decided) === JSON.stringify(decided) && Array.isArray(back?.decided),
   `${typeof back?.decided}, ${JSON.stringify(back?.decided || '').length} chars`);
ok('…dates and times inside it keep their plain form', back?.decided?.[0]?.args?.date === '2026-11-10' && back?.decided?.[0]?.args?.time === '10:00', JSON.stringify(back?.decided?.[0]?.args?.date));
ok('…with no helper column left on any record', [...useAcrStore.getState().acrs, ...useTasksStore.getState().tasks].every(r => !Object.keys(r).some(k => /__part/.test(k))),
   Object.keys(back || {}).join(','));
saved = await run(() => gasSyncService.syncNow());
await reload();
ok('…and survives a second save and load unchanged', JSON.stringify(useAcrStore.getState().acrs[0]?.decided) === JSON.stringify(decided));

// Long text, with the characters Sheets and the script treat specially at every cut.
resetAll();
const tricky = ['\'', '[1,2,3]', '{"a":1}', '=SUM(A1)', '+1', '-1', '@x', '12.50', '2026-11-10', ' ', '~', '\n'];
let longText = '';
for (let i = 0; longText.length < 130000; i++) longText += tricky[i % tricky.length] + 'x'.repeat(997 + (i % 7));
for (const [name, content] of [
  ['three cells of awkward text', longText],
  ['text that begins like a list', '[1,2,3]' + 'y'.repeat(60000)],
  ['text whose first part alone is complete JSON', '["' + 'z'.repeat(30000) + '"]' + ' and then more'.repeat(2500)],
  ['text of apostrophes only', '\''.repeat(70000)],
  ['text of digits only', '7'.repeat(50001)],
]) {
  useCodexStore.setState({ pages: [page(content)] });
  saved = await run(() => gasSyncService.syncNow());
  const most = longestCell();
  await reload();
  ok(`a long Codex page comes back exactly: ${name}`, saved === true && most <= 50000 && useCodexStore.getState().pages[0]?.content === content,
     `saved=${saved}, longest cell ${most}, back ${useCodexStore.getState().pages[0]?.content?.length} of ${content.length}`);
}
useCodexStore.setState({ pages: [page('x'.repeat(50000))] });
saved = await run(() => gasSyncService.syncNow());
ok('exactly 50,000 characters still goes in one cell', saved === true && sheet.db.codexPages[0].content.length === 50000 && !Object.keys(sheet.db.codexPages[0]).some(k => /__part/.test(k)));
// Long, then shortened: the extra cells go away.
useCodexStore.setState({ pages: [page(longText)] });
await run(() => gasSyncService.syncNow());
useCodexStore.setState({ pages: [page('short again')] });
await run(() => gasSyncService.syncNow());
await reload();
ok('a page made short again is short in the Sheet and on reload', useCodexStore.getState().pages[0]?.content === 'short again'
   && !Object.keys(sheet.db.codexPages[0]).some(k => /__part/.test(k)), Object.keys(sheet.db.codexPages[0]).join(','));
// A list measured as the Sheet stores it.
resetAll();
const comments = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, text: 'y'.repeat(1000), createdAt: 1 }));
useTasksStore.setState({ tasks: [{ ...task('t1', 'a task with very long comments'), comments }] });
saved = await run(() => gasSyncService.syncNow());
await reload();
ok('a task whose comments exceed one cell is saved and read back whole', saved === true && useTasksStore.getState().tasks[0]?.comments?.length === 60
   && useTasksStore.getState().tasks[0].comments[59].text.length === 1000, `saved=${saved}, ${useTasksStore.getState().tasks[0]?.comments?.length}`);

// ------------------------------------------------------------- bulk import
resetAll();
useMomStore.getState().importMoms(P, [{ title: 'Bulk', actionItems: [{ description: 'd', assignee: 'a', status: 'Open', priority: 'High', dueDate: '2026-10-01', remarks: 'r', type: 'Issue', linkedActivityIds: ['x'] }] }]);
const bulk = useMomStore.getState().moms[0].actionItems[0];
ok('a bulk import keeps the action items\' task fields', bulk.priority === 'High' && bulk.estimatedResolutionDate === '2026-10-01'
   && bulk.remarks === 'r' && bulk.type === 'Issue' && bulk.linkedActivityIds?.[0] === 'x', JSON.stringify(bulk));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
