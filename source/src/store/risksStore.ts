import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { createSafeStorage } from '../utils/safeStorage';
import { Archivable, activeOnly, archivedOnly, archivePatch, restorePatch, byArchivedDesc } from '../utils/archive';

export type ImpactLevel = 'Positive (Opportunity)' | 'Low' | 'Moderate' | 'High' | 'Critical' | 'Catastrophic';
export type ProbabilityLevel = 'Rare' | 'Low' | 'Moderate' | 'High' | 'Almost Certain' | 'Uncertain';
export type RiskValue = 'Lowest' | 'Low' | 'Medium' | 'High' | 'Highest' | 'Expert Judgment' | '';
export type ImpactArea = 'Cost' | 'Schedule' | 'Scope' | 'Quality' | 'Resource' | 'Reputation' | 'Legal' | 'Safety and Environmental' | 'Stakeholder';
export type RiskStatus = 'Open' | 'Under Mitigation' | 'Mitigated';

export interface ProjectRisk extends Archivable {
  id: string;
  projectId: string;
  riskId: string;
  riskDescription: string;
  projectSpecificDescription: string;
  ciaConfidentiality: string;
  ciaIntegrity: string;
  ciaAvailability: string;
  impactArea: ImpactArea | '';
  impactLevel: ImpactLevel | '';
  probability: ProbabilityLevel | '';
  postMitigationImpactLevel: ImpactLevel | '';
  postMitigationProbability: ProbabilityLevel | '';
  riskValue: RiskValue;
  owner: string;
  responsibility: string;
  mitigationStrategy: string;
  projectSpecificMitigationStrategy: string;
  status: RiskStatus;
  targetResolutionDate: string;
  remarks: string;
  controlAnnexA: string;
  // isArchived and archivedDate come from Archivable. Both optional, so every
  // risk already in storage and in the Google Sheet stays valid untouched.
}

export type RiskMatrix = Record<ImpactLevel, Record<ProbabilityLevel, RiskValue>>;

const DEFAULT_RISK_MATRIX: RiskMatrix = {
  'Positive (Opportunity)': {
    'Rare': 'Lowest', 'Low': 'Lowest', 'Moderate': 'Low', 'High': 'Low', 'Almost Certain': 'Low', 'Uncertain': 'Expert Judgment'
  },
  'Low': {
    'Rare': 'Lowest', 'Low': 'Lowest', 'Moderate': 'Low', 'High': 'Low', 'Almost Certain': 'Medium', 'Uncertain': 'Expert Judgment'
  },
  'Moderate': {
    'Rare': 'Lowest', 'Low': 'Low', 'Moderate': 'Medium', 'High': 'Medium', 'Almost Certain': 'High', 'Uncertain': 'Expert Judgment'
  },
  'High': {
    'Rare': 'Low', 'Low': 'Medium', 'Moderate': 'High', 'High': 'High', 'Almost Certain': 'Highest', 'Uncertain': 'Expert Judgment'
  },
  'Critical': {
    'Rare': 'Medium', 'Low': 'High', 'Moderate': 'High', 'High': 'Highest', 'Almost Certain': 'Highest', 'Uncertain': 'Expert Judgment'
  },
  'Catastrophic': {
    'Rare': 'High', 'Low': 'High', 'Moderate': 'Highest', 'High': 'Highest', 'Almost Certain': 'Highest', 'Uncertain': 'Expert Judgment'
  }
};

interface RisksState {
  risks: ProjectRisk[];
  riskMatrixConfig: RiskMatrix;
  addRisk: (projectId: string, risk?: Partial<ProjectRisk>) => string;
  updateRisk: (id: string, updates: Partial<ProjectRisk>) => void;
  deleteRisk: (id: string) => void;
  archiveRisk: (id: string) => void;
  unarchiveRisk: (id: string) => void;
  /** ACTIVE risks only. Gemini's sidebar context reads through here. */
  getProjectRisks: (projectId: string) => ProjectRisk[];
  /** The archive, newest archive first. */
  getArchivedRisksByProject: (projectId: string) => ProjectRisk[];
  updateRiskMatrix: (matrix: RiskMatrix) => void;
}

