import React, { useState, useRef } from 'react';
import { useAppStore, Project } from '../../store/appStore';
import { ChevronRight, Plus, FolderKanban, Trash2, Upload } from 'lucide-react';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { restoreProjectBackup } from '../../services/projectRemoval';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useNavigate } from 'react-router-dom';
import { useTimelineStore } from '../../store/timelineStore';
import { useTasksStore } from '../../store/tasksStore';
import { useDeliverablesStore } from '../../store/deliverablesStore';
import { useRisksStore } from '../../store/risksStore';
import { useMomStore } from '../../store/momStore';
import { buildProjectPicture, shortDate } from '../../utils/projectHealth';
import { todayISO } from '../../utils/statusStyle';

gsap.registerPlugin(useGSAP);

const MainMenu: React.FC = () => {
  const { projects, setActiveProject, addProject, gasUrl, syncStatus } = useAppStore();
  const [activeTab, setActiveTab] = useState<'select' | 'new'>('select');
  const navigate = useNavigate();

  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [notice, setNotice] = useState<{ tone: 'green' | 'magenta'; text: string } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // A backup file chosen from the computer puts its project back, ids and all.
  const handleRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    const result = restoreProjectBackup(await file.text());
    if (result.ok === true) {
      setNotice({ tone: 'green', text: `"${result.name}" is back, with ${result.count} records. It saves to your Google Sheet with the next save.` });
    } else {
      setNotice({ tone: 'magenta', text: result.reason });
    }
    if (restoreInputRef.current) restoreInputRef.current.value = '';
  };

  const containerRef = useRef<HTMLDivElement>(null);

  // Each project's standing, with the Overview's own numbers, so the list says
  // where attention is needed before anything is opened.
  const projectTimelines = useTimelineStore(st => st.projectTimelines);
  const tasks = useTasksStore(st => st.tasks);
  const deliverables = useDeliverablesStore(st => st.deliverables);
  const risks = useRisksStore(st => st.risks);
  const moms = useMomStore(st => st.moms);
  const pictures = React.useMemo(() => {
    const today = todayISO();
    return Object.fromEntries(projects.map(p => [p.id,
      buildProjectPicture({ projectId: p.id, projectTimelines, tasks, deliverables, risks, moms, today })]));
  }, [projects, projectTimelines, tasks, deliverables, risks, moms]);

  useGSAP(() => {
    gsap.from('.menu-item', {
      x: -50,
      opacity: 0,
      duration: 0.8,
      stagger: 0.1,
      ease: 'power3.out',
    });

    gsap.from('.content-panel', {
      opacity: 0,
      x: 50,
      duration: 0.8,
      ease: 'power3.out',
      delay: 0.2
    });
  }, { scope: containerRef });

  const handleSelectProject = (id: string) => {
    setActiveProject(id);
    navigate('/overview');
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    
    addProject({
      name: newProjectName,
      description: newProjectDesc
    });
    navigate('/overview');
  };

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row min-h-screen bg-qb-bg overflow-y-auto lg:overflow-hidden selection:bg-qb-orange selection:text-white">
      {/* Left Menu Section */}
      <div className="w-full lg:w-1/3 lg:min-w-[300px] border-b lg:border-b-0 lg:border-r border-qb-light-grey flex flex-col justify-center p-8 lg:px-12 py-16 lg:py-0 z-10 bg-transparent lg:shadow-2xl relative min-h-[30vh] lg:min-h-screen">
        <div className="absolute top-6 left-6 lg:top-12 lg:left-12 flex items-center gap-3 menu-item">
           <div className="w-3 h-3 bg-qb-orange"></div>
           <h1 className="text-xl font-black uppercase tracking-widest text-qb-black">PM CODEX</h1>
        </div>

        <nav className="space-y-4 lg:space-y-6 mt-12 lg:mt-0">
          <button 
            onClick={() => setActiveTab('select')}
            className={`menu-item text-left w-full text-2xl lg:text-3xl font-black uppercase tracking-widest transition-colors flex items-center justify-between group
              ${activeTab === 'select' ? 'text-qb-black' : 'text-qb-grey hover:text-qb-dark-grey'}
            `}
          >
            <span>SELECT PROJECT</span>
            {activeTab === 'select' && <ChevronRight className="w-6 h-6 lg:w-8 lg:h-8 text-qb-orange" />}
          </button>
          
          <button 
            onClick={() => setActiveTab('new')}
            className={`menu-item text-left w-full text-2xl lg:text-3xl font-black uppercase tracking-widest transition-colors flex items-center justify-between group
              ${activeTab === 'new' ? 'text-qb-black' : 'text-qb-grey hover:text-qb-dark-grey'}
            `}
          >
            <span>NEW PROJECT</span>
            {activeTab === 'new' && <ChevronRight className="w-6 h-6 lg:w-8 lg:h-8 text-qb-orange" />}
          </button>
        </nav>

        <div className="absolute bottom-6 left-6 lg:bottom-12 lg:left-12 menu-item hidden lg:block">
          {/* The real save state. This used to say ONLINE whatever happened. */}
          <p className="text-xs font-black uppercase tracking-widest text-qb-grey">
            GOOGLE SHEET:{' '}
            {!gasUrl ? <span className="text-qb-grey">NOT CONNECTED</span>
              : syncStatus === 'error' ? <span className="text-qb-magenta">SYNC PAUSED</span>
              : syncStatus === 'syncing' ? <span className="text-qb-orange">SAVING</span>
              : <span className="text-qb-green">CONNECTED</span>}
          </p>
        </div>
      </div>

      {/* Right Content Section */}
      <div className="flex-1 flex items-start lg:items-center justify-center p-6 sm:p-12 lg:p-12 bg-qb-bg relative overflow-visible lg:overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-qb-light-grey/30 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3 opacity-50 pointer-events-none"></div>

        <div className="content-panel w-full max-w-3xl relative z-10">
          
          {activeTab === 'select' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <h2 className="text-xl font-black uppercase tracking-widest text-qb-black border-b border-qb-black pb-4 mb-8 flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-qb-orange" />
                AVAILABLE PROJECTS
              </h2>
              
              {projects.length === 0 ? (
                <div className="text-center py-20 border border-qb-light-grey bg-transparent backdrop-blur">
                  <p className="text-qb-grey font-black uppercase tracking-widest mb-4">NO PROJECTS FOUND</p>
                  <button 
                    onClick={() => setActiveTab('new')}
                    className="text-qb-orange font-black uppercase tracking-widest hover:text-qb-orange/80 transition-colors"
                  >
                    CREATE YOUR FIRST PROJECT
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-4 no-scrollbar">
                  {projects.map((p) => (
                    <div key={p.id} className="relative group/card">
                    <button 
                      onClick={() => handleSelectProject(p.id)}
                      className="w-full text-left bg-transparent border border-qb-light-grey p-6 pr-14 group hover:border-qb-black transition-colors relative overflow-hidden"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-qb-orange scale-y-0 group-hover:scale-y-100 transition-transform origin-top"></div>
                      <h3 className="text-2xl font-bold text-qb-black mb-2">{p.name}</h3>
                      <p className="text-qb-grey font-medium line-clamp-2">{p.description}</p>
                      {(() => {
                        const pic = pictures[p.id];
                        if (!pic) return null;
                        const gap = Math.round((pic.actual - pic.planned) * 100);
                        const tone = gap <= -5 ? 'var(--color-qb-magenta)' : gap < 0 ? 'var(--color-qb-orange)' : 'var(--color-qb-green)';
                        const risksHigh = pic.highRiskCount;
                        return (
                          <div className="mt-4 flex flex-col gap-2.5">
                            {pic.hasTimeline ? (
                              <div className="flex items-center gap-4">
                                <div className="relative h-1.5 flex-1 bg-qb-box-bg">
                                  <div className="absolute inset-y-0 left-0" style={{ width: `${pic.actual * 100}%`, background: tone }} />
                                  <div className="absolute -top-1 -bottom-1 w-[2px] bg-qb-black" style={{ left: `calc(${pic.planned * 100}% - 1px)` }} />
                                </div>
                                <span className="text-[11px] font-mono font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: tone }}>
                                  {Math.round(pic.actual * 100)}% · {gap === 0 ? 'on plan' : `${Math.abs(gap)} pt${Math.abs(gap) === 1 ? '' : 's'} ${gap > 0 ? 'ahead' : 'behind'}`}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-qb-grey">No timeline yet</span>
                            )}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono font-bold uppercase tracking-wider">
                              <span className={pic.lateCount ? 'text-qb-magenta' : 'text-qb-grey'}>{pic.lateCount} late</span>
                              <span className={pic.soonCount ? 'text-qb-orange' : 'text-qb-grey'}>{pic.soonCount} due this week</span>
                              <span className={risksHigh ? 'text-qb-magenta' : 'text-qb-grey'}>{risksHigh} high risk{risksHigh === 1 ? '' : 's'}</span>
                              {pic.finishDay && <span className="text-qb-grey">finish {shortDate(pic.finishDay)}</span>}
                            </div>
                          </div>
                        );
                      })()}
                    </button>
                    {/* Beside the card, not inside it: a click here must never open the project. */}
                    <button
                      type="button"
                      onClick={() => { setNotice(null); setDeleting(p); }}
                      title="Delete this project (a backup is saved first)"
                      className="absolute top-4 right-4 p-2 text-qb-light-grey hover:text-qb-magenta opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    </div>
                  ))}
                </div>
              )}

              {notice && (
                <p className={`text-xs font-bold leading-relaxed border-l-4 pl-3 py-1 ${notice.tone === 'green' ? 'border-qb-green text-qb-dark-grey' : 'border-qb-magenta text-qb-magenta'}`}>
                  {notice.text}
                </p>
              )}

              <div className="flex justify-end">
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => handleRestoreFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => restoreInputRef.current?.click()}
                  className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-qb-grey hover:text-qb-orange transition-colors"
                  title="Bring back a project from a backup file saved when it was deleted"
                >
                  <Upload className="w-3.5 h-3.5" /> Restore from backup
                </button>
              </div>
            </div>
          )}

          {activeTab === 'new' && (
            <div className="animate-in fade-in duration-500">
               <h2 className="text-xl font-black uppercase tracking-widest text-qb-black border-b border-qb-black pb-4 mb-8 flex items-center gap-2">
                <Plus className="w-5 h-5 text-qb-orange" />
                INITIALIZE NEW PROJECT
              </h2>

              <form onSubmit={handleCreateProject} className="space-y-8 bg-transparent border border-qb-light-grey p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-qb-light-grey opacity-20 -translate-y-1/2 translate-x-1/2 rotate-45 pointer-events-none"></div>

                <div>
                  <label className="block text-sm font-black text-qb-grey uppercase tracking-widest mb-3">
                    PROJECT DESIGNATION
                  </label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="E.G. PROJECT ALPHA"
                    className="w-full bg-transparent border-b-2 border-qb-light-grey focus:border-qb-orange px-0 py-3 text-2xl font-bold text-qb-black placeholder-qb-light-grey outline-none transition-colors rounded-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-black text-qb-grey uppercase tracking-widest mb-3">
                    PROJECT PARAMETERS (DESCRIPTION)
                  </label>
                  <textarea
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    placeholder="ENTER PROJECT OVERVIEW AND OBJECTIVES..."
                    rows={4}
                    className="w-full bg-qb-box-bg border border-qb-light-grey focus:border-qb-orange p-4 text-sm font-medium text-qb-black placeholder-qb-grey outline-none transition-colors resize-none"
                  ></textarea>
                </div>

                <div className="pt-6 flex justify-end">
                  <button 
                    type="submit"
                    disabled={!newProjectName.trim()}
                    className="bg-qb-black text-white px-8 py-4 font-black uppercase tracking-widest text-sm hover:bg-qb-orange transition-colors disabled:opacity-50 disabled:hover:bg-qb-black cursor-pointer disabled:cursor-not-allowed w-full sm:w-auto text-center"
                  >
                    INITIALIZE PROJECT
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>
      </div>

      {deleting && (
        <DeleteProjectDialog
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(message) => { setDeleting(null); setNotice({ tone: 'green', text: message }); }}
        />
      )}
    </div>
  );
};

export default MainMenu;
