/**
 * PM Codex Bridge — browser client (Phase 2, propose and review).
 *
 * Connects this tab to the local bridge server so Claude can read the project
 * through Cowork. The bridge asks; this file answers from the live Zustand
 * stores.
 *
 * Phase 2 adds one write, and only one: a proposal into the change-request
 * store. That is a row waiting for the user's approve button, not a change.
 * Nothing here talks to Google Sheets, nothing here touches a project record,
 * and the user is still the only one who decides anything is applied.
 *
 * ---------------------------------------------------------------------------
 * NOTE FOR CODING AGENTS: do not modify this file. It is maintained together
 * with the bridge in the project's bridge/ folder. See AGENTS.md.
 * ---------------------------------------------------------------------------
 *
 * Importing this module starts the client. That is deliberate: it keeps the
 * change to the rest of the app down to a single import line.
 */

import { useAppStore } from '../store/appStore';
import { useTimelineStore } from '../store/timelineStore';
import { useCodexStore } from '../store/codexStore';
import { useDeliverablesStore } from '../store/deliverablesStore';
import { useTasksStore } from '../store/tasksStore';
import { useRisksStore } from '../store/risksStore';
import { useDocumentsStore } from '../store/documentsStore';
import { useStakeholdersStore } from '../store/stakeholdersStore';
import { useBillingStore } from '../store/billingStore';
import { useMomStore } from '../store/momStore';
import { usePIIStore } from '../store/piiStore';
import { useIdAliasStore } from '../store/idAliasStore';
import { activeOnly } from '../utils/archive';
import { useAcrStore } from '../store/acrStore';
import { groupAcrLines } from '../utils/acrGroups';
import { getSanitizedProjectStateSnapshot, getSanitizedProjectModule, readArchivedModule } from './aiContextEngine';
import { getFieldSchema } from './fieldSchema';
import { sanitizeValue, reconstructValue } from '../utils/piiSanitization';
import { checkCodexChange, isCodexFolder } from '../utils/codexRules';
import { isUserEdited, userEditedFields, userEditedValues, findMergeTarget, editedLineMessage } from '../utils/acrUserEdits';

const BRIDGE_URL = 'ws://127.0.0.1:7799';
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const SCREEN_POLL_MS = 1000;

type BridgeRequest = { id: number; op: string; params?: any };

let socket: WebSocket | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer: any = null;
let screenTimer: any = null;
let lastScreenKey = '';
let started = false;

/* ------------------------------------------------------------------ helpers */

function activeProjectId(): string {
  const id = useAppStore.getState().activeProjectId;
  if (!id) throw new Error('No project is open in PM Codex. Ask the user to open one from the main menu.');
  return id;
}

/**
 * The project a call is about (22 Oct 2026).
 *
 * Until then every call was about the project open in the app. Now each read
 * and propose operation takes an optional `project` — its id, or its name as
 * list_projects gives it — so Claude can read and propose into any project
 * without the user switching. No `project`: the open one, as before.
 */
function projectFor(params?: { project?: string } | null): string {
  const wanted = String(params?.project ?? '').trim();
  if (!wanted) return activeProjectId();
  const projects: any[] = useAppStore.getState().projects || [];
  const byId = projects.find((p) => p.id === wanted);
  if (byId) return byId.id;
  const norm = (s: any) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Claude reads names masked by the open project's glossary, so the name it
  // sends back may be in token form. Both spellings are tried.
  const spellings = [wanted, String(unmasked(wanted) ?? wanted)].map(norm);
  const matches = projects.filter((p) => spellings.includes(norm(p.name)));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new Error(`More than one project is called "${wanted}". Pass the project's id from list_projects instead.`);
  }
  throw new Error(`No project "${wanted}" in PM Codex. Call list_projects for every project's name and id.`);
}

/** The project's name, for replies that name it. */
function projectName(projectId: string): string {
  const p: any = (useAppStore.getState().projects || []).find((x: any) => x.id === projectId);
  return p ? p.name : projectId;
}

/** The glossary that masks one project: its own entries, nothing else. */
function glossaryOf(projectId: string | null | undefined): any[] {
  if (!projectId) return [];
  return usePIIStore.getState().entries.filter((e: any) => e.projectId === projectId);
}

/**
 * Everything leaving this tab goes through the PII glossary first — the
 * glossary of the project the data comes from. Each project keeps its own, so
 * a reply about another project is masked with THAT project's entries.
 */
function masked(value: any, projectId?: string | null): any {
  const pid = projectId || useAppStore.getState().activeProjectId;
  if (!pid) return value;
  return sanitizeValue(value, glossaryOf(pid));
}

/**
 * The mirror image of masked(), for anything coming IN.
 *
 * Claude only ever sees placeholder tokens, so anything it writes back — a
 * proposed field value, a change title — carries those tokens. Stored raw, they
 * surface as "[Client_A]" in the review panel and in every module view that
 * renders a pending change.
 *
 * Gemini never had this problem: AISidebar reconstructs the whole model turn,
 * function-call arguments included, BEFORE building the change request. So its
 * proposals reach the store as real text. This does the same thing for Claude,
 * at the same point in the flow — the boundary — rather than at the ten places
 * that render the result.
 *
 * Real names go no further than the store, which already holds Gemini's. Every
 * reply out of this file still passes through masked(), so a proposal read back
 * with get_acr_status comes back tokenised, exactly as before.
 */
function unmasked(value: any, projectId?: string | null): any {
  const pid = projectId || useAppStore.getState().activeProjectId;
  if (!pid) return value;
  return reconstructValue(value, glossaryOf(pid));
}

/**
 * The snapshot shows aliases (RSK11, TSK5, DEL46), never real ids — that is the
 * whole point of the alias layer. So an id arriving from Claude is an alias,
 * and every store lookup here is by real id.
 *
 * Without this translation, read_item on anything named in the snapshot
 * answered "not found", and the only way through was search_project first,
 * because search returns real ids. getRealId passes a real id through
 * unchanged, so both routes work.
 */
