import type { ACRChange, AssistantChangeRequest } from '../store/acrStore';

/**
 * ACR DIFF — the one place that works out what a proposal changes.
 *
 * Before this file existed, every module wrote its own list of "does field X
 * differ" lines by hand. Four problems came out of that:
 *
 *   1. A field nobody had written a line for was invisible. The proposal still
 *      applied it on sign-off, so the user approved something never shown.
 *   2. Each module picked a different rule for what the list row shows — the
 *      old value, the new value, or both.
 *   3. Comment proposals were rendered nowhere at all.
 *   4. The same field had different names in the tool arguments and in the
 *      record (`role` vs `projectRole`, `taskId` vs `id`), so a real change
 *      compared as "no change" and disappeared.
 *
 * Everything here is derived, never hand-listed. An argument the app has never
 * seen still produces a diff row with a readable label, so nothing a proposal
 * carries can be hidden from the person signing it off.
 */

// ---------------------------------------------------------------------------
// Action registry
// ---------------------------------------------------------------------------

export type AcrActionKind = 'add' | 'update' | 'delete' | 'comment' | 'other';

interface AcrActionSpec {
  kind: AcrActionKind;
  /** Human sentence for the action itself. */
  label: string;
  /** Which module screen the change belongs to. */
  module: string;
}

/**
 * Every action the assistants can propose. `kind` decides how the change is
 * drawn; `module` decides where the "go to page" link points.
 *
 * An action missing from here is not a crash — it falls back to 'other', which
 * still renders a full argument list. That fallback is deliberate: a new tool
 * added to the sidebar must never become invisible just because nobody updated
 * this table.
 */
