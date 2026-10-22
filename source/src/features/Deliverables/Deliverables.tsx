import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDeliverablesStore, Deliverable, DeliverableStatus } from '../../store/deliverablesStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useAppStore } from '../../store/appStore';
import { Plus, Trash2, Edit2, MessageSquare, X, ChevronRight, Check, Copy, Boxes, ArrowLeft, User, Layers } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { EditableField } from '../../components/EditableField';
import { DateVisualizer } from '../../components/DateVisualizer';
import { format } from 'date-fns';
import { useAcrStore } from '../../store/acrStore';
import { enrichWithAcr, acrFieldProps, acrUnshownDiffs } from '../../utils/acrDiff';
import { AcrStatusLine, AcrDiffList } from '../../components/AcrDiffList';
import { ProposedCommentCard } from '../../components/ProposedCommentCard';
import { activeOnly } from '../../utils/archive';
import { ArchiveTabs } from '../../components/ArchiveTabs';
import { ArchiveButton } from '../../components/ArchiveButton';
import { DELIVERABLE_STATUS_COLORS, tint, priorityChipClass, dueState, dueDateClass, dueTag } from '../../utils/statusStyle';
import { Stat, headerButtonClass } from '../../components/PageHeader';
import { SearchBox, Highlight } from '../../components/SearchBox';
import { parseSearch, isEmptySearch, matchSearch, highlightNeedles, snippetAround, asList, SearchDoc, SearchHit } from '../../utils/recordSearch';

/** Where a search hit outside the result's visible text is named ("in comments"). */
const HIDDEN_FIELD_LABEL: Record<string, string> = {
  description: 'description', definitionOfDone: 'definition of done', comments: 'comments', activity: 'linked activity', category: 'group',
};

const formatDateDisplay = (dateStr?: string): string => {
  if (!dateStr) return '--';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(T|$)/);
  if (match) {
    const d = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    if (!isNaN(d.getTime())) {
      return format(d, 'dd MMM yyyy').toUpperCase();
    }
  }
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return format(d, 'dd MMM yyyy').toUpperCase();
    }
  } catch (e) {
    console.error('Date parsing error:', e);
  }
  return String(dateStr).toUpperCase();
};

const STATUS_COLORS: Record<string, string> = DELIVERABLE_STATUS_COLORS;

const STATUS_OPTIONS: DeliverableStatus[] = [
  'Pending', 'In Progress', 'On Hold', 'In Review', 'Signed Off', 'Dropped', 'Blocked'
];

interface DeliverablesProps {
  /** The ARCHIVE tab. Flat, project-wide, subtree roots only — PLAN.md 21.3. */
  archived?: boolean;
}

