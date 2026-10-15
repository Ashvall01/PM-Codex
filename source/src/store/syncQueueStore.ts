import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../utils/safeStorage';

export type ActionType = 'CREATE' | 'UPDATE' | 'DELETE';
export type JobStatus = 'PENDING' | 'SYNCING' | 'COMPLETED' | 'FAILED';

export interface SyncJob {
  id: string;
  timestamp: string;
  entityStore: string;
  entityId: string;
  actionType: ActionType;
  payload: any;
  status: JobStatus;
  retryCount: number;
  error?: string;
  // Used to merge overlapping jobs during compaction
}

interface SyncQueueState {
  jobs: SyncJob[];
  addJob: (entityStore: string, entityId: string, actionType: ActionType, payload: any) => void;
  updateJobStatus: (jobIds: string[], status: JobStatus, error?: string) => void;
  incrementRetry: (jobIds: string[]) => void;
  clearCompleted: () => void;
  retryFailed: (jobId?: string) => void;
  getPendingJobs: () => SyncJob[];
  compactJobs: () => void;
}

export const useSyncQueueStore = create<SyncQueueState>()(
  persist(
    (set, get) => ({
      jobs: [],

      addJob: (entityStore: string, entityId: string, actionType: ActionType, payload: any) => {
        set((state) => {
          // Instead of instantly adding, we could compact right here, but let's just add to array 
          // and let compactJobs() handle it or do on-the-fly compaction.
          
          // On-the-fly compaction for UPDATEs
          if (actionType === 'UPDATE') {
            const reversedIndex = [...state.jobs].reverse().findIndex(
              (j) => j.entityStore === entityStore && j.entityId === entityId && j.status === 'PENDING'
            );
            const lastJobIndex = reversedIndex !== -1 ? state.jobs.length - 1 - reversedIndex : -1;
            
            if (lastJobIndex !== -1) {
              const lastJob = state.jobs[lastJobIndex];
              if (lastJob.actionType === 'UPDATE') {
                // Merge payloads
                const updatedJobs = [...state.jobs];
                updatedJobs[lastJobIndex] = {
                  ...lastJob,
                  timestamp: new Date().toISOString(),
                  payload: { ...lastJob.payload, ...payload }
                };
                return { jobs: updatedJobs };
              } else if (lastJob.actionType === 'CREATE') {
                // Merge into the CREATE
                const updatedJobs = [...state.jobs];
                updatedJobs[lastJobIndex] = {
                  ...lastJob,
                  timestamp: new Date().toISOString(),
                  payload: { ...lastJob.payload, ...payload }
                };
                return { jobs: updatedJobs };
              }
            }
          }

          // If DELETE, remove any pending UPDATEs or CREATEs for this entity to save bandwidth
          if (actionType === 'DELETE') {
            const filteredJobs = state.jobs.filter(
              j => !(j.entityStore === entityStore && j.entityId === entityId && j.status === 'PENDING')
            );
            const newJob: SyncJob = {
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              entityStore,
              entityId,
              actionType,
              payload,
              status: 'PENDING',
              retryCount: 0,
            };
            let nextJobs = [...filteredJobs, newJob];
            if (nextJobs.length > 500) {
               const completedIds = nextJobs.filter(j => j.status === 'COMPLETED').map(j => j.id);
               const overage = nextJobs.length - 500;
               if (completedIds.length > overage) {
                   const toRemove = new Set(completedIds.slice(0, overage));
                   nextJobs = nextJobs.filter(j => !toRemove.has(j.id));
               }
            }
            return { jobs: nextJobs };
          }

          const newJob: SyncJob = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            entityStore,
            entityId,
            actionType,
            payload,
            status: 'PENDING',
            retryCount: 0,
          };
          
          let nextJobs = [...state.jobs, newJob];
          
          // Failsafe: if queue grows insanely large (> 500), automatically drop oldest COMPLETED
          if (nextJobs.length > 500) {
             const completedIds = nextJobs.filter(j => j.status === 'COMPLETED').map(j => j.id);
             const overage = nextJobs.length - 500;
             if (completedIds.length > overage) {
                 const toRemove = new Set(completedIds.slice(0, overage));
                 nextJobs = nextJobs.filter(j => !toRemove.has(j.id));
             }
          }
          
          return { jobs: nextJobs };
        });
      },

      updateJobStatus: (jobIds, status, error) => {
        set((state) => {
          let updatedJobs = state.jobs.map(job => {
            if (jobIds.includes(job.id)) {
              if (status === 'COMPLETED') {
                return { ...job, status, payload: null, error: undefined }; // Free up space
              }
              return { ...job, status, error: error || job.error };
            }
            return job;
          });
          
          // Limit total history space, keep all pending/syncing/failed, but limit completed
          const completedJobs = updatedJobs.filter(j => j.status === 'COMPLETED');
          if (completedJobs.length > 50) {
            // Keep only latest 50 completed
            const jobsToKeep = new Set([
              ...updatedJobs.filter(j => j.status !== 'COMPLETED').map(j => j.id),
              ...completedJobs.slice(-50).map(j => j.id)
            ]);
            updatedJobs = updatedJobs.filter(j => jobsToKeep.has(j.id));
          }
          
          return { jobs: updatedJobs };
        });
      },

      incrementRetry: (jobIds) => {
        set((state) => ({
          jobs: state.jobs.map(job =>
            jobIds.includes(job.id) ? { ...job, retryCount: job.retryCount + 1 } : job
          )
        }));
      },

      clearCompleted: () => {
        set((state) => ({
          jobs: state.jobs.filter(job => job.status !== 'COMPLETED')
        }));
      },

      retryFailed: (jobId) => {
        set((state) => ({
          jobs: state.jobs.map(job => {
            if (job.status === 'FAILED') {
              if (!jobId || job.id === jobId) {
                return { ...job, status: 'PENDING', retryCount: 0, error: undefined };
              }
            }
            return job;
          })
        }));
      },

      getPendingJobs: () => {
        return get().jobs.filter(job => job.status === 'PENDING');
      },

      compactJobs: () => {
        // Redundant if doing on-the-fly compaction, but kept for interface matching
      }
    }),
    {
      name: 'sync-queue-storage',
      storage: createSafeStorage(),
      partialize: (state) => ({
        ...state,
        // Only keep non-completed jobs, capped to 20 jobs
        jobs: (state.jobs || [])
          .filter((j) => j.status !== 'COMPLETED')
          .slice(-20)
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // One-time cleanup upon rehydration to recover from quota errors
          setTimeout(() => {
             const currentStore = useSyncQueueStore.getState();
             let hasChanges = false;
             let updatedJobs = currentStore.jobs.map(job => {
               if (job.status === 'COMPLETED' && job.payload !== null) {
                 hasChanges = true;
                 return { ...job, payload: null };
               }
               // A save that was under way when the tab closed never finished.
               // Left as SYNCING it would never be sent again.
               if (job.status === 'SYNCING') {
                 hasChanges = true;
                 return { ...job, status: 'PENDING' as const };
               }
               return job;
             });
             
             if (updatedJobs.length > 50) {
               const completedIds = updatedJobs.filter(j => j.status === 'COMPLETED').map(j => j.id);
               const overage = updatedJobs.length - 50;
               if (completedIds.length > overage) {
                   hasChanges = true;
                   const toRemove = new Set(completedIds.slice(0, overage));
                   updatedJobs = updatedJobs.filter(j => !toRemove.has(j.id));
               }
             }
             if (hasChanges) {
                 useSyncQueueStore.setState({ jobs: updatedJobs });
             }
          }, 100);
        }
      }
    }
  )
);