export const ACR_ACTIONS: Record<string, AcrActionSpec> = {
  // Timeline
  addTimelineRow: { kind: 'add', label: 'Add timeline activity', module: 'timeline' },
  updateTimelineRow: { kind: 'update', label: 'Update timeline activity', module: 'timeline' },
  deleteTimelineRow: { kind: 'delete', label: 'Delete timeline activity', module: 'timeline' },
  reorderTimelineRow: { kind: 'other', label: 'Reorder timeline activities', module: 'timeline' },
  createTimelineBaseline: { kind: 'other', label: 'Create timeline baseline', module: 'timeline' },
  // The project's holiday list, sent whole. An update, so the review panel
  // draws the old list above the new one.
  setTimelineHolidays: { kind: 'update', label: 'Change project holidays', module: 'timeline' },

  // Codex
  createCodexPage: { kind: 'add', label: 'Create codex page', module: 'codex' },
  createCodexFolder: { kind: 'add', label: 'Create codex folder', module: 'codex' },
  updateCodexPage: { kind: 'update', label: 'Update codex page', module: 'codex' },

  // Deliverables
  addDeliverable: { kind: 'add', label: 'Add deliverable', module: 'deliverables' },
  updateDeliverable: { kind: 'update', label: 'Update deliverable', module: 'deliverables' },
  deleteDeliverable: { kind: 'delete', label: 'Delete deliverable', module: 'deliverables' },
  addDeliverableComment: { kind: 'comment', label: 'Add deliverable comment', module: 'deliverables' },
  // Added 12 Sep. Same reasoning as the task pair below, plus one thing tasks
  // never had: a deliverable archives with its whole subtree, so one line here
  // can move several records. See PLAN.md 21.2.
  archiveDeliverable: { kind: 'update', label: 'Archive deliverable', module: 'deliverables' },
  unarchiveDeliverable: { kind: 'update', label: 'Restore deliverable from archive', module: 'deliverables' },
  // Added 6 Oct 2026. An edit to a comment already on the record: kind 'comment'
  // so it lands with the other comment proposals, and `commentId` (a routing
  // key) says which one. The review draws the old text above the new.
  editDeliverableComment: { kind: 'comment', label: 'Edit deliverable comment', module: 'deliverables' },

  // Tasks
  addTask: { kind: 'add', label: 'Add task', module: 'tasks' },
  updateTask: { kind: 'update', label: 'Update task', module: 'tasks' },
  deleteTask: { kind: 'delete', label: 'Delete task', module: 'tasks' },
  addTaskComment: { kind: 'comment', label: 'Add task comment', module: 'tasks' },
  // Archiving is an update, not a delete: it moves one field on a record that
  // goes on existing. Calling it 'update' is what makes the old-vs-new diff
  // below work on it like any other field change.
  archiveTask: { kind: 'update', label: 'Archive task', module: 'tasks' },
  unarchiveTask: { kind: 'update', label: 'Restore task from archive', module: 'tasks' },
  editTaskComment: { kind: 'comment', label: 'Edit task comment', module: 'tasks' },
  // Added 6 Oct 2026. One field, like the archive pair, so 'update' and the
  // implied isFlagged below make the diff show Flagged: No -> Yes.
  flagTask: { kind: 'update', label: 'Flag task', module: 'tasks' },
  unflagTask: { kind: 'update', label: 'Remove task flag', module: 'tasks' },

  // Risks
  addProjectRisk: { kind: 'add', label: 'Add risk', module: 'risks' },
  updateProjectRisk: { kind: 'update', label: 'Update risk', module: 'risks' },
  deleteProjectRisk: { kind: 'delete', label: 'Delete risk', module: 'risks' },
  // Added 6 Oct 2026, the same pair as tasks.
  archiveProjectRisk: { kind: 'update', label: 'Archive risk', module: 'risks' },
  unarchiveProjectRisk: { kind: 'update', label: 'Restore risk from archive', module: 'risks' },

  // Stakeholders
  addStakeholder: { kind: 'add', label: 'Add stakeholder', module: 'stakeholders' },
  updateStakeholder: { kind: 'update', label: 'Update stakeholder', module: 'stakeholders' },
  deleteStakeholder: { kind: 'delete', label: 'Delete stakeholder', module: 'stakeholders' },

  // Minutes of meeting
  createMoM: { kind: 'add', label: 'Create minutes of meeting', module: 'mom' },
  createMom: { kind: 'add', label: 'Create minutes of meeting', module: 'mom' },
  addMoM: { kind: 'add', label: 'Create minutes of meeting', module: 'mom' },
  addMom: { kind: 'add', label: 'Create minutes of meeting', module: 'mom' },
  updateMom: { kind: 'update', label: 'Update minutes of meeting', module: 'mom' },
  updateMoM: { kind: 'update', label: 'Update minutes of meeting', module: 'mom' },
  deleteMom: { kind: 'delete', label: 'Delete minutes of meeting', module: 'mom' },
  deleteMoM: { kind: 'delete', label: 'Delete minutes of meeting', module: 'mom' },
  updateMeetingDraft: { kind: 'add', label: 'Propose meeting outcome', module: 'mom' },

  // Documents
  addDocument: { kind: 'add', label: 'Add document', module: 'documents' },
  updateDocument: { kind: 'update', label: 'Update document', module: 'documents' },
  deleteDocument: { kind: 'delete', label: 'Delete document', module: 'documents' },

  // Billing
  updateMilestone: { kind: 'update', label: 'Update billing milestone', module: 'billing' },
};

export function getAcrActionSpec(name: string): AcrActionSpec {
  return (
    ACR_ACTIONS[name] || {
      kind: 'other',
      label: humanizeKey(name),
      module: '',
    }
  );
}

export function getAcrActionKind(name: string): AcrActionKind {
  return getAcrActionSpec(name).kind;
}

// ---------------------------------------------------------------------------
// Argument names that are routing, not content
// ---------------------------------------------------------------------------

/**
 * These arguments say WHICH record and WHY, not WHAT changes. They are never
 * shown as a changed field, because they are not one.
 */
export const ACR_ROUTING_KEYS = new Set([
  'id',
  'taskId',
  'deliverableId',
  'commentId',
  'momId',
  'riskId_ref',
  'changeTitle',
  'callId',
  'revisionId',
  'projectId',
  'sessionId',
  'insertAfterId',
  'changeId',
]);

// ---------------------------------------------------------------------------
// Arguments an action means but does not send
// ---------------------------------------------------------------------------

/**
 * Some actions say everything in their NAME. `archiveTask` carries only an id,
 * because there is nothing else to say — yet it does change a field, and a
 * change the user cannot see on screen is the whole reason this file exists.
 *
 * So the field the action implies is written here once, and both the diff and
 * the merge below read it. The change request itself still stores exactly what
 * the assistant sent, which keeps the record of what was proposed honest, and
 * every engine gets this for free without having to remember to send the field.
 *
 * Timestamps are NOT implied here. `archivedDate` is set by the executor at
 * sign-off, because a date chosen when the proposal was written would be wrong
 * by however long the proposal sat waiting.
 */