function realId(id: string): string {
  return useIdAliasStore.getState().getRealId(id) || id;
}

function notFound(kind: string, id: string) {
  return { error: `No ${kind} found with id "${id}". It may have been deleted, or the id may be stale — call refresh_state and try again.` };
}

/* -------------------------------------------------------------- operations */

function readItem(params: { type: string; id: string; project?: string }) {
  return readItemIn(projectFor(params), params.type, params.id);
}

function readItemIn(pid: string, type: string, givenId: string) {
  const id = realId(givenId);

  switch (type) {
    case 'task': {
      const found = useTasksStore.getState().tasks.find((t: any) => t.id === id && t.projectId === pid);
      return found || notFound('task', givenId);
    }
    case 'deliverable': {
      const all = useDeliverablesStore.getState().deliverables.filter((d: any) => d.projectId === pid);
      const found = all.find((d: any) => d.id === id);
      if (!found) return notFound('deliverable', givenId);
      const children = all.filter((c: any) => c.parentId === found.id);
      return {
        ...found,
        nestedDeliverables: children.map((c: any) => ({
          id: c.id, title: c.title, status: c.status, owner: c.owner || 'Unassigned',
          dueDate: c.dueDate, priority: c.priority || 'Medium', hasNestedSpace: !!c.hasNestedSpace,
        })),
      };
    }
    case 'risk': {
      const found = useRisksStore.getState().risks.find((r: any) => r.id === id && r.projectId === pid);
      return found || notFound('risk', givenId);
    }
    case 'document': {
      const found = useDocumentsStore.getState().documents.find((d: any) => d.id === id && d.projectId === pid);
      return found || notFound('document', givenId);
    }
    case 'stakeholder': {
      const found = useStakeholdersStore.getState().stakeholders.find((s: any) => s.id === id && s.projectId === pid);
      return found || notFound('stakeholder', givenId);
    }
    case 'codexPage': {
      const pages = useCodexStore.getState().pages.filter((p: any) => p.projectId === pid);
      const found = pages.find((p: any) => p.id === id);
      if (!found) return notFound('codex page', givenId);
      if (!isCodexFolder(found)) return found;
      // A folder is read as the list of its pages. Notes written onto a folder
      // before folders held only pages are still returned, labelled as such.
      const { content, ...folder } = found as any;
      return {
        ...folder,
        isFolder: true,
        note: 'This is a folder. It holds pages and has no content of its own. Read a page by its id.',
        pages: pages.filter((p: any) => p.parentId === found.id).map((p: any) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt })),
        ...(String(content || '').trim() ? { olderFolderNotes: content } : {}),
      };
    }
    case 'mom': {
      const found = useMomStore.getState().moms.find((m: any) => m.id === id && m.projectId === pid);
      if (!found) return notFound('meeting record', givenId);
      const tasks = useTasksStore.getState().tasks;
      return {
        ...found,
        actionItems: (found.actionItems || []).map((ai: any) => {
          const linked = ai.taskId && ai.taskId !== 'pushed' ? tasks.find((t: any) => t.id === ai.taskId) : null;
          return { ...ai, status: linked ? linked.status : ai.status || 'Open' };
        }),
      };
    }
    case 'timelineActivity': {
      const timeline = useTimelineStore.getState().getProjectTimeline(pid);
      if (!timeline) return notFound('timeline activity', givenId);
      for (const rev of timeline.revisions || []) {
        const act = (rev.activities || []).find((a: any) => a.id === id);
        if (act) return { ...act, revisionId: rev.id, revisionName: rev.name, isActiveRevision: rev.id === timeline.activeRevisionId };
      }
      return notFound('timeline activity', givenId);
    }
    case 'milestone': {
      const found = useBillingStore.getState().milestones.find((m: any) => m.id === id && m.projectId === pid);
      return found || notFound('billing milestone', givenId);
    }
    default:
      return { error: `Unknown record type "${type}".` };
  }
}

