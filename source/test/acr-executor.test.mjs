/**
 * THE EXECUTOR — checks for the one place a proposed change is carried out.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every check here stands for a way an approved change used to go wrong without
 * saying so:
 *
 *   - A deliverable given a status the app does not have, because the three
 *     copies of the executor disagreed on the default.
 *   - A task given a type that is not a task type, for the same reason.
 *   - An action approved from the review panel that did nothing at all, because
 *     only one of the three copies had a case for it.
 *   - A meeting action item that reached the task tracker twice as an
 *     unlinked second record, or was pushed without the user asking.
 *
 * None of this is reachable from bridge/test/e2e.mjs: that suite drives a
 * simulated app with no stores in it. This is the browser half.
 *
 * HOW TO RUN IT
 * -------------
 *   cd source
 *   npx tsc --project test/tsconfig.exec-test.json
 *   node test/run-executor-test.mjs
 *
 * The runner does the compile and the copying. Read its head if it breaks.
 */

import assert from 'node:assert';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

const { applyProjectChange } = await import('./services/acrExecutor.js');
const { pushActionItemsToTracker } = await import('./services/momActionPush.js');
const { useTasksStore } = await import('./store/tasksStore.js');
const { useMomStore } = await import('./store/momStore.js');
const { useDeliverablesStore } = await import('./store/deliverablesStore.js');
const { useTimelineStore } = await import('./store/timelineStore.js');
const { useBillingStore } = await import('./store/billingStore.js');
const { useRisksStore } = await import('./store/risksStore.js');

const PROJECT = 'test-project';

const reset = () => {
  useTasksStore.setState({ tasks: [] });
  useMomStore.setState({ moms: [], activeMomId: null });
  useDeliverablesStore.setState({ deliverables: [] });
};

// ---------------------------------------------------------------- valid values
reset();
applyProjectChange('addDeliverable', { title: 'A deliverable' }, PROJECT);
const dlv = useDeliverablesStore.getState().deliverables[0];
const DELIVERABLE_STATUSES = ['Pending','In Progress','On Hold','In Review','Signed Off','Dropped','Blocked'];
ok('a deliverable with no status gets a status the app actually has',
   DELIVERABLE_STATUSES.includes(dlv.status), dlv.status);

reset();
applyProjectChange('addTask', { description: 'A task' }, PROJECT);
let t = useTasksStore.getState().tasks[0];
ok('a task with no type gets a type the app actually has',
   ['Action Item','Issue'].includes(t.type), t.type);

reset();
applyProjectChange('addTask', { description: 'An issue', type: 'Issue' }, PROJECT);
ok('a task type that was asked for is kept',
   useTasksStore.getState().tasks[0].type === 'Issue');

// ------------------------------------------------- actions only one copy had
reset();
useTimelineStore.setState({ projectTimelines: [] });
useTimelineStore.getState().createProjectTimeline(PROJECT);
let r1 = applyProjectChange('createTimelineBaseline', { name: 'Baseline 2' }, PROJECT);
ok('createTimelineBaseline is carried out, not ignored',
   !r1.message.startsWith('No handler'), r1.message);
const revs = useTimelineStore.getState().getProjectTimeline(PROJECT)?.revisions || [];
ok('createTimelineBaseline really adds a baseline', revs.length >= 2, String(revs.length));

useBillingStore.setState({ milestones: [
  { id: 'm1', projectId: PROJECT, phase: '', agreementName: 'Old name', agreementNo: '',
    agreementLink: '', term: '', percentage: 0, valueNet: 0, valueVat: 0, workStatus: 'Pending',
    prerequisiteDocumentStatus: 'Pending', documentLink: '', invoicingStatus: 'Pending',
    invoiceLink: '', invoiceDate: '', remarks: '' } ]});
applyProjectChange('updateMilestone', { id: 'm1', agreementName: 'New name' }, PROJECT);
ok('updateMilestone really changes the milestone',
   useBillingStore.getState().milestones[0].agreementName === 'New name');

// ------------------------------------------------------------ unknown action
const unknown = applyProjectChange('somethingNobodyWrote', { id: 'x' }, PROJECT);
ok('an unknown action says so instead of doing nothing quietly',
   unknown.message.includes('No handler'), unknown.message);

