import { useAppStore } from '../store/appStore';
import { useTimelineStore } from '../store/timelineStore';
import { useCodexStore } from '../store/codexStore';
import { useMomStore } from '../store/momStore';
import { useStakeholdersStore } from '../store/stakeholdersStore';
import { useDeliverablesStore } from '../store/deliverablesStore';
import { useRisksStore } from '../store/risksStore';
import { useDocumentsStore } from '../store/documentsStore';
import { useTasksStore } from '../store/tasksStore';
import { useBillingStore } from '../store/billingStore';
import { useIdAliasStore } from '../store/idAliasStore';
import { usePIIStore } from '../store/piiStore';
import { sanitizeString } from '../utils/piiSanitization';
import { ARCHIVABLE_MODULES, ArchivableModule, archivedNotice } from '../utils/archive';
import { isCodexFolder, codexFolderOf } from '../utils/codexRules';

/**
 * Universal Project Context Engine
 * Powers AI Sidebar, Meeting Intelligence, and the Cowork bridge.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE LOOKS THE WAY IT DOES
 *
 * Every consumer of this snapshot pays for it by the token. The old format
 * wrote a field label on every line — "| Status: ", "| Due: ", "| Priority: "
 * and so on — which cost 14,104 characters of pure punctuation across the
 * tasks and deliverables sections alone, on a project of 264 records. It also
 * wrote full ISO timestamps where a date was meant, and printed default values
 * ("Nested Space: No" on 134 of 136 deliverables) that carry no information.
 *
 * The snapshot reached 62,046 characters and stopped fitting in a single MCP
 * tool result.
 *
 * Three rules fix that without losing a single record:
 *
 *   1. Label once, in a header line, not on every row.
 *   2. Dates are YYYY-MM-DD. Never a timestamp.
 *   3. A blank field means "none / not applicable". Do not spell it out.
 *
 * Plus one shape rule: records are grouped under their status, so the status
 * word is written once per group instead of once per record. Closed records
 * still appear individually, by name — they are never collapsed into a count —
 * but they drop the fields that are empty for them anyway.
 * ---------------------------------------------------------------------------
 */

export interface SkeletonOptions {
  /** Include the billing section. The sidebar hides it when billing is off. */
  includeBilling?: boolean;
  /** Include the project name and description header. */
  includeHeader?: boolean;
  /**
   * Character budget for the whole skeleton. When the assembled text is larger,
   * the biggest modules are held back one at a time until it fits, and each one
   * is replaced by a stub naming it and the call that fetches it.
   *
   * Nothing is silently lost. The skeleton says out loud what is missing, so a
   * reader learns about the gap from the payload itself rather than from a rule
   * it has to remember. Omit for no limit.
   */
  maxChars?: number;
}

/** The modules a skeleton is made of, in the order they are written. */
export type ModuleKey =
  | 'project'
  | 'stakeholders'
  | 'billing'
  | 'timeline'
  | 'tasks'
  | 'deliverables'
  | 'risks'
  | 'documents'
  | 'moms'
  | 'codex';

export const MODULE_KEYS: ModuleKey[] = [
  'project', 'stakeholders', 'billing', 'timeline', 'tasks', 'deliverables', 'risks', 'documents', 'moms', 'codex',
];

interface Section {
  key: ModuleKey;
  /** What the module is called in a sentence, for the held-back notice. */
  label: string;
  /** How many records it holds. Zero for the project header. */
  count: number;
  /**
   * How many records this module is hiding because they are archived.
   *
   * Carried on the section, not only written into its header line, because a
   * held-back module is replaced by a stub and its header line never ships. On
   * a project big enough to hold a module back — which is the usual case here —
   * that is exactly when the reader most needs telling.
   */
  archived?: number;
  lines: string[];
}

/** Statuses that mean "no longer being worked on". Kept in one place. */
const CLOSED_TASK_STATUS = new Set(['done', 'dropped', 'closed']);
const CLOSED_DELIVERABLE_STATUS = new Set(['signed off', 'dropped']);

/** Any date-ish string to YYYY-MM-DD. Blank when there is nothing usable. */
function ymd(value?: string | number | null): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

/** Blank for anything empty or a placeholder, so the reader is not told "N/A" 260 times. */
function val(value?: string | number | null): string {
  const s = String(value ?? '').trim();
  return s === 'N/A' || s === 'None' || s === '-' || s === '?' ? '' : s;
}