export const calculateRiskValue = (impact: ImpactLevel | '', probability: ProbabilityLevel | '', matrix: RiskMatrix): RiskValue => {
  if (!impact || !probability) return '';
  if (probability === 'Uncertain') return 'Expert Judgment';
  // `impact` and `probability` come from an ACR proposal (Claude's or Gemini's), which is
  // free-text at the type level — nothing stops a caller sending a value outside the
  // ImpactLevel/ProbabilityLevel union (e.g. "Medium" instead of "Moderate"). Before this
  // guard, matrix[impact] was undefined for any such value and matrix[impact][probability]
  // threw a TypeError *before* addRisk/updateRisk reached their set() call — the whole risk
  // silently failed to be added or updated, while the caller (acrExecutor.ts) reported success
  // because it never saw the throw. See PLAN.md section 17, item 1, 9 Sep entry.
  const impactRow = matrix[impact];
  if (!impactRow) return '';
  return impactRow[probability] ?? '';
};

export const useRisksStore = create<RisksState>()(
  persist(
    (set, get) => ({
      risks: [],
      riskMatrixConfig: DEFAULT_RISK_MATRIX,
      addRisk: (projectId, risk) => {
        const id = uuidv4();
        const newRisk: ProjectRisk = {
          id,
          projectId,
          riskId: '',
          riskDescription: '',
          projectSpecificDescription: '',
          ciaConfidentiality: '',
          ciaIntegrity: '',
          ciaAvailability: '',
          impactArea: '',
          impactLevel: '',
          probability: '',
          postMitigationImpactLevel: '',
          postMitigationProbability: '',
          riskValue: '',
          owner: '',
          responsibility: '',
          mitigationStrategy: '',
          projectSpecificMitigationStrategy: '',
          status: 'Open',
          targetResolutionDate: '',
          remarks: '',
          controlAnnexA: '',
          ...risk,
        };
        // Auto-calculate risk value if initialized with impact and probability
        const initialImpact = newRisk.status === 'Mitigated' ? newRisk.postMitigationImpactLevel : newRisk.impactLevel;
        const initialProb = newRisk.status === 'Mitigated' ? newRisk.postMitigationProbability : newRisk.probability;
        newRisk.riskValue = calculateRiskValue(initialImpact, initialProb, get().riskMatrixConfig);

        set((state) => ({ risks: [...state.risks, newRisk] }));
        return id;
      },
      updateRisk: (id, updates) =>
        set((state) => {
          return {
            risks: state.risks.map((risk) => {
              if (risk.id === id) {
                const updatedRisk = { ...risk, ...updates };
                // Recalculate risk value if impact, probability or status changed
                if (
                  'impactLevel' in updates ||
                  'probability' in updates ||
                  'postMitigationImpactLevel' in updates ||
                  'postMitigationProbability' in updates ||
                  'status' in updates
                ) {
                  const finalImpact = updatedRisk.status === 'Mitigated' ? updatedRisk.postMitigationImpactLevel : updatedRisk.impactLevel;
                  const finalProb = updatedRisk.status === 'Mitigated' ? updatedRisk.postMitigationProbability : updatedRisk.probability;
                  updatedRisk.riskValue = calculateRiskValue(finalImpact, finalProb, state.riskMatrixConfig);
                }
                return updatedRisk;
              }
              return risk;
            }),
          };
        }),
      deleteRisk: (id) =>
        set((state) => ({
          risks: state.risks.filter((r) => r.id !== id),
        })),
      // Archiving is a filing cabinet, not a lock: delete still works on an
      // archived risk. Neither action touches the grade or the value.
      archiveRisk: (id) =>
        set((state) => ({
          risks: state.risks.map((r) => (r.id === id ? { ...r, ...archivePatch() } : r)),
        })),
      unarchiveRisk: (id) =>
        set((state) => ({
          risks: state.risks.map((r) => (r.id === id ? { ...r, ...restorePatch() } : r)),
        })),
      /**
       * ACTIVE risks only — same contract as getTasksByProject. Callers that
       * hold an id and must always resolve it (the tray, acrRecordLookup,
       * bridgeClient.readItem) read `risks` directly on purpose.
       */
      getProjectRisks: (projectId) => {
        return activeOnly(get().risks.filter((r) => r.projectId === projectId));
      },
      getArchivedRisksByProject: (projectId) => {
        return archivedOnly(get().risks.filter((r) => r.projectId === projectId)).sort(byArchivedDesc);
      },
      updateRiskMatrix: (matrix) => {
        set((state) => {
          const newRisks = state.risks.map(r => {
            const currentImpact = r.status === 'Mitigated' ? r.postMitigationImpactLevel : r.impactLevel;
            const currentProb = r.status === 'Mitigated' ? r.postMitigationProbability : r.probability;
            return {
              ...r,
              riskValue: calculateRiskValue(currentImpact, currentProb, matrix)
            };
          });
          return { riskMatrixConfig: matrix, risks: newRisks };
        });
      }
    }),
    {
      name: 'pm-codex-risks',
      storage: createSafeStorage(),
    }
  )
);
