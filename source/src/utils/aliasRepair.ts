/**
 * Puts real ids back where an alias was saved by mistake.
 *
 * The assistants see aliases (CDX4, ACT12, STK3), never real ids. Until
 * 24 Sep 2026 Claude's proposals translated only a record's own `id` back to
 * the real one, so any OTHER reference — a page's folder, a linked activity, a
 * manager — was saved as the alias itself. A Codex page filed under "CDX4"
 * pointed at no folder and never appeared on the Codex screen.
 *
 * This runs once per load and changes a reference only when all three hold:
 * the value is not a real id of that kind, it IS a known alias, and the alias
 * points at a record that exists. Anything else is left exactly as it is.
 * Returns a line per repair, for the console.
 */
import { useIdAliasStore } from '../store/idAliasStore';
import { useCodexStore } from '../store/codexStore';
import { useDeliverablesStore } from '../store/deliverablesStore';
import { useTasksStore } from '../store/tasksStore';
import { useStakeholdersStore } from '../store/stakeholdersStore';
import { useTimelineStore } from '../store/timelineStore';

export function repairAliasReferences(): string[] {
  const aliasToReal = useIdAliasStore.getState().aliasToReal || {};
  const repairs: string[] = [];

  const fixOne = (value: any, exists: Set<string>): any => {
    if (typeof value !== 'string' || !value || exists.has(value)) return value;
    const real = aliasToReal[value];
    return real && exists.has(real) ? real : value;
  };
  const fixList = (list: any, exists: Set<string>): any => {
    if (!Array.isArray(list)) return list;
    const next = list.map((v) => fixOne(v, exists));
    return next.some((v, i) => v !== list[i]) ? next : list;
  };

  // Codex: a page's folder.
  const pages = useCodexStore.getState().pages;
  const pageIds = new Set(pages.map((p) => p.id));
  pages.forEach((p) => {
    const parentId = fixOne(p.parentId, pageIds);
    if (parentId !== p.parentId) {
      useCodexStore.getState().updatePage(p.id, { parentId });
      repairs.push(`Codex page "${p.title}": folder ${p.parentId} -> ${parentId}`);
    }
  });

  // Timeline activity ids, from every baseline, for the links below.
  const activityIds = new Set<string>();
  useTimelineStore.getState().projectTimelines.forEach((t) =>
    t.revisions.forEach((r) => r.activities.forEach((a) => activityIds.add(a.id))));

  // Deliverables: parent and linked activities.
  const deliverables = useDeliverablesStore.getState().deliverables;
  const deliverableIds = new Set(deliverables.map((d) => d.id));
  deliverables.forEach((d) => {
    const parentId = fixOne(d.parentId, deliverableIds);
    const linkedActivityIds = fixList(d.linkedActivityIds, activityIds);
    if (parentId !== d.parentId || linkedActivityIds !== d.linkedActivityIds) {
      useDeliverablesStore.getState().updateDeliverable(d.id, { parentId, linkedActivityIds });
      repairs.push(`Deliverable "${d.title}": references repaired`);
    }
  });

  // Tasks: linked activities.
  useTasksStore.getState().tasks.forEach((t) => {
    const linkedActivityIds = fixList(t.linkedActivityIds, activityIds);
    if (linkedActivityIds !== t.linkedActivityIds) {
      useTasksStore.getState().updateTask(t.id, { linkedActivityIds });
      repairs.push(`Task "${t.description}": linked activities repaired`);
    }
  });

  // Stakeholders: managers, both hierarchies.
  const stakeholders = useStakeholdersStore.getState().stakeholders;
  const stakeholderIds = new Set(stakeholders.map((s) => s.id));
  stakeholders.forEach((s) => {
    const updates: Record<string, any> = {};
    const reportsToId = fixOne(s.reportsToId, stakeholderIds);
    const projectReportsToId = fixOne(s.projectReportsToId, stakeholderIds);
    const reportsToIds = fixList(s.reportsToIds, stakeholderIds);
    const projectReportsToIds = fixList(s.projectReportsToIds, stakeholderIds);
    if (reportsToId !== s.reportsToId) updates.reportsToId = reportsToId;
    if (projectReportsToId !== s.projectReportsToId) updates.projectReportsToId = projectReportsToId;
    if (reportsToIds !== s.reportsToIds) updates.reportsToIds = reportsToIds;
    if (projectReportsToIds !== s.projectReportsToIds) updates.projectReportsToIds = projectReportsToIds;
    if (Object.keys(updates).length) {
      useStakeholdersStore.getState().updateStakeholder(s.id, updates);
      repairs.push(`Stakeholder "${s.name}": managers repaired`);
    }
  });

  return repairs;
}