function search({ query, limit = 10, project }: { query: string; limit?: number; project?: string }) {
  const pid = projectFor({ project });
  const q = String(query || '').toLowerCase().trim();
  if (!q) return { error: 'Search needs a non-empty query.' };

  const hit = (...fields: any[]) => fields.some((f) => String(f ?? '').toLowerCase().includes(q));
  const cap = (arr: any[]) => arr.slice(0, limit);

  // Active tasks only. Keyword search is how the assistant checks whether
  // something already exists; an archived hit would send it to re-open settled
  // work. read_archive is the way in, and it takes the same query.
  const allProjectTasks = useTasksStore.getState().tasks.filter((t: any) => t.projectId === pid);
  const tasks = activeOnly(allProjectTasks);
  const archivedTaskCount = allProjectTasks.length - tasks.length;
  // Active deliverables only, for the same reason as tasks above.
  const allProjectDeliverables = useDeliverablesStore.getState().deliverables.filter((d: any) => d.projectId === pid);
  const deliverables = activeOnly(allProjectDeliverables);
  const archivedDeliverableCount = allProjectDeliverables.length - deliverables.length;
  // Active risks only, for the same reason as tasks above.
  const allProjectRisks = useRisksStore.getState().risks.filter((r: any) => r.projectId === pid);
  const risks = activeOnly(allProjectRisks);
  const archivedRiskCount = allProjectRisks.length - risks.length;
  const documents = useDocumentsStore.getState().documents.filter((d: any) => d.projectId === pid);
  const stakeholders = useStakeholdersStore.getState().stakeholders.filter((s: any) => s.projectId === pid);
  const pages = useCodexStore.getState().pages.filter((p: any) => p.projectId === pid);
  const moms = useMomStore.getState().moms.filter((m: any) => m.projectId === pid);

  const timeline = useTimelineStore.getState().getProjectTimeline(pid);
  const activeRev = timeline?.revisions?.find((r: any) => r.id === timeline.activeRevisionId);
  const activities = activeRev?.activities || [];

  const results = {
    tasks: cap(tasks.filter((t: any) => hit(t.description, t.owner, t.remarks, t.status)))
      .map((t: any) => ({ id: t.id, description: t.description, status: t.status, type: t.type, owner: t.owner })),
    deliverables: cap(deliverables.filter((d: any) => hit(d.title, d.description, d.definitionOfDone, d.owner)))
      .map((d: any) => ({ id: d.id, title: d.title, status: d.status, dueDate: d.dueDate })),
    risks: cap(risks.filter((r: any) => hit(r.riskDescription, r.projectSpecificDescription, r.mitigationStrategy, r.owner)))
      .map((r: any) => ({ id: r.id, riskDescription: r.riskDescription, status: r.status, riskValue: r.riskValue })),
    documents: cap(documents.filter((d: any) => hit(d.title, d.description, d.url, d.owner)))
      .map((d: any) => ({ id: d.id, title: d.title, url: d.url, type: d.type, status: d.status })),
    stakeholders: cap(stakeholders.filter((s: any) => hit(s.name, s.role, s.projectRole, s.organization, s.notes)))
      .map((s: any) => ({ id: s.id, name: s.name, role: s.projectRole || s.role, organization: s.organization })),
    codexPages: cap(pages.filter((p: any) => hit(p.title, p.content)))
      .map((p: any) => ({ id: p.id, title: p.title, parentId: p.parentId })),
    moms: cap(moms.filter((m: any) => hit(m.title, m.keyDecisions, m.notes, m.attendees, m.agenda)))
      .map((m: any) => ({ id: m.id, title: m.title, date: m.date })),
    timelineActivities: cap(activities.filter((a: any) => hit(a.phase, a.activity, a.subActivity, a.owner, a.remarks)))
      .map((a: any) => ({ id: a.id, phase: a.phase, activity: a.activity, subActivity: a.subActivity, status: a.status })),
  };

  const total = Object.values(results).reduce((n, arr: any) => n + arr.length, 0);
  return {
    query,
    totalMatches: total,
    results,
    // Said out loud rather than left to be discovered. The same rule the
    // skeleton follows for a held-back module.
    ...(archivedTaskCount > 0 ? { archivedTasksNotSearched: archivedTaskCount } : {}),
    ...(archivedDeliverableCount > 0 ? { archivedDeliverablesNotSearched: archivedDeliverableCount } : {}),
    ...(archivedRiskCount > 0 ? { archivedRisksNotSearched: archivedRiskCount } : {}),
    ...(archivedTaskCount > 0 || archivedDeliverableCount > 0 || archivedRiskCount > 0
      ? {
          archivedNote:
            'Archived records are not searched. Call read_archive with module ' +
            [
              ...(archivedTaskCount > 0 ? ['"tasks"'] : []),
              ...(archivedDeliverableCount > 0 ? ['"deliverables"'] : []),
              ...(archivedRiskCount > 0 ? ['"risks"'] : []),
            ].join(' or ') +
            ' to look in the archive.',
        }
      : {}),
  };
}

function listProjects() {
  const { projects, activeProjectId: active } = useAppStore.getState();
  const acrs = useAcrStore.getState().acrs;
  return {
    activeProjectId: active,
    projects: (projects || []).map((p: any) => {
      const mine = acrs.find(
        (a: any) => a.projectId === p.id && a.status === 'pending' && (a.origin || 'gemini') === 'claude'
      );
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        isActive: p.id === active,
        ...(mine ? { yourOpenProposals: mine.changes.length } : {}),
      };
    }),
    note:
      'Every read and propose tool takes an optional `project`: a project\'s id or name from this list. ' +
      'Without it, a tool works on the project open in the app (isActive). Each project has its own privacy ' +
      'glossary, so a token such as [Redacted_Name_1] can stand for different people in two projects: never ' +
      'carry a token from one project into a proposal for another.',
  };
}

/** One proposed line as get_acr_status shows it. */
function describeLine(c: any) {
  const base = {
    id: c.id,
    title: c.changeTitle,
    action: c.name,
    ...(c.group ? { group: c.group } : {}),
    approved: c.approved,
  };
  // A line the user edited says so, with their version in `args` and what
  // Claude sent in `proposedArgs`. Claude builds on `args`. See
  // utils/acrUserEdits.ts for why this matters.
  return isUserEdited(c)
    ? {
        ...base,
        userEdited: true,
        userEditedAt: c.userEditedAt,
        userEditedFields: userEditedFields(c),
        args: c.args,
        proposedArgs: c.proposedArgs,
      }
    : { ...base, args: c.args };
}

/** A decided line: what happened to it, without its arguments. */
function describeDecided(c: any) {
  return {
    id: c.id,
    title: c.changeTitle,
    action: c.name,
    ...(c.group ? { group: c.group } : {}),
    decision: c.decision || (c.approved ? 'applied' : 'rejected'),
    decidedAt: c.decidedAt,
  };
}

/** Other projects where Claude has a request waiting, so none is forgotten. */
function pendingElsewhere(pid: string) {
  return useAcrStore.getState().acrs
    .filter((a: any) => a.projectId !== pid && a.status === 'pending' && (a.origin || 'gemini') === 'claude')
    .map((a: any) => ({ project: projectName(a.projectId), acrId: a.id, openLines: a.changes.length }));
}

/**
 * Read side of the change-request store. Phase 2.
 *
 * Without an id this lists the change requests for the project, newest first,
 * with one line per proposed change but no arguments — a list has to stay
 * cheap enough to call often. With an id it returns that one request in full,
 * arguments included, which is what you read before discarding a line or
 * explaining a proposal back to the user.
 *
 * Since 22 Oct 2026 the user can sign off part of a request. `changes` is then
 * the lines still open, and `decided` the lines already applied or rejected.
 */
