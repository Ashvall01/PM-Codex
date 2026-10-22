import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTasksStore, Task, TaskStatus, TaskType } from '../../store/tasksStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useAppStore } from '../../store/appStore';
import { Plus, Trash2, Edit2, MessageSquare, X, ChevronRight, Check, Flag } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { TaskTray } from "./components/TaskTray";
import { DateVisualizer } from '../../components/DateVisualizer';
import { format } from 'date-fns';
import { useAcrStore } from '../../store/acrStore';
import { enrichWithAcr } from '../../utils/acrDiff';
import { activeOnly, archivedOnly, byArchivedDesc } from '../../utils/archive';
import { ArchiveTabs } from '../../components/ArchiveTabs';
import { TASK_STATUS_COLORS, priorityChipClass, dueState, dueDateClass, dueTag } from '../../utils/statusStyle';
import { PageHeader, Stat, headerButtonClass } from '../../components/PageHeader';
import { useDiscardUntouchedNew } from '../../hooks/useDiscardUntouchedNew';
import { useNavigate } from 'react-router-dom';
import { SearchBox, Highlight } from '../../components/SearchBox';
import { parseSearch, isEmptySearch, matchSearch, highlightNeedles, snippetAround, asList, SearchDoc, SearchHit } from '../../utils/recordSearch';

/** Where a search hit outside the row's visible text is named ("in comments"). */
const HIDDEN_FIELD_LABEL: Record<string, string> = {
  remarks: 'remarks', comments: 'comments', source: 'source', activity: 'linked activity',
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

const STATUS_COLORS: Record<string, string> = TASK_STATUS_COLORS;
// Closed groups start folded: what is finished is rarely what you came for.
const FOLDED_BY_DEFAULT = ['Done', 'Dropped'];
const UNASSIGNED = '__unassigned__';

// Per-browser view choices. Storage can refuse (private window, full): the
// page then just starts with the defaults.
const readPref = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const writePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* keep the default next time */ }
};

/** A task exactly as New Item made it: nothing typed, set or attached. */
const isUntouchedNewTask = (t?: Task) => !!t
  && !(t.description || '').trim() && !(t.owner || '').trim() && !t.estimatedResolutionDate
  && !(t.remarks || '').trim() && !(t.source || '').trim() && !t.priority && !t.isFlagged
  && t.status === 'Open' && t.type === 'Action Item'
  && !(t.comments || []).length && !(t.linkedActivityIds || []).length;

const STATUS_OPTIONS: TaskStatus[] = ['Open', 'In Progress', 'On Hold', 'Blocked', 'Done', 'Dropped'];
const TYPE_OPTIONS: TaskType[] = ['Action Item', 'Issue'];

interface TasksTrackerProps {
  /**
   * Draw the archive instead of the active list. Routed at
   * /tasks-issues/archive. The archive is a DIFFERENT list, not this list with
   * fewer rows: no status groups, no filters, no sort, and every field in the
   * tray is read-only. PLAN.md section 20.
   */
  archived?: boolean;
}

