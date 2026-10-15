/**
 * ACR DIFF — checks for the shared old-versus-new helper.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every one of these checks stands for a way a proposed change used to
 * disappear from the screen: a field nobody had written a comparison line for,
 * a field the tool and the store called by different names, a number sent as
 * text, a comment aimed at `taskId` when the record is keyed by `id`.
 *
 * The bridge's own suite (bridge/test/e2e.mjs) cannot reach any of this: it
 * drives a simulated app that never renders. This is the browser half.
 *
 * HOW TO RUN IT
 * -------------
 *   cd source
 *   npx tsc src/utils/acrDiff.ts --outDir /tmp/acrcheck --module esnext \
 *       --target es2020 --moduleResolution bundler --skipLibCheck
 *   cp /tmp/acrcheck/utils/acrDiff.js /tmp/acrcheck/acrDiff.mjs
 *   cp test/acr-diff.mjs /tmp/acrcheck/ && node /tmp/acrcheck/acr-diff.mjs
 *
 * The compile step is here because the helper is TypeScript and this project
 * has no test runner. Keep it that way until one exists.
 */
import {
  computeAcrDiffs, enrichWithAcr, acrFieldProps, acrUnshownDiffs,
  acrValuesEqual, formatAcrValue, diffsForChange, getAcrActionSpec,
  withImpliedArgs,
} from './acrDiff.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

// ---------------------------------------------------------------- values
ok('a number and the same number as text are one value', acrValuesEqual(25, '25'));
ok('an ISO date and a plain date are one value', acrValuesEqual('2026-03-01T00:00:00.000Z', '2026-03-01'));
ok('empty, null and undefined are one value', acrValuesEqual('', null) && acrValuesEqual(undefined, ''));
ok('two different values are not equal', !acrValuesEqual('Open', 'Done'));
ok('lists compare by content', acrValuesEqual(['a','b'], ['a','b']) && !acrValuesEqual(['a'], ['b']));

// ---------------------------------------------------------------- diffs
const task = { id: 't1', description: 'Old text', status: 'Open', owner: '', priority: 'Low', remarks: '' };

let d = computeAcrDiffs(task, { id: 't1', changeTitle: 'x', status: 'Done', owner: 'Sam' }, 'updateTask');
ok('only the fields that move are listed', d.length === 2, JSON.stringify(d.map(x => x.key)));
ok('routing arguments are never listed as a change', !d.some(x => ['id','changeTitle'].includes(x.key)));
ok('a field that was empty is marked as an addition', d.find(x => x.key === 'owner').isAddition);
ok('old and new are both carried', d.find(x => x.key === 'status').oldValue === 'Open' && d.find(x => x.key === 'status').newValue === 'Done');

d = computeAcrDiffs(task, { id: 't1', status: 'Open' }, 'updateTask');
ok('a value equal to the record is not a change', d.length === 0);

d = computeAcrDiffs(task, { id: 't1', remarks: '' }, 'updateTask');
ok('clearing an already empty field is not a change', d.length === 0);

d = computeAcrDiffs({ ...task, remarks: 'note' }, { id: 't1', remarks: '' }, 'updateTask');
ok('clearing a filled field IS a change', d.length === 1);

// a field no module and no tool schema knows about
d = computeAcrDiffs(task, { id: 't1', someBrandNewField: 'hello' }, 'updateTask');
ok('an unknown field still produces a diff row', d.length === 1 && d[0].key === 'someBrandNewField');
ok('an unknown field gets a readable label', d[0].label === 'Some Brand New Field', d[0].label);

// ---------------------------------------------------------------- aliases
const sh = { id: 's1', name: 'Ana', projectRole: 'Sponsor', power: 'Low' };
d = computeAcrDiffs(sh, { id: 's1', role: 'Sponsor', influence: 'High' }, 'updateStakeholder');
ok('role maps onto projectRole, so an unchanged role is not a change', !d.some(x => x.key === 'projectRole'), JSON.stringify(d.map(x=>x.key)));
ok('influence maps onto power', d.some(x => x.key === 'power' && x.newValue === 'High'));

const risk = { id: 'r1', mitigationStrategy: 'Patch sprint', impactLevel: 'Low' };
d = computeAcrDiffs(risk, { id: 'r1', mitigationPlan: 'Patch sprint', impact: 'High' }, 'updateProjectRisk');
ok('mitigationPlan maps onto mitigationStrategy', !d.some(x => x.key === 'mitigationStrategy'));
ok('impact maps onto impactLevel', d.some(x => x.key === 'impactLevel' && x.newValue === 'High'));