function acrStatus({ acrId, limit = 10, project }: { acrId?: string; limit?: number; project?: string } = {}) {
  const pid = projectFor({ project });
  const all = useAcrStore.getState().acrs
    .filter((a: any) => a.projectId === pid)
    .slice()
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const elsewhere = pendingElsewhere(pid);

  if (acrId) {
    const found: any = all.find((a: any) => a.id === acrId);
    if (!found) return notFound('change request', acrId);
    const decided = found.decided || [];
    const notes: string[] = [];
    if (found.status === 'pending' && decided.length) {
      notes.push('The user has signed off part of this request. `changes` are the lines still open; `decided` are done. Revise an open line by proposing again for the same record, or withdraw it with discard_change.');
    }
    if (found.changes.some((c: any) => isUserEdited(c))) {
      notes.push('Lines marked userEdited were changed by the user in the app. `args` is their version, `proposedArgs` is yours. ' +
        'Build on theirs. discard_change and propose_changes will not withdraw or merge over such a line unless the user says to throw the edit away.');
    }
    return {
      id: found.id,
      project: projectName(pid),
      status: found.status,
      ...(found.status === 'pending' && decided.length ? { partlySignedOff: true } : {}),
      origin: found.origin || 'gemini',
      sessionId: found.sessionId,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      groups: groupAcrLines(found.changes).map((g) => ({ title: g.title, lines: g.changes.length })),
      changes: found.changes.map(describeLine),
      ...(decided.length ? { decided: decided.map(describeDecided) } : {}),
      note: notes.length ? notes.join(' ') : undefined,
    };
  }

  const capped = all.slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)));
  return {
    project: projectName(pid),
    total: all.length,
    shown: capped.length,
    note: 'Call get_acr_status with an acrId to see the arguments of each change. On a pending request, `changes` are the open lines and `decided` what the user has already signed off.',
    acrs: capped.map((a: any) => {
      const decided = a.decided || [];
      return {
        id: a.id,
        status: a.status,
        ...(a.status === 'pending' && decided.length ? { partlySignedOff: true } : {}),
        origin: a.origin || 'gemini',
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        changeCount: a.changes.length,
        approvedCount: a.changes.filter((c: any) => c.approved).length,
        ...(decided.length
          ? {
              appliedCount: decided.filter((c: any) => c.decision === 'applied').length,
              rejectedCount: decided.filter((c: any) => c.decision === 'rejected').length,
            }
          : {}),
        changes: a.changes.map((c: any) => ({
          id: c.id,
          title: c.changeTitle,
          action: c.name,
          ...(c.group ? { group: c.group } : {}),
          approved: c.approved,
          ...(isUserEdited(c) ? { userEdited: true } : {}),
        })),
        ...(decided.length ? { decided: decided.map(describeDecided) } : {}),
      };
    }),
    ...(elsewhere.length ? { pendingInOtherProjects: elsewhere } : {}),
  };
}

/* ------------------------------------------------- write side (Phase 2) */

/**
 * The session id every Claude proposal is filed under.
 *
 * Claude has no chat session in the app — it lives outside the browser. One
 * fixed id keeps all its proposals together, and the origin field is what
 * actually separates them from Gemini's. See acrStore.ts.
 */
const CLAUDE_SESSION_ID = 'claude-bridge';

/**
 * Actions the approve button can actually carry out.
 *
 * This list is not the list of actions that have a title. It is the list of
 * cases in the executor inside AISidebar.tsx. Three actions have a title but
 * no executor case — reorderTimelineRow, createTimelineBaseline and
 * updateMilestone. Proposing one of those would show the user a change that
 * silently does nothing when they approve it, so they are refused here.
 *
 * If a case is added to the executor, add it here too. A proposal this file
 * lets through is a promise that the button will honour it.
 */
const APPLICABLE_ACTIONS = new Set([
  'addTimelineRow', 'updateTimelineRow', 'deleteTimelineRow',
  // Added 8 Sep. These three were refused because approving one did nothing.
  // The reason was narrower than "no executor case": there WAS a case, but only
  // in Gemini's own review-modal path, not in either sign-off path. The three
  // copies of the executor are now one (src/services/acrExecutor.ts), so every
  // path handles every action, and the button honours these.
  'reorderTimelineRow', 'createTimelineBaseline', 'updateMilestone',
  // Added 24 Sep. The project's holiday list, sent whole; WORKDAY and
  // NETWORKDAYS skip those days.
  'setTimelineHolidays',
  'createCodexPage', 'updateCodexPage',
  // Added 24 Sep with strict folders: a folder holds pages, never content.
  'createCodexFolder',
  'addDeliverable', 'updateDeliverable', 'deleteDeliverable', 'addDeliverableComment',
  // Added 12 Sep with the deliverables archive. A deliverable archives with its
  // whole subtree, so one approved line can move several records — the executor
  // says how many in its reply, and the review panel shows the root.
  'archiveDeliverable', 'unarchiveDeliverable',
  'addTask', 'updateTask', 'deleteTask', 'addTaskComment',
  // Added 12 Sep with the archive. Both are updates to one field on a record
  // that goes on existing, so the review panel draws them like any other edit.
  'archiveTask', 'unarchiveTask',
  // Added 6 Oct 2026. A comment is edited by its id (read_item shows it on the
  // record); a flag is one field on a task, set and cleared by its own pair of
  // actions, like the archive pair.
  'editTaskComment', 'editDeliverableComment', 'flagTask', 'unflagTask',
  'addProjectRisk', 'updateProjectRisk', 'deleteProjectRisk',
  // Added 6 Oct 2026 with the risk archive. Same shape as the task pair.
  'archiveProjectRisk', 'unarchiveProjectRisk',
  // Added 10 Sep. The Documents module existed with no executor case and no
  // path here — see acrExecutor.ts and PLAN.md section 17 for the same gap.
  'addDocument', 'updateDocument', 'deleteDocument',
  'addStakeholder', 'updateStakeholder', 'deleteStakeholder',
  'createMoM', 'createMom', 'updateMom', 'deleteMom',
  'updateMeetingDraft',
]);