// ------------------------------------- meeting action items: pushed by the user
reset();
const result = applyProjectChange('createMoM', {
  title: 'Kickoff',
  changeTitle: 'Created MoM: Kickoff',
  notes: 'Some notes',
  actionItems: [
    { description: 'Draft the migration plan', assignee: 'Ana', priority: 'High',
      estimatedResolutionDate: '2026-10-01', remarks: 'Before the pilot' },
    { description: 'Book the hypercare window', assignee: 'Ben', status: 'In Progress' },
    { description: 'Already settled', assignee: 'Cara', status: 'Done' },
  ],
}, PROJECT);

const mom = useMomStore.getState().moms[0];
ok('the minutes are created', !!mom && mom.title === 'Kickoff');
ok('signing off files NO task', useTasksStore.getState().tasks.length === 0,
   String(useTasksStore.getState().tasks.length));
ok('no action item is marked as pushed', mom.actionItems.every(a => !a.taskId));
ok('the result does not claim any task was filed', !/task/i.test(result.message), result.message);
ok('the action item keeps its task fields for a later push',
   mom.actionItems[0].priority === 'High' && mom.actionItems[0].remarks === 'Before the pilot');

applyProjectChange('updateMom', { id: mom.id, notes: 'Notes revised' }, PROJECT);
ok('editing the minutes files no task either', useTasksStore.getState().tasks.length === 0);

// push one item
const planId = mom.actionItems[0].id;
const one = pushActionItemsToTracker(mom.id, [planId]);
let tasks = useTasksStore.getState().tasks;
ok('pushing one item makes exactly one task', one.length === 1 && tasks.length === 1, String(tasks.length));
const planTask = tasks[0];
ok('the item is linked to its task',
   useMomStore.getState().moms[0].actionItems[0].taskId === planTask.id);
ok('the task says which meeting it came from', planTask.source === 'Kickoff', planTask.source);
ok('the person carries onto the task', planTask.owner === 'Ana', planTask.owner);
ok('the priority carries onto the task', planTask.priority === 'High', String(planTask.priority));
ok('the due date carries onto the task',
   planTask.estimatedResolutionDate === '2026-10-01', planTask.estimatedResolutionDate);
ok('the remarks carry onto the task', planTask.remarks === 'Before the pilot', planTask.remarks);

// push all
const rest = pushActionItemsToTracker(mom.id);
tasks = useTasksStore.getState().tasks;
ok('push all files only the open items without a task', rest.length === 1 && tasks.length === 2,
   `${rest.length} / ${tasks.length}`);
const bookTask = tasks.find(t => t.description === 'Book the hypercare window');
ok('the status carries onto the task', bookTask && bookTask.status === 'In Progress', bookTask && bookTask.status);
ok('push all skips a closed item',
   !tasks.some(t => t.description === 'Already settled'));
ok('pushing again files nothing twice', pushActionItemsToTracker(mom.id).length === 0 &&
   pushActionItemsToTracker(mom.id, [planId]).length === 0);

// ------------------------------------------------- meeting field name aliases
reset();
applyProjectChange('createMoM', {
  name: 'Named not titled', meetingNotes: 'n', decisions: 'd',
  attendees: ['Ana', 'Ben'], actionItems: [],
}, PROJECT);
const m2 = useMomStore.getState().moms[0];
ok('a meeting sent as `name` still gets a title', m2.title === 'Named not titled', m2.title);
ok('a list of attendees becomes text', m2.attendees === 'Ana, Ben', m2.attendees);

reset();
applyProjectChange('createMoM', { title: 'M', actionItems: [] }, PROJECT);
const m3 = useMomStore.getState().moms[0];
applyProjectChange('updateMom', { id: m3.id, changeTitle: 'Should not be stored', title: 'M2' }, PROJECT);
const m3b = useMomStore.getState().moms[0];
ok('the change title is not written into the meeting record',
   m3b.changeTitle === undefined, JSON.stringify(m3b.changeTitle));
ok('the real update still lands', m3b.title === 'M2');

