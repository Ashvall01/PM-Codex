import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAiStore } from './aiStore';
import { createSafeStorage } from '../utils/safeStorage';
import { isUserEdited, withUserEdit, findMergeTarget, editedLineMessage } from '../utils/acrUserEdits';

export interface ACRChange {
  id: string;
  callId?: string;
  approved: boolean;
  name: string;
  args: any;
  changeTitle: string;
  /**
   * The arguments as the assistant proposed them, kept the first time the user
   * edits the line in the app. With `userEditedAt`, this is how a line the
   * user has made their own is told apart. See utils/acrUserEdits.ts.
   */
  proposedArgs?: any;
  /** When the user last edited this line's arguments. Absent: never edited. */
  userEditedAt?: string;
}

/**
 * A proposed call the store would not apply because it reached for a line the
 * user edited. Read with `takeAcrMergeRefusals()` right after `createAcr`.
 */
export interface AcrMergeRefusal {
  callId?: string;
  name: string;
  changeId: string;
  message: string;
}

// Kept out of the persisted state on purpose: it describes the last call only.
let lastMergeRefusals: AcrMergeRefusal[] = [];

/**
 * What the last `createAcr` refused, and why. Emptied by reading.
 *
 * `createAcr` returns only a request id, and both callers already depend on
 * that, so the refusals travel alongside instead. Gemini's sidebar turns each
 * one into a "refused" answer for the call it belongs to; the bridge checks
 * the same rule before it calls, so for Claude this is a second line of
 * defence rather than the first.
 */
export function takeAcrMergeRefusals(): AcrMergeRefusal[] {
  const out = lastMergeRefusals;
  lastMergeRefusals = [];
  return out;
}

/**
 * Which engine proposed the change request.
 *
 * 'gemini' is the in-app sidebar. 'claude' is the local bridge, which sits
 * outside the browser and has no chat session of its own. Records written
 * before this field existed have no origin; read them as 'gemini'.
 */
export type ACROrigin = 'gemini' | 'claude';

export interface AssistantChangeRequest {
  id: string;
  sessionId: string;
  projectId: string;
  origin?: ACROrigin;
  status: 'pending' | 'approved' | 'rejected';
  changes: ACRChange[];
  createdAt: string;
  updatedAt?: string;
}