/**
 * Files a batch of proposed edits as one change request for the user to review.
 *
 * Nothing here changes the project. It writes a proposal into the same store
 * the sidebar has always used, and the user approves it with the same buttons.
 * The app stays the only writer.
 */
function proposeChanges({ changes, project }: { changes: { action: string; args: any; title?: string; group?: string }[]; project?: string }) {
  // Any project, not only the open one (22 Oct 2026). The request is filed in
  // that project and is reviewed there.
  const pid = projectFor({ project });

  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('propose_changes needs at least one change. Nothing was proposed.');
  }

  const refused = changes
    .map((c, i) => ({ i, action: String(c?.action || '') }))
    .filter((c) => !APPLICABLE_ACTIONS.has(c.action));

  if (refused.length) {
    throw new Error(
      `These actions cannot be applied by the approve button, so the whole batch was refused: ` +
      refused.map((r) => `#${r.i + 1} "${r.action || '(missing)'}"`).join(', ') +
      `. Allowed actions: ${[...APPLICABLE_ACTIONS].sort().join(', ')}.`
    );
  }

  // A change aimed at a record that is not there is refused now, not at
  // sign-off. Until 30 Sep it was filed: Claude proposed an edit to a task the
  // user had already deleted, the review panel had no row to show and no panel
  // to open, and approving it would have done nothing. Same read as read_item,
  // so an alias, a real id, an archived record and a timeline row in any
  // revision are all found exactly as a read would find them.
  const RECORD_TARGETS: Record<string, string> = {
    updateTask: 'task', deleteTask: 'task', addTaskComment: 'task', archiveTask: 'task', unarchiveTask: 'task',
    editTaskComment: 'task', flagTask: 'task', unflagTask: 'task',
    updateDeliverable: 'deliverable', deleteDeliverable: 'deliverable', addDeliverableComment: 'deliverable',
    archiveDeliverable: 'deliverable', unarchiveDeliverable: 'deliverable', editDeliverableComment: 'deliverable',
    updateProjectRisk: 'risk', deleteProjectRisk: 'risk', archiveProjectRisk: 'risk', unarchiveProjectRisk: 'risk',
    updateDocument: 'document', deleteDocument: 'document',
    updateStakeholder: 'stakeholder', deleteStakeholder: 'stakeholder',
    updateCodexPage: 'codexPage',
    updateMom: 'mom', updateMoM: 'mom', deleteMom: 'mom', deleteMoM: 'mom',
    updateTimelineRow: 'timelineActivity', deleteTimelineRow: 'timelineActivity',
    updateMilestone: 'milestone',
  };
  const missing = changes
    .map((c, i) => {
      const action = String(c?.action || '');
      const type = RECORD_TARGETS[action];
      if (!type) return null;
      const given = String(c?.args?.id || c?.args?.taskId || c?.args?.deliverableId || '');
      if (!given) return { i, action, problem: 'names no record (no id)' };
      const found: any = readItemIn(pid, type, given);
      return found && found.error ? { i, action, problem: `points at ${type} "${given}", which does not exist in project "${projectName(pid)}"` } : null;
    })
    .filter(Boolean) as { i: number; action: string; problem: string }[];

  if (missing.length) {
    throw new Error(
      'These changes aim at records that are not there, so the whole batch was refused: ' +
      missing.map((m) => `#${m.i + 1} "${m.action}" ${m.problem}`).join('; ') +
      '. The record may have been deleted since you last read it. Call refresh_state or search_project, read the record, and propose again.'
    );
  }

  // An edit to a comment must name a comment that is on that record. Same
  // reasoning as the record check above: a change aimed at nothing is refused
  // now, not filed for the review panel to have nothing to show.
  const COMMENT_EDITS: Record<string, 'task' | 'deliverable'> = {
    editTaskComment: 'task', editDeliverableComment: 'deliverable',
  };
  const badComment = changes
    .map((c, i) => {
      const action = String(c?.action || '');
      const type = COMMENT_EDITS[action];
      if (!type) return null;
      const commentId = String(c?.args?.commentId || '');
      if (!commentId) return { i, action, problem: 'names no comment (no commentId — read_item lists each comment with its id)' };
      const rec: any = readItemIn(pid, type, String(c?.args?.id || c?.args?.taskId || c?.args?.deliverableId || ''));
      const has = (rec?.comments || []).some((cm: any) => cm.id === commentId);
      return has ? null : { i, action, problem: `points at comment "${commentId}", which is not on that ${type}` };
    })
    .filter(Boolean) as { i: number; action: string; problem: string }[];

  if (badComment.length) {
    throw new Error(
      'These comment edits cannot be filed, so the whole batch was refused: ' +
      badComment.map((m) => `#${m.i + 1} "${m.action}" ${m.problem}`).join('; ') +
      '. Call read_item on the record to see its comments and their ids, then propose again.'
    );
  }

  // The archive is read-only, and Claude is told so when it proposes rather
  // than at sign-off. The executor guards this again on approval, because a
  // record can be archived in the gap between the two — see acrExecutor.ts.
  //
  // One table rather than one set, because there are several modules now and the
  // refusal has to name the right noun and the right restore action. Adding a
  // third module is two rows here.
  const taskArchived = (id: string) =>
    useTasksStore.getState().tasks.some((t: any) => t.id === id && t.isArchived);
  const deliverableArchived = (id: string) =>
    useDeliverablesStore.getState().deliverables.some((d: any) => d.id === id && d.isArchived);

  const riskArchived = (id: string) =>
    useRisksStore.getState().risks.some((r: any) => r.id === id && r.isArchived);

  const ARCHIVED_EDIT_GUARDS: Record<string, { noun: string; restore: string; isArchived: (id: string) => boolean }> = {
    updateTask: { noun: 'tasks', restore: 'unarchiveTask', isArchived: taskArchived },
    addTaskComment: { noun: 'tasks', restore: 'unarchiveTask', isArchived: taskArchived },
    updateDeliverable: { noun: 'deliverables', restore: 'unarchiveDeliverable', isArchived: deliverableArchived },
    addDeliverableComment: { noun: 'deliverables', restore: 'unarchiveDeliverable', isArchived: deliverableArchived },
    editTaskComment: { noun: 'tasks', restore: 'unarchiveTask', isArchived: taskArchived },
    editDeliverableComment: { noun: 'deliverables', restore: 'unarchiveDeliverable', isArchived: deliverableArchived },
    flagTask: { noun: 'tasks', restore: 'unarchiveTask', isArchived: taskArchived },
    unflagTask: { noun: 'tasks', restore: 'unarchiveTask', isArchived: taskArchived },
    updateProjectRisk: { noun: 'risks', restore: 'unarchiveProjectRisk', isArchived: riskArchived },
  };

  const onArchived = changes
    .map((c, i) => ({
      i,
      action: String(c?.action || ''),
      id: realId(String(c?.args?.id || c?.args?.taskId || c?.args?.deliverableId || '')),
    }))
    .filter((c) => !!ARCHIVED_EDIT_GUARDS[c.action])
    .filter((c) => ARCHIVED_EDIT_GUARDS[c.action].isArchived(c.id));

  if (onArchived.length) {
    const nouns = [...new Set(onArchived.map((r) => ARCHIVED_EDIT_GUARDS[r.action].noun))];
    const restores = [...new Set(onArchived.map((r) => ARCHIVED_EDIT_GUARDS[r.action].restore))];
    throw new Error(
      `These changes target archived ${nouns.join(' and ')}, which are read-only, so the whole batch was refused: ` +
      onArchived.map((r) => `#${r.i + 1} "${r.action}"`).join(', ') +
      `. Propose ${restores.join(' / ')} for those ids first, or leave them as they are.`
    );
  }

  // Claude sees aliases in the snapshot, so an id it sends back is an alias.
  // The executor looks records up by real id. Same translation as read_item.
  //
  // EVERY id is translated, not only `id`. Until 24 Sep only `id` was, so a
  // parentId, a linked activity or a manager arrived as the alias itself and
  // was stored that way: a Codex page filed under "CDX4" pointed at no folder
  // and never appeared on the Codex screen. Gemini's calls have always had
  // the deep translation (AISidebar); this is the same one.
  const rawChanges = changes.map((c) => {
    // Placeholders go back to real terms here, before anything is stored —
    // with the glossary of the project the request is for.
    const args = unmasked(JSON.parse(JSON.stringify(c.args || {})), pid);
    useIdAliasStore.getState().replaceAliasWithReal(args);
    if (typeof args.id === 'string') args.id = realId(args.id);
    if (c.title) args.changeTitle = unmasked(c.title, pid);
    // The review list's heading for this line. The store lifts it out of the
    // arguments (acrStore.takeChangeGroup), so it never reaches a record.
    if (typeof c.group === 'string' && c.group.trim()) args.changeGroup = unmasked(c.group, pid);
    return { name: c.action, args };
  });

  // The Codex's shape: a folder holds pages, a page sits in a folder. Told
  // now, while Claude can still correct the call, rather than at sign-off.
  const codexProblems = rawChanges
    .map((c, i) => ({ i, action: c.name, problem: checkCodexChange(c.name, c.args, pid) }))
    .filter((c) => !!c.problem);
  if (codexProblems.length) {
    throw new Error(
      'These changes break the Codex rules, so the whole batch was refused: '
      + codexProblems.map((c) => `#${c.i + 1} "${c.action}": ${c.problem}`).join(' ')
    );
  }

  // A line the user edited is theirs. A new proposal for the same record
  // would be merged into it, Claude's fields over the user's — so it is
  // refused here, before anything is filed, with the user's version in the
  // error. The store refuses it again (acrStore.createAcr); this is the check
  // that gives Claude a clear answer. See utils/acrUserEdits.ts.
  const pendingMine = useAcrStore.getState().acrs.find(
    (a: any) => a.sessionId === CLAUDE_SESSION_ID && a.projectId === pid && (a.origin || 'gemini') === 'claude' && a.status === 'pending'
  );
  if (pendingMine) {
    const overEdits = rawChanges
      .map((c, i) => ({ i, action: c.name, line: findMergeTarget(pendingMine.changes, c.name, c.args) }))
      .filter((c) => c.line && isUserEdited(c.line));
    if (overEdits.length) {
      throw new Error(
        'These changes would be merged over lines the user has edited, so the whole batch was refused: ' +
        overEdits.map((c) =>
          `#${c.i + 1} "${c.action}": ${editedLineMessage(c.line!, 'merge', masked(userEditedValues(c.line!), pid))}`
        ).join(' ')
      );
    }
  }

  const acrId = useAcrStore.getState().createAcr(pid, CLAUDE_SESSION_ID, rawChanges, 'claude');

  if (!acrId) throw new Error('The change request could not be created. Nothing was proposed.');

  // createAcr focuses whatever it just made, which is right for Gemini: the
  // user is sitting in the chat that asked for it. It is wrong here. A Claude
  // proposal arrives while the user is doing something else, and focusing it
  // threw the review panel open in whichever chat happened to be on screen —
  // including old Gemini conversations it had nothing to do with.
  //
  // So it announces itself in the header bar instead, and opens when asked.
  useAcrStore.getState().setActiveAcrId(null);

  const acr: any = useAcrStore.getState().acrs.find((a: any) => a.id === acrId);
  const elsewhere = pid !== useAppStore.getState().activeProjectId;
  return {
    acrId,
    project: projectName(pid),
    status: 'pending',
    proposed: acr
      ? acr.changes.map((c: any) => ({ id: c.id, title: c.changeTitle, action: c.name, ...(c.group ? { group: c.group } : {}) }))
      : [],
    ...(acr && (acr.decided || []).length ? { alreadySignedOff: (acr.decided || []).length } : {}),
    note:
      'Filed for review. Nothing has changed in the project yet. The user approves or rejects it in ' +
      'the app — the whole request, a group, or one line at a time; the rest stays open — and each ' +
      'outcome reaches you on your next tool call. Do not tell the user the change is done.' +
      (elsewhere
        ? ` This request is in "${projectName(pid)}", not the project open in the app. The user reviews it ` +
          'there: the header bar in the open project points to it.'
        : ''),
  };
}

