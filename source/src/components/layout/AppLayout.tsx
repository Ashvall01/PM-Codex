import React, { ReactNode, useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  MessageSquare,
  Search,
  Settings,
  Cloud,
  CloudOff,
  RefreshCw,
  AlertTriangle,
  ChevronRight
} from 'lucide-react';
import { GeminiIcon } from '../icons/GeminiIcon';
import AISidebar from './AISidebar';
import { PIISuggestionOverlay } from './PIISuggestionOverlay';
import { PIIGlobalHighlighter } from './PIIGlobalHighlighter';
import { PIISelectionToolbar } from './PIISelectionToolbar';
import { useAppStore } from '../../store/appStore';
import { useBillingStore } from '../../store/billingStore';
import { gasSyncService } from '../../services/gasSyncService';
import { useAcrStore } from '../../store/acrStore';
import { useAiStore } from '../../store/aiStore';

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * The module bar, grouped by what you are doing.
 *
 * It was eleven modules in a row, which does not fit a laptop screen next to a
 * project name. Grouped, it reads at a glance and keeps every module one click
 * away. MEETINGS (analysing a recording with Gemini) is reached from MoM now:
 * meetings usually arrive through Claude, and two tabs for one job was
 * noise. MoM stays lit while you are in it.
 */
interface NavItem { path: string; label: string; alsoActiveOn?: string[] }
const navGroups: { label: string; items: NavItem[] }[] = [
  { label: '', items: [{ path: '/overview', label: 'OVERVIEW' }] },
  { label: 'PLAN', items: [{ path: '/timeline', label: 'TIMELINE' }, { path: '/deliverables', label: 'DELIVERABLES' }] },
  { label: 'TRACK', items: [{ path: '/tasks-issues', label: 'TASKS & ISSUES' }, { path: '/risks', label: 'RISKS' }] },
  { label: 'MEET', items: [{ path: '/mom', label: 'MOM', alsoActiveOn: ['/meetings'] }] },
  { label: 'PEOPLE', items: [{ path: '/stakeholders', label: 'STAKEHOLDERS' }] },
  { label: 'RECORDS', items: [{ path: '/documents', label: 'DOCUMENTS' }, { path: '/codex', label: 'CODEX' }, { path: '/billing', label: 'BILLING' }] },
];

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const isAIOpen = useAiStore((state) => state.isSidebarOpen);
  const setIsAIOpen = useAiStore((state) => state.setSidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const [isResizing, setIsResizing] = useState(false);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const { activeProjectId, projects, syncStatus, lastSyncedAt, syncErrorMessage, gasUrl, syncHeldBack } = useAppStore();
  const activeProject = projects.find(p => p.id === activeProjectId);
  const activeAcrId = useAcrStore(state => state.activeAcrId);
  const isChatHiddenDuringReview = useAcrStore(state => state.isChatHiddenDuringReview);
  const isBillingEnabled = useBillingStore(state => state.isEnabled);

  /**
   * The assistant pane holds a chat, a review panel, or both.
   *
   * Reviewing on its own must not leave the pane at chat-plus-review width with
   * a review rattling around inside it, so the extra 360px is only added when
   * the chat is actually there. The floor of 420px keeps an old-value /
   * new-value pair on one line.
   */
  const isReviewOnly = !!activeAcrId && isChatHiddenDuringReview;
  const actualSidebarWidth = isReviewOnly
    ? Math.max(sidebarWidth, 420)
    : sidebarWidth + (activeAcrId ? 360 : 0);

  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(item => item.path !== '/billing' || isBillingEnabled) }))
    .filter(g => g.items.length > 0);

  /**
   * The module bar is wider than a laptop screen once a project has a long
   * name, and the last modules (MEETINGS, CODEX) sat off the edge with nothing
   * to say they were there — even when one of them was the page you were on.
   * A fade marks the side with more, and the current module scrolls into view.
   */
  const location = useLocation();
  const [navOverflow, setNavOverflow] = useState({ left: false, right: false });
  const measureNav = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setNavOverflow(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  };
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const active = el.querySelector('a[data-module][data-active="true"]') as HTMLElement | null;
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measureNav();
    const ro = new ResizeObserver(measureNav);
    ro.observe(el);
    return () => ro.disconnect();
  }, [location.pathname, activeProject?.name, isBillingEnabled]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth >= 300 && newWidth <= 800) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (scrollContainerRef.current) {
        if (e.deltaY !== 0) {
          e.preventDefault();
          scrollContainerRef.current.scrollLeft += e.deltaY;
        }
      }
    };
    
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
    }
    
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel);
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-qb-bg text-qb-black font-sans selection:bg-qb-orange selection:text-white">
      <PIIGlobalHighlighter />
      <PIISuggestionOverlay />
      <PIISelectionToolbar />
      
      {/* Sleek Top Navigation */}
      <header className="flex-shrink-0 h-14 px-6 lg:px-8 flex items-center justify-between border-b border-qb-light-grey bg-transparent z-30">
        <div className="flex items-center h-full w-full overflow-hidden">
          <button 
            onClick={() => setIsAIOpen(!isAIOpen)}
            className={`flex-shrink-0 flex items-center h-full mr-4 transition-colors duration-200 ${isAIOpen ? 'text-qb-orange' : 'text-qb-grey hover:text-qb-black'}`}
            title="Toggle Assistant"
          >
            <GeminiIcon className="w-5 h-5" />
          </button>
          <div className="relative h-full w-full overflow-hidden">
          {navOverflow.left && <div className="pointer-events-none absolute left-0 top-0 h-full w-10 z-10 bg-gradient-to-r from-qb-bg to-transparent" />}
          {navOverflow.right && (
            <div className="pointer-events-none absolute right-0 top-0 h-full w-16 z-10 bg-gradient-to-l from-qb-bg via-qb-bg/80 to-transparent flex items-center justify-end">
              <ChevronRight className="w-3.5 h-3.5 text-qb-orange" />
            </div>
          )}
          <nav 
            ref={scrollContainerRef}
            onScroll={measureNav}
            className="flex gap-4 overflow-x-auto no-scrollbar h-full items-stretch relative w-full"
          >
           <NavLink 
             to="/projects"
             onClick={() => {
               // Unset active project on clicking home
               useAppStore.getState().setActiveProject(null);
             }}
             className="font-black text-qb-black mr-2 uppercase tracking-widest text-sm flex items-center gap-2 hover:text-qb-orange transition-colors whitespace-nowrap flex-shrink-0 h-full"
           >
             <div className="flex-shrink-0 w-2 h-2 bg-qb-orange"></div>
             <span className="max-w-[200px] truncate" title={activeProject ? `${activeProject.name} — back to all projects` : undefined}>
               {activeProject ? activeProject.name : 'PM CODEX'}
             </span>
           </NavLink>
           {visibleGroups.map((group, gi) => (
             <div key={group.label || gi} className={`flex flex-col h-full flex-shrink-0 ${gi > 0 ? 'pl-4 border-l border-qb-light-grey/70' : ''}`}>
               <span className="h-4 pt-1.5 text-[9px] leading-none font-black uppercase tracking-[0.2em] text-qb-grey/60 whitespace-nowrap">{group.label || '\u00a0'}</span>
               <div className="flex-1 flex items-stretch gap-4">
                 {group.items.map((item) => {
                   const active = location.pathname.startsWith(item.path)
                     || !!item.alsoActiveOn?.some(p => location.pathname.startsWith(p));
                   return (
                     <NavLink
                       key={item.path}
                       to={item.path}
                       data-module
                       data-active={active ? 'true' : 'false'}
                       className={`relative text-xs uppercase tracking-wider whitespace-nowrap transition-colors duration-200 flex items-center ${active ? 'font-black text-qb-black' : 'font-normal text-qb-grey hover:text-qb-dark-grey'}`}
                     >
                       {active && <div className="absolute bottom-0 left-0 w-full h-[2px] bg-qb-orange"></div>}
                       {item.label}
                     </NavLink>
                   );
                 })}
               </div>
             </div>
           ))}
        </nav>
          </div>
        </div>
        
        {/* Right side controls */}
        <div className="flex-shrink-0 ml-4 flex items-center gap-4 h-full">
           {/* Quantum Break style Sync Status Indicator */}
           <div className="hidden md:flex items-center gap-2">
             {!gasUrl ? (
               <div className="border border-qb-light-grey px-2.5 py-1 bg-qb-black/5 flex items-center gap-1.5 uppercase font-bold tracking-widest text-[10px] text-qb-grey font-sans" title="No sheet connected. Work is saved in browser LocalStorage.">
                 <CloudOff className="w-3 h-3 text-qb-grey" />
                 <span>LOCAL REPO (NO DB)</span>
               </div>
             ) : syncStatus === 'syncing' ? (
               <div className="border border-qb-orange px-2.5 py-1 bg-qb-orange/5 flex items-center gap-1.5 uppercase font-bold tracking-widest text-[10px] text-qb-orange font-sans animate-pulse">
                 <RefreshCw className="w-3 h-3 animate-spin text-qb-orange" />
                 {/* Replace this div if queue store needed, but for now just simple wording */}
                 <span>SAVING…</span>
               </div>
             ) : syncStatus === 'synced' ? (
               <div className="border border-qb-green px-2.5 py-1 bg-qb-green/5 flex items-center gap-1.5 uppercase font-bold tracking-widest text-[10px] text-qb-green font-sans" title={lastSyncedAt ? `Last synced at ${new Date(lastSyncedAt).toLocaleString()}` : 'Synced with sheet DB'}>
                 <Cloud className="w-3 h-3 text-qb-green" />
                 <span onClick={() => gasSyncService.retryNow()} className="hover:text-black hover:underline cursor-pointer transition-colors" title="Saved to the Google Sheet. Click to save again now.">SAVED</span>

               </div>
             ) : (
               <div className="border border-qb-magenta px-2.5 py-1 bg-qb-magenta/5 flex items-center gap-1.5 uppercase font-bold tracking-widest text-[10px] text-qb-magenta font-sans cursor-pointer group relative" title={syncErrorMessage || 'Sync paused / connection error. Work is saved locally.'}>
                 <AlertTriangle className="w-3 h-3 text-qb-magenta" />
                 <span onClick={() => gasSyncService.retryNow()} className="hover:text-qb-orange hover:underline cursor-pointer transition-colors animate-pulse" title="Google Sheet is offline or connection failed. Click here to RETRY synchronization.">{syncHeldBack ? 'SAVE HELD BACK' : 'SYNC PAUSED'}</span>
                 {syncHeldBack ? (
                 <div className="absolute right-0 top-full mt-2 w-80 bg-qb-black border border-qb-magenta p-3 text-[10px] text-white tracking-normal leading-relaxed hidden group-hover:block hover:block shadow-xl z-50 normal-case font-sans">
                   <div className="font-black uppercase text-white tracking-widest mb-1.5 flex items-center gap-1.5"><span className="w-2 h-2 bg-qb-magenta" />SAVE HELD BACK</div>
                   <div className="mb-1.5 text-white font-bold">This save would remove most of these from your Google Sheet:</div>
                   <div className="mb-2 font-mono text-qb-orange">{syncHeldBack}</div>
                   <div className="mb-1 text-qb-light-grey">If you deleted them on purpose, save anyway. If you did not, do not save: the Sheet keeps everything while this is held, and your changes stay in this browser.</div>
                   <button
                     type="button"
                     onClick={(e) => { e.stopPropagation(); gasSyncService.confirmHeldSave(); }}
                     className="mt-3 w-full bg-qb-magenta hover:bg-white hover:text-qb-black text-white text-center font-black py-2 uppercase transition-all tracking-widest text-[9px] cursor-pointer"
                   >
                     I deleted them — save anyway
                   </button>
                 </div>
                 ) : (
                 <div className="absolute right-0 top-full mt-2 w-64 bg-qb-black border border-qb-light-grey p-3 text-[10px] text-white font-mono tracking-normal leading-relaxed capitalize hidden group-hover:block hover:block shadow-xl z-50 transition-all">
                   <div className="font-sans font-black uppercase text-qb-magenta tracking-widest mb-1.5 text-[10px]">RECOVERY ACTION SUGGESTED:</div>
                   <div className="mb-1 text-white">Google Sheet Offline or Connection Terminated.</div>
                   <div className="mb-1 text-qb-grey">We saved your data safely inside the browser LocalStorage. Feel free to continue working.</div>
                   <div className="text-qb-magenta border-t border-white/10 pt-1.5 mt-1.5 lowercase">error: {syncErrorMessage || 'failed to fetch / cors block'}</div>
                    <button 
                      type="button" 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        gasSyncService.retryNow(); 
                      }}
                      className="mt-3 w-full bg-qb-orange hover:bg-white hover:text-qb-black text-white text-center font-black py-2 uppercase transition-all tracking-widest text-[9px] cursor-pointer"
                    >
                      RETRY DATABASE SYNC
                    </button>
                 </div>
                 )}
               </div>
             )}
           </div>

           <NavLink 
             to="/settings" 
             className={({ isActive }) => `text-qb-grey hover:text-qb-black transition-colors flex items-center justify-center ${isActive ? 'text-qb-orange' : ''}`}
             title="Settings"
           >
             <Settings className="w-4 h-4" />
           </NavLink>
        </div>
      </header>

      {/* A change request from Claude has no chat to live in. It is announced
          here, at project level, because that is what it actually belongs to.
          Clicking opens the assistant panel on it. Nothing shows when there is
          none pending, so this row costs nothing in the normal case. */}
      <ClaudeProposalBar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        {/* Left AI Assistant Sidebar - Restyled */}
        <aside 
          className={`flex-shrink-0 absolute lg:relative left-0 h-full z-40 overflow-hidden bg-qb-bg shadow-2xl lg:shadow-none
            ${isResizing ? '' : 'transition-[width,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]'}
            ${isAIOpen 
               ? 'w-full sm:w-[var(--sidebar-width)] border-r border-qb-light-grey translate-x-0' 
               : 'w-full sm:w-0 -translate-x-full lg:translate-x-0 border-transparent lg:border-r-0'
            }
          `}
          style={{ '--sidebar-width': `${actualSidebarWidth}px` } as React.CSSProperties}
        >
          <div className="w-full sm:w-[var(--sidebar-width)] h-full flex flex-col relative">
            <AISidebar onClose={() => setIsAIOpen(false)} isOpen={isAIOpen} />
            {isAIOpen && (
              <div 
                className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-50 hover:bg-qb-orange transition-colors hidden sm:block"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizing(true);
                }}
              />
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-auto p-4 lg:p-8 h-full flex flex-col">
          <div className="w-full h-full mx-auto flex-1 flex flex-col">
            {children}
          </div>
        </main>
      </div>

    </div>
  );
};

