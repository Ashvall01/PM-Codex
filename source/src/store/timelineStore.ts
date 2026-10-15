import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useDeliverablesStore } from './deliverablesStore';
import { useTasksStore } from './tasksStore';
import { createSafeStorage } from '../utils/safeStorage';
import { applySheetRules, mergeRowUpdate } from '../features/Timeline/sheet/rules';

export interface TimelineActivity {
  id: string;
  phase: string;
  activity: string;
  subActivity: string;
  weight: number;
  progress: number;
  status: string;
  owner: string;
  targetStartDate: string;
  targetCompletionDate: string;
  actualStartDate: string;
  actualCompletionDate: string;
  remarks: string;
  formulas?: Record<string, string>;
}

export interface Revision {
  id: string;
  name: string;
  createdAt: number;
  activities: TimelineActivity[];
}

export interface ProjectTimeline {
  projectId: string;
  activeRevisionId: string;
  revisions: Revision[];
  /** Days off (YYYY-MM-DD) that WORKDAY and NETWORKDAYS skip, besides weekends. */
  holidays?: string[];
}

interface TimelineState {
  projectTimelines: ProjectTimeline[];
  ganttCollapsedStates?: Record<string, Record<string, boolean>>;
  
  // Project-level
  createProjectTimeline: (projectId: string) => void;
  getProjectTimeline: (projectId: string) => ProjectTimeline | undefined;
  
  // Revision-level
  createRevision: (projectId: string, name: string, baseRevisionId?: string) => void;
  switchRevision: (projectId: string, revisionId: string) => void;
  deleteRevision: (projectId: string, revisionId: string) => void;
  
  // Activity-level
  addActivity: (projectId: string, revisionId: string, activity: Omit<TimelineActivity, 'id'>, insertAfterId?: string) => void;
  updateActivity: (projectId: string, revisionId: string, activityId: string, updates: Partial<TimelineActivity>) => void;
  deleteActivity: (projectId: string, revisionId: string, activityId: string) => void;
  reorderActivity: (projectId: string, revisionId: string, startIndex: number, endIndex: number) => void;
  setActivities: (projectId: string, revisionId: string, activities: TimelineActivity[]) => void;
  /** Work out the formulas again (TODAY() moves on). Writes only when an answer changed. */
  recalcRevision: (projectId: string, revisionId: string) => void;
  setHolidays: (projectId: string, holidays: string[]) => void;

  // Gantt expand/collapse persistence
  setGanttCollapsed: (projectId: string, groupKey: string, isCollapsed: boolean) => void;
  toggleGanttCollapse: (projectId: string, groupKey: string) => void;
  setAllGanttCollapsed: (projectId: string, states: Record<string, boolean>) => void;
}

/**
 * Every change to a revision's rows goes through here, so the sheet rules
 * (formulas, refs that follow their rows, recalculation) hold for the table,
 * the row editor and approved proposals alike. See sheet/rules.ts.
 */
function withRevision(
  timelines: ProjectTimeline[],
  projectId: string,
  revisionId: string,
  change: (activities: TimelineActivity[]) => TimelineActivity[],
): ProjectTimeline[] {
  return timelines.map((p) => {
    if (p.projectId !== projectId) return p;
    return {
      ...p,
      revisions: p.revisions.map((r) => {
        if (r.id !== revisionId) return r;
        const next = change(r.activities);
        if (next === r.activities) return r;
        return { ...r, activities: applySheetRules(r.activities, next, p.holidays) };
      }),
    };
  });
}