/** Pulls one proposed line back out of the pending request. */
function discardChange({ acrId, changeId, discardUserEdit, project }: { acrId?: string; changeId: string; discardUserEdit?: boolean; project?: string }) {
  const pid = projectFor({ project });

  const pending = useAcrStore.getState().acrs.find(
    (a: any) => a.projectId === pid && a.status === 'pending' && (a.origin || 'gemini') === 'claude'
  );
  if (!pending) throw new Error('There is no pending change request of yours to take anything out of.');
  if (acrId && acrId !== pending.id) {
    return notFound('pending change request', acrId);
  }
  const line = pending.changes.find((c: any) => c.id === changeId);
  if (!line) {
    return notFound('proposed change', changeId);
  }

  // Withdrawing deletes the line for good. If the user edited it, their work
  // goes with it — which is exactly what happened on 30 Sep. It takes the
  // user's say-so, passed as discardUserEdit. See utils/acrUserEdits.ts.
  if (isUserEdited(line) && discardUserEdit !== true) {
    throw new Error(editedLineMessage(line, 'withdraw', masked(userEditedValues(line), pid)));
  }

  useAcrStore.getState().createAcr(
    pid,
    CLAUDE_SESSION_ID,
    [{ name: 'discardPendingACRChange', args: { changeId, discardUserEdit: discardUserEdit === true } }],
    'claude'
  );

  const after: any = useAcrStore.getState().acrs.find((a: any) => a.id === pending.id);
  const finished = !after || after.status !== 'pending';
  return {
    acrId: pending.id,
    removed: changeId,
    remaining: after && !finished ? after.changes.map((c: any) => ({ id: c.id, title: c.changeTitle, action: c.name })) : [],
    note: !after
      ? 'That was the last change, so the whole request is gone.'
      : finished
        ? 'That was the last open line. The request is finished with the lines the user already signed off.'
        : undefined,
  };
}

