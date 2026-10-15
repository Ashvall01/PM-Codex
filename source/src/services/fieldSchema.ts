/**
 * FIELD SCHEMA — the rules behind a value, for whoever is about to propose one.
 *
 * PLAN.md section 17, item 1 (9 Sep): a risk proposal that sent `impactLevel:
 * 'Medium'` — the generic Low/Medium/High scale, not this store's actual
 * `ImpactLevel` union — threw inside `calculateRiskValue` before the store's
 * `set()` call ran, so the add/update silently did nothing while the sign-off
 * notice still said APPLIED. The directive now orders a full read before every
 * proposal, but that is a written rule, not a mechanism: nothing stops the next
 * value from being wrong in the same way. This file is the mechanism.
 *
 * `getFieldSchema(module)` answers one question: for the fields on this module
 * that are actually constrained, what are the exact values, spelled exactly
 * right? It reads the same unions the stores themselves are typed against
 * (duplicated here as runtime arrays, since a TypeScript union type does not
 * exist at runtime — see the comment above each list) plus the live risk
 * matrix, so it cannot say something the store would disagree with.
 *
 * NOTE FOR CODING AGENTS: do not modify this file. Like
 * `src/services/bridgeClient.ts`, it is maintained together with the bridge
 * in the project's `bridge/` folder. See AGENTS.md.
 */

import {
  useRisksStore,
  ImpactLevel,
  ProbabilityLevel,
  ImpactArea,
  RiskStatus,
} from '../store/risksStore';
import { ACR_ACTIONS, acrFieldLabel } from '../utils/acrDiff';

export type FieldKind = 'enum' | 'text' | 'number' | 'date' | 'boolean' | 'computed';

export interface FieldRule {
  field: string;
  label: string;
  kind: FieldKind;
  /** Present only when kind is 'enum' or 'computed' and the set is known. */
  values?: string[];
  note?: string;
}

export interface RiskMatrixSchema {
  impactLevels: string[];
  probabilityLevels: string[];
  riskValues: string[];
  /** The LIVE matrix — user-editable in Risk Matrix Settings, not always the shipped default. */
  matrix: Record<string, Record<string, string>>;
  rule: string;
}

export interface ModuleFieldSchema {
  module: string;
  /** Change-request action names that write to this module, from the same registry the review panel uses. */
  actions: string[];
  fields: FieldRule[];
  riskMatrix?: RiskMatrixSchema;
  note?: string;
}

// ---------------------------------------------------------------------------
// Runtime copies of each store's union types. A `type` vanishes at compile
// time, so the exact literal values a proposal must match are re-declared
// here — the same way Risks.tsx already declares IMPACT_LEVELS / PROBABILITIES
// / STATUS_OPTIONS for its own dropdowns. If a store's union changes, this
// list has to change with it; nothing enforces that automatically, which is
// exactly the kind of drift `test/field-schema.test.mjs` checks for.
// ---------------------------------------------------------------------------

// risksStore.ts — ImpactArea
const IMPACT_AREAS: ImpactArea[] = [
  'Cost', 'Schedule', 'Scope', 'Quality', 'Resource', 'Reputation', 'Legal',
  'Safety and Environmental', 'Stakeholder',
];
// risksStore.ts — ImpactLevel. Note "Moderate", not "Medium" — the exact value
// that broke item 1 above.
const IMPACT_LEVELS: ImpactLevel[] = [
  'Positive (Opportunity)', 'Low', 'Moderate', 'High', 'Critical', 'Catastrophic',
];
// risksStore.ts — ProbabilityLevel
const PROBABILITIES: ProbabilityLevel[] = [
  'Rare', 'Low', 'Moderate', 'High', 'Almost Certain', 'Uncertain',
];
// risksStore.ts — RiskStatus
const RISK_STATUSES: RiskStatus[] = ['Open', 'Under Mitigation', 'Mitigated'];
// risksStore.ts — RiskValue, minus '' (not a value a proposal should ever send;
// it means "not yet computed").
const RISK_VALUES = ['Lowest', 'Low', 'Medium', 'High', 'Highest', 'Expert Judgment'];

// tasksStore.ts — TaskStatus / TaskType. Shared by MoM action items too
// (MoMActionItemStatus = TaskStatus in momStore.ts).
const TASK_STATUSES = ['Open', 'In Progress', 'On Hold', 'Blocked', 'Done', 'Dropped'];
const TASK_TYPES = ['Action Item', 'Issue'];
// tasksStore.ts / deliverablesStore.ts / momStore.ts — Priority. The generic
// Low/Medium/High scale. This is NOT the risk register's Impact/Probability
// scale, which does not have "Medium" — the two are easy to conflate because
// both are nominally "severity", and that conflation is what item 1 above was.
const PRIORITIES = ['Low', 'Medium', 'High'];

