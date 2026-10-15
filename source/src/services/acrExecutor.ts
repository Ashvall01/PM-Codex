import { useTimelineStore } from '../store/timelineStore';
import { useCodexStore } from '../store/codexStore';
import { useDeliverablesStore } from '../store/deliverablesStore';
import { useTasksStore } from '../store/tasksStore';
import { useRisksStore } from '../store/risksStore';
import { useDocumentsStore } from '../store/documentsStore';
import { useStakeholdersStore } from '../store/stakeholdersStore';
import { useMomStore, normalizeMoMActionItemStatus } from '../store/momStore';
import { useMeetingsStore } from '../store/meetingsStore';
import { useBillingStore } from '../store/billingStore';
import { parseDateText, serialToIso } from '../features/Timeline/sheet/dates';
import { isCodexFolder, resolveCodexTarget } from '../utils/codexRules';

/**
 * THE EXECUTOR — the one place a proposed change is carried out.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This code used to exist three times over inside `AISidebar.tsx`: once for
 * Gemini's own review modal, once for the review panel's SIGN OFF button, and
 * once for the change card in the chat. They were 97% the same, and every
 * difference was a fault:
 *
 *   - A deliverable with no status became "Pending" from one path, "Planned"
 *     from the second and "Not Started" from the third. Only "Pending" is a
 *     real status. The other two wrote a value the app cannot colour, filter or
 *     group, and nothing complained.
 *   - A task with no type became "Action Item" from two paths and "Friction"
 *     from the third. "Friction" is not a task type either.
 *   - `reorderTimelineRow`, `createTimelineBaseline` and `updateMilestone` were
 *     handled in the first path only. Approving one of those from the review
 *     panel did nothing at all, silently. PLAN.md recorded this as "no executor
 *     case"; the truth was narrower and harder to spot — there WAS a case, in
 *     the one path nobody was testing.
 *
 * The argument-name bug of 8 September (`args.impact` where every caller sends
 * `impactLevel`) had to be fixed in all three copies. That is the pattern: one
 * fault, three edits, and nothing to tell you when you have only made two.
 *
 * So: one function, three callers, no copies. Everything reads its store
 * through `getState()`, so this runs outside React and needs no props.
 */

export interface ApplyChangeResult {
  /** Plain sentence for the assistant, and for the activity log. */
  message: string;
  /** The record before the change, where the caller draws a comparison. */
  beforeData?: any;
  /** The record after the change. */
  afterData?: any;
  /**
   * Anything the executor did beyond the change itself — today, the tasks
   * created from a meeting's action items. The user is told what these were.
   */
  sideEffects?: string[];
}

// ---------------------------------------------------------------------------
// Meeting action items
// ---------------------------------------------------------------------------

/**
 * The full shape of one meeting action item.
 *
 * `description`, `assignee` and `status` are all a meeting action item used to
 * hold. The rest are the fields a task needs to be worth having: without them
 * the task landed bare and the user had to come back and ask for a priority and
 * a date in a second round.
 */
export interface MeetingActionItemInput {
  id?: string;
  description?: string;
  assignee?: string;
  owner?: string;
  assignedTo?: string;
  status?: string;
  taskId?: string;
  type?: string;
  priority?: string;
  estimatedResolutionDate?: string;
  dueDate?: string;
  remarks?: string;
  linkedActivityIds?: string[];
}

/** One action item, in the shape the MoM store keeps. */
function normalizeActionItem(raw: any, index: number) {
  const item: MeetingActionItemInput =
    typeof raw === 'string' ? { description: raw } : raw || {};
  return {
    id: item.id || `act-${Date.now()}-${index}`,
    description: item.description || '',
    assignee: item.assignee || item.owner || item.assignedTo || 'PM',
    status: normalizeMoMActionItemStatus(item.status),
    taskId: item.taskId,
    type: item.type,
    priority: item.priority,
    estimatedResolutionDate: item.estimatedResolutionDate || item.dueDate,
    remarks: item.remarks,
    linkedActivityIds: item.linkedActivityIds,
  };
}

/*
 * Signing off minutes does NOT file their action items in the task tracker.
 * It did until 23 Sep 2026; the user turned that off. The user pushes an item
 * from the MoM screen when they choose — see `services/momActionPush.ts`.
 */