// ---------------------------------------------------------------- the archive
// Every check below is a silent failure if it breaks: the record is still
// there, the app still builds, and the only sign is that something the user
// put away comes back, or something they can still see cannot be changed.

const addOneTask = (description = 'Archive me') => {
  reset();
  applyProjectChange('addTask', { description }, PROJECT);
  return useTasksStore.getState().tasks[0];
};

let at = addOneTask();
let ar = applyProjectChange('archiveTask', { id: at.id }, PROJECT);
let arch = useTasksStore.getState().tasks[0];
ok('archiveTask sets the flag', arch.isArchived === true, String(arch.isArchived));
ok('archiveTask stamps the date at sign-off',
   typeof arch.archivedDate === 'number' && arch.archivedDate > 0, String(arch.archivedDate));
ok('archiveTask says what it did', !ar.message.startsWith('Failed'), ar.message);

ar = applyProjectChange('unarchiveTask', { id: arch.id }, PROJECT);
arch = useTasksStore.getState().tasks[0];
ok('unarchiveTask clears the flag', arch.isArchived === false, String(arch.isArchived));
ok('unarchiveTask clears the date', arch.archivedDate === undefined, String(arch.archivedDate));

at = addOneTask('Read only please');
applyProjectChange('archiveTask', { id: at.id }, PROJECT);
let refused = applyProjectChange('updateTask', { id: at.id, description: 'Changed' }, PROJECT);
arch = useTasksStore.getState().tasks[0];
ok('updateTask on an archived task changes nothing',
   arch.description === 'Read only please', arch.description);
ok('updateTask on an archived task says to restore it first',
   /archived/i.test(refused.message) && /unarchiveTask/.test(refused.message), refused.message);

refused = applyProjectChange('addTaskComment', { id: at.id, text: 'hello' }, PROJECT);
arch = useTasksStore.getState().tasks[0];
ok('addTaskComment on an archived task adds nothing',
   (arch.comments || []).length === 0, String((arch.comments || []).length));
ok('addTaskComment on an archived task says to restore it first',
   /archived/i.test(refused.message), refused.message);

// ...but restoring and deleting must still work on an archived record.
ar = applyProjectChange('unarchiveTask', { id: at.id }, PROJECT);
ok('unarchiveTask works on an archived task', !ar.message.startsWith('Failed'), ar.message);

at = addOneTask('Delete me');
applyProjectChange('archiveTask', { id: at.id }, PROJECT);
applyProjectChange('deleteTask', { id: at.id }, PROJECT);
ok('deleteTask still works on an archived task',
   useTasksStore.getState().tasks.length === 0,
   String(useTasksStore.getState().tasks.length));

// Archiving twice is not an error, and it must not restamp the date.
at = addOneTask('Twice');
applyProjectChange('archiveTask', { id: at.id }, PROJECT);
const firstStamp = useTasksStore.getState().tasks[0].archivedDate;
ar = applyProjectChange('archiveTask', { id: at.id }, PROJECT);
ok('archiving an already-archived task changes nothing',
   useTasksStore.getState().tasks[0].archivedDate === firstStamp, ar.message);

ar = applyProjectChange('archiveTask', { id: 'no-such-id' }, PROJECT);
ok('archiveTask on a missing id says so instead of doing nothing quietly',
   ar.message.startsWith('Failed'), ar.message);

// getTasksByProject is what hides the archive from both AI engines.
reset();
applyProjectChange('addTask', { description: 'Still working on it' }, PROJECT);
applyProjectChange('addTask', { description: 'Done with it' }, PROJECT);
const [keep, put] = useTasksStore.getState().tasks;
applyProjectChange('archiveTask', { id: put.id }, PROJECT);
const active = useTasksStore.getState().getTasksByProject(PROJECT);
const archive = useTasksStore.getState().getArchivedTasksByProject(PROJECT);
ok('getTasksByProject leaves the archived one out',
   active.length === 1 && active[0].id === keep.id, String(active.length));
ok('getArchivedTasksByProject returns only the archived one',
   archive.length === 1 && archive[0].id === put.id, String(archive.length));

