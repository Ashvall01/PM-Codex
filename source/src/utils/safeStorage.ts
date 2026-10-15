import { StateStorage, createJSONStorage } from 'zustand/middleware';

/**
 * Checks whether an error is a browser storage quota exceeded error.
 */
export function isQuotaExceededError(err: any): boolean {
  if (!err) return false;
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014) ||
    err.name === 'QuotaExceededError' ||
    (typeof err.message === 'string' && /quota/i.test(err.message))
  );
}

/**
 * Compacts AI session messages for storage to save massive space.
 * Strips thought traces, base64 payloads, and limits stored messages per session.
 */
function compactAiStoragePayload(rawJson: string): string | null {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || !parsed.state || !Array.isArray(parsed.state.sessions)) {
      return null;
    }

    const sessions = parsed.state.sessions;
    // Keep only the most recent 10 sessions in localStorage
    const sorted = [...sessions].sort(
      (a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    );
    const trimmedSessions = sorted.slice(0, 10).map((session: any) => {
      const msgs = Array.isArray(session.messages) ? session.messages : [];
      // Keep only latest 20 messages per session
      const recentMsgs = msgs.slice(-20).map((m: any) => {
        if (!m || !Array.isArray(m.parts)) return m;
        return {
          ...m,
          parts: m.parts
            .filter((p: any) => !p.thought) // Strip thoughts from storage
            .map((p: any) => {
              if (p.inlineData && p.inlineData.data) {
                return { ...p, inlineData: { ...p.inlineData, data: '' } };
              }
              // Truncate ultra-long function responses in storage if any
              if (p.functionResponse && typeof p.functionResponse.response === 'object') {
                const respStr = JSON.stringify(p.functionResponse.response);
                if (respStr.length > 5000) {
                  return {
                    ...p,
                    functionResponse: {
                      ...p.functionResponse,
                      response: { _truncated: true, summary: respStr.slice(0, 200) + '...' }
                    }
                  };
                }
              }
              return p;
            })
        };
      });

      return {
        ...session,
        messages: recentMsgs
      };
    });

    parsed.state.sessions = trimmedSessions;
    return JSON.stringify(parsed);
  } catch (e) {
    return null;
  }
}

/**
 * Compacts sync queue jobs for storage.
 */
function compactSyncQueuePayload(rawJson: string): string | null {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || !parsed.state || !Array.isArray(parsed.state.jobs)) {
      return null;
    }
    // Only keep non-completed or latest 10 jobs
    const activeJobs = parsed.state.jobs.filter((j: any) => j.status !== 'COMPLETED');
    parsed.state.jobs = activeJobs.slice(-10);
    return JSON.stringify(parsed);
  } catch (e) {
    return null;
  }
}

/**
 * Emergency purge of expendable items across localStorage when space is exhausted.
 */
export function purgeExpendableStorage(): void {
  try {
    // 1. Clear completed sync queue jobs
    const syncQueueRaw = localStorage.getItem('sync-queue-storage');
    if (syncQueueRaw) {
      const compacted = compactSyncQueuePayload(syncQueueRaw);
      if (compacted) {
        try {
          localStorage.setItem('sync-queue-storage', compacted);
        } catch {
          localStorage.removeItem('sync-queue-storage');
        }
      }
    }

    // 2. Remove temporary meeting state scratchpads
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('pm-codex-meeting-state-')) {
        localStorage.removeItem(key);
      }
    }

    // 3. Compact AI sessions
    const aiStorageRaw = localStorage.getItem('pm-ai-storage');
    if (aiStorageRaw) {
      const compacted = compactAiStoragePayload(aiStorageRaw);
      if (compacted) {
        try {
          localStorage.setItem('pm-ai-storage', compacted);
        } catch {
          // If still failing, drop ai storage from localStorage (in-memory & GAS remain source of truth)
          localStorage.removeItem('pm-ai-storage');
        }
      }
    }
  } catch (e) {
    console.warn('[SafeStorage] Failed during emergency storage purge:', e);
  }
}

/**
 * Proactive maintenance run on startup and before heavy sync loads.
 */
export function runStorageMaintenance(): void {
  try {
    // Clean up sync queue
    const syncQueueRaw = localStorage.getItem('sync-queue-storage');
    if (syncQueueRaw) {
      const compacted = compactSyncQueuePayload(syncQueueRaw);
      if (compacted && compacted.length < syncQueueRaw.length) {
        localStorage.setItem('sync-queue-storage', compacted);
      }
    }

    // Clean up AI storage
    const aiStorageRaw = localStorage.getItem('pm-ai-storage');
    if (aiStorageRaw && aiStorageRaw.length > 500000) {
      // If over 500KB, compact it
      const compacted = compactAiStoragePayload(aiStorageRaw);
      if (compacted) {
        localStorage.setItem('pm-ai-storage', compacted);
      }
    }
  } catch (e) {
    console.warn('[SafeStorage] Storage maintenance encountered error:', e);
  }
}

export interface SafeStateStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

/**
 * Creates a safe state storage object for Zustand persist middleware that
 * never crashes the application on QuotaExceededError and automatically
 * handles compaction and emergency eviction.
 */
export const safeStateStorage: SafeStateStorage = {
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name);
    } catch (e) {
      console.warn(`[SafeStorage] Error reading key "${name}" from localStorage:`, e);
      return null;
    }
  },

  setItem: (name: string, value: string): void => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      if (isQuotaExceededError(e)) {
        console.warn(`[SafeStorage] Quota exceeded while saving "${name}". Initiating eviction.`);
        
        // 1. Try emergency purge
        purgeExpendableStorage();

        // 2. Try saving again
        try {
          localStorage.setItem(name, value);
          return;
        } catch (e2) {
          // 3. Try compacting this specific item if applicable
          let compacted: string | null = null;
          if (name === 'pm-ai-storage') {
            compacted = compactAiStoragePayload(value);
          } else if (name === 'sync-queue-storage') {
            compacted = compactSyncQueuePayload(value);
          }

          if (compacted) {
            try {
              localStorage.setItem(name, compacted);
              return;
            } catch (e3) {
              console.warn(`[SafeStorage] Failed to save compacted "${name}":`, e3);
            }
          }

          // 4. If all else fails, swallow the error so in-memory state and GAS sync keep working
          console.warn(`[SafeStorage] Could not persist "${name}" to localStorage due to quota limits. State remains in-memory.`);
        }
      } else {
        console.warn(`[SafeStorage] Error writing key "${name}" to localStorage:`, e);
      }
    }
  },

  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name);
    } catch (e) {
      console.warn(`[SafeStorage] Error removing key "${name}" from localStorage:`, e);
    }
  }
};

/**
 * Convenient helper for Zustand stores: creates JSON storage using the safeStateStorage.
 */
export const createSafeStorage = () => createJSONStorage(() => safeStateStorage);