export default function Deliverables({ archived = false }: DeliverablesProps) {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const {
    deliverables, addDeliverable, updateDeliverable, deleteDeliverable, createNestedSpace,
    addComment, deleteComment, archiveDeliverable, unarchiveDeliverable,
    getArchivedDeliverablesByProject,
  } = useDeliverablesStore();
  const projectTimelines = useTimelineStore(state => state.projectTimelines);

  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const scrollTimeoutRef = React.useRef<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'Date' | 'Priority' | 'Status'>('Date');
  const [query, setQuery] = useState('');

  const { activeAcrId, activeAcrChangeId, isMouseOverSidebar } = useAcrStore();
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));

  // Compute ancestor path for breadcrumb navigation
  const parentTrail = React.useMemo(() => {
    const trail: Deliverable[] = [];
    let curr = currentParentId;
    while (curr) {
      const found = deliverables.find(d => d.id === curr && d.projectId === activeProjectId);
      if (found) {
        trail.unshift(found);
        curr = found.parentId || null;
      } else {
        break;
      }
    }
    return trail;
  }, [currentParentId, deliverables, activeProjectId]);

  const currentParent = React.useMemo(() => {
    return currentParentId ? deliverables.find(d => d.id === currentParentId && d.projectId === activeProjectId) || null : null;
  }, [currentParentId, deliverables, activeProjectId]);

  const projectDeliverables = React.useMemo(() => {
    /**
     * Split on the STORED flag, BEFORE the enrichment — the rule TasksTracker
     * already follows. Filtering on enriched rows would make a deliverable that
     * a change request only PROPOSES to archive vanish the moment the proposal
     * was filed: the change applying itself before anyone approved it.
     *
     * The ARCHIVE view is flat and project-wide and lists SUBTREE ROOTS only.
     * It ignores currentParentId on purpose — an archive that repeated the
     * drill-down would make you navigate through archived parents to reach
     * archived children, which is the stranding problem of PLAN.md 21.2 in
     * reverse.
     */
    const realDevs = !activeProjectId
      ? []
      : archived
        ? getArchivedDeliverablesByProject(activeProjectId)
        : activeOnly(
            deliverables.filter(d => d.projectId === activeProjectId && (currentParentId ? d.parentId === currentParentId : !d.parentId)),
          );
    // Only the proposals for the folder currently open. A proposed
    // sub-deliverable belongs inside its parent, not on the top level.
    const scopedAcr = acr
      ? {
          ...acr,
          changes: acr.changes.filter(
            (c) =>
              c.name !== 'addDeliverable' ||
              (c.args.parentId || null) === (currentParentId || null),
          ),
        }
      : acr;

    return enrichWithAcr<any>(
      realDevs,
      scopedAcr,
      {
        // Nothing is ever born archived, so the archive view shows no proposed
        // additions. Everything else is the same in both views.
        add: archived ? [] : ['addDeliverable'],
        update: ['updateDeliverable', 'archiveDeliverable', 'unarchiveDeliverable'],
        remove: ['deleteDeliverable'],
        comment: ['addDeliverableComment', 'editDeliverableComment'],
      },
      activeAcrChangeId,
      (chg) => ({
        id: `acr-add-${chg.id}`,
        projectId: activeProjectId,
        parentId: currentParentId || null,
        title: chg.args.title || 'Proposed Deliverable',
        description: chg.args.description || '',
        definitionOfDone: chg.args.definitionOfDone || '',
        status: chg.args.status || 'Pending',
        dueDate: chg.args.dueDate || '',
        category: chg.args.category || 'General',
        priority: chg.args.priority || 'Medium',
        owner: chg.args.owner || '',
        hasNestedSpace: !!chg.args.hasNestedSpace,
        comments: [],
        linkedActivityIds: chg.args.linkedActivityIds || [],
      }),
    ).map(row => ({ ...row, isReal: !row.isAcrProposedAdd }));
  }, [deliverables, activeProjectId, currentParentId, acr, activeAcrChangeId, archived, getArchivedDeliverablesByProject]);

  // Roots, not records: restoring a root brings its whole subtree back, so the
  // number on the tab is the number of things the user can actually act on.
  const archivedCount = React.useMemo(
    () => (activeProjectId ? getArchivedDeliverablesByProject(activeProjectId).length : 0),
    [deliverables, activeProjectId, getArchivedDeliverablesByProject],
  );

  // The archive is flat. Landing on it from inside a nested space would show a
  // project-wide list under a breadcrumb that no longer describes it, so the
  // drill-down resets on the way in. Switching tabs also closes the tray, which
  // would otherwise keep showing a record the list behind it has dropped.
  React.useEffect(() => {
    if (archived) setCurrentParentId(null);
    setActiveItemId(null);
    setIsEditing(false);
  }, [archived]);

  // ?open=<id> (from the Overview) opens that deliverable inside its own
  // nested space, then clears the address.
  const [searchParams, setSearchParams] = useSearchParams();
  React.useEffect(() => {
    const id = searchParams.get('open');
    if (!id) return;
    const target = deliverables.find(d => d.id === id);
    if (target) {
      setCurrentParentId(target.parentId || null);
      setActiveItemId(id);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, deliverables, setSearchParams]);

  /**
   * The enriched row wins.
   *
   * This used to read the raw store first and fall back to the enriched list.
   * The raw record carries no proposal at all, so for an EXISTING deliverable
   * with a pending edit the detail panel got a plain record: no old-versus-new
   * anywhere, and every double-click wrote straight to the real deliverable
   * instead of to the proposal. Only a proposed NEW deliverable behaved
   * correctly, because its invented id is absent from the store and the
   * fallback ran. Reversing the order fixes both at once.
   */
  const realActiveItem = activeItemId
    ? (projectDeliverables.find(d => d.id === activeItemId)
        || deliverables.find(d => d.id === activeItemId)
        || null)
    : null;
  const effectiveIsEditing = isEditing || !!(realActiveItem as any)?.isAcrProposedAdd;

  /**
   * An archived deliverable is read-only. Restore it first to change it.
   *
   * Read the STORED value, not the row. An enriched row carries the PROPOSED
   * value, so a pending unarchiveDeliverable would otherwise unlock the fields
   * of a record that is still archived and still out of the active list.
   * `acrOriginal` is the record before any proposal. Same rule as TaskTray.
   */
  const storedIsArchived = !!(
    ((realActiveItem as any)?.acrOriginal ?? realActiveItem) as any
  )?.isArchived;
  const readOnly = storedIsArchived;

  React.useEffect(() => {
    if (activeAcrChangeId) {
      const found = projectDeliverables.find(d => d.acrChangeId === activeAcrChangeId);
      if (found) {
        setActiveItemId(found.id);
        // A proposal is shown in the list it belongs to, not behind a search.
        setQuery('');
        
        // Auto scroll to card/cell ONLY if we are hovering on the ACR sidebar
        if (isMouseOverSidebar) {
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
          scrollTimeoutRef.current = setTimeout(() => {
            const cardEl = document.getElementById(`deliverable-card-${found.id}`);
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
  }, [activeAcrChangeId, projectDeliverables, isMouseOverSidebar]);
  
  let filteredDeliverables = [...projectDeliverables];
  if (filterPriority !== 'All') {
    // "No Priority" is the value 'undefined'. Compare against the same
    // spelling, or that option can never match anything.
    filteredDeliverables = filteredDeliverables.filter(d => (d.priority || 'undefined') === filterPriority);
  }

  filteredDeliverables.sort((a, b) => {
    if (sortBy === 'Priority') {
      const pMap: Record<string, number> = { 'High': 3, 'Medium': 2, 'Low': 1, 'undefined': 0 };
      const pA = pMap[String(a.priority)];
      const pB = pMap[String(b.priority)];
      return pB - pA;
    } else if (sortBy === 'Status') {
      return a.status.localeCompare(b.status);
    } else {
      return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31');
    }
  });

  // --------------------------------------------------------------- search
  // One search across every level of the project, not only the space that
  // is open: a sub-deliverable three spaces down is found from the top.
  const searchQuery = React.useMemo(() => parseSearch(query), [query]);
  const searching = !isEmptySearch(searchQuery);
  const needles = React.useMemo(() => highlightNeedles(searchQuery), [searchQuery]);
  const searchActivities = (() => {
    const tl = (projectTimelines || []).find(p => p?.projectId === activeProjectId);
    const rev = tl?.revisions?.find(r => r?.id === tl?.activeRevisionId) || tl?.revisions?.[0];
    return (rev?.activities || []).filter(Boolean);
  })();
  const deliverableDoc = (d: any): SearchDoc => ({
    text: {
      title: d.title || '',
      owner: d.owner || '',
      description: d.description || '',
      definitionOfDone: d.definitionOfDone || '',
      comments: asList(d.comments).map((c: any) => c?.text || '').join(' \n '),
      category: d.category || '',
      activity: asList(d.linkedActivityIds).map((id: string) => {
        const a = searchActivities.find((x: any) => x?.id === id);
        return a ? [a.phase, a.activity, a.subActivity].filter(Boolean).join(' ') : '';
      }).join(' '),
      status: d.status || '',
      priority: d.priority || '',
    },
    owner: d.owner, status: d.status, priority: d.priority, due: d.dueDate,
    closed: ['Signed Off', 'Dropped'].includes(d.status),
  });
  const pathOf = (d: any): string[] => {
    const trail: string[] = [];
    const seen = new Set<string>();
    let cur = d.parentId ? deliverables.find(x => x.id === d.parentId) : null;
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); trail.unshift(cur.title); cur = cur.parentId ? deliverables.find(x => x.id === cur!.parentId) : null; }
    return trail;
  };
  const searchResults: { item: any; hit: SearchHit }[] = searching && !archived && activeProjectId
    ? activeOnly(deliverables.filter(d => d.projectId === activeProjectId))
        .map(d => ({ item: d, hit: matchSearch(searchQuery, deliverableDoc(d)) }))
        .filter(r => r.hit.match)
        .sort((a, b) => (a.item.dueDate || '9999').localeCompare(b.item.dueDate || '9999'))
    : [];
  const archiveHits = new Map<string, SearchHit>();
  if (searching && archived) {
    filteredDeliverables = filteredDeliverables.filter((d: any) => {
      const hit = matchSearch(searchQuery, deliverableDoc(d));
      archiveHits.set(d.id, hit);
      return hit.match;
    });
  }
  const archivedSearchMatches = searching && !archived && activeProjectId
    ? deliverables.filter(d => d.projectId === activeProjectId && (d as any).isArchived && matchSearch(searchQuery, deliverableDoc(d)).match).length
    : 0;
  const openResult = (d: any) => {
    setCurrentParentId(d.parentId || null);
    setActiveItemId(d.id);
    setIsEditing(false);
  };

  const groupedDeliverables = filteredDeliverables.reduce((acc, curr) => {
    const cat = curr.category || 'UNCATEGORIZED';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(curr);
    return acc;
  }, {} as Record<string, Deliverable[]>);
  
  const currentTimeline = (projectTimelines || []).find(p => p?.projectId === activeProjectId);
  const activeRevision = currentTimeline?.revisions?.find(r => r?.id === currentTimeline?.activeRevisionId) || currentTimeline?.revisions?.[0];
  const timelineActivities = (activeRevision?.activities || []).filter(Boolean);

  const handleAddNew = () => {
    if (!activeProjectId) return;
    addDeliverable({
      projectId: activeProjectId,
      parentId: currentParentId || null,
      title: 'New Deliverable',
      description: '',
      definitionOfDone: '',
      status: 'Pending',
      dueDate: '',
      owner: '',
      hasNestedSpace: false,
      comments: []
    });
  };

  const handleUpdate = (id: string, updates: Partial<Deliverable>) => {
    if (realActiveItem && ((realActiveItem as any).isAcrProposedAdd || (realActiveItem as any).isAcrProposedUpdate)) {
      const changeId = (realActiveItem as any).acrChangeId;
      if (changeId && activeAcrId) {
        const foundChange = acr?.changes.find(c => c.id === changeId);
        if (foundChange) {
          const newArgs = { ...foundChange.args, ...updates };
          useAcrStore.getState().updateAcrChange(activeAcrId, changeId, { args: newArgs });
        }
      }
    } else {
      updateDeliverable(id, updates);
    }
  };

  const handleCopy = (item: Deliverable) => {
    if (!activeProjectId) return;
    addDeliverable({
      projectId: activeProjectId,
      parentId: currentParentId || null,
      title: `${item.title} (COPY)`,
      description: item.description || '',
      definitionOfDone: item.definitionOfDone || '',
      status: item.status || 'Pending',
      dueDate: item.dueDate || '',
      category: item.category || undefined,
      priority: item.priority || undefined,
      owner: item.owner || '',
      hasNestedSpace: false,
      comments: [],
      linkedActivityIds: item.linkedActivityIds ? [...item.linkedActivityIds] : []
    });
  };

  const handleOpenNestedSpace = (deliverableId: string) => {
    createNestedSpace(deliverableId);
    setCurrentParentId(deliverableId);
    setActiveItemId(null);
    setIsEditing(false);
  };

  return (
    <div className="h-full flex bg-qb-bg font-sans">
      {/* List View */}
      {/* Rows lay out for the list's own width, not the screen's: see the
          same note in TasksTracker.tsx. */}
      <div className={`@container/list flex-1 flex flex-col pt-4 sm:pt-8 px-4 sm:pl-12 sm:pr-6 overflow-y-auto ${realActiveItem ? 'lg:mr-[var(--tray-w-sm,500px)]' : ''} transition-all duration-300`}>
        
        {/* Breadcrumb Navigation when inside Nested Space */}
        {currentParentId && (
          <div className="flex items-center flex-wrap gap-2 mb-4 text-xs font-black uppercase tracking-widest text-qb-grey border-b border-qb-light-grey pb-3">
            <button 
              onClick={() => { setCurrentParentId(null); setActiveItemId(null); }}
              className="hover:text-qb-orange transition-colors flex items-center gap-1 text-qb-dark-grey"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>DELIVERABLES ROOT</span>
            </button>
            {parentTrail.map((p, idx) => {
              const isLast = idx === parentTrail.length - 1;
              return (
                <React.Fragment key={p.id}>
                  <ChevronRight className="w-3.5 h-3.5 text-qb-light-grey" />
                  {isLast ? (
                    <span className="text-qb-cyan font-black flex items-center gap-1">
                      <Boxes className="w-3.5 h-3.5" />
                      {p.title}
                    </span>
                  ) : (
                    <button 
                      onClick={() => { setCurrentParentId(p.id); setActiveItemId(null); }}
                      className="hover:text-qb-cyan transition-colors text-qb-dark-grey"
                    >
                      {p.title}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Header: title, live counts for this level, controls — one line. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 mb-6">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 min-w-0">
            {currentParent && (
              <span className="self-center text-[10px] font-black uppercase tracking-widest px-2 py-0.5 bg-qb-cyan/15 text-qb-cyan border border-qb-cyan/40">
                NESTED SPACE
              </span>
            )}
            <h1 className="text-2xl font-black text-qb-black uppercase tracking-widest leading-tight">
              {currentParent ? currentParent.title : 'Deliverables'}
            </h1>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] font-mono font-bold uppercase tracking-wider text-qb-grey">
              {archived ? (
                <span>{projectDeliverables.length} in the archive</span>
              ) : (() => {
                const real = projectDeliverables.filter((d: any) => !d.isAcrProposedAdd);
                const open = real.filter((d: any) => !['Signed Off', 'Dropped'].includes(d.status));
                return (<>
                  <Stat n={open.length} label="open" />
                  <Stat n={open.filter((d: any) => dueState(d.dueDate) === 'overdue').length} label="late" tone="magenta" />
                  <Stat n={open.filter((d: any) => d.status === 'Blocked').length} label="blocked" tone="magenta" />
                  <Stat n={open.filter((d: any) => d.status === 'In Review').length} label="in review" tone="orange" />
                  <Stat n={real.filter((d: any) => d.status === 'Signed Off').length} label="signed off" />
                </>);
              })()}
              {currentParent?.owner && <span>· owner {currentParent.owner}</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={archived ? 'Search the archive…' : 'Search all deliverables…'}
            resultLabel={searching ? `${archived ? filteredDeliverables.length : searchResults.length} found` : undefined}
          />
          {/* The archive gets no filters and no sort of its own, and nothing is
              ever created in it, so the whole control cluster goes. */}
          <div className={`flex flex-wrap items-center gap-3 ${archived ? 'hidden' : ''}`}>
            {currentParent && (
              <button
                onClick={() => {
                  setCurrentParentId(currentParent.parentId || null);
                  setActiveItemId(null);
                }}
                className="flex items-center gap-2 bg-qb-black text-white px-4 py-2 font-black text-xs uppercase tracking-widest hover:bg-qb-cyan transition-colors"
                title="Return to parent space"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{currentParent.parentId ? 'PARENT SPACE' : 'ALL DELIVERABLES'}</span>
              </button>
            )}

            <div className="flex items-center gap-2">
              <label className="text-xs font-black text-qb-grey uppercase tracking-widest">Filter:</label>
              <select 
                value={filterPriority} 
                onChange={e => setFilterPriority(e.target.value)}
                className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
              >
                <option value="All">All Priorities</option>
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
                <option value="undefined">No Priority</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-black text-qb-grey uppercase tracking-widest">Sort:</label>
              <select 
                value={sortBy} 
                onChange={e => setSortBy(e.target.value as any)}
                className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
              >
                <option value="Date">Due Date</option>
                <option value="Priority">Priority</option>
                <option value="Status">Status</option>
              </select>
            </div>
            <button 
              onClick={handleAddNew}
              className={headerButtonClass(true)}
            >
              <Plus className="w-4 h-4" /> NEW DELIVERABLE
            </button>
          </div>
          </div>
        </div>

        <ArchiveTabs basePath="/deliverables" archivedCount={archivedCount} />

        {/* Parent Deliverable Info Banner */}
        {currentParent && (
          <div className="mb-8 p-4 border border-qb-light-grey bg-qb-box-bg/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black text-qb-grey uppercase tracking-widest">PARENT DELIVERABLE SPECIFICATION</span>
              <p className="text-sm font-bold text-qb-black">{currentParent.description || 'No parent description provided.'}</p>
              {currentParent.definitionOfDone && (
                <p className="text-xs text-qb-dark-grey italic mt-0.5">DoD: {currentParent.definitionOfDone}</p>
              )}
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1" style={{ backgroundColor: tint(STATUS_COLORS[currentParent.status]), color: STATUS_COLORS[currentParent.status] }}>
                {currentParent.status}
              </span>
              {currentParent.dueDate && (
                <div className="text-[11px] font-mono font-bold text-qb-dark-grey uppercase">
                  DUE: {formatDateDisplay(currentParent.dueDate)}
                </div>
              )}
              <button
                onClick={() => { setActiveItemId(currentParent.id); setIsEditing(false); }}
                className="text-xs font-bold uppercase tracking-wider text-qb-cyan hover:underline"
              >
                VIEW PARENT DETAILS
              </button>
            </div>
          </div>
        )}

        {/* List Content */}
        <div className="flex-1 pb-12">
          <div className="flex flex-col gap-8">
            {searching && !archived ? (
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-black text-qb-dark-grey uppercase tracking-[0.15em]">
                    Search results · every space
                  </h2>
                  {archivedSearchMatches > 0 && (
                    <span className="text-[10px] font-black uppercase tracking-widest text-qb-grey">
                      {archivedSearchMatches} more in the archive (search there to see them)
                    </span>
                  )}
                </div>
                {searchResults.length === 0 && (
                  <div className="text-center py-12 text-qb-grey font-medium tracking-widest uppercase text-sm border border-dashed border-qb-light-grey">
                    Nothing matches “{query}”.
                    <button type="button" onClick={() => setQuery('')} className="ml-3 text-qb-orange font-black">Clear search</button>
                  </div>
                )}
                {searchResults.map(({ item, hit }) => {
                  const path = pathOf(item);
                  const hidden = hit.fields.find(f => HIDDEN_FIELD_LABEL[f]);
                  const doc = deliverableDoc(item);
                  const due = item.dueDate ? dueState(item.dueDate, ['Signed Off', 'Dropped'].includes(item.status)) : 'none';
                  const tag = item.dueDate ? dueTag(item.dueDate, due) : null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openResult(item)}
                      className={`text-left py-3 px-4 border-b border-qb-light-grey hover:bg-black/5 transition-colors flex flex-col md:flex-row md:items-center gap-2 md:gap-4 ${realActiveItem?.id === item.id ? 'bg-qb-box-bg' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        {path.length > 0 && (
                          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-qb-cyan truncate">
                            <Boxes className="w-3 h-3 shrink-0" />
                            <span className="truncate">{path.join(' › ')}</span>
                          </div>
                        )}
                        <div className="text-base font-medium text-qb-black truncate">
                          <Highlight text={item.title || 'Untitled Deliverable'} needles={needles} />
                        </div>
                        {hidden && !hit.fields.includes('title') && (
                          <div className="text-[11px] text-qb-dark-grey truncate">
                            <span className="font-black uppercase tracking-widest text-qb-orange text-[10px] mr-1">in {HIDDEN_FIELD_LABEL[hidden]}:</span>
                            <Highlight text={snippetAround(doc.text[hidden], needles, 50)} needles={needles} />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 shrink-0">
                        <span className="text-[10px] font-bold font-mono text-qb-dark-grey uppercase">
                          {item.owner ? <Highlight text={item.owner} needles={needles} /> : 'No owner'}
                        </span>
                        {item.dueDate && (
                          <span className={`text-[10px] font-bold font-mono uppercase tracking-wider ${dueDateClass(due)}`}>
                            {formatDateDisplay(item.dueDate)}{tag && <span className="ml-1.5 font-black">· {tag}</span>}
                          </span>
                        )}
                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5" style={{ backgroundColor: tint(STATUS_COLORS[item.status]), color: STATUS_COLORS[item.status] }}>
                          {item.status}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : projectDeliverables.length === 0 ? (
              <div className="text-center py-20 text-qb-grey font-medium tracking-widest uppercase border border-dashed border-qb-light-grey p-8">
                {currentParent ? (
                  <div className="flex flex-col items-center gap-3">
                    <Boxes className="w-8 h-8 text-qb-grey" />
                    <span>No sub-deliverables yet inside this nested space.</span>
                    <button 
                      onClick={handleAddNew}
                      className="mt-2 text-xs font-bold uppercase tracking-widest bg-qb-cyan text-white px-4 py-2 hover:bg-qb-cyan/90 transition-colors"
                    >
                      + Add First Nested Deliverable
                    </button>
                  </div>
                ) : (
                  "No deliverables yet. Click 'New Deliverable' to start."
                )}
              </div>
            ) : (
              // Groups follow the project: the one with the earliest open due
              // date first (they used to be alphabetical — BUILD before DESIGN).
              Object.keys(groupedDeliverables).sort((a, b) => {
                const firstDue = (cat: string) => groupedDeliverables[cat]
                  .filter((d: any) => !['Signed Off', 'Dropped'].includes(d.status) && d.dueDate)
                  .map((d: any) => String(d.dueDate).slice(0, 10))
                  .sort()[0] || '9999-12-31';
                return firstDue(a).localeCompare(firstDue(b)) || a.localeCompare(b);
              }).map(category => (
                <div 
                  key={category} 
                  className={`relative transition-colors ${dragOverCategory === category ? 'bg-black/5 rounded-r-lg' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverCategory !== category) {
                      setDragOverCategory(category);
                    }
                  }}
                  onDragLeave={() => {
                    setDragOverCategory(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverCategory(null);
                    const deliverableId = e.dataTransfer.getData('deliverableId');
                    if (deliverableId) {
                      const newCategory = category === 'UNCATEGORIZED' ? undefined : category;
                      updateDeliverable(deliverableId, { category: newCategory });
                    }
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <ChevronRight className="w-5 h-5 text-qb-orange" />
                    <h2 className="text-xl font-black text-qb-dark-grey uppercase tracking-[0.15em]">{category}</h2>
                  </div>
                  <div className="pl-8 relative">
                    <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-qb-light-grey"></div>
                    <div className="flex flex-col">
                      {groupedDeliverables[category].map((item) => {
                        const childCount = deliverables.filter(d => d.parentId === item.id).length;
                        return (
                          <div 
                            key={item.id}
                            id={`deliverable-card-${item.id}`}
                            draggable={!archived && !(item as any).isAcrProposedAdd}
                            onDragStart={(e) => {
                              if ((item as any).isAcrProposedAdd) {
                                e.preventDefault();
                                return;
                              }
                              e.dataTransfer.setData('deliverableId', item.id);
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
                            className={`cursor-pointer group flex flex-col @min-[860px]/list:flex-row @min-[860px]/list:items-center justify-between py-4 border-b border-qb-light-grey transition-all duration-300 hover:bg-black/5 px-4 gap-3 ${
                              realActiveItem?.id === item.id ? 'bg-qb-box-bg' : ''
                            } ${
                              (item as any).isFocusedChange ? 'ring-2 ring-qb-orange bg-qb-orange/5 animate-pulse' : ''
                            } ${
                              (item as any).isAcrProposedAdd ? 'border-l-4 border-[#51b53e] bg-[#51b53e]/5' : ''
                            } ${
                              (item as any).isAcrProposedUpdate ? 'border-l-4 border-[#ff7600] bg-[#ff7600]/5' : ''
                            } ${
                              (item as any).isAcrProposedDelete ? 'border-l-4 border-qb-magenta bg-qb-magenta/5 opacity-75' : ''
                            }`}
                          >
                            {/* Same rule as a risk row: the title keeps 10rem, labels wrap. */}
                            <div className="flex flex-wrap @min-[860px]/list:flex-nowrap items-center gap-x-3 gap-y-1.5 flex-1 min-w-0 mr-2">
                              <h3 className={`text-base sm:text-lg tracking-wide truncate flex-1 min-w-[10rem] ${realActiveItem?.id === item.id ? 'font-black text-qb-black' : 'font-medium text-qb-dark-grey'} ${(item as any).isAcrProposedDelete ? 'line-through text-qb-grey' : ''}`}>
                                <Highlight text={item.title || 'Untitled Deliverable'} needles={needles} />
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
                              {((item as any).acrCommentChanges || []).length > 0 && (
                                <span className="text-[9px] font-black tracking-widest text-qb-cyan border border-qb-cyan px-1.5 py-0.5 uppercase bg-qb-cyan/10 shrink-0">
                                  {(item as any).acrCommentChanges.length} PROPOSED COMMENT{(item as any).acrCommentChanges.length === 1 ? '' : 'S'}
                                </span>
                              )}
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-3 sm:gap-4 shrink-0">
                              {/* Owner Badge */}
                              {item.owner ? (
                                <div className="flex items-center gap-1 text-[10px] font-bold font-mono text-qb-dark-grey bg-black/5 px-2 py-0.5 border border-qb-light-grey uppercase" title={`Owner: ${item.owner}`}>
                                  <User className="w-3 h-3 text-qb-grey" />
                                  <span className="truncate max-w-[120px]">{item.owner}</span>
                                </div>
                              ) : (
                                <span className="text-[10px] font-mono font-bold text-qb-grey uppercase px-1.5 py-0.5 bg-black/5">
                                  NO OWNER
                                </span>
                              )}

                              {item.dueDate && (() => {
                                const due = dueState(item.dueDate, archived || ['Signed Off', 'Dropped'].includes(item.status));
                                const tag = dueTag(item.dueDate, due);
                                return (
                                  <DateVisualizer date={item.dueDate}>
                                    <span className={`text-[10px] font-bold font-mono ${dueDateClass(due)} hover:text-qb-black transition-colors uppercase tracking-wider cursor-default whitespace-nowrap`}>
                                      {formatDateDisplay(item.dueDate)}
                                      {tag && <span className="ml-1.5 font-black">· {tag}</span>}
                                    </span>
                                  </DateVisualizer>
                                );
                              })()}

                              {item.priority && (
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border ${priorityChipClass(item.priority)}`}>
                                  {item.priority}
                                </span>
                              )}

                              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5" style={{ backgroundColor: tint(STATUS_COLORS[item.status]), color: STATUS_COLORS[item.status] }}>
                                {item.status}
                              </span>

                              {/* Nested Space Button */}
                              {item.hasNestedSpace || childCount > 0 ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenNestedSpace(item.id);
                                  }}
                                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-1 border border-qb-cyan text-qb-cyan bg-qb-cyan/10 hover:bg-qb-cyan hover:text-white transition-colors"
                                  title="Open Nested Deliverables Space"
                                >
                                  <Boxes className="w-3.5 h-3.5" />
                                  <span>SPACE ({childCount})</span>
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenNestedSpace(item.id);
                                  }}
                                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 border border-qb-light-grey text-qb-grey hover:border-qb-cyan hover:text-qb-cyan hover:bg-qb-cyan/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                  title="Create Nested Deliverables Space"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>NESTED SPACE</span>
                                </button>
                              )}

                              <div className="flex items-center gap-1 text-qb-grey">
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span className="text-xs font-bold font-mono">
                                  {(deliverables.find(d => d.id === item.id)?.comments || []).length}
                                  {((item as any).acrCommentChanges || []).length > 0 && (
                                    <span className="text-qb-cyan"> +{(item as any).acrCommentChanges.length}</span>
                                  )}
                                </span>
                              </div>

                              {!(item as any).isAcrProposedAdd && !(item as any).isAcrProposedUpdate && !(item as any).isAcrProposedDelete && (
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCopy(item); }}
                                    className="text-qb-light-grey hover:text-qb-orange transition-colors opacity-0 group-hover:opacity-100"
                                    title="Copy Deliverable"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(item.id); }}
                                    className="text-qb-light-grey hover:text-qb-magenta transition-colors opacity-0 group-hover:opacity-100"
                                    title="Delete Deliverable"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}

                              {item.status !== 'Dropped' && (
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${['Signed Off', 'Completed'].includes(item.status) ? 'border-qb-green text-qb-green' : 'border-qb-light-grey text-transparent'}`}>
                                  <Check className="w-3.5 h-3.5" />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Details / Edit Panel */}
      <div
        className={`@container/tray fixed top-0 right-0 h-full w-full lg:w-[var(--tray-w-sm,500px)] bg-qb-bg lg:border-l-4 border-l-0 border-qb-black transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col z-40 lg:z-30 shadow-2xl lg:shadow-none ${realActiveItem ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {realActiveItem && (
          <>
            <header className="flex justify-between items-center gap-3 px-6 @min-[540px]/tray:px-12 py-6 lg:py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
              <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest leading-none">DELIVERABLE DETAILS</span>
                <h2 className="text-lg @min-[540px]/tray:text-2xl font-black text-qb-black uppercase tracking-widest mt-1">
                  {effectiveIsEditing ? 'EDIT DELIVERABLE' : 'VIEW DELIVERABLE'}
                </h2>
              </div>
              <div className="flex items-center gap-2 @min-[540px]/tray:gap-4 shrink-0">
                {!(realActiveItem as any).isAcrProposedAdd && !(realActiveItem as any).isAcrProposedUpdate && !(realActiveItem as any).isAcrProposedDelete && (
                  <>
                    {!readOnly && (
                      <button
                        onClick={() => handleCopy(realActiveItem)}
                        className="p-3 bg-transparent text-qb-grey border-2 border-transparent hover:text-qb-orange hover:border-qb-orange transition-colors cursor-pointer"
                        title="Copy Deliverable"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                    {/* Archive sits before delete: the gentler of the two
                        first, and the pair reads left to right from least to
                        most final. Archiving a parent takes its whole subtree
                        with it, and restoring brings the subtree back — see
                        PLAN.md 21.2. Closing the tray afterwards is not
                        cosmetic: the record has just left the list behind it. */}
                    <ArchiveButton
                      noun="deliverable"
                      isArchived={storedIsArchived}
                      onArchive={() => { archiveDeliverable(realActiveItem.id); setActiveItemId(null); setIsEditing(false); }}
                      onRestore={() => { unarchiveDeliverable(realActiveItem.id); setActiveItemId(null); setIsEditing(false); }}
                    />
                    <button
                      onClick={() => setShowDeleteConfirm(realActiveItem.id)}
                      className="p-3 bg-transparent text-qb-dark-grey border-2 border-transparent hover:text-qb-magenta hover:border-qb-magenta transition-colors cursor-pointer"
                      title="Delete Deliverable"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {!readOnly && (
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
                    )}
                  </>
                )}
                <button
                  onClick={() => { setActiveItemId(null); setIsEditing(false); }}
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
              {(realActiveItem as any).isAcrProposedDelete && (
                <AcrStatusLine
                  actionName={(realActiveItem as any).acrChange.name}
                  declined={(realActiveItem as any).acrApproved === false}
                />
              )}

              {/* Title Field */}
              <div>
                <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-1">
                  Deliverable Title
                </label>
                <EditableField
                  {...acrFieldProps(realActiveItem, 'title')}
                  disabled={readOnly}
                  placeholder="UNTITLED DELIVERABLE"
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { title: newVal })}
                  textClassName="text-3xl font-black text-qb-black uppercase tracking-tight leading-snug py-1"
                />
              </div>

              {/* Fields & Diff Logic */}
              {(() => {
                // Every field draws itself from the shared diff. There is no
                // list to keep in step, so no field can be left out of it.
                // `disabled` rides along here, so every field this tray draws
                // goes read-only at once when the record is archived. One place
                // to change it, and no field can be left behind.
                const f = (key: string) => ({ ...acrFieldProps(realActiveItem, key), disabled: readOnly });
                const SHOWN_FIELDS = [
                  'title', 'owner', 'category', 'status', 'priority',
                  'dueDate', 'linkedActivityIds', 'description', 'definitionOfDone',
                ];
                const otherDiffs = acrUnshownDiffs(realActiveItem, SHOWN_FIELDS);

                const nestedChildCount = deliverables.filter(d => d.parentId === realActiveItem.id).length;

                return (
                  <div className="flex flex-col gap-10">
                    {/* Owner & Category Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        label="Owner"
                        {...f('owner')}
                        placeholder="UNASSIGNED"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { owner: newVal.trim() })}
                        textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                      />

                      <EditableField
                        label="Category"
                        {...f('category')}
                        placeholder="UNCATEGORIZED"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { category: newVal.trim() ? newVal.trim() : undefined })}
                        textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                      />
                    </div>

                    {/* Status & Priority */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        label="Status"
                        type="select"
                        options={STATUS_OPTIONS}
                        {...f('status')}
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { status: newVal as DeliverableStatus })}
                        displayFormatter={(val) => (
                          <span className="text-[11px] font-black uppercase tracking-widest px-2.5 py-1 inline-block" style={{ backgroundColor: tint(STATUS_COLORS[val] || 'var(--color-qb-grey)'), color: STATUS_COLORS[val] || 'var(--color-qb-grey)' }}>
                            {val}
                          </span>
                        )}
                      />

                      <EditableField
                        label="Priority"
                        type="select"
                        options={[
                          { label: '-- NONE --', value: '' },
                          { label: 'LOW', value: 'Low' },
                          { label: 'MEDIUM', value: 'Medium' },
                          { label: 'HIGH', value: 'High' }
                        ]}
                        {...f('priority')}
                        placeholder="NONE"
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { priority: (newVal || undefined) as any })}
                        displayFormatter={(val) => val ? (
                          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border ${priorityChipClass(val)}`}>
                            {val}
                          </span>
                        ) : 'NONE'}
                      />
                    </div>

                    {/* Due Date & Linked Activity */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                      <EditableField
                        label="Due Date"
                        type="date"
                        {...f('dueDate')}
                        onSave={(newVal) => handleUpdate(realActiveItem.id, { dueDate: newVal })}
                        displayFormatter={(val) => formatDateDisplay(val)}
                        textClassName="text-sm font-bold text-qb-black font-mono uppercase tracking-wide py-1"
                      />

                      <EditableField
                        label="Linked Activity"
                        type="select"
                        searchable={true}
                        searchPlaceholder="Search by activity, sub-activity or phase..."
                        options={[
                          { label: '-- NONE --', value: '' },
                          ...timelineActivities.map(act => ({
                            label: act.activity || act.subActivity || 'Untitled Activity',
                            value: act.id,
                            secondary: act.subActivity || undefined,
                            phase: act.phase || undefined
                          }))
                        ]}
                        value={(Array.isArray(realActiveItem.linkedActivityIds) ? realActiveItem.linkedActivityIds : []).find(id => timelineActivities.some(act => act.id === id)) || ''}
                        onSave={(newVal) => {
                          const newLinkedIds = Array.isArray(realActiveItem.linkedActivityIds) ? [...realActiveItem.linkedActivityIds] : [];
                          timelineActivities.forEach(act => {
                            const idx = newLinkedIds.indexOf(act.id);
                            if (idx !== -1) newLinkedIds.splice(idx, 1);
                          });
                          if (newVal) newLinkedIds.push(newVal);
                          handleUpdate(realActiveItem.id, { linkedActivityIds: newLinkedIds });
                        }}
                        displayFormatter={(val) => {
                          const act = timelineActivities.find(a => a?.id === val);
                          if (!act) return '--';
                          if (act.activity && act.subActivity) {
                            return `${act.activity} - ${act.subActivity}`;
                          }
                          return act.activity || act.subActivity || '--';
                        }}
                        textClassName="text-sm font-bold text-qb-black tracking-wide truncate py-1"
                      />
                    </div>

                    {/* Description */}
                    <EditableField
                      label="Description"
                      type="textarea"
                      rows={4}
                      {...f('description')}
                      onSave={(newVal) => handleUpdate(realActiveItem.id, { description: newVal })}
                      textClassName="text-base text-qb-dark-grey leading-relaxed whitespace-pre-wrap py-1"
                    />

                    {/* Definition Of Done */}
                    <EditableField
                      label="Definition of Done"
                      type="textarea"
                      rows={3}
                      {...f('definitionOfDone')}
                      onSave={(newVal) => handleUpdate(realActiveItem.id, { definitionOfDone: newVal })}
                      textClassName="text-base text-qb-dark-grey leading-relaxed whitespace-pre-wrap py-1"
                    />

                    {/* Nested Deliverables Space Section in Drawer.
                        Hidden on an archived record: its sub-deliverables were
                        archived with it, so the space behind this button is
                        empty, and the button would navigate out of the archive
                        into an active drill-down. Restore first. */}
                    {!readOnly && (
                    <div className="p-5 border-2 border-qb-light-grey bg-qb-box-bg/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Boxes className="w-5 h-5 text-qb-cyan" />
                        <h3 className="text-xs font-black text-qb-black uppercase tracking-widest">
                          NESTED DELIVERABLES SPACE
                        </h3>
                      </div>

                      {realActiveItem.hasNestedSpace || nestedChildCount > 0 ? (
                        <div>
                          <p className="text-xs text-qb-dark-grey font-medium mb-4 leading-relaxed">
                            This deliverable has an active nested space containing <strong className="text-qb-black font-mono">{nestedChildCount}</strong> sub-deliverable(s).
                          </p>
                          <button
                            onClick={() => handleOpenNestedSpace(realActiveItem.id)}
                            className="w-full bg-qb-cyan text-white py-3 px-4 text-xs font-black uppercase tracking-widest hover:bg-qb-cyan/90 transition-colors flex items-center justify-center gap-2 shadow-sm"
                          >
                            <Boxes className="w-4 h-4" />
                            <span>OPEN NESTED SPACE ({nestedChildCount})</span>
                          </button>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs text-qb-dark-grey font-medium mb-4 leading-relaxed">
                            Break down this deliverable into sub-deliverables with their own owners, due dates, statuses, and comments in an isolated nested workspace.
                          </p>
                          <button
                            onClick={() => handleOpenNestedSpace(realActiveItem.id)}
                            className="w-full bg-qb-black text-white py-3 px-4 text-xs font-black uppercase tracking-widest hover:bg-qb-orange transition-colors flex items-center justify-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            <span>CREATE NESTED DELIVERABLES SPACE</span>
                          </button>
                        </div>
                      )}
                    </div>
                    )}

                    {/* The safety net: any proposed field this panel does not
                        draw itself. Nothing a proposal carries stays hidden. */}
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
            
            {!effectiveIsEditing && (
              <div className="mt-4 pt-8 border-t border-qb-light-grey">
                <h3 className="text-xs font-black text-qb-grey uppercase tracking-widest mb-6 flex items-center gap-2 border-b border-qb-light-grey pb-2">
                  <MessageSquare className="w-4 h-4 text-qb-orange" />
                  Comments
                </h3>
                <div className="flex flex-col gap-4 mb-6">
                  {(realActiveItem?.comments || []).map(comment => (
                    <div key={comment.id} className="bg-qb-box-bg p-4 relative group">
                      <p className="text-sm text-qb-black mb-2 leading-relaxed">{comment.text}</p>
                      <div className="flex justify-between items-center text-[10px] font-bold text-qb-grey uppercase tracking-widest mt-2 border-t border-qb-light-grey pt-2">
                        <span className={comment.author === 'Assistant' ? 'text-qb-orange' : ''}>{comment.author === 'Assistant' ? 'Assistant' : 'User'}</span>
                        <span>{new Date(comment.timestamp).toLocaleString()}{comment.editedAt ? ' · edited' : ''}</span>
                      </div>
                      <button 
                        onClick={() => realActiveItem && deleteComment(realActiveItem.id, comment.id)}
                        className="absolute top-2 right-2 text-qb-light-grey hover:text-qb-magenta opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {/* A proposed comment, shown where comments live rather
                      than only as a title in the review panel. */}
                  {(((realActiveItem as any)?.acrCommentChanges) || []).map((change: any) => (
                    <ProposedCommentCard key={change.id} change={change} comments={realActiveItem?.comments || []} />
                  ))}
                  {(realActiveItem?.comments || []).length === 0
                    && (((realActiveItem as any)?.acrCommentChanges) || []).length === 0 && (
                    <div className="text-xs text-qb-grey font-bold uppercase tracking-widest">NO COMMENTS YET.</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    id="new-comment"
                    placeholder="Add a comment..." 
                    className="flex-1 bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.currentTarget.value.trim() && realActiveItem) {
                        addComment(realActiveItem.id, e.currentTarget.value.trim());
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                  <button 
                    onClick={() => {
                      const input = document.getElementById('new-comment') as HTMLInputElement;
                      if (input && input.value.trim() && realActiveItem) {
                        addComment(realActiveItem.id, input.value.trim());
                        input.value = '';
                      }
                    }}
                    className="bg-qb-black text-white px-6 font-black text-xs uppercase tracking-widest hover:bg-qb-orange transition-colors"
                  >
                    Post
                  </button>
                </div>
              </div>
            )}
          </div>
          </>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title="Delete Deliverable"
          description="Are you sure you want to delete this deliverable and any nested sub-deliverables inside it?"
          subDescription="THIS ACTION CANNOT BE UNDONE."
          confirmText="YES, DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            deleteDeliverable(showDeleteConfirm);
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
}