/** First words of a long value, for a one-line title. */
function snippet(value: any, max = 60): string {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}\u2026`;
}

export function getChangeTitle(name: string, args: any): string {
  if (args && args.changeTitle) return args.changeTitle;
  
  const title = args && args.title ? args.title : (args && args.name ? args.name : '');
  const phase = args && args.phase ? args.phase : '';
  const activity = args && args.activity ? args.activity : '';
  const group = args && args.category ? args.category : '';

  switch (name) {
    case 'addTimelineRow':
      return `Create Activity: ${activity || args?.subActivity || 'New row'} (${phase || 'General'})`;
    case 'updateTimelineRow':
      return `Update Activity: ${activity || 'Row ' + (args?.id || '')}`;
    case 'deleteTimelineRow':
      return `Delete Activity: ${args?.id ? 'Row ' + args.id : 'Timeline item'}`;
    case 'reorderTimelineRow':
      return `Reorder Activities`;
    case 'createTimelineBaseline':
      return `Create Baseline: ${args?.name || 'New Baseline'}`;
    case 'setTimelineHolidays': {
      const count = Array.isArray(args?.holidays) ? args.holidays.length : 0;
      return `Set project holidays (${count} day${count === 1 ? '' : 's'})`;
    }
    case 'createCodexFolder':
      return `Create Codex Folder: "${title || 'New Folder'}"`;
    case 'createCodexPage':
      return `Create Codex Page: "${title || 'Untitled'}"`;
    case 'updateCodexPage':
      return `Update Codex Page: "${title || 'Page Details'}"`;
    case 'addDeliverable':
      return `Create Deliverable: "${title || 'Untitled'}"`;
    case 'updateDeliverable':
      return `Update Deliverable: "${title || 'Deliverable Details'}"`;
    case 'deleteDeliverable':
      return `Delete Deliverable: Row ${args?.id || ''}`;
    case 'addDeliverableComment':
      // The text is the whole content of this change. A title that leaves it
      // out gives the user nothing to sign off on.
      return `Comment on Deliverable${args?.id || args?.deliverableId ? ` ${args.id || args.deliverableId}` : ''}: "${snippet(args?.text)}"`;
    case 'addTask':
      return `Create Task: "${title || 'Untitled'}"`;
    case 'updateTask':
      return `Update Task: "${title || 'Task Details'}"`;
    case 'deleteTask':
      return `Delete Task: Row ${args?.id || ''}`;
    case 'addTaskComment':
      return `Comment on Task${args?.id || args?.taskId ? ` ${args.id || args.taskId}` : ''}: "${snippet(args?.text)}"`;
    case 'editTaskComment':
      return `Edit Comment on Task${args?.id || args?.taskId ? ` ${args.id || args.taskId}` : ''}: "${snippet(args?.text)}"`;
    case 'editDeliverableComment':
      return `Edit Comment on Deliverable${args?.id || args?.deliverableId ? ` ${args.id || args.deliverableId}` : ''}: "${snippet(args?.text)}"`;
    case 'flagTask':
      return `Flag Task: Row ${args?.id || ''}`;
    case 'unflagTask':
      return `Remove Task Flag: Row ${args?.id || ''}`;
    case 'archiveProjectRisk':
      return `Archive Risk: Row ${args?.id || ''}`;
    case 'unarchiveProjectRisk':
      return `Restore Risk: Row ${args?.id || ''}`;
    case 'addProjectRisk':
      return `Create Risk: "${title || 'New Risk'}"`;
    case 'updateProjectRisk':
      return `Update Risk: "${title || 'Risk Details'}"`;
    case 'deleteProjectRisk':
      return `Delete Risk: Row ${args?.id || ''}`;
    case 'addStakeholder':
      return `Create Stakeholder: "${args?.name || 'New Stakeholder'}"`;
    case 'updateStakeholder':
      return `Update Stakeholder: "${args?.name || 'Stakeholder Details'}"`;
    case 'deleteStakeholder':
      return `Delete Stakeholder: Row ${args?.id || ''}`;
    case 'updateMilestone':
      return `Update Billing Milestone: ${args?.title || 'Milestone ' + (args?.id || '')}`;
    case 'createMoM':
    case 'createMom':
      return `Create MoM: "${title || 'Meeting Minutes'}"`;
    case 'updateMom':
      return `Update MoM: "${title || 'MoM Record ' + (args?.id || '')}"`;
    case 'deleteMom':
      return `Delete MoM: Row ${args?.id || ''}`;
    case 'updateMeetingDraft':
      return `Propose Meeting Outcome: "${title || 'Meeting Draft'}"`;
    default:
      return `${name.replace(/^[a-z]/, (m) => m.toUpperCase())} action`;
  }
}

interface AcrState {
  acrs: AssistantChangeRequest[];
  activeAcrId: string | null;
  activeAcrChangeId: string | null;
  attachedAcrChange: ACRChange | null;
  isMouseOverSidebar: boolean;
  /**
   * Hide the chat half of the assistant pane while a review is open.
   *
   * A review is not a conversation. A request from Claude belongs to no chat at
   * all, so putting the chat beside it wastes most of the pane on something the
   * user is not reading. This lets the review panel stand on its own.
   *
   * Only ever acted on while a request is actually open, so a value left over
   * in storage cannot hide the chat for good.
   */
  isChatHiddenDuringReview: boolean;
  
  createAcr: (projectId: string, sessionId: string, rawChanges: { callId?: string; name: string; args: any }[], origin?: ACROrigin) => string | null;
  updateAcrChangeApproval: (acrId: string, changeId: string, approved: boolean) => void;
  updateAcrChange: (acrId: string, changeId: string, updates: Partial<ACRChange>) => void;
  updateAllChangesApproval: (acrId: string, approved: boolean) => void;
  setAcrStatus: (acrId: string, status: 'pending' | 'approved' | 'rejected') => void;
  setActiveAcrId: (id: string | null) => void;
  setActiveAcrChangeId: (id: string | null) => void;
  setAttachedAcrChange: (change: ACRChange | null) => void;
  getPendingAcrForSession: (sessionId: string) => AssistantChangeRequest | undefined;
  deleteAcr: (acrId: string) => void;
  setIsMouseOverSidebar: (over: boolean) => void;
  setIsChatHiddenDuringReview: (hidden: boolean) => void;
}

export const useAcrStore = create<AcrState>()(
  persist(
    (set, get) => ({
      acrs: [],
      activeAcrId: null,
      activeAcrChangeId: null,
      attachedAcrChange: null,
      isMouseOverSidebar: false,
      isChatHiddenDuringReview: false,

      createAcr: (projectId, sessionId, rawChanges, origin = 'gemini') => {
        const acrs = get().acrs;
        lastMergeRefusals = [];
        // Origin is part of the match: a Claude proposal must never be folded
        // into a request Gemini is still holding open, even if the two ever
        // share a session id.
        const existingAcrIdx = acrs.findIndex(
          acr => acr.sessionId === sessionId && (acr.origin || 'gemini') === origin && acr.status === 'pending'
        );

        if (existingAcrIdx !== -1) {
          const existingAcr = acrs[existingAcrIdx];
          const updatedChanges = [...existingAcr.changes];

          rawChanges.forEach(rc => {
            if (rc.name === 'discardPendingACRChange') {
               const changeIdToDiscard = rc.args.changeId;
               const idx = updatedChanges.findIndex(c => c.id === changeIdToDiscard);
               if (idx !== -1) {
                  // A line the user edited is theirs. Withdrawing it deletes
                  // their work for good, so it takes their say-so, passed as
                  // discardUserEdit. See utils/acrUserEdits.ts.
                  if (isUserEdited(updatedChanges[idx]) && rc.args?.discardUserEdit !== true) {
                    lastMergeRefusals.push({
                      callId: rc.callId,
                      name: rc.name,
                      changeId: updatedChanges[idx].id,
                      message: editedLineMessage(updatedChanges[idx], 'withdraw'),
                    });
                    return;
                  }
                  updatedChanges.splice(idx, 1);
               }
               return; // Processing done for this action
            }

            // If the action targets a specific row/item ID, attempt to merge with an existing change for that ID
            const mergeTarget = findMergeTarget(updatedChanges, rc.name, rc.args);
            if (mergeTarget) {
              const existingChangeIdx = updatedChanges.indexOf(mergeTarget);

              // Merging lays the assistant's fields over the line. Over a line
              // the user edited, that silently overwrites what they typed, so
              // it is refused and the line is left exactly as they made it.
              if (isUserEdited(mergeTarget)) {
                lastMergeRefusals.push({
                  callId: rc.callId,
                  name: rc.name,
                  changeId: mergeTarget.id,
                  message: editedLineMessage(mergeTarget, 'merge'),
                });
                return;
              }

              // Merge the new tool arguments into the existing proposed change.
              // The line is the assistant's again from here: an edit the user
              // had typed back to the original left a stale copy of the
              // original behind, and it must not make this merge look like
              // the user's work.
              const { proposedArgs: _p, userEditedAt: _u, ...existingChange } = updatedChanges[existingChangeIdx];
              updatedChanges[existingChangeIdx] = {
                ...existingChange,
                args: { ...existingChange.args, ...rc.args },
                changeTitle: getChangeTitle(rc.name, { ...existingChange.args, ...rc.args })
              };
              return;
            }

            // Otherwise, append as a new change
            updatedChanges.push({
              id: Math.random().toString(36).substring(2, 9),
              callId: rc.callId,
              approved: true,
              name: rc.name,
              args: rc.args,
              changeTitle: getChangeTitle(rc.name, rc.args),
            });
          });

          const newAcrs = [...acrs];
          
          if (updatedChanges.length === 0) {
            newAcrs.splice(existingAcrIdx, 1);
            set((state) => ({
              acrs: newAcrs,
              activeAcrId: state.activeAcrId === existingAcr.id ? null : state.activeAcrId,
              activeAcrChangeId: state.activeAcrId === existingAcr.id ? null : state.activeAcrChangeId,
            }));
            return null;
          }

          newAcrs[existingAcrIdx] = {
            ...existingAcr,
            origin: existingAcr.origin || origin,
            changes: updatedChanges,
            createdAt: new Date().toISOString()
          };

          set({
            acrs: newAcrs,
            activeAcrId: existingAcr.id,
          });
          return existingAcr.id;
        }

        const newChanges = rawChanges.filter(rc => rc.name !== 'discardPendingACRChange').map((rc) => ({
          id: Math.random().toString(36).substring(2, 9),
          callId: rc.callId,
          approved: true, // Default to true so user can uncheck
          name: rc.name,
          args: rc.args,
          changeTitle: getChangeTitle(rc.name, rc.args),
        }));

        if (newChanges.length === 0) {
          return null;
        }

        const newId = Math.random().toString(36).substring(2, 9);
        const newAcr: AssistantChangeRequest = {
          id: newId,
          sessionId,
          projectId,
          origin,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          changes: newChanges,
        };

        set({
          acrs: [newAcr, ...acrs],
          activeAcrId: newId, // Automatically focus/review the newly created ACR
        });
        return newId;
      },

      updateAcrChangeApproval: (acrId, changeId, approved) => {
        set((state) => ({
          acrs: state.acrs.map((acr) =>
            acr.id === acrId
              ? {
                  ...acr,
                  updatedAt: new Date().toISOString(),
                  changes: acr.changes.map((c) =>
                    c.id === changeId ? { ...c, approved } : c
                  ),
                }
              : acr
          ),
        }));
      },

      updateAcrChange: (acrId, changeId, updates) => {
        set((state) => ({
          acrs: state.acrs.map((acr) =>
            acr.id === acrId
              ? {
                  ...acr,
                  updatedAt: new Date().toISOString(),
                  // New arguments are the user's edit: keep the assistant's
                  // original beside them and mark the line. Anything else
                  // (a title, the tick box) is not an edit.
                  changes: acr.changes.map((c) => {
                    if (c.id !== changeId) return c;
                    if (!updates.args) return { ...c, ...updates };
                    const { args, ...rest } = updates;
                    return withUserEdit({ ...c, ...rest }, args);
                  }),
                }
              : acr
          ),
        }));

        if (updates.args) {
          const state = get();
          const acr = state.acrs.find(a => a.id === acrId);
          if (acr) {
            const change = acr.changes.find(c => c.id === changeId);
            if (change && change.callId) {
              const aiStore = useAiStore.getState();
              const session = aiStore.sessions.find(s => s.id === acr.sessionId);
              if (session) {
                const newMessages = session.messages.map((m: any) => {
                  if (m.role === 'model' && m.parts) {
                    let partModified = false;
                    const newParts = m.parts.map((p: any) => {
                      if (p.functionCall && p.functionCall.id === change.callId) {
                        partModified = true;
                        return {
                          ...p,
                          functionCall: {
                            ...p.functionCall,
                            args: { ...p.functionCall.args, ...updates.args },
                          }
                        };
                      }
                      return p;
                    });
                    if (partModified) {
                      return { ...m, parts: newParts };
                    }
                  }
                  return m;
                });
                aiStore.updateSessionMessages(acr.sessionId, newMessages);
              }
            }
          }
        }
      },

      updateAllChangesApproval: (acrId, approved) => {
        set((state) => ({
          acrs: state.acrs.map((acr) =>
            acr.id === acrId
              ? {
                  ...acr,
                  updatedAt: new Date().toISOString(),
                  changes: acr.changes.map((c) => ({ ...c, approved })),
                }
              : acr
          ),
        }));
      },

      setAcrStatus: (acrId, status) => {
        set((state) => ({
          acrs: state.acrs.map((acr) =>
            acr.id === acrId ? { ...acr, status, updatedAt: new Date().toISOString() } : acr
          ),
          activeAcrId: state.activeAcrId === acrId && status !== 'pending' ? null : state.activeAcrId,
          activeAcrChangeId: state.activeAcrId === acrId && status !== 'pending' ? null : state.activeAcrChangeId,
        }));
      },

      setActiveAcrId: (id) => {
        set({ activeAcrId: id });
        if (!id) {
          set({ activeAcrChangeId: null });
          // Every way a review ends — the X button, sign off, reject, all
          // three in AISidebar.tsx, plus the bridge's own discard path in
          // bridgeClient.ts — calls this with null. One place to undo the
          // sidebar auto-open from ClaudeProposalBar, instead of three (or
          // more, if another entry point is added later). A Gemini-origin
          // review never sets the flag in the first place (its chat was
          // already open), so this is a no-op for that path.
          const aiStore = useAiStore.getState();
          if (aiStore.sidebarOpenedByAcr) {
            aiStore.setSidebarOpen(false);
            aiStore.setSidebarOpenedByAcr(false);
          }
        }
      },

      setActiveAcrChangeId: (id) => {
        set({ activeAcrChangeId: id });
      },

      setAttachedAcrChange: (change) => {
        set({ attachedAcrChange: change });
      },

      getPendingAcrForSession: (sessionId) => {
        return get().acrs.find((acr) => acr.sessionId === sessionId && acr.status === 'pending');
      },

      deleteAcr: (acrId) => {
        set((state) => ({
          acrs: state.acrs.filter((acr) => acr.id !== acrId),
          activeAcrId: state.activeAcrId === acrId ? null : state.activeAcrId,
          activeAcrChangeId: state.activeAcrId === acrId ? null : state.activeAcrChangeId,
        }));
      },
      setIsMouseOverSidebar: (over) => {
        set({ isMouseOverSidebar: over });
      },
      setIsChatHiddenDuringReview: (hidden) => {
        set({ isChatHiddenDuringReview: hidden });
      },
    }),
    {
      name: 'pm-codex-acr-storage',
      storage: createSafeStorage(),
    }
  )
);
