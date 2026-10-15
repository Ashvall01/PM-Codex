import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../utils/safeStorage';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}

interface AppState {
  gasUrl: string | null;
  setGasUrl: (url: string) => void;
  isSetupComplete: () => boolean;
  
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  lastSyncedAt: number | null;
  syncErrorMessage: string | null;
  setSyncStatus: (status: 'idle' | 'syncing' | 'synced' | 'error', errorMsg?: string | null) => void;
  setLastSyncedAt: (time: number | null) => void;
  /** A save was held back because it would remove many rows from the Sheet. Not saved in the browser. */
  syncHeldBack: string | null;
  setSyncHeldBack: (summary: string | null) => void;

  projects: Project[];
  activeProjectId: string | null;
  addProject: (project: Omit<Project, 'id' | 'createdAt'>) => string;
  setActiveProject: (id: string | null) => void;
  getActiveProject: () => Project | undefined;

      timelineColumnWidths: Record<string, number>;
      setTimelineColumnWidth: (columnId: string, width: number) => void;
      deletedRecordIds: string[];
      trackDeletedRecordId: (id: string) => void;
      /**
       * Projects deleted in this browser. A load from the Sheet skips their
       * records, so a load that lands before the save cannot bring them back.
       * Restoring a backup takes the id off again.
       */
      deletedProjectIds: string[];
      markProjectDeleted: (id: string) => void;
      unmarkProjectDeleted: (id: string) => void;
    }
    
    export const useAppStore = create<AppState>()(
      persist(
        (set, get) => ({
      // Initially try to get from vite env vars, fallback to null
      gasUrl: import.meta.env.VITE_GAS_URL || null,
      setGasUrl: (url) => set({ gasUrl: url }),
      isSetupComplete: () => {
        const url = get().gasUrl;
        return typeof url === 'string' && url.length > 0;
      },
      
      syncStatus: 'idle',
      lastSyncedAt: null,
      syncErrorMessage: null,
      setSyncStatus: (status, errorMsg = null) => set({ syncStatus: status, syncErrorMessage: errorMsg }),
      setLastSyncedAt: (time) => set({ lastSyncedAt: time }),
      syncHeldBack: null,
      setSyncHeldBack: (summary) => set({ syncHeldBack: summary }),

      projects: [],
      activeProjectId: null,
      addProject: (projectData) => {
        const newProject: Project = {
          ...projectData,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
        };
        set((state) => ({
          projects: [...state.projects, newProject],
          activeProjectId: newProject.id, // Auto select newly created project
        }));
        return newProject.id;
      },
      setActiveProject: (id) => set({ activeProjectId: id }),
      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        return projects.find((p) => p.id === activeProjectId);
      },

      timelineColumnWidths: {},
      setTimelineColumnWidth: (columnId, width) => set((state) => ({
        timelineColumnWidths: {
          ...state.timelineColumnWidths,
          [columnId]: width
        }
      })),
      deletedRecordIds: [],
      trackDeletedRecordId: (id) => set((state) => ({
        deletedRecordIds: Array.from(new Set([...state.deletedRecordIds, id].slice(-1000))) // keep last 1000
      })),
      deletedProjectIds: [],
      markProjectDeleted: (id) => set((state) => ({
        deletedProjectIds: Array.from(new Set([...(state.deletedProjectIds || []), id])),
      })),
      unmarkProjectDeleted: (id) => set((state) => ({
        deletedProjectIds: (state.deletedProjectIds || []).filter((x) => x !== id),
      })),
    }),
    {
      name: 'pm-app-storage',
      storage: createSafeStorage(),
      partialize: (state) => ({
        gasUrl: state.gasUrl,
        activeProjectId: state.activeProjectId,
        timelineColumnWidths: state.timelineColumnWidths,
        lastSyncedAt: state.lastSyncedAt,
        deletedRecordIds: state.deletedRecordIds,
        deletedProjectIds: state.deletedProjectIds,
        projects: state.projects,
      }),
    }
  )
);