// ------------------------------------------- the deliverables archive (12 Sep)
//
// Deliverables is a DRILL-DOWN tree, so it has one problem tasks never had:
// archive a parent, leave its children active, and those children are stranded
// — still active, still counted, on no screen that can be reached. Archive and
// restore therefore act on the whole subtree. PLAN.md 21.2 and 21.3.
reset();
const addDlv = (title, parentId = null) => {
  applyProjectChange('addDeliverable', { title, parentId }, PROJECT);
  const all = useDeliverablesStore.getState().deliverables;
  return all[all.length - 1];
};

const root = addDlv('Phase 1 pack');
const childA = addDlv('FSD', root.id);
const childB = addDlv('TSD', root.id);
const grandchild = addDlv('TSD annex', childB.id);
const unrelated = addDlv('Nothing to do with it');

let dr = applyProjectChange('archiveDeliverable', { id: root.id }, PROJECT);
let rows = () => useDeliverablesStore.getState().deliverables;
const byId = (id) => rows().find(d => d.id === id);

ok('archiving a parent archives every descendant',
   [root.id, childA.id, childB.id, grandchild.id].every(id => byId(id).isArchived === true),
   JSON.stringify([root.id, childA.id, childB.id, grandchild.id].map(id => byId(id).isArchived)));
ok('a deliverable outside the subtree is untouched',
   !byId(unrelated.id).isArchived, String(byId(unrelated.id).isArchived));
ok('the whole subtree shares one archivedDate',
   new Set([root.id, childA.id, childB.id, grandchild.id].map(id => byId(id).archivedDate)).size === 1,
   JSON.stringify([root.id, childA.id, childB.id, grandchild.id].map(id => byId(id).archivedDate)));
ok('the reply says how many went with it',
   /3 nested sub-deliverables/.test(dr.message), dr.message);

const activeD = useDeliverablesStore.getState().getDeliverablesByProject(PROJECT);
const archD = useDeliverablesStore.getState().getArchivedDeliverablesByProject(PROJECT);
ok('getDeliverablesByProject leaves the whole archived subtree out',
   activeD.length === 1 && activeD[0].id === unrelated.id, String(activeD.length));
ok('the archive lists SUBTREE ROOTS only, not every archived record',
   archD.length === 1 && archD[0].id === root.id,
   JSON.stringify(archD.map(d => d.title)));

// PLAN.md 21.14. The archive LIST counts roots; the skeleton's "N archived and
// not listed" counts RECORDS. Reusing one number for both understated the gap by
// 46 records on the first real pass. This check exists so the two can never
// silently become the same number again.
const archivedRecordCount = rows().filter(d => d.projectId === PROJECT && d.isArchived).length;
ok('the archived RECORD count is not the archived ROOT count',
   archivedRecordCount === 4 && archD.length === 1,
   `records ${archivedRecordCount}, roots ${archD.length}`);

// Read-only, both guards.
let refusedD = applyProjectChange('updateDeliverable', { id: childA.id, title: 'Changed' }, PROJECT);
ok('updateDeliverable on an archived deliverable changes nothing',
   byId(childA.id).title === 'FSD', byId(childA.id).title);
ok('updateDeliverable on an archived deliverable says to restore it first',
   /archived/i.test(refusedD.message) && /unarchiveDeliverable/.test(refusedD.message), refusedD.message);

refusedD = applyProjectChange('addDeliverableComment', { id: childA.id, text: 'hello' }, PROJECT);
ok('addDeliverableComment on an archived deliverable adds nothing',
   (byId(childA.id).comments || []).length === 0, String((byId(childA.id).comments || []).length));
ok('addDeliverableComment on an archived deliverable says to restore it first',
   /archived/i.test(refusedD.message), refusedD.message);

dr = applyProjectChange('unarchiveDeliverable', { id: root.id }, PROJECT);
ok('restoring the root brings the whole subtree back',
   [root.id, childA.id, childB.id, grandchild.id].every(id => byId(id).isArchived === false),
   JSON.stringify([root.id, childA.id, childB.id, grandchild.id].map(id => byId(id).isArchived)));
