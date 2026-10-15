import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

export type DeliverableStatus = 'Pending' | 'In Progress' | 'On Hold' | 'In Review' | 'Signed Off' | 'Dropped' | 'Blocked';
export type Priority = 'Low' | 'Medium' | 'High';

export interface Deliverable extends Archivable {
  id: string;
  projectId: string;
  title: string;
  description: string;
  definitionOfDone: string;
  status: DeliverableStatus;
  dueDate: string; // YYYY-MM-DD
  category?: string;
  priority?: Priority;
  owner?: string;
  parentId?: string | null;
  hasNestedSpace?: boolean;
  comments: Comment[];
  linkedActivityIds?: string[]; // Links to timeline activity ids
  // isArchived and archivedDate come from Archivable. Both optional, so every
  // deliverable already in storage and in the Google Sheet stays valid untouched.
}

interface DeliverablesState {
  deliverables: Deliverable[];
  addDeliverable: (deliverable: Omit<Deliverable, 'id'>) => void;
  updateDeliverable: (id: string, updates: Partial<Deliverable>) => void;
  deleteDeliverable: (id: string) => void;
  createNestedSpace: (deliverableId: string) => void;
  addComment: (deliverableId: string, text: string, author?: 'User' | 'Assistant') => void;
  deleteComment: (deliverableId: string, commentId: string) => void;
  editComment: (deliverableId: string, commentId: string, text: string, editor?: 'User' | 'Assistant') => void;
  archiveDeliverable: (id: string) => void;
  unarchiveDeliverable: (id: string) => void;
  /** ACTIVE deliverables only. Every AI path goes through this. */
  getDeliverablesByProject: (projectId: string) => Deliverable[];
  /** The archive, newest first, SUBTREE ROOTS only. */
  getArchivedDeliverablesByProject: (projectId: string) => Deliverable[];
  /** A deliverable's id plus every descendant. The unit archiving works on. */
  getSubtreeIds: (id: string) => string[];
  migrateLinks: (idMapping: Record<string, string>) => void;
}

/**
 * A deliverable's id plus every descendant beneath it.
 *
 * Deliverables is a DRILL-DOWN tree: the screen shows one level at a time,
 * filtered on parentId, and the only route to a child is through its parent.
 * Archiving a parent and leaving its children active would strand them — still
 * active, still counted, and on no screen that can be reached. Tasks, being a
 * flat list, could never produce that.
 *
 * So archive and restore act on the whole subtree. deleteDeliverable already
 * walked descendants this way; this is that same walk lifted out, so there is
 * one of it rather than three. PLAN.md 21.2.
 */
const subtreeIds = (rows: Deliverable[], rootId: string): Set<string> => {
  const ids = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    rows.forEach((d) => {
      if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
        ids.add(d.id);
        added = true;
      }
    });
  }
  return ids;
};

