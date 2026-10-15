import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { createSafeStorage } from '../utils/safeStorage';

export type Level = 'High' | 'Medium' | 'Low';

export interface Stakeholder {
  id: string;
  projectId: string;
  name: string;
  role: string;
  projectRole: string;
  orgRole: string;
  organization: string;
  email: string;
  phone: string;
  power: Level | string;
  interest: Level | string;
  knowledge: Level | string;
  interPersonalRelations: string;
  notes: string;
  reportsToId?: string;
  projectReportsToId?: string;
  reportsToIds?: string[];
  projectReportsToIds?: string[];
}

interface StakeholdersState {
  stakeholders: Stakeholder[];
  addStakeholder: (projectId: string, stakeholder?: Partial<Stakeholder>) => string;
  updateStakeholder: (id: string, updates: Partial<Stakeholder>) => void;
  deleteStakeholder: (id: string) => void;
}

export const useStakeholdersStore = create<StakeholdersState>()(
  persist(
    (set) => ({
      stakeholders: [],
      addStakeholder: (projectId, stakeholder) => {
        const id = uuidv4();
        const initialProjectRole = stakeholder?.projectRole || stakeholder?.role || '';
        const newStakeholder: Stakeholder = {
          id,
          projectId,
          name: 'New Stakeholder',
          role: initialProjectRole,
          projectRole: initialProjectRole,
          orgRole: '',
          organization: '',
          email: '',
          phone: '',
          power: 'Medium',
          interest: 'Medium',
          knowledge: 'Medium',
          interPersonalRelations: '',
          notes: '',
          reportsToIds: [],
          projectReportsToIds: [],
          ...stakeholder,
        };
        set((state) => ({ stakeholders: [...state.stakeholders, newStakeholder] }));
        return id;
      },
      updateStakeholder: (id, updates) =>
        set((set_state) => {
          return {
            stakeholders: set_state.stakeholders.map((s) => {
              if (s.id === id) {
                const merged = { ...s, ...updates };
                if (updates.projectRole !== undefined) {
                  merged.role = updates.projectRole;
                } else if (updates.role !== undefined) {
                  merged.projectRole = updates.role;
                }
                return merged;
              }
              return s;
            }),
          };
        }),
      deleteStakeholder: (id) =>
        set((state) => ({
          stakeholders: state.stakeholders.filter((s) => s.id !== id),
        })),
    }),
    {
      name: 'pm-codex-stakeholders',
      storage: createSafeStorage(),
    }
  )
);