// deliverablesStore.ts — DeliverableStatus
const DELIVERABLE_STATUSES = [
  'Pending', 'In Progress', 'On Hold', 'In Review', 'Signed Off', 'Dropped', 'Blocked',
];

// documentsStore.ts — DocumentType / DocumentStatus. Both typed `| string` in
// the store, so nothing rejects a value outside this list — these are the
// values the app's own UI is built around.
const DOCUMENT_TYPES = ['Requirement', 'Design', 'Test', 'Report', 'Contract', 'Manual', 'Other'];
const DOCUMENT_STATUSES = ['Draft', 'In Review', 'Approved', 'Archived'];

// billingStore.ts — Status. Also typed `| string`.
const BILLING_STATUSES = ['Pending', 'In Progress', 'Done'];

// stakeholdersStore.ts — Level. Also typed `| string`.
const STAKEHOLDER_LEVELS = ['High', 'Medium', 'Low'];

// ActivityTable.tsx — STATUS_OPTIONS for a timeline activity. The record's
// `status` field is plain `string` in timelineStore.ts; this list exists only
// as the app's own dropdown, so nothing enforces it either.
const TIMELINE_STATUSES = [
  'Completed', 'Completed With Delay', 'Work In Progress', 'Delayed WIP',
  'Not Started', 'Planned', 'Backlog', 'Dropped', 'On Hold',
];

// ---------------------------------------------------------------------------

function field(f: string, kind: FieldKind, values?: string[], note?: string, labelOverride?: string): FieldRule {
  return {
    field: f,
    label: labelOverride || acrFieldLabel(f),
    kind,
    ...(values ? { values } : {}),
    ...(note ? { note } : {}),
  };
}

/** Action names from the same registry the review panel diffs against, filtered to one module. */
function actionsFor(acrModuleKey: string): string[] {
  return Object.entries(ACR_ACTIONS)
    .filter(([, spec]) => spec.module === acrModuleKey)
    .map(([name]) => name)
    .sort();
}

const LOOSE_NOTE = 'Not strictly enforced by the store (the field accepts any string), but this is the set the app is built around.';

