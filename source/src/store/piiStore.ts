import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { createSafeStorage } from '../utils/safeStorage';

export type PIIType = 'Name' | 'Organization' | 'Email' | 'Phone' | 'Location' | 'Application' | 'Other';

export interface PIIEntry {
  id: string;
  projectId: string;
  originalTerm: string;
  placeholder: string;
  type: PIIType;
  notes: string;
  variations?: string[];
}

interface PIIState {
  entries: PIIEntry[];
  addEntry: (projectId: string, entry?: Partial<PIIEntry>) => string;
  updateEntry: (id: string, updates: Partial<PIIEntry>) => void;
  deleteEntry: (id: string) => void;
  isPlaceholderDuplicate: (projectId: string, placeholder: string, currentId?: string) => boolean;
}

export const usePIIStore = create<PIIState>()(
  persist(
    (set, get) => ({
      entries: [],
      addEntry: (projectId, entry) => {
        const id = uuidv4();
        const newEntry: PIIEntry = {
          id,
          projectId,
          originalTerm: '',
          placeholder: '',
          type: 'Name',
          notes: '',
          variations: [],
          ...entry,
        };
        set((state) => ({ entries: [...state.entries, newEntry] }));
        return id;
      },
      updateEntry: (id, updates) =>
        set((state) => ({
          entries: state.entries.map((e) =>
              e.id === id ? { ...e, ...updates } : e
          ),
        })),
      deleteEntry: (id) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        })),
      isPlaceholderDuplicate: (projectId, placeholder, currentId) => {
        if (!placeholder || !placeholder.trim()) return false;
        const state = get();
        return state.entries.some(
          (e) =>
            e.projectId === projectId &&
            e.id !== currentId &&
            e.placeholder.trim().toLowerCase() === placeholder.trim().toLowerCase()
        );
      },
    }),
    {
      name: 'pm-codex-pii',
      storage: createSafeStorage(),
    }
  )
);