/** One row. A missing field costs 3 characters, not a label. */
function row(...fields: Array<string | number | null | undefined>): string {
  return fields.map((f) => (f === null || f === undefined ? '' : String(f))).join(' | ');
}

/**
 * Groups records by status, open statuses first, closed last. Sort is stable,
 * so the original order survives inside each group.
 */
function groupByStatus<T>(items: T[], statusOf: (item: T) => string, closed: Set<string>): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const status = String(statusOf(item) || '').trim() || 'Unspecified';
    if (!groups.has(status)) groups.set(status, []);
    (groups.get(status) as T[]).push(item);
  });
  return Array.from(groups.entries()).sort(
    (a, b) => (closed.has(a[0].toLowerCase()) ? 1 : 0) - (closed.has(b[0].toLowerCase()) ? 1 : 0)
  );
}

const HOW_TO_READ = [
  '=== HOW TO READ THIS SKELETON ===',
  'Each section starts with one header line naming its columns. Fields are separated by " | ".',
  'A blank field means none or not applicable. All dates are YYYY-MM-DD.',
  'Tasks and deliverables are grouped by status. Closed groups list id and title only —',
  'every closed record is still named. Use the read tools for full detail on any record.',
  'Archived records are NOT listed here at all. A section header says how many it is hiding.',
  'To see them, call read_archive (Claude) or getArchivedItems (Gemini). An archived record is',
  "read-only: to change one, propose that module's unarchive action first — unarchiveTask,",
  'unarchiveDeliverable, unarchiveProjectRisk.',
];

const sizeOf = (section: Section) => section.lines.join('\n').length + 1;

/**
 * Builds every module of the project skeleton. Nothing here knows about
 * budgets; assembling and trimming happens in buildProjectSkeleton, and one
 * module on its own is what buildProjectModule returns.
 */