export function getFieldSchema(moduleName: string): ModuleFieldSchema {
  switch (moduleName) {
    case 'risks': {
      const liveMatrix = useRisksStore.getState().riskMatrixConfig as unknown as Record<string, Record<string, string>>;
      return {
        module: 'risks',
        actions: actionsFor('risks'),
        fields: [
          field('impactArea', 'enum', IMPACT_AREAS),
          field('impactLevel', 'enum', IMPACT_LEVELS,
            'Exact spelling matters — "Moderate", not "Medium". A value outside this list used to fail the whole add/update silently before it even reached the review panel. See riskMatrix below for what each combination scores.'),
          field('probability', 'enum', PROBABILITIES),
          field('postMitigationImpactLevel', 'enum', IMPACT_LEVELS),
          field('postMitigationProbability', 'enum', PROBABILITIES),
          field('status', 'enum', RISK_STATUSES),
          field('riskValue', 'computed', RISK_VALUES,
            'Do not send this field. The store derives it from impactLevel/probability (or postMitigationImpactLevel/postMitigationProbability once status is "Mitigated") against riskMatrix below, every time either changes.'),
          field('controlAnnexA', 'text', undefined,
            'Free text — an ISO/IEC 27001 Annex A control reference (e.g. "A.8.24"). No fixed list.'),
        ],
        riskMatrix: {
          impactLevels: IMPACT_LEVELS,
          probabilityLevels: PROBABILITIES,
          riskValues: RISK_VALUES,
          matrix: liveMatrix,
          rule: 'riskValue = matrix[impact][probability]. Which pair counts as "impact"/"probability" depends on status: impactLevel/probability while Open or Under Mitigation, postMitigationImpactLevel/postMitigationProbability once Mitigated. This is the live matrix — user-editable in Risk Matrix Settings — not always the shipped default.',
        },
      };
    }
    case 'tasks':
      return {
        module: 'tasks',
        actions: actionsFor('tasks'),
        fields: [
          field('status', 'enum', TASK_STATUSES),
          field('type', 'enum', TASK_TYPES),
          field('priority', 'enum', PRIORITIES),
        ],
      };
    case 'deliverables':
      return {
        module: 'deliverables',
        actions: actionsFor('deliverables'),
        fields: [
          field('status', 'enum', DELIVERABLE_STATUSES),
          field('priority', 'enum', PRIORITIES),
        ],
      };
    case 'documents':
      return {
        module: 'documents',
        actions: actionsFor('documents'),
        fields: [
          field('type', 'enum', DOCUMENT_TYPES, LOOSE_NOTE),
          field('status', 'enum', DOCUMENT_STATUSES, LOOSE_NOTE),
        ],
      };
    case 'billing':
      return {
        module: 'billing',
        actions: actionsFor('billing'),
        fields: [
          field('workStatus', 'enum', BILLING_STATUSES, LOOSE_NOTE),
          field('prerequisiteDocumentStatus', 'enum', BILLING_STATUSES, LOOSE_NOTE),
          field('invoicingStatus', 'enum', BILLING_STATUSES, LOOSE_NOTE),
        ],
      };
    case 'stakeholders':
      return {
        module: 'stakeholders',
        actions: actionsFor('stakeholders'),
        fields: [
          field('power', 'enum', STAKEHOLDER_LEVELS, LOOSE_NOTE),
          field('interest', 'enum', STAKEHOLDER_LEVELS, LOOSE_NOTE),
          field('knowledge', 'enum', STAKEHOLDER_LEVELS, LOOSE_NOTE),
        ],
      };
    case 'timeline':
      return {
        module: 'timeline',
        actions: actionsFor('timeline'),
        fields: [
          field('status', 'enum', TIMELINE_STATUSES,
            'A UI convention only — the record stores plain text, so nothing rejects a value outside this list, but the app\'s own dropdown never offers one.'),
          field('holidays', 'date', undefined,
            'The project\'s days off, YYYY-MM-DD, set with setTimelineHolidays { holidays: [...] }. Send the WHOLE list — what you send replaces it, so keep every date already there that should stay (the snapshot lists them). WORKDAY and NETWORKDAYS skip these days and weekends.',
            'Holidays'),
          field('formulas', 'text', undefined,
            'Any column of a row can hold a formula instead of a value: send the field with a value starting with "=", e.g. targetCompletionDate: "=WORKDAY([Target Start], 10)". The app works out the answer and keeps the formula; sending a plain value replaces the formula, as in Excel. Refs: Excel style (H3) or this row\'s columns by name ([Target Start], [Target End], [Actual Start], [Actual End], [Weight], [Prog %], [Status]). Functions include TODAY, WORKDAY, NETWORKDAYS, EDATE, EOMONTH, IF, AND, OR, MIN, MAX, SUM, ROUND. read_item on a timelineActivity returns its formulas.',
            'Formulas'),
        ],
      };
    case 'moms':
      return {
        module: 'moms',
        actions: actionsFor('mom'),
        fields: [
          field('actionItems[].status', 'enum', TASK_STATUSES, 'Action items share the task status scale.', 'Action Item Status'),
          field('actionItems[].type', 'enum', TASK_TYPES, undefined, 'Action Item Type'),
          field('actionItems[].priority', 'enum', PRIORITIES, undefined, 'Action Item Priority'),
        ],
        note: 'A meeting action item that already carries a taskId has been filed in the task tracker — edit it there (call get_field_schema with module "tasks" and propose updateTask), not through updateMom. See AGENTS.md, "Meeting action items belong to the meeting".',
      };
    case 'codex':
      return {
        module: 'codex',
        actions: actionsFor('codex'),
        fields: [
          field('parentId', 'text', undefined,
            'Required for createCodexPage: the id of a FOLDER. Or send folder with a folder title instead — a title no folder has yet creates that folder on sign-off.',
            'Folder'),
        ],
        note: 'Two levels only. A folder (a record with no parent) holds pages and has no content of its own — never send content for a folder. A page always sits in a folder; pages cannot hold pages. createCodexFolder makes an empty folder; updateCodexPage renames a folder or moves a page to another folder with parentId.',
      };
    case 'project':
      return {
        module: 'project',
        actions: [],
        fields: [],
        note: 'No constrained fields on the project record itself (name, description).',
      };
    default:
      return {
        module: moduleName,
        actions: actionsFor(moduleName),
        fields: [],
        note: `No field rules recorded for module "${moduleName}".`,
      };
  }
}
