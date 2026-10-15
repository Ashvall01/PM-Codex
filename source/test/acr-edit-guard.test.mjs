/**
 * THE USER'S EDITS TO A PENDING PROPOSAL — checks for utils/acrUserEdits.ts,
 * the change-request store and the bridge client.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On 30 Sep 2026 the user edited a WSR page Claude had proposed. Claude then
 * withdrew that line and filed a fresh copy from its own text, and the edit
 * was gone for good. A second way to the same loss: a new proposal for a
 * record already in the pending request is MERGED into its line, assistant's
 * fields over the user's. Both assistants did both.
 *
 * Every check below stands for one of those, or for something the guard must
 * NOT get in the way of (a tick box is not an edit; an untouched line still
 * merges and withdraws as before).
 *
 * HOW TO RUN IT
 * -------------
 *   cd source && node test/run-acr-edit-guard-test.mjs
 */

// A stand-in for the browser's WebSocket, so bridgeClient.ts can be spoken to
// the way the bridge speaks to it. readyState stays CONNECTING on purpose: the
// client's screen poll then sends nothing, and only answers to our requests
// come back.
const sockets = [];
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
}
globalThis.WebSocket = FakeWebSocket;
globalThis.window.location = { origin: 'http://localhost:7800' };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

const { useAcrStore, takeAcrMergeRefusals } = await import('./store/acrStore.js');
const { useAppStore } = await import('./store/appStore.js');
const { useTasksStore } = await import('./store/tasksStore.js');
const { useRisksStore } = await import('./store/risksStore.js');
const { findMergeTarget } = await import('./utils/acrUserEdits.js');
const { isUserEdited, userEditedFields, withUserEdit } = await import('./utils/acrUserEdits.js');
const { stopBridgeClient } = await import('./services/bridgeClient.js');

const PROJECT = 'test-project';
useAppStore.setState({ activeProjectId: PROJECT });
// Real tasks for Claude's proposals to aim at: the bridge refuses a change to a
// record that is not there (see the last section).
const task = (id) => ({ id, projectId: PROJECT, type: 'Action Item', createdDate: 0, description: id, status: 'Open', comments: [], linkedActivityIds: [] });
useTasksStore.setState({ tasks: ['T9', 'T10'].map(task) });

const acr = () => useAcrStore.getState();
const reset = () => { useAcrStore.setState({ acrs: [], activeAcrId: null, activeAcrChangeId: null }); takeAcrMergeRefusals(); };
const line = (acrId, changeId) => acr().acrs.find((a) => a.id === acrId)?.changes.find((c) => c.id === changeId);

/* --------------------------------------------------- what counts as an edit */

{
  const base = { id: 'x', name: 'updateTask', args: { id: 'T1', status: 'Open', remarks: 'a' } };
  const edited = withUserEdit(base, { id: 'T1', status: 'Open', remarks: 'b' });
  ok('an edit keeps the assistant\'s original beside the user\'s version',
     edited.proposedArgs?.remarks === 'a' && edited.args.remarks === 'b' && !!edited.userEditedAt);
  ok('only the fields the user changed are listed', userEditedFields(edited).join() === 'remarks', userEditedFields(edited).join());
  const twice = withUserEdit(edited, { id: 'T1', status: 'Done', remarks: 'b' });
  ok('a second edit is still compared with what the assistant proposed',
     twice.proposedArgs?.remarks === 'a' && userEditedFields(twice).join() === 'remarks,status', userEditedFields(twice).join());
  const back = withUserEdit(twice, { id: 'T1', status: 'Open', remarks: 'a' });
  ok('an edit typed back to the original is no longer an edit', !isUserEdited(back));
  const same = withUserEdit(base, { remarks: 'a', status: 'Open', id: 'T1' });
  ok('writing back the same arguments (any key order) marks nothing', !same.userEditedAt && !isUserEdited(same));
  ok('a change of title alone is not an edit',
     !isUserEdited(withUserEdit(base, { ...base.args, changeTitle: 'New title' })));
}

/* ------------------------------------------------------ the store, directly */