function buildSections(activeProjectId: string, options: SkeletonOptions): Section[] {
  const { includeBilling = true, includeHeader = true } = options;

  const project = useAppStore.getState().projects.find((p) => p.id === activeProjectId);
  const projectTimeline = useTimelineStore.getState().getProjectTimeline(activeProjectId);
  const codexPages = useCodexStore.getState().getPagesForProject(activeProjectId);
  const moms = useMomStore.getState().moms.filter((m) => m.projectId === activeProjectId);
  const stakeholders = useStakeholdersStore.getState().stakeholders.filter((st) => st.projectId === activeProjectId);
  // getDeliverablesByProject returns ACTIVE deliverables only.
  //
  // The archived count is RECORDS, not subtree roots, and the difference is not
  // academic: the first real archiving pass put 98 records away under 52 roots,
  // and the header claimed 52. The sentence this number feeds says "archived and
  // NOT LISTED", and all 98 are. getArchivedDeliverablesByProject returns roots
  // because that is the right shape for the archive LIST — one row per thing you
  // can restore — but the list shape and the hidden-record count are two
  // different questions, and reusing one number for both understated the gap by
  // 46 records. Tasks could never show this: a flat module has one record per
  // root, so the two numbers are always equal there. PLAN.md 21.14.
  const deliverables = useDeliverablesStore.getState().getDeliverablesByProject(activeProjectId);
  const archivedDeliverableCount = useDeliverablesStore.getState().deliverables
    .filter((d: any) => d.projectId === activeProjectId && d.isArchived).length;
  // Same rule as tasks: active risks are listed, the archive is only counted.
  const risks = useRisksStore.getState().getProjectRisks(activeProjectId);
  const archivedRiskCount = useRisksStore.getState().getArchivedRisksByProject(activeProjectId).length;
  const documents = useDocumentsStore.getState().documents.filter((d) => d.projectId === activeProjectId);
  // getTasksByProject returns ACTIVE tasks only. The archive is counted, never
  // listed, so the reader is told what it cannot see instead of being left to
  // assume there is nothing there.
  const tasks = useTasksStore.getState().getTasksByProject(activeProjectId);
  const archivedTaskCount = useTasksStore.getState().getArchivedTasksByProject(activeProjectId).length;
  const billingMilestones = useBillingStore.getState().milestones.filter((m) => m.projectId === activeProjectId);
  const billingCurrency = useBillingStore.getState().currency || 'USD';
  const { getAlias } = useIdAliasStore.getState();

  const sections: Section[] = [];
  const add = (key: ModuleKey, label: string, count: number, lines: string[], archived = 0) => {
    if (lines.length > 0) sections.push({ key, label, count, archived, lines });
  };

  // ------------------------------------------------------------- project
  if (includeHeader && project) {
    const lines = ['=== PROJECT ===', project.name];
    if (project.description) lines.push(project.description);
    add('project', 'the project header', 0, lines);
  }

  // -------------------------------------------------------- stakeholders
  if (stakeholders.length > 0) {
    const lines = [`=== STAKEHOLDERS (${stakeholders.length}) ===`, 'id | name | role | organisation | power/interest'];
    stakeholders.forEach((st: any) => {
      lines.push(row(
        getAlias(st.id, 'STK'),
        st.name,
        val(st.projectRole || st.role),
        val(st.organization),
        `${val(st.power) || '?'}/${val(st.interest) || '?'}`
      ));
    });
    add('stakeholders', 'stakeholders', stakeholders.length, lines);
  }

  // ------------------------------------------------------------- billing
  if (includeBilling && billingMilestones.length > 0) {
    const lines = [
      `=== BILLING MILESTONES (${billingMilestones.length}, ${billingCurrency}) ===`,
      'id | agreement | term | net value | % | work status | invoicing status | invoice date',
    ];
    billingMilestones.forEach((m: any) => {
      lines.push(row(
        getAlias(m.id, 'MLS'),
        val(m.agreementName),
        val(m.term),
        Number(m.valueNet || 0).toLocaleString(),
        m.percentage,
        val(m.workStatus),
        val(m.invoicingStatus),
        ymd(m.invoiceDate)
      ));
    });
    add('billing', 'billing milestones', billingMilestones.length, lines);
  }

  // ------------------------------------------------------------ timeline
  const activeRevision = projectTimeline?.revisions.find((r) => r.id === projectTimeline.activeRevisionId);
  if (projectTimeline && activeRevision) {
    const others = projectTimeline.revisions
      .filter((r) => r.id !== activeRevision.id)
      .map((r) => r.name)
      .join(', ');
    const lines = [`=== TIMELINE — ${activeRevision.name} (${activeRevision.activities.length} activities) ===`];
    if (others) lines.push(`Other baselines: ${others}`);
    // The holiday list is project data like any other: WORKDAY and NETWORKDAYS
    // skip these days, so a reader planning dates needs them. Written in full;
    // setTimelineHolidays replaces the whole list.
    const holidays = projectTimeline.holidays || [];
    lines.push(holidays.length
      ? `Holidays (${holidays.length}, skipped by WORKDAY/NETWORKDAYS with weekends): ${holidays.join(', ')}`
      : 'Holidays: none set (WORKDAY/NETWORKDAYS skip weekends only).');
    const withFormulas = activeRevision.activities.filter((a: any) => a.formulas && Object.keys(a.formulas).length).length;
    lines.push('id | sub-activity | progress | status | start > end');
    if (withFormulas) lines.push(`A trailing "fx: …" names the fields worked out by a formula (${withFormulas} rows). read_item returns the formula text.`);

    // Two levels of grouping, so phase and activity names are written once each
    // instead of once per row.
    const phases = Array.from(new Set(activeRevision.activities.map((a: any) => a.phase)));
    phases.forEach((phase) => {
      lines.push(`# ${phase}`);
      const inPhase = activeRevision.activities.filter((a: any) => a.phase === phase);
      const names = Array.from(new Set(inPhase.map((a: any) => a.activity)));
      names.forEach((name) => {
        lines.push(`## ${name}`);
        inPhase
          .filter((a: any) => a.activity === name)
          .forEach((act: any) => {
            // progress is stored 0-1 everywhere else in the app. Printing it raw
            // made a finished activity read as "1%".
            const pct = `${Math.round(Number(act.progress || 0) * 100)}%`;
            const fx = act.formulas && Object.keys(act.formulas).length
              ? `fx: ${Object.keys(act.formulas).join(', ')}`
              : null;
            const cells = [
              getAlias(act.id, 'ACT'),
              act.subActivity,
              pct,
              val(act.status),
              `${ymd(act.targetStartDate) || '?'} > ${ymd(act.targetCompletionDate) || '?'}`,
            ];
            lines.push(row(...(fx ? [...cells, fx] : cells)));
          });
      });
    });
    add('timeline', 'the timeline', activeRevision.activities.length, lines);
  }

  // --------------------------------------------------------------- tasks
  // A project whose tasks are ALL archived still prints this section, with a
  // count of 0 and the notice. A missing section reads as "this project has no
  // tasks", which would be false.
  if (tasks.length > 0 || archivedTaskCount > 0) {
    const lines = [
      `=== TASKS & ACTION ITEMS (${tasks.length}${archivedNotice(archivedTaskCount)}) ===`,
      'open groups: id | type | description | due | priority | FLAGGED when the user flagged it',
      'closed groups: id | description | FLAGGED when the user flagged it',
    ];
    groupByStatus(tasks as any[], (t: any) => t.status, CLOSED_TASK_STATUS).forEach(([status, group]) => {
      const isClosed = CLOSED_TASK_STATUS.has(status.toLowerCase());
      lines.push(`-- ${status} (${group.length})`);
      group.forEach((t: any) => {
        const id = getAlias(t.id, 'TSK');
        // The user's flag is trailing and only printed when set, so an
        // unflagged task reads exactly as before.
        const flag = t.isFlagged ? ['FLAGGED'] : [];
        lines.push(isClosed
          ? row(id, t.description, ...flag)
          : row(id, val(t.type), t.description, ymd(t.estimatedResolutionDate), val(t.priority) || 'Medium', ...flag));
      });
    });
    add('tasks', 'tasks and action items', tasks.length, lines, archivedTaskCount);
  }

  // -------------------------------------------------------- deliverables
  // Same rule as tasks: a project whose deliverables are ALL archived still
  // prints this section, with a count of 0 and the notice. A missing section
  // reads as "this project has no deliverables", which would be false.
  if (deliverables.length > 0 || archivedDeliverableCount > 0) {
    const lines = [
      `=== DELIVERABLES (${deliverables.length}${archivedNotice(archivedDeliverableCount)}) ===`,
      'open groups: id | title | due | priority | parent | nested | definition of done',
      'closed groups: id | title',
    ];
    groupByStatus(deliverables as any[], (d: any) => d.status, CLOSED_DELIVERABLE_STATUS).forEach(([status, group]) => {
      const isClosed = CLOSED_DELIVERABLE_STATUS.has(status.toLowerCase());
      lines.push(`-- ${status} (${group.length})`);
      group.forEach((d: any) => {
        const id = getAlias(d.id, 'DEL');
        lines.push(isClosed
          ? row(id, d.title)
          : row(
              id,
              d.title,
              ymd(d.dueDate),
              val(d.priority) || 'Medium',
              d.parentId ? getAlias(d.parentId, 'DEL') : '',
              d.hasNestedSpace ? 'nested' : '',
              val(d.definitionOfDone)
            ));
      });
    });
    add('deliverables', 'deliverables', deliverables.length, lines, archivedDeliverableCount);
  }

  // --------------------------------------------------------------- risks
  // A project whose risks are ALL archived still prints this section, with a
  // header that says so — same rule as tasks and deliverables.
  if (risks.length > 0 || archivedRiskCount > 0) {
    const lines = [
      `=== RISKS (${risks.length}${archivedNotice(archivedRiskCount)}) ===`,
      'id | description | status | owner | impact/probability | value | mitigation',
      'An arrow in impact/probability shows the level before > after mitigation.',
      'A mitigated risk shows no mitigation text here — read_item returns it.',
    ];
    risks.forEach((r: any) => {
      // A risk carries two descriptions and two mitigations: a generic one from
      // the risk library, and a project-specific one written by hand.
      //
      // Only the generic pair used to be printed here. On this project the
      // generic mitigation is usually EMPTY while the real, considered plan sits
      // in the project-specific field — so risks that had been thought through
      // read as unmitigated to both assistants, and to anyone skimming the
      // summary. The hand-written text is the one that matters, so it wins.
      // The generic text is the fallback, and full detail is a read_item away.
      const description = val(r.projectSpecificDescription) || val(r.riskDescription);
      const mitigation = val(r.projectSpecificMitigationStrategy) || val(r.mitigationStrategy);
      const mitigated = String(r.status || '').toLowerCase() === 'mitigated';
      const grade = mitigated
        ? `${val(r.impactLevel) || '?'}/${val(r.probability) || '?'} > ${val(r.postMitigationImpactLevel) || '?'}/${val(r.postMitigationProbability) || '?'}`
        : `${val(r.impactLevel) || '?'}/${val(r.probability) || '?'}`;
      // A MITIGATED risk prints no mitigation text (PLAN.md 21.6). On a
      // mitigated risk that text is the record of what was done; on an open one
      // it is the live plan, and a reader who cannot see it will misjudge the
      // risk. The grade still carries the before > after levels, so the register
      // still reads correctly. The header says this out loud, which is the rule
      // the whole skeleton lives by.
      lines.push(mitigated
        ? row(getAlias(r.id, 'RSK'), description, val(r.status), val(r.owner), grade, val(r.riskValue))
        : row(getAlias(r.id, 'RSK'), description, val(r.status), val(r.owner), grade, val(r.riskValue), mitigation));
    });
    add('risks', 'risks', risks.length, lines, archivedRiskCount);
  }

  // ----------------------------------------------------------- documents
  if (documents.length > 0) {
    const lines = [
      `=== DOCUMENTS (${documents.length}) ===`,
      'id | title | type | status | version | owner | url',
    ];
    documents.forEach((d: any) => {
      lines.push(row(
        getAlias(d.id, 'DOC'),
        d.title,
        val(d.type),
        val(d.status),
        val(d.version),
        val(d.owner),
        val(d.url)
      ));
    });
    add('documents', 'documents', documents.length, lines);
  }

  // ---------------------------------------------------------------- moms
  if (moms.length > 0) {
    // Attendees are gone from this line (PLAN.md 21.5). The field is free text
    // with no dependable separator — some records are comma-separated with role
    // annotations in brackets and semicolons between groups, at least one is
    // space-separated — so a derived count would be wrong often enough to
    // mislead. The column goes rather than becoming a bad number. Nothing is
    // hidden: the attendees are still on the record.
    const lines = [
      `=== MINUTES OF MEETING (${moms.length}) ===`,
      'id | date | title | open items',
      'Attendees are on the record, not here — read_item returns them.',
    ];
    moms.forEach((m: any) => {
      const openCount = (m.actionItems || []).filter((ai: any) => {
        // An item pushed to the task tracker is counted under Tasks, not here.
        if (ai.taskId) return false;
        const st = String(ai.status || 'Open').toLowerCase();
        return st !== 'done' && st !== 'dropped' && st !== 'closed';
      }).length;
      lines.push(row(getAlias(m.id, 'MOM'), ymd(m.date), m.title, openCount));
    });
    add('moms', 'meeting minutes', moms.length, lines);
  }

  // ----------------------------------------------------------- codex map
  // Folders and the pages inside them, the way the Codex screen shows them.
  // It used to be one flat "id | title | parent" list, which gave no sign that
  // a record with no parent is a folder — so both assistants wrote content
  // onto folders and filed pages under pages, and none of it was ever shown.
  if (codexPages.length > 0) {
    const folders = codexPages.filter((cp: any) => isCodexFolder(cp));
    const pagesOnly = codexPages.filter((cp: any) => !isCodexFolder(cp));
    const lines = [
      `=== CODEX (${folders.length} folders, ${pagesOnly.length} pages) ===`,
      'A folder holds pages and has no content of its own. A page always sits in a folder; pages cannot hold pages.',
      'New page: createCodexPage with parentId = a folder id (or folder = a folder title; a new title makes the folder).',
      'id | page title',
    ];
    const byFolder = new Map<string, any[]>();
    const unfiled: any[] = [];
    pagesOnly.forEach((cp: any) => {
      const folder = codexFolderOf(codexPages as any, cp);
      if (!folder) { unfiled.push(cp); return; }
      if (!byFolder.has(folder.id)) byFolder.set(folder.id, []);
      byFolder.get(folder.id)!.push(cp);
    });
    folders.forEach((f: any) => {
      const notes = String(f.content || '').replace(/<[^>]*>/g, '').trim() ? ' — has older folder notes, read_item returns them' : '';
      lines.push(`# ${f.title} (${getAlias(f.id, 'CDX')}, folder)${notes}`);
      (byFolder.get(f.id) || []).forEach((cp: any) => lines.push(row(getAlias(cp.id, 'CDX'), cp.title)));
    });
    if (unfiled.length) {
      lines.push('# Not in any folder (the screen lists these under UNFILED; move each into a folder with updateCodexPage parentId)');
      unfiled.forEach((cp: any) => lines.push(row(getAlias(cp.id, 'CDX'), cp.title)));
    }
    add('codex', 'codex pages', codexPages.length, lines);
  }

  return sections;
}