export const useDeliverablesStore = create<DeliverablesState>()(
  persist(
    (set, get) => ({
      deliverables: [],
      addDeliverable: (deliverable) => set((state) => ({
        deliverables: [
          ...state.deliverables,
          {
            ...deliverable,
            id: crypto.randomUUID(),
            owner: deliverable.owner || '',
            parentId: deliverable.parentId || null,
            hasNestedSpace: deliverable.hasNestedSpace || false
          }
        ]
      })),
      updateDeliverable: (id, updates) => set((state) => ({
        deliverables: state.deliverables.map(d => d.id === id ? { ...d, ...updates } : d)
      })),
      createNestedSpace: (deliverableId) => set((state) => ({
        deliverables: state.deliverables.map(d => d.id === deliverableId ? { ...d, hasNestedSpace: true } : d)
      })),
      deleteDeliverable: (id) => set((state) => {
        // The same descendant walk archiving uses — one copy of it, in subtreeIds.
        const idsToDelete = subtreeIds(state.deliverables, id);
        return {
          deliverables: state.deliverables.filter(d => !idsToDelete.has(d.id))
        };
      }),
      /**
       * Archive the whole subtree, sharing ONE archivedDate so the group can be
       * restored as the group it was. archivePatch() is called once for that
       * reason — calling it per record would scatter the timestamps by a few
       * milliseconds and break the "archived together" reading.
       */
      archiveDeliverable: (id) => set((state) => {
        const ids = subtreeIds(state.deliverables, id);
        const patch = archivePatch();
        return {
          deliverables: state.deliverables.map(d => ids.has(d.id) ? { ...d, ...patch } : d)
        };
      }),
      unarchiveDeliverable: (id) => set((state) => {
        const ids = subtreeIds(state.deliverables, id);
        return {
          deliverables: state.deliverables.map(d => ids.has(d.id) ? { ...d, ...restorePatch() } : d)
        };
      }),
      addComment: (deliverableId, text, author = 'User') => set((state) => ({
        deliverables: state.deliverables.map(d => {
          if (d.id !== deliverableId) return d;
          return {
            ...d,
            comments: [...(d.comments || []), { id: crypto.randomUUID(), text, timestamp: Date.now(), author }]
          };
        })
      })),
      deleteComment: (deliverableId, commentId) => set((state) => ({
        deliverables: state.deliverables.map(d => {
          if (d.id !== deliverableId) return d;
          return {
            ...d,
            comments: (d.comments || []).filter(c => c.id !== commentId)
          };
        })
      })),
      editComment: (deliverableId, commentId, text, editor = 'User') => set((state) => ({
        deliverables: state.deliverables.map(d => {
          if (d.id !== deliverableId) return d;
          return {
            ...d,
            comments: (d.comments || []).map(c =>
              c.id === commentId ? { ...c, text, editedAt: Date.now(), editedBy: editor } : c
            )
          };
        })
      })),
      /**
       * ACTIVE deliverables only. Archived ones are not here.
       *
       * This one line hides the archive from both AI engines at once: the
       * project skeleton, the Gemini query tool and the Gantt chart all read
       * through here. Callers that must resolve ANY id read `deliverables`
       * directly and say why — acrRecordLookup, bridgeClient.readItem, the
       * Deliverables tray and the Sheet sync all do that on purpose.
       */
      getDeliverablesByProject: (projectId) => {
        return activeOnly(get().deliverables.filter(d => d.projectId === projectId));
      },
      /**
       * The archive, newest first, SUBTREE ROOTS only.
       *
       * A record whose parent is also archived is not a row of its own; it is
       * inside its root. Listing it separately would make the archive repeat
       * the drill-down, which is the stranding problem of 21.2 in reverse.
       */
      getArchivedDeliverablesByProject: (projectId) => {
        const ofProject = get().deliverables.filter(d => d.projectId === projectId);
        const archived = archivedOnly(ofProject);
        const archivedIds = new Set(archived.map(d => d.id));
        return archived
          .filter(d => !d.parentId || !archivedIds.has(d.parentId))
          .sort(byArchivedDesc);
      },
      getSubtreeIds: (id) => Array.from(subtreeIds(get().deliverables, id)),
      migrateLinks: (idMapping) => set((state) => {
        return {
          deliverables: state.deliverables.map(d => {
            // @ts-ignore - Handle legacy `linkedActivityId` migration
            const legacyId = d.linkedActivityId;
            const currentIds = d.linkedActivityIds || (legacyId ? [legacyId] : []);
            const newIds = new Set(currentIds);
            currentIds.forEach(id => {
              if (idMapping[id]) {
                newIds.add(idMapping[id]);
              }
            });
            // Cleanup legacy field
            const updatedD: any = { ...d, linkedActivityIds: Array.from(newIds) };
            delete updatedD.linkedActivityId;
            return updatedD;
          })
        };
      })
    }),
    {
      name: 'pm-codex-deliverables-storage',
      storage: createSafeStorage(),
    }
  )
);
