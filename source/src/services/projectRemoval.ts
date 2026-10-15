/**
 * DELETING A PROJECT — and getting it back.
 *
 * A project's records live in a dozen stores, and every save rewrites the
 * Sheet from them. Deleting a project therefore means removing its records
 * from every store at once; the next save then leaves them out of the Sheet.
 *
 * Three things make that safe:
 *
 *   1. A BACKUP comes first. `buildProjectBackup` gathers every record of the
 *      project into one file, and the delete dialog downloads it before
 *      anything is removed. `restoreProjectBackup` puts it all back, ids and
 *      links intact, from the project list.
 *   2. The save guard is told. A save that would empty most of a sheet is held
 *      back (gasSyncService, LARGE_DELETION). A delete the user asked for is
 *      expected to remove rows, so exactly those rows are taken off the
 *      guard's reference — anything else missing is still held back.
 *   3. The project's id is remembered as deleted, so a load from the Sheet in
 *      the moments before the save lands cannot bring its records back.
 */
import { useAppStore, Project } from '../store/appStore';
import { useTimelineStore, ProjectTimeline } from '../store/timelineStore';
import { useDeliverablesStore } from '../store/deliverablesStore';
import { useTasksStore } from '../store/tasksStore';
import { useCodexStore } from '../store/codexStore';
import { useDocumentsStore } from '../store/documentsStore';
import { useBillingStore } from '../store/billingStore';
import { useRisksStore } from '../store/risksStore';
import { useStakeholdersStore } from '../store/stakeholdersStore';
import { useMomStore } from '../store/momStore';
import { usePIIStore } from '../store/piiStore';
import { useAcrStore } from '../store/acrStore';
import { useAiStore } from '../store/aiStore';
import { gasSyncService } from './gasSyncService';

const BACKUP_KIND = 'pm-codex-project-backup';
const BACKUP_VERSION = 1;

export interface ProjectBackup {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: string;
  project: Project;
  timeline: ProjectTimeline | null;
  deliverables: any[];
  tasks: any[];
  codexPages: any[];
  documents: any[];
  billingMilestones: any[];
  risks: any[];
  stakeholders: any[];
  moms: any[];
  piiEntries: any[];
  acrs: any[];
  aiSessions: any[];
}

const ofProject = <T extends { projectId?: string }>(list: T[] | undefined, projectId: string): T[] =>
  (list || []).filter((r) => r?.projectId === projectId);

export function buildProjectBackup(projectId: string): ProjectBackup | null {
  const project = useAppStore.getState().projects.find((p) => p.id === projectId);
  if (!project) return null;
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    timeline: useTimelineStore.getState().projectTimelines.find((t) => t.projectId === projectId) || null,
    deliverables: ofProject(useDeliverablesStore.getState().deliverables, projectId),
    tasks: ofProject(useTasksStore.getState().tasks, projectId),
    codexPages: ofProject(useCodexStore.getState().pages, projectId),
    documents: ofProject(useDocumentsStore.getState().documents, projectId),
    billingMilestones: ofProject(useBillingStore.getState().milestones as any[], projectId),
    risks: ofProject(useRisksStore.getState().risks as any[], projectId),
    stakeholders: ofProject(useStakeholdersStore.getState().stakeholders, projectId),
    moms: ofProject(useMomStore.getState().moms, projectId),
    piiEntries: ofProject(usePIIStore.getState().entries, projectId),
    acrs: ofProject(useAcrStore.getState().acrs as any[], projectId),
    aiSessions: ofProject(useAiStore.getState().sessions as any[], projectId),
  };
}

/** What the project holds, in the words the delete dialog uses. */
export function projectContents(projectId: string): { label: string; count: number }[] {
  const b = buildProjectBackup(projectId);
  if (!b) return [];
  const rows = (b.timeline?.revisions || []).reduce((n, r) => n + (r.activities || []).length, 0);
  return [
    { label: 'timeline rows', count: rows },
    { label: 'baselines', count: (b.timeline?.revisions || []).length },
    { label: 'tasks & issues', count: b.tasks.length },
    { label: 'deliverables', count: b.deliverables.length },
    { label: 'risks', count: b.risks.length },
    { label: 'stakeholders', count: b.stakeholders.length },
    { label: 'meeting minutes', count: b.moms.length },
    { label: 'Codex folders & pages', count: b.codexPages.length },
    { label: 'documents', count: b.documents.length },
    { label: 'billing milestones', count: b.billingMilestones.length },
    { label: 'glossary entries', count: b.piiEntries.length },
    { label: 'chats', count: b.aiSessions.length },
  ].filter((x) => x.count > 0);
}

/** "PM Codex backup — Website Revamp — 2026-09-24.json" */
export function backupFileName(project: Project): string {
  const name = String(project.name || 'Project').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Project';
  return `PM Codex backup — ${name} — ${new Date().toISOString().slice(0, 10)}.json`;
}

/** Hands the browser a backup file to save. Resolves once the download has been started. */
export async function downloadProjectBackup(projectId: string): Promise<boolean> {
  const backup = buildProjectBackup(projectId);
  if (!backup) return false;
  const { saveAs } = await import('file-saver');
  const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
  saveAs(blob, backupFileName(backup.project));
  return true;
}

/**
 * Removes the project and everything in it from this browser. The next save
 * writes the Sheet without it. Call only after the backup has been taken.
 */