/** The notice that names every held-back module. Rendered and measured together. */
function heldBackNotice(heldBack: Section[]): string[] {
  if (heldBack.length === 0) return [];
  const names = heldBack.map((s) => `get_module("${s.key}")`).join(', ');
  return [
    '',
    `=== NOTICE — ${heldBack.length} MODULE${heldBack.length > 1 ? 'S' : ''} HELD BACK ===`,
    'The whole project did not fit in one result, so the largest modules were left out.',
    `Everything else below is complete. Fetch the missing ones with: ${names}.`,
    'Do not describe a held-back module, and do not report anything as absent from it, until you have fetched it.',
  ];
}

/** The stub left in place of a module that did not fit. */
function heldBackStub(section: Section): string[] {
  const lines = [
    `=== ${section.label.toUpperCase()} (${section.count}${archivedNotice(section.archived || 0)}) — HELD BACK ===`,
    `This module did not fit in one result, so it was left out on purpose. Nothing is lost.`,
    `Call get_module("${section.key}") to read all ${section.count} records before you reason about any of them.`,
  ];
  // The archived count has to survive the stub. get_module does NOT return the
  // archived ones either, so a reader who fetches the module still needs to be
  // told there is a second place to look.
  if (section.archived) {
    lines.push(`get_module does not return the ${section.archived} archived record${section.archived === 1 ? '' : 's'} either — use read_archive for those.`);
  }
  return lines;
}

