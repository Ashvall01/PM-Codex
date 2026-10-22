import { tint } from '../../utils/statusStyle';
import React, { useState } from 'react';
import { useStakeholdersStore, Stakeholder, Level } from '../../store/stakeholdersStore';
import { useAcrStore } from '../../store/acrStore';
import { enrichWithAcr, acrFieldProps, acrUnshownDiffs } from '../../utils/acrDiff';
import { AcrStatusLine, AcrDiffList } from '../../components/AcrDiffList';
import { useAppStore } from '../../store/appStore';
import { Plus, Trash2, Edit2, X, User, Briefcase, Mail, Phone, Building, MessageSquare, LayoutGrid, List as ListIcon, Check, Network, Grid3X3 } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { EditableField } from '../../components/EditableField';
import { VennDiagram } from './VennDiagram';
import { OrganizationChart } from './OrganizationChart';
import { PowerInterestGrid } from './PowerInterestGrid';
import { PageHeader, Stat, headerButtonClass } from '../../components/PageHeader';


const LEVELS: Level[] = ['High', 'Medium', 'Low'];
const LEVEL_OPTIONS = LEVELS.map(l => ({ label: l.toUpperCase(), value: l }));

const getLevelColor = (level: Level | string) => {
  switch (level) {
    case 'High': return 'var(--color-qb-magenta)'; // magenta
    case 'Medium': return 'var(--color-qb-orange)'; // orange
    case 'Low': return 'var(--color-qb-cyan)'; // cyan
    default: return 'var(--color-qb-grey)';
  }
};

const getReportsToIds = (s: Stakeholder): string[] => {
  if (s.reportsToIds && Array.isArray(s.reportsToIds)) return s.reportsToIds;
  return s.reportsToId ? [s.reportsToId] : [];
};

const getProjectReportsToIds = (s: Stakeholder): string[] => {
  if (s.projectReportsToIds && Array.isArray(s.projectReportsToIds)) return s.projectReportsToIds;
  return s.projectReportsToId ? [s.projectReportsToId] : [];
};

