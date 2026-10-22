/**
 * THE REVIEW OF A CHANGE REQUEST, 22 OCT 2026 — checks for
 * services/acrSignOff.ts, utils/acrGroups.ts, the change-request store and the
 * bridge client.
 *
 * What the user asked for, and what each section below stands for:
 *   1. Approve some lines and keep the rest open to discuss with the AI.
 *   2. Headed groups, so twenty open lines read as a few sections.
 *   3. A proposal for a second project landed in the first project's request
 *      (Claude files everything under one session id) and was invisible where
 *      the user was. One request per project now.
 *   7. Claude reads and proposes into any project, not only the open one —
 *      masked with THAT project's privacy glossary.
 *   8. Claude and Gemini read timeline baselines other than the one on screen.
 *
 * HOW TO RUN IT
 *   cd source && node test/run-acr-review-test.mjs
 */

const sockets = [];
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
}
globalThis.WebSocket = FakeWebSocket;
globalThis.window.location = { origin: 'http://localhost:7800', pathname: '/overview' };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

const { useAcrStore, takeAcrMergeRefusals, takeChangeGroup } = await import('./store/acrStore.js');
const { useAppStore } = await import('./store/appStore.js');
const { useTasksStore } = await import('./store/tasksStore.js');
const { usePIIStore } = await import('./store/piiStore.js');
const { useTimelineStore } = await import('./store/timelineStore.js');
const { signOffAcrLines, openLineIds } = await import('./services/acrSignOff.js');
const { groupAcrLines, hasNamedGroups, UNGROUPED_TITLE } = await import('./utils/acrGroups.js');
const { getSanitizedProjectModule, readTimelineBaseline, buildProjectSkeleton } = await import('./services/aiContextEngine.js');
const { stopBridgeClient } = await import('./services/bridgeClient.js');

const A = 'project-a';
const B = 'project-b';
useAppStore.setState({
  activeProjectId: A,
  projects: [
    { id: A, name: 'Alpha Rollout', description: '', createdAt: 0 },
    { id: B, name: 'Bravo Migration', description: '', createdAt: 0 },
  ],
});
const task = (id, projectId = A, extra = {}) => ({
  id, projectId, type: 'Action Item', createdDate: 0, description: id, status: 'Open', comments: [], linkedActivityIds: [], ...extra,
});
const resetTasks = () => useTasksStore.setState({ tasks: [task('A1'), task('A2'), task('A3'), task('B1', B, { description: 'Ask Hana Okafor for the sign-off' })] });
resetTasks();
// Only project B's glossary knows this name. Project A's is empty.
usePIIStore.setState({ entries: [
  { id: 'pii-1', projectId: B, originalTerm: 'Hana Okafor', placeholder: '[Redacted_Name_1]', type: 'Name', notes: '', variations: [] },
] });

const acr = () => useAcrStore.getState();
const reset = () => { useAcrStore.setState({ acrs: [], activeAcrId: null, activeAcrChangeId: null }); takeAcrMergeRefusals(); resetTasks(); };
const taskById = (id) => useTasksStore.getState().tasks.find((t) => t.id === id);

const socket = sockets[0];
let nextId = 1;
const call = (op, params) => {
  const id = nextId++;
  socket.onmessage({ data: JSON.stringify({ id, op, params }) });
  return socket.sent.find((m) => m.id === id);
};

/* ------------------------------------------- 3. one request per project */

reset();
{
  const a = acr().createAcr(A, 'claude-bridge', [{ name: 'updateTask', args: { id: 'A1', remarks: 'for A' } }], 'claude');
  const b = acr().createAcr(B, 'claude-bridge', [{ name: 'updateTask', args: { id: 'B1', remarks: 'for B' } }], 'claude');
  ok('a proposal for a second project makes its own request', a && b && a !== b && acr().acrs.length === 2, JSON.stringify(acr().acrs.map((x) => x.projectId)));
  ok('…filed under that project', acr().acrs.find((x) => x.id === b)?.projectId === B && acr().acrs.find((x) => x.id === a)?.changes.length === 1);
  const a2 = acr().createAcr(A, 'claude-bridge', [{ name: 'updateTask', args: { id: 'A2', remarks: 'more for A' } }], 'claude');
  ok('a later proposal for the first project still joins its own request', a2 === a && acr().acrs.find((x) => x.id === a).changes.length === 2);
  ok('getPendingAcrForSession can be asked per project',
     acr().getPendingAcrForSession('claude-bridge', B)?.id === b && acr().getPendingAcrForSession('claude-bridge', A)?.id === a);
}