ok('restoring clears the date on every record in the subtree',
   [root.id, childA.id, childB.id, grandchild.id].every(id => byId(id).archivedDate === undefined),
   JSON.stringify([root.id, childA.id, childB.id, grandchild.id].map(id => byId(id).archivedDate)));

// A leaf moves alone, and says nothing about descendants it does not have.
dr = applyProjectChange('archiveDeliverable', { id: grandchild.id }, PROJECT);
ok('archiving a leaf moves only the leaf',
   byId(grandchild.id).isArchived === true && byId(childB.id).isArchived === false,
   String(byId(childB.id).isArchived));
ok('a leaf archive does not claim to have moved descendants',
   !/nested sub-deliverable/.test(dr.message), dr.message);
ok('an archived child is reachable as a root when its parent is active',
   useDeliverablesStore.getState().getArchivedDeliverablesByProject(PROJECT)
     .some(d => d.id === grandchild.id),
   JSON.stringify(useDeliverablesStore.getState().getArchivedDeliverablesByProject(PROJECT).map(d => d.title)));

// Archiving twice must not restamp, and a missing id must say so.
const stamp1 = byId(grandchild.id).archivedDate;
dr = applyProjectChange('archiveDeliverable', { id: grandchild.id }, PROJECT);
ok('archiving an already-archived deliverable changes nothing',
   byId(grandchild.id).archivedDate === stamp1, dr.message);

dr = applyProjectChange('archiveDeliverable', { id: 'no-such-id' }, PROJECT);
ok('archiveDeliverable on a missing id says so instead of doing nothing quietly',
   dr.message.startsWith('Failed'), dr.message);

// Delete still reaches an archived record — archiving is a filing cabinet, not
// a lock — and it still takes the subtree with it.
applyProjectChange('unarchiveDeliverable', { id: grandchild.id }, PROJECT);
applyProjectChange('archiveDeliverable', { id: root.id }, PROJECT);
applyProjectChange('deleteDeliverable', { id: root.id }, PROJECT);
ok('deleteDeliverable still works on an archived subtree',
   rows().length === 1 && rows()[0].id === unrelated.id,
   JSON.stringify(rows().map(d => d.title)));

// ------------------------------------------------------ holidays (24 Sep)
// The holiday list is sent whole and replaces the old one; the formulas that
// read it are worked out again.
useTimelineStore.setState({ projectTimelines: [] });
useTimelineStore.getState().createProjectTimeline(PROJECT);
const tl = () => useTimelineStore.getState().getProjectTimeline(PROJECT);
const revId = tl().activeRevisionId;
useTimelineStore.getState().addActivity(PROJECT, revId, {
  phase: 'P', activity: 'A', subActivity: 'S', weight: 1, progress: 0, status: 'Planned', owner: '',
  targetStartDate: '2026-09-25', targetCompletionDate: '=WORKDAY([Target Start], 1)',
  actualStartDate: '', actualCompletionDate: '', remarks: '',
});
const endDate = () => tl().revisions[0].activities[0].targetCompletionDate;
ok('a WORKDAY formula skips the weekend before any holiday is set', endDate() === '2026-09-28', endDate());
let hr = applyProjectChange('setTimelineHolidays', { holidays: ['2026-09-28', '29/09/2026', '2026-09-28'] }, PROJECT);
ok('setTimelineHolidays stores the list, deduplicated, sorted, day-first dates read',
   JSON.stringify(tl().holidays) === JSON.stringify(['2026-09-28', '2026-09-29']), JSON.stringify(tl().holidays));
ok('the formulas are worked out again with the new holidays', endDate() === '2026-09-30', endDate());
ok('the reply says what was added and removed', /2 added, 0 removed/.test(hr.message), hr.message);
hr = applyProjectChange('setTimelineHolidays', { holidays: ['2026-09-29'] }, PROJECT);
ok('the list is replaced, not added to', JSON.stringify(tl().holidays) === '["2026-09-29"]', JSON.stringify(tl().holidays));
hr = applyProjectChange('setTimelineHolidays', { holidays: ['2026-09-29', 'next friday'] }, PROJECT);
ok('a list with something that is not a date changes nothing and says why',
   hr.message.startsWith('Failed') && /next friday/.test(hr.message) && JSON.stringify(tl().holidays) === '["2026-09-29"]', hr.message);