/**
 * The project skeleton: every record, no descriptions, remarks or comments.
 * This is the single source of truth for all three consumers — the Cowork
 * bridge, the AI Sidebar and Meeting Intelligence — so a format change is made
 * once and lands everywhere.
 */
export function buildProjectSkeleton(targetProjectId?: string, options: SkeletonOptions = {}): string {
  const activeProjectId = targetProjectId || useAppStore.getState().activeProjectId;
  if (!activeProjectId) return 'No active project selected.';
  if (!useAppStore.getState().projects.find((p) => p.id === activeProjectId)) return 'No active project selected.';

  const sections = buildSections(activeProjectId, options);
  const budget = options.maxChars;
  const heldBack: Section[] = [];

  /**
   * Renders the whole skeleton as it stands. Trimming measures THIS, not an
   * estimate of it.
   *
   * The first version of this code added up the parts instead, and forgot to
   * count the held-back notice it was about to add. It stopped trimming 417
   * characters over budget on a real project and the bridge had to cut the
   * result short — the exact failure the trimming exists to prevent. An
   * estimate that is wrong in the unsafe direction is worse than no estimate.
   */
  const render = () => {
    const out: string[] = [...HOW_TO_READ, ...heldBackNotice(heldBack)];
    sections.forEach((section) => {
      out.push('');
      out.push(...(heldBack.includes(section) ? heldBackStub(section) : section.lines));
    });
    return out.join('\n');
  };

  let text = render();
  if (budget && budget > 0) {
    // The header is never a candidate — it costs almost nothing, and naming the
    // project is what makes the rest legible. Biggest first: dropping one large
    // module beats dropping four small ones, and leaves fewer holes to fill.
    const bySize = sections
      .filter((s) => s.key !== 'project')
      .sort((a, b) => sizeOf(b) - sizeOf(a));

    for (const section of bySize) {
      if (text.length <= budget) break;
      heldBack.push(section);
      text = render();
    }
  }

  return text;
}