/* -------------------------------- 1. signing off part of a request */

reset();
{
  const id = acr().createAcr(A, 'gemini-chat', [
    { name: 'updateTask', args: { id: 'A1', remarks: 'one' } },
    { name: 'updateTask', args: { id: 'A2', remarks: 'two' } },
    { name: 'updateTask', args: { id: 'A3', remarks: 'three' } },
  ]);
  const [l1, l2, l3] = acr().acrs[0].changes;

  const r1 = signOffAcrLines(id, [l1.id], 'applied');
  const now = acr().acrs[0];
  ok('approving one line applies that line', taskById('A1').remarks === 'one', JSON.stringify(taskById('A1')));
  ok('…and nothing else', taskById('A2').remarks === undefined && taskById('A3').remarks === undefined);
  ok('…the request stays open', now.status === 'pending' && r1 && !r1.closed);
  ok('…with the other lines still open', now.changes.map((c) => c.id).join() === [l2.id, l3.id].join());
  ok('…and the decided line kept, marked applied', now.decided?.length === 1 && now.decided[0].id === l1.id && now.decided[0].decision === 'applied' && !!now.decided[0].decidedAt);

  const r2 = signOffAcrLines(id, [l2.id], 'rejected');
  ok('rejecting a line applies nothing', taskById('A2').remarks === undefined && r2.decidedLines[0].decision === 'rejected');
  ok('…and leaves the last line open', acr().acrs[0].changes.length === 1 && acr().acrs[0].status === 'pending');
  ok('openLineIds lists only what is open', openLineIds(id).join() === l3.id);

  const r3 = signOffAcrLines(id, [l3.id], 'rejected');
  ok('deciding the last open line closes the request', r3.closed && acr().acrs[0].status === 'approved', acr().acrs[0].status);
  ok('…approved, because one line was applied', acr().acrs[0].decided.length === 3 && acr().acrs[0].changes.length === 0);
  ok('a closed request cannot be signed off again', signOffAcrLines(id, [l3.id], 'applied') === null);
}

reset();
{
  const id = acr().createAcr(A, 'gemini-chat', [
    { name: 'updateTask', args: { id: 'A1', remarks: 'x' } },
    { name: 'updateTask', args: { id: 'A2', remarks: 'y' } },
  ]);
  signOffAcrLines(id, openLineIds(id), 'rejected');
  ok('rejecting every line closes the request as rejected', acr().acrs[0].status === 'rejected' && taskById('A1').remarks === undefined);
}

reset();
{
  // Applied against the REQUEST's project, not the open one.
  const id = acr().createAcr(B, 'claude-bridge', [{ name: 'addTask', args: { description: 'Made in Bravo', type: 'Action Item', status: 'Open' } }], 'claude');
  signOffAcrLines(id, openLineIds(id), 'applied');
  const made = useTasksStore.getState().tasks.find((t) => t.description === 'Made in Bravo');
  ok('a line is applied to the project its request belongs to, whatever is open', made?.projectId === B, JSON.stringify(made));
}

reset();
{
  const id = acr().createAcr(A, 'gemini-chat', [
    { name: 'updateTask', args: { id: 'A1', remarks: 'first' } },
    { name: 'updateTask', args: { id: 'A2', remarks: 'keep open' } },
  ]);
  const [l1] = acr().acrs[0].changes;
  signOffAcrLines(id, [l1.id], 'applied');
  acr().createAcr(A, 'gemini-chat', [{ name: 'updateTask', args: { id: 'A1', status: 'Done' } }]);
  const open = acr().acrs[0].changes;
  ok('a new proposal for a record already applied is a new open line, not merged into the decided one',
     open.length === 2 && open.some((c) => c.args.id === 'A1' && c.args.status === 'Done') && acr().acrs[0].decided[0].args.status === undefined,
     JSON.stringify(open.map((c) => c.args)));

  // Withdrawing every open line after a partial sign-off finishes the request.
  for (const c of [...acr().acrs[0].changes]) {
    acr().createAcr(A, 'gemini-chat', [{ name: 'discardPendingACRChange', args: { changeId: c.id } }]);
  }
  ok('withdrawing the last open line finishes a partly signed-off request (it is not deleted)',
     acr().acrs.length === 1 && acr().acrs[0].status === 'approved' && acr().acrs[0].decided.length === 1, JSON.stringify(acr().acrs));
}