hr = applyProjectChange('setTimelineHolidays', { holidays: '2026-12-25, 2026-12-26' }, PROJECT);
ok('a comma-separated string is read as a list', tl().holidays.length === 2, JSON.stringify(tl().holidays));

// --------------------------------------------- change titles stay out (24 Sep)
reset();
applyProjectChange('addTask', { description: 'Titled' }, PROJECT);
const titled = useTasksStore.getState().tasks[0];
applyProjectChange('updateTask', { id: titled.id, status: 'Done', changeTitle: 'Closed the titled task', callId: 'fc_1' }, PROJECT);
const titledAfter = useTasksStore.getState().tasks[0];
ok('an update does not write the change title into the record', !('changeTitle' in titledAfter) && !('callId' in titledAfter),
   JSON.stringify(Object.keys(titledAfter)));
ok('the update itself is applied', titledAfter.status === 'Done', titledAfter.status);

// ------------------------------------------------ codex folders (24 Sep)
const { useCodexStore } = await import('./store/codexStore.js');
useCodexStore.setState({ pages: [] });
const cpages = () => useCodexStore.getState().pages;
applyProjectChange('createCodexFolder', { title: 'Project context' }, PROJECT);
const folder = cpages()[0];
ok('createCodexFolder makes a folder with no parent and no content', folder && !folder.parentId && folder.content === '', JSON.stringify(folder));
ok('a folder title is upper case, like the ones made on screen', folder.title === 'PROJECT CONTEXT', folder.title);

let cr = applyProjectChange('createCodexPage', { title: 'About', content: '<p>Hi</p>', parentId: folder.id }, PROJECT);
const about = cpages().find(p => p.title === 'About');
ok('a page is created inside the folder it names', about && about.parentId === folder.id, cr.message);

cr = applyProjectChange('createCodexPage', { title: 'Nested', content: 'x', parentId: about.id }, PROJECT);
const nested = cpages().find(p => p.title === 'Nested');
ok('a page asked to go under a page goes into that page\'s folder instead', nested && nested.parentId === folder.id, cr.message);

cr = applyProjectChange('createCodexPage', { title: 'Minutes', content: 'x', folder: 'meeting notes' }, PROJECT);
const minutes = cpages().find(p => p.title === 'Minutes');
const newFolder = cpages().find(p => p.title === 'MEETING NOTES');
ok('a folder named by a new title is created with the page', !!newFolder && minutes && minutes.parentId === newFolder.id, cr.message);
cr = applyProjectChange('createCodexPage', { title: 'Minutes 2', content: 'x', folder: 'Meeting Notes' }, PROJECT);
ok('a folder title matches whatever its case', cpages().filter(p => p.title === 'MEETING NOTES').length === 1, cr.message);

const before = cpages().length;
cr = applyProjectChange('createCodexPage', { title: 'Nowhere', content: 'x' }, PROJECT);
ok('a page with no folder is refused and nothing is created', cr.message.startsWith('Failed') && cpages().length === before, cr.message);

cr = applyProjectChange('updateCodexPage', { id: folder.id, content: '<p>Folder text</p>' }, PROJECT);
ok('content written onto a folder is refused', cr.message.startsWith('Failed') && cpages().find(p => p.id === folder.id).content === '', cr.message);
cr = applyProjectChange('updateCodexPage', { id: folder.id, title: 'Context' }, PROJECT);
ok('a folder can be renamed', cpages().find(p => p.id === folder.id).title === 'CONTEXT', cr.message);
cr = applyProjectChange('updateCodexPage', { id: about.id, parentId: newFolder.id }, PROJECT);
ok('a page can be moved to another folder', cpages().find(p => p.id === about.id).parentId === newFolder.id, cr.message);
cr = applyProjectChange('updateCodexPage', { id: minutes.id, parentId: nested.id }, PROJECT);
ok('a page cannot be moved under a page', cr.message.startsWith('Failed') || cpages().find(p => p.id === minutes.id).parentId !== nested.id, cr.message);