/**
 * One module in full, for when the skeleton had to hold it back. Takes the same
 * key that the held-back stub prints.
 */
export function buildProjectModule(module: string, targetProjectId?: string, options: SkeletonOptions = {}): string {
  const activeProjectId = targetProjectId || useAppStore.getState().activeProjectId;
  if (!activeProjectId) return 'No active project selected.';

  const key = String(module || '').trim().toLowerCase();
  if (!MODULE_KEYS.includes(key as ModuleKey)) {
    return `Unknown module "${module}". Valid modules are: ${MODULE_KEYS.join(', ')}.`;
  }

  const section = buildSections(activeProjectId, options).find((s) => s.key === key);
  if (!section) return `The "${key}" module is empty for this project — it holds no records.`;
  return section.lines.join('\n');
}

/**
 * Kept for callers that predate buildProjectSkeleton (Meeting Intelligence and
 * the Cowork bridge). Same output, default options.
 */
export function getProjectStateSnapshot(targetProjectId?: string, options: SkeletonOptions = {}): string {
  return buildProjectSkeleton(targetProjectId, options);
}

/**
 * Returns the fully sanitized project context string using the active PII entries.
 */
export function getSanitizedProjectStateSnapshot(targetProjectId?: string, options: SkeletonOptions = {}): string {
  const activeProjectId = targetProjectId || useAppStore.getState().activeProjectId;
  const rawContext = getProjectStateSnapshot(activeProjectId || undefined, options);
  if (!activeProjectId) return rawContext;

  return sanitizeString(rawContext, piiEntriesFor(activeProjectId));
}