/* ----------------------------------------------------- 2. headed groups */

reset();
{
  const lifted = takeChangeGroup({ id: 'A1', remarks: 'x', changeGroup: '  MoM 22 Oct   — follow-ups ' });
  ok('the group heading is lifted out of the arguments', lifted.group === 'MoM 22 Oct — follow-ups' && !('changeGroup' in lifted.args) && lifted.args.remarks === 'x', JSON.stringify(lifted));
  ok('arguments without one are left alone', takeChangeGroup({ id: 'A1' }).group === undefined);

  const id = acr().createAcr(A, 'gemini-chat', [
    { name: 'updateTask', args: { id: 'A1', remarks: 'a', changeGroup: 'Follow-ups' } },
    { name: 'updateTask', args: { id: 'A2', remarks: 'b' } },
    { name: 'updateTask', args: { id: 'A3', remarks: 'c', changeGroup: 'Clean-up' } },
    { name: 'addTask', args: { description: 'new', changeGroup: 'follow-ups' } },
  ]);
  const lines = acr().acrs[0].changes;
  ok('each line keeps its heading', lines[0].group === 'Follow-ups' && lines[1].group === undefined && lines[2].group === 'Clean-up');
  ok('…and its arguments carry no heading', lines.every((c) => !('changeGroup' in c.args)));
  const groups = groupAcrLines(lines);
  ok('lines are grouped by heading, in order of first appearance, ungrouped last',
     groups.map((g) => g.title).join('|') === `Follow-ups|Clean-up|${UNGROUPED_TITLE}`, groups.map((g) => g.title).join('|'));
  ok('headings match regardless of case', groups[0].changes.length === 2);
  ok('hasNamedGroups tells a grouped request from a plain one', hasNamedGroups(lines) && !hasNamedGroups([lines[1]]));

  // A merge keeps the heading unless the new proposal sends one.
  acr().createAcr(A, 'gemini-chat', [{ name: 'updateTask', args: { id: 'A1', status: 'Done' } }]);
  ok('a merged proposal without a heading keeps the line\'s heading', acr().acrs[0].changes[0].group === 'Follow-ups' && acr().acrs[0].changes[0].args.status === 'Done');
  acr().createAcr(A, 'gemini-chat', [{ name: 'updateTask', args: { id: 'A1', changeGroup: 'Moved' } }]);
  ok('…and takes a new one when sent', acr().acrs[0].changes[0].group === 'Moved');

  signOffAcrLines(id, groupAcrLines(acr().acrs[0].changes).find((g) => g.title === 'Clean-up').changes.map((c) => c.id), 'applied');
  ok('a whole group can be signed off at once', taskById('A3').remarks === 'c' && acr().acrs[0].changes.length === 3);
  ok('the record never receives the heading', !('changeGroup' in taskById('A3')) && !('group' in taskById('A3')));
}

/* ---------------------------------------- the bridge client (Claude) */

