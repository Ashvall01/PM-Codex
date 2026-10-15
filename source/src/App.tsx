import React, { useRef, useEffect, useState, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import SetupWizard from './features/SetupWizard/SetupWizard';
import MainMenu from './features/Projects/MainMenu';
import Timeline from './features/Timeline/Timeline';
import Deliverables from './features/Deliverables/Deliverables';
import { TasksTracker } from './features/Tasks/TasksTracker';
import Risks from './features/Risks/Risks';
import Mom from './features/Mom/Mom';
import Overview from './features/Overview/Overview';
import { useAppStore } from './store/appStore';
import { useTimelineStore } from './store/timelineStore';
import { useDeliverablesStore } from './store/deliverablesStore';
import { useTasksStore } from './store/tasksStore';
import { useCodexStore } from './store/codexStore';
import { useDocumentsStore } from './store/documentsStore';
import { useBillingStore } from './store/billingStore';
import { useRisksStore } from './store/risksStore';
import { useStakeholdersStore } from './store/stakeholdersStore';
import { useMomStore } from './store/momStore';
import { usePIIStore } from './store/piiStore';
import { useAiStore } from './store/aiStore';
import { useAcrStore } from './store/acrStore';
import { useSyncQueueStore } from './store/syncQueueStore';
import { trackArrayDifferences } from './utils/diffing';
import { runStorageMaintenance } from './utils/safeStorage';
import { repairAliasReferences } from './utils/aliasRepair';


import { gasSyncService, EXPECTED_GAS_VERSION } from './services/gasSyncService';
// Connects this tab to the local PM Codex Bridge so Claude can read the project.
// Importing is enough — the client starts itself and does nothing when no bridge
// is running. Read-only; it never writes to the stores or to Google Sheets.
import './services/bridgeClient';

import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

// Screens used less often load when first opened, not with the app. The five
// working screens (Timeline to MoM) stay in the main download.
const Documents = lazy(() => import('./features/Documents/Documents').then(m => ({ default: m.Documents })));
const Stakeholders = lazy(() => import('./features/Stakeholders/Stakeholders').then(m => ({ default: m.Stakeholders })));
const Billing = lazy(() => import('./features/Billing/Billing').then(m => ({ default: m.Billing })));
const Meetings = lazy(() => import('./features/Meetings/Meetings').then(m => ({ default: m.Meetings })));
const Codex = lazy(() => import('./features/Codex/Codex'));
const Settings = lazy(() => import('./features/Settings/Settings'));


const ProjectRoutes = () => {
  const { activeProjectId } = useAppStore();
  
  if (!activeProjectId) {
    return <Navigate to="/projects" replace />;
  }

  return (
    <AppLayout>
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/deliverables" element={<Deliverables />} />
        <Route path="/deliverables/archive" element={<Deliverables archived />} />
        <Route path="/tasks-issues" element={<TasksTracker />} />
        {/* The archive is its own address so the bridge can report which of the
            two the user is looking at. The left-hand nav has no `end` prop, so
            TASKS & ISSUES stays lit on both. */}
        <Route path="/tasks-issues/archive" element={<TasksTracker archived />} />
        <Route path="/risks" element={<Risks />} />
        <Route path="/risks/archive" element={<Risks archived />} />
        <Route path="/mom" element={<Mom />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/stakeholders" element={<Stakeholders />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/codex" element={<Codex />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
      </Suspense>
    </AppLayout>
  );
};

export default function App() {
  const { isSetupComplete, gasUrl } = useAppStore();
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [showSkipButton, setShowSkipButton] = useState(false);

  useEffect(() => {
    // Proactively clean up expendable localStorage on startup
    runStorageMaintenance();
  }, []);

  useEffect(() => {
    if (!initialLoadDone) {
      const timer = setTimeout(() => {
        setShowSkipButton(true);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [initialLoadDone]);

  useEffect(() => {
    if (!gasUrl) {
      setInitialLoadDone(true);
      return;
    }
    
    let isMounted = true;
    let didTimeout = false;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      console.warn("GAS action=version call timed out (6s). Falling back to local offline storage.");
      controller.abort();
    }, 6000);
    
    fetch(`${gasUrl}?action=version&t=${new Date().getTime()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async res => {
         clearTimeout(timeoutId);
         if (!isMounted) return null;
         const text = await res.text();
         const trimmedText = text.trim();
         if (trimmedText.startsWith('<!DOCTYPE') || trimmedText.startsWith('<html') || trimmedText.startsWith('<DOCTYPE')) {
             throw new Error('Received HTML webpage instead of JSON database response. Please verify that your Google Apps Script is deployed *and* configured with access set to "Anyone".');
         }
         try {
             return JSON.parse(text);
         } catch (e) {
             throw new Error(`Database returned invalid format (not JSON or script issue): "${text.substring(0, 100)}..."`);
         }
      })
      .then(data => {
         if (!isMounted || !data) return;
         if (data.version !== EXPECTED_GAS_VERSION) {
             console.warn(`GAS Version mismatch. Expected ${EXPECTED_GAS_VERSION}, got ${data.version}. Falling back to local storage.`);
             useAppStore.setState({ gasUrl: null });
             setInitialLoadDone(true);
         } else {
             gasSyncService.loadAll(gasUrl)
              .catch(err => {
                 console.warn("GAS loadAll warning:", err);
              })
              .finally(() => {
                 if (isMounted) setInitialLoadDone(true);
              });
         }
      })
      .catch(err => {
         clearTimeout(timeoutId);
         if (!isMounted) return;
         
         const isAbort = err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('abort');
         if (isAbort) {
           if (didTimeout) {
             useAppStore.getState().setSyncStatus('error', 'GAS connection timed out. Working offline.');
           }
         } else {
           console.warn("Failed to check GAS version (operating in offline mode):", err);
           // Do not clear gasUrl on generic connection/fetch error.
           // This allows the app to load existing offline state from LocalStorage.
           useAppStore.getState().setSyncStatus('error', err instanceof Error ? err.message : String(err));
         }
         setInitialLoadDone(true);
      });
      
    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [gasUrl]);

  useEffect(() => {
    if (!initialLoadDone) return;
    
    // One-time migration for PII tokens to standard format [Redacted_Category_1]
    const piiState = usePIIStore.getState();
    let hasMigration = false;
    const newPiiEntries = [...piiState.entries];
    
    for (let i = 0; i < newPiiEntries.length; i++) {
      const entry = newPiiEntries[i];
      if (!entry.placeholder.match(/^\[Redacted_[A-Za-z]+_\d+\]$/)) {
          hasMigration = true;
          let counter = 1;
          let newPlaceholder = `[Redacted_${entry.type}_${counter}]`;
          while (newPiiEntries.some(e => e.projectId === entry.projectId && e.id !== entry.id && e.placeholder === newPlaceholder)) {
            counter++;
            newPlaceholder = `[Redacted_${entry.type}_${counter}]`;
          }
          newPiiEntries[i] = { ...entry, placeholder: newPlaceholder };
      }
    }
    
    if (hasMigration) {
       usePIIStore.setState({ entries: newPiiEntries });
       gasSyncService.trackLocalChange();
    }

    // Store previous states to do selective dirty checking and avoid infinite loops
    let prevProjects = useAppStore.getState().projects;
    let prevProjectTimelines = useTimelineStore.getState().projectTimelines;
    let prevDeliverables = useDeliverablesStore.getState().deliverables;
    let prevTasks = useTasksStore.getState().tasks;
    let prevRisks = useRisksStore.getState().risks;
    let prevMoms = useMomStore.getState().moms;
    let prevDocuments = useDocumentsStore.getState().documents;
    let prevMilestones = useBillingStore.getState().milestones;
    let prevStakeholders = useStakeholdersStore.getState().stakeholders;
    let prevPages = useCodexStore.getState().pages;
    let prevEntries = usePIIStore.getState().entries;
    let prevSessions = useAiStore.getState().sessions;
    let prevAcrs = useAcrStore.getState().acrs;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const syncStatus = useAppStore.getState().syncStatus;
      // Changes wait up to 5 seconds before they are sent, and a failed save
      // stays queued: closing now would leave them in this browser only.
      const unsaved = useAppStore.getState().gasUrl
        && useSyncQueueStore.getState().jobs.some(j => j.status !== 'COMPLETED');
      if (gasSyncService.hasPendingSync() || syncStatus === 'syncing' || unsaved) {
        e.preventDefault();
        e.returnValue = ''; // Triggers browser warning
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Subscribe to all changes to trigger async save to GAS only when actual data changes
    const trackChanges = (storeName: string, prevArray: any, newArray: any) => {
      if (!gasSyncService.isApplyingServerState) {
        if (Array.isArray(newArray)) {
          trackArrayDifferences(storeName, prevArray, newArray);
        }
        gasSyncService.trackLocalChange();
      }
    };

    const unsubscribes = [
       useAppStore.subscribe((state) => {
         if (state.projects !== prevProjects) {
           const old = prevProjects;
           prevProjects = state.projects;
           trackChanges('projects', old, prevProjects);
         }
       }),
       useTimelineStore.subscribe((state) => {
         if (state.projectTimelines !== prevProjectTimelines) {
           const old = prevProjectTimelines;
           prevProjectTimelines = state.projectTimelines;
           trackChanges('projectTimelines', old, prevProjectTimelines);
         }
       }),
       useDeliverablesStore.subscribe((state) => {
         if (state.deliverables !== prevDeliverables) {
           const old = prevDeliverables;
           prevDeliverables = state.deliverables;
           trackChanges('deliverables', old, prevDeliverables);
         }
       }),
       useTasksStore.subscribe((state) => {
         if (state.tasks !== prevTasks) {
           const old = prevTasks;
           prevTasks = state.tasks;
           trackChanges('tasks', old, prevTasks);
         }
       }),
       useRisksStore.subscribe((state) => {
         if (state.risks !== prevRisks) {
           const old = prevRisks;
           prevRisks = state.risks;
           trackChanges('risks', old, prevRisks);
         }
       }),
       useMomStore.subscribe((state) => {
         if (state.moms !== prevMoms) {
           const old = prevMoms;
           prevMoms = state.moms;
           trackChanges('moms', old, prevMoms);
         }
       }),
       useDocumentsStore.subscribe((state) => {
         if (state.documents !== prevDocuments) {
           const old = prevDocuments;
           prevDocuments = state.documents;
           trackChanges('documents', old, prevDocuments);
         }
       }),
       useBillingStore.subscribe((state) => {
         if (state.milestones !== prevMilestones) {
           const old = prevMilestones;
           prevMilestones = state.milestones;
           trackChanges('milestones', old, prevMilestones);
         }
       }),
       useStakeholdersStore.subscribe((state) => {
         if (state.stakeholders !== prevStakeholders) {
           const old = prevStakeholders;
           prevStakeholders = state.stakeholders;
           trackChanges('stakeholders', old, prevStakeholders);
         }
       }),
       useCodexStore.subscribe((state) => {
         if (state.pages !== prevPages) {
           const old = prevPages;
           prevPages = state.pages;
           trackChanges('pages', old, prevPages);
         }
       }),
       usePIIStore.subscribe((state) => {
         if (state.entries !== prevEntries) {
           const old = prevEntries;
           prevEntries = state.entries;
           trackChanges('entries', old, prevEntries);
         }
       }),
       useAiStore.subscribe((state) => {
         if (state.sessions !== prevSessions) {
           const old = prevSessions;
           prevSessions = state.sessions;
           trackChanges('sessions', old, prevSessions);
         }
       }),
       useAcrStore.subscribe((state) => {
         if (state.acrs !== prevAcrs) {
           const old = prevAcrs;
           prevAcrs = state.acrs;
           trackChanges('acrs', old, prevAcrs);
         }
       }),
    ];

    // References saved as an alias instead of a real id (a Codex page filed
    // under "CDX4") are pointed back at the real record. Runs after the
    // subscriptions above, so a repair is saved to the Sheet like any edit.
    try {
      const repairs = repairAliasReferences();
      if (repairs.length) console.info('[repair] alias references fixed:', repairs);
    } catch (err) {
      console.warn('[repair] alias references not checked:', err);
    }

    return () => {
      unsubscribes.forEach(u => u());
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [initialLoadDone]);

  // Background worker to process the sync job queue
  useEffect(() => {
    if (!gasUrl || !initialLoadDone) return;

    let intervalId: any = null;

    let lastFailedRetry = Date.now();
    const processSyncWorker = async () => {
      // A save that failed five times in a row is retried once a minute, so a
      // Sheet that was briefly unreachable catches up by itself.
      const queue = useSyncQueueStore.getState();
      if (Date.now() - lastFailedRetry > 60000 && queue.jobs.some(j => j.status === 'FAILED')) {
        lastFailedRetry = Date.now();
        queue.retryFailed();
      }
      // Execute gasSyncService's background queue runner
      await gasSyncService.processSyncQueue();
    };

    // Run the worker every 5 seconds
    intervalId = setInterval(processSyncWorker, 5000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [gasUrl, initialLoadDone]);

  if (!isSetupComplete()) {
    return <SetupWizard />;
  }

  if (!initialLoadDone) {
    return (
      <div className="fixed inset-0 bg-qb-bg flex flex-col justify-center items-center text-center z-[9999]">
         <style>{`
          .hourglass-container {
              width: 80px;
              height: 80px;
              display: flex;
              justify-content: center;
              align-items: center;
              /* Premium, dramatic 180/360 flip transition with soft damping */
              animation: flip 4s cubic-bezier(0.1, 0, 0, 1) infinite;
          }

          @keyframes flip {
              0%, 35% { transform: rotate(0deg); }
              50%, 85% { transform: rotate(180deg); }
              100% { transform: rotate(360deg); }
          }

          .glass-outline {
              fill: none;
              stroke: #ff7600;
              stroke-width: 4;
              stroke-linejoin: miter;
          }
          
          .sand {
              fill: #ff7600;
          }

          /* Fluid ease-in-out curves applied to sand levels for a tactile pour */
          .top-sand-fill {
              animation: top-sand-anim 4s cubic-bezier(0.1, 0, 0, 1) infinite;
          }

          .bottom-sand-fill {
              animation: bottom-sand-anim 4s cubic-bezier(0.1, 0, 0, 1) infinite;
          }

          @keyframes top-sand-anim {
              0%, 5% { 
                  clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
                  -webkit-clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
              }
              20%, 49.9% { 
                  clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
                  -webkit-clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
              }
              50%, 55% { 
                  clip-path: polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%);
                  -webkit-clip-path: polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%);
              }
              70%, 100% { 
                  clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
                  -webkit-clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
              }
          }

          @keyframes bottom-sand-anim {
              0%, 5% { 
                  clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
                  -webkit-clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
              }
              20%, 55% { 
                  clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
                  -webkit-clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
              }
              70%, 99.9% { 
                  clip-path: polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%);
                  -webkit-clip-path: polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%);
              }
              100% { 
                  clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
                  -webkit-clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
              }
          }
         `}</style>
         
         <div className="hourglass-container mb-6">
             <svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                 {/* Animated Fills (The "Sand") */}
                 <polygon className="sand top-sand-fill" points="32.7,14 67.3,14 50,44" />
                 <polygon className="sand bottom-sand-fill" points="50,56 67.3,86 32.7,86" />
                 
                 {/* Static Outlines (The "Glass") */}
                 <polygon className="glass-outline" points="32.7,14 67.3,14 50,44" />
                 <polygon className="glass-outline" points="50,56 67.3,86 32.7,86" />
             </svg>
         </div>
         <h2 className="text-sm font-black text-qb-black uppercase tracking-[0.2em]">
           {useSyncQueueStore.getState().getPendingJobs().length > 0 
              ? `SYNCHRONIZING OFFLINE DATA (${useSyncQueueStore.getState().getPendingJobs().length})`
              : 'CONNECTING TO DATABASE'}
         </h2>
          {showSkipButton && (
            <button
              id="btn-skip-to-offline"
              onClick={() => {
                console.log("Bypassing database load by user request - using offline/cached LocalStorage state.");
                setInitialLoadDone(true);
              }}
              className="mt-6 px-6 py-2.5 border border-qb-light-grey hover:border-qb-orange bg-transparent text-qb-dark-grey hover:text-qb-orange text-xs font-black uppercase tracking-widest transition-all duration-200 active:scale-95 cursor-pointer relative z-[10000]"
            >
              Skip & Access Offline Data
            </button>
          )}
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/projects" element={<MainMenu />} />
        <Route path="/*" element={<ProjectRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