const mom = { id: 'm1', title: 'Kickoff', notes: 'n', keyDecisions: 'k' };
d = computeAcrDiffs(mom, { id: 'm1', name: 'Kickoff', meetingNotes: 'n2', decisions: 'k' }, 'updateMom');
ok('for a meeting, name means title', !d.some(x => x.key === 'name'));
ok('meetingNotes maps onto notes', d.some(x => x.key === 'notes' && x.newValue === 'n2'));
ok('decisions maps onto keyDecisions and is unchanged here', !d.some(x => x.key === 'keyDecisions'));

// ---------------------------------------------------------------- enrichment
const acr = { id: 'a1', status: 'pending', changes: [
  { id: 'c1', approved: true, name: 'updateTask', changeTitle: 'Close it', args: { id: 't1', status: 'Done' } },
  { id: 'c2', approved: true, name: 'addTask', changeTitle: 'New task', args: { description: 'Brand new', status: 'Open' } },
  { id: 'c3', approved: true, name: 'deleteTask', changeTitle: 'Drop it', args: { id: 't2' } },
  { id: 'c4', approved: true, name: 'addTaskComment', changeTitle: 'Comment', args: { id: 't1', text: 'Please check' } },
  { id: 'c5', approved: true, name: 'addTaskComment', changeTitle: 'Comment', args: { taskId: 't1', text: 'Second' } },
]};
const rows = enrichWithAcr(
  [task, { id: 't2', description: 'Doomed', status: 'Open' }],
  acr,
  { add: ['addTask'], update: ['updateTask'], remove: ['deleteTask'], comment: ['addTaskComment'] },
  null,
  (c) => ({ id: `acr-add-${c.id}`, description: c.args.description, status: c.args.status }),
);

ok('proposed new records come first', rows[0].isAcrProposedAdd);
const t1 = rows.find(r => r.id === 't1');
const t2 = rows.find(r => r.id === 't2');
ok('the row carries the PROPOSED value at the top level', t1.status === 'Done', t1.status);
ok('the row also carries the record as it stands', t1.acrOriginal.status === 'Open');
ok('the row counts the fields that change', t1.acrChangedFieldCount === 1);
ok('a deletion is marked and its values are untouched', t2.isAcrProposedDelete && t2.description === 'Doomed');
ok('comments sent as id and as taskId both attach', t1.acrCommentChanges.length === 2, String(t1.acrCommentChanges.length));
ok('a record with no proposal is left alone', !rows.find(r => r.id === 't2').isAcrProposedUpdate);

// ---------------------------------------------------------------- field props
const p = acrFieldProps(t1, 'status');
ok('a proposed field offers the OLD value as the value', p.value === 'Open');
ok('a proposed field offers the NEW value as the proposal', p.proposedValue === 'Done');
ok('a proposed field is flagged as a difference', p.isProposalDiff === true);

const q = acrFieldProps(t1, 'description');
ok('an untouched field is not flagged', q.isProposalDiff === false && q.value === 'Old text');

// ---------------------------------------------------------------- safety net
const wide = enrichWithAcr([task], {
  id: 'a2', status: 'pending', changes: [
    { id: 'x1', approved: true, name: 'updateTask', changeTitle: 't',
      args: { id: 't1', status: 'Done', mysteryField: 'value nobody draws' } },
  ]}, { update: ['updateTask'] }, null)[0];
const unshown = acrUnshownDiffs(wide, ['status']);
ok('a field no panel draws is still reported by the safety net', unshown.length === 1 && unshown[0].key === 'mysteryField');

// ---------------------------------------------------------------- review card
const spec = getAcrActionSpec('addTaskComment');
ok('a comment action is recognised as a comment', spec.kind === 'comment' && spec.module === 'tasks');
ok('a milestone action now points at the billing screen', getAcrActionSpec('updateMilestone').module === 'billing');
ok('an action nobody registered still gets a kind and a label', getAcrActionSpec('doSomethingNew').kind === 'other');
ok('a brand new record shows every argument as new', diffsForChange(acr.changes[1], null).length === 2);
ok('a removal shows no field rows', diffsForChange(acr.changes[2], task).length === 0);

// ---------------------------------------------------------------- formatting
ok('a list of action items reads as text', formatAcrValue([{ description: 'Do it', assignee: 'Ana', status: 'Open' }]).includes('Do it (Ana · Open)'));
ok('an empty value shows a dash', formatAcrValue('') === '—' && formatAcrValue(null) === '—');
ok('a true/false value reads as Yes/No', formatAcrValue(true) === 'Yes');

// ------------------------------------------------- actions that imply a field
// archiveTask carries only an id, because there is nothing else to say. It
// still moves a field, and a change the user cannot see on screen is the whole
// reason this file exists. So the field it MEANS is filled in here.

ok('archiveTask implies isArchived true',
   withImpliedArgs('archiveTask', { id: 'x' }).isArchived === true);
ok('unarchiveTask implies isArchived false',
   withImpliedArgs('unarchiveTask', { id: 'x' }).isArchived === false);