reset();
{
  const caps = call('capabilities', {});
  ok('capabilities reports the 22 Oct features (bridge_status probes them)',
     caps?.data?.partialSignOff === true && caps.data.acrGroups === true && caps.data.crossProject === true && caps.data.timelineBaselines === true, JSON.stringify(caps));

  const filed = call('proposeChanges', { changes: [
    { action: 'updateTask', args: { id: 'A1', remarks: 'r1' }, title: 'One', group: 'Group one' },
    { action: 'updateTask', args: { id: 'A2', remarks: 'r2' }, title: 'Two', group: 'Group one' },
    { action: 'updateTask', args: { id: 'A3', remarks: 'r3' }, title: 'Three' },
  ] });
  ok('Claude files lines with group headings', filed?.ok && filed.data.proposed.filter((p) => p.group === 'Group one').length === 2, JSON.stringify(filed));
  const acrId = filed.data.acrId;
  const lines = acr().acrs[0].changes;
  ok('…stored on the line, not in the arguments', lines[0].group === 'Group one' && !('changeGroup' in lines[0].args));

  // Partial sign-off, reported to Claude with what is still open.
  socket.readyState = 1;
  socket.sent.length = 0;
  signOffAcrLines(acrId, [lines[0].id], 'applied');
  const notices = () => socket.sent.filter((m) => m.type === 'acrOutcome').map((m) => m.outcome);
  let out = notices();
  ok('a partial sign-off is reported to Claude at once', out.length === 1 && out[0].status === 'pending', JSON.stringify(out));
  ok('…naming what was applied, with its group', out[0]?.applied?.length === 1 && out[0].applied[0].title === 'One' && out[0].applied[0].group === 'Group one');
  ok('…and what is still open, with ids to work with', out[0]?.stillOpen?.map((c) => c.title).join() === 'Two,Three' && out[0].stillOpen.every((c) => !!c.id));
  ok('…and which project', out[0]?.project === 'Alpha Rollout');

  const status = call('acrStatus', { acrId });
  ok('get_acr_status shows a partly signed-off request', status?.data?.partlySignedOff === true && status.data.changes.length === 2 && status.data.decided?.[0]?.decision === 'applied', JSON.stringify(status?.data));
  ok('…with its groups', JSON.stringify(status.data.groups) === JSON.stringify([{ title: 'Group one', lines: 1 }, { title: UNGROUPED_TITLE, lines: 1 }]), JSON.stringify(status.data.groups));

  signOffAcrLines(acrId, openLineIds(acrId), 'rejected');
  out = notices();
  ok('the last sign-off closes the request and is reported too', out.length === 2 && out[1].status === 'approved' && out[1].rejected.length === 2 && out[1].stillOpen.length === 0, JSON.stringify(out[1]));
  socket.readyState = 0;
}

/* ----------------------------- 7. Claude in a project that is not open */

reset();
{
  const notOpen = call('readItem', { type: 'task', id: 'B1' });
  ok('without `project`, reads stay in the open project', notOpen?.ok && /No task found/.test(notOpen.data?.error || ''), JSON.stringify(notOpen));

  const read = call('readItem', { type: 'task', id: 'B1', project: 'Bravo Migration' });
  ok('with `project`, a record in another project is read', read?.ok && read.data?.id === 'B1', JSON.stringify(read));
  ok('…masked with THAT project\'s glossary', /\[Redacted_Name_1\]/.test(read.data.description) && !/Hana Okafor/.test(JSON.stringify(read.data)), read.data?.description);
  ok('…and labelled as coming from it', read.data?.fromProject === 'Bravo Migration');

  ok('a project can be named by id, or by name in any case',
     call('readItem', { type: 'task', id: 'B1', project: B })?.data?.id === 'B1' && call('readItem', { type: 'task', id: 'B1', project: 'bravo  migration' })?.data?.id === 'B1');
  const unknown = call('readItem', { type: 'task', id: 'B1', project: 'Charlie' });
  ok('an unknown project is refused with a pointer to list_projects', unknown?.ok === false && /list_projects/.test(unknown.error || ''), JSON.stringify(unknown));

  const searched = call('search', { query: 'sign-off', project: 'Bravo Migration' });
  ok('search_project reaches another project', searched?.ok && searched.data.results.tasks.length === 1, JSON.stringify(searched?.data?.results?.tasks));

  const snap = call('getState', { project: 'Bravo Migration', maxChars: 50000 });
  ok('refresh_state with `project` returns that project\'s snapshot, labelled', snap?.ok && /=== PROJECT: Bravo Migration/.test(snap.data) && /B1|TSK/.test(snap.data), String(snap?.data).slice(0, 200));

  const filed = call('proposeChanges', { project: 'Bravo Migration', changes: [
    { action: 'updateTask', args: { id: 'B1', remarks: 'Chase [Redacted_Name_1] on Friday' }, title: 'Remind [Redacted_Name_1]' },
  ] });
  ok('Claude files a request in a project that is not open', filed?.ok && acr().acrs[0]?.projectId === B, JSON.stringify(filed));
  ok('…unmasked with that project\'s glossary', acr().acrs[0].changes[0].args.remarks === 'Chase Hana Okafor on Friday', acr().acrs[0].changes[0].args.remarks);
  ok('…and told where the user will review it', /not the project open in the app/.test(filed.data.note), filed.data.note);

  const listA = call('acrStatus', {});
  ok('the open project\'s list does not show it, but points to it',
     listA?.ok && listA.data.total === 0 && listA.data.pendingInOtherProjects?.[0]?.project === 'Bravo Migration', JSON.stringify(listA?.data));
  const listB = call('acrStatus', { project: 'Bravo Migration' });
  ok('get_acr_status with `project` lists it', listB?.data?.total === 1);

  const projects = call('listProjects', {});
  ok('list_projects says where Claude has open proposals', projects?.data?.projects?.find((p) => p.id === B)?.yourOpenProposals === 1, JSON.stringify(projects?.data));

  const withdrawn = call('discardChange', { project: 'Bravo Migration', changeId: acr().acrs[0].changes[0].id });
  ok('discard_change with `project` withdraws a line there', withdrawn?.ok && acr().acrs.length === 0, JSON.stringify(withdrawn));

  const missing = call('proposeChanges', { project: 'Bravo Migration', changes: [{ action: 'updateTask', args: { id: 'A1', remarks: 'x' } }] });
  ok('a change aimed at a record of a different project is refused', missing?.ok === false && /Bravo Migration/.test(missing.error || ''), JSON.stringify(missing));
}

