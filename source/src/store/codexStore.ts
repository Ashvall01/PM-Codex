import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../utils/safeStorage';

export interface CodexPage {
  id: string;
  projectId: string;
  title: string;
  content: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CodexState {
  pages: CodexPage[];
  activePageId: string | null;
  addPage: (page: Omit<CodexPage, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updatePage: (id: string, updates: Partial<Omit<CodexPage, 'id' | 'projectId' | 'createdAt'>>) => void;
  deletePage: (id: string) => void;
  setActivePageId: (id: string | null) => void;
  getPagesForProject: (projectId: string) => CodexPage[];
}


export const useCodexStore = create<CodexState>()(
  persist(
    (set, get) => ({
      // Starts empty. It used to start with two sample pages for a project
      // 'proj_1' that does not exist, and they were written into every new
      // user's Sheet.
      pages: [],
      activePageId: null,

      addPage: (page) => {
        const newPage: CodexPage = {
          ...page,
          id: Math.random().toString(36).substring(2, 9),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          pages: [...state.pages, newPage],
          activePageId: newPage.id,
        }));
        return newPage.id;
      },

      updatePage: (id, updates) => {
        set((state) => ({
          pages: state.pages.map((p) => 
            p.id === id 
              ? { ...p, ...updates, updatedAt: new Date().toISOString() }
              : p
          )
        }));
      },

      deletePage: (id) => {
        set((state) => {
          // Also delete children recursively
          const getChildrenIds = (parentId: string, allPages: CodexPage[]): string[] => {
            const children = allPages.filter(p => p.parentId === parentId);
            return [
              ...children.map(c => c.id),
              ...children.flatMap(c => getChildrenIds(c.id, allPages))
            ];
          };

          const idsToDelete = new Set([id, ...getChildrenIds(id, state.pages)]);
          
          return {
            pages: state.pages.filter((p) => !idsToDelete.has(p.id)),
            activePageId: state.activePageId && idsToDelete.has(state.activePageId) ? null : state.activePageId,
          };
        });
      },

      setActivePageId: (id) => {
        set({ activePageId: id });
      },

      getPagesForProject: (projectId) => {
        return get().pages.filter(p => p.projectId === projectId);
      }
    }),
    {
      name: 'pm-codex-storage',
      storage: createSafeStorage(),
    }
  )
);
