import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from './appStore';
import { v4 as uuidv4 } from 'uuid';
import { createSafeStorage } from '../utils/safeStorage';
import { formatMeetingContentToHtml } from '../utils/markdownToHtml';

import { TaskStatus } from './tasksStore';

export type MoMActionItemStatus = TaskStatus;

export interface MoMActionItem {
  id: string;
  description: string;
  assignee: string;
  status: MoMActionItemStatus;
  taskId?: string; // Links to task tracker

  /**
   * The rest of what a task needs, carried on the action item.
   *
   * An action item used to hold only a description, a person and a status. So
   * the task made from it landed bare, and the user had to come back and ask
   * for a priority and a date in a second round. These are optional: an action
   * item without them behaves exactly as before.
   */
  type?: 'Action Item' | 'Issue';
  priority?: 'Low' | 'Medium' | 'High';
  estimatedResolutionDate?: string; // YYYY-MM-DD
  remarks?: string;
  linkedActivityIds?: string[];
}

export const normalizeMoMActionItemStatus = (status?: string): MoMActionItemStatus => {
  if (!status) return 'Open';
  if (status.toLowerCase() === 'closed') return 'Done';
  // Every task status. 'On Hold' was missing until 24 Sep 2026, so an item on
  // hold was quietly turned back to Open on every reload and on every push.
  const validStatuses: MoMActionItemStatus[] = ['Open', 'In Progress', 'On Hold', 'Blocked', 'Done', 'Dropped'];
  const matched = validStatuses.find(s => s.toLowerCase() === status.toLowerCase());
  return matched || 'Open';
};

export interface MoM {
  id: string;
  projectId: string;
  title: string;
  date: string;
  time: string;
  location: string;
  attendees: string;
  agenda: string;
  notes: string;
  keyDecisions: string;
  actionItems: MoMActionItem[];
}

interface MomState {
  moms: MoM[];
  activeMomId: string | null;
  addMom: (projectId: string) => string;
  importMom: (projectId: string, momData: Partial<MoM>) => string;
  importMoms: (projectId: string, momsData: Partial<MoM>[]) => string[];
  updateMom: (id: string, updates: Partial<MoM>) => void;
  deleteMom: (id: string) => void;
  setActiveMomId: (id: string | null) => void;
  addActionItem: (momId: string) => void;
  updateActionItem: (momId: string, actionId: string, updates: Partial<MoMActionItem>) => void;
  deleteActionItem: (momId: string, actionId: string) => void;
}