export function deleteProjectEverywhere(projectId: string): boolean {
  const backup = buildProjectBackup(projectId);
  if (!backup) return false;

  // The rows each Sheet tab loses, so the save guard expects exactly these.
  const activityCount = (backup.timeline?.revisions || []).reduce((n, r) => n + (r.activities || []).length, 0);
  gasSyncService.expectRowRemovals({
    projects: 1,
    timelineRevisions: (backup.timeline?.revisions || []).length,
    timelineActivities: activityCount,
    deliverables: backup.deliverables.length,
    tasks: backup.tasks.length,
    codexPages: backup.codexPages.length,
    documents: backup.documents.length,
    billingMilestones: backup.billingMilestones.length,
    risks: backup.risks.length,
    stakeholders: backup.stakeholders.length,
    moms: backup.moms.length,
    piiEntries: backup.piiEntries.length,
  });

  useAppStore.getState().markProjectDeleted(projectId);

  const not = <T extends { projectId?: string }>(list: T[]) => list.filter((r) => r?.projectId !== projectId);
  useTimelineStore.setState((s) => {
    const collapsed = { ...(s.ganttCollapsedStates || {}) };
    delete collapsed[projectId];
    return { projectTimelines: s.projectTimelines.filter((t) => t.projectId !== projectId), ganttCollapsedStates: collapsed };
  });
  useDeliverablesStore.setState((s) => ({ deliverables: not(s.deliverables) }));
  useTasksStore.setState((s) => ({ tasks: not(s.tasks) }));
  useCodexStore.setState((s) => ({
    pages: not(s.pages),
    activePageId: s.pages.some((p) => p.id === s.activePageId && p.projectId === projectId) ? null : s.activePageId,
  }));
  useDocumentsStore.setState((s) => ({ documents: not(s.documents) }));
  useBillingStore.setState((s: any) => ({ milestones: not(s.milestones) }));
  useRisksStore.setState((s: any) => ({ risks: not(s.risks) }));
  useStakeholdersStore.setState((s) => ({ stakeholders: not(s.stakeholders) }));
  useMomStore.setState((s) => ({ moms: not(s.moms) }));
  usePIIStore.setState((s) => ({ entries: not(s.entries) }));
  useAcrStore.setState((s: any) => ({ acrs: not(s.acrs) }));
  useAiStore.setState((s: any) => ({ sessions: not(s.sessions) }));
  // Last, so every screen still open has already let go of the records.
  useAppStore.setState((s) => ({
    projects: s.projects.filter((p) => p.id !== projectId),
    activeProjectId: s.activeProjectId === projectId ? null : s.activeProjectId,
  }));
  return true;
}

export type RestoreResult = { ok: true; name: string; count: number } | { ok: false; reason: string };

/** Reads a backup file's text and puts the project back, ids and links intact. */
export function restoreProjectBackup(text: string): RestoreResult {
  let backup: ProjectBackup;
  try {
    backup = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That file is not a PM Codex backup (it could not be read).' };
  }
  if (!backup || backup.kind !== BACKUP_KIND || !backup.project?.id) {
    return { ok: false, reason: 'That file is not a PM Codex project backup.' };
  }
  if (Number(backup.version) > BACKUP_VERSION) {
    return { ok: false, reason: 'That backup was made by a newer PM Codex. Update the app, then restore it.' };
  }
  const projectId = backup.project.id;
  if (useAppStore.getState().projects.some((p) => p.id === projectId)) {
    return { ok: false, reason: `"${backup.project.name}" is already in your project list. Nothing was changed.` };
  }

  useAppStore.getState().unmarkProjectDeleted(projectId);

  // Added, never replacing: a record already present (same id) is left as it is.
  const add = <T extends { id: string }>(current: T[], incoming: T[] | undefined): T[] => {
    const have = new Set(current.map((r) => r.id));
    return [...current, ...(incoming || []).filter((r) => r && r.id && !have.has(r.id))];
  };
  if (backup.timeline) {
    useTimelineStore.setState((s) => ({
      projectTimelines: [...s.projectTimelines.filter((t) => t.projectId !== projectId), backup.timeline as ProjectTimeline],
    }));
  }
  useDeliverablesStore.setState((s) => ({ deliverables: add(s.deliverables, backup.deliverables) }));
  useTasksStore.setState((s) => ({ tasks: add(s.tasks, backup.tasks) }));
  useCodexStore.setState((s) => ({ pages: add(s.pages, backup.codexPages) }));
  useDocumentsStore.setState((s) => ({ documents: add(s.documents, backup.documents) }));
  useBillingStore.setState((s: any) => ({ milestones: add(s.milestones, backup.billingMilestones) }));
  useRisksStore.setState((s: any) => ({ risks: add(s.risks, backup.risks) }));
  useStakeholdersStore.setState((s) => ({ stakeholders: add(s.stakeholders, backup.stakeholders) }));
  useMomStore.setState((s) => ({ moms: add(s.moms, backup.moms) }));
  usePIIStore.setState((s) => ({ entries: add(s.entries, backup.piiEntries) }));
  useAcrStore.setState((s: any) => ({ acrs: add(s.acrs, backup.acrs) }));
  useAiStore.setState((s: any) => ({ sessions: add(s.sessions, backup.aiSessions) }));
  useAppStore.setState((s) => ({ projects: [...s.projects, backup.project] }));

  const count = [backup.deliverables, backup.tasks, backup.codexPages, backup.documents, backup.billingMilestones,
    backup.risks, backup.stakeholders, backup.moms].reduce((n, l) => n + (l || []).length, 0)
    + (backup.timeline?.revisions || []).reduce((n, r) => n + (r.activities || []).length, 0);
  return { ok: true, name: backup.project.name, count };
}