/**
 * The one place a Claude change request can be reached.
 *
 * Gemini's requests appear as a card inside the chat that asked for them.
 * Claude sits outside the browser and has no chat, so before this existed its
 * requests either had to hijack whichever conversation was open, or be
 * unreachable. Neither is acceptable once two requests can be pending at once.
 */
const ClaudeProposalBar: React.FC = () => {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const setActiveAcrId = useAcrStore((state) => state.setActiveAcrId);
  const setIsAIOpen = useAiStore((state) => state.setSidebarOpen);

  const pending = useAcrStore((state) =>
    state.acrs.find(
      (a: any) =>
        a.status === 'pending' &&
        (a.origin || 'gemini') === 'claude' &&
        a.projectId === activeProjectId
    )
  );

  if (!pending) return null;

  const count = pending.changes.length;

  return (
    <button
      type="button"
      onClick={() => {
        // Remember whether we are the ones opening the sidebar, so closing
        // this review (X / sign off / reject, all in acrStore's
        // setActiveAcrId) can put it back rather than leaving Claude's chat
        // open when the user never asked to see it. See PLAN.md section 17.
        if (!useAiStore.getState().isSidebarOpen) {
          useAiStore.getState().setSidebarOpenedByAcr(true);
        }
        setIsAIOpen(true);
        setActiveAcrId(pending.id);
      }}
      className="w-full flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-qb-orange/10 border-b border-qb-orange text-left hover:bg-qb-orange/20 transition-colors cursor-pointer"
    >
      <span className="flex-shrink-0 w-2 h-2 bg-qb-orange animate-pulse" />
      <span className="text-[10px] font-black uppercase tracking-widest text-qb-black font-sans">
        Claude has proposed {count} change{count === 1 ? '' : 's'}
      </span>
      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-qb-orange ml-auto">
        Review →
      </span>
    </button>
  );
};

export default AppLayout;