reset();
{
  const id = acr().createAcr(PROJECT, 'gemini-chat', [
    { callId: 'c1', name: 'updateTask', args: { id: 'T1', remarks: 'assistant' } },
    { callId: 'c2', name: 'updateTask', args: { id: 'T2', remarks: 'assistant' } },
  ]);
  const [l1, l2] = acr().acrs[0].changes;

  acr().updateAcrChangeApproval(id, l1.id, false);
  ok('unticking a line is not an edit', !isUserEdited(line(id, l1.id)) && !line(id, l1.id).userEditedAt);

  acr().updateAcrChange(id, l1.id, { args: { ...l1.args, remarks: 'the user wrote this' } });
  ok('an edit in the app marks the line as the user\'s', isUserEdited(line(id, l1.id)));
  ok('…and keeps what the assistant proposed', line(id, l1.id).proposedArgs?.remarks === 'assistant');

  // Gemini proposes over the edited line: the merge path.
  acr().createAcr(PROJECT, 'gemini-chat', [
    { callId: 'c3', name: 'updateTask', args: { id: 'T1', remarks: 'assistant again', status: 'Done' } },
  ]);
  let refusals = takeAcrMergeRefusals();
  ok('a proposal over an edited line is not merged', line(id, l1.id).args.remarks === 'the user wrote this' && line(id, l1.id).args.status === undefined,
     JSON.stringify(line(id, l1.id).args));
  ok('…and is reported against the call that made it', refusals.length === 1 && refusals[0].callId === 'c3' && /the user wrote this/.test(refusals[0].message),
     JSON.stringify(refusals));
  ok('…without adding a second line for the same record', acr().acrs[0].changes.length === 2);

  // Over an untouched line, merging works as it always did.
  acr().createAcr(PROJECT, 'gemini-chat', [
    { callId: 'c4', name: 'updateTask', args: { id: 'T2', status: 'Done' } },
  ]);
  ok('a proposal over an untouched line still merges', line(id, l2.id).args.status === 'Done' && line(id, l2.id).args.remarks === 'assistant');
  ok('…and nothing is refused', takeAcrMergeRefusals().length === 0);

  // Gemini withdraws the edited line.
  acr().createAcr(PROJECT, 'gemini-chat', [
    { callId: 'c5', name: 'discardPendingACRChange', args: { changeId: l1.id } },
  ]);
  refusals = takeAcrMergeRefusals();
  ok('withdrawing an edited line is refused', !!line(id, l1.id) && refusals.length === 1 && refusals[0].callId === 'c5');

  acr().createAcr(PROJECT, 'gemini-chat', [
    { callId: 'c6', name: 'discardPendingACRChange', args: { changeId: l1.id, discardUserEdit: true } },
  ]);
  ok('…unless the user said to throw the edit away', !line(id, l1.id) && takeAcrMergeRefusals().length === 0);

  acr().createAcr(PROJECT, 'gemini-chat', [
    { callId: 'c7', name: 'discardPendingACRChange', args: { changeId: l2.id } },
  ]);
  ok('an untouched line is withdrawn as before (last line takes the request with it)', acr().acrs.length === 0);
}

/* ------------------------------------------------ the bridge client (Claude) */

const socket = sockets[0];
let nextId = 1;
const call = (op, params) => {
  const id = nextId++;
  socket.onmessage({ data: JSON.stringify({ id, op, params }) });
  return socket.sent.find((m) => m.id === id);
};

ok('the bridge client connected through the stand-in socket', !!socket && typeof socket.onmessage === 'function');