// ---------------------------------------------------------------------------
// The executor
// ---------------------------------------------------------------------------

/** Find the baseline a timeline action should be applied to. */
function resolveBaseline(projectId: string, revisionId?: string, create = false) {
  const timeline = useTimelineStore.getState();
  let projectTimeline = timeline.getProjectTimeline(projectId);
  if (!projectTimeline && create) {
    timeline.createProjectTimeline(projectId);
    projectTimeline = timeline.getProjectTimeline(projectId);
  }
  const targetId = revisionId || projectTimeline?.activeRevisionId;
  return projectTimeline
    ? projectTimeline.revisions.find((r) => r.id === targetId)
    : undefined;
}

/**
 * The archive is read-only, and that has to bind the assistants too.
 *
 * A field the user cannot edit on screen must not be editable by a proposal
 * either, or "read-only" is only skin deep and the user ends up approving a
 * change to a record they could not see. This file is the one place every
 * approval path funnels through since the 8 Sep merge, so one guard here covers
 * Claude, Gemini and the review panel alike.
 *
 * It also catches the case no up-front check can: a proposal filed while the
 * task was active, approved after the user archived it.
 *
 * Only unarchiveTask and deleteTask are allowed on an archived task.
 */
function refuseIfArchived(id: string, what: string): ApplyChangeResult | null {
  const found = useTasksStore.getState().tasks.find((t: any) => t.id === id);
  if (!found?.isArchived) return null;
  return {
    message:
      `Failed to ${what}. That task is archived, and an archived task is read-only. ` +
      `Restore it first (unarchiveTask), then change it.`,
  };
}

/**
 * The same guard for deliverables.
 *
 * Two functions rather than one generic guard, because the stores are plain
 * Zustand slices with no shared base — 20.9 decided that, and inventing a base
 * for one lookup would be a bigger change than the feature. Only
 * unarchiveDeliverable and deleteDeliverable are allowed on an archived one.
 */
function refuseIfDeliverableArchived(id: string, what: string): ApplyChangeResult | null {
  const found = useDeliverablesStore.getState().deliverables.find((d: any) => d.id === id);
  if (!found?.isArchived) return null;
  return {
    message:
      `Failed to ${what}. That deliverable is archived, and an archived deliverable is read-only. ` +
      `Restore it first (unarchiveDeliverable), then change it.`,
  };
}

/** The same guard for risks. Only unarchiveProjectRisk and deleteProjectRisk are allowed on an archived one. */
function refuseIfRiskArchived(id: string, what: string): ApplyChangeResult | null {
  const found = useRisksStore.getState().risks.find((r: any) => r.id === id);
  if (!found?.isArchived) return null;
  return {
    message:
      `Failed to ${what}. That risk is archived, and an archived risk is read-only. ` +
      `Restore it first (unarchiveProjectRisk), then change it.`,
  };
}

/**
 * Arguments that say which record and why, never what it becomes.
 *
 * `{ id, ...updates }` used to pass `changeTitle` (the proposal's own
 * headline) and `callId` straight into the store, so every record an assistant
 * had ever updated carried a `changeTitle` field, and the Sheet grew a column
 * for it. Minutes already dropped them; now every update does.
 */
function contentOnly(args: any): Record<string, any> {
  const { id, changeTitle, callId, projectId, sessionId, ...rest } = args || {};
  return rest;
}

/**
 * A holiday list as the assistants send it: an array of dates, or one string
 * of dates separated by commas or new lines. Dates may be YYYY-MM-DD or typed
 * day first (28/09/2026), as in the Holidays box. Objects with a `date` field
 * are read too, so "{ date, name }" works.
 */
export function normalizeHolidayList(raw: any): { dates: string[]; bad: string[] } {
  let items: any[] = [];
  if (Array.isArray(raw)) items = raw;
  else if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try { items = JSON.parse(t); } catch { items = t.split(/[\n,;]+/); }
    } else items = t.split(/[\n,;]+/);
  }
  const dates: string[] = [];
  const bad: string[] = [];
  for (const item of items) {
    const text = String(item && typeof item === 'object' ? item.date ?? '' : item ?? '').trim();
    if (!text) continue;
    const serial = parseDateText(text);
    if (serial === null) bad.push(text);
    else dates.push(serialToIso(serial));
  }
  return { dates: Array.from(new Set(dates)).sort(), bad };
}