export const ACR_IMPLIED_ARGS: Record<string, Record<string, any>> = {
  archiveTask: { isArchived: true },
  unarchiveTask: { isArchived: false },
  archiveDeliverable: { isArchived: true },
  unarchiveDeliverable: { isArchived: false },
  archiveProjectRisk: { isArchived: true },
  unarchiveProjectRisk: { isArchived: false },
  flagTask: { isFlagged: true },
  unflagTask: { isFlagged: false },
};

/** The arguments an action sends, plus the ones it means. Sent wins. */
export function withImpliedArgs(actionName: string, args: any): any {
  const implied = ACR_IMPLIED_ARGS[actionName];
  if (!implied) return args;
  return { ...implied, ...(args || {}) };
}

// ---------------------------------------------------------------------------
// Argument name -> record field name
// ---------------------------------------------------------------------------

/**
 * The tool schemas and the stores do not always agree on a field name. Where
 * they disagree, the proposal used to compare against a field that does not
 * exist, so a real change looked like no change and vanished from the screen.
 *
 * Left side: what a proposal may send. Right side: what the record calls it.
 */
const GLOBAL_FIELD_ALIASES: Record<string, string> = {
  role: 'projectRole',
  influence: 'power',
  impact: 'impactLevel',
  mitigationPlan: 'mitigationStrategy',
  probabilityLevel: 'probability',
  meetingNotes: 'notes',
  decisions: 'keyDecisions',
  assignedTo: 'assignee',
  dueDateISO: 'dueDate',
};

/** Aliases that only hold for one action. `name` means the title of a meeting,
 *  but the name of a stakeholder — so it cannot go in the global table. */
const ACTION_FIELD_ALIASES: Record<string, Record<string, string>> = {
  createMoM: { name: 'title' },
  createMom: { name: 'title' },
  addMoM: { name: 'title' },
  addMom: { name: 'title' },
  updateMom: { name: 'title' },
  updateMoM: { name: 'title' },
  updateMeetingDraft: { name: 'title' },
};

export function canonicalFieldName(actionName: string, argKey: string): string {
  const perAction = ACTION_FIELD_ALIASES[actionName];
  if (perAction && perAction[argKey]) return perAction[argKey];
  return GLOBAL_FIELD_ALIASES[argKey] || argKey;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  activity: 'Activity',
  subActivity: 'Sub-Activity',
  phase: 'Phase',
  weight: 'Weight',
  progress: 'Progress',
  status: 'Status',
  owner: 'Owner',
  targetStartDate: 'Target Start',
  targetCompletionDate: 'Target Finish',
  actualStartDate: 'Actual Start',
  actualCompletionDate: 'Actual Finish',
  remarks: 'Remarks',
  title: 'Title',
  content: 'Content',
  parentId: 'Parent',
  description: 'Description',
  definitionOfDone: 'Definition Of Done',
  dueDate: 'Due Date',
  category: 'Category',
  priority: 'Priority',
  hasNestedSpace: 'Nested Space',
  linkedActivityIds: 'Linked Activities',
  type: 'Type',
  estimatedResolutionDate: 'Estimated Resolution',
  source: 'Source',
  text: 'Comment',
  isFlagged: 'Flagged',
  isArchived: 'Archived',
  riskId: 'Risk Reference',
  riskDescription: 'Risk Description',
  projectSpecificDescription: 'Project-Specific Description',
  impactArea: 'Impact Area',
  impactLevel: 'Impact Level',
  probability: 'Probability',
  postMitigationImpactLevel: 'Post-Mitigation Impact',
  postMitigationProbability: 'Post-Mitigation Probability',
  ciaConfidentiality: 'CIA — Confidentiality',
  ciaIntegrity: 'CIA — Integrity',
  ciaAvailability: 'CIA — Availability',
  mitigationStrategy: 'Mitigation Strategy',
  projectSpecificMitigationStrategy: 'Project-Specific Mitigation',
  responsibility: 'Responsibility',
  targetResolutionDate: 'Target Resolution',
  controlAnnexA: 'Control (Annex A)',
  name: 'Name',
  projectRole: 'Project Role',
  orgRole: 'Organization Role',
  organization: 'Organization',
  email: 'Email',
  phone: 'Phone',
  power: 'Power',
  interest: 'Interest',
  knowledge: 'Knowledge',
  interPersonalRelations: 'Interpersonal Relations',
  reportsToId: 'Reports To',
  projectReportsToId: 'Reports To (Project)',
  notes: 'Notes',
  date: 'Date',
  time: 'Time',
  location: 'Location',
  attendees: 'Attendees',
  agenda: 'Agenda',
  keyDecisions: 'Key Decisions',
  actionItems: 'Action Items',
  agreementName: 'Agreement',
  amount: 'Amount',
  invoiceDate: 'Invoice Date',
  startIndex: 'From Position',
  endIndex: 'To Position',
  baseRevisionId: 'Based On Revision',
  assignee: 'Assignee',
};