export const useMomStore = create<MomState>()(
  persist(
    (set) => ({
      moms: [],
      activeMomId: null,
      addMom: (projectId) => {
        const id = uuidv4();
        const date = new Date().toISOString().split('T')[0];
        set((state) => ({
          moms: [
            ...state.moms,
            {
              id,
              projectId,
              title: 'New Meeting',
              date,
              time: '10:00',
              location: '',
              attendees: '',
              agenda: '',
              notes: '',
              keyDecisions: '',
              actionItems: [],
            },
          ],
          activeMomId: id,
        }));
        return id;
      },
      importMom: (projectId, momData) => {
        const id = momData.id && typeof momData.id === 'string' && momData.id.trim() ? momData.id : uuidv4();
        const date = momData.date || new Date().toISOString().split('T')[0];
        const newMom: MoM = {
          id,
          projectId,
          title: momData.title || 'Imported Meeting',
          date,
          time: momData.time || '10:00',
          location: momData.location || '',
          attendees: momData.attendees || '',
          agenda: formatMeetingContentToHtml(momData.agenda || ''),
          notes: formatMeetingContentToHtml(momData.notes || ''),
          keyDecisions: formatMeetingContentToHtml(momData.keyDecisions || ''),
          // The task fields have to survive this copy. Without them the task
          // built from an action item on sign-off lands bare, which is the
          // whole reason they were added to the action item in the first place.
          actionItems: (momData.actionItems || []).map((ai: any) => ({
            id: ai.id || uuidv4(),
            description: ai.description || '',
            assignee: ai.assignee || '',
            status: normalizeMoMActionItemStatus(ai.status),
            taskId: ai.taskId,
            type: ai.type,
            priority: ai.priority,
            estimatedResolutionDate: ai.estimatedResolutionDate || ai.dueDate,
            remarks: ai.remarks,
            linkedActivityIds: ai.linkedActivityIds,
          })),
        };
        set((state) => ({
          moms: [...state.moms, newMom],
          activeMomId: id,
        }));
        return id;
      },
      importMoms: (projectId, momsData) => {
        const newMoms: MoM[] = momsData.map((momData) => {
          const id = momData.id && typeof momData.id === 'string' && momData.id.trim() ? momData.id : uuidv4();
          const date = momData.date || new Date().toISOString().split('T')[0];
          return {
            id,
            projectId,
            title: momData.title || 'Imported Meeting',
            date,
            time: momData.time || '10:00',
            location: momData.location || '',
            attendees: momData.attendees || '',
            agenda: formatMeetingContentToHtml(momData.agenda || ''),
            notes: formatMeetingContentToHtml(momData.notes || ''),
            keyDecisions: formatMeetingContentToHtml(momData.keyDecisions || ''),
            // The same task fields importMom keeps, so a bulk import does not
            // land bare either.
            actionItems: (momData.actionItems || []).map((ai: any) => ({
              id: ai.id || uuidv4(),
              description: ai.description || '',
              assignee: ai.assignee || '',
              status: normalizeMoMActionItemStatus(ai.status),
              taskId: ai.taskId,
              type: ai.type,
              priority: ai.priority,
              estimatedResolutionDate: ai.estimatedResolutionDate || ai.dueDate,
              remarks: ai.remarks,
              linkedActivityIds: ai.linkedActivityIds,
            })),
          };
        });
        set((state) => ({
          moms: [...state.moms, ...newMoms],
          activeMomId: newMoms.length > 0 ? newMoms[0].id : state.activeMomId,
        }));
        return newMoms.map((m) => m.id);
      },
      updateMom: (id, updates) =>
        set((state) => ({
          moms: state.moms.map((mom) => {
            if (mom.id !== id) return mom;
            const updated = { ...mom, ...updates };
            if (updates.agenda !== undefined) updated.agenda = formatMeetingContentToHtml(updates.agenda);
            if (updates.notes !== undefined) updated.notes = formatMeetingContentToHtml(updates.notes);
            if (updates.keyDecisions !== undefined) updated.keyDecisions = formatMeetingContentToHtml(updates.keyDecisions);
            return updated;
          }),
        })),
      deleteMom: (id) => set((state) => {
        useAppStore.getState().trackDeletedRecordId(id);
        return {
          moms: state.moms.filter((m) => m.id !== id),
          activeMomId: state.activeMomId === id ? null : state.activeMomId,
        };
      }),
      setActiveMomId: (id) => set({ activeMomId: id }),
      addActionItem: (momId) => {
        set((state) => ({
          moms: state.moms.map((mom) => {
            if (mom.id === momId) {
              return {
                ...mom,
                actionItems: [
                  ...mom.actionItems,
                  {
                    id: uuidv4(),
                    description: '',
                    assignee: '',
                    status: 'Open',
                  },
                ],
              };
            }
            return mom;
          }),
        }));
      },
      updateActionItem: (momId, actionId, updates) => {
        set((state) => ({
          moms: state.moms.map((mom) => {
            if (mom.id === momId) {
              return {
                ...mom,
                actionItems: mom.actionItems.map((ai) =>
                  ai.id === actionId ? { ...ai, ...updates } : ai
                ),
              };
            }
            return mom;
          }),
        }));
      },
      deleteActionItem: (momId, actionId) => set((state) => {
        useAppStore.getState().trackDeletedRecordId(actionId);
        return {
          moms: state.moms.map((mom) => {
            if (mom.id === momId) {
              return {
                ...mom,
                actionItems: mom.actionItems.filter((ai) => ai.id !== actionId),
              };
            }
            return mom;
          }),
        };
      }),
    }),
    {
      name: 'pm-codex-moms',
      storage: createSafeStorage(),
      onRehydrateStorage: () => (state) => {
        if (state && state.moms) {
          state.moms = state.moms.map((mom) => ({
            ...mom,
            actionItems: (mom.actionItems || []).map((ai) => ({
              ...ai,
              status: normalizeMoMActionItemStatus(ai.status),
            })),
          }));
        }
      },
    }
  )
);