/**
 * Carry out one approved change.
 *
 * Throws nothing on an unknown action — it returns a message saying so, because
 * a silent no-op is what this whole file exists to prevent. Real errors are
 * left to the caller's try/catch, which each of the three has.
 */
export function applyProjectChange(
  name: string,
  args: any,
  activeProjectId: string | null,
): ApplyChangeResult {
  const noProject = (what: string): ApplyChangeResult => ({
    message: `Failed to ${what}. No active project.`,
  });

  switch (name) {
    // ---------------------------------------------------------------- timeline
    case 'addTimelineRow': {
      if (!activeProjectId) return noProject('add row');
      const baseline = resolveBaseline(activeProjectId, args.revisionId, true);
      if (!baseline) {
        return { message: 'Failed to add row. Could not find or create baseline.' };
      }
      useTimelineStore.getState().addActivity(
        activeProjectId,
        baseline.id,
        {
          phase: args.phase || '',
          activity: args.activity || '',
          subActivity: args.subActivity || '',
          weight: Number(args.weight) || 0,
          progress: Number(args.progress) || 0,
          status: args.status || 'Planned',
          owner: args.owner || '',
          targetStartDate: args.targetStartDate || '',
          targetCompletionDate: args.targetCompletionDate || '',
          actualStartDate: args.actualStartDate || '',
          actualCompletionDate: args.actualCompletionDate || '',
          remarks: args.remarks || '',
        },
        args.insertAfterId,
      );
      return { message: 'Row added successfully.' };
    }

    case 'updateTimelineRow': {
      if (!activeProjectId) return noProject('update row');
      const { revisionId, id } = args;
      const updates = contentOnly(args);
      delete (updates as any).revisionId;
      const baseline = resolveBaseline(activeProjectId, revisionId);
      if (!baseline) return { message: 'Failed to update row. No active baseline.' };
      const row = baseline.activities.find((a: any) => a.id === id);
      useTimelineStore.getState().updateActivity(activeProjectId, baseline.id, id, updates);
      return {
        message: 'Row updated successfully.',
        beforeData: row ? { ...row } : null,
        afterData: row ? { ...row, ...updates } : null,
      };
    }

    case 'deleteTimelineRow': {
      if (!activeProjectId) return noProject('delete row');
      const baseline = resolveBaseline(activeProjectId, args.revisionId);
      if (!baseline) return { message: 'Failed to delete row. No active baseline.' };
      const row = baseline.activities.find((a: any) => a.id === args.id);
      useTimelineStore.getState().deleteActivity(activeProjectId, baseline.id, args.id);
      return {
        message: 'Row deleted successfully.',
        beforeData: row ? { ...row } : null,
        afterData: row ? { deleted: true } : null,
      };
    }

    // Handled in one path only before this file existed. Approving either of
    // the next two from the review panel used to do nothing, silently.
    case 'reorderTimelineRow': {
      if (!activeProjectId) return noProject('reorder row');
      const baseline = resolveBaseline(activeProjectId, args.revisionId);
      if (!baseline) return { message: 'Failed to reorder row. No active baseline.' };
      useTimelineStore
        .getState()
        .reorderActivity(activeProjectId, baseline.id, args.startIndex, args.endIndex);
      return { message: 'Row reordered successfully.' };
    }

    case 'createTimelineBaseline': {
      if (!activeProjectId) return noProject('create baseline');
      useTimelineStore
        .getState()
        .createRevision(activeProjectId, args.name || 'New Baseline', args.baseRevisionId);
      return { message: 'Timeline baseline created successfully.' };
    }

    // The project's days off. WORKDAY and NETWORKDAYS skip them, so every
    // formula is worked out again when the list changes. The proposal carries
    // the WHOLE list, like a meeting's action items: the review panel shows the
    // old list above the new one, so a removal can never slip through unseen.
    case 'setTimelineHolidays': {
      if (!activeProjectId) return noProject('change holidays');
      const { dates, bad } = normalizeHolidayList(args.holidays);
      if (bad.length) {
        return { message: `Failed to change holidays. Not a date: ${bad.join(', ')}. Nothing was changed.` };
      }
      const timeline = useTimelineStore.getState();
      if (!timeline.getProjectTimeline(activeProjectId)) timeline.createProjectTimeline(activeProjectId);
      const before = useTimelineStore.getState().getProjectTimeline(activeProjectId)?.holidays || [];
      useTimelineStore.getState().setHolidays(activeProjectId, dates);
      const added = dates.filter((d) => !before.includes(d)).length;
      const removed = before.filter((d) => !dates.includes(d)).length;
      return {
        message: `Holidays updated: ${added} added, ${removed} removed, ${dates.length} in the list. `
          + 'Formulas using WORKDAY or NETWORKDAYS were worked out again.',
        beforeData: { holidays: before },
        afterData: { holidays: dates },
      };
    }

    // ------------------------------------------------------------------ codex
    // A folder holds pages and has no content; a page always sits in a folder.
    // See utils/codexRules.ts. The proposal was checked when it was filed; this
    // is the second line, for anything that changed in between.
    case 'createCodexFolder': {
      if (!activeProjectId) return noProject('create codex folder');
      const title = String(args.title || '').trim().toUpperCase() || 'NEW FOLDER';
      useCodexStore.getState().addPage({ projectId: activeProjectId, title, content: '', parentId: null });
      return { message: `Codex folder "${title}" created.` };
    }

    case 'createCodexPage': {
      if (!activeProjectId) return noProject('create codex page');
      const target = resolveCodexTarget(activeProjectId, args);
      if (typeof target === 'string') return { message: `Failed to create codex page. ${target}` };
      let folderId = target.folder?.id;
      let note = '';
      if (!folderId && target.newFolderTitle) {
        folderId = useCodexStore.getState().addPage({
          projectId: activeProjectId, title: target.newFolderTitle, content: '', parentId: null,
        });
        note = ` in a new folder "${target.newFolderTitle}"`;
      } else if (target.flattenedFrom && target.folder) {
        note = ` in the folder "${target.folder.title}" (pages cannot hold pages, so it sits beside "${target.flattenedFrom.title}")`;
      }
      useCodexStore.getState().addPage({
        projectId: activeProjectId,
        title: args.title || 'Untitled',
        content: args.content || '',
        parentId: folderId || null,
      });
      return { message: `Codex page created${note}.` };
    }

    case 'updateCodexPage': {
      const { id } = args;
      const updates: Record<string, any> = contentOnly(args);
      delete updates.folder;
      delete updates.folderTitle;
      const page = useCodexStore.getState().pages.find((p) => p.id === id);
      if (!page) return { message: 'Failed to update codex page. No page with that id.' };
      if (isCodexFolder(page)) {
        // A folder takes a new name and nothing else. Clearing old folder notes
        // (content '') is allowed; writing new ones is not — nobody would see them.
        if (updates.content !== undefined && String(updates.content).trim()) {
          return { message: `Failed to update "${page.title}". It is a folder, and a folder has no content. Nothing was changed.` };
        }
        delete updates.parentId;
        if (updates.title) updates.title = String(updates.title).trim().toUpperCase();
      } else if (updates.parentId !== undefined) {
        const target = resolveCodexTarget(page.projectId, { parentId: updates.parentId });
        if (typeof target === 'string' || !target.folder) {
          return { message: `Failed to move "${page.title}". ${typeof target === 'string' ? target : 'That is not a folder.'}` };
        }
        updates.parentId = target.folder.id;
      }
      useCodexStore.getState().updatePage(id, updates);
      return {
        message: 'Codex page updated successfully.',
        beforeData: { ...page },
        afterData: { ...page, ...updates },
      };
    }

    // ----------------------------------------------------------- deliverables
    case 'addDeliverable': {
      if (!activeProjectId) return noProject('add deliverable');
      useDeliverablesStore.getState().addDeliverable({
        projectId: activeProjectId,
        parentId: args.parentId || null,
        title: args.title || 'Untitled',
        description: args.description || '',
        definitionOfDone: args.definitionOfDone || '',
        // "Pending" is a real DeliverableStatus. "Planned" and "Not Started",
        // which two of the three old copies used, are not.
        status: args.status || 'Pending',
        dueDate: args.dueDate || '',
        category: args.category || '',
        priority: args.priority || 'Medium',
        owner: args.owner || '',
        hasNestedSpace: !!args.hasNestedSpace,
        comments: [],
        linkedActivityIds: args.linkedActivityIds || [],
      } as any);
      return { message: 'Deliverable added successfully.' };
    }

    case 'updateDeliverable': {
      const { id } = args;
      const updates = contentOnly(args);
      const refusal = refuseIfDeliverableArchived(id, 'update deliverable');
      if (refusal) return refusal;
      useDeliverablesStore.getState().updateDeliverable(id, updates);
      return { message: 'Deliverable updated successfully.' };
    }

    case 'archiveDeliverable': {
      const store = useDeliverablesStore.getState();
      const found = store.deliverables.find((d: any) => d.id === args.id);
      if (!found) return { message: 'Failed to archive deliverable. No deliverable with that id.' };
      if (found.isArchived) return { message: 'That deliverable was already archived. Nothing changed.' };
      // A deliverable archives with its whole subtree — see PLAN.md 21.2. The
      // count is read BEFORE the write, and it is said out loud, because a user
      // approving one line has a right to know it moved four records.
      const descendants = store.getSubtreeIds(args.id).length - 1;
      store.archiveDeliverable(args.id);
      return {
        message: descendants > 0
          ? `Deliverable archived, with ${descendants} nested sub-deliverable${descendants === 1 ? '' : 's'} beneath it. `
            + `They are out of the active list and out of the AI snapshot, and they restore together.`
          : 'Deliverable archived. It is out of the active list and out of the AI snapshot.',
      };
    }

    case 'unarchiveDeliverable': {
      const store = useDeliverablesStore.getState();
      const found = store.deliverables.find((d: any) => d.id === args.id);
      if (!found) return { message: 'Failed to restore deliverable. No deliverable with that id.' };
      if (!found.isArchived) return { message: 'That deliverable was not archived. Nothing changed.' };
      const descendants = store.getSubtreeIds(args.id).length - 1;
      store.unarchiveDeliverable(args.id);
      return {
        message: descendants > 0
          ? `Deliverable restored to the active list, with ${descendants} nested sub-deliverable${descendants === 1 ? '' : 's'}.`
          : 'Deliverable restored to the active list.',
      };
    }

    case 'deleteDeliverable':
      useDeliverablesStore.getState().deleteDeliverable(args.id);
      return { message: 'Deliverable deleted successfully.' };

    case 'addDeliverableComment': {
      // Claude's bridge sends `id`; Gemini's own schema sends `deliverableId`.
      const targetId = args.id || args.deliverableId;
      const refusal = refuseIfDeliverableArchived(targetId, 'add deliverable comment');
      if (refusal) return refusal;
      useDeliverablesStore.getState().addComment(targetId, args.text, 'Assistant');
      return { message: 'Comment added successfully.' };
    }

    case 'editDeliverableComment': {
      // Claude's bridge sends `id`; Gemini's own schema sends `deliverableId`.
      const targetId = args.id || args.deliverableId;
      const refusal = refuseIfDeliverableArchived(targetId, 'edit deliverable comment');
      if (refusal) return refusal;
      const d = useDeliverablesStore.getState().deliverables.find((x: any) => x.id === targetId);
      const c = (d?.comments || []).find((x: any) => x.id === args.commentId);
      if (!c) return { message: 'Failed to edit comment. No comment with that id on that deliverable.' };
      if (!String(args.text ?? '').trim()) return { message: 'Failed to edit comment. The new text is empty.' };
      useDeliverablesStore.getState().editComment(targetId, args.commentId, args.text, 'Assistant');
      return { message: 'Comment edited successfully.' };
    }

    // ------------------------------------------------------------------ tasks
    case 'addTask': {
      if (!activeProjectId) return noProject('add task');
      useTasksStore.getState().addTask({
        projectId: activeProjectId,
        // "Action Item" and "Issue" are the only task types. "Friction", which
        // the chat-card copy used, is not one.
        type: args.type === 'Issue' ? 'Issue' : 'Action Item',
        description: args.description || 'New Task',
        status: args.status || 'Open',
        owner: args.owner || '',
        remarks: args.remarks || '',
        estimatedResolutionDate: args.estimatedResolutionDate || '',
        source: args.source || '',
        priority: args.priority || 'Medium',
        comments: [],
        linkedActivityIds: args.linkedActivityIds || [],
      });
      return { message: 'Task added successfully.' };
    }

    case 'updateTask': {
      const { id } = args;
      const updates = contentOnly(args);
      const refusal = refuseIfArchived(id, 'update task');
      if (refusal) return refusal;
      useTasksStore.getState().updateTask(id, updates);
      return { message: 'Task updated successfully.' };
    }

    case 'archiveTask': {
      const found = useTasksStore.getState().tasks.find((t: any) => t.id === args.id);
      if (!found) return { message: 'Failed to archive task. No task with that id.' };
      if (found.isArchived) return { message: 'That task was already archived. Nothing changed.' };
      // archivedDate is stamped here, at sign-off, not when the change was
      // proposed — a proposal can sit waiting for days.
      useTasksStore.getState().archiveTask(args.id);
      return { message: 'Task archived. It is out of the active list and out of the AI snapshot.' };
    }

    case 'unarchiveTask': {
      const found = useTasksStore.getState().tasks.find((t: any) => t.id === args.id);
      if (!found) return { message: 'Failed to restore task. No task with that id.' };
      if (!found.isArchived) return { message: 'That task was not archived. Nothing changed.' };
      useTasksStore.getState().unarchiveTask(args.id);
      return { message: 'Task restored to the active list.' };
    }

    // Delete works on an archived task. Archiving is not a lock, it is a
    // filing cabinet, and the bin is still in the tray in the archive view.
    case 'deleteTask':
      useTasksStore.getState().deleteTask(args.id);
      return { message: 'Task deleted successfully.' };

    case 'addTaskComment': {
      const targetId = args.id || args.taskId;
      const refusal = refuseIfArchived(targetId, 'add task comment');
      if (refusal) return refusal;
      useTasksStore.getState().addComment(targetId, args.text, 'Assistant');
      return { message: 'Task comment added successfully.' };
    }

    case 'editTaskComment': {
      const targetId = args.id || args.taskId;
      const refusal = refuseIfArchived(targetId, 'edit task comment');
      if (refusal) return refusal;
      const t = useTasksStore.getState().tasks.find((x: any) => x.id === targetId);
      const c = (t?.comments || []).find((x: any) => x.id === args.commentId);
      if (!c) return { message: 'Failed to edit comment. No comment with that id on that task.' };
      if (!String(args.text ?? '').trim()) return { message: 'Failed to edit comment. The new text is empty.' };
      useTasksStore.getState().editComment(targetId, args.commentId, args.text, 'Assistant');
      return { message: 'Task comment edited successfully.' };
    }

    // A flag is one field on a task. Two actions rather than a toggle, so a
    // proposal says what the flag becomes and a re-approved one cannot flip it back.
    case 'flagTask':
    case 'unflagTask': {
      const flagged = name === 'flagTask';
      const refusal = refuseIfArchived(args.id, flagged ? 'flag task' : 'unflag task');
      if (refusal) return refusal;
      const found = useTasksStore.getState().tasks.find((t: any) => t.id === args.id);
      if (!found) return { message: `Failed to ${flagged ? 'flag' : 'unflag'} task. No task with that id.` };
      if (!!found.isFlagged === flagged) return { message: `That task was already ${flagged ? 'flagged' : 'not flagged'}. Nothing changed.` };
      useTasksStore.getState().setFlag(args.id, flagged);
      return { message: flagged ? 'Task flagged.' : 'Task flag removed.' };
    }

    // ------------------------------------------------------------------ risks
    case 'addProjectRisk': {
      if (!activeProjectId) return noProject('add risk');
      useRisksStore.getState().addRisk(activeProjectId, {
        riskId: args.riskId || '',
        riskDescription: args.riskDescription || '',
        projectSpecificDescription: args.projectSpecificDescription || '',
        impactLevel: args.impactLevel || '',
        probability: args.probability || '',
        ciaConfidentiality: args.ciaConfidentiality || '',
        ciaIntegrity: args.ciaIntegrity || '',
        ciaAvailability: args.ciaAvailability || '',
        impactArea: args.impactArea || '',
        postMitigationImpactLevel: args.postMitigationImpactLevel || '',
        postMitigationProbability: args.postMitigationProbability || '',
        owner: args.owner || '',
        responsibility: args.responsibility || '',
        mitigationStrategy: args.mitigationStrategy || '',
        projectSpecificMitigationStrategy: args.projectSpecificMitigationStrategy || '',
        status: args.status || 'Open',
        targetResolutionDate: args.targetResolutionDate || '',
        remarks: args.remarks || '',
        controlAnnexA: args.controlAnnexA || '',
      } as any);
      return { message: 'Risk added successfully.' };
    }

    case 'updateProjectRisk': {
      const { id } = args;
      const updates = contentOnly(args);
      const refusal = refuseIfRiskArchived(id, 'update risk');
      if (refusal) return refusal;
      useRisksStore.getState().updateRisk(id, updates);
      return { message: 'Risk updated successfully.' };
    }

    case 'archiveProjectRisk': {
      const found = useRisksStore.getState().risks.find((r: any) => r.id === args.id);
      if (!found) return { message: 'Failed to archive risk. No risk with that id.' };
      if (found.isArchived) return { message: 'That risk was already archived. Nothing changed.' };
      // archivedDate is stamped here, at sign-off, not when proposed.
      useRisksStore.getState().archiveRisk(args.id);
      return { message: 'Risk archived. It is out of the active list, the heat map and the AI snapshot.' };
    }

    case 'unarchiveProjectRisk': {
      const found = useRisksStore.getState().risks.find((r: any) => r.id === args.id);
      if (!found) return { message: 'Failed to restore risk. No risk with that id.' };
      if (!found.isArchived) return { message: 'That risk was not archived. Nothing changed.' };
      useRisksStore.getState().unarchiveRisk(args.id);
      return { message: 'Risk restored to the active list.' };
    }

    case 'deleteProjectRisk':
      useRisksStore.getState().deleteRisk(args.id);
      return { message: 'Risk deleted successfully.' };

    // --------------------------------------------------------------- documents
    // Added 10 Sep, alongside the bridge wiring below. The Documents module
    // (documentsStore.ts) predates this file but had no executor case at all —
    // not a bug, the same "never wired up" gap risks had before Phase 2.
    case 'addDocument': {
      if (!activeProjectId) return noProject('add document');
      useDocumentsStore.getState().addDocument(activeProjectId, {
        title: args.title || 'Untitled Document',
        url: args.url || '',
        type: args.type || 'Other',
        status: args.status || 'Draft',
        version: args.version || '1.0',
        owner: args.owner || '',
        description: args.description || '',
      } as any);
      return { message: 'Document added successfully.' };
    }

    case 'updateDocument': {
      const { id } = args;
      const updates = contentOnly(args);
      useDocumentsStore.getState().updateDocument(id, updates);
      return { message: 'Document updated successfully.' };
    }

    case 'deleteDocument':
      useDocumentsStore.getState().deleteDocument(args.id);
      return { message: 'Document deleted successfully.' };

    // ----------------------------------------------------------- stakeholders
    case 'addStakeholder': {
      if (!activeProjectId) return noProject('add stakeholder');
      useStakeholdersStore.getState().addStakeholder(activeProjectId, {
        name: args.name || 'New Stakeholder',
        role: args.projectRole || args.role || '',
        projectRole: args.projectRole || args.role || '',
        orgRole: args.orgRole || '',
        organization: args.organization || '',
        email: args.email || '',
        phone: args.phone || '',
        power: args.power || args.influence || 'Medium',
        interest: args.interest || 'Medium',
        knowledge: args.knowledge || 'Medium',
        interPersonalRelations: args.interPersonalRelations || '',
        reportsToId: args.reportsToId || undefined,
        projectReportsToId: args.projectReportsToId || undefined,
        notes: args.notes || '',
      } as any);
      return { message: 'Stakeholder added successfully.' };
    }

    case 'updateStakeholder': {
      const { id } = args;
      const updates = contentOnly(args);
      useStakeholdersStore.getState().updateStakeholder(id, updates);
      return { message: 'Stakeholder updated successfully.' };
    }

    case 'deleteStakeholder':
      useStakeholdersStore.getState().deleteStakeholder(args.id);
      return { message: 'Stakeholder deleted successfully.' };

    // ------------------------------------------------------- minutes of meeting
    case 'createMoM':
    case 'createMom':
    case 'addMoM':
    case 'addMom': {
      if (!activeProjectId) return noProject('create minutes');
      const title = args.title || args.name || 'Meeting Minutes';
      const momId = useMomStore.getState().importMom(activeProjectId, {
        title,
        date: args.date || new Date().toISOString().split('T')[0],
        time: args.time || '10:00',
        location: args.location || 'Virtual Call / Remote',
        attendees: Array.isArray(args.attendees)
          ? args.attendees.join(', ')
          : args.attendees || '',
        agenda: args.agenda || '',
        notes: args.notes || args.meetingNotes || '',
        keyDecisions: args.keyDecisions || args.decisions || '',
        actionItems: (args.actionItems || []).map(normalizeActionItem),
      });
      useMomStore.getState().setActiveMomId(momId);
      return { message: `Created minutes: "${title}".` };
    }

    case 'updateMom':
    case 'updateMoM': {
      // `changeTitle` describes the proposal, not the meeting. It used to be
      // written into the record and then synced to Sheets as rubbish.
      const { id, changeTitle, callId, projectId, ...rest } = args;
      const updates: any = { ...rest };
      if (rest.name !== undefined && rest.title === undefined) {
        updates.title = rest.name;
        delete updates.name;
      }
      if (rest.meetingNotes !== undefined && rest.notes === undefined) {
        updates.notes = rest.meetingNotes;
        delete updates.meetingNotes;
      }
      if (rest.decisions !== undefined && rest.keyDecisions === undefined) {
        updates.keyDecisions = rest.decisions;
        delete updates.decisions;
      }
      if (Array.isArray(rest.attendees)) updates.attendees = rest.attendees.join(', ');
      if (Array.isArray(rest.actionItems)) {
        updates.actionItems = rest.actionItems.map(normalizeActionItem);
      }

      useMomStore.getState().updateMom(id, updates);
      return { message: 'Minutes updated.' };
    }

    case 'deleteMom':
    case 'deleteMoM':
      useMomStore.getState().deleteMom(args.id);
      return { message: 'Minutes deleted.' };

    case 'updateMeetingDraft': {
      useMeetingsStore.getState().setDraftMoM({
        title: args.title || '',
        date: args.date || '',
        time: args.time || '',
        location: args.location || '',
        attendees: Array.isArray(args.attendees)
          ? args.attendees.join(', ')
          : args.attendees || '',
        agenda: args.agenda || '',
        keyDecisions: args.keyDecisions || '',
        notes: args.notes || '',
      } as any);
      if (args.actionItems) {
        useMeetingsStore.getState().setDraftActionItems(
          args.actionItems.map((ai: any, idx: number) => ({
            id: `draft-tk-${idx}`,
            ...(typeof ai === 'string' ? { description: ai } : ai),
            approved: true,
          })),
        );
      }
      if (args.updatesToExistingRecords) {
        useMeetingsStore.getState().setDraftUpdates(
          args.updatesToExistingRecords.map((ur: any, idx: number) => ({
            id: `draft-ur-${idx}`,
            ...ur,
            approved: true,
          })),
        );
      }
      return { message: 'Meeting draft updated successfully.' };
    }

    // ---------------------------------------------------------------- billing
    case 'updateMilestone': {
      const { id } = args;
      const updates = contentOnly(args);
      useBillingStore.getState().updateMilestone(id, updates);
      return { message: 'Billing milestone updated successfully.' };
    }

    // ---------------------------------------------------------------- unknown
    default:
      // Never silent. A proposal the user approved and nothing carried out is
      // the exact failure this file was built to end.
      console.warn('[acrExecutor] No case for action:', name);
      return {
        message: `No handler for "${name}". Nothing was changed.`,
      };
  }
}