// ------------------------------------------------- risk archive (6 Oct 2026)
const addOneRisk = (desc = 'Vendor SLA gap') => {
  useRisksStore.setState({ risks: [] });
  applyProjectChange('addProjectRisk', { riskDescription: desc, impactLevel: 'High', probability: 'Moderate' }, PROJECT);
  return useRisksStore.getState().risks[0];
};
let rk = addOneRisk();
let rr = applyProjectChange('archiveProjectRisk', { id: rk.id }, PROJECT);
let rkNow = useRisksStore.getState().risks[0];
ok('archiveProjectRisk sets the flag', rkNow.isArchived === true, String(rkNow.isArchived));
ok('archiveProjectRisk stamps the date at sign-off', typeof rkNow.archivedDate === 'number' && rkNow.archivedDate > 0, String(rkNow.archivedDate));
ok('archiveProjectRisk leaves the grade and value alone', rkNow.riskValue === rk.riskValue && rkNow.impactLevel === 'High', rkNow.riskValue);
ok('archiveProjectRisk says what it did', !rr.message.startsWith('Failed'), rr.message);

let rrefused = applyProjectChange('updateProjectRisk', { id: rk.id, remarks: 'changed' }, PROJECT);
ok('updateProjectRisk on an archived risk changes nothing', useRisksStore.getState().risks[0].remarks === '', useRisksStore.getState().risks[0].remarks);
ok('updateProjectRisk on an archived risk says to restore it first', /archived/i.test(rrefused.message) && /unarchiveProjectRisk/.test(rrefused.message), rrefused.message);

ok('getProjectRisks leaves the archived risk out', useRisksStore.getState().getProjectRisks(PROJECT).length === 0 && useRisksStore.getState().getArchivedRisksByProject(PROJECT).length === 1);
rr = applyProjectChange('archiveProjectRisk', { id: rk.id }, PROJECT);
ok('archiving an already-archived risk changes nothing', rr.message.includes('already') && useRisksStore.getState().risks[0].archivedDate === rkNow.archivedDate, rr.message);

rr = applyProjectChange('unarchiveProjectRisk', { id: rk.id }, PROJECT);
rkNow = useRisksStore.getState().risks[0];
ok('unarchiveProjectRisk clears the flag and the date', rkNow.isArchived === false && rkNow.archivedDate === undefined, String(rkNow.isArchived));
ok('an unarchived risk is editable again', !applyProjectChange('updateProjectRisk', { id: rk.id, remarks: 'ok' }, PROJECT).message.startsWith('Failed'));

rk = addOneRisk('Delete me');
applyProjectChange('archiveProjectRisk', { id: rk.id }, PROJECT);
applyProjectChange('deleteProjectRisk', { id: rk.id }, PROJECT);
ok('deleteProjectRisk still works on an archived risk', useRisksStore.getState().risks.length === 0);
ok('archiveProjectRisk on a missing id says so', applyProjectChange('archiveProjectRisk', { id: 'nope' }, PROJECT).message.startsWith('Failed'));

