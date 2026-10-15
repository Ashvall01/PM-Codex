import { useAppStore } from '../store/appStore';
import { useTimelineStore } from '../store/timelineStore';
import { useDeliverablesStore } from '../store/deliverablesStore';
import { useTasksStore } from '../store/tasksStore';
import { useCodexStore } from '../store/codexStore';
import { useDocumentsStore } from '../store/documentsStore';
import { useBillingStore } from '../store/billingStore';
import { useRisksStore, calculateRiskValue } from '../store/risksStore';
import { useStakeholdersStore } from '../store/stakeholdersStore';
import { useMomStore } from '../store/momStore';
import { usePIIStore } from '../store/piiStore';
import { useAiStore } from '../store/aiStore';
import { useAcrStore } from '../store/acrStore';
import { runStorageMaintenance } from '../utils/safeStorage';

let consecutivePollingErrors = 0;

// Helper to recursively scrub non-printable ASCII/Unicode control characters
// or invisible spacing characters that crash JSON parsers or cells.
function sanitizePayload(val: any): any {
  if (typeof val === 'string') {
    // eslint-disable-next-line no-control-regex
    let cleanStr = val
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
      return "'" + cleanStr;
    }
    // A plain "10:00" would be turned into a time value by Sheets and come back
    // as "1899-12-30T…". The apostrophe keeps it text, as for dates above.
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleanStr)) {
      return "'" + cleanStr;
    }
    return cleanStr;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizePayload);
  }
  if (typeof val === 'object' && val !== null) {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      cleaned[k] = sanitizePayload(v);
    }
    return cleaned;
  }
  return val;
}

/**
 * Throw unless the Apps Script answered that the write went through.
 *
 * The script answers every POST with JSON: {status:'success'} or
 * {status:'error', message}. A Google sign-in or error page comes back as HTML
 * (the web app is not deployed for "Anyone", or the deployment is gone).
 */
async function confirmWrite(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`The Google Sheet refused the save (HTTP ${response.status}).`);
  }
  let text = '';
  try {
    text = (await response.text()).trim();
  } catch {
    return; // The status said OK and the body could not be read: nothing more to go on.
  }
  if (/^<(!DOCTYPE|html|DOCTYPE)/i.test(text)) {
    throw new Error('The Google Sheet answered with a web page instead of saving. Check that the Apps Script is deployed as a Web app with access set to "Anyone".');
  }
  let reply: any = null;
  try { reply = JSON.parse(text); } catch { /* not JSON: an older script; treat as saved */ }
  if (reply && reply.status === 'error') {
    throw new Error(`The Google Sheet could not save: ${reply.message || 'unknown error'}`);
  }
}