/** Turn `postMitigationImpactLevel` into `Post Mitigation Impact Level`. */
export function humanizeKey(key: string): string {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function acrFieldLabel(key: string): string {
  return FIELD_LABELS[key] || humanizeKey(key);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T[\d:.]+/;

/** A value reduced to something two of which can be compared safely. */
function normalizeValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((v) => normalizeValue(v)));
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return JSON.stringify(keys.map((k) => [k, normalizeValue((value as any)[k])]));
  }
  const str = String(value).trim();
  const dateMatch = str.match(ISO_DATE_TIME);
  if (dateMatch) return dateMatch[1];
  // A number sent as text and the same number sent as a number are one value.
  if (str !== '' && !Number.isNaN(Number(str))) return String(Number(str));
  return str;
}

export function acrValuesEqual(a: any, b: any): boolean {
  return normalizeValue(a) === normalizeValue(b);
}

/** A value turned into something a person can read on screen. */
export function formatAcrValue(value: any, placeholder = '—'): string {
  if (value === null || value === undefined) return placeholder;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return placeholder;
    return value
      .map((v) => {
        if (v && typeof v === 'object') {
          const obj = v as any;
          const main = obj.description || obj.title || obj.name || obj.text || '';
          const who = obj.assignee || obj.owner || obj.assignedTo || '';
          const state = obj.status || '';
          const tail = [who, state].filter(Boolean).join(' · ');
          return tail ? `${main} (${tail})` : String(main || JSON.stringify(obj));
        }
        return String(v);
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${acrFieldLabel(k)}: ${formatAcrValue(v, placeholder)}`)
      .join('\n');
  }
  const str = String(value);
  if (str.trim() === '') return placeholder;
  const dateMatch = str.match(ISO_DATE_TIME);
  if (dateMatch) return dateMatch[1];
  return str;
}

// ---------------------------------------------------------------------------
// The diff itself
// ---------------------------------------------------------------------------

export interface AcrFieldDiff {
  /** The record's own name for the field. */
  key: string;
  /** The name the proposal used, when it differs from `key`. */
  argKey: string;
  label: string;
  oldValue: any;
  newValue: any;
  /** True when the record held nothing here before. */
  isAddition: boolean;
}

export interface AcrDiffOptions {
  /** Extra argument names to leave out of the diff for this call. */
  ignoreKeys?: string[];
  /** Treat every argument as a change, even one equal to the record.
   *  Used for a brand new record, where there is no "old" to compare to. */
  treatAllAsChanged?: boolean;
}

/**
 * Compare a record against the arguments of one proposed change.
 *
 * Returns one row per field that actually moves. Ordering follows the order the
 * proposal sent the arguments in, so the assistant's own emphasis survives.
 */
export function computeAcrDiffs(
  record: any,
  args: any,
  actionName: string,
  options: AcrDiffOptions = {},
): AcrFieldDiff[] {
  if (!args || typeof args !== 'object') return [];
  args = withImpliedArgs(actionName, args);
  const extraIgnore = new Set(options.ignoreKeys || []);
  const diffs: AcrFieldDiff[] = [];
  const seen = new Set<string>();

  for (const argKey of Object.keys(args)) {
    if (ACR_ROUTING_KEYS.has(argKey) || extraIgnore.has(argKey)) continue;
    const key = canonicalFieldName(actionName, argKey);
    if (seen.has(key)) continue;

    const newValue = args[argKey];
    // An argument that was not sent at all is not a change to nothing. An
    // argument sent as an empty string IS a change — it clears the field.
    if (newValue === undefined) continue;

    const oldValue = record ? record[key] : undefined;
    if (!options.treatAllAsChanged && acrValuesEqual(oldValue, newValue)) continue;

    seen.add(key);
    diffs.push({
      key,
      argKey,
      label: acrFieldLabel(key),
      oldValue,
      newValue,
      isAddition: normalizeValue(oldValue) === '',
    });
  }

  return diffs;
}

/** Apply a proposal's arguments to a record, under the record's own field names. */
export function mergeAcrArgs<T extends Record<string, any>>(
  record: T,
  args: any,
  actionName: string,
): T {
  if (!args || typeof args !== 'object') return record;
  args = withImpliedArgs(actionName, args);
  const merged: Record<string, any> = { ...record };
  for (const argKey of Object.keys(args)) {
    if (ACR_ROUTING_KEYS.has(argKey)) continue;
    const value = args[argKey];
    if (value === undefined) continue;
    merged[canonicalFieldName(actionName, argKey)] = value;
  }
  return merged as T;
}

// ---------------------------------------------------------------------------
// Per-record view
// ---------------------------------------------------------------------------

export interface AcrRecordMeta {
  /** The record as it stands today, before anything is proposed. */
  acrOriginal: any;
  isAcrProposedAdd: boolean;
  isAcrProposedUpdate: boolean;
  isAcrProposedDelete: boolean;
  hasAcrProposal: boolean;
  acrChangeId?: string;
  acrId?: string;
  acrChange?: ACRChange;
  /** Raw arguments of the update, kept for code that still needs them. */
  updateArgs?: any;
  acrDiffs: AcrFieldDiff[];
  acrChangedFieldCount: number;
  /** Comment proposals aimed at this record. */
  acrCommentChanges: ACRChange[];
  isFocusedChange: boolean;
  /** False when the user has unticked the change in the review panel. */
  acrApproved: boolean;
}

export interface AcrActionSet {
  add?: string[];
  update?: string[];
  remove?: string[];
  comment?: string[];
}

const EMPTY_META: AcrRecordMeta = {
  acrOriginal: null,
  isAcrProposedAdd: false,
  isAcrProposedUpdate: false,
  isAcrProposedDelete: false,
  hasAcrProposal: false,
  acrDiffs: [],
  acrChangedFieldCount: 0,
  acrCommentChanges: [],
  isFocusedChange: false,
  acrApproved: true,
};

function sameId(a: any, b: any): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return String(a) === String(b);
}

/** Which record a comment proposal is aimed at. Claude's bridge sends `id`;
 *  Gemini's own schema sends `taskId` / `deliverableId`. Both must resolve. */
export function acrTargetId(change: ACRChange): any {
  const args = change.args || {};
  return args.id ?? args.taskId ?? args.deliverableId ?? args.momId;
}

/**
 * Take a module's real records and a pending change request, and return one
 * uniform list.
 *
 * Every returned row carries the PROPOSED values at the top level — so a list
 * row shows what the record will become — plus `acrOriginal` and `acrDiffs`, so
 * a detail panel can show what it was.
 *
 * Proposed new records come first, under an invented id of the form
 * `acr-add-<changeId>`, exactly as the modules already expected.
 */
export function enrichWithAcr<T extends Record<string, any>>(
  records: T[],
  acr: AssistantChangeRequest | undefined | null,
  actions: AcrActionSet,
  activeAcrChangeId: string | null,
  buildProposedRecord?: (change: ACRChange) => T,
): (T & AcrRecordMeta)[] {
  const changes = acr?.changes || [];
  const addNames = actions.add || [];
  const updateNames = actions.update || [];
  const removeNames = actions.remove || [];
  const commentNames = actions.comment || [];

  const existing = records.map((record) => {
    const updateChange = changes.find(
      (c) => updateNames.includes(c.name) && sameId(c.args?.id, record.id),
    );
    const deleteChange = changes.find(
      (c) => removeNames.includes(c.name) && sameId(c.args?.id, record.id),
    );
    const commentChanges = changes.filter(
      (c) => commentNames.includes(c.name) && sameId(acrTargetId(c), record.id),
    );

    const focusId = updateChange?.id || deleteChange?.id;
    const diffs = updateChange
      ? computeAcrDiffs(record, updateChange.args, updateChange.name)
      : [];

    const merged = updateChange
      ? mergeAcrArgs(record, updateChange.args, updateChange.name)
      : record;

    const meta: AcrRecordMeta = {
      acrOriginal: record,
      isAcrProposedAdd: false,
      isAcrProposedUpdate: !!updateChange,
      isAcrProposedDelete: !!deleteChange,
      hasAcrProposal: !!updateChange || !!deleteChange || commentChanges.length > 0,
      acrChangeId: focusId || commentChanges[0]?.id,
      acrId: acr?.id,
      acrChange: updateChange || deleteChange || commentChanges[0],
      updateArgs: updateChange?.args,
      acrDiffs: diffs,
      acrChangedFieldCount: diffs.length,
      acrCommentChanges: commentChanges,
      isFocusedChange:
        !!activeAcrChangeId &&
        (activeAcrChangeId === updateChange?.id ||
          activeAcrChangeId === deleteChange?.id ||
          commentChanges.some((c) => c.id === activeAcrChangeId)),
      acrApproved:
        (updateChange || deleteChange || commentChanges[0])?.approved !== false,
    };

    return { ...merged, ...meta } as T & AcrRecordMeta;
  });

  const adds = changes
    .filter((c) => addNames.includes(c.name))
    .map((change) => {
      const base = buildProposedRecord
        ? buildProposedRecord(change)
        : ({ ...(change.args || {}) } as T);
      const record = {
        ...base,
        id: (base as any).id || `acr-add-${change.id}`,
      } as T;

      return {
        ...record,
        ...EMPTY_META,
        acrOriginal: null,
        isAcrProposedAdd: true,
        hasAcrProposal: true,
        acrChangeId: change.id,
        acrId: acr?.id,
        acrChange: change,
        updateArgs: change.args,
        acrDiffs: computeAcrDiffs(null, change.args, change.name, {
          treatAllAsChanged: true,
        }),
        acrChangedFieldCount: 0,
        acrCommentChanges: [],
        isFocusedChange: activeAcrChangeId === change.id,
        acrApproved: change.approved !== false,
      } as T & AcrRecordMeta;
    });

  return [...adds, ...existing];
}

// ---------------------------------------------------------------------------
// Field-level props for EditableField
// ---------------------------------------------------------------------------

export interface AcrFieldProps {
  value: string;
  isProposalDiff: boolean;
  proposedValue?: string;
}

/**
 * Everything an `EditableField` needs to draw one field of a record that may
 * have a proposal on it.
 *
 * Pass the enriched row. If the field is part of the proposal, the editor shows
 * OLD and NEW and edits the NEW one. If it is not, it behaves as it always has.
 *
 * Replaces the hand-written `hasXDiff` line each module used to carry per
 * field. That is the whole point: a field can no longer be left out by accident.
 */
export function acrFieldProps(item: any, key: string, fallback = ''): AcrFieldProps {
  if (!item) return { value: fallback, isProposalDiff: false };

  const diff: AcrFieldDiff | undefined = (item.acrDiffs || []).find(
    (d: AcrFieldDiff) => d.key === key,
  );

  if (diff && item.isAcrProposedUpdate) {
    return {
      value: valueForEditor(diff.oldValue, fallback),
      isProposalDiff: true,
      proposedValue: valueForEditor(diff.newValue, fallback),
    };
  }

  return { value: valueForEditor(item[key], fallback), isProposalDiff: false };
}

function valueForEditor(value: any, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return formatAcrValue(value, fallback);
}

/**
 * The diffs a module's own fields did not draw.
 *
 * Every detail panel renders these under the fields it knows, so an argument
 * the module has never heard of is still on screen. This is the safety net that
 * makes "all proposed changes are visible" true rather than hoped for.
 */
export function acrUnshownDiffs(item: any, shownKeys: string[]): AcrFieldDiff[] {
  const shown = new Set(shownKeys);
  return ((item?.acrDiffs || []) as AcrFieldDiff[]).filter((d) => !shown.has(d.key));
}

/** Every diff a single change carries, given the record it applies to. */
export function diffsForChange(change: ACRChange, record: any): AcrFieldDiff[] {
  const kind = getAcrActionKind(change.name);
  if (kind === 'delete') return [];
  return computeAcrDiffs(kind === 'add' ? null : record, change.args, change.name, {
    treatAllAsChanged: kind === 'add',
  });
}
