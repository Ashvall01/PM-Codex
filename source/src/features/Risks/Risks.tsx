import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRisksStore, ProjectRisk, RiskStatus, ImpactLevel, ProbabilityLevel, ImpactArea } from '../../store/risksStore';
import { useAppStore } from '../../store/appStore';
import { Plus, Trash2, Edit2, X, ChevronRight, AlertTriangle, Settings, Check } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { EditableField } from '../../components/EditableField';
import { DateVisualizer } from '../../components/DateVisualizer';
import { useAcrStore } from '../../store/acrStore';
import { enrichWithAcr, acrFieldProps, acrUnshownDiffs } from '../../utils/acrDiff';
import { AcrStatusLine, AcrDiffList } from '../../components/AcrDiffList';
import { RISK_STATUS_COLORS, tint, dueState, dueDateClass, dueTag } from '../../utils/statusStyle';
import { RiskHeatMap, countHeat, heatKey } from '../../components/RiskHeatMap';
import { PageHeader, Stat, headerButtonClass } from '../../components/PageHeader';
import { useDiscardUntouchedNew } from '../../hooks/useDiscardUntouchedNew';
import { activeOnly, archivedOnly, byArchivedDesc } from '../../utils/archive';
import { ArchiveTabs } from '../../components/ArchiveTabs';
import { ArchiveButton } from '../../components/ArchiveButton';

const STATUS_COLORS: Record<string, string> = RISK_STATUS_COLORS;

const IMPACT_AREAS: ImpactArea[] = ['Cost', 'Schedule', 'Scope', 'Quality', 'Resource', 'Reputation', 'Legal', 'Safety and Environmental', 'Stakeholder'];
const IMPACT_LEVELS: ImpactLevel[] = ['Positive (Opportunity)', 'Low', 'Moderate', 'High', 'Critical', 'Catastrophic'];
const PROBABILITIES: ProbabilityLevel[] = ['Rare', 'Low', 'Moderate', 'High', 'Almost Certain', 'Uncertain'];
const STATUS_OPTIONS: RiskStatus[] = ['Open', 'Under Mitigation', 'Mitigated'];

function formatDateDDMMMYYYY(dateVal: any): string {
  if (dateVal === undefined || dateVal === null || dateVal === '') return '--';
  const dateStr = String(dateVal).trim();
  if (dateStr.startsWith('=')) return dateStr;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Match YYYY-MM-DD first to avoid timezone shift
  const ymdMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(T|$)/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const monthIndex = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const d = new Date(year, monthIndex, day);
    if (!isNaN(d.getTime())) {
      return `${String(day).padStart(2, '0')} ${months[monthIndex]} ${year}`;
    }
  }

  // Handle ISO or general strings
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const day = d.getDate();
    const monthIndex = d.getMonth();
    const year = d.getFullYear();
    return `${String(day).padStart(2, '0')} ${months[monthIndex]} ${year}`;
  }

  return dateStr;
}

interface RisksProps {
  /**
   * Draw the archive instead of the active list. Routed at /risks/archive.
   * The archive is a DIFFERENT list, not this list with a filter: no heat map,
   * no filters, no New Risk, and every risk in it is read-only until restored.
   */
  archived?: boolean;
}