// "10:00" as a Sheets cell becomes a time on 1899-12-30, and comes back as an
// ISO date-time. This puts it back to "HH:MM", read in this computer's time
// zone — the same reading the MoM screen has always shown.
const SHEET_TIME_SERIAL = /^1899-12-3[01]T\d{2}:\d{2}/;
export function sheetTimeToHHMM(value: any): any {
  if (typeof value !== 'string' || !SHEET_TIME_SERIAL.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * THE LARGE-DELETION GUARD.
 *
 * Every save rewrites whole sheets from what this browser holds. If the
 * browser's copy of a module is empty or partial — storage cleared or full,
 * a load that failed, a slip — a save would quietly wipe that module in the
 * Sheet. So the app remembers how many rows each sheet had at the last load
 * or confirmed save, and holds back a save that would remove at least half of
 * a sheet's rows (and at least 10). The Sheet stays untouched until the user
 * confirms (SAVE ANYWAY in the header). Chat history and change requests are
 * not counted: they are not project data.
 */
const GUARDED_SHEETS: Record<string, string> = {
  projects: 'projects',
  timelineRevisions: 'timeline revisions',
  timelineActivities: 'timeline rows',
  deliverables: 'deliverables',
  tasks: 'tasks & issues',
  codexPages: 'Codex pages',
  documents: 'documents',
  billingMilestones: 'billing milestones',
  risks: 'risks',
  stakeholders: 'stakeholders',
  moms: 'meeting minutes',
  piiEntries: 'PII glossary entries',
};
const ROW_COUNTS_KEY = 'pm-codex-sheet-row-counts';
export const LARGE_DELETION = { minRows: 10, share: 0.5 };

const countRows = (data: Record<string, any>): Record<string, number> =>
  Object.fromEntries(Object.keys(GUARDED_SHEETS).map(k => [k, Array.isArray(data?.[k]) ? data[k].length : 0]));
const readKnownCounts = (): Record<string, number> | null => {
  try { const raw = localStorage.getItem(ROW_COUNTS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const writeKnownCounts = (counts: Record<string, number>) => {
  try { localStorage.setItem(ROW_COUNTS_KEY, JSON.stringify(counts)); } catch { /* the guard just starts fresh */ }
};
/**
 * Rows the user has asked to remove — a deleted project — are taken off the
 * guard's reference, so the save that removes them goes through while any
 * OTHER sheet that loses rows is still held back.
 */
function lowerKnownCounts(removed: Record<string, number>) {
  const known = readKnownCounts();
  if (!known) return;
  const next = { ...known };
  for (const [k, n] of Object.entries(removed)) {
    if (typeof next[k] === 'number') next[k] = Math.max(0, next[k] - (Number(n) || 0));
  }
  writeKnownCounts(next);
}

/** Records of a project deleted in this browser, which a load must not bring back. */
const fromDeletedProject = (item: any): boolean => {
  const gone = useAppStore.getState().deletedProjectIds || [];
  return gone.length > 0 && !!item && gone.includes(item.projectId);
};

/** "tasks & issues 120 → 3" for every sheet the save would mostly empty. */
export function describeLargeDeletions(known: Record<string, number> | null, next: Record<string, number>): string | null {
  if (!known) return null;
  const hits = Object.keys(GUARDED_SHEETS)
    .filter(k => typeof known[k] === 'number')
    .filter(k => known[k] - (next[k] || 0) >= LARGE_DELETION.minRows && (next[k] || 0) < known[k] * LARGE_DELETION.share)
    .map(k => `${GUARDED_SHEETS[k]} ${known[k]} → ${next[k] || 0}`);
  return hits.length ? hits.join(', ') : null;
}

function isLocalNewer(localUpdatedAt: string, serverUpdatedAt: string): boolean {
  if (!localUpdatedAt) return false;
  if (!serverUpdatedAt) return true;

  const localTime = new Date(localUpdatedAt).getTime();
  const serverTime = new Date(serverUpdatedAt).getTime();
  
  const localValid = !isNaN(localTime);
  const serverValid = !isNaN(serverTime);
  
  if (localValid && !serverValid) {
    return true;
  }
  if (!localValid && serverValid) {
    return false;
  }
  if (!localValid && !serverValid) {
    return localUpdatedAt >= serverUpdatedAt;
  }
  return localTime > serverTime;
}

function mergeWithTimestamps<T extends { id: string; updatedAt: string }>(
  localItems: T[],
  serverItems: T[]
): { merged: T[]; requiresSync: boolean } {
  let requiresSync = false;
  const deletedIds = new Set(useAppStore.getState().deletedRecordIds || []);
  const serverMap = new Map<string, T>();
  serverItems.forEach(item => {
    if (!deletedIds.has(item.id) && !fromDeletedProject(item)) {
      serverMap.set(item.id, item);
    }
  });

  const localMap = new Map<string, T>();
  localItems.forEach(item => localMap.set(item.id, item));

  const mergedMap = new Map<string, T>();

  // Compare and merge items that exist in both, or are unique
  // 1. All server items (that are not deleted locally)
  for (const serverItem of Array.from(serverMap.values())) {
    const localItem = localMap.get(serverItem.id);
    if (!localItem) {
      // Exists only on server, keep server item
      mergedMap.set(serverItem.id, serverItem);
    } else {
      // Exists in both, compare updatedAt
      if (isLocalNewer(localItem.updatedAt, serverItem.updatedAt)) {
        // Local is newer, keep local and mark for sync back
        mergedMap.set(serverItem.id, localItem);
        requiresSync = true;
      } else {
        // Server is newer or equal, keep server
        mergedMap.set(serverItem.id, serverItem);
      }
    }
  }

  // 2. Local items that don't exist on server
  for (const localItem of localItems) {
    if (!serverMap.has(localItem.id)) {
      // Local only, keep and mark for sync back
      mergedMap.set(localItem.id, localItem);
      requiresSync = true;
    }
  }

  return {
    merged: Array.from(mergedMap.values()),
    requiresSync
  };
}

function mergeById<T extends { id: string }>(
  localItems: T[],
  serverItems: T[]
): { merged: T[]; requiresSync: boolean } {
  let requiresSync = false;
  const deletedIds = new Set(useAppStore.getState().deletedRecordIds || []);
  const serverMap = new Map<string, T>();
  serverItems.forEach(item => {
    // A deleted project is a record of the projects sheet too: its own id.
    if (!deletedIds.has(item.id) && !fromDeletedProject(item)
      && !(useAppStore.getState().deletedProjectIds || []).includes(item.id)) {
      serverMap.set(item.id, item);
    }
  });

  const localMap = new Map<string, T>();
  localItems.forEach(item => localMap.set(item.id, item));

  const mergedMap = new Map<string, T>();

  // For server items, keep them
  for (const serverItem of Array.from(serverMap.values())) {
    mergedMap.set(serverItem.id, serverItem);
  }

  // For local items that don't exist on server, keep them and mark for sync back
  for (const localItem of localItems) {
    if (!serverMap.has(localItem.id)) {
      mergedMap.set(localItem.id, localItem);
      requiresSync = true;
    }
  }

  return {
    merged: Array.from(mergedMap.values()),
    requiresSync
  };
}

// We map sheet names to store functions
const STORES = {
  projects: () => useAppStore.getState().projects,
  timelineRevisions: () => {
    const projectTimelines = useTimelineStore.getState().projectTimelines;
    const flatRevisions: any[] = [];
    projectTimelines.forEach(pt => {
      pt.revisions.forEach(rev => {
        flatRevisions.push({
          projectId: pt.projectId,
          activeRevisionId: pt.activeRevisionId,
          id: rev.id,
          name: rev.name,
          createdAt: rev.createdAt,
          // The project's holiday list rides on each of its revision rows.
          holidays: pt.holidays && pt.holidays.length ? JSON.stringify(pt.holidays) : ''
        });
      });
    });
    return flatRevisions;
  },
  timelineActivities: () => {
    const projectTimelines = useTimelineStore.getState().projectTimelines;
    const flatActivities: any[] = [];
    projectTimelines.forEach(pt => {
      pt.revisions.forEach(rev => {
        rev.activities.forEach(act => {
          flatActivities.push({
            id: act.id,
            projectId: pt.projectId,
            revisionId: rev.id,
            phase: act.phase || '',
            activity: act.activity || '',
            subActivity: act.subActivity || '',
            weight: act.weight || 0,
            progress: act.progress || 0,
            status: act.status || '',
            owner: act.owner || '',
            targetStartDate: act.targetStartDate || '',
            targetCompletionDate: act.targetCompletionDate || '',
            actualStartDate: act.actualStartDate || '',
            actualCompletionDate: act.actualCompletionDate || '',
            remarks: act.remarks || '',
            formulas: act.formulas ? JSON.stringify(act.formulas) : ''
          });
        });
      });
    });
    return flatActivities;
  },
  deliverables: () => useDeliverablesStore.getState().deliverables,
  tasks: () => useTasksStore.getState().tasks,
  codexPages: () => useCodexStore.getState().pages,
  documents: () => useDocumentsStore.getState().documents,
  billingMilestones: () => useBillingStore.getState().milestones,
  risks: () => useRisksStore.getState().risks,
  stakeholders: () => useStakeholdersStore.getState().stakeholders,
  moms: () => useMomStore.getState().moms,
  piiEntries: () => usePIIStore.getState().entries,
  acrs: () => useAcrStore.getState().acrs,
  aiSessions: () => {
    return useAiStore.getState().sessions.map(s => ({
      id: s.id,
      projectId: s.projectId,
      title: s.title,
      updatedAt: s.updatedAt
    }));
  },
  aiMessages: () => {
    const flatMessages: any[] = [];
    useAiStore.getState().sessions.forEach(s => {
      (s.messages || []).forEach((m, idx) => {
        let partsStr = '';
        try {
          partsStr = JSON.stringify(m.parts || []);
        } catch (e) {
          partsStr = '[]';
        }
        const maxChunkLen = 45000;
        
        const timestamp = (m as any)._timestamp || '';
        const model = (m as any)._model || '';

        if (partsStr.length <= maxChunkLen) {
          flatMessages.push({
            id: `${s.id}_${idx}_0`,
            sessionId: s.id,
            role: m.role || 'user',
            index: idx,
            chunkIdx: 0,
            partsChunk: partsStr,
            _timestamp: timestamp,
            _model: model
          });
        } else {
          let offset = 0;
          let chunkIdx = 0;
          while (offset < partsStr.length) {
            flatMessages.push({
              id: `${s.id}_${idx}_${chunkIdx}`,
              sessionId: s.id,
              role: m.role || 'user',
              index: idx,
              chunkIdx: chunkIdx,
              partsChunk: partsStr.substring(offset, offset + maxChunkLen),
              _timestamp: timestamp,
              _model: model
            });
            offset += maxChunkLen;
            chunkIdx++;
          }
        }
      });
    });
    return flatMessages;
  },
};

export const EXPECTED_GAS_VERSION = '1.1.0-MVP';

export const MOCK_GAS_SCRIPT = `
// PM Codex - Minimal GAS Backend (v1.1.0-MVP)
const VERSION = '1.1.0-MVP';

function doGet(e) {
  if (e.parameter.action === 'version') {
    return ContentService.createTextOutput(JSON.stringify({ version: VERSION }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (e.parameter.action === 'load') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();
    const data = {};
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      const range = sheet.getDataRange();
      const values = range.getValues();
      
      if (values.length <= 1) {
        data[sheetName] = [];
        return;
      }
      
      const headers = values[0];
      const sheetData = [];
      
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
           let val = row[j];
           try {
             if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
                 val = JSON.parse(val);
             }
           } catch(err) {}
           obj[headers[j]] = val;
        }
        sheetData.push(obj);
      }
      data[sheetName] = sheetData;
    });
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', data }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'PM Codex Backend Active' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    for (const sheetName in payload) {
      if (sheetName === 'action' || sheetName === 'version') continue;
      
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      
      sheet.clear();
      const records = payload[sheetName];
      if (!records || records.length === 0) continue;
      
      const headerSet = new Set();
      records.forEach(record => {
        Object.keys(record).forEach(k => headerSet.add(k));
      });
      const headers = Array.from(headerSet);
      
      const rows = [headers];
      records.forEach(record => {
        const row = headers.map(h => {
          let val = record[h];
          if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
             return JSON.stringify(val);
          }
          if (typeof val === 'string') {
             if (/^\\d+$/.test(val)) return "'" + val;
             if (val.startsWith('=') || val.startsWith('+') || val.startsWith('-') || val.startsWith('@')) {
                return "'" + val;
             }
          }
          return val !== undefined ? val : '';
        });
        rows.push(row);
      });
      
      sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
`;

let syncTimeout: any = null;
let pushInFlight: Promise<boolean> | null = null;

export const gasSyncService = {
  isPerformingLoad: false,
  isApplyingServerState: false,
  lastPushFinishedAt: 0,
  lastLocalChangeAt: 0,
  hasLocalChangeDuringLoad: false,

  /** Set by SAVE ANYWAY: the next save may remove rows the guard would hold back. */
  allowLargeDeletionOnce: false,

  /** A project the user deleted: its rows are expected to leave the Sheet. See lowerKnownCounts. */
  expectRowRemovals: (removed: Record<string, number>) => lowerKnownCounts(removed),

  /** SAVE ANYWAY: the user has checked the held-back save and wants it written. */
  confirmHeldSave: async () => {
    gasSyncService.allowLargeDeletionOnce = true;
    await gasSyncService.retryNow();
  },

  hasPendingSync: () => {
    return syncTimeout !== null || pushInFlight !== null;
  },

  hasRecentPush: () => {
    return (Date.now() - gasSyncService.lastPushFinishedAt) < 10000; // 10-second cooldown
  },

  trackLocalChange: () => {
    gasSyncService.lastLocalChangeAt = Date.now();
    if (gasSyncService.isPerformingLoad) {
      console.log('Local/User change detected while a load is in progress! Marking load as stale to prevent rollback.');
      gasSyncService.hasLocalChangeDuringLoad = true;
    }
  },

  /**
   * Push the whole project if anything is waiting.
   *
   * A job is marked COMPLETED only when the Sheet has confirmed the write.
   * Until 24 Sep 2026 `syncNow` swallowed every failure, so a refused or
   * failed write was recorded as done: the header said DB SYNCED, and the
   * start-up check below then pulled the older Sheet copy over the edits that
   * had never reached it.
   */
  processSyncQueue: async () => {
    // Requires dynamically importing or fetching from the store to avoid circular
    // Alternatively, just import at the top
    const { useSyncQueueStore } = await import('../store/syncQueueStore');
    // One write at a time. Each write wipes and rewrites every sheet, so two
    // at once can finish out of order and leave the older copy in the Sheet.
    // The worker ticks every 5 seconds and a large write can take longer.
    if (pushInFlight) return;
    const queueStore = useSyncQueueStore.getState();
    const pendingJobs = queueStore.getPendingJobs();

    if (pendingJobs.length === 0) return;

    const pendingIds = pendingJobs.map(j => j.id);
    queueStore.updateJobStatus(pendingIds, 'SYNCING');

    const saved = await gasSyncService.syncNow();
    if (saved) {
      useSyncQueueStore.getState().updateJobStatus(pendingIds, 'COMPLETED');
      return;
    }

    const error = useAppStore.getState().syncErrorMessage || 'The Sheet did not confirm the save';
    useSyncQueueStore.getState().incrementRetry(pendingIds);
    // Read the jobs again: the calls above replaced the array.
    useSyncQueueStore.getState().jobs.forEach(job => {
      if (!pendingIds.includes(job.id)) return;
      // FAILED jobs are still unsaved work: the worker retries them every
      // minute and the start-up check will not load over them.
      useSyncQueueStore.getState().updateJobStatus([job.id], job.retryCount >= 4 ? 'FAILED' : 'PENDING', error);
    });
  },

  /** True while any change has not been confirmed by the Sheet. */
  hasUnsavedWork: async (): Promise<boolean> => {
    const { useSyncQueueStore } = await import('../store/syncQueueStore');
    return useSyncQueueStore.getState().jobs.some(j => j.status !== 'COMPLETED');
  },

  /** The RETRY buttons: put failed work back in line and push it now. */
  retryNow: async () => {
    const { useSyncQueueStore } = await import('../store/syncQueueStore');
    useSyncQueueStore.getState().retryFailed();
    if (useSyncQueueStore.getState().getPendingJobs().length > 0) {
      await gasSyncService.processSyncQueue();
    } else {
      await gasSyncService.syncNow();
    }
  },

  /**
   * Write the whole project to the Sheet. Resolves true only when the Sheet
   * answered that the write succeeded; on any failure the header shows SYNC
   * PAUSED with the reason, and the caller keeps the work queued.
   */
  syncNow: async (): Promise<boolean> => {
    // Wait for a write already under way, then write the newest state.
    while (pushInFlight) {
      try { await pushInFlight; } catch { /* its own caller reports it */ }
    }
    pushInFlight = gasSyncService.pushOnce();
    try {
      return await pushInFlight;
    } finally {
      pushInFlight = null;
    }
  },

  pushOnce: async (): Promise<boolean> => {
    const gasUrl = useAppStore.getState().gasUrl;
    if (!gasUrl) return false;

    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = null;
    }

    const store = useAppStore.getState();
    store.setSyncStatus('syncing');

    try {
      const rawPayload: Record<string, any> = {};
      for (const [key, getStoreData] of Object.entries(STORES)) {
        rawPayload[key] = getStoreData();
      }
      const nextCounts = countRows(rawPayload);
      const drops = describeLargeDeletions(readKnownCounts(), nextCounts);
      if (drops && !gasSyncService.allowLargeDeletionOnce) {
        store.setSyncHeldBack(drops);
        store.setSyncStatus('error', `Save held back: it would remove most rows of ${drops} in your Google Sheet. The Sheet is untouched until you choose SAVE ANYWAY.`);
        return false;
      }
      gasSyncService.allowLargeDeletionOnce = false;
      store.setSyncHeldBack(null);
      const payload = sanitizePayload(rawPayload);

      const response = await fetch(gasUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify(payload)
      });
      await confirmWrite(response);
      writeKnownCounts(nextCounts);
      console.log('GAS Sync Complete');
      gasSyncService.lastPushFinishedAt = Date.now();
      store.setSyncStatus('synced');
      store.setLastSyncedAt(Date.now());
      return true;
    } catch (e) {
      console.error('GAS Sync Failed', e);
      store.setSyncStatus('error', e instanceof Error ? e.message : String(e));
      return false;
    }
  },

  loadAll: async (gasUrl: string, isBackground?: boolean) => {
    gasSyncService.isPerformingLoad = true;
    gasSyncService.hasLocalChangeDuringLoad = false;
    const store = useAppStore.getState();
    const prevStatus = store.syncStatus;
    
    // Phase 4 plan: Pre-Flight check
    // If there are pending jobs on cold start, push them FIRST.
    const { useSyncQueueStore } = await import('../store/syncQueueStore');
    // Failed work, and a save cut off when the tab closed, are unsaved work
    // too: give them another go before pulling. (Nothing else is saving yet —
    // loadAll runs once, at start-up.)
    useSyncQueueStore.getState().retryFailed();
    useSyncQueueStore.setState((s) => ({
      jobs: s.jobs.map((j) => (j.status === 'SYNCING' ? { ...j, status: 'PENDING' as const } : j)),
    }));
    if (useSyncQueueStore.getState().getPendingJobs().length > 0) {
      if (!isBackground) store.setSyncStatus('syncing');
      console.log('Pre-Flight Check: Offline mutations found. Pushing queue to DB before pulling.');
      await gasSyncService.processSyncQueue();
      // Still not saved: loading now would put the older Sheet copy over it.
      if (await gasSyncService.hasUnsavedWork()) {
        console.error('Pre-Flight failed to clear queue, skipping loadAll to protect local data.');
        gasSyncService.isPerformingLoad = false;
        return;
      }
    }

    if (!isBackground) {
      store.setSyncStatus('syncing');
    }

    try {
      const response = await fetch(`${gasUrl}?action=load&t=${new Date().getTime()}`, { cache: 'no-store' });
      const text = await response.text();
      const trimmedText = text.trim();
      if (trimmedText.startsWith('<!DOCTYPE') || trimmedText.startsWith('<html') || trimmedText.startsWith('<DOCTYPE')) {
        throw new Error('Received HTML webpage instead of JSON database response. Please verify that your Google Apps Script is correctly deployed *and* configured with access set to "Anyone".');
      }
      
      let result;
      try {
        result = JSON.parse(text);
        
        const removeDateQuotes = (val: any): any => {
          if (typeof val === 'string') {
            if (/^'\d{4}-\d{2}-\d{2}$/.test(val)) return val.substring(1);
            if (/^'\d{1,2}:\d{2}(:\d{2})?$/.test(val)) return val.substring(1);
            return val;
          }
          if (Array.isArray(val)) return val.map(removeDateQuotes);
          if (typeof val === 'object' && val !== null) {
            const cleaned: Record<string, any> = {};
            for (const [k, v] of Object.entries(val)) {
              cleaned[k] = removeDateQuotes(v);
            }
            return cleaned;
          }
          return val;
        };
        result = removeDateQuotes(result);
      } catch (e) {
        throw new Error(`Database returned invalid format (not JSON or script issue): "${text.substring(0, 100)}..."`);
      }
      
      if (result.status === 'success' && result.data) {
        // What the Sheet holds now: the guard's reference for the next save.
        writeKnownCounts(countRows(result.data));
        if (gasSyncService.hasLocalChangeDuringLoad) {
          console.warn('User edited data while Google App Script load was in progress. Discarding loaded server state to prevent rollback.');
          store.setSyncStatus('synced');
          return;
        }

        let requiresSync = false;
        
        // Ensure every item has an id
        for (const key in result.data) {
          if (Array.isArray(result.data[key])) {
            result.data[key] = result.data[key].map((item: any) => {
              if (item.id === undefined) {
                // Try to find an id field case-insensitively
                const idKey = Object.keys(item).find(k => k.toLowerCase() === 'id' || k.toLowerCase().endsWith('id'));
                if (idKey && item[idKey]) {
                  item.id = item[idKey];
                } else {
                  requiresSync = true;
                  item.id = crypto.randomUUID();
                }
              }
              return item;
            });
          }
        }

        gasSyncService.isApplyingServerState = true;
        try {
          // Clean up expendable storage before hydrating stores to prevent QuotaExceededError
          runStorageMaintenance();

          // Initialize stores with the DB payload (merging safely with local state)
          
          // Helper to get data regardless of exact casing, spacing, or underscores in backend
          const getData = (key: string) => {
            if (!result.data || typeof result.data !== 'object') return undefined;
            if (result.data[key] !== undefined) return result.data[key];
            
            const normKey = key.toLowerCase().replace(/[\s_-]/g, '');
            for (const sheetName of Object.keys(result.data)) {
              if (sheetName.toLowerCase().replace(/[\s_-]/g, '') === normKey) {
                return result.data[sheetName];
              }
            }
            return undefined;
          };

          // Helper to extract fields from row objects regardless of column header casing or style
          const getField = (obj: any, ...keys: string[]): any => {
            if (!obj || typeof obj !== 'object') return undefined;
            for (const k of keys) {
              if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
            }
            const objKeys = Object.keys(obj);
            for (const k of keys) {
              const normK = k.toLowerCase().replace(/[\s_-]/g, '');
              const foundKey = objKeys.find(ok => ok.toLowerCase().replace(/[\s_-]/g, '') === normK);
              if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null && obj[foundKey] !== '') {
                return obj[foundKey];
              }
            }
            return undefined;
          };

          // 1. Projects
          const localProjects = useAppStore.getState().projects || [];
          const serverProjects = getData('projects');
          if (serverProjects !== undefined) {
             const { merged: mergedProjects, requiresSync: projReqSync } = mergeById(localProjects, serverProjects);
             useAppStore.setState({ projects: mergedProjects });
             if (projReqSync) requiresSync = true;
          }

          // Reconstruct projectTimelines from flat timelineRevisions and timelineActivities
          const rawRevisions = getData('timelineRevisions') || [];
          const flatActivities = getData('timelineActivities') || [];
          
          let reconstructedProjectTimelines: any[] = [];
          
          // Detect if the loaded timelineRevisions represents the OLD schema (nested revisions)
          const isOldSchema = rawRevisions.length > 0 && ('revisions' in rawRevisions[0]);
          
          if (isOldSchema) {
            reconstructedProjectTimelines = rawRevisions;
          } else if (rawRevisions.length > 0) {
            // Group revisions by projectId
            const projectTimelinesMap = new Map<string, { projectId: string; activeRevisionId: string; revisions: any[] }>();
            
            rawRevisions.forEach((flatRev: any) => {
              const projectId = flatRev.projectId;
              if (!projectId || fromDeletedProject(flatRev)) return;
              
              if (!projectTimelinesMap.has(projectId)) {
                projectTimelinesMap.set(projectId, {
                  projectId,
                  activeRevisionId: flatRev.activeRevisionId || flatRev.id,
                  revisions: []
                });
              }
              
              const projTimeline = projectTimelinesMap.get(projectId)! as any;
              // The Apps Script parses a cell that starts with "[" on the way
              // out, so the list usually arrives as an array. Until 24 Sep 2026
              // only the text form was read, and every reload dropped the list.
              if (!projTimeline.holidays) {
                let list: any = flatRev.holidays;
                if (typeof list === 'string' && list.trim().startsWith('[')) {
                  try { list = JSON.parse(list); } catch { list = null; /* ignore a broken list */ }
                }
                if (Array.isArray(list)) {
                  projTimeline.holidays = list
                    .map((d: any) => (typeof d === 'string' ? d.replace(/^'/, '') : d))
                    .filter((d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
                }
              }
              
              // Find all activities for this revision
              const revActivities = flatActivities
                .filter((act: any) => act.projectId === projectId && act.revisionId === flatRev.id)
                .map((act: any) => {
                  let formulas = act.formulas;
                  if (typeof formulas === 'string' && formulas.trim() !== '') {
                    try {
                      formulas = JSON.parse(formulas);
                    } catch (e) {
                      formulas = undefined;
                    }
                  } else if (typeof formulas !== 'object') {
                    formulas = undefined;
                  }
                  return {
                    id: act.id,
                    phase: act.phase || '',
                    activity: act.activity || '',
                    subActivity: act.subActivity || '',
                    weight: Number(act.weight) || 0,
                    progress: Number(act.progress) || 0,
                    status: act.status || '',
                    owner: act.owner || '',
                    targetStartDate: act.targetStartDate || '',
                    targetCompletionDate: act.targetCompletionDate || '',
                    actualStartDate: act.actualStartDate || '',
                    actualCompletionDate: act.actualCompletionDate || '',
                    remarks: act.remarks || '',
                    formulas
                  };
                });
                
              projTimeline.revisions.push({
                id: flatRev.id,
                name: flatRev.name || 'Plan',
                createdAt: Number(flatRev.createdAt) || Date.now(),
                activities: revActivities
              });
              
              if (flatRev.activeRevisionId) {
                projTimeline.activeRevisionId = flatRev.activeRevisionId;
              }
            });
            reconstructedProjectTimelines = Array.from(projectTimelinesMap.values());
          }

          // 2. Timelines
          const localTimelines = useTimelineStore.getState().projectTimelines || [];
          let mergedTimelines = reconstructedProjectTimelines;
          if (getData('timelineRevisions') !== undefined) {
             const serverProjectIds = new Set(reconstructedProjectTimelines.map(pt => pt.projectId));
             const localOnlyTimelines = localTimelines.filter(pt => !serverProjectIds.has(pt.projectId));
             if (localOnlyTimelines.length > 0) {
                mergedTimelines = [...reconstructedProjectTimelines, ...localOnlyTimelines];
                requiresSync = true;
             }
             useTimelineStore.setState({ projectTimelines: mergedTimelines });
          }

          const normalizeLinkedIds = (ids: any): string[] => {
            if (Array.isArray(ids)) {
              return ids.filter(id => typeof id === 'string' && id.trim() !== '');
            }
            if (typeof ids === 'string' && ids.trim() !== '') {
              const trimmed = ids.trim();
              if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                  const parsed = JSON.parse(trimmed);
                  if (Array.isArray(parsed)) {
                    return parsed.filter(id => typeof id === 'string' && id.trim() !== '');
                  }
                } catch (e) {
                  // ignore and treat as normal string
                }
              }
              return trimmed.split(',').map(s => s.trim()).filter(s => s !== '');
            }
            return [];
          };

          const rawDeliverables = getData('deliverables') || [];
          const rawTasks = getData('tasks') || [];

          const sanitizedDeliverables = rawDeliverables.map((d: any) => ({
            ...d,
            owner: d.owner || '',
            parentId: d.parentId || null,
            hasNestedSpace: d.hasNestedSpace === true || d.hasNestedSpace === 'true',
            linkedActivityIds: normalizeLinkedIds(d.linkedActivityIds)
          }));

          const sanitizedTasks = rawTasks.map((t: any) => ({
            ...t,
            linkedActivityIds: normalizeLinkedIds(t.linkedActivityIds)
          }));

          // 3. Deliverables
          const localDeliverables = useDeliverablesStore.getState().deliverables || [];
          const serverDeliverables = getData('deliverables');
          if (serverDeliverables !== undefined) {
             const { merged: mergedDeliverables, requiresSync: delReqSync } = mergeById(localDeliverables, sanitizedDeliverables);
             useDeliverablesStore.setState({ deliverables: mergedDeliverables });
             if (delReqSync) requiresSync = true;
          }

          // 4. Tasks
          const localTasks = useTasksStore.getState().tasks || [];
          const serverTasks = getData('tasks');
          if (serverTasks !== undefined) {
             const { merged: mergedTasks, requiresSync: tasksReqSync } = mergeById(localTasks, sanitizedTasks);
             useTasksStore.setState({ tasks: mergedTasks });
             if (tasksReqSync) requiresSync = true;
          }

          // 5. Codex Pages (with timestamps)
          const localPages = useCodexStore.getState().pages || [];
          const serverPages = getData('codexPages');
          if (serverPages !== undefined) {
             const { merged: mergedPages, requiresSync: pagesReqSync } = mergeWithTimestamps(localPages, serverPages);
             useCodexStore.setState({ pages: mergedPages });
             if (pagesReqSync) requiresSync = true;
          }

          // 6. Documents (with timestamps)
          const localDocs = useDocumentsStore.getState().documents || [];
          const serverDocs = getData('documents');
          if (serverDocs !== undefined) {
             const { merged: mergedDocs, requiresSync: docsReqSync } = mergeWithTimestamps(localDocs, serverDocs);
             useDocumentsStore.setState({ documents: mergedDocs });
             if (docsReqSync) requiresSync = true;
          }

          // 7. Billing Milestones
          const localMilestones = useBillingStore.getState().milestones || [];
          const serverMilestones = getData('billingMilestones');
          if (serverMilestones !== undefined) {
             const { merged: mergedMilestones, requiresSync: bmReqSync } = mergeById(localMilestones, serverMilestones);
             useBillingStore.setState({ milestones: mergedMilestones });
             if (bmReqSync) requiresSync = true;
          }

          // 8. Risks
          const rawRisks = getData('risks') || [];
          const matrix = useRisksStore.getState().riskMatrixConfig;
          const sanitizedRisks = rawRisks.map((r: any) => {
            const currentImpact = r.status === 'Mitigated' ? r.postMitigationImpactLevel : r.impactLevel;
            const currentProb = r.status === 'Mitigated' ? r.postMitigationProbability : r.probability;
            return {
              ...r,
              riskValue: calculateRiskValue(currentImpact || '', currentProb || '', matrix)
            };
          });
          // Re-calculate risk value dynamically on load if missing
          const localRisks = useRisksStore.getState().risks || [];
          const serverRisks = getData('risks');
          if (serverRisks !== undefined) {
             const { merged: mergedRisks, requiresSync: risksReqSync } = mergeById(localRisks, sanitizedRisks);
             useRisksStore.setState({ risks: mergedRisks });
             if (risksReqSync) requiresSync = true;
          }

          // 9. Stakeholders
          const localStakeholders = useStakeholdersStore.getState().stakeholders || [];
          const serverStakeholders = getData('stakeholders');
          if (serverStakeholders !== undefined) {
             const { merged: mergedStakeholders, requiresSync: stReqSync } = mergeById(localStakeholders, serverStakeholders);
             useStakeholdersStore.setState({ stakeholders: mergedStakeholders });
             if (stReqSync) requiresSync = true;
          }

          // 10. MoMs
          const rawMoms = getData('moms') || [];
          const sanitizedMoms = rawMoms.map((m: any) => ({
            ...m,
            // Repairs meeting times that went through the Sheet as a time value
            // ("1899-12-30T…"). The next save writes them back as "HH:MM" text.
            time: sheetTimeToHHMM(m.time),
            actionItems: (Array.isArray(m.actionItems) ? m.actionItems : []).map((ai: any) => ({
              ...ai,
              status: ai.status === 'Closed' ? 'Done' : (ai.status || 'Open')
            }))
          }));
          const localMoms = useMomStore.getState().moms || [];
          const serverMoms = getData('moms');
          if (serverMoms !== undefined) {
             const { merged: mergedMoms, requiresSync: momsReqSync } = mergeById(localMoms, sanitizedMoms);
             useMomStore.setState({ moms: mergedMoms });
             if (momsReqSync) requiresSync = true;
             // Write repaired meeting times back once, as text.
             if (rawMoms.some((m: any, i: number) => m.time !== sanitizedMoms[i].time)) requiresSync = true;
          }

          // 11. PII Entries
          const localPii = usePIIStore.getState().entries || [];
          const serverPii = getData('piiEntries');
          if (serverPii !== undefined) {
             const { merged: mergedPii, requiresSync: piiReqSync } = mergeById(localPii, serverPii);
             usePIIStore.setState({ entries: mergedPii });
             if (piiReqSync) requiresSync = true;
          }

          // 12. ACRs (Assistant Change Requests)
          const localAcrs = useAcrStore.getState().acrs || [];
          const serverAcrs = getData('acrs') || [];
          const { merged: mergedAcrs, requiresSync: acrsReqSync } = mergeWithTimestamps(localAcrs as any[], serverAcrs as any[]);
          useAcrStore.setState({ acrs: mergedAcrs });
          if (acrsReqSync) requiresSync = true;
          if (getData('acrs') === undefined && localAcrs.length > 0) {
             requiresSync = true;
          }

          // Reconstruct AI chat history from aiSessions and aiMessages
          const rawAiSessions = getData('aiSessions') || getData('sessions') || getData('chatSessions') || getData('chats') || [];
          const rawAiMessages = getData('aiMessages') || getData('messages') || getData('chatMessages') || [];

          // Group chunks of parts by sessionId and message index
          const sessionMessagesMap = new Map<string, Map<number, { role: string; timestamp: string; model: string; chunks: { chunkIdx: number; text: string }[] }>>();

          rawAiMessages.forEach((msg: any) => {
            const sessionId = getField(msg, 'sessionId', 'session_id', 'session', 'id_session', 'sessionid');
            if (!sessionId) return;
            
            const rawIdx = getField(msg, 'index', 'idx', 'message_index', 'msg_index', 'order', 'seq');
            const index = Number(rawIdx);
            if (isNaN(index)) return;
            
            const role = getField(msg, 'role', 'sender', 'type', 'author') || 'user';
            const timestamp = getField(msg, '_timestamp', 'timestamp', 'date', 'time', 'created_at', 'createdAt') || '';
            const model = getField(msg, '_model', 'model') || '';
            const chunkIdx = Number(getField(msg, 'chunkIdx', 'chunk_idx', 'chunk', 'chunk_index')) || 0;
            
            const rawParts = getField(msg, 'partsChunk', 'parts_chunk', 'parts', 'content', 'text', 'message', 'body', 'data');
            let chunkText = '';
            if (typeof rawParts === 'string') {
              chunkText = rawParts;
            } else if (rawParts !== undefined && rawParts !== null) {
              chunkText = JSON.stringify(rawParts);
            }
            
            if (!sessionMessagesMap.has(sessionId)) {
              sessionMessagesMap.set(sessionId, new Map());
            }
            
            const msgMap = sessionMessagesMap.get(sessionId)!;
            if (!msgMap.has(index)) {
              msgMap.set(index, {
                role,
                timestamp,
                model,
                chunks: []
              });
            } else {
              const current = msgMap.get(index)!;
              if (!current.timestamp && timestamp) {
                current.timestamp = timestamp;
              }
              if (!current.model && model) {
                current.model = model;
              }
              if (!current.role && role) {
                current.role = role;
              }
            }
            
            msgMap.get(index)!.chunks.push({
              chunkIdx,
              text: chunkText
            });
          });

          // If rawAiSessions is empty, but rawAiMessages has sessionIds, discover sessions from rawAiMessages!
          const discoveredSessionIds = new Set<string>(sessionMessagesMap.keys());
          const knownSessionIds = new Set(rawAiSessions.map((s: any) => getField(s, 'id', 'sessionId', 'session_id', 'Id', 'ID')));

          discoveredSessionIds.forEach(sessId => {
            if (sessId && !knownSessionIds.has(sessId)) {
              rawAiSessions.push({
                id: sessId,
                projectId: '',
                title: 'Restored Conversation',
                updatedAt: new Date().toISOString()
              });
            }
          });

          // Reconstruct each session from raw sheets
          const reconstructedSessions = rawAiSessions.map((session: any) => {
            const sessionId = getField(session, 'id', 'sessionId', 'session_id', 'Id', 'ID') || String(Math.random().toString(36).substring(2, 9));
            const projectId = getField(session, 'projectId', 'project_id', 'ProjectId', 'project', 'Project') || '';
            const title = getField(session, 'title', 'Title', 'name', 'sessionTitle') || 'Conversation';
            const updatedAt = getField(session, 'updatedAt', 'updated_at', 'UpdatedAt', 'timestamp', 'date') || new Date().toISOString();
            
            const messages: any[] = [];
            
            const msgMap = sessionId ? sessionMessagesMap.get(sessionId) : undefined;
            if (msgMap) {
              const sortedIndices = Array.from(msgMap.keys()).sort((a, b) => a - b);
              sortedIndices.forEach((idx) => {
                const msgInfo = msgMap.get(idx)!;
                msgInfo.chunks.sort((a, b) => a.chunkIdx - b.chunkIdx);
                const fullPartsStr = msgInfo.chunks.map(c => c.text).join('');
                
                let partsList: any[] = [];
                if (typeof fullPartsStr === 'string' && fullPartsStr.trim()) {
                  try {
                    const parsed = JSON.parse(fullPartsStr);
                    if (Array.isArray(parsed)) {
                      partsList = parsed;
                    } else if (typeof parsed === 'object' && parsed !== null) {
                      partsList = [parsed];
                    } else {
                      partsList = [{ text: String(parsed) }];
                    }
                  } catch (e) {
                    // Plain text stored in sheet
                    partsList = [{ text: fullPartsStr }];
                  }
                } else if (Array.isArray(fullPartsStr)) {
                  partsList = fullPartsStr;
                } else if (typeof fullPartsStr === 'object' && fullPartsStr !== null) {
                  partsList = [fullPartsStr];
                } else if (fullPartsStr) {
                  partsList = [{ text: String(fullPartsStr) }];
                }
                
                partsList = partsList.map(p => {
                  if (typeof p === 'string') return { text: p };
                  if (p && typeof p === 'object') return p;
                  return { text: String(p || '') };
                });
                
                const constructedMsg: any = {
                  role: msgInfo.role || 'user',
                  parts: partsList.length > 0 ? partsList : [{ text: '' }]
                };
                if (msgInfo.timestamp) {
                  constructedMsg._timestamp = msgInfo.timestamp;
                }
                if (msgInfo.model) {
                  constructedMsg._model = msgInfo.model;
                }
                messages.push(constructedMsg);
              });
            }
            
            // Also check if session has direct messages column in aiSessions sheet
            if (messages.length === 0) {
              const directMessages = getField(session, 'messages', 'history', 'chat', 'Messages');
              if (directMessages) {
                let parsedDirect: any[] = [];
                if (typeof directMessages === 'string') {
                  try {
                    const parsed = JSON.parse(directMessages);
                    if (Array.isArray(parsed)) parsedDirect = parsed;
                  } catch (err) {
                    // Non-JSON string
                    parsedDirect = [{ role: 'user', text: directMessages }];
                  }
                } else if (Array.isArray(directMessages)) {
                  parsedDirect = directMessages;
                }
                
                if (parsedDirect.length > 0) {
                  messages.push(...parsedDirect.map(m => {
                    if (typeof m === 'string') return { role: 'user', parts: [{ text: m }] };
                    const role = m.role || 'user';
                    let parts = m.parts;
                    if (!parts && m.content) {
                      parts = typeof m.content === 'string' ? [{ text: m.content }] : m.content;
                    }
                    if (!parts && m.text) {
                      parts = [{ text: m.text }];
                    }
                    return {
                      role,
                      parts: Array.isArray(parts) ? parts : [{ text: String(parts || '') }],
                      _timestamp: m._timestamp || m.timestamp,
                      _model: m._model || m.model
                    };
                  }));
                }
              }
            }
            
            return {
              id: sessionId,
              projectId,
              title,
              messages: messages,
              updatedAt
            };
          });

          // Merge server-reconstructed sessions with legacy LocalStorage AI sessions safely
          const localSessions = useAiStore.getState().sessions || [];
          const mergedSessionsMap = new Map<string, any>();
          let hasLocalOnlyMerge = false;

          // 1. Add all server reconstructed sessions
          reconstructedSessions.forEach(serverSession => {
            if (serverSession && serverSession.id && !fromDeletedProject(serverSession)) {
              mergedSessionsMap.set(serverSession.id, serverSession);
            }
          });

          // 2. Merge local sessions without wiping server message history
          localSessions.forEach((localSession) => {
            if (!localSession || !localSession.id) return;
            const serverSession = mergedSessionsMap.get(localSession.id);
            if (!serverSession) {
              // Local-only session
              mergedSessionsMap.set(localSession.id, localSession);
              hasLocalOnlyMerge = true;
            } else {
              const localMsgCount = localSession.messages?.length || 0;
              const serverMsgCount = serverSession.messages?.length || 0;
              
              if (localMsgCount > serverMsgCount) {
                // Local has more messages (e.g. user just chatted before sync finished)
                mergedSessionsMap.set(localSession.id, localSession);
                hasLocalOnlyMerge = true;
              } else if (serverMsgCount > 0 && localMsgCount === 0) {
                // Keep server session with full messages
                // serverSession already in map
              } else if (isLocalNewer(localSession.updatedAt, serverSession.updatedAt) && localMsgCount >= serverMsgCount) {
                mergedSessionsMap.set(localSession.id, localSession);
                hasLocalOnlyMerge = true;
              }
            }
          });

          const mergedSessions = Array.from(mergedSessionsMap.values());

          // Select the best active session (prefer existing active if valid and has messages, or most recent with messages)
          const currentActiveId = useAiStore.getState().activeSessionId;
          const activeSessionInList = mergedSessions.find(s => s.id === currentActiveId);
          const activeHasMessages = (activeSessionInList?.messages?.length || 0) > 0;

          const sessionWithMessages = mergedSessions
            .filter(s => (s.messages?.length || 0) > 0)
            .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0];

          const newActiveSessionId = (activeHasMessages ? currentActiveId : null) || sessionWithMessages?.id || currentActiveId || mergedSessions[0]?.id || null;

          // Update AI store state
          useAiStore.setState({ 
            sessions: mergedSessions,
            activeSessionId: newActiveSessionId
          });

          if (hasLocalOnlyMerge) {
            requiresSync = true;
          }
          
          console.log('Loaded data from GAS DB.');
          
          // If we generated new IDs for rows that were missing them in the Google Sheet,
          // sync them back to the Sheet so they are persisted and don't regenerate on next load.
          if (requiresSync) {
             // Queued rather than pushed directly, so a failed write is retried
             // and shows in the header instead of vanishing.
             console.log('Local-only or repaired records found, queueing a save back to the Sheet...');
             useSyncQueueStore.getState().addJob('all', 'after-load', 'UPDATE', null);
          }
        } finally {
          gasSyncService.isApplyingServerState = false;
        }
      }
      consecutivePollingErrors = 0;
      store.setSyncStatus('synced');
      store.setLastSyncedAt(Date.now());
    } catch (e) {
      console.error('Failed to load DB from GAS', e);
      if (isBackground) {
        consecutivePollingErrors++;
        console.warn(`Background polling error #${consecutivePollingErrors}:`, e);
        if (consecutivePollingErrors >= 3) {
          store.setSyncStatus('error', e instanceof Error ? e.message : String(e));
        } else {
          // Keep as synced or prevStatus during transient dropouts to prevent flickering red layout states
          if (prevStatus === 'synced') {
            store.setSyncStatus('synced');
          } else {
            store.setSyncStatus(prevStatus);
          }
        }
      } else {
        store.setSyncStatus('error', e instanceof Error ? e.message : String(e));
        throw e;
      }
    } finally {
      gasSyncService.isPerformingLoad = false;
    }
  }
};