// ------------------------------------------------- comment edits (6 Oct 2026)
const taskWithComments = () => {
  reset();
  applyProjectChange('addTask', { description: 'Has comments' }, PROJECT);
  const id = useTasksStore.getState().tasks[0].id;
  useTasksStore.getState().addComment(id, 'Written by the user', 'User');
  applyProjectChange('addTaskComment', { id, text: 'Written by the assistant' }, PROJECT);
  return useTasksStore.getState().tasks[0];
};
let tk = taskWithComments();
const [userC, asstC] = tk.comments;
let cr2 = applyProjectChange('editTaskComment', { id: tk.id, commentId: userC.id, text: 'Reworded' }, PROJECT);
let tkNow = useTasksStore.getState().tasks[0];
let edited = tkNow.comments.find(c => c.id === userC.id);
ok('editTaskComment changes the text of any comment, the user\'s included', edited.text === 'Reworded', edited.text);
ok('an edited comment keeps who first wrote it and records who edited', edited.author === 'User' && edited.editedBy === 'Assistant' && typeof edited.editedAt === 'number', JSON.stringify(edited));
ok('editTaskComment leaves the other comment alone', tkNow.comments.find(c => c.id === asstC.id).text === 'Written by the assistant');
ok('editTaskComment keeps the comment count', tkNow.comments.length === 2);
ok('editTaskComment says what it did', !cr2.message.startsWith('Failed'), cr2.message);
cr2 = applyProjectChange('editTaskComment', { id: tk.id, commentId: 'no-such-comment', text: 'x' }, PROJECT);
ok('editTaskComment on a missing comment fails and changes nothing', cr2.message.startsWith('Failed') && useTasksStore.getState().tasks[0].comments.length === 2, cr2.message);
cr2 = applyProjectChange('editTaskComment', { id: tk.id, commentId: userC.id, text: '   ' }, PROJECT);
ok('editTaskComment with empty text fails', cr2.message.startsWith('Failed') && useTasksStore.getState().tasks[0].comments[0].text === 'Reworded', cr2.message);
applyProjectChange('archiveTask', { id: tk.id }, PROJECT);
cr2 = applyProjectChange('editTaskComment', { id: tk.id, commentId: userC.id, text: 'Nope' }, PROJECT);
ok('editTaskComment on an archived task is refused', /archived/i.test(cr2.message) && useTasksStore.getState().tasks[0].comments[0].text === 'Reworded', cr2.message);

reset();
applyProjectChange('addDeliverable', { title: 'D with comments' }, PROJECT);
const dId = useDeliverablesStore.getState().deliverables[0].id;
applyProjectChange('addDeliverableComment', { id: dId, text: 'First' }, PROJECT);
const dc = useDeliverablesStore.getState().deliverables[0].comments[0];
cr2 = applyProjectChange('editDeliverableComment', { id: dId, commentId: dc.id, text: 'First, reworded' }, PROJECT);
ok('editDeliverableComment changes the text and marks it edited', useDeliverablesStore.getState().deliverables[0].comments[0].text === 'First, reworded' && useDeliverablesStore.getState().deliverables[0].comments[0].editedBy === 'Assistant', cr2.message);
ok('editDeliverableComment accepts Gemini\'s deliverableId', !applyProjectChange('editDeliverableComment', { deliverableId: dId, commentId: dc.id, text: 'Again' }, PROJECT).message.startsWith('Failed'));
ok('editDeliverableComment on a missing comment fails', applyProjectChange('editDeliverableComment', { id: dId, commentId: 'nope', text: 'x' }, PROJECT).message.startsWith('Failed'));
applyProjectChange('archiveDeliverable', { id: dId }, PROJECT);
ok('editDeliverableComment on an archived deliverable is refused', /archived/i.test(applyProjectChange('editDeliverableComment', { id: dId, commentId: dc.id, text: 'No' }, PROJECT).message));

// ------------------------------------------------------ flags (6 Oct 2026)
at = addOneTask('Flag me');
let fr = applyProjectChange('flagTask', { id: at.id }, PROJECT);
ok('flagTask sets the flag', useTasksStore.getState().tasks[0].isFlagged === true, fr.message);
fr = applyProjectChange('flagTask', { id: at.id }, PROJECT);
ok('flagging a flagged task changes nothing and says so', useTasksStore.getState().tasks[0].isFlagged === true && /already/.test(fr.message), fr.message);
fr = applyProjectChange('unflagTask', { id: at.id }, PROJECT);
ok('unflagTask clears the flag', useTasksStore.getState().tasks[0].isFlagged === false, fr.message);
fr = applyProjectChange('unflagTask', { id: at.id }, PROJECT);
ok('unflagging an unflagged task changes nothing and says so', /already/.test(fr.message), fr.message);
applyProjectChange('archiveTask', { id: at.id }, PROJECT);
fr = applyProjectChange('flagTask', { id: at.id }, PROJECT);
ok('flagTask on an archived task is refused', /archived/i.test(fr.message) && !useTasksStore.getState().tasks[0].isFlagged, fr.message);
ok('flagTask on a missing id says so', applyProjectChange('flagTask', { id: 'nope' }, PROJECT).message.startsWith('Failed'));

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