/**
 * The archive, for Claude. The only way in: archived records are out of the
 * snapshot and out of search on purpose. Gemini reaches the same function
 * through its getArchivedItems query tool, so the two cannot drift.
 */
function readArchive(params: { module?: string; query?: string; limit?: number; project?: string } = {}) {
  return readArchivedModule(String(params?.module || 'tasks'), projectFor(params), {
    query: params?.query,
    limit: params?.limit,
  });
}

/**
 * What this build of the client can do that an older one cannot. Read-only;
 * bridge_status probes it. A tab without it answers "unknown operation", which
 * is how the bridge knows the tab predates the guard on the user's edits —
 * there, a withdrawal would go through with no check at all.
 */
function capabilities() {
  return {
    acrEditGuard: true, riskArchive: true, commentEdit: true, taskFlag: true,
    // 22 Oct 2026: sign-off line by line, headed groups, any project, any baseline.
    partialSignOff: true, acrGroups: true, crossProject: true, timelineBaselines: true,
  };
}

const OPERATIONS: Record<string, (params: any) => any> = {
  // maxChars comes from the bridge, not from here, so the budget can be tuned
  // in bridge/config.json without rebuilding the app.
  // No `project`: the open one (undefined keeps the old "no project" answer).
  getState: (params) =>
    getSanitizedProjectStateSnapshot(params?.project ? projectFor(params) : undefined, { maxChars: params?.maxChars }),
  getModule: (params) =>
    getSanitizedProjectModule(String(params?.module || ''), params?.project ? projectFor(params) : undefined, {
      baseline: params?.baseline ? String(params.baseline) : undefined,
    }),
  getFieldSchema: (params) => getFieldSchema(String(params?.module || '')),
  readItem,
  readArchive,
  search,
  listProjects,
  acrStatus,
  proposeChanges,
  discardChange,
  capabilities,
};

/**
 * The project a reply is about, for masking: the one the call named, or the
 * open one. Never throws — a call naming no real project has already failed.
 */
function replyProject(params: any): string | null {
  if (!params?.project) return null;
  try { return projectFor(params); } catch { return null; }
}

/**
 * A reply about a project that is not the open one says so, and says whose
 * glossary masked it. The same token can mean two people in two projects.
 */
function labelled(data: any, pid: string | null): any {
  if (!pid || pid === useAppStore.getState().activeProjectId) return data;
  const name = projectName(pid);
  const note = `From project "${name}", not the project open in the app. Names here are masked by that project's own privacy glossary.`;
  if (typeof data === 'string') return `=== PROJECT: ${name} — ${note} ===\n${data}`;
  if (data && typeof data === 'object' && !Array.isArray(data)) return { ...data, fromProject: name, fromProjectNote: note };
  return data;
}

/* ----------------------------------------------------------- screen report */

