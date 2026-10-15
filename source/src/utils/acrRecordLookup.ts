import type { ACRChange } from '../store/acrStore';
import { useTasksStore } from '../store/tasksStore';
import { useDeliverablesStore } from '../store/deliverablesStore';
import { useRisksStore } from '../store/risksStore';
import { useDocumentsStore } from '../store/documentsStore';
import { useStakeholdersStore } from '../store/stakeholdersStore';
import { useCodexStore } from '../store/codexStore';
import { useMomStore } from '../store/momStore';
import { useBillingStore } from '../store/billingStore';
import { useTimelineStore } from '../store/timelineStore';
import { useAppStore } from '../store/appStore';
import { acrTargetId, getAcrActionSpec } from './acrDiff';

/**
 * Find the record a proposed change is aimed at, whatever module it lives in.
 *
 * The review side panel needs this. It sits outside every module, so it has no
 * enriched list to read from, yet it must still show "what it was" next to
 * "what it becomes" — including for actions no module draws at all.
 *
 * Reads the stores directly rather than through hooks, because it is called
 * while rendering one card and must not subscribe the whole panel to eight
 * stores.
 */
export function findAcrTargetRecord(change: ACRChange): any | null {
  if (!change) return null;
  const spec = getAcrActionSpec(change.name);
  // The holiday list belongs to the project's timeline, not to one row, so it
  // has no id to look up. What it was is the list the active project holds.
  if (change.name === 'setTimelineHolidays') {
    const projectId = useAppStore.getState().activeProjectId;
    const timeline = (useTimelineStore.getState().projectTimelines || []).find((t) => t.projectId === projectId);
    return { id: projectId, title: 'Project holidays', holidays: timeline?.holidays || [] };
  }
  const id = acrTargetId(change);
  if (id === undefined || id === null || id === '') return null;
  const matches = (candidate: any) => String(candidate?.id) === String(id);

  switch (spec.module) {
    case 'tasks':
      return useTasksStore.getState().tasks.find(matches) || null;
    case 'deliverables':
      return useDeliverablesStore.getState().deliverables.find(matches) || null;
    case 'risks':
      return useRisksStore.getState().risks.find(matches) || null;
    case 'documents':
      return useDocumentsStore.getState().documents.find(matches) || null;
    case 'stakeholders':
      return useStakeholdersStore.getState().stakeholders.find(matches) || null;
    case 'codex':
      return useCodexStore.getState().pages.find(matches) || null;
    case 'mom':
      return useMomStore.getState().moms.find(matches) || null;
    case 'billing':
      return useBillingStore.getState().milestones.find(matches) || null;
    case 'timeline': {
      const timelines = useTimelineStore.getState().projectTimelines || [];
      for (const timeline of timelines) {
        for (const revision of timeline?.revisions || []) {
          const hit = (revision?.activities || []).find(matches);
          if (hit) return hit;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/** A short name for the record a change points at, for a heading. */
export function describeAcrTargetRecord(record: any): string {
  if (!record) return '';
  return (
    record.title ||
    record.description ||
    record.name ||
    record.activity ||
    record.riskDescription ||
    record.agreementName ||
    String(record.id || '')
  );
}
