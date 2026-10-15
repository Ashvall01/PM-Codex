import React from 'react';
import { useTasksStore, Task, TaskStatus, TaskType, Priority } from '../../../store/tasksStore';
import { useTimelineStore } from '../../../store/timelineStore';
import { useAcrStore } from '../../../store/acrStore';
import { EditableField } from '../../../components/EditableField';
import { AcrStatusLine, AcrDiffList } from '../../../components/AcrDiffList';
import { ProposedCommentCard } from '../../../components/ProposedCommentCard';
import { acrFieldProps, acrUnshownDiffs } from '../../../utils/acrDiff';
import { X, Edit2, MessageSquare, Trash2, Flag } from 'lucide-react';
import { ArchiveButton } from '../../../components/ArchiveButton';
import { format } from 'date-fns';
import { TASK_STATUS_COLORS, tint, priorityChipClass } from '../../../utils/statusStyle';

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
const STATUS_OPTIONS: TaskStatus[] = ['Open', 'In Progress', 'On Hold', 'Blocked', 'Done', 'Dropped'];
const TYPE_OPTIONS: TaskType[] = ['Action Item', 'Issue'];

interface TaskTrayProps {
  activeItemId: string | null;
  /**
   * The already-resolved item, when the caller has one.
   *
   * A task a change request has only PROPOSED is not in the task store yet. It
   * exists solely in the caller's enriched list, under an invented id such as
   * "acr-add-xyz". Looking that id up in the store finds nothing, so the tray
   * stayed shut and a proposed task could never be previewed.
   *
   * Callers that build an enriched list pass the item straight through. Callers
   * that do not — the Minutes screen — pass nothing and keep the old lookup.
   */
  activeItem?: any | null;
  onClose: () => void;
  onDeleteRequested?: (id: string) => void;
}

