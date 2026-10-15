import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { useTimelineStore } from '../../store/timelineStore';
import { Plus, LayoutGrid, BarChart2 } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import GanttChart from './Tabs/GanttChart';
import ActivityTable from './Tabs/ActivityTable';
import { RevisionManager } from './RevisionManager';
import { useAcrStore } from '../../store/acrStore';

gsap.registerPlugin(useGSAP);

const Timeline: React.FC = () => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const projectTimeline = useTimelineStore(state => state.getProjectTimeline(activeProjectId || ''));
  const createProjectTimeline = useTimelineStore(state => state.createProjectTimeline);
  const setActivities = useTimelineStore(state => state.setActivities);
  const recalcRevision = useTimelineStore(state => state.recalcRevision);
  
  const revision = projectTimeline ? projectTimeline.revisions.find(r => r.id === projectTimeline.activeRevisionId) : undefined;
  
  // Formulas such as TODAY() move on by themselves: work them out again when
  // the timeline opens. Nothing is written when no answer changed.
  useEffect(() => {
    if (activeProjectId && revision?.id) recalcRevision(activeProjectId, revision.id);
  }, [activeProjectId, revision?.id, recalcRevision]);

  // Auto-update statuses based on dates: a row past its target start with no
  // actual start is "Not Started"; one past its target end, started but not
  // finished, is "Delayed WIP".
  //
  // It leaves alone what a date cannot judge: a row the user closed or paused
  // (Completed, Completed With Delay, On Hold, Dropped), a finished row, and a
  // status worked out by a formula. Until 24 Sep 2026 it overwrote all of these
  // every time the timeline opened — a Completed row with no actual start date
  // became "Not Started" — and against a status formula the two kept undoing
  // each other without end.
  useEffect(() => {
    if (activeProjectId && revision && revision.activities.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const KEEP = ['Dropped', 'Completed', 'Completed With Delay', 'On Hold'];
      const localDay = (s: string) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
        return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
      };

      let needsUpdate = false;
      const updatedActivities = revision.activities.map(act => {
        if (KEEP.includes(act.status)) return act;
        if (act.formulas?.status) return act;
        if (act.actualCompletionDate && act.actualCompletionDate.trim() !== '') return act;

        let newStatus = act.status;

        const actStartEmpty = !act.actualStartDate || act.actualStartDate.trim() === '';
        const actEndEmpty = !act.actualCompletionDate || act.actualCompletionDate.trim() === '';
        
        const targetEndObj = localDay(act.targetCompletionDate);
        const targetStartObj = localDay(act.targetStartDate);

        if (actStartEmpty && targetStartObj && targetStartObj < today) {
          if (newStatus !== 'Not Started') newStatus = 'Not Started';
        } else if (!actStartEmpty && actEndEmpty && targetEndObj && targetEndObj < today) {
          if (newStatus !== 'Delayed WIP') newStatus = 'Delayed WIP';
        }

        if (newStatus !== act.status) {
          needsUpdate = true;
          return { ...act, status: newStatus };
        }
        return act;
      });

      if (needsUpdate) {
        setActivities(activeProjectId, revision.id, updatedActivities);
      }
    }
  }, [revision?.activities, activeProjectId, revision?.id, setActivities]);

  // The timeline opens on the Gantt chart. A baseline with no rows yet opens
  // on the table instead, because that is where the first row is added.
  const [activeTab, setActiveTab] = useState<'gantt' | 'table'>(
    () => (revision && revision.activities.length === 0 ? 'table' : 'gantt'),
  );

  // A proposed change to the holiday list is shown in the table's Holidays
  // list, so focusing one in the review panel brings the table forward.
  const focusedChangeName = useAcrStore((s) => {
    const acr = s.acrs.find((a) => a.id === s.activeAcrId && a.status === 'pending');
    return acr?.changes.find((c) => c.id === s.activeAcrChangeId)?.name || null;
  });
  useEffect(() => {
    if (focusedChangeName === 'setTimelineHolidays') setActiveTab('table');
  }, [focusedChangeName]);

  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.from('.fade-enter', {
      y: 20,
      opacity: 0,
      duration: 0.6,
      stagger: 0.1,
      ease: 'power3.out',
      clearProps: 'transform'
    });
  }, { scope: containerRef, dependencies: [activeTab, revision?.id] });

  // Safety net if accessed without active project
  if (!activeProjectId) return null;

  if (!projectTimeline || !revision) {
    return (
      <div ref={containerRef} className="h-full flex flex-col items-center justify-center p-8 bg-transparent border border-qb-light-grey">
        <div className="fade-enter w-16 h-1 bg-qb-orange mb-8 content-center"></div>
        <h2 className="fade-enter text-4xl font-black text-qb-black uppercase tracking-widest mb-4 text-center">NO BASELINE ESTABLISHED</h2>
        <p className="fade-enter text-qb-grey font-medium uppercase tracking-widest text-sm mb-8 text-center max-w-md">INITIALIZE A NEW TIMELINE BASELINE TO START SCHEDULING ACTIVITIES AND MILESTONES.</p>
        <button 
          onClick={() => createProjectTimeline(activeProjectId)}
          className="fade-enter flex items-center gap-3 bg-qb-black text-white px-8 py-5 font-black uppercase tracking-widest justify-center text-sm hover:bg-qb-orange transition-colors shadow-lg"
        >
          <Plus className="w-5 h-5" />
          ESTABLISH BASELINE
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Tab Header */}
      <div className="fade-enter flex items-center justify-between border-b border-qb-light-grey flex-shrink-0 bg-transparent relative z-30">
        <div className="flex">
          <button 
            onClick={() => setActiveTab('gantt')}
            className={`flex-shrink-0 flex items-center gap-2 px-6 py-3 font-black uppercase tracking-widest text-xs transition-colors relative ${activeTab === 'gantt' ? 'text-qb-black' : 'text-qb-grey hover:text-qb-dark-grey'}`}
          >
            <BarChart2 className="w-4 h-4" />
            GANTT CHART
            {activeTab === 'gantt' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-qb-orange"></div>}
          </button>
          <button 
            onClick={() => setActiveTab('table')}
            className={`flex-shrink-0 flex items-center gap-2 px-6 py-3 font-black uppercase tracking-widest text-xs transition-colors relative ${activeTab === 'table' ? 'text-qb-black' : 'text-qb-grey hover:text-qb-dark-grey'}`}
          >
            <LayoutGrid className="w-4 h-4" />
            ACTIVITY TABLE
            {activeTab === 'table' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-qb-orange"></div>}
          </button>
        </div>
        
        <RevisionManager projectId={activeProjectId} />
      </div>

      <div className="fade-enter flex-1 overflow-hidden relative">
        {activeTab === 'gantt' ? <GanttChart projectId={activeProjectId} revision={revision} /> : <ActivityTable projectId={activeProjectId} revision={revision} />}
      </div>
    </div>
  );
};

export default Timeline;