const Risks: React.FC<RisksProps> = ({ archived = false }) => {
  const navigate = useNavigate();
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const { risks, addRisk, updateRisk, deleteRisk, archiveRisk, unarchiveRisk } = useRisksStore();

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const scrollTimeoutRef = React.useRef<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [filterImpactArea, setFilterImpactArea] = useState<string>('All');
  // Most severe first. The old default, Status, sorted each status group by
  // status — which changes nothing.
  const [sortBy, setSortBy] = useState<'Date' | 'Value'>('Value');
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  // A heat-map cell used as a filter: "impact|probability", or null for all.
  const [heatFilter, setHeatFilter] = useState<string | null>(null);
  const riskMatrix = useRisksStore(state => state.riskMatrixConfig);

  const { activeAcrId, activeAcrChangeId, isMouseOverSidebar } = useAcrStore();
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));

  const projectRisks = React.useMemo<any[]>(() => {
    const ofProject = activeProjectId ? risks.filter(r => r.projectId === activeProjectId) : [];
    // Split on the STORED flag, before the enrichment: enriched rows hold the
    // PROPOSED values, so splitting after would make a risk a proposal only
    // wants to archive vanish from the list before anyone approved it.
    const realRisks = archived
      ? archivedOnly(ofProject).sort(byArchivedDesc)
      : activeOnly(ofProject);

    return enrichWithAcr<any>(
      realRisks,
      acr,
      {
        // Nothing is ever born archived, so the archive view shows no proposed additions.
        add: archived ? [] : ['addProjectRisk'],
        update: ['updateProjectRisk', 'archiveProjectRisk', 'unarchiveProjectRisk'],
        remove: ['deleteProjectRisk'],
      },
      activeAcrChangeId,
      (chg) => ({
        id: `acr-add-${chg.id}`,
        projectId: activeProjectId || '',
        riskId: chg.args.riskId || 'PROP-000',
        riskDescription: chg.args.riskDescription || chg.args.description || 'Proposed Risk',
        projectSpecificDescription: chg.args.projectSpecificDescription || '',
        ciaConfidentiality: chg.args.ciaConfidentiality || '',
        ciaIntegrity: chg.args.ciaIntegrity || '',
        ciaAvailability: chg.args.ciaAvailability || '',
        impactArea: chg.args.impactArea || '',
        impactLevel: chg.args.impactLevel || chg.args.impact || 'Moderate',
        probability: chg.args.probability || 'Moderate',
        postMitigationImpactLevel: chg.args.postMitigationImpactLevel || '',
        postMitigationProbability: chg.args.postMitigationProbability || '',
        riskValue: chg.args.riskValue || 'Medium',
        owner: chg.args.owner || '',
        responsibility: chg.args.responsibility || '',
        mitigationStrategy: chg.args.mitigationStrategy || chg.args.mitigationPlan || '',
        projectSpecificMitigationStrategy: chg.args.projectSpecificMitigationStrategy || '',
        status: chg.args.status || 'Open',
        targetResolutionDate: chg.args.targetResolutionDate || '',
        remarks: chg.args.remarks || '',
        controlAnnexA: chg.args.controlAnnexA || '',
      }),
    ).map(row => ({ ...row, isReal: !row.isAcrProposedAdd }));
  }, [risks, activeProjectId, acr, activeAcrChangeId, archived]);

  const archivedCount = React.useMemo(
    () => (activeProjectId ? archivedOnly(risks.filter(r => r.projectId === activeProjectId)).length : 0),
    [risks, activeProjectId],
  );

  // Switching tabs must close the tray, or it keeps showing a risk that is no
  // longer in the list behind it.
  React.useEffect(() => {
    setActiveItemId(null);
    setIsEditing(false);
    setHeatFilter(null);
  }, [archived]);

  // ?open=<id> (from the Overview) opens that risk, then clears the address.
  const [searchParams, setSearchParams] = useSearchParams();
  React.useEffect(() => {
    const id = searchParams.get('open');
    if (!id) return;
    const found = risks.find(r => r.id === id);
    if (found && !!found.isArchived !== archived) {
      // It lives on the other tab: go there, keeping ?open so it opens.
      navigate(`${found.isArchived ? '/risks/archive' : '/risks'}?open=${encodeURIComponent(id)}`, { replace: true });
      return;
    }
    if (found) setActiveItemId(id);
    setSearchParams({}, { replace: true });
  }, [searchParams, risks, setSearchParams, archived, navigate]);

  const realActiveItem = activeItemId ? projectRisks.find(r => r.id === activeItemId) || null : null;
  const effectiveIsEditing = isEditing || !!(realActiveItem as any)?.isAcrProposedAdd;

  /**
   * Archived risks are read-only. Read from the STORED value (`acrOriginal`),
   * never the enriched row: the row carries the PROPOSED value, so a pending
   * unarchive would otherwise unlock a risk that is still archived.
   */
  const storedIsArchived = !!(((realActiveItem as any)?.acrOriginal ?? realActiveItem) as any)?.isArchived;
  const readOnly = storedIsArchived;

  React.useEffect(() => {
    if (activeAcrChangeId) {
      const found = projectRisks.find(r => r.acrChangeId === activeAcrChangeId);
      if (found) {
        setActiveItemId(found.id);
        
        // Auto scroll to card/cell ONLY if we are hovering on the ACR sidebar
        if (isMouseOverSidebar) {
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
          scrollTimeoutRef.current = setTimeout(() => {
            const cardEl = document.getElementById(`risk-card-${found.id}`);
            if (cardEl) {
              cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 50);
        }
      }
    }
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [activeAcrChangeId, projectRisks, isMouseOverSidebar]);

  let filteredRisks = [...projectRisks];
  if (filterImpactArea !== 'All') {
    filteredRisks = filteredRisks.filter(r => r.impactArea === filterImpactArea);
  }
  if (heatFilter) {
    filteredRisks = filteredRisks.filter(r => r.status !== 'Mitigated' && heatKey(r.impactLevel, r.probability) === heatFilter);
  }
  // The heat map counts the saved risks (proposed ones are not risks yet).
  const heatCounts = countHeat(projectRisks.filter((r: any) => !r.isAcrProposedAdd));
  const openCount = projectRisks.filter((r: any) => !r.isAcrProposedAdd && r.status !== 'Mitigated').length;
  const severeCount = projectRisks.filter((r: any) => !r.isAcrProposedAdd && r.status !== 'Mitigated' && (r.riskValue === 'Highest' || r.riskValue === 'High')).length;
  const mitigatingCount = projectRisks.filter((r: any) => !r.isAcrProposedAdd && r.status === 'Under Mitigation').length;

  if (!archived) filteredRisks.sort((a, b) => {
    if (sortBy === 'Value') {
      const vMap: Record<string, number> = { 'Lowest': 1, 'Low': 2, 'Medium': 3, 'High': 4, 'Highest': 5, 'Expert Judgment': 6, '': 0 };
      const vA = vMap[String(a.riskValue)];
      const vB = vMap[String(b.riskValue)];
      return vB - vA;
    } else {
      return (a.targetResolutionDate || '9999-12-31').localeCompare(b.targetResolutionDate || '9999-12-31');
    }
  });

  // The archive is one flat list, newest archive first (the order the store
  // returns). The active view groups by status.
  const GROUPS: string[] = archived ? ['Archived'] : STATUS_OPTIONS;
  const groupedRisks = filteredRisks.reduce((acc, curr) => {
    const status = archived ? 'Archived' : (curr.status || 'Open');
    if (!acc[status]) acc[status] = [];
    acc[status].push(curr);
    return acc;
  }, {} as Record<string, any[]>);

  // New Risk makes a blank risk at once; closed untouched, it is removed again.
  const markNewRisk = useDiscardUntouchedNew(
    activeItemId,
    (id) => useRisksStore.getState().risks.find(r => r.id === id),
    (r) => !!r && r.status === 'Open' && ![
      r.riskId, r.riskDescription, r.projectSpecificDescription, r.impactArea, r.impactLevel, r.probability,
      r.postMitigationImpactLevel, r.postMitigationProbability, r.owner, r.responsibility, r.mitigationStrategy,
      r.projectSpecificMitigationStrategy, r.targetResolutionDate, r.remarks, r.controlAnnexA,
      r.ciaConfidentiality, r.ciaIntegrity, r.ciaAvailability,
    ].some(v => String(v || '').trim()),
    (id) => useRisksStore.getState().deleteRisk(id),
  );

  const handleAddNew = () => {
    if (!activeProjectId) return;
    const newId = addRisk(activeProjectId, {
      status: 'Open'
    });
    markNewRisk(newId);
    setActiveItemId(newId);
    setIsEditing(true);
  };

  const handleUpdate = (id: string, updates: Partial<ProjectRisk>) => {
    if (realActiveItem && ((realActiveItem as any).isAcrProposedAdd || (realActiveItem as any).isAcrProposedUpdate)) {
      const changeId = realActiveItem.acrChangeId;
      if (changeId && activeAcrId) {
        const foundChange = acr?.changes.find(c => c.id === changeId);
        if (foundChange) {
          const newArgs = { ...foundChange.args, ...updates };
          useAcrStore.getState().updateAcrChange(activeAcrId, changeId, { args: newArgs });
        }
      }
    } else {
      updateRisk(id, updates);
    }
  };

  const getRiskValueColor = (value: string) => {
    switch (value) {
      case 'Lowest': return 'border-qb-light-grey text-qb-grey bg-qb-box-bg/20';
      case 'Low': return 'border-qb-green text-qb-green bg-qb-green/10';
      case 'Medium': return 'border-qb-orange text-qb-orange bg-qb-orange/10';
      case 'High': return 'border-qb-magenta text-qb-magenta bg-qb-magenta/10';
      case 'Highest': return 'border-qb-magenta text-white bg-qb-magenta';
      case 'Expert Judgment': return 'border-qb-cyan text-qb-cyan bg-qb-cyan/10';
      default: return 'border-transparent text-qb-grey';
    }
  };

  return (
    <div className="h-full flex bg-qb-bg font-sans">
      {/* List View */}
      {/* Rows lay out for the list's own width, not the screen's: see the
          same note in TasksTracker.tsx. */}
      <div className={`@container/list flex-1 flex flex-col pt-4 sm:pt-8 px-4 sm:pl-12 sm:pr-6 overflow-y-auto ${realActiveItem ? 'lg:mr-[var(--tray-w,600px)]' : ''} transition-all duration-300`}>
        <PageHeader
          title="Risks"
          stats={archived ? <span>{projectRisks.length} in the archive</span> : <>
            <Stat n={openCount} label="open" />
            <Stat n={severeCount} label="high or highest" tone="magenta" />
            <Stat n={mitigatingCount} label="under mitigation" />
          </>}
        >
          {/* The archive is read, not worked: no filters, no sort, no New Risk. */}
          {!archived && (<>
            <div className="flex items-center gap-2">
              <label className="text-xs font-black text-qb-grey uppercase tracking-widest hidden md:block">Area:</label>
              <select 
                value={filterImpactArea} 
                onChange={e => setFilterImpactArea(e.target.value)}
                className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
              >
                <option value="All">All Areas</option>
                {IMPACT_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-black text-qb-grey uppercase tracking-widest hidden md:block">Sort:</label>
              <select 
                value={sortBy} 
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
              >
                <option value="Value">Severity</option>
                <option value="Date">Target Date</option>
              </select>
            </div>
            <button 
              onClick={() => navigate('/settings?tab=risk')}
              className={headerButtonClass()}
            >
              <Settings className="w-4 h-4" /> Config
            </button>
            <button 
              onClick={handleAddNew}
              className={headerButtonClass(true)}
            >
              <Plus className="w-4 h-4" /> New Risk
            </button>
          </>)}
        </PageHeader>

        <ArchiveTabs basePath="/risks" archivedCount={archivedCount} />

        {/* Where the open risks sit, as the matrix colours them. A click on a
            cell lists only its risks; click it again, or CLEAR, for all. */}
        {!archived && projectRisks.length > 0 && (
          <div className="flex flex-col md:flex-row md:items-end gap-6 mb-10 border-b border-qb-light-grey pb-8">
            <div className="w-full md:w-[440px] shrink-0">
              <RiskHeatMap
                heat={heatCounts.heat}
                matrix={riskMatrix}
                cellHeight={30}
                selected={heatFilter}
                onCellClick={(impact, prob) => {
                  const k = heatKey(impact, prob);
                  setHeatFilter(prev => (prev === k ? null : k));
                }}
              />
            </div>
            <div className="flex flex-col gap-2 text-[10px] font-black uppercase tracking-widest text-qb-grey pb-5">
              {heatFilter ? (
                <div className="flex items-center gap-2 text-qb-black">
                  <span className="border border-qb-black px-2 py-1">
                    Showing {heatFilter.split('|')[0]} impact × {heatFilter.split('|')[1]} probability
                  </span>
                  <button type="button" onClick={() => setHeatFilter(null)} className="text-qb-orange hover:underline">Clear</button>
                </div>
              ) : (
                <span>Open risks by impact and probability · click a cell to list its risks</span>
              )}
              <span>
                {[heatCounts.opportunities ? `${heatCounts.opportunities} opportunit${heatCounts.opportunities === 1 ? 'y' : 'ies'}` : '',
                  heatCounts.uncertain ? `${heatCounts.uncertain} uncertain` : '',
                  heatCounts.unassessed ? `${heatCounts.unassessed} not assessed` : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
        )}

        <div className="flex-1 pb-12">
          <div className="flex flex-col gap-8">
            {projectRisks.length === 0 ? (
              <div className="text-center py-20 text-qb-grey font-medium tracking-widest uppercase">
                {archived ? 'Nothing in the archive. Archive a risk from its detail panel.' : "No risks yet. Click 'New Risk' to start."}
              </div>
            ) : (
              GROUPS.map(status => {
                const risksInStatus = groupedRisks[status] || [];
                if (risksInStatus.length === 0 && (filterImpactArea !== 'All' || heatFilter)) return null; // hide empty columns if filtered

                return (
                  <div 
                    key={status} 
                    className={`relative transition-colors ${dragOverStatus === status ? 'bg-black/5 rounded-r-lg' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOverStatus !== status) {
                        setDragOverStatus(status);
                      }
                    }}
                    onDragLeave={() => {
                      setDragOverStatus(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverStatus(null);
                      const riskId = e.dataTransfer.getData('riskId');
                      if (riskId && !archived) {
                        updateRisk(riskId, { status: status as RiskStatus });
                      }
                    }}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <ChevronRight className="w-5 h-5" style={{ color: STATUS_COLORS[status as RiskStatus] || 'var(--color-qb-grey)' }} />
                      <h2 className="text-xl font-black text-qb-dark-grey uppercase tracking-[0.15em]">{status} <span className="opacity-50 ml-2">[{risksInStatus.length}]</span></h2>
                    </div>
                    <div className="pl-8 relative">
                      <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-qb-light-grey"></div>
                      <div className="flex flex-col">
                        {risksInStatus.map((item) => (
                          <div 
                            key={item.id}
                            id={`risk-card-${item.id}`}
                            draggable={!archived && !(item as any).isAcrProposedAdd}
                            onDragStart={(e) => {
                              if (archived || (item as any).isAcrProposedAdd) {
                                e.preventDefault();
                                return;
                              }
                              e.dataTransfer.setData('riskId', item.id);
                            }}
                            onClick={() => { setActiveItemId(item.id); setIsEditing(false); }}
                            onMouseEnter={() => {
                              if ((item as any).acrChangeId) {
                                useAcrStore.getState().setActiveAcrChangeId((item as any).acrChangeId);
                              }
                            }}
                            onMouseLeave={() => {
                              if ((item as any).acrChangeId && useAcrStore.getState().activeAcrChangeId === (item as any).acrChangeId) {
                                useAcrStore.getState().setActiveAcrChangeId(null);
                              }
                            }}
                            className={`cursor-pointer group flex flex-col @min-[860px]/list:flex-row @min-[860px]/list:items-center justify-between py-4 border-b border-qb-light-grey transition-all duration-300 hover:bg-black/5 px-4 ${
                              realActiveItem?.id === item.id ? 'bg-qb-box-bg' : ''
                            } ${
                              (item as any).isFocusedChange ? 'ring-2 ring-qb-orange bg-qb-orange/5 animate-pulse' : ''
                            } ${
                              (item as any).isAcrProposedAdd ? 'border-l-4 border-[#51b53e] bg-[#51b53e]/5' : ''
                            } ${
                              (item as any).isAcrProposedUpdate ? 'border-l-4 border-[#ff7600] bg-[#ff7600]/5' : ''
                            } ${
                              (item as any).isAcrProposedDelete ? 'border-l-4 border-qb-magenta bg-qb-magenta/5 opacity-75 animate-pulse' : ''
                            }`}
                          >
                            {/* The title keeps at least 10rem; the labels wrap below it
                                rather than squeeze it to nothing. */}
                            <div className="flex flex-wrap @min-[860px]/list:flex-nowrap items-center gap-x-4 gap-y-1.5 flex-1 min-w-0 pr-4">
                              <span className="text-xs font-mono font-bold text-qb-grey shrink-0 w-16 truncate">{item.riskId || '--'}</span>
                              <h3 className={`text-lg tracking-wide truncate flex-1 min-w-[10rem] ${realActiveItem?.id === item.id ? 'font-black text-qb-black' : 'font-medium text-qb-dark-grey'} ${(item as any).isAcrProposedDelete ? 'line-through text-qb-grey' : ''}`}>
                                {item.projectSpecificDescription || item.riskDescription || 'Empty Risk Description'}
                              </h3>
                              {(item as any).isAcrProposedAdd && (
                                <span className="text-[9px] font-black tracking-widest text-[#51b53e] border border-[#51b53e] px-1.5 py-0.5 uppercase bg-[#51b53e]/10 shrink-0">PROPOSED NEW</span>
                              )}
                              {(item as any).isAcrProposedUpdate && (
                                <span className="text-[9px] font-black tracking-widest text-[#ff7600] border border-[#ff7600] px-1.5 py-0.5 uppercase bg-[#ff7600]/10 shrink-0">
                                  PROPOSED EDIT · {(item as any).acrChangedFieldCount} FIELD{(item as any).acrChangedFieldCount === 1 ? '' : 'S'}
                                </span>
                              )}
                              {(item as any).isAcrProposedDelete && (
                                <span className="text-[9px] font-black tracking-widest text-qb-magenta border border-qb-magenta px-1.5 py-0.5 uppercase bg-qb-magenta/10 shrink-0">PROPOSED REMOVAL</span>
                              )}
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 shrink-0 mt-2 @min-[860px]/list:mt-0 @min-[860px]/list:flex-nowrap">
                              {item.targetResolutionDate && (() => {
                                const due = dueState(item.targetResolutionDate, item.status === 'Mitigated');
                                const tag = dueTag(item.targetResolutionDate, due);
                                return (
                                  <DateVisualizer date={item.targetResolutionDate}>
                                    <span className={`text-[10px] font-bold font-mono ${dueDateClass(due)} hover:text-qb-black transition-colors uppercase tracking-wider cursor-default whitespace-nowrap`}>
                                      {formatDateDDMMMYYYY(item.targetResolutionDate)}
                                      {tag && <span className="ml-1.5 font-black">· {tag}</span>}
                                    </span>
                                  </DateVisualizer>
                                );
                              })()}
                              {item.owner && (
                                <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-qb-dark-grey bg-black/5 px-2 py-0.5 border border-qb-light-grey max-w-[120px] truncate" title={`Owner: ${item.owner}`}>
                                  {item.owner}
                                </span>
                              )}
                              {item.impactArea && (
                                <span className="text-[10px] font-bold uppercase tracking-widest text-qb-dark-grey">
                                  {item.impactArea}
                                </span>
                              )}
                              
                              <div className={`w-[120px] text-center text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border ${getRiskValueColor(item.riskValue)}`}>
                                {item.riskValue || 'UNASSESSED'}
                              </div>

                              {!(item as any).isAcrProposedAdd && !(item as any).isAcrProposedUpdate && !(item as any).isAcrProposedDelete && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(item.id); }}
                                  className="text-qb-light-grey hover:text-qb-magenta transition-colors opacity-0 group-hover:opacity-100 p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Details / Edit Panel */}
      <div
        className={`@container/tray fixed top-0 right-0 h-full w-full lg:w-[var(--tray-w,600px)] bg-qb-bg lg:border-l-4 border-l-0 border-qb-black transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col z-40 lg:z-30 shadow-2xl lg:shadow-none ${realActiveItem ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {realActiveItem && (
          <>
            <header className="flex justify-between items-center gap-3 px-6 @min-[540px]/tray:px-12 py-6 lg:py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
              <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest leading-none">RISK DETAILS</span>
                <h2 className="text-lg @min-[540px]/tray:text-2xl font-black text-qb-black uppercase tracking-widest mt-1">
                  {effectiveIsEditing ? 'EDIT RISK' : 'VIEW RISK'}
                </h2>
              </div>
              <div className="flex items-center gap-2 @min-[540px]/tray:gap-4 shrink-0">
                {!(realActiveItem as any).isAcrProposedAdd && !(realActiveItem as any).isAcrProposedUpdate && !(realActiveItem as any).isAcrProposedDelete && (
                  <>
                    {/* Archive sits before delete: the gentler of the two first. */}
                    <ArchiveButton
                      isArchived={storedIsArchived}
                      onArchive={() => { archiveRisk(realActiveItem.id); setActiveItemId(null); setIsEditing(false); }}
                      onRestore={() => { unarchiveRisk(realActiveItem.id); setActiveItemId(null); setIsEditing(false); }}
                      noun="risk"
                    />
                    <button
                      onClick={() => setShowDeleteConfirm(realActiveItem.id)}
                      className="p-3 bg-transparent text-qb-grey border-2 border-transparent hover:text-qb-magenta hover:border-qb-magenta transition-colors"
                      title="Delete Risk"
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
                  onClick={() => { setActiveItemId(null); setIsEditing(false); }}
                  className="p-3 bg-transparent border-2 border-transparent text-qb-grey hover:text-qb-black transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-6 @min-[540px]/tray:px-12 py-6 lg:py-8 flex flex-col gap-10 bg-transparent no-scrollbar relative">
              {/* A removal is the one change no field on this screen can
                  show, because it changes no field. Everything else is
                  visible on the fields themselves. */}
              {(realActiveItem as any).isAcrProposedDelete && (
                <AcrStatusLine
                  actionName={(realActiveItem as any).acrChange.name}
                  declined={(realActiveItem as any).acrApproved === false}
                />
              )}

              {/* Descriptions & Identity via EditableField */}
              {(() => {
                /**
                 * Every field below draws itself from the shared diff.
                 *
                 * This used to be twenty hand-written comparison lines. The
                 * risk record has more fields than the update tool declares, so
                 * whenever a proposal carried one of the undeclared ones — and
                 * the bridge does send them — the change applied on sign-off
                 * without ever appearing on this screen.
                 */
                const f = (key: string) => acrFieldProps(realActiveItem, key);
                const fDate = (key: string) => {
                  const props = acrFieldProps(realActiveItem, key);
                  const trim = (v?: string) => (v || '').split('T')[0];
                  return {
                    value: trim(props.value),
                    isProposalDiff: props.isProposalDiff,
                    proposedValue: props.isProposalDiff ? trim(props.proposedValue) : undefined,
                  };
                };
                const SHOWN_FIELDS = [
                  'status', 'riskId', 'riskDescription', 'projectSpecificDescription',
                  'impactArea', 'impactLevel', 'probability',
                  'postMitigationImpactLevel', 'postMitigationProbability',
                  'ciaConfidentiality', 'ciaIntegrity', 'ciaAvailability',
                  'mitigationStrategy', 'projectSpecificMitigationStrategy',
                  'owner', 'responsibility', 'targetResolutionDate',
                  'controlAnnexA', 'remarks', 'isArchived',
                ];
                const otherDiffs = acrUnshownDiffs(realActiveItem, SHOWN_FIELDS);

                return (
                  <div className="flex flex-col gap-10 bg-transparent">
                    {/* Archived is never typed into — the header button moves it.
                        Drawn anyway so a proposal to archive or restore shows its
                        before and after on the field itself, like every other change. */}
                    {(storedIsArchived || f('isArchived').isProposalDiff) && (
                      <EditableField
                        disabled
                        label="Archived"
                        {...f('isArchived')}
                        onSave={() => {}}
                        displayFormatter={(val) => (
                          <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 inline-block ${val === 'true' ? 'bg-qb-cyan/20 text-qb-cyan' : 'bg-qb-box-bg text-qb-grey'}`}>
                            {val === 'true' ? 'Yes' : 'No'}
                          </span>
                        )}
                      />
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        disabled={readOnly}
                        label="Status"
                        type="select"
                        options={STATUS_OPTIONS}
                        {...f('status')}
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { status: newVal as RiskStatus })}
                        displayFormatter={(val) => (
                          <span className="text-[11px] font-black uppercase tracking-widest px-2.5 py-1 inline-block" style={{ backgroundColor: tint(STATUS_COLORS[val] || 'var(--color-qb-grey)'), color: STATUS_COLORS[val] || 'var(--color-qb-grey)' }}>
                            {val}
                          </span>
                        )}
                      />

                      <EditableField
                        disabled={readOnly}
                        label="Risk ID"
                        {...f('riskId')}
                        placeholder="e.g. RSK-001"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { riskId: newVal })}
                        textClassName="text-sm font-bold text-qb-black font-mono uppercase tracking-wide py-1"
                      />
                    </div>

                    <div>
                      <EditableField
                        disabled={readOnly}
                        label="Risk Description"
                        type="textarea"
                        rows={3}
                        {...f('riskDescription')}
                        placeholder="Standardized description..."
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { riskDescription: newVal })}
                        textClassName="text-base font-bold text-qb-black tracking-tight uppercase py-1"
                      />
                    </div>

                    <div>
                      <EditableField
                        disabled={readOnly}
                        label="Project Specific Description"
                        type="textarea"
                        rows={3}
                        {...f('projectSpecificDescription')}
                        placeholder="How this manifests in this project..."
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { projectSpecificDescription: newVal })}
                        textClassName="text-sm font-bold text-qb-black tracking-tight py-1"
                      />
                    </div>

                    <div className="bg-transparent p-6 border border-qb-light-grey shadow-sm">
                      <h3 className="text-sm font-black text-qb-black uppercase tracking-widest mb-6">Risk Assessment</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mb-6">
                        <EditableField
                          disabled={readOnly}
                          label="Impact Area"
                          type="select"
                          options={[
                            { label: '-- Select --', value: '' },
                            ...IMPACT_AREAS.map(a => ({ label: a, value: a }))
                          ]}
                          {...f('impactArea')}
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { impactArea: (newVal || '') as ImpactArea | '' })}
                          textClassName="text-xs font-bold text-qb-black uppercase py-1"
                        />

                        <div>
                          <label className="block text-[10px] font-black text-qb-grey uppercase tracking-widest mb-2">Calculated Value</label>
                          <div className={`inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest border ${getRiskValueColor(realActiveItem.riskValue)}`}>
                            {realActiveItem.riskValue || 'UNASSESSED'}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mb-6">
                        <EditableField
                          disabled={readOnly}
                          label="Impact Level"
                          type="select"
                          options={[
                            { label: '-- Select --', value: '' },
                            ...IMPACT_LEVELS.map(l => ({ label: l, value: l }))
                          ]}
                          {...f('impactLevel')}
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { impactLevel: (newVal || '') as ImpactLevel | '' })}
                          textClassName="text-xs font-bold text-qb-black uppercase py-1"
                        />

                        <EditableField
                          disabled={readOnly}
                          label="Probability"
                          type="select"
                          options={[
                            { label: '-- Select --', value: '' },
                            ...PROBABILITIES.map(p => ({ label: p, value: p }))
                          ]}
                          {...f('probability')}
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { probability: (newVal || '') as ProbabilityLevel | '' })}
                          textClassName="text-xs font-bold text-qb-black uppercase py-1"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                        <EditableField
                          disabled={readOnly}
                          label="Post-Mitigation Impact"
                          type="select"
                          options={[
                            { label: '-- Select --', value: '' },
                            ...IMPACT_LEVELS.map(l => ({ label: l, value: l }))
                          ]}
                          {...f('postMitigationImpactLevel')}
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { postMitigationImpactLevel: (newVal || '') as ImpactLevel | '' })}
                          textClassName="text-xs font-bold text-qb-black uppercase py-1"
                        />

                        <EditableField
                          disabled={readOnly}
                          label="Post-Mitigation Prob."
                          type="select"
                          options={[
                            { label: '-- Select --', value: '' },
                            ...PROBABILITIES.map(p => ({ label: p, value: p }))
                          ]}
                          {...f('postMitigationProbability')}
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { postMitigationProbability: (newVal || '') as ProbabilityLevel | '' })}
                          textClassName="text-xs font-bold text-qb-black uppercase py-1"
                        />
                      </div>
                    </div>

                    <div>
                      <h3 className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-4 border-b border-qb-light-grey pb-2">CIA Aspect</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <EditableField
                          disabled={readOnly}
                          label="Confidentiality"
                          {...f('ciaConfidentiality')}
                          placeholder="-- NONE --"
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { ciaConfidentiality: newVal })}
                          textClassName="text-xs font-bold text-qb-black py-1"
                        />

                        <EditableField
                          disabled={readOnly}
                          label="Integrity"
                          {...f('ciaIntegrity')}
                          placeholder="-- NONE --"
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { ciaIntegrity: newVal })}
                          textClassName="text-xs font-bold text-qb-black py-1"
                        />

                        <EditableField
                          disabled={readOnly}
                          label="Availability"
                          {...f('ciaAvailability')}
                          placeholder="-- NONE --"
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { ciaAvailability: newVal })}
                          textClassName="text-xs font-bold text-qb-black py-1"
                        />
                      </div>
                    </div>

                    <div>
                      <h3 className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-4 border-b border-qb-light-grey pb-2">Mitigation</h3>
                      <div className="flex flex-col gap-6">
                        <EditableField
                          disabled={readOnly}
                          label="Generic Strategy"
                          type="textarea"
                          rows={3}
                          {...f('mitigationStrategy')}
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { mitigationStrategy: newVal })}
                          textClassName="text-sm font-medium text-qb-black leading-relaxed whitespace-pre-wrap py-1"
                        />

                        <EditableField
                          disabled={readOnly}
                          label="Project Specific Mitigation"
                          type="textarea"
                          rows={3}
                          {...f('projectSpecificMitigationStrategy')}
                          onSave={(newVal) => handleUpdate(realActiveItem.id, { projectSpecificMitigationStrategy: newVal })}
                          textClassName="text-sm font-medium text-[#111111] leading-relaxed whitespace-pre-wrap py-1"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        disabled={readOnly}
                        label="Risk Owner"
                        {...f('owner')}
                        placeholder="-- UNASSIGNED --"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { owner: newVal })}
                        textClassName="text-sm font-bold text-[#111111] uppercase py-1"
                      />

                      <EditableField
                        disabled={readOnly}
                        label="Responsibility"
                        {...f('responsibility')}
                        placeholder="-- NONE --"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { responsibility: newVal })}
                        textClassName="text-sm font-bold text-[#111111] uppercase py-1"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        disabled={readOnly}
                        label="Target/Resolved At"
                        type="date"
                        {...fDate('targetResolutionDate')}
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { targetResolutionDate: newVal })}
                        displayFormatter={(val) => formatDateDDMMMYYYY(val)}
                        textClassName="text-sm font-bold text-qb-black font-mono uppercase tracking-wide py-1"
                      />

                      <EditableField
                        disabled={readOnly}
                        label="ISO 27001 Control"
                        {...f('controlAnnexA')}
                        placeholder="e.g. A.8.1.1"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { controlAnnexA: newVal })}
                        textClassName="text-sm font-bold text-qb-black font-mono py-1"
                      />
                    </div>

                    <div>
                      <EditableField
                        disabled={readOnly}
                        label="Remarks"
                        type="textarea"
                        rows={3}
                        {...f('remarks')}
                        placeholder="-- NONE --"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { remarks: newVal })}
                        textClassName="text-sm font-medium text-qb-black leading-relaxed whitespace-pre-wrap py-1"
                      />
                    </div>

                    {/* The safety net: proposed fields this panel does not draw
                        itself. The risk record has more fields than the update
                        tool declares, so this is not a hypothetical case. */}
                    {otherDiffs.length > 0 && (
                      <AcrDiffList
                        diffs={otherDiffs}
                        title={`Also proposed — ${otherDiffs.length} more field${otherDiffs.length === 1 ? '' : 's'}`}
                        hideOldValues={(realActiveItem as any).isAcrProposedAdd}
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
          title="Delete Risk"
          description="Are you sure you want to delete this risk assessment?"
          subDescription="THIS ACTION CANNOT BE UNDONE."
          confirmText="YES, DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            deleteRisk(showDeleteConfirm);
            if (realActiveItem?.id === showDeleteConfirm) {
              setActiveItemId(null);
            }
            setShowDeleteConfirm(null);
          }}
          onClose={() => setShowDeleteConfirm(null)}
        />
      )}

     </div>
   );
 };

export default Risks;
