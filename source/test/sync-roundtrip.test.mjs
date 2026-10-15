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
      writeSheets(JSON.parse(opts.body));
      return reply(200, JSON.stringify({ status: 'success' }));
    } finally {
      sheet.inFlight--;
    }
  }
  if (u.searchParams.get('action') === 'version') return reply(200, JSON.stringify({ version: '1.1.0-MVP' }));
  if (u.searchParams.get('action') === 'load') return reply(200, JSON.stringify({ status: 'success', data: readSheets() }));
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
  useAppStore.setState({ gasUrl: URL_, projects: [{ id: P, name: 'P', description: '', createdAt: 1 }], deletedRecordIds: [], syncStatus: 'idle', syncErrorMessage: null });
  useTimelineStore.setState({ projectTimelines: [] });
  useTasksStore.setState({ tasks: [] });
  useRisksStore.setState({ risks: [] });
  useMomStore.setState({ moms: [] });
  useSyncQueueStore.setState({ jobs: [] });
  useAppStore.setState({ syncHeldBack: null });
  gasSyncService.allowLargeDeletionOnce = false;
  localStorage.removeItem('pm-codex-sheet-row-counts');
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

// ------------------------------------------------------------- bulk import
resetAll();
useMomStore.getState().importMoms(P, [{ title: 'Bulk', actionItems: [{ description: 'd', assignee: 'a', status: 'Open', priority: 'High', dueDate: '2026-10-01', remarks: 'r', type: 'Issue', linkedActivityIds: ['x'] }] }]);
const bulk = useMomStore.getState().moms[0].actionItems[0];
ok('a bulk import keeps the action items\' task fields', bulk.priority === 'High' && bulk.estimatedResolutionDate === '2026-10-01'
   && bulk.remarks === 'r' && bulk.type === 'Issue' && bulk.linkedActivityIds?.[0] === 'x', JSON.stringify(bulk));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
