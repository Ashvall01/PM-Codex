import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { createSafeStorage } from '../utils/safeStorage';

export type Status = 'Pending' | 'In Progress' | 'Done';

export interface BillingMilestone {
  id: string;
  projectId: string;
  phase: string;
  agreementName: string;
  agreementNo: string;
  agreementLink: string;
  term: string;
  percentage: number;
  valueNet: number;
  valueVat: number;
  workStatus: Status | string;
  prerequisiteDocumentStatus: Status | string;
  documentLink: string;
  invoicingStatus: Status | string;
  invoiceLink: string;
  invoiceDate: string;
  remarks: string;
}

interface BillingState {
  milestones: BillingMilestone[];
  currency: string;
  isEnabled: boolean;
  addMilestone: (projectId: string, milestone?: Partial<BillingMilestone>) => string;
  updateMilestone: (id: string, updates: Partial<BillingMilestone>) => void;
  deleteMilestone: (id: string) => void;
  setCurrency: (currency: string) => void;
  setIsEnabled: (enabled: boolean) => void;
}

export const useBillingStore = create<BillingState>()(
  persist(
    (set) => ({
      milestones: [],
      currency: 'USD',
      isEnabled: true,
      addMilestone: (projectId, milestone) => {
        const id = uuidv4();
        const newMilestone: BillingMilestone = {
          id,
          projectId,
          phase: '',
          agreementName: 'New Agreement',
          agreementNo: '',
          agreementLink: '',
          term: '',
          percentage: 0,
          valueNet: 0,
          valueVat: 0,
          workStatus: 'Pending',
          prerequisiteDocumentStatus: 'Pending',
          documentLink: '',
          invoicingStatus: 'Pending',
          invoiceLink: '',
          invoiceDate: '',
          remarks: '',
          ...milestone,
        };
        set((state) => ({ milestones: [...state.milestones, newMilestone] }));
        return id;
      },
      updateMilestone: (id, updates) =>
        set((state) => ({
          milestones: state.milestones.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          ),
        })),
      deleteMilestone: (id) =>
        set((state) => ({
          milestones: state.milestones.filter((m) => m.id !== id),
        })),
      setCurrency: (currency) => set({ currency }),
      setIsEnabled: (enabled) => set({ isEnabled: enabled }),
    }),
    {
      name: 'pm-codex-billing',
      storage: createSafeStorage(),
    }
  )
);