/** One module in full, masked the same way the skeleton is. */
export function getSanitizedProjectModule(module: string, targetProjectId?: string, options: SkeletonOptions = {}): string {
  const activeProjectId = targetProjectId || useAppStore.getState().activeProjectId;
  const raw = buildProjectModule(module, activeProjectId || undefined, options);
  if (!activeProjectId) return raw;

  return sanitizeString(raw, piiEntriesFor(activeProjectId));
}

function piiEntriesFor(projectId: string) {
  return usePIIStore.getState().entries.filter((e) => e.projectId === projectId);
}

/* ------------------------------------------------------------------ archive */

/** Epoch ms to YYYY-MM-DD. Blank when there is nothing usable. */
function ymdFromEpoch(ms?: number | null): string {
  if (!ms || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * One entry per module that has an archive.
 *
 * Adding a module is one row here plus one value in ARCHIVABLE_MODULES — see
 * the checklist in PLAN.md 20.9. Both engines read the archive through this
 * table: Claude via the bridge's readArchive operation, Gemini via the
 * getArchivedItems query tool. One implementation, so the two can never drift.
 */
const ARCHIVE_READERS: Record<ArchivableModule, {
  read: (projectId: string) => any[];
  /** The fields a keyword search looks at. */
  searchable: (record: any) => any[];
  /** What one record looks like in the answer. Ids are aliases, as in the skeleton. */
  summarize: (record: any) => Record<string, any>;
}> = {
  tasks: {
    read: (projectId) => useTasksStore.getState().getArchivedTasksByProject(projectId),
    searchable: (t) => [t.description, t.owner, t.remarks, t.source, t.status, t.type],
    summarize: (t) => ({
      id: useIdAliasStore.getState().getAlias(t.id, 'TSK'),
      type: t.type,
      description: t.description,
      status: t.status,
      owner: val(t.owner),
      archivedDate: ymdFromEpoch(t.archivedDate),
    }),
  },
  risks: {
    read: (projectId) => useRisksStore.getState().getArchivedRisksByProject(projectId),
    searchable: (r) => [r.riskId, r.riskDescription, r.projectSpecificDescription, r.owner, r.status, r.impactArea, r.remarks],
    summarize: (r) => ({
      id: useIdAliasStore.getState().getAlias(r.id, 'RSK'),
      riskId: val(r.riskId),
      description: val(r.projectSpecificDescription) || val(r.riskDescription),
      status: r.status,
      owner: val(r.owner),
      value: val(r.riskValue),
      archivedDate: ymdFromEpoch(r.archivedDate),
    }),
  },
  deliverables: {
    read: (projectId) => useDeliverablesStore.getState().getArchivedDeliverablesByProject(projectId),
    searchable: (d) => [d.title, d.description, d.definitionOfDone, d.owner, d.status, d.category],
    summarize: (d) => {
      // read() returns SUBTREE ROOTS only, so this says how many records are
      // filed underneath this one and not listed separately. PLAN.md 21.3.
      const nested = useDeliverablesStore.getState().getSubtreeIds(d.id).length - 1;
      return {
        id: useIdAliasStore.getState().getAlias(d.id, 'DEL'),
        title: d.title,
        status: d.status,
        owner: val(d.owner),
        dueDate: ymd(d.dueDate),
        ...(nested > 0 ? { archivedWithIt: nested } : {}),
        archivedDate: ymdFromEpoch(d.archivedDate),
      };
    },
  },
};

/** The action that brings a record back, per module. Used in the reply below. */
const ARCHIVE_RESTORE_ACTION: Record<ArchivableModule, string> = {
  tasks: 'unarchiveTask',
  deliverables: 'unarchiveDeliverable',
  risks: 'unarchiveProjectRisk',
};

/**
 * The archive of one module, newest archive first.
 *
 * Read-only and deliberately separate from every other read: the archive is
 * hidden from the skeleton and from search, so this is the only way in. It
 * answers with counts as well as records, so a reader can tell "nothing
 * matched your query" from "the archive is empty".
 */
export function readArchivedModule(
  module: string,
  targetProjectId?: string,
  options: { query?: string; limit?: number } = {},
): any {
  const activeProjectId = targetProjectId || useAppStore.getState().activeProjectId;
  if (!activeProjectId) return { error: 'No active project selected' };

  const key = String(module || '').trim().toLowerCase() as ArchivableModule;
  if (!ARCHIVABLE_MODULES.includes(key)) {
    return {
      error: `"${module}" has no archive. Modules with an archive: ${ARCHIVABLE_MODULES.join(', ')}.`,
    };
  }

  const spec = ARCHIVE_READERS[key];
  const all = spec.read(activeProjectId);
  const q = String(options.query || '').toLowerCase().trim();
  const matched = q
    ? all.filter((r) => spec.searchable(r).some((f) => String(f ?? '').toLowerCase().includes(q)))
    : all;

  const limit = Math.min(Math.max(Math.trunc(Number(options.limit) || 25), 1), 100);
  const page = matched.slice(0, limit);

  return {
    module: key,
    query: q || undefined,
    totalArchived: all.length,
    matched: matched.length,
    returned: page.length,
    records: page.map(spec.summarize),
    note:
      'Archived records are read-only and are not in the project snapshot or in search. ' +
      `To change one, propose ${ARCHIVE_RESTORE_ACTION[key]} first. read_item still returns any of ` +
      'these in full by id.' +
      (key === 'deliverables'
        ? ' Subtree roots only: a record whose parent is also archived is filed under its root, and '
          + 'restoring the root restores it too.'
        : ''),
  };
}

/**
 * Query tool definitions that can be supplied to Gemini function calling if requested
 */
export function executeProjectQuery(toolName: string, params: Record<string, any>, projectId?: string): any {
  const activeProjectId = projectId || useAppStore.getState().activeProjectId;
  if (!activeProjectId) return { error: 'No active project selected' };

  switch (toolName) {
    case 'getStakeholders': {
      const all = useStakeholdersStore.getState().stakeholders.filter(s => s.projectId === activeProjectId);
      if (params.query) {
        const q = String(params.query).toLowerCase();
        return all.filter(s => s.name.toLowerCase().includes(q) || s.role.toLowerCase().includes(q) || (s.organization && s.organization.toLowerCase().includes(q)));
      }
      return all;
    }
    case 'getCodexPages': {
      return useCodexStore.getState().getPagesForProject(activeProjectId).map(p => ({ id: p.id, title: p.title, parentId: p.parentId, isFolder: isCodexFolder(p) }));
    }
    case 'getCodexContent': {
      const page = useCodexStore.getState().pages.find(p => p.projectId === activeProjectId && p.id === params.id);
      return page ? { title: page.title, content: page.content, isFolder: isCodexFolder(page) } : { error: 'Page not found' };
    }
    case 'getMilestones': {
      return useBillingStore.getState().milestones.filter(m => m.projectId === activeProjectId);
    }
    case 'getTimelineActivities': {
      const projectTimeline = useTimelineStore.getState().getProjectTimeline(activeProjectId);
      const activeRevision = projectTimeline?.revisions.find(r => r.id === projectTimeline.activeRevisionId);
      return activeRevision ? activeRevision.activities : [];
    }
    case 'getTimelineHolidays': {
      return { holidays: useTimelineStore.getState().getProjectTimeline(activeProjectId)?.holidays || [] };
    }
    case 'getTasks': {
      // Active tasks only — getTasksByProject is where the archive is filtered out.
      const tasks = useTasksStore.getState().getTasksByProject(activeProjectId);
      if (params.status) {
        return tasks.filter(t => t.status.toLowerCase() === String(params.status).toLowerCase());
      }
      return tasks;
    }
    case 'getArchivedItems': {
      return readArchivedModule(params.module, activeProjectId, params);
    }
    case 'getDeliverables': {
      return useDeliverablesStore.getState().getDeliverablesByProject(activeProjectId);
    }
    case 'getRisks': {
      // Active risks only — getProjectRisks is where the archive is filtered out.
      return useRisksStore.getState().getProjectRisks(activeProjectId);
    }
    case 'getMomHistory': {
      const moms = useMomStore.getState().moms.filter(m => m.projectId === activeProjectId);
      if (params.id) {
        return moms.find(m => m.id === params.id) || { error: 'MoM not found' };
      }
      return moms.map(m => ({ id: m.id, title: m.title, date: m.date, location: m.location, attendees: m.attendees }));
    }
    default:
      return { error: `Unknown query tool: ${toolName}` };
  }
}
