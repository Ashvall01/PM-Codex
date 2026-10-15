import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../utils/safeStorage';

export type TemplateCategory = 'General' | 'Timeline' | 'Risks' | 'MoM' | 'Deliverables' | 'Billing' | 'Tasks';

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  category: TemplateCategory;
  prompt: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PromptTemplatesState {
  templates: PromptTemplate[];
  addTemplate: (template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTemplate: (id: string, updates: Partial<Omit<PromptTemplate, 'id' | 'createdAt'>>) => void;
  deleteTemplate: (id: string) => void;
  duplicateTemplate: (id: string) => string;
  resetToDefaults: () => void;
}

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'tpl-timeline-audit',
    title: 'Timeline Health & Delay Audit',
    category: 'Timeline',
    description: 'Scan all timeline phases, identify delayed WIP activities, and calculate progress variance.',
    prompt: 'Please perform a comprehensive timeline health and delay audit for the active project. Identify all activities that are behind schedule, calculate overall phase completion rates, and recommend specific schedule compression or fast-tracking actions.',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-risk-review',
    title: 'Critical Risk & Exposure Review',
    category: 'Risks',
    description: 'Analyze high-exposure risks and verify mitigation strategy completeness.',
    prompt: 'Review all high and critical risks logged for this project. Analyze our current mitigation strategies and contingency plans, point out any unmitigated exposure areas, and suggest proactive risk mitigation measures.',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-exec-status',
    title: 'Executive Status Summary',
    category: 'General',
    description: 'Draft a high-level executive briefing on milestones, accomplishments, and blockers.',
    prompt: 'Generate a concise executive weekly status report for key stakeholders. Include key milestones achieved this period, active deliverables in flight, top friction items/blockers, and next week\'s primary priorities.',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-mom-extract',
    title: 'Draft MOM & Action Items',
    category: 'MoM',
    description: 'Process meeting notes, summarize key decisions, and propose structured MOM action items.',
    prompt: 'I want to record minutes from our recent meeting. Please help me summarize the main discussion topics, list all key decisions made, and draft actionable items with assignees and target resolution dates to import into the MOM module.',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-deliverables-audit',
    title: 'Deliverables Readiness & DoD Audit',
    category: 'Deliverables',
    description: 'Audit in-progress deliverables against their Definition of Done criteria.',
    prompt: 'Audit our active deliverables and their Definition of Done (DoD) criteria. Identify which deliverables are approaching their due date, check if acceptance criteria are fully met, and recommend signoff readiness.',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-tasks-friction',
    title: 'Open Friction & Task Prioritization',
    category: 'Tasks',
    description: 'Triage and prioritize friction items, bottlenecks, and open blockers.',
    prompt: 'Analyze all open tasks and friction items across the project. Prioritize them based on urgency and impact on the critical path, and suggest clear resolution owners and target dates.',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tpl-billing-reconciliation',
    title: 'Billing & Milestone Reconciliation',
    category: 'Billing',
    description: 'Verify payment milestone statuses, pending claims, and invoice timelines.',
    prompt: 'Review the project\'s billing schedule and financial milestones. Check payment statuses, compare invoiced vs remaining contract sums, and highlight any upcoming milestone claim deadlines.',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export const usePromptTemplatesStore = create<PromptTemplatesState>()(
  persist(
    (set, get) => ({
      templates: DEFAULT_PROMPT_TEMPLATES,

      addTemplate: (templateData) => {
        const id = `tpl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const now = new Date().toISOString();
        const newTemplate: PromptTemplate = {
          ...templateData,
          id,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          templates: [newTemplate, ...state.templates],
        }));
        return id;
      },

      updateTemplate: (id, updates) => {
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...updates,
                  updatedAt: new Date().toISOString(),
                }
              : t
          ),
        }));
      },

      deleteTemplate: (id) => {
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        }));
      },

      duplicateTemplate: (id) => {
        const existing = get().templates.find((t) => t.id === id);
        if (!existing) return '';
        const newId = `tpl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const now = new Date().toISOString();
        const duplicate: PromptTemplate = {
          ...existing,
          id: newId,
          title: `${existing.title} (Copy)`,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          templates: [duplicate, ...state.templates],
        }));
        return newId;
      },

      resetToDefaults: () => {
        set({ templates: DEFAULT_PROMPT_TEMPLATES });
      },
    }),
    {
      name: 'pm-prompt-templates',
      storage: createSafeStorage(),
    }
  )
);
