import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAppStore } from './appStore';
import { createSafeStorage } from '../utils/safeStorage';
import { Archivable, activeOnly, archivedOnly, archivePatch, restorePatch, byArchivedDesc } from '../utils/archive';

export interface Comment {
  id: string;
  text: string;
  timestamp: number;
  author: 'User' | 'Assistant';
  /** Set when the text was changed after it was written. Absent = never edited.
   *  `author` stays who first wrote it; `editedBy` is who changed it last. */
  editedAt?: number;
  editedBy?: 'User' | 'Assistant';
}

export type TaskStatus = 'Open' | 'In Progress' | 'On Hold' | 'Blocked' | 'Done' | 'Dropped';
export type TaskType = 'Action Item' | 'Issue';
export type Priority = 'Low' | 'Medium' | 'High';

export interface Task extends Archivable {
  id: string;
  projectId: string;
  type: TaskType;
  createdDate: number;
  description: string;
  status: TaskStatus;
  owner?: string;
  remarks?: string;
  estimatedResolutionDate?: string; // YYYY-MM-DD
  source?: string;
  priority?: Priority;
  isFlagged?: boolean;
  comments: Comment[];
  linkedActivityIds: string[]; // Links to timeline activity ids
  // isArchived and archivedDate come from Archivable. Both optional, so every
  // task already in storage and in the Google Sheet stays valid untouched.
}

interface TasksState {
  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'createdDate'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  toggleFlag: (id: string) => void;
  archiveTask: (id: string) => void;
  unarchiveTask: (id: string) => void;
  deleteTask: (id: string) => void;
  addComment: (taskId: string, text: string, author?: 'User' | 'Assistant') => void;
  deleteComment: (taskId: string, commentId: string) => void;
  editComment: (taskId: string, commentId: string, text: string, editor?: 'User' | 'Assistant') => void;
  /** Set the flag outright (toggleFlag flips it). The AI's flag/unflag use this. */
  setFlag: (id: string, flagged: boolean) => void;
  /** ACTIVE tasks only. Every AI path goes through this — see the note on the
   *  implementation below before you change what it returns. */
  getTasksByProject: (projectId: string) => Task[];
  /** The archive, newest archive first. */
  getArchivedTasksByProject: (projectId: string) => Task[];
  migrateLinks: (idMapping: Record<string, string>) => void;
}

export const useTasksStore = create<TasksState>()(
  persist(
    (set, get) => ({
      tasks: [],
      addTask: (task) => {
        const id = crypto.randomUUID();
        set((state) => ({
          tasks: [...state.tasks, { ...task, id, createdDate: Date.now() }]
        }));
        return id;
      },
      updateTask: (id, updates) => set((state) => ({
        tasks: state.tasks.map(t => t.id === id ? { ...t, ...updates } : t)
      })),
      toggleFlag: (id) => set((state) => ({
        tasks: state.tasks.map(t => t.id === id ? { ...t, isFlagged: !t.isFlagged } : t)
      })),
      setFlag: (id, flagged) => set((state) => ({
        tasks: state.tasks.map(t => t.id === id ? { ...t, isFlagged: flagged } : t)
      })),
      archiveTask: (id) => set((state) => ({
        tasks: state.tasks.map(t => t.id === id ? { ...t, ...archivePatch() } : t)
      })),
      unarchiveTask: (id) => set((state) => ({
        tasks: state.tasks.map(t => t.id === id ? { ...t, ...restorePatch() } : t)
      })),
      deleteTask: (id) => set((state) => {
        useAppStore.getState().trackDeletedRecordId(id);
        return { tasks: state.tasks.filter(t => t.id !== id) };
      }),
      addComment: (taskId, text, author = 'User') => set((state) => ({
        tasks: state.tasks.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            comments: [...(t.comments || []), { id: crypto.randomUUID(), text, timestamp: Date.now(), author }]
          };
        })
      })),
      deleteComment: (taskId, commentId) => set((state) => ({
        tasks: state.tasks.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            comments: (t.comments || []).filter(c => c.id !== commentId)
          };
        })
      })),
      editComment: (taskId, commentId, text, editor = 'User') => set((state) => ({
        tasks: state.tasks.map(t => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            comments: (t.comments || []).map(c =>
              c.id === commentId ? { ...c, text, editedAt: Date.now(), editedBy: editor } : c
            )
          };
        })
      })),
      /**
       * ACTIVE tasks only. Archived ones are not here.
       *
       * This one line is what hides the archive from both AI engines at once:
       * the project skeleton (aiContextEngine.ts), the Gemini query tool in the
       * same file, and Gemini's own sidebar context all read through here. If
       * you ever need every task including archived, read `tasks` directly and
       * say in a comment why — several callers do exactly that on purpose
       * (TaskTray, Mom, acrRecordLookup, bridgeClient.readItem), because an id
       * you are holding must always resolve.
       */
      getTasksByProject: (projectId) => {
        return activeOnly(get().tasks.filter(t => t.projectId === projectId));
      },
      getArchivedTasksByProject: (projectId) => {
        return archivedOnly(get().tasks.filter(t => t.projectId === projectId)).sort(byArchivedDesc);
      },
      migrateLinks: (idMapping) => set((state) => {
        return {
          tasks: state.tasks.map(t => {
            const currentIds = t.linkedActivityIds || [];
            const newIds = new Set(currentIds);
            currentIds.forEach(id => {
              if (idMapping[id]) {
                newIds.add(idMapping[id]);
              }
            });
            return { ...t, linkedActivityIds: Array.from(newIds) };
          })
        };
      })
    }),
    {
      name: 'pm-codex-tasks-storage',
      storage: createSafeStorage(),
    }
  )
);