reset();
{
  const caps = call('capabilities', {});
  ok('capabilities says the edit guard is here (bridge_status probes this)', caps?.ok && caps.data?.acrEditGuard === true, JSON.stringify(caps));

  const filed = call('proposeChanges', { changes: [
    { action: 'createCodexPage', args: { folder: 'WEEKLY STATUS REVIEWS', title: 'WSR026', content: '<p>draft by Claude</p>' }, title: 'New WSR' },
    { action: 'updateTask', args: { id: 'T9', remarks: 'Claude' }, title: 'Remark on T9' },
  ] });
  ok('Claude files a request', filed?.ok && filed.data?.acrId, JSON.stringify(filed));
  const acrId = filed.data.acrId;
  const [page, task] = acr().acrs[0].changes;

  acr().updateAcrChange(acrId, page.id, { args: { ...page.args, content: '<p>edited by the user</p>' } });

  const detail = call('acrStatus', { acrId });
  const shown = detail.data.changes.find((c) => c.id === page.id);
  ok('get_acr_status marks the edited line', shown?.userEdited === true && shown.userEditedFields?.join() === 'content', JSON.stringify(shown));
  ok('…with the user\'s version in args and Claude\'s in proposedArgs',
     /edited by the user/.test(shown.args.content) && /draft by Claude/.test(shown.proposedArgs.content));
  ok('…and says what to do about it', /userEdited/.test(detail.data.note || ''));
  ok('an untouched line carries no edit marks', !('userEdited' in detail.data.changes.find((c) => c.id === task.id)));
  const list = call('acrStatus', {});
  ok('the list view flags the edited line too', list.data.acrs[0].changes.find((c) => c.id === page.id)?.userEdited === true);

  // What happened on 30 Sep: withdraw the edited line.
  const withdraw = call('discardChange', { acrId, changeId: page.id });
  ok('discard_change refuses an edited line', withdraw?.ok === false && !!line(acrId, page.id), JSON.stringify(withdraw));
  ok('…and hands back the user\'s version', /edited by the user/.test(withdraw?.error || ''));

  // Re-proposing over an edited line, in a batch with an innocent change.
  acr().updateAcrChange(acrId, task.id, { args: { ...task.args, remarks: 'the user' } });
  const over = call('proposeChanges', { changes: [
    { action: 'updateTask', args: { id: 'T10', remarks: 'new' } },
    { action: 'updateTask', args: { id: 'T9', remarks: 'Claude again' } },
  ] });
  ok('propose_changes refuses a merge over an edited line', over?.ok === false && /merged over lines the user has edited/.test(over?.error || ''), JSON.stringify(over));
  ok('…the whole batch, so nothing half-lands', acr().acrs[0].changes.length === 2 && line(acrId, task.id).args.remarks === 'the user');

  // A reverted edit no longer blocks anything.
  acr().updateAcrChange(acrId, task.id, { args: { ...task.args, remarks: 'Claude' } });
  const merged = call('proposeChanges', { changes: [{ action: 'updateTask', args: { id: 'T9', status: 'Done' } }] });
  ok('once the edit is typed back, Claude can merge again', merged?.ok && line(acrId, task.id).args.status === 'Done', JSON.stringify(merged));

  const forced = call('discardChange', { acrId, changeId: page.id, discardUserEdit: true });
  ok('with the user\'s say-so, discard_change withdraws the edited line', forced?.ok && !line(acrId, page.id), JSON.stringify(forced));

  const plain = call('discardChange', { acrId, changeId: task.id });
  ok('an untouched line withdraws as before', plain?.ok && acr().acrs.length === 0, JSON.stringify(plain));
}

/* ---------------------------------- a change aimed at a record that is gone */