ok('an ordinary action implies nothing',
   withImpliedArgs('updateTask', { id: 'x' }).isArchived === undefined);

const archDiffs = computeAcrDiffs({ id: 'x', description: 'A task' }, { id: 'x' }, 'archiveTask');
ok('archiving an active task shows one changed field', archDiffs.length === 1, String(archDiffs.length));
ok('and that field is Archived, no to yes',
   archDiffs[0]?.key === 'isArchived' && archDiffs[0]?.newValue === true,
   JSON.stringify(archDiffs[0] || null));

const restoreDiffs = computeAcrDiffs(
  { id: 'x', description: 'A task', isArchived: true }, { id: 'x' }, 'unarchiveTask');
ok('restoring an archived task shows the field going the other way',
   restoreDiffs[0]?.key === 'isArchived' && restoreDiffs[0]?.newValue === false,
   JSON.stringify(restoreDiffs[0] || null));

const noopDiffs = computeAcrDiffs({ id: 'x', isArchived: true }, { id: 'x' }, 'archiveTask');
ok('archiving something already archived shows no change at all',
   noopDiffs.length === 0, String(noopDiffs.length));

ok('archiveTask is registered as an update on the tasks screen',
   getAcrActionSpec('archiveTask').kind === 'update' &&
   getAcrActionSpec('archiveTask').module === 'tasks');


// ------------------------------ comment edits, flags, risk archive (6 Oct 2026)
ok('flagTask implies isFlagged true', withImpliedArgs('flagTask', { id: 'x' }).isFlagged === true);
ok('unflagTask implies isFlagged false', withImpliedArgs('unflagTask', { id: 'x' }).isFlagged === false);
const flagDiffs = computeAcrDiffs({ id: 'x', description: 'T' }, { id: 'x' }, 'flagTask');
ok('flagging an unflagged task shows one field, Flagged, no to yes',
   flagDiffs.length === 1 && flagDiffs[0].key === 'isFlagged' && flagDiffs[0].label === 'Flagged' && flagDiffs[0].newValue === true, JSON.stringify(flagDiffs));
ok('flagging a flagged task shows no change', computeAcrDiffs({ id: 'x', isFlagged: true }, { id: 'x' }, 'flagTask').length === 0);
ok('unflagging a flagged task shows the field going the other way',
   computeAcrDiffs({ id: 'x', isFlagged: true }, { id: 'x' }, 'unflagTask')[0]?.newValue === false);

const rd = computeAcrDiffs({ id: 'r', riskDescription: 'R' }, { id: 'r' }, 'archiveProjectRisk');
ok('archiving a risk shows one field, Archived', rd.length === 1 && rd[0].key === 'isArchived' && rd[0].newValue === true, JSON.stringify(rd));
ok('restoring a risk shows the field going the other way',
   computeAcrDiffs({ id: 'r', isArchived: true }, { id: 'r' }, 'unarchiveProjectRisk')[0]?.newValue === false);
ok('archiveProjectRisk is an update on the risks screen',
   getAcrActionSpec('archiveProjectRisk').kind === 'update' && getAcrActionSpec('archiveProjectRisk').module === 'risks');

ok('editTaskComment is a comment proposal on the tasks screen',
   getAcrActionSpec('editTaskComment').kind === 'comment' && getAcrActionSpec('editTaskComment').module === 'tasks');
ok('editDeliverableComment is a comment proposal on the deliverables screen',
   getAcrActionSpec('editDeliverableComment').kind === 'comment' && getAcrActionSpec('editDeliverableComment').module === 'deliverables');
const ceDiffs = computeAcrDiffs({ id: 't', comments: [] }, { id: 't', commentId: 'c-1', text: 'new' }, 'editTaskComment');
ok('the comment id is routing, never shown as a changed field', !ceDiffs.some(d => d.key === 'commentId'), JSON.stringify(ceDiffs));

const editedRows = enrichWithAcr(
  [{ id: 't1', description: 'one' }, { id: 't2', description: 'two' }],
  { id: 'a', changes: [
    { id: 'c1', name: 'editTaskComment', approved: true, args: { id: 't1', commentId: 'c-9', text: 'reworded' } },
    { id: 'c2', name: 'flagTask', approved: true, args: { id: 't2' } },
  ] },
  { update: ['flagTask', 'unflagTask'], comment: ['addTaskComment', 'editTaskComment'] },
  null,
);
ok('a comment edit lands on its own record, with the comment proposals',
   editedRows[0].acrCommentChanges.length === 1 && editedRows[0].acrCommentChanges[0].args.commentId === 'c-9' && editedRows[1].acrCommentChanges.length === 0);
ok('a flag proposal shows on its record as an edit holding the proposed flag',
   editedRows[1].isAcrProposedUpdate === true && editedRows[1].isFlagged === true && editedRows[1].acrOriginal.isFlagged === undefined);

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