/* --------------------------------------------- 8. timeline baselines */

{
  useTimelineStore.setState({ projectTimelines: [{
    projectId: A,
    activeRevisionId: 'rev-2',
    holidays: [],
    revisions: [
      { id: 'rev-1', name: 'Initial Plan', createdAt: Date.UTC(2026, 6, 1), activities: [
        { id: 'act-1', phase: 'Build', activity: 'Workflow', subActivity: 'Design v1', weight: 1, progress: 0, status: 'Planned', owner: '', targetStartDate: '2026-07-01', targetCompletionDate: '2026-07-31', actualStartDate: '', actualCompletionDate: '', remarks: '' },
      ] },
      { id: 'rev-2', name: 'Re-plan September', createdAt: Date.UTC(2026, 8, 1), activities: [
        { id: 'act-2', phase: 'Build', activity: 'Workflow', subActivity: 'Design v2', weight: 1, progress: 0.5, status: 'Work In Progress', owner: '', targetStartDate: '2026-09-01', targetCompletionDate: '2026-10-15', actualStartDate: '', actualCompletionDate: '', remarks: '' },
      ] },
    ],
  }] });

  const skeleton = buildProjectSkeleton(A);
  ok('the snapshot shows the active baseline and names the others, with how to read them',
     /TIMELINE — Re-plan September/.test(skeleton) && /Other baselines: Initial Plan \(2026-07-01, 1 rows\)/.test(skeleton) && /get_module "timeline"/.test(skeleton), skeleton.split('\n').filter((l) => /TIMELINE|baselines/.test(l)).join(' / '));

  const other = getSanitizedProjectModule('timeline', A, { baseline: 'initial plan' });
  ok('get_module "timeline" with a baseline reads that baseline', /Initial Plan/.test(other) && /Design v1/.test(other) && !/Design v2/.test(other), other.slice(0, 300));
  ok('…marked as not the active one', /NOT the active baseline/.test(other));
  ok('…and names the active one among the others', /Re-plan September \[active\]/.test(other));
  ok('an unknown baseline is answered with the list', /No timeline baseline "Nope".*"Initial Plan".*"Re-plan September"/.test(getSanitizedProjectModule('timeline', A, { baseline: 'Nope' })));

  const viaBridge = call('getModule', { module: 'timeline', baseline: 'Initial Plan' });
  ok('the bridge passes the baseline through', viaBridge?.ok && /Design v1/.test(viaBridge.data), String(viaBridge?.data).slice(0, 200));

  const listed = readTimelineBaseline(A);
  ok('getTimelineBaseline (Gemini) lists the baselines', listed.baselines?.length === 2 && listed.baselines.find((b) => b.isActive)?.name === 'Re-plan September');
  const one = readTimelineBaseline(A, 'rev-1');
  ok('…and reads one by id or name', one.name === 'Initial Plan' && one.isActive === false && one.activities[0].subActivity === 'Design v1' && one.activities[0].targetStartDate === '2026-07-01', JSON.stringify(one));
  ok('…refusing an unknown one with the list', !!readTimelineBaseline(A, 'Nope').error && readTimelineBaseline(A, 'Nope').baselines.length === 2);
}

stopBridgeClient();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