export const TasksTracker: React.FC<TasksTrackerProps> = ({ archived = false }) => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const { tasks, addTask, updateTask, deleteTask, toggleFlag, addComment, deleteComment } = useTasksStore();
  const projectTimelines = useTimelineStore(state => state.projectTimelines);

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const scrollTimeoutRef = React.useRef<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [filterFlagged, setFilterFlagged] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'Date' | 'Priority'>('Date');
  // The search. Starts from ?q= so "show the ones in the archive" keeps it.
  const [query, setQuery] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get('q') || ''; } catch { return ''; }
  });
  const navigate = useNavigate();
  const [folded, setFolded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(FOLDED_BY_DEFAULT.map(st => [st, true])),
  );
  // "Mine" is the owner filter set to your own name; it is remembered per
  // project in this browser. Grouping by owner shows who holds what.
  const ownerPrefKey = `pm-codex-tasks-owner:${activeProjectId || ''}`;
  const [filterOwner, setFilterOwnerState] = useState<string>(() => readPref(ownerPrefKey, 'All'));
  const setFilterOwner = (v: string) => { setFilterOwnerState(v); writePref(ownerPrefKey, v); };
  const [groupBy, setGroupByState] = useState<'status' | 'owner'>(() => (readPref('pm-codex-tasks-group-by', 'status') === 'owner' ? 'owner' : 'status'));
  const setGroupBy = (v: 'status' | 'owner') => { setGroupByState(v); writePref('pm-codex-tasks-group-by', v); };
  React.useEffect(() => { setFilterOwnerState(readPref(ownerPrefKey, 'All')); }, [ownerPrefKey]);

  const { activeAcrId, activeAcrChangeId, isMouseOverSidebar } = useAcrStore();
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));

  /**
   * One shared enrichment, the same call in every module.
   *
   * Rows come back holding the PROPOSED values, so the list shows what the task
   * will become, plus `acrOriginal` and `acrDiffs` so the tray can show what it
   * was. This replaces a hand-written merge that showed the old values in the
   * list and quietly dropped any field nobody had written a line for.
   */
  const projectTasks = React.useMemo(() => {
    const ofProject = activeProjectId ? tasks.filter(t => t.projectId === activeProjectId) : [];

    /**
     * Split on the STORED flag, before the enrichment, never after.
     *
     * Enrichment hands back rows holding the PROPOSED values. Filtering on
     * those would make a task a change request only proposes to archive vanish
     * from this list the moment the proposal was filed — the change applying
     * itself before anyone approved it. Filtering first means a proposed
     * archive shows up right where the user already is, as an orange PROPOSED
     * EDIT row.
     */
    const realTasks = archived
      ? archivedOnly(ofProject).sort(byArchivedDesc)
      : activeOnly(ofProject);

    return enrichWithAcr<any>(
      realTasks,
      acr,
      {
        // Nothing is ever born archived, so the archive view shows no proposed
        // additions. Everything else is the same in both views.
        add: archived ? [] : ['addTask'],
        update: ['updateTask', 'archiveTask', 'unarchiveTask', 'flagTask', 'unflagTask'],
        remove: ['deleteTask'],
        comment: ['addTaskComment', 'editTaskComment'],
      },
      activeAcrChangeId,
      (chg) => ({
        id: `acr-add-${chg.id}`,
        projectId: activeProjectId,
        description: chg.args.description || 'Proposed Task',
        status: chg.args.status || 'Open',
        type: chg.args.type || 'Action Item',
        priority: chg.args.priority || 'Medium',
        isFlagged: false,
        owner: chg.args.owner || '',
        comments: [],
        createdDate: chg.args.createdDate || new Date().toISOString(),
        linkedActivityIds: chg.args.linkedActivityIds || [],
        estimatedResolutionDate: chg.args.estimatedResolutionDate || '',
        source: chg.args.source || '',
        remarks: chg.args.remarks || '',
      }),
    ).map(row => ({ ...row, isReal: !row.isAcrProposedAdd }));
  }, [tasks, activeProjectId, acr, activeAcrChangeId, archived]);

  const archivedCount = React.useMemo(
    () => (activeProjectId ? archivedOnly(tasks.filter(t => t.projectId === activeProjectId)).length : 0),
    [tasks, activeProjectId],
  );

  // Switching tabs must close the tray. Otherwise it keeps showing a record
  // that is no longer in the list behind it.
  React.useEffect(() => {
    setActiveItemId(null);
    setIsEditing(false);
  }, [archived]);

  // ?open=<id> (from the Overview) opens that record's panel, then leaves the
  // address clean so a reload does not reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  React.useEffect(() => {
    const id = searchParams.get('open');
    if (!id) return;
    if (tasks.some(t => t.id === id)) setActiveItemId(id);
    setSearchParams({}, { replace: true });
  }, [searchParams, tasks, setSearchParams]);

  const realActiveItem = activeItemId ? projectTasks.find(t => t.id === activeItemId) || null : null;
  const effectiveIsEditing = isEditing || !!(realActiveItem as any)?.isAcrProposedAdd;

  React.useEffect(() => {
    if (activeAcrChangeId) {
      const found = projectTasks.find(t => t.acrChangeId === activeAcrChangeId);
      if (found) {
        setActiveItemId(found.id);
        
        // Auto scroll to card/cell ONLY if we are hovering on the ACR sidebar
        if (isMouseOverSidebar) {
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
          scrollTimeoutRef.current = setTimeout(() => {
            const cardEl = document.getElementById(`task-card-${found.id}`);
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
  }, [activeAcrChangeId, projectTasks, isMouseOverSidebar]);
  
  const timelineActivitiesForSearch = (() => {
    const tl = (projectTimelines || []).find(p => p?.projectId === activeProjectId);
    const rev = tl?.revisions?.find(r => r?.id === tl?.activeRevisionId) || tl?.revisions?.[0];
    return (rev?.activities || []).filter(Boolean);
  })();
  let filteredTasks = [...projectTasks];
  if (filterPriority !== 'All') {
    // "No Priority" is the value 'undefined'. Compare against the same
    // spelling, or that option can never match anything.
    filteredTasks = filteredTasks.filter(t => (t.priority || 'undefined') === filterPriority);
  }
  if (filterFlagged === 'Flagged') {
    filteredTasks = filteredTasks.filter(t => t.isFlagged);
  } else if (filterFlagged === 'Unflagged') {
    filteredTasks = filteredTasks.filter(t => !t.isFlagged);
  }
  // Owners are typed by hand, so "Rina" and "rina " are one person.
  const ownerKey = (o?: string) => (o || '').trim().toLowerCase();
  const ownerNames = React.useMemo(() => {
    const seen = new Map<string, string>();
    projectTasks.forEach((t: any) => { const k = ownerKey(t.owner); if (k && !seen.has(k)) seen.set(k, (t.owner || '').trim()); });
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [projectTasks]);
  if (filterOwner === UNASSIGNED) {
    filteredTasks = filteredTasks.filter(t => !ownerKey(t.owner));
  } else if (filterOwner !== 'All') {
    filteredTasks = filteredTasks.filter(t => ownerKey(t.owner) === filterOwner);
  }

  // Search, on top of the filters. A row a pending proposal touches stays
  // visible whatever the search says: every proposal shows where it applies.
  const searchQuery = React.useMemo(() => parseSearch(query), [query]);
  const searching = !isEmptySearch(searchQuery);
  const needles = React.useMemo(() => highlightNeedles(searchQuery), [searchQuery]);
  const activityName = (id: string) => {
    const a = timelineActivitiesForSearch.find((x: any) => x?.id === id);
    return a ? [a.phase, a.activity, a.subActivity].filter(Boolean).join(' ') : '';
  };
  const taskDoc = (t: any): SearchDoc => ({
    text: {
      description: t.description || '',
      owner: t.owner || '',
      remarks: t.remarks || '',
      comments: asList(t.comments ?? tasks.find(x => x.id === t.id)?.comments).map((c: any) => c?.text || '').join(' \n '),
      source: t.source || '',
      activity: asList(t.linkedActivityIds).map(activityName).join(' '),
      type: t.type || '',
      status: t.status || '',
      priority: t.priority || '',
    },
    owner: t.owner, status: t.status, type: t.type, priority: t.priority,
    due: t.estimatedResolutionDate, flagged: !!t.isFlagged, closed: ['Done', 'Dropped'].includes(t.status),
  });
  const searchHits = new Map<string, SearchHit>();
  if (searching) {
    filteredTasks = filteredTasks.filter((t: any) => {
      const hit = matchSearch(searchQuery, taskDoc(t));
      searchHits.set(t.id, hit);
      return hit.match || t.isAcrProposedAdd || t.isAcrProposedUpdate || t.isAcrProposedDelete || (t.acrCommentChanges || []).length > 0;
    });
  }
  // The archive view lists every archived row; the search is its only filter.
  const archiveRows = archived && searching
    ? projectTasks.filter((t: any) => { const h = matchSearch(searchQuery, taskDoc(t)); searchHits.set(t.id, h); return h.match; })
    : projectTasks;
  const foundCount = archived ? archiveRows.length : filteredTasks.filter((t: any) => searchHits.get(t.id)?.match).length;
  const archivedMatches = searching && !archived && activeProjectId
    ? archivedOnly(tasks.filter(t => t.projectId === activeProjectId)).filter(t => matchSearch(searchQuery, taskDoc(t)).match).length
    : 0;

  filteredTasks.sort((a, b) => {
    if (sortBy === 'Priority') {
      const pMap: Record<string, number> = { 'High': 3, 'Medium': 2, 'Low': 1, 'undefined': 0 };
      const pA = pMap[String(a.priority)];
      const pB = pMap[String(b.priority)];
      return pB - pA;
    } else {
      return (a.estimatedResolutionDate || '9999-12-31').localeCompare(b.estimatedResolutionDate || '9999-12-31');
    }
  });

  const groupedTasks = filteredTasks.reduce((acc, curr) => {
    const status = curr.status || 'Open';
    if (!acc[status]) acc[status] = [];
    acc[status].push(curr);
    return acc;
  }, { 'Open': [], 'In Progress': [], 'On Hold': [], 'Blocked': [], 'Done': [], 'Dropped': [] } as Record<string, any[]>);
  
  // A folded group opens by itself while it holds a proposed change: every
  // proposal must be visible where it applies (AGENTS.md, review principle).
  const hasProposal = (rows: any[]) => rows.some((t: any) =>
    t.isAcrProposedAdd || t.isAcrProposedUpdate || t.isAcrProposedDelete || (t.acrCommentChanges || []).length > 0);
  const isFolded = (status: string) =>
    !!folded[status] && !hasProposal(groupedTasks[status] || []) && !(searching && (groupedTasks[status] || []).length > 0);

  // Grouped by owner: open work only, the person with the most late items
  // first, unassigned last.
  const isOpenTask = (t: any) => !['Done', 'Dropped'].includes(t.status);
  const isLate = (t: any) => isOpenTask(t) && dueState(t.estimatedResolutionDate) === 'overdue';
  // Plain calculation: the filtered list is rebuilt on every render anyway.
  const ownerGroups = (() => {
    const groups = new Map<string, { key: string; name: string; rows: any[] }>();
    filteredTasks.filter(isOpenTask).forEach((t: any) => {
      const k = ownerKey(t.owner) || UNASSIGNED;
      if (!groups.has(k)) groups.set(k, { key: k, name: k === UNASSIGNED ? 'Unassigned' : (t.owner || '').trim(), rows: [] });
      groups.get(k)!.rows.push(t);
    });
    return Array.from(groups.values()).sort((a, b) =>
      (a.key === UNASSIGNED ? 1 : 0) - (b.key === UNASSIGNED ? 1 : 0)
      || b.rows.filter(isLate).length - a.rows.filter(isLate).length
      || b.rows.length - a.rows.length
      || a.name.localeCompare(b.name));
  })();

  // Counts for the header: what is open, and what of it needs you.
  const openTasks = projectTasks.filter((t: any) => !t.isAcrProposedAdd && isOpenTask(t));
  const lateCount = openTasks.filter(isLate).length;
  const blockedCount = openTasks.filter((t: any) => t.status === 'Blocked').length;
  const soonCount = openTasks.filter((t: any) => ['today', 'soon'].includes(dueState(t.estimatedResolutionDate))).length;

  // New Item makes a blank task at once; closed untouched, it is removed again.
  const markNewTask = useDiscardUntouchedNew(
    activeItemId,
    (id) => useTasksStore.getState().tasks.find(x => x.id === id),
    isUntouchedNewTask,
    (id) => useTasksStore.getState().deleteTask(id),
  );

  const currentTimeline = (projectTimelines || []).find(p => p?.projectId === activeProjectId);
  const activeRevision = currentTimeline?.revisions?.find(r => r?.id === currentTimeline?.activeRevisionId) || currentTimeline?.revisions?.[0];
  const timelineActivities = (activeRevision?.activities || []).filter(Boolean);

  const handleAddNew = () => {
    if (!activeProjectId) return;
    addTask({
      projectId: activeProjectId,
      description: '',
      status: 'Open',
      type: 'Action Item',
      comments: [],
      linkedActivityIds: []
    });
    const newest = useTasksStore.getState().tasks.slice(-1)[0];
    markNewTask(newest.id);
    setActiveItemId(newest.id);
    setIsEditing(true);
  };

  const handleUpdate = (id: string, updates: Partial<Task>) => {
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
      updateTask(id, updates);
    }
  };

  /**
   * One row, drawn the same way in both views.
   *
   * It lived inline in the status-group loop until the archive needed the same
   * row in a flat list. Two copies of this markup would have drifted, and the
   * ACR borders on it are exactly the thing that must not differ between two
   * screens showing the same record.
   */
  const renderTaskRow = (item: Task) => (
                        <div 
                          key={item.id}
                          id={`task-card-${item.id}`}
                          draggable={!archived && groupBy === 'status' && !(item as any).isAcrProposedAdd}
                          onDragStart={(e) => {
                            // Dragging a row is how status is changed. An
                            // archived record is read-only, so it does not drag.
                            if (archived || (item as any).isAcrProposedAdd) {
                              e.preventDefault();
                              return;
                            }
                            e.dataTransfer.setData('taskId', item.id);
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
                          className={`cursor-pointer group flex flex-col gap-2 @min-[1040px]/list:flex-row @min-[1040px]/list:items-center @min-[1040px]/list:gap-0 justify-between py-4 border-b border-qb-light-grey transition-all duration-300 hover:bg-black/5 px-4 ${
                            realActiveItem?.id === item.id ? 'bg-qb-box-bg' : ''
                          } ${
                            item.isFlagged ? 'bg-amber-500/10 border-l-4 border-amber-500 hover:bg-amber-500/15' : ''
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
                          {/* Narrow list: the title takes the first line whole, the
                              labels wrap onto the next ones. Wide: one line. */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 w-full min-w-0 @min-[1040px]/list:flex-nowrap @min-[1040px]/list:flex-1 @min-[1040px]/list:w-auto @min-[1040px]/list:mr-4">
                            {!archived && !(item as any).isAcrProposedAdd && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFlag(item.id);
                                }}
                                className={`p-1 transition-colors shrink-0 ${
                                  item.isFlagged
                                    ? 'text-amber-500 hover:text-amber-600'
                                    : 'text-qb-light-grey hover:text-amber-500 opacity-0 group-hover:opacity-100'
                                }`}
                                title={item.isFlagged ? 'Remove flag' : 'Flag task/issue'}
                              >
                                <Flag className={`w-4 h-4 ${item.isFlagged ? 'fill-amber-500' : ''}`} />
                              </button>
                            )}
                            {(() => {
                              // The row already carries the proposed owner: the
                              // shared enrichment merged it. No special case.
                              const effectiveOwner = item.owner;

                              if (effectiveOwner && effectiveOwner.trim()) {
                                return (
                                  <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border border-qb-dark-grey/40 bg-qb-box-bg text-qb-black shrink-0">
                                    <Highlight text={effectiveOwner} needles={needles} />
                                  </span>
                                );
                              }
                              return (
                                <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border border-dashed border-qb-light-grey text-qb-grey/60 shrink-0">
                                  UNASSIGNED
                                </span>
                              );
                            })()}
                            <h3 className={`text-lg tracking-wide truncate max-w-full @max-[1040px]/list:order-first @max-[1040px]/list:basis-full @min-[1040px]/list:min-w-[8rem] ${realActiveItem?.id === item.id ? 'font-black text-qb-black' : 'font-medium text-qb-dark-grey'} ${(item as any).isAcrProposedDelete ? 'line-through text-qb-grey' : ''}`}>
                              <Highlight text={item.description || 'Empty Description'} needles={needles} />
                            </h3>
                            {(() => {
                              // A match the row does not show: say where it is.
                              const hit = searchHits.get(item.id);
                              const hidden = hit?.fields.find(f => HIDDEN_FIELD_LABEL[f]);
                              if (!hit || !hidden || hit.fields.includes('description')) return null;
                              const doc = taskDoc(item);
                              return (
                                <span className="text-[10px] text-qb-dark-grey truncate min-w-0 shrink" title={doc.text[hidden]}>
                                  <span className="font-black uppercase tracking-widest text-qb-orange mr-1">in {HIDDEN_FIELD_LABEL[hidden]}:</span>
                                  <Highlight text={snippetAround(doc.text[hidden], needles, 36)} needles={needles} />
                                </span>
                              );
                            })()}
                            {(() => {
                              const linkedId = item.linkedActivityIds?.[0];
                              if (!linkedId) return null;
                              const linkedAct = timelineActivities.find(a => a?.id === linkedId);
                              if (!linkedAct) return null;
                              const displayTitle = linkedAct.activity && linkedAct.subActivity 
                                ? `${linkedAct.activity} - ${linkedAct.subActivity}`
                                : (linkedAct.activity || linkedAct.subActivity);
                              return (
                                <span 
                                  className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 bg-black/5 border border-qb-light-grey text-qb-dark-grey max-w-[220px] truncate min-w-0 shrink"
                                  title={displayTitle}
                                >
                                  {displayTitle}
                                </span>
                              );
                            })()}
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
                          
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 @min-[1040px]/list:flex-nowrap @min-[1040px]/list:shrink-0 @min-[1300px]/list:gap-6">
                            {item.estimatedResolutionDate && (() => {
                              // Late and due-this-week dates stand out; the rest stay quiet.
                              const due = dueState(item.estimatedResolutionDate, archived || ['Done', 'Dropped'].includes(item.status));
                              const tag = dueTag(item.estimatedResolutionDate, due);
                              return (
                                <DateVisualizer date={item.estimatedResolutionDate}>
                                  <span className={`text-[10px] font-bold font-mono ${dueDateClass(due)} hover:text-qb-black transition-colors uppercase tracking-wider cursor-default whitespace-nowrap`}>
                                    {formatDateDisplay(item.estimatedResolutionDate)}
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
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border ${item.type === 'Issue' ? 'border-qb-magenta bg-qb-magenta/20 text-qb-magenta' : 'border-qb-grey bg-qb-box-bg text-qb-grey'}`}>
                              {item.type}
                            </span>
                            <div className="flex items-center gap-1.5 text-qb-grey">
                              <MessageSquare className="w-4 h-4" />
                              <span className="text-xs font-bold font-mono">
                                {(tasks.find(d => d.id === item.id)?.comments || []).length}
                                {((item as any).acrCommentChanges || []).length > 0 && (
                                  <span className="text-qb-cyan"> +{(item as any).acrCommentChanges.length}</span>
                                )}
                              </span>
                            </div>
                            {!(item as any).isAcrProposedAdd && !(item as any).isAcrProposedUpdate && !(item as any).isAcrProposedDelete && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(item.id); }}
                                className="text-qb-light-grey hover:text-qb-magenta transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            {item.status !== 'Dropped' && (
                              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${['Done'].includes(item.status) ? 'border-qb-green text-qb-green' : 'border-qb-light-grey text-transparent'}`}>
                                <Check className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                        </div>
  );

  return (
    <div className="h-full flex bg-qb-bg font-sans">
      {/* List View */}
      {/* @container/list: rows lay out for the width the list actually has.
          With the review panel open on the left and the detail tray on the
          right, that can be a third of the screen; a row laid out for the
          screen then had its labels run over each other (22 Oct 2026). */}
      <div className={`@container/list flex-1 flex flex-col pt-4 sm:pt-8 px-4 sm:pl-12 sm:pr-6 overflow-y-auto ${realActiveItem ? 'lg:mr-[var(--tray-w,600px)]' : ''} transition-all duration-300`}>
        <PageHeader
          title="Tasks & Issues"
          stats={archived ? <span>{projectTasks.length} in the archive</span> : <>
            <Stat n={openTasks.length} label="open" />
            <Stat n={lateCount} label="late" tone="magenta" />
            <Stat n={blockedCount} label="blocked" tone="magenta" />
            <Stat n={soonCount} label="due this week" tone="orange" />
          </>}
        >
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={archived ? 'Search the archive…' : 'Search tasks & issues…'}
            resultLabel={searching ? `${foundCount} found` : undefined}
          />
          {/* The archive is read, not worked: no filters, no sort, no New Item. */}
          {!archived && (<>
            <select
              value={filterOwner}
              onChange={e => setFilterOwner(e.target.value)}
              title="Show one person's items. Pick your own name for your list — it is remembered in this browser."
              className={`border-none px-3 py-1.5 text-xs font-bold outline-none focus:ring-1 focus:ring-qb-orange uppercase ${filterOwner !== 'All' ? 'bg-qb-black text-white' : 'bg-qb-box-bg text-qb-black'}`}
            >
              <option value="All">Everyone</option>
              {ownerNames.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
              <option value={UNASSIGNED}>Unassigned</option>
            </select>
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
            <select 
              value={filterFlagged} 
              onChange={e => setFilterFlagged(e.target.value)}
              className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
            >
              <option value="All">All Items</option>
              <option value="Flagged">Flagged Only</option>
              <option value="Unflagged">Unflagged Only</option>
            </select>
            <div className="flex items-center border border-qb-light-grey" role="group" aria-label="Group by">
              {(['status', 'owner'] as const).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  aria-pressed={groupBy === g}
                  className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${groupBy === g ? 'bg-qb-black text-white' : 'text-qb-grey hover:text-qb-black'}`}
                >
                  By {g}
                </button>
              ))}
            </div>
            <select 
              value={sortBy} 
              onChange={e => setSortBy(e.target.value as any)}
              title="Sort"
              className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
            >
              <option value="Date">Sort: Target Date</option>
              <option value="Priority">Sort: Priority</option>
            </select>
            <button onClick={handleAddNew} className={headerButtonClass(true)}>
              <Plus className="w-4 h-4" /> New Item
            </button>
          </>)}
        </PageHeader>

        <ArchiveTabs basePath="/tasks-issues" archivedCount={archivedCount} />

        {searching && archivedMatches > 0 && (
          <button
            type="button"
            onClick={() => navigate(`/tasks-issues/archive?q=${encodeURIComponent(query)}`)}
            className="self-start -mt-2 mb-4 text-[10px] font-black uppercase tracking-widest text-qb-grey hover:text-qb-orange"
          >
            {archivedMatches} more in the archive →
          </button>
        )}
        {searching && foundCount === 0 && (
          <div className="text-center py-12 text-qb-grey font-medium tracking-widest uppercase text-sm">
            Nothing matches “{query}”{(filterOwner !== 'All' || filterPriority !== 'All' || filterFlagged !== 'All') && !archived ? ' with the filters set' : ''}.
            <button type="button" onClick={() => setQuery('')} className="ml-3 text-qb-orange font-black">Clear search</button>
          </div>
        )}

        <div className="flex-1 pb-12">
          <div className="flex flex-col gap-8">
            {projectTasks.length === 0 ? (
              <div className="text-center py-20 text-qb-grey font-medium tracking-widest uppercase">
                {archived
                  ? 'Nothing in the archive. Archive an item from its detail panel.'
                  : "No items yet. Click 'New Item' to start."}
              </div>
            ) : archived ? (
              /* One flat list, newest archive first. No status headings, because
                 status is not how you look for something you have put away. */
              <div className="pl-2">
                <div className="flex flex-col">
                  {archiveRows.map(renderTaskRow)}
                </div>
              </div>
            ) : groupBy === 'owner' ? (
              <>
                {ownerGroups.length === 0 && (
                  <div className="text-center py-12 text-qb-grey font-medium tracking-widest uppercase text-sm">No open items match these filters.</div>
                )}
                {ownerGroups.map(g => {
                  const late = g.rows.filter(isLate).length;
                  const foldKey = `owner:${g.key}`;
                  const isGroupFolded = !!folded[foldKey] && !hasProposal(g.rows);
                  return (
                    <div key={g.key} className="relative p-2">
                      <button
                        type="button"
                        onClick={() => setFolded(prev => ({ ...prev, [foldKey]: !prev[foldKey] }))}
                        className="flex items-center gap-3 mb-2 group/fold"
                      >
                        <ChevronRight className={`w-5 h-5 transition-transform text-qb-orange ${isGroupFolded ? '' : 'rotate-90'}`} />
                        <h2 className="text-xl font-black text-qb-dark-grey uppercase tracking-[0.15em] group-hover/fold:text-qb-black transition-colors">
                          {g.name} <span className="opacity-50 ml-2">[{g.rows.length}]</span>
                          {late > 0 && <span className="ml-3 text-sm text-qb-magenta tracking-widest">{late} LATE</span>}
                        </h2>
                      </button>
                      {!isGroupFolded && (
                        <div className="pl-8 relative">
                          <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-qb-light-grey"></div>
                          <div className="flex flex-col">{g.rows.map(renderTaskRow)}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey pl-2">Done and dropped items are left out of this view.</p>
              </>
            ) : (
              STATUS_OPTIONS.filter(status => !searching || (groupedTasks[status] || []).length > 0).map(status => (
                <div 
                  key={status} 
                  className={`relative transition-colors rounded-lg p-2 border-2 border-transparent ${(groupedTasks[status] || []).length > 0 && !isFolded(status) ? 'min-h-[100px]' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const taskId = e.dataTransfer.getData('taskId');
                    if (taskId) {
                      updateTask(taskId, { status: status as TaskStatus });
                    }
                  }}
                >
                  {/* The heading folds the group and says how many are in it,
                      so a closed group still tells you what it holds. */}
                  <button
                    type="button"
                    onClick={() => setFolded(prev => ({ ...prev, [status]: !prev[status] }))}
                    className="flex items-center gap-3 mb-2 group/fold"
                    title={isFolded(status) ? 'Show' : 'Hide'}
                  >
                    <ChevronRight className={`w-5 h-5 transition-transform ${isFolded(status) ? '' : 'rotate-90'}`} style={{ color: STATUS_COLORS[status] }} />
                    <h2 className="text-xl font-black text-qb-dark-grey uppercase tracking-[0.15em] group-hover/fold:text-qb-black transition-colors">
                      {status} <span className="opacity-50 ml-2">[{(groupedTasks[status] || []).length}]</span>
                    </h2>
                  </button>
                  {!isFolded(status) && (
                    <div className="pl-8 relative">
                      <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-qb-light-grey"></div>
                      <div className="flex flex-col">
                        {(groupedTasks[status] || []).map(renderTaskRow)}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Details / Edit Panel */}
      <TaskTray 
        activeItemId={activeItemId} 
        activeItem={realActiveItem}
        onClose={() => setActiveItemId(null)} 
        onDeleteRequested={(id) => setShowDeleteConfirm(id)} 
      />

      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title="Delete Item"
          description="Are you sure you want to delete this item?"
          subDescription="THIS ACTION CANNOT BE UNDONE."
          confirmText="YES, DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            deleteTask(showDeleteConfirm);
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