export const TaskTray: React.FC<TaskTrayProps> = ({ activeItemId, activeItem, onClose, onDeleteRequested }) => {
  const { tasks, updateTask, toggleFlag, archiveTask, unarchiveTask, addComment, deleteComment } = useTasksStore();
  const projectTimelines = useTimelineStore(state => state.projectTimelines);

  const realActiveItem = activeItem !== undefined
    ? activeItem
    : (activeItemId ? tasks.find(t => t.id === activeItemId) || null : null);

  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === useAcrStore.getState().activeAcrId));

  /**
   * Archived records are read-only. To change one, restore it first.
   *
   * Read from the STORED value, not from the row. An enriched row carries the
   * PROPOSED value, so a pending unarchiveTask would otherwise unlock the
   * fields of a record that is still archived and still hidden from the user's
   * active list. `acrOriginal` is the record before any proposal; on the plain
   * lookup path (the Minutes screen) there is none, so the record itself is it.
   */
  const storedIsArchived = !!(
    ((realActiveItem as any)?.acrOriginal ?? realActiveItem) as any
  )?.isArchived;
  const readOnly = storedIsArchived;

  const timelineActivities = React.useMemo(() => {
    if (!realActiveItem?.projectId) return [];
    const timeline = (projectTimelines || []).find(tl => tl?.projectId === realActiveItem.projectId);
    if (!timeline) return [];
    const activeRev = timeline.revisions?.find(r => r.id === timeline.activeRevisionId) || timeline.revisions?.[0];
    return (activeRev?.activities || []).filter(Boolean);
  }, [projectTimelines, realActiveItem?.projectId]);

  const handleUpdate = (id: string, updates: Partial<Task>) => {
    if (!realActiveItem) return;

    if (((realActiveItem as any).isAcrProposedAdd || (realActiveItem as any).isAcrProposedUpdate) && acr) {
      const changeId = (realActiveItem as any).acrChangeId;
      if (changeId && acr.id) {
        const foundChange = acr.changes.find(c => c.id === changeId);
        if (foundChange) {
          const newArgs = { ...foundChange.args, ...updates };
          useAcrStore.getState().updateAcrChange(acr.id, changeId, { args: newArgs });
        }
      }
    } else {
      updateTask(id, updates);
    }
  };

  /**
   * Every field below draws itself from the shared diff, so a field cannot be
   * left out of the comparison by forgetting to add a line here.
   */
  const f = (key: string, fallback = '') => acrFieldProps(realActiveItem, key, fallback);

  /** Same, for a field the tray shows as a date only. */
  const fDate = (key: string) => {
    const props = acrFieldProps(realActiveItem, key);
    const trim = (v?: string) => (v || '').split('T')[0];
    return {
      value: trim(props.value),
      isProposalDiff: props.isProposalDiff,
      proposedValue: props.isProposalDiff ? trim(props.proposedValue) : undefined,
    };
  };

  /** Same, for a list field the tray shows as its first entry. */
  const fFirst = (key: string) => {
    const diff = ((realActiveItem as any)?.acrDiffs || []).find((d: any) => d.key === key);
    const first = (v: any) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
    if (diff && (realActiveItem as any)?.isAcrProposedUpdate) {
      return {
        value: String(first(diff.oldValue)),
        isProposalDiff: true,
        proposedValue: String(first(diff.newValue)),
      };
    }
    return { value: String(first((realActiveItem as any)?.[key])), isProposalDiff: false };
  };

  /** The fields this tray draws itself. Anything else the proposal carries is
   *  listed at the bottom, so nothing can be hidden. */
  const SHOWN_FIELDS = [
    'description', 'status', 'type', 'priority', 'owner',
    'linkedActivityIds', 'estimatedResolutionDate', 'source', 'remarks',
    'isArchived',
  ];
  const otherDiffs = acrUnshownDiffs(realActiveItem, SHOWN_FIELDS);
  const proposedComments = (realActiveItem as any)?.acrCommentChanges || [];

  return (
    <div
      className={`fixed top-0 right-0 h-full w-full lg:w-[600px] bg-qb-bg lg:border-l-4 border-l-0 border-qb-black transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col z-50 shadow-2xl lg:shadow-none ${realActiveItem ? 'translate-x-0' : 'translate-x-full'}`}
    >
      {realActiveItem && (
        <>
          <header className="flex justify-between items-center px-6 lg:px-12 py-6 lg:py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
            <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black tracking-widest text-qb-grey uppercase">
                {realActiveItem.type}
              </span>
              <h2 className="text-xl lg:text-2xl font-black uppercase tracking-widest text-qb-black">Item Details</h2>
            </div>
            <div className="flex items-center gap-4">
              {!readOnly && !(realActiveItem as any).isAcrProposedAdd && !(realActiveItem as any).isAcrProposedDelete && !(realActiveItem as any).isAcrProposedUpdate && (
                <button
                  type="button"
                  onClick={() => toggleFlag(realActiveItem.id)}
                  className={`p-3 border-2 transition-colors cursor-pointer flex items-center justify-center ${
                    realActiveItem.isFlagged
                      ? 'border-amber-500 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
                      : 'border-qb-light-grey text-qb-grey hover:border-amber-500 hover:text-amber-500 bg-transparent'
                  }`}
                  title={realActiveItem.isFlagged ? 'Flagged (click to unflag)' : 'Click to flag'}
                >
                  <Flag className={`w-4 h-4 ${realActiveItem.isFlagged ? 'fill-amber-500' : ''}`} />
                </button>
              )}
              {!readOnly && !(realActiveItem as any).isAcrProposedAdd && !(realActiveItem as any).isAcrProposedDelete && !(realActiveItem as any).isAcrProposedUpdate && (
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
              {/* Archive sits before delete: the gentler of the two first, and
                  the pair reads left to right from least to most final. No
                  confirmation on either action — both can be undone. */}
              {!(realActiveItem as any).isAcrProposedAdd && !(realActiveItem as any).isAcrProposedUpdate && !(realActiveItem as any).isAcrProposedDelete && (
                <ArchiveButton
                  isArchived={storedIsArchived}
                  onArchive={() => { archiveTask(realActiveItem.id); onClose(); }}
                  onRestore={() => { unarchiveTask(realActiveItem.id); onClose(); }}
                />
              )}
              {!(realActiveItem as any).isAcrProposedAdd && !(realActiveItem as any).isAcrProposedUpdate && !(realActiveItem as any).isAcrProposedDelete && onDeleteRequested && (
                <button 
                  onClick={() => onDeleteRequested(realActiveItem.id)}
                  className="p-3 bg-transparent text-qb-grey hover:text-qb-magenta border-2 border-qb-light-grey hover:border-qb-magenta transition-colors cursor-pointer"
                  title="Delete Item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button 
                onClick={onClose}
                className="p-3 bg-transparent text-qb-grey hover:text-qb-black border-2 border-qb-light-grey hover:border-qb-black transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>
          
          <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-6 lg:py-8 flex flex-col gap-10 bg-transparent no-scrollbar relative">
            {/* One banner, the same in every module: what kind of change this
                is, its title, and every field it moves. */}
            {/* A removal is the one change no field on this screen can
                show, because it changes no field. Everything else is
                visible on the fields themselves. */}
            {(realActiveItem as any).isAcrProposedDelete && (
              <AcrStatusLine
                actionName={(realActiveItem as any).acrChange.name}
                declined={(realActiveItem as any).acrApproved === false}
              />
            )}

            {/* Description */}
            <div className="flex flex-col gap-2 pt-4">
              <EditableField
                disabled={readOnly}
                label="Description"
                type="textarea"
                rows={3}
                {...f('description')}
                onSave={(newVal) => handleUpdate(realActiveItem.id, { description: newVal })}
                textClassName="text-xl lg:text-2xl font-bold tracking-wide text-qb-black leading-snug py-1"
              />
            </div>

            {/* Form Fields via EditableField */}
            <div className="flex flex-col gap-10 bg-transparent">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                <EditableField
                  disabled={readOnly}
                  label="Status"
                  type="select"
                  options={STATUS_OPTIONS}
                  {...f('status')}
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { status: newVal as TaskStatus })}
                  displayFormatter={(val) => (
                    <span className="text-[11px] font-black uppercase tracking-widest px-2.5 py-1 inline-block" style={{ backgroundColor: tint(STATUS_COLORS[val] || 'var(--color-qb-grey)'), color: STATUS_COLORS[val] || 'var(--color-qb-grey)' }}>
                      {val}
                    </span>
                  )}
                />
                <EditableField
                  disabled={readOnly}
                  label="Type"
                  type="select"
                  options={TYPE_OPTIONS}
                  {...f('type')}
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { type: newVal as TaskType })}
                  textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                <EditableField
                  disabled={readOnly}
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
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { priority: (newVal || undefined) as Priority })}
                  displayFormatter={(val) => val ? (
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border ${priorityChipClass(val)}`}>
                      {val}
                    </span>
                  ) : <span className="text-qb-grey text-xs uppercase font-bold tracking-wider">--</span>}
                />
                <EditableField
                  disabled={readOnly}
                  label="Owner"
                  {...f('owner')}
                  placeholder="-- UNASSIGNED --"
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { owner: newVal })}
                  textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                <EditableField
                  disabled={readOnly}
                  label="Linked Activity"
                  type="select"
                  searchable={true}
                  searchPlaceholder="Search by activity, sub-activity or phase..."
                  options={[
                    { label: '-- NONE --', value: '' },
                    ...timelineActivities.map(act => ({
                      label: act?.activity || act?.subActivity || 'Untitled Activity',
                      value: act?.id || '',
                      secondary: act?.subActivity || undefined,
                      phase: act?.phase || undefined
                    }))
                  ]}
                  {...fFirst('linkedActivityIds')}
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { linkedActivityIds: newVal ? [newVal] : [] })}
                  displayFormatter={(val) => {
                    const act = timelineActivities.find(a => a?.id === val);
                    if (!act) return '--';
                    if (act.activity && act.subActivity) {
                      return `${act.activity} - ${act.subActivity}`;
                    }
                    return act.activity || act.subActivity || '--';
                  }}
                  textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                />
                <EditableField
                  disabled={readOnly}
                  label="Est. Resolution"
                  type="date"
                  {...fDate('estimatedResolutionDate')}
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { estimatedResolutionDate: newVal })}
                  displayFormatter={(val) => formatDateDisplay(val)}
                  textClassName="text-sm font-bold text-qb-black font-mono uppercase tracking-wide py-1"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                <EditableField
                  disabled={readOnly}
                  label="Source"
                  {...f('source')}
                  placeholder="-- NONE --"
                  onSave={(newVal) => handleUpdate(realActiveItem.id, { source: newVal })}
                  textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                />
                {/* Archived is never typed into — the header button moves it.
                    It is drawn here anyway so a proposal to archive or restore
                    shows its before and after on the field itself, like every
                    other change. Hidden in the active view unless a proposal
                    touches it, so it costs nothing on an ordinary task. */}
                {(storedIsArchived || f('isArchived').isProposalDiff) && (
                  <EditableField
                    disabled
                    label="Archived"
                    {...f('isArchived', 'false')}
                    onSave={() => {}}
                    displayFormatter={(val) => (
                      <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 inline-block ${val === 'true' ? 'bg-qb-cyan/20 text-qb-cyan' : 'bg-qb-box-bg text-qb-grey'}`}>
                        {val === 'true' ? 'Yes' : 'No'}
                      </span>
                    )}
                    textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                  />
                )}
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
                  textClassName="text-sm font-semibold text-qb-black leading-relaxed whitespace-pre-wrap py-1"
                />
              </div>

              {/* The safety net. A proposal can carry a field this tray does not
                  draw — a new tool argument, or one the store gained later. It
                  is listed here rather than applied unseen. */}
              {otherDiffs.length > 0 && (
                <AcrDiffList
                  diffs={otherDiffs}
                  title={`Also proposed — ${otherDiffs.length} more field${otherDiffs.length === 1 ? '' : 's'}`}
                  hideOldValues={(realActiveItem as any).isAcrProposedAdd}
                />
              )}
            </div>
          
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
                    {!readOnly && (
                      <button 
                        onClick={() => deleteComment(realActiveItem.id, comment.id)}
                        className="absolute top-2 right-2 text-qb-light-grey hover:text-qb-magenta opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                {/* A proposed comment used to be invisible in every module. It
                    had a title in the review panel and nothing else, so the
                    text being signed off could not be read where it belongs. */}
                {proposedComments.map((change: any) => (
                  <ProposedCommentCard key={change.id} change={change} comments={realActiveItem?.comments || []} />
                ))}
                {(realActiveItem?.comments || []).length === 0 && proposedComments.length === 0 && (
                  <div className="text-xs text-qb-grey font-bold uppercase tracking-widest">NO COMMENTS YET.</div>
                )}
              </div>
              {readOnly ? (
                <div className="text-[10px] font-black uppercase tracking-widest text-qb-grey border border-dashed border-qb-light-grey px-3 py-2.5 text-center">
                  Archived — restore this item to comment on it
                </div>
              ) : (
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
              )}
            </div>
          
          </div>
        </>
      )}
    </div>
  );
};