function currentScreen() {
  const path = window.location.pathname || '/';
  const segment = path.split('/').filter(Boolean)[0] || 'main-menu';
  const project = useAppStore.getState().projects.find(
    (p: any) => p.id === useAppStore.getState().activeProjectId
  );
  return {
    module: segment,
    path,
    activeProjectName: project ? project.name : null,
  };
}

function pushScreenIfChanged() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const screen = currentScreen();
  const key = JSON.stringify(screen);
  if (key === lastScreenKey) return;
  lastScreenKey = key;
  socket.send(JSON.stringify({ type: 'screen', screen: masked(screen) }));
}

/* ------------------------------------------------------------- connection */

function connect() {
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectDelay = RECONNECT_MIN_MS;
    lastScreenKey = '';
    console.info('[bridge] connected to the PM Codex bridge');
    socket?.send(JSON.stringify({ type: 'hello', info: { app: 'PM Codex', phase: 'propose-and-review', origin: window.location.origin } }));
    pushScreenIfChanged();
  };

  socket.onmessage = (event) => {
    let req: BridgeRequest;
    try {
      req = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof req.id !== 'number' || !req.op) return;

    const handler = OPERATIONS[req.op];
    if (!handler) {
      socket?.send(JSON.stringify({ id: req.id, ok: false, error: `Unknown operation "${req.op}".` }));
      return;
    }

    try {
      const data = handler(req.params || {});
      const pid = replyProject(req.params);
      socket?.send(JSON.stringify({ id: req.id, ok: true, data: masked(labelled(data, pid), pid) }));
    } catch (e: any) {
      socket?.send(JSON.stringify({ id: req.id, ok: false, error: e?.message || String(e) }));
    }
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };

  // Kept quiet on purpose: with no bridge running this fires on every retry,
  // and a console full of red is not a useful default for the app's users.
  socket.onerror = () => {};
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

/* --------------------------------------------------------------- sign-offs */

/**
 * Watches the change-request store and tells the bridge when the user decides
 * on a request Claude proposed. Phase 2.
 *
 * WHY IT WATCHES INSTEAD OF BEING CALLED
 *
 * The obvious place for this is the approve button in AISidebar.tsx. But that
 * file is large and often rewritten, and bridge code is kept out of files a
 * coding agent may rewrite. Watching the store keeps the whole reporting path
 * inside this file, which agents must not touch. The
 * only thing AISidebar has to know is not to answer Gemini for a Claude
 * request, and that is a plain conditional with no import.
 *
 * MCP cannot interrupt a conversation, so this is not instant. The bridge holds
 * the outcome and hands it to Claude on its next tool call.
 */
function watchAcrDecisions() {
  const seenStatus = new Map<string, string>();
  const seenDecided = new Map<string, number>();

  for (const acr of useAcrStore.getState().acrs) {
    seenStatus.set(acr.id, acr.status);
    seenDecided.set(acr.id, (acr.decided || []).length);
  }

  useAcrStore.subscribe((state: any) => {
    for (const acr of state.acrs as any[]) {
      const wasStatus = seenStatus.get(acr.id);
      const wasDecided = seenDecided.get(acr.id) ?? 0;
      const decided: any[] = acr.decided || [];
      seenStatus.set(acr.id, acr.status);
      seenDecided.set(acr.id, decided.length);

      if (wasStatus === undefined) continue;
      if ((acr.origin || 'gemini') !== 'claude') continue;

      // Since 22 Oct 2026 lines are signed off a few at a time: each sign-off
      // moves lines to `decided`, and is reported on its own, with what is
      // still open. A request closed the old way (whole, no `decided`) is
      // still read from its ticks.
      const fresh = decided.slice(wasDecided);
      const closedNow = wasStatus !== acr.status && (acr.status === 'approved' || acr.status === 'rejected');
      if (!fresh.length && !closedNow) continue;

      const line = (c: any) => ({
        title: c.changeTitle,
        action: c.name,
        ...(c.group ? { group: c.group } : {}),
        ...(isUserEdited(c) ? { edited: true } : {}),
      });

      let applied: any[];
      let rejected: any[];
      if (fresh.length) {
        applied = fresh.filter((c) => c.decision === 'applied').map(line);
        rejected = fresh.filter((c) => c.decision !== 'applied').map(line);
      } else {
        const approvedWhole = acr.status === 'approved';
        applied = approvedWhole ? acr.changes.filter((c: any) => c.approved).map(line) : [];
        rejected = (approvedWhole ? acr.changes.filter((c: any) => !c.approved) : acr.changes).map(line);
      }

      sendOutcome({
        acrId: acr.id,
        status: acr.status,
        project: projectName(acr.projectId),
        applied,
        rejected,
        stillOpen: acr.status === 'pending'
          ? acr.changes.map((c: any) => ({ id: c.id, title: c.changeTitle, action: c.name, ...(c.group ? { group: c.group } : {}) }))
          : [],
      }, acr.projectId);
    }
  });
}

/**
 * Deliberately quiet. If the bridge is not running, the user still approved
 * their changes, and the app must not care.
 */
function sendOutcome(outcome: {
  acrId: string;
  status: 'pending' | 'approved' | 'rejected';
  project: string;
  applied: { title: string; action: string }[];
  rejected: { title: string; action: string }[];
  stillOpen: { id: string; title: string; action: string }[];
}, projectId?: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify({
      type: 'acrOutcome',
      outcome: masked({ ...outcome, at: new Date().toISOString() }, projectId),
    }));
  } catch {
    /* a lost notice must never break an approval */
  }
}

export function startBridgeClient() {
  if (started || typeof window === 'undefined') return;
  started = true;
  connect();
  watchAcrDecisions();
  screenTimer = setInterval(pushScreenIfChanged, SCREEN_POLL_MS);
}

export function stopBridgeClient() {
  started = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (screenTimer) { clearInterval(screenTimer); screenTimer = null; }
  try { socket?.close(); } catch {}
  socket = null;
}

startBridgeClient();