export const Stakeholders: React.FC = () => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const { stakeholders, addStakeholder, updateStakeholder, deleteStakeholder } = useStakeholdersStore();

  const [activeStakeholderId, setActiveStakeholderId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'diagram' | 'orgchart'>('list');

  const { activeAcrId, activeAcrChangeId, isMouseOverSidebar } = useAcrStore();
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));
  const scrollTimeoutRef = React.useRef<any>(null);

  const projectStakeholders = React.useMemo(() => {
    const realStakeholders = activeProjectId ? stakeholders.filter(s => s.projectId === activeProjectId) : [];

    return enrichWithAcr<any>(
      realStakeholders,
      acr,
      {
        add: ['addStakeholder'],
        update: ['updateStakeholder'],
        remove: ['deleteStakeholder'],
      },
      activeAcrChangeId,
      (chg) => ({
        id: `acr-add-${chg.id}`,
        projectId: activeProjectId,
        name: chg.args.name || 'Proposed Stakeholder',
        projectRole: chg.args.projectRole || chg.args.role || '',
        role: chg.args.role || chg.args.projectRole || '',
        orgRole: chg.args.orgRole || '',
        organization: chg.args.organization || '',
        power: chg.args.power || chg.args.influence || 'Medium',
        interest: chg.args.interest || 'Medium',
        knowledge: chg.args.knowledge || 'Medium',
        interPersonalRelations: chg.args.interPersonalRelations || '',
        notes: chg.args.notes || '',
        email: chg.args.email || '',
        phone: chg.args.phone || '',
        reportsToId: chg.args.reportsToId || null,
        projectReportsToId: chg.args.projectReportsToId || null,
        reportsToIds: chg.args.reportsToIds || [],
        projectReportsToIds: chg.args.projectReportsToIds || [],
      }),
    ).map(row => ({ ...row, isReal: !row.isAcrProposedAdd })) as unknown as Stakeholder[];
  }, [stakeholders, activeProjectId, acr, activeAcrChangeId]);

  React.useEffect(() => {
    if (activeAcrChangeId) {
      const found = projectStakeholders.find(s => (s as any).acrChangeId === activeAcrChangeId);
      if (found) {
        setActiveStakeholderId(found.id);
        
        // Auto scroll to card/cell ONLY if we are hovering on the ACR sidebar
        if (isMouseOverSidebar) {
           setViewMode('list');
           if (scrollTimeoutRef.current) {
             clearTimeout(scrollTimeoutRef.current);
           }
           scrollTimeoutRef.current = setTimeout(() => {
             const cardEl = document.getElementById(`stakeholder-card-${found.id}`);
             if (cardEl) {
               cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
             }
           }, 100); // short delay to allow UI to expand
        }
      }
    }
  }, [activeAcrChangeId, projectStakeholders, isMouseOverSidebar]);

  
  let filteredStakeholders = [...projectStakeholders];
  if (searchQuery.trim() !== '') {
    const q = searchQuery.toLowerCase();
    filteredStakeholders = filteredStakeholders.filter(s => 
      s.name.toLowerCase().includes(q) || 
      (s.projectRole && s.projectRole.toLowerCase().includes(q)) || 
      (s.orgRole && s.orgRole.toLowerCase().includes(q)) || 
      (s.role && s.role.toLowerCase().includes(q)) || 
      s.organization.toLowerCase().includes(q)
    );
  }

  // Sort: High power first, then interest
  const getScore = (s: Stakeholder) => {
    let score = 0;
    if (s.power === 'High') score += 10;
    if (s.power === 'Medium') score += 5;
    if (s.interest === 'High') score += 2;
    if (s.interest === 'Medium') score += 1;
    return score;
  };
  
  filteredStakeholders.sort((a, b) => getScore(b) - getScore(a));

  const handleAddNew = () => {
    if (!activeProjectId) return;
    const newId = addStakeholder(activeProjectId, {
      name: 'New Stakeholder',
    });
    setActiveStakeholderId(newId);
    setIsEditing(true);
    setViewMode('list');
  };

  const realActiveItem = activeStakeholderId ? projectStakeholders.find(s => s.id === activeStakeholderId) || null : null;
  const activeStakeholder = realActiveItem;
  const effectiveIsEditing = isEditing || !!(realActiveItem as any)?.isAcrProposedAdd;

  const handleUpdate = (id: string, updates: Partial<Stakeholder>) => {
    if ((realActiveItem as any)?.isAcrProposedAdd || (realActiveItem as any)?.isAcrProposedUpdate) {
      const changeId = (realActiveItem as any).acrChangeId;
      if (changeId && activeAcrId) {
        const foundChange = acr?.changes.find(c => c.id === changeId);
        if (foundChange) {
          const newArgs = { ...foundChange.args, ...updates };
          useAcrStore.getState().updateAcrChange(activeAcrId, changeId, { args: newArgs });
        }
      }
    } else {
      updateStakeholder(id, updates);
    }
  };

  return (
    <div className="h-full flex bg-transparent font-sans">
      {/* List / Diagram View */}
      <div className={`flex-1 flex flex-col pt-4 sm:pt-8 px-4 sm:pl-12 sm:pr-6 overflow-y-auto ${activeStakeholder ? 'lg:mr-[var(--tray-w,600px)]' : ''} transition-all duration-300`}>
        <PageHeader
          title="Stakeholders"
          stats={<>
            <Stat n={projectStakeholders.filter((s: any) => !s.isAcrProposedAdd).length} label="people" />
            <Stat n={projectStakeholders.filter((s: any) => !s.isAcrProposedAdd && s.power === 'High' && s.interest === 'High').length} label="to manage closely" tone="magenta" />
          </>}
        >
            <div className="flex items-center bg-qb-box-bg p-1">
              <button 
                onClick={() => setViewMode('list')}
                className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-transparent shadow-sm' : 'text-qb-grey hover:text-qb-black'}`}
                title="List View"
              >
                <ListIcon className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-transparent shadow-sm' : 'text-qb-grey hover:text-qb-black'}`}
                title="Power × interest grid"
              >
                <Grid3X3 className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setViewMode('diagram')}
                className={`p-2 transition-colors ${viewMode === 'diagram' ? 'bg-transparent shadow-sm' : 'text-qb-grey hover:text-qb-black'}`}
                title="Power, interest and knowledge"
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setViewMode('orgchart')}
                className={`p-2 transition-colors ${viewMode === 'orgchart' ? 'bg-transparent shadow-sm' : 'text-qb-grey hover:text-qb-black'}`}
                title="Who reports to whom"
              >
                <Network className="w-5 h-5" />
              </button>
            </div>
            
            {viewMode === 'list' && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-black text-qb-grey uppercase tracking-widest">Search:</label>
                <input 
                  type="text"
                  placeholder="Name or role..."
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)}
                  className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange w-48"
                />
              </div>
            )}
            <button 
              onClick={handleAddNew}
              className={headerButtonClass(true)}
            >
              <Plus className="w-5 h-5" /> Add Stakeholder
            </button>
        </PageHeader>

        <div className="flex-1 pb-12">
          {viewMode === 'orgchart' ? (
            <OrganizationChart stakeholders={projectStakeholders} onNodeClick={(id) => {
              setActiveStakeholderId(id);
              setIsEditing(false);
            }} activeId={activeStakeholderId} />
          ) : viewMode === 'grid' ? (
            <PowerInterestGrid
              stakeholders={projectStakeholders}
              activeId={activeStakeholderId}
              onSelect={(id) => { setActiveStakeholderId(id); setIsEditing(false); }}
            />
          ) : viewMode === 'diagram' ? (
            <VennDiagram
              stakeholders={projectStakeholders}
              activeId={activeStakeholderId}
              onSelect={(id) => { setActiveStakeholderId(id); setIsEditing(false); }}
            />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
              {filteredStakeholders.length === 0 ? (
                <div className="col-span-full text-center py-20 text-qb-grey font-medium tracking-widest uppercase">
                  No stakeholders found. Click 'Add Stakeholder' to begin.
                </div>
              ) : (
                filteredStakeholders.map(sh => (
                  <div 
                    key={sh.id}
                    id={`stakeholder-card-${sh.id}`}
                    onClick={() => { setActiveStakeholderId(sh.id); setIsEditing(false); }}
                    onMouseEnter={() => {
                      if ((sh as any).acrChangeId) {
                        useAcrStore.getState().setActiveAcrChangeId((sh as any).acrChangeId);
                      }
                    }}
                    onMouseLeave={() => {
                      if ((sh as any).acrChangeId && useAcrStore.getState().activeAcrChangeId === (sh as any).acrChangeId) {
                        useAcrStore.getState().setActiveAcrChangeId(null);
                      }
                    }}
                    className={`bg-transparent border cursor-pointer hover:border-qb-orange transition-all p-6 relative group ${activeStakeholderId === sh.id ? 'bg-qb-box-bg border-qb-orange ring-1 ring-qb-orange' : 'border-qb-light-grey'} ${
                      (sh as any).isFocusedChange ? 'ring-2 ring-qb-orange bg-qb-orange/5 animate-pulse' : ''
                    } ${
                      (sh as any).isAcrProposedAdd ? 'border-l-4 border-l-[#51b53e] bg-[#51b53e]/5' : ''
                    } ${
                      (sh as any).isAcrProposedDelete ? 'border-l-4 border-l-qb-magenta bg-qb-magenta/5 opacity-75' : ''
                    } ${
                      (sh as any).isAcrProposedUpdate ? 'border-l-4 border-l-[#ff7600] bg-[#ff7600]/5' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex flex-col gap-1 pr-8">
                        <h3 className={`font-bold text-qb-black text-lg line-clamp-1 ${(sh as any).isAcrProposedDelete ? 'line-through text-qb-grey' : ''}`}>{sh.name || 'Unnamed Stakeholder'}</h3>
                        {/* The same three marks, with the same words, as every
                            other module uses. */}
                        {(sh as any).isAcrProposedAdd && (
                          <span className="text-[9px] font-black tracking-widest text-[#51b53e] border border-[#51b53e] px-1.5 py-0.5 uppercase bg-[#51b53e]/10 self-start">PROPOSED NEW</span>
                        )}
                        {(sh as any).isAcrProposedUpdate && (
                          <span className="text-[9px] font-black tracking-widest text-[#ff7600] border border-[#ff7600] px-1.5 py-0.5 uppercase bg-[#ff7600]/10 self-start">
                            PROPOSED EDIT · {(sh as any).acrChangedFieldCount} FIELD{(sh as any).acrChangedFieldCount === 1 ? '' : 'S'}
                          </span>
                        )}
                        {(sh as any).isAcrProposedDelete && (
                          <span className="text-[9px] font-black tracking-widest text-qb-magenta border border-qb-magenta px-1.5 py-0.5 uppercase bg-qb-magenta/10 self-start">PROPOSED REMOVAL</span>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-qb-dark-grey uppercase tracking-widest">
                          {sh.projectRole || sh.role ? (
                            <span className="bg-qb-box-bg px-2 py-1 flex items-center gap-1">
                              <Briefcase className="w-3 h-3 text-qb-orange" /> {sh.projectRole || sh.role}
                            </span>
                          ) : null}
                          {sh.orgRole ? (
                            <span className="bg-qb-box-bg px-2 py-1 flex items-center gap-1">
                              <User className="w-3 h-3 text-qb-cyan" /> {sh.orgRole}
                            </span>
                          ) : null}
                          {!(sh.projectRole || sh.role) && !sh.orgRole && (
                            <span className="bg-qb-box-bg px-2 py-1 text-qb-grey italic">No Role</span>
                          )}
                          {sh.organization && (
                            <span className="flex items-center gap-1"><Building className="w-3 h-3" /> {sh.organization}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          className="opacity-0 group-hover:opacity-100 text-qb-light-grey hover:text-qb-magenta transition-opacity p-1"
                          onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(sh.id); }}
                          title="Delete Stakeholder"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 mt-6">
                      <div className="bg-qb-box-bg p-2 border-l-2" style={{ borderLeftColor: getLevelColor(sh.power) }}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-qb-grey mb-1">Power</p>
                        <p className="font-black text-qb-black uppercase tracking-widest text-xs" style={{ color: getLevelColor(sh.power) }}>{sh.power}</p>
                      </div>
                      <div className="bg-qb-box-bg p-2 border-l-2" style={{ borderLeftColor: getLevelColor(sh.interest) }}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-qb-grey mb-1">Interest</p>
                        <p className="font-black text-qb-black uppercase tracking-widest text-xs" style={{ color: getLevelColor(sh.interest) }}>{sh.interest}</p>
                      </div>
                      <div className="bg-qb-box-bg p-2 border-l-2" style={{ borderLeftColor: getLevelColor(sh.knowledge) }}>
                        <p className="text-[9px] font-black uppercase tracking-widest text-qb-grey mb-1">Knowledge</p>
                        <p className="font-black text-qb-black uppercase tracking-widest text-xs" style={{ color: getLevelColor(sh.knowledge) }}>{sh.knowledge}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Slide-out Detail Panel */}
      <div 
        className={`@container/tray fixed top-0 right-0 h-full w-full lg:w-[var(--tray-w,600px)] bg-qb-bg lg:border-l-4 border-l-0 border-qb-black transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col z-40 lg:z-30 shadow-2xl lg:shadow-none ${activeStakeholder ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {activeStakeholder && (
          <>
            <header className="flex justify-between items-center gap-3 px-6 @min-[540px]/tray:px-12 py-6 lg:py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
              <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest leading-none">STAKEHOLDER DETAILS</span>
                <h2 className="text-lg @min-[540px]/tray:text-2xl font-black text-qb-black uppercase tracking-widest mt-1">
                  VIEW STAKEHOLDER
                </h2>
              </div>
              <div className="flex items-center gap-2 @min-[540px]/tray:gap-4 shrink-0">
                {!(activeStakeholder as any).isAcrProposedAdd && !(activeStakeholder as any).isAcrProposedUpdate && !(activeStakeholder as any).isAcrProposedDelete && (
                  <>
                    <button
                      onClick={() => setShowDeleteConfirm(activeStakeholder.id)}
                      className="p-3 bg-transparent text-qb-grey border-2 border-transparent hover:text-qb-magenta hover:border-qb-magenta transition-colors cursor-pointer"
                      title="Delete Stakeholder"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="relative group/editbtn flex items-center">
                      <div
                        className="p-3 border-2 border-qb-light-grey text-qb-grey bg-transparent cursor-default select-none flex items-center justify-center"
                      >
                        <Edit2 className="w-4 h-4" />
                      </div>
                      <span className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-2 whitespace-nowrap bg-qb-black text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded shadow-lg opacity-0 group-hover/editbtn:opacity-100 transition-opacity z-50">
                        click a field to edit
                      </span>
                    </div>
                  </>
                )}
                <button 
                  onClick={() => { setActiveStakeholderId(null); setIsEditing(false); }}
                  className="p-3 bg-transparent border-2 border-transparent text-qb-grey hover:text-qb-black transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-6 @min-[540px]/tray:px-12 py-6 lg:py-8 flex flex-col gap-10 bg-transparent no-scrollbar relative">
              {/* A removal is the one change no field on this screen can
                  show, because it changes no field. Everything else is
                  visible on the fields themselves. */}
              {(activeStakeholder as any).isAcrProposedDelete && (
                <AcrStatusLine
                  actionName={(activeStakeholder as any).acrChange.name}
                  declined={(activeStakeholder as any).acrApproved === false}
                />
              )}

              {(() => {
                /**
                 * Every field draws itself from the shared diff.
                 *
                 * The stakeholder tool has two pairs of names for one field —
                 * `role`/`projectRole` and `influence`/`power`. Each hand-written
                 * comparison had to remember both, and any field added later had
                 * to be remembered too. The shared helper knows the pairs once.
                 */
                const f = (key: string) => acrFieldProps(activeStakeholder, key);
                const SHOWN_FIELDS = [
                  'name', 'projectRole', 'orgRole', 'organization',
                  'email', 'phone', 'power', 'interest', 'knowledge',
                  'interPersonalRelations', 'notes',
                ];
                const otherDiffs = acrUnshownDiffs(activeStakeholder, SHOWN_FIELDS);

                return (
                  <div className="flex flex-col gap-10 bg-transparent">
                    {/* Name */}
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-1">
                        Stakeholder Name
                      </label>
                      <EditableField
                        {...f('name')}
                        placeholder="UNNAMED STAKEHOLDER"
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { name: newVal })}
                        textClassName="text-3xl font-black text-qb-black uppercase tracking-tight leading-snug py-1"
                      />
                    </div>

                    {/* Roles */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        label="Project Role"
                        {...f('projectRole')}
                        placeholder="NONE"
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { projectRole: newVal.trim() ? newVal.trim() : undefined, role: newVal.trim() ? newVal.trim() : undefined })}
                        textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                      />

                      <EditableField
                        label="Org Role"
                        {...f('orgRole')}
                        placeholder="NONE"
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { orgRole: newVal.trim() ? newVal.trim() : undefined })}
                        textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                      />
                    </div>

                    {/* Organization */}
                    <EditableField
                      label="Organization"
                      {...f('organization')}
                      placeholder="NONE"
                      onSave={(newVal) => handleUpdate(activeStakeholder.id, { organization: newVal.trim() ? newVal.trim() : undefined })}
                      textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                    />

                    {/* Org & Project Reports To */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <div>
                        <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-1">
                          Org Reports To
                        </label>
                        <div className="flex flex-wrap gap-2 mb-2 min-h-[36px] p-1 bg-qb-bg/50 border border-qb-light-grey/40">
                          {getReportsToIds(activeStakeholder).length === 0 ? (
                            <div className="text-xs text-qb-grey italic self-center pl-1">None (Top Level)</div>
                          ) : (
                            getReportsToIds(activeStakeholder).map(mId => {
                              const manager = projectStakeholders.find(s => s.id === mId);
                              if (!manager) return null;
                              return (
                                <div key={mId} className="flex items-center gap-1 bg-white border border-qb-light-grey px-2 py-1 text-xs font-bold text-qb-black uppercase tracking-widest">
                                  <span className="truncate max-w-[120px]">{manager.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const current = getReportsToIds(activeStakeholder);
                                      const updated = current.filter(id => id !== mId);
                                      handleUpdate(activeStakeholder.id, {
                                        reportsToIds: updated,
                                        reportsToId: updated[0] || undefined
                                      });
                                    }}
                                    className="text-qb-orange hover:text-qb-black font-black font-mono pl-1 transition-colors cursor-pointer"
                                    title="Remove"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                        <select
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const current = getReportsToIds(activeStakeholder);
                            if (!current.includes(val)) {
                              const updated = [...current, val];
                              handleUpdate(activeStakeholder.id, {
                                reportsToIds: updated,
                                reportsToId: updated[0] || undefined
                              });
                            }
                          }}
                          className="w-full bg-qb-box-bg border-none p-2.5 text-xs font-black text-qb-grey hover:bg-qb-light-grey/25 uppercase tracking-widest outline-none focus:ring-1 focus:ring-qb-orange cursor-pointer transition-colors"
                        >
                          <option value="">+ Add Org Manager...</option>
                          {projectStakeholders
                            .filter(s => s.id !== activeStakeholder.id && !getReportsToIds(activeStakeholder).includes(s.id))
                            .map(s => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.orgRole ? `(${s.orgRole})` : (s.projectRole || s.role ? `(${s.projectRole || s.role})` : '')}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-1">
                          Project Reports To
                        </label>
                        <div className="flex flex-wrap gap-2 mb-2 min-h-[36px] p-1 bg-qb-bg/50 border border-qb-light-grey/40">
                          {getProjectReportsToIds(activeStakeholder).length === 0 ? (
                            <div className="text-xs text-qb-grey italic self-center pl-1">None (Top Level)</div>
                          ) : (
                            getProjectReportsToIds(activeStakeholder).map(mId => {
                              const manager = projectStakeholders.find(s => s.id === mId);
                              if (!manager) return null;
                              return (
                                <div key={mId} className="flex items-center gap-1 bg-white border border-qb-light-grey px-2 py-1 text-xs font-bold text-qb-black uppercase tracking-widest">
                                  <span className="truncate max-w-[120px]">{manager.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const current = getProjectReportsToIds(activeStakeholder);
                                      const updated = current.filter(id => id !== mId);
                                      handleUpdate(activeStakeholder.id, {
                                        projectReportsToIds: updated,
                                        projectReportsToId: updated[0] || undefined
                                      });
                                    }}
                                    className="text-qb-orange hover:text-qb-black font-black font-mono pl-1 transition-colors cursor-pointer"
                                    title="Remove"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                        <select
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const current = getProjectReportsToIds(activeStakeholder);
                            if (!current.includes(val)) {
                              const updated = [...current, val];
                              handleUpdate(activeStakeholder.id, {
                                projectReportsToIds: updated,
                                projectReportsToId: updated[0] || undefined
                              });
                            }
                          }}
                          className="w-full bg-qb-box-bg border-none p-2.5 text-xs font-black text-qb-grey hover:bg-qb-light-grey/25 uppercase tracking-widest outline-none focus:ring-1 focus:ring-qb-orange cursor-pointer transition-colors"
                        >
                          <option value="">+ Add Project Manager...</option>
                          {projectStakeholders
                            .filter(s => s.id !== activeStakeholder.id && !getProjectReportsToIds(activeStakeholder).includes(s.id))
                            .map(s => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.projectRole || s.role ? `(${s.projectRole || s.role})` : ''}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    {/* Email & Phone */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        label="Email"
                        {...f('email')}
                        placeholder="NONE"
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { email: newVal.trim() ? newVal.trim() : undefined })}
                        textClassName="text-sm font-bold text-qb-black tracking-wide py-1 lowercase"
                      />

                      <EditableField
                        label="Phone"
                        {...f('phone')}
                        placeholder="NONE"
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { phone: newVal.trim() ? newVal.trim() : undefined })}
                        textClassName="text-sm font-bold text-qb-black tracking-wide py-1"
                      />
                    </div>

                    {/* Power, Interest, Knowledge */}
                    <div className="grid grid-cols-3 gap-4 sm:gap-6">
                      <EditableField
                        label="Power"
                        type="select"
                        options={LEVEL_OPTIONS}
                        {...f('power')}
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { power: newVal as Level })}
                        displayFormatter={(val) => (
                          <span className="font-black uppercase tracking-widest text-xs px-2.5 py-1 inline-block" style={{ color: getLevelColor(val), backgroundColor: tint(getLevelColor(val), 10) }}>
                            {val}
                          </span>
                        )}
                      />

                      <EditableField
                        label="Interest"
                        type="select"
                        options={LEVEL_OPTIONS}
                        {...f('interest')}
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { interest: newVal as Level })}
                        displayFormatter={(val) => (
                          <span className="font-black uppercase tracking-widest text-xs px-2.5 py-1 inline-block" style={{ color: getLevelColor(val), backgroundColor: tint(getLevelColor(val), 10) }}>
                            {val}
                          </span>
                        )}
                      />

                      <EditableField
                        label="Knowledge"
                        type="select"
                        options={LEVEL_OPTIONS}
                        {...f('knowledge')}
                        onSave={(newVal) => handleUpdate(activeStakeholder.id, { knowledge: newVal as Level })}
                        displayFormatter={(val) => (
                          <span className="font-black uppercase tracking-widest text-xs px-2.5 py-1 inline-block" style={{ color: getLevelColor(val), backgroundColor: tint(getLevelColor(val), 10) }}>
                            {val}
                          </span>
                        )}
                      />
                    </div>

                    {/* Inter-Personal Relations */}
                    <EditableField
                      label="Inter-Personal Relations"
                      type="textarea"
                      {...f('interPersonalRelations')}
                      placeholder="No inter-personal relations notes. Double click to edit..."
                      onSave={(newVal) => handleUpdate(activeStakeholder.id, { interPersonalRelations: newVal.trim() ? newVal.trim() : undefined })}
                      textClassName="text-sm font-medium text-qb-dark-grey leading-relaxed whitespace-pre-wrap p-4 bg-qb-box-bg/50 border border-qb-light-grey min-h-[80px] block"
                    />

                    {/* Notes */}
                    <EditableField
                      label="Notes"
                      type="textarea"
                      {...f('notes')}
                      placeholder="No notes provided. Double click to edit..."
                      onSave={(newVal) => handleUpdate(activeStakeholder.id, { notes: newVal.trim() ? newVal.trim() : undefined })}
                      textClassName="text-sm font-medium text-qb-dark-grey leading-relaxed whitespace-pre-wrap p-4 bg-qb-box-bg/50 border border-qb-light-grey min-h-[80px] block"
                    />

                    {/* The safety net: proposed fields this panel does not draw
                        itself, listed so nothing is applied unseen. */}
                    {otherDiffs.length > 0 && (
                      <AcrDiffList
                        diffs={otherDiffs}
                        title={`Also proposed — ${otherDiffs.length} more field${otherDiffs.length === 1 ? '' : 's'}`}
                        hideOldValues={(activeStakeholder as any).isAcrProposedAdd}
                      />
                    )}
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title="Delete Stakeholder"
          description={`Are you sure you want to remove '${stakeholders.find(s => s.id === showDeleteConfirm)?.name}'?`}
          subDescription="This action cannot be undone."
          confirmText="Yes, Delete"
          cancelText="Cancel"
          onConfirm={() => {
            deleteStakeholder(showDeleteConfirm);
            if (activeStakeholderId === showDeleteConfirm) {
              setActiveStakeholderId(null);
              setIsEditing(false);
            }
            setShowDeleteConfirm(null);
          }}
          onClose={() => setShowDeleteConfirm(null)}
        />
      )}
    </div>
  );
};