reset();
{
  const gone = call('proposeChanges', { changes: [{ action: 'updateTask', args: { id: 'T-deleted', remarks: 'x' } }] });
  ok('an edit to a task that does not exist is refused', gone?.ok === false && /not there/.test(gone?.error || '') && /T-deleted/.test(gone?.error || ''), JSON.stringify(gone));
  ok('…and nothing is filed', acr().acrs.length === 0);

  const mixed = call('proposeChanges', { changes: [
    { action: 'updateTask', args: { id: 'T9', remarks: 'fine' } },
    { action: 'addTaskComment', args: { taskId: 'T-deleted', text: 'hello' } },
  ] });
  ok('one missing record refuses the whole batch (a comment by taskId too)', mixed?.ok === false && /#2 "addTaskComment"/.test(mixed?.error || '') && acr().acrs.length === 0, JSON.stringify(mixed));

  const noId = call('proposeChanges', { changes: [{ action: 'updateTask', args: { remarks: 'no id' } }] });
  ok('an edit that names no record is refused', noId?.ok === false && /no id/.test(noId?.error || ''), JSON.stringify(noId));

  const fine = call('proposeChanges', { changes: [
    { action: 'updateTask', args: { id: 'T9', remarks: 'fine' } },
    { action: 'addTask', args: { description: 'a new one' } },
  ] });
  ok('edits to real records, and additions, still go through', fine?.ok && acr().acrs[0]?.changes.length === 2, JSON.stringify(fine));
}


/* -------------- comment edits, flags and the risk archive (6 Oct 2026) */

reset();
useTasksStore.setState({ tasks: [
  { ...task('T9'), comments: [{ id: 'c-1', text: 'first', timestamp: 1, author: 'User' }, { id: 'c-2', text: 'second', timestamp: 2, author: 'User' }] },
  task('T10'),
] });
useRisksStore.setState({ risks: [
  { id: 'R1', projectId: PROJECT, status: 'Open', riskDescription: 'live', isArchived: false },
  { id: 'R2', projectId: PROJECT, status: 'Mitigated', riskDescription: 'filed', isArchived: true },
] });
{
  // Two comment edits on one task are two lines; one comment edited twice is one.
  const lines = [{ name: 'editTaskComment', args: { id: 'T9', commentId: 'c-1', text: 'a' } }];
  ok('an edit to another comment of the same task does not merge', !findMergeTarget(lines, 'editTaskComment', { id: 'T9', commentId: 'c-2', text: 'b' }));
  ok('an edit to the same comment merges', !!findMergeTarget(lines, 'editTaskComment', { id: 'T9', commentId: 'c-1', text: 'c' }));

  const edit = call('proposeChanges', { changes: [{ action: 'editTaskComment', args: { id: 'T9', commentId: 'c-2', text: 'second, reworded' } }] });
  ok('Claude can file an edit to a comment that is on the task', edit?.ok && acr().acrs[0]?.changes[0]?.args.commentId === 'c-2', JSON.stringify(edit));
  reset();

  const noComment = call('proposeChanges', { changes: [{ action: 'editTaskComment', args: { id: 'T9', text: 'x' } }] });
  ok('a comment edit that names no comment is refused', noComment?.ok === false && /no commentId/.test(noComment?.error || ''), JSON.stringify(noComment));
  const badComment = call('proposeChanges', { changes: [{ action: 'editTaskComment', args: { id: 'T9', commentId: 'c-404', text: 'x' } }] });
  ok('a comment edit aimed at a comment that is not there is refused', badComment?.ok === false && /c-404/.test(badComment?.error || '') && acr().acrs.length === 0, JSON.stringify(badComment));
  const wrongRecord = call('proposeChanges', { changes: [{ action: 'editTaskComment', args: { id: 'T10', commentId: 'c-1', text: 'x' } }] });
  ok('…and a real comment on a different task does not count', wrongRecord?.ok === false, JSON.stringify(wrongRecord));

  const flag = call('proposeChanges', { changes: [{ action: 'flagTask', args: { id: 'T9' } }, { action: 'unflagTask', args: { id: 'T10' } }] });
  ok('Claude can propose flagging and unflagging tasks', flag?.ok && acr().acrs[0]?.changes.length === 2, JSON.stringify(flag));
  reset();

  const rArch = call('proposeChanges', { changes: [{ action: 'archiveProjectRisk', args: { id: 'R1' } }] });
  ok('Claude can propose archiving a risk', rArch?.ok && acr().acrs[0]?.changes[0]?.name === 'archiveProjectRisk', JSON.stringify(rArch));
  reset();
  const rEditArchived = call('proposeChanges', { changes: [{ action: 'updateProjectRisk', args: { id: 'R2', remarks: 'x' } }] });
  ok('an update to an archived risk is refused, naming the restore action', rEditArchived?.ok === false && /archived risks/.test(rEditArchived?.error || '') && /unarchiveProjectRisk/.test(rEditArchived?.error || ''), JSON.stringify(rEditArchived));
  const rRestore = call('proposeChanges', { changes: [{ action: 'unarchiveProjectRisk', args: { id: 'R2' } }] });
  ok('…but restoring it can be proposed', rRestore?.ok, JSON.stringify(rRestore));
  reset();

  useTasksStore.setState({ tasks: [{ ...task('T9'), isArchived: true, comments: [{ id: 'c-1', text: 'x', timestamp: 1, author: 'User' }] }] });
  const flagArchived = call('proposeChanges', { changes: [{ action: 'flagTask', args: { id: 'T9' } }] });
  ok('flagging an archived task is refused', flagArchived?.ok === false && /archived/.test(flagArchived?.error || ''), JSON.stringify(flagArchived));
  const editArchived = call('proposeChanges', { changes: [{ action: 'editTaskComment', args: { id: 'T9', commentId: 'c-1', text: 'y' } }] });
  ok('editing a comment on an archived task is refused', editArchived?.ok === false && /archived/.test(editArchived?.error || ''), JSON.stringify(editArchived));
  reset();

  const readR = call('readArchive', { module: 'risks' });
  ok('read_archive lists archived risks', readR?.ok && readR.data?.totalArchived === 1 && /filed/.test(JSON.stringify(readR.data.records)), JSON.stringify(readR));
  const srch = call('search', { query: 'filed' });
  ok('search_project leaves archived risks out and says so', srch?.ok && srch.data?.results?.risks?.length === 0 && srch.data?.archivedRisksNotSearched === 1, JSON.stringify(srch));
  const caps2 = call('capabilities', {});
  ok('capabilities reports the new features', caps2?.data?.riskArchive === true && caps2.data.commentEdit === true && caps2.data.taskFlag === true);
}

stopBridgeClient();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