export const useTimelineStore = create<TimelineState>()(
  persist(
    (set, get) => ({
      projectTimelines: [],
      ganttCollapsedStates: {},
      
      createProjectTimeline: (projectId) => set((state) => {
        if (state.projectTimelines.some(p => p.projectId === projectId)) return state;
        
        const initialRevisionId = crypto.randomUUID();
        return {
          projectTimelines: [...state.projectTimelines, {
            projectId,
            activeRevisionId: initialRevisionId,
            revisions: [{
              id: initialRevisionId,
              name: 'Initial Plan',
              createdAt: Date.now(),
              activities: []
            }]
          }]
        };
      }),

      getProjectTimeline: (projectId) => {
        return get().projectTimelines.find(p => p.projectId === projectId);
      },
      
      createRevision: (projectId, name, baseRevisionId) => set((state) => {
        let migrationMapping: Record<string, string> = {};
        const newState = {
          projectTimelines: state.projectTimelines.map(p => {
            if (p.projectId !== projectId) return p;
            
            let baseActivities: TimelineActivity[] = [];
            let sourceActivities: TimelineActivity[] = [];

            if (baseRevisionId) {
              const baseRev = p.revisions.find(r => r.id === baseRevisionId);
              if (baseRev) sourceActivities = baseRev.activities;
            } else {
              const activeRev = p.revisions.find(r => r.id === p.activeRevisionId);
              if (activeRev) sourceActivities = activeRev.activities;
            }

            baseActivities = JSON.parse(JSON.stringify(sourceActivities)).map((a: TimelineActivity) => {
              const newId = crypto.randomUUID();
              migrationMapping[a.id] = newId;
              return { ...a, id: newId };
            });
            
            const newRevisionId = crypto.randomUUID();
            return {
              ...p,
              activeRevisionId: newRevisionId, // Auto-switch to new revision
              revisions: [
                ...p.revisions,
                {
                  id: newRevisionId,
                  name,
                  createdAt: Date.now(),
                  activities: baseActivities
                }
              ]
            }
          })
        };

        if (Object.keys(migrationMapping).length > 0) {
          useDeliverablesStore.getState().migrateLinks(migrationMapping);
          useTasksStore.getState().migrateLinks(migrationMapping);
        }

        return newState;
      }),
      
      switchRevision: (projectId, revisionId) => set((state) => ({
        projectTimelines: state.projectTimelines.map(p => 
          p.projectId === projectId 
            ? { ...p, activeRevisionId: revisionId }
            : p
        )
      })),
      
      deleteRevision: (projectId, revisionId) => set((state) => ({
        projectTimelines: state.projectTimelines.map(p => {
          if (p.projectId !== projectId) return p;
          
          const newRevisions = p.revisions.filter(r => r.id !== revisionId);
          // If deleted the active one, fallback to the last created one or empty
          let newActive = p.activeRevisionId;
          if (revisionId === p.activeRevisionId && newRevisions.length > 0) {
            newActive = newRevisions[newRevisions.length - 1].id;
          }
          
          return {
            ...p,
            activeRevisionId: newActive,
            revisions: newRevisions
          };
        })
      })),

      addActivity: (projectId, revisionId, activity, insertAfterId) => set((state) => ({
        projectTimelines: withRevision(state.projectTimelines, projectId, revisionId, (acts) => {
          const newActivity = { ...activity, id: crypto.randomUUID() } as TimelineActivity;
          if (insertAfterId) {
            const idx = acts.findIndex(a => a.id === insertAfterId);
            if (idx !== -1) {
              const next = [...acts];
              next.splice(idx + 1, 0, newActivity);
              return next;
            }
          }
          return [...acts, newActivity];
        }),
      })),

      updateActivity: (projectId, revisionId, activityId, updates) => set((state) => ({
        projectTimelines: withRevision(state.projectTimelines, projectId, revisionId, (acts) =>
          acts.map(a => a.id === activityId ? mergeRowUpdate(a, updates) : a)
        ),
      })),

      deleteActivity: (projectId, revisionId, activityId) => set((state) => ({
        projectTimelines: withRevision(state.projectTimelines, projectId, revisionId, (acts) =>
          acts.filter(a => a.id !== activityId)
        ),
      })),

      reorderActivity: (projectId, revisionId, startIndex, endIndex) => set((state) => ({
        projectTimelines: withRevision(state.projectTimelines, projectId, revisionId, (acts) => {
          const result = Array.from(acts);
          const [removed] = result.splice(startIndex, 1);
          if (!removed) return acts;
          result.splice(endIndex, 0, removed);
          return result;
        }),
      })),

      setActivities: (projectId, revisionId, activities) => set((state) => ({
        projectTimelines: withRevision(state.projectTimelines, projectId, revisionId, () => activities),
      })),

      recalcRevision: (projectId, revisionId) => {
        const p = get().projectTimelines.find(t => t.projectId === projectId);
        const r = p?.revisions.find(x => x.id === revisionId);
        if (!p || !r) return;
        const next = applySheetRules(r.activities, r.activities, p.holidays);
        if (next === r.activities) return;
        set((state) => ({
          projectTimelines: state.projectTimelines.map(t => t.projectId !== projectId ? t : {
            ...t,
            revisions: t.revisions.map(x => x.id === revisionId ? { ...x, activities: next } : x),
          }),
        }));
      },

      setHolidays: (projectId, holidays) => set((state) => ({
        projectTimelines: state.projectTimelines.map(p => {
          if (p.projectId !== projectId) return p;
          const clean = Array.from(new Set(holidays)).sort();
          return {
            ...p,
            holidays: clean,
            revisions: p.revisions.map(r => {
              const next = applySheetRules(r.activities, r.activities, clean);
              return next === r.activities ? r : { ...r, activities: next };
            }),
          };
        }),
      })),

      setGanttCollapsed: (projectId, groupKey, isCollapsed) => set((state) => ({
        ganttCollapsedStates: {
          ...state.ganttCollapsedStates,
          [projectId]: {
            ...(state.ganttCollapsedStates?.[projectId] || {}),
            [groupKey]: isCollapsed,
          }
        }
      })),

      toggleGanttCollapse: (projectId, groupKey) => set((state) => {
        const currentProjectStates = state.ganttCollapsedStates?.[projectId] || {};
        const isCurrentlyCollapsed = !!currentProjectStates[groupKey];
        return {
          ganttCollapsedStates: {
            ...state.ganttCollapsedStates,
            [projectId]: {
              ...currentProjectStates,
              [groupKey]: !isCurrentlyCollapsed,
            }
          }
        };
      }),

      setAllGanttCollapsed: (projectId, states) => set((state) => ({
        ganttCollapsedStates: {
          ...state.ganttCollapsedStates,
          [projectId]: states,
        }
      })),

    }),
    {
      name: 'pm-codex-timeline-storage',
      storage: createSafeStorage(),
    }
  )
);
