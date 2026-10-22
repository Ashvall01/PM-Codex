import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMomStore, MoM, normalizeMoMActionItemStatus, MoMActionItemStatus } from '../../store/momStore';
import { useTasksStore, TaskStatus } from '../../store/tasksStore';
import { useAppStore } from '../../store/appStore';
import { useAcrStore } from '../../store/acrStore';
import { useTimelineStore, TimelineActivity } from '../../store/timelineStore';
import { computeAcrDiffs } from '../../utils/acrDiff';
import { pushActionItemsToTracker, isActionItemPushable, isActionItemUnpushed } from '../../services/momActionPush';
import { AcrDiffList } from '../../components/AcrDiffList';
import { useAiStore } from '../../store/aiStore';
import { Plus, Trash2, Edit2, FileText, X, Check, Search, Calendar, MapPin, Users, Clock, Share2, Send, FileUp, Copy, AlertTriangle, Sparkles, CheckCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { RichTextEditor } from '../../components/RichTextEditor';
import { RichTextViewer } from '../../components/RichTextViewer';
import { format } from 'date-fns';
import { TaskTray } from '../Tasks/components/TaskTray';

const MOM_ACTION_STATUS_OPTIONS: MoMActionItemStatus[] = ['Open', 'In Progress', 'On Hold', 'Blocked', 'Done', 'Dropped'];

/**
 * Action items as a proposal holds them, each with an id.
 *
 * An assistant often sends action items with no id (or as plain strings). The
 * screen then had to invent an id to draw them, but the edit handlers looked
 * for that invented id inside the proposal, found nothing, and dropped every
 * keystroke. Both the screen and the handlers use this one function, so they
 * always agree on the id, and the first edit writes the ids into the proposal.
 * The item is spread whole, so priority, due date, remarks and links survive.
 */
const proposalActionItems = (items: any[] | undefined, idPrefix: string) =>
  (Array.isArray(items) ? items : []).map((ai: any, i: number) => {
    const obj = typeof ai === 'string' ? { description: ai } : { ...(ai || {}) };
    return {
      ...obj,
      id: obj.id || `${idPrefix}-${i}`,
      description: obj.description || obj.task || obj.action || '',
      assignee: obj.assignee || obj.owner || obj.assignedTo || 'PM',
      status: normalizeMoMActionItemStatus(obj.status),
      taskId: obj.taskId || undefined,
    };
  });

/**
 * ACTION ITEM DETAILS — the fields the one-line row does not show.
 *
 * An action item can carry a type, priority, due date, remarks and a linked
 * timeline activity (an assistant often fills them in). They become the task's
 * fields when the item is pushed. Until 23 Sep 2026 the MoM screen never showed
 * them, so a proposal could be approved with values nobody saw. They now sit
 * under each item, collapsed by default; the toggle shows how many are filled.
 * For a pushed item they are read from, and saved to, the linked task.
 */
const ACTION_TYPE_OPTIONS = ['Action Item', 'Issue'];
const ACTION_PRIORITY_OPTIONS = ['Low', 'Medium', 'High'];

type ActionItemDetailValues = {
  type: string;
  priority: string;
  estimatedResolutionDate: string;
  remarks: string;
  linkedActivityIds: string[];
};

const actionItemDetailValues = (item: any, linkedTask: any): ActionItemDetailValues => {
  const src = linkedTask || item || {};
  return {
    type: src.type || '',
    priority: src.priority || '',
    estimatedResolutionDate: src.estimatedResolutionDate || '',
    remarks: src.remarks || '',
    linkedActivityIds: Array.isArray(src.linkedActivityIds) ? src.linkedActivityIds.filter(Boolean) : [],
  };
};

const filledDetailCount = (d: ActionItemDetailValues) =>
  (d.type ? 1 : 0) + (d.priority ? 1 : 0) + (d.estimatedResolutionDate ? 1 : 0)
  + (d.remarks.trim() ? 1 : 0) + (d.linkedActivityIds.length ? 1 : 0);

const activityLabel = (activities: TimelineActivity[], id: string) => {
  const a = activities.find(x => x?.id === id);
  if (!a) return 'Unknown activity';
  if (a.activity && a.subActivity) return `${a.activity} - ${a.subActivity}`;
  return a.activity || a.subActivity || 'Untitled activity';
};

const DetailsToggle: React.FC<{ open: boolean; count: number; onToggle: () => void }> = ({ open, count, onToggle }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onToggle(); }}
    title={open ? 'Hide details' : 'Show details'}
    className={`flex items-center gap-1 p-1 text-[10px] font-black uppercase tracking-widest transition-colors shrink-0 ${open ? 'text-qb-orange' : 'text-qb-grey hover:text-qb-orange'}`}
  >
    {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
    DETAILS{count > 0 ? ` · ${count}` : ''}
  </button>
);

const ActionItemDetails: React.FC<{
  values: ActionItemDetailValues;
  activities: TimelineActivity[];
  editable: boolean;
  onChange?: (updates: Partial<ActionItemDetailValues>) => void;
}> = ({ values, activities, editable, onChange }) => {
  const labelCls = 'block text-[9px] font-black uppercase tracking-widest text-qb-grey mb-1';
  const valueCls = 'text-xs font-bold text-qb-black uppercase tracking-wide';
  const inputCls = 'w-full bg-qb-box-bg border-none p-2 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange';

  if (!editable) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <span className={labelCls}>Type</span>
          <span className={valueCls}>{values.type || 'Action Item'}</span>
        </div>
        <div>
          <span className={labelCls}>Priority</span>
          <span className={valueCls}>{values.priority || '--'}</span>
        </div>
        <div>
          <span className={labelCls}>Due date</span>
          <span className={`${valueCls} font-mono`}>{values.estimatedResolutionDate ? formatDateDisplay(values.estimatedResolutionDate) : '--'}</span>
        </div>
        <div>
          <span className={labelCls}>Linked activity</span>
          <span className={valueCls}>
            {values.linkedActivityIds.length
              ? values.linkedActivityIds.map(id => activityLabel(activities, id)).join(', ')
              : '--'}
          </span>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <span className={labelCls}>Remarks</span>
          <span className="text-sm font-medium text-qb-dark-grey whitespace-pre-wrap">{values.remarks || '--'}</span>
        </div>
      </div>
    );
  }

  const set = (updates: Partial<ActionItemDetailValues>) => onChange && onChange(updates);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div>
        <label className={labelCls}>Type</label>
        <select value={values.type || 'Action Item'} onChange={(e) => set({ type: e.target.value })} className={`${inputCls} uppercase`}>
          {ACTION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Priority</label>
        <select value={values.priority} onChange={(e) => set({ priority: e.target.value })} className={`${inputCls} uppercase`}>
          <option value="">--</option>
          {ACTION_PRIORITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Due date</label>
        <input type="date" value={values.estimatedResolutionDate} onChange={(e) => set({ estimatedResolutionDate: e.target.value })} className={`${inputCls} font-mono`} />
      </div>
      <div>
        <label className={labelCls}>Linked activity</label>
        <select
          value={values.linkedActivityIds[0] || ''}
          onChange={(e) => set({ linkedActivityIds: e.target.value ? [e.target.value] : [] })}
          className={inputCls}
        >
          <option value="">-- NONE --</option>
          {values.linkedActivityIds[0] && !activities.some(a => a?.id === values.linkedActivityIds[0]) && (
            <option value={values.linkedActivityIds[0]}>Unknown activity</option>
          )}
          {activities.map(a => <option key={a.id} value={a.id}>{activityLabel(activities, a.id)}</option>)}
        </select>
      </div>
      <div className="col-span-2 sm:col-span-4">
        <label className={labelCls}>Remarks</label>
        <textarea
          value={values.remarks}
          onChange={(e) => set({ remarks: e.target.value })}
          rows={2}
          placeholder="Remarks"
          className={`${inputCls} font-medium resize-y`}
        />
      </div>
    </div>
  );
};

const MOM_ACTION_STATUS_COLORS: Record<string, string> = {
  'Open': 'var(--color-qb-orange)',
  'In Progress': 'var(--color-qb-cyan)',
  'Blocked': 'var(--color-qb-magenta)',
  'Done': 'var(--color-qb-green)',
  'Dropped': 'var(--color-qb-grey)',
  'Closed': 'var(--color-qb-green)',
  'On Hold': 'var(--color-qb-grey)',
};

/** True when rich text holds any words (not just empty tags). */
const hasText = (html?: string): boolean =>
  !!html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;

// Utilities to parse and format dates and times properly
const formatDateDisplay = (dateStr?: string): string => {
  if (!dateStr) return 'NO DATE';
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

const formatTimeDisplay = (timeStr?: string): string => {
  if (!timeStr) return 'NO TIME';
  try {
    // Check if it's an ISO/Date string
    if (timeStr.includes('T') || (isNaN(Number(timeStr)) && !timeStr.includes(':'))) {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        return format(d, 'hh:mm a').toUpperCase();
      }
    }
    // Standard HH:MM format
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (!isNaN(hours) && !isNaN(minutes)) {
        const dummy = new Date();
        dummy.setHours(hours, minutes, 0, 0);
        return format(dummy, 'hh:mm a').toUpperCase();
      }
    }
  } catch (e) {
    console.error('Time parsing error:', e);
  }
  return String(timeStr).toUpperCase();
};

const getInputDate = (dateStr?: string): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch (e) {
    console.error('Date input parsing error:', e);
  }
  return dateStr;
};

const getInputTime = (timeStr?: string): string => {
  if (!timeStr) return '';
  try {
    if (timeStr.includes('T') || (isNaN(Number(timeStr)) && !timeStr.includes(':'))) {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      }
    }
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
  } catch (e) {
    console.error('Time input parsing error:', e);
  }
  return timeStr;
};

export default function Mom() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // The action item a dashboard link points at; lit for a moment once found.
  const [flashActionId, setFlashActionId] = useState<string | null>(null);
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const { moms, activeMomId, addMom, importMom, importMoms, updateMom, deleteMom, setActiveMomId, addActionItem, updateActionItem, deleteActionItem } = useMomStore();
  const tasks = useTasksStore(state => state.tasks);
  const projectTimelines = useTimelineStore(state => state.projectTimelines);
  const timelineActivities = useMemo<TimelineActivity[]>(() => {
    const timeline = (projectTimelines || []).find(tl => tl?.projectId === activeProjectId);
    if (!timeline) return [];
    const rev = timeline.revisions?.find(r => r.id === timeline.activeRevisionId) || timeline.revisions?.[0];
    return (rev?.activities || []).filter(Boolean);
  }, [projectTimelines, activeProjectId]);
  // Which action items have their details open. Closed by default.
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const toggleDetails = (id: string) => setOpenDetails(prev => ({ ...prev, [id]: !prev[id] }));
  const updateTask = useTasksStore(state => state.updateTask);
  
  const [isEditing, setIsEditing] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [templateCopied, setTemplateCopied] = useState(false);
  const scrollTimeoutRef = useRef<any>(null);

  const { activeAcrId, activeAcrChangeId, isMouseOverSidebar } = useAcrStore();
  const acr = useAcrStore(state => {
    if (activeAcrId) {
      const target = state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId);
      if (target) return target;
    }
    return state.acrs.find(a => a.status === 'pending' && a.projectId === activeProjectId);
  });

  const isMomAddTool = (name: string) =>
    ['createMoM', 'createMom', 'addMoM', 'addMom', 'updateMeetingDraft'].includes(name);

  const isMomUpdateTool = (name: string) =>
    ['updateMom', 'updateMoM'].includes(name);

  const isMomDeleteTool = (name: string) =>
    ['deleteMom', 'deleteMoM'].includes(name);

  const projectMoms = useMemo<any[]>(() => {
    const realMoms = activeProjectId ? moms.filter(m => m.projectId === activeProjectId) : [];
    const pendingChanges = acr?.changes || [];
    const acrAdds = pendingChanges.filter(c => isMomAddTool(c.name));

    const mappedReal = realMoms.map(m => {
      const updateChange = pendingChanges.find(c => 
        (isMomUpdateTool(c.name) || (c.name === 'updateMeetingDraft' && c.args?.id)) && 
        String(c.args?.id) === String(m.id)
      );
      const deleteChange = pendingChanges.find(c => 
        isMomDeleteTool(c.name) && String(c.args?.id) === String(m.id)
      );

      let displayTitle = m.title;
      let displayDate = m.date;
      let displayTime = m.time;
      let displayLocation = m.location;
      let displayAttendees = m.attendees;
      let displayAgenda = m.agenda;
      let displayNotes = m.notes;
      let displayKeyDecisions = m.keyDecisions;
      let displayActionItems = m.actionItems;

      if (updateChange && updateChange.args) {
        if (updateChange.args.title !== undefined) displayTitle = updateChange.args.title;
        if (updateChange.args.name !== undefined) displayTitle = updateChange.args.name;
        if (updateChange.args.date !== undefined) displayDate = updateChange.args.date;
        if (updateChange.args.time !== undefined) displayTime = updateChange.args.time;
        if (updateChange.args.location !== undefined) displayLocation = updateChange.args.location;
        if (updateChange.args.attendees !== undefined) {
          displayAttendees = Array.isArray(updateChange.args.attendees)
            ? updateChange.args.attendees.join(', ')
            : updateChange.args.attendees;
        }
        if (updateChange.args.agenda !== undefined) displayAgenda = updateChange.args.agenda;
        if (updateChange.args.notes !== undefined) displayNotes = updateChange.args.notes;
        else if (updateChange.args.meetingNotes !== undefined) displayNotes = updateChange.args.meetingNotes;
        if (updateChange.args.keyDecisions !== undefined) displayKeyDecisions = updateChange.args.keyDecisions;
        else if (updateChange.args.decisions !== undefined) displayKeyDecisions = updateChange.args.decisions;
        if (updateChange.args.actionItems !== undefined) {
          displayActionItems = proposalActionItems(updateChange.args.actionItems, `upd-ai-${updateChange.id}`);
        }
      }

      return {
        ...m,
        title: displayTitle,
        date: displayDate,
        time: displayTime,
        location: displayLocation,
        attendees: displayAttendees,
        agenda: displayAgenda,
        notes: displayNotes,
        keyDecisions: displayKeyDecisions,
        actionItems: displayActionItems,
        isReal: true,
        isAcrProposedUpdate: !!updateChange,
        isAcrProposedDelete: !!deleteChange,
        acrChangeId: updateChange?.id || deleteChange?.id,
        acrId: acr?.id,
        isApproved: updateChange ? updateChange.approved !== false : (deleteChange ? deleteChange.approved !== false : true),
        isFocusedChange: activeAcrChangeId === (updateChange?.id || deleteChange?.id),
        updateArgs: updateChange?.args,
        // The same field-by-field comparison every other module shows. This
        // screen merged the proposal into the record for display and never
        // showed what any of it replaced.
        acrOriginal: m,
        acrChange: updateChange || deleteChange,
        acrDiffs: updateChange
          ? computeAcrDiffs(m, updateChange.args, updateChange.name)
          : [],
        acrChangedFieldCount: updateChange
          ? computeAcrDiffs(m, updateChange.args, updateChange.name).length
          : 0,
      };
    });

    const mappedAdds = acrAdds.map((chg, idx) => ({
      id: `acr-add-${chg.id}`,
      projectId: activeProjectId || '',
      title: chg.args?.title || chg.args?.name || 'Proposed Meeting Minutes',
      date: chg.args?.date || new Date().toISOString().split('T')[0],
      time: chg.args?.time || '10:00',
      location: chg.args?.location || 'Virtual Call / Remote',
      attendees: Array.isArray(chg.args?.attendees)
        ? chg.args.attendees.join(', ')
        : (chg.args?.attendees || ''),
      agenda: chg.args?.agenda || '',
      notes: chg.args?.notes || chg.args?.meetingNotes || '',
      keyDecisions: chg.args?.keyDecisions || chg.args?.decisions || '',
      actionItems: proposalActionItems(chg.args?.actionItems, `prop-ai-${chg.id}`),
      createdAt: Date.now() + idx,
      isReal: false,
      isAcrProposedAdd: true,
      acrChangeId: chg.id,
      acrId: acr?.id,
      isApproved: chg.approved !== false,
      isFocusedChange: activeAcrChangeId === chg.id,
      acrOriginal: null,
      acrChange: chg,
      acrDiffs: computeAcrDiffs(null, chg.args, chg.name, { treatAllAsChanged: true }),
      acrChangedFieldCount: 0,
    }));

    return [...mappedAdds, ...mappedReal].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activeProjectId, moms, acr, activeAcrChangeId]);

  const activeMom = projectMoms.find(m => m.id === activeMomId) || projectMoms[0];

  // /mom?mom=<id>&action=<id> (from the Overview's Needs attention list):
  // open that meeting, scroll to the action item and light it up. The address
  // is cleared once read so a reload does not repeat it.
  useEffect(() => {
    const momId = searchParams.get('mom');
    const actionId = searchParams.get('action');
    if (!momId && !actionId) return;
    const target = projectMoms.find(m => m.id === momId);
    if (!target) return; // moms may not have loaded yet; the effect runs again when they do
    setActiveMomId(target.id);
    setSearchParams({}, { replace: true });
    if (actionId) setFlashActionId(actionId);
  }, [searchParams, projectMoms, setActiveMomId, setSearchParams]);

  useEffect(() => {
    if (!flashActionId || activeMom?.id === undefined) return;
    // Wait a frame for the chosen meeting's action items to be on screen.
    const scrollTimer = setTimeout(() => {
      document.getElementById(`mom-action-${flashActionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    const clearTimer = setTimeout(() => setFlashActionId(null), 3000);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [flashActionId, activeMom?.id]);

  useEffect(() => {
    if (activeAcrChangeId) {
      const found = projectMoms.find(m => m.acrChangeId === activeAcrChangeId);
      if (found) {
        setActiveMomId(found.id);
        if (isMouseOverSidebar) {
          if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = setTimeout(() => {
            const cardEl = document.getElementById(`mom-item-${found.id}`);
            if (cardEl) {
              cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 50);
        }
      }
    } else if (!activeMomId && projectMoms.length > 0) {
      setActiveMomId(projectMoms[0].id);
    }
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [activeAcrChangeId, projectMoms, isMouseOverSidebar, setActiveMomId, activeMomId]);

  const handleUpdateActiveMom = (updates: Partial<MoM>) => {
    if (!activeMom) return;
    if (activeMom.isAcrProposedAdd || activeMom.isAcrProposedUpdate) {
      const changeId = activeMom.acrChangeId;
      const targetAcrId = activeMom.acrId || activeAcrId || acr?.id;
      if (changeId && targetAcrId) {
        const foundChange = acr?.changes.find(c => c.id === changeId);
        if (foundChange) {
          const newArgs = { ...foundChange.args, ...updates };
          useAcrStore.getState().updateAcrChange(targetAcrId, changeId, { args: newArgs });
        }
      }
    } else {
      updateMom(activeMom.id, updates);
    }
  };

  const isProposal = !!(activeMom?.isAcrProposedAdd || activeMom?.isAcrProposedUpdate);

  /**
   * Write a new action item list into the open proposal. The list drawn on
   * screen (`activeMom.actionItems`) is the base: it already has stable ids,
   * and for an edit proposal that does not touch action items it is the
   * meeting's own list, so nothing is lost when the first item is changed.
   */
  const writeProposalActionItems = (items: any[]) => {
    if (!activeMom) return;
    const changeId = activeMom.acrChangeId;
    const targetAcrId = activeMom.acrId || activeAcrId || acr?.id;
    if (!changeId || !targetAcrId) return;
    const foundChange = acr?.changes.find(c => c.id === changeId);
    if (!foundChange) return;
    useAcrStore.getState().updateAcrChange(targetAcrId, changeId, {
      args: { ...foundChange.args, actionItems: items },
    });
  };

  const handleAddMomActionItem = () => {
    if (!activeMom) return;
    if (isProposal) {
      writeProposalActionItems([
        ...(activeMom.actionItems || []),
        { id: `act-${Date.now()}`, description: '', assignee: 'PM', status: 'Open' },
      ]);
    } else {
      addActionItem(activeMom.id);
    }
  };

  const handleUpdateMomActionItem = (itemId: string, itemUpdates: any) => {
    if (!activeMom) return;
    if (isProposal) {
      // A proposal never touches the task tracker. It changes only itself.
      writeProposalActionItems(
        (activeMom.actionItems || []).map((it: any) =>
          it.id === itemId ? { ...it, ...itemUpdates } : it
        )
      );
      return;
    }

    const targetItem = activeMom.actionItems?.find((it: any) => it.id === itemId);
    if (targetItem && !isActionItemUnpushed(targetItem)) {
      const taskUpdates: any = {};
      if (itemUpdates.description !== undefined) taskUpdates.description = itemUpdates.description;
      if (itemUpdates.assignee !== undefined) taskUpdates.owner = itemUpdates.assignee;
      if (itemUpdates.status !== undefined) taskUpdates.status = itemUpdates.status;
      // The detail fields have the same names on the task.
      for (const k of ['type', 'priority', 'estimatedResolutionDate', 'remarks', 'linkedActivityIds']) {
        if (itemUpdates[k] !== undefined) taskUpdates[k] = k === 'priority' && !itemUpdates[k] ? undefined : itemUpdates[k];
      }
      if (Object.keys(taskUpdates).length > 0) {
        updateTask(targetItem.taskId, taskUpdates);
      }
    }
    updateActionItem(activeMom.id, itemId, itemUpdates);
  };

  const handleDeleteMomActionItem = (itemId: string) => {
    if (!activeMom) return;
    if (isProposal) {
      writeProposalActionItems(
        (activeMom.actionItems || []).filter((it: any) => it.id !== itemId)
      );
    } else {
      deleteActionItem(activeMom.id, itemId);
    }
  };

  if (!activeProjectId) return null;

  const handleAddMom = () => {
    const newId = addMom(activeProjectId);
    setActiveMomId(newId);
    setIsEditing(true);
  };

  const generateExportText = (mom: MoM) => {
    const stripHtml = (html: string) => {
      const tmp = document.createElement("DIV");
      tmp.innerHTML = html || '';
      return tmp.textContent || tmp.innerText || "";
    };

    return `MINUTES OF MEETING
--------------------------------------------------
TITLE: ${mom.title}
DATE: ${formatDateDisplay(mom.date)} ${formatTimeDisplay(mom.time)}
LOCATION: ${mom.location}
ATTENDEES: ${mom.attendees}

AGENDA:
${stripHtml(mom.agenda) || 'N/A'}

NOTES:
${stripHtml(mom.notes) || 'N/A'}

KEY DECISIONS:
${stripHtml(mom.keyDecisions) || 'N/A'}

ACTION ITEMS:
${mom.actionItems.map(a => `- [${a.status}] ${a.description} (Assignee: ${a.assignee})`).join('\n') || 'N/A'}
`;
  };

  const generateExportHTML = (mom: MoM) => {
    return `<div style="font-family: Arial, sans-serif;">
  <h2>MINUTES OF MEETING</h2>
  <hr/>
  <p><strong>TITLE:</strong> ${mom.title}</p>
  <p><strong>DATE:</strong> ${formatDateDisplay(mom.date)} ${formatTimeDisplay(mom.time)}</p>
  <p><strong>LOCATION:</strong> ${mom.location}</p>
  <p><strong>ATTENDEES:</strong> ${mom.attendees}</p>
  
  <h3>AGENDA:</h3>
  <div>${mom.agenda || 'N/A'}</div>
  
  <h3>NOTES:</h3>
  <div>${mom.notes || 'N/A'}</div>
  
  <h3>KEY DECISIONS:</h3>
  <div>${mom.keyDecisions || 'N/A'}</div>
  
  <h3>ACTION ITEMS:</h3>
  <ul>
    ${mom.actionItems.map(a => `<li><strong>[${a.status}]</strong> ${a.description} <em>(Assignee: ${a.assignee})</em></li>`).join('') || '<li>N/A</li>'}
  </ul>
</div>`;
  };

  const handleExportText = async () => {
    if (!activeMom) return;
    
    const plainText = generateExportText(activeMom);
    const htmlText = generateExportHTML(activeMom);
    
    try {
      const clipboardItem = new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([htmlText], { type: 'text/html' })
      });
      await navigator.clipboard.write([clipboardItem]);
    } catch (e) {
      // Fallback for browsers that don't support ClipboardItem with HTML
      await navigator.clipboard.writeText(plainText);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col lg:flex-row px-4 py-8 sm:px-12 sm:pt-12 sm:pb-8 gap-6 sm:gap-12 bg-transparent font-sans relative overflow-hidden">
      
      {/* Left Sidebar List - Flat Structure */}
      <div className="w-full lg:w-[350px] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-qb-light-grey pb-4 lg:pb-0 lg:pr-6 relative bg-transparent h-1/3 lg:h-full min-h-0">
        <div className="flex items-center justify-between mb-8 shrink-0">
          <h2 className="text-xl font-black uppercase tracking-widest text-qb-black">MEETINGS</h2>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { setShowImportModal(true); setImportError(null); setImportJsonText(''); }}
              className="text-xs font-black uppercase text-qb-grey hover:text-qb-black tracking-widest transition-colors flex items-center gap-1 cursor-pointer"
              title="Import MoM from JSON"
            >
              <FileUp className="w-4 h-4" /> IMPORT
            </button>
            <button 
              onClick={handleAddMom}
              className="text-xs font-black uppercase text-qb-grey hover:text-qb-black tracking-widest transition-colors flex items-center gap-1 cursor-pointer" 
            >
              <Plus className="w-4 h-4" /> NEW MOM
            </button>
          </div>
        </div>

        {/* Analysing a recording (live capture, audio files, pasted notes, with
            Gemini) used to be its own MEETINGS tab. It makes minutes, so it
            lives here now. */}
        <button
          type="button"
          onClick={() => navigate('/meetings')}
          className="mb-6 -mt-4 shrink-0 flex items-center justify-between gap-2 px-3 py-2 border border-dashed border-qb-light-grey text-[10px] font-black uppercase tracking-widest text-qb-grey hover:border-qb-orange hover:text-qb-orange transition-colors"
          title="Capture live audio, import a recording or paste notes, and let Gemini draft the minutes"
        >
          <span className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Analyse a recording</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {projectMoms.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-qb-grey mt-12 text-center shrink-0">
            <p className="text-sm font-light tracking-widest uppercase mb-4">No Meetings Available</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0 pr-1">
            {projectMoms.map((mom: any) => {
              const isActive = activeMom?.id === mom.id;
              const isFocused = mom.isFocusedChange;
              return (
                <div
                  key={mom.id}
                  id={`mom-item-${mom.id}`}
                  onClick={() => { setActiveMomId(mom.id); setIsEditing(false); }}
                  className={`group flex justify-between items-start py-3 px-3 cursor-pointer transition-all relative border ${
                    isFocused
                      ? 'border-qb-orange bg-qb-orange/10 shadow-sm'
                      : isActive
                      ? 'border-qb-black/20 bg-black/5'
                      : 'border-transparent hover:bg-black/5'
                  }`}
                >
                  {isActive && <div className="absolute left-[-1px] top-1 bottom-1 w-[3px] bg-qb-orange" />}
                  <div className="flex flex-col gap-1 overflow-hidden pointer-events-none min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-sm truncate ${isActive ? 'font-black text-qb-black' : 'font-bold text-qb-dark-grey'}`}>
                        {mom.title || 'Untitled Meeting'}
                      </span>
                      {/* The same words and colours as every other module:
                          green new, orange edit, magenta removal. */}
                      {mom.isAcrProposedAdd && (
                        <span className="px-1.5 py-0.2 border border-[#51b53e] bg-[#51b53e]/10 text-[#51b53e] text-[9px] font-black uppercase tracking-widest shrink-0">
                          PROPOSED NEW
                        </span>
                      )}
                      {mom.isAcrProposedUpdate && (
                        <span className="px-1.5 py-0.2 border border-[#ff7600] bg-[#ff7600]/10 text-[#ff7600] text-[9px] font-black uppercase tracking-widest shrink-0">
                          PROPOSED EDIT{mom.acrChangedFieldCount ? ` · ${mom.acrChangedFieldCount}` : ''}
                        </span>
                      )}
                      {mom.isAcrProposedDelete && (
                        <span className="px-1.5 py-0.2 border border-qb-magenta bg-qb-magenta/10 text-qb-magenta text-[9px] font-black uppercase tracking-widest shrink-0">
                          PROPOSED REMOVAL
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono tracking-widest text-qb-grey uppercase">
                      {formatDateDisplay(mom.date)} {formatTimeDisplay(mom.time)}
                    </span>
                  </div>
                  {mom.isReal && (
                    <button 
                      className="opacity-0 group-hover:opacity-100 text-qb-light-grey hover:text-qb-magenta transition-opacity shrink-0 p-1 pointer-events-auto"
                      onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(mom.id); }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 lg:pr-8 overflow-hidden h-2/3 lg:h-full">
        {activeMom ? (
          isEditing ? (
            <div className="h-full flex flex-col border border-qb-light-grey shadow-sm bg-transparent overflow-hidden">
              <div className="h-14 border-b border-qb-light-grey flex items-center justify-between px-6 bg-transparent shrink-0">
                <span className="text-xs font-black uppercase tracking-widest text-qb-orange">
                  {activeMom.isAcrProposedAdd ? 'EDITING PROPOSED MoM' : 'EDITING MoM'}
                </span>
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-6 py-2 bg-qb-black text-white text-xs font-black uppercase tracking-widest hover:bg-qb-orange transition-colors"
                >
                  DONE
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8 hide-scrollbar">
                
                {/* ACR Notice if editing proposed item */}
                {(activeMom.isAcrProposedAdd || activeMom.isAcrProposedUpdate) && (
                  <div className="p-3 border border-qb-orange bg-qb-orange/5 text-qb-orange text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Edits made here directly update the Assistant Change Request proposal.</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Meeting Title</label>
                  <input
                    type="text"
                    value={activeMom.title || ''}
                    onChange={(e) => handleUpdateActiveMom({ title: e.target.value })}
                    className="w-full bg-qb-box-bg border-none p-3 text-lg font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                    placeholder="e.g. Sprint Planning"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                  <div>
                    <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Date</label>
                    <input
                      type="date"
                      value={getInputDate(activeMom.date)}
                      onChange={(e) => handleUpdateActiveMom({ date: e.target.value })}
                      className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange font-mono uppercase tracking-wide"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Time</label>
                    <input
                      type="time"
                      value={getInputTime(activeMom.time)}
                      onChange={(e) => handleUpdateActiveMom({ time: e.target.value })}
                      className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange font-mono uppercase tracking-wide"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                  <div>
                    <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Location / Link</label>
                    <input
                      type="text"
                      value={activeMom.location || ''}
                      onChange={(e) => handleUpdateActiveMom({ location: e.target.value })}
                      className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                      placeholder="e.g. Room 4A or Meet Link"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Attendees</label>
                    <input
                      type="text"
                      value={activeMom.attendees || ''}
                      onChange={(e) => handleUpdateActiveMom({ attendees: e.target.value })}
                      className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                      placeholder="e.g. John, Sarah, Mike"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Agenda</label>
                  <RichTextEditor
                    id="agenda-editor"
                    value={activeMom.agenda || ''}
                    onChange={(val) => handleUpdateActiveMom({ agenda: val })}
                    placeholder="Meeting agenda items..."
                    minHeight="min-h-[120px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Meeting Notes</label>
                  <RichTextEditor
                    id="notes-editor"
                    value={activeMom.notes || ''}
                    onChange={(val) => handleUpdateActiveMom({ notes: val })}
                    placeholder="Detailed notes during the meeting..."
                    minHeight="min-h-[200px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Key Decisions</label>
                  <RichTextEditor
                    id="decisions-editor"
                    value={activeMom.keyDecisions || ''}
                    onChange={(val) => handleUpdateActiveMom({ keyDecisions: val })}
                    placeholder="Decisions made..."
                    minHeight="min-h-[120px]"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2 border-b border-qb-light-grey pb-2">
                    <label className="block text-xs font-black text-qb-grey uppercase tracking-widest">Action Items</label>
                    <button onClick={handleAddMomActionItem} className="text-qb-orange hover:text-qb-orange/80 text-xs font-black uppercase tracking-widest flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add Item
                    </button>
                  </div>
                  
                  {(!activeMom.actionItems || activeMom.actionItems.length === 0) ? (
                    <div className="text-sm text-qb-grey italic">No action items defined.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {activeMom.actionItems.map((item: any) => {
                        const linkedTask = (!isProposal && !isActionItemUnpushed(item))
                          ? tasks.find(t => t.id === item.taskId)
                          : null;
                        const itemDescription = linkedTask ? linkedTask.description : (item.description || '');
                        const itemAssignee = linkedTask ? (linkedTask.owner || '') : (item.assignee || '');
                        const itemStatus = linkedTask ? normalizeMoMActionItemStatus(linkedTask.status) : (item.status || 'Open');

                        const details = actionItemDetailValues(item, linkedTask);
                        const detailsOpen = !!openDetails[item.id];

                        return (
                        <div key={item.id} id={`mom-action-${item.id}`} className={`flex flex-col gap-2 ${flashActionId === item.id ? 'ring-2 ring-qb-orange bg-qb-orange/5' : ''}`}>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={itemDescription}
                            onChange={(e) => handleUpdateMomActionItem(item.id, { description: e.target.value })}
                            placeholder="Action description"
                            className="flex-1 bg-qb-box-bg border-none p-2 text-sm font-medium text-qb-black outline-none focus:ring-1 focus:ring-qb-orange"
                          />
                          <input
                            type="text"
                            value={itemAssignee}
                            onChange={(e) => handleUpdateMomActionItem(item.id, { assignee: e.target.value })}
                            placeholder="Assignee"
                            className="w-32 bg-qb-box-bg border-none p-2 text-sm font-medium text-qb-black outline-none focus:ring-1 focus:ring-qb-orange"
                          />
                          <select
                            value={itemStatus}
                            onChange={(e) => handleUpdateMomActionItem(item.id, { status: e.target.value as any })}
                            className="w-36 bg-qb-box-bg border-none p-2 text-xs font-black text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
                          >
                            {MOM_ACTION_STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <DetailsToggle open={detailsOpen} count={filledDetailCount(details)} onToggle={() => toggleDetails(item.id)} />
                          <button
                            onClick={() => handleDeleteMomActionItem(item.id)}
                            className="p-2 text-qb-light-grey hover:text-qb-magenta transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        {detailsOpen && (
                          <div className="ml-4 pl-4 border-l-2 border-qb-light-grey pb-2">
                            <ActionItemDetails
                              values={details}
                              activities={timelineActivities}
                              editable={true}
                              onChange={(updates) => handleUpdateMomActionItem(item.id, updates)}
                            />
                          </div>
                        )}
                        </div>
                      );})}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-4xl pt-2 pb-16 overflow-y-auto hide-scrollbar h-full pl-4 pr-12">
              {/* ACR Status Notice Banner */}
              {(activeMom.isAcrProposedAdd || activeMom.isAcrProposedUpdate || activeMom.isAcrProposedDelete) && (
                <div className={`p-4 mb-6 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0 ${
                  activeMom.isAcrProposedDelete
                    ? 'bg-qb-magenta/10 border-qb-magenta text-qb-magenta'
                    : activeMom.isAcrProposedUpdate
                    ? 'bg-qb-cyan/10 border-qb-cyan text-qb-cyan'
                    : 'bg-qb-orange/10 border-qb-orange text-qb-orange'
                }`}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-black uppercase tracking-widest">
                      {activeMom.isAcrProposedDelete
                        ? 'PROPOSED REMOVAL'
                        : activeMom.isAcrProposedUpdate
                        ? `PROPOSED EDIT · ${activeMom.acrChangedFieldCount} FIELD${activeMom.acrChangedFieldCount === 1 ? '' : 'S'} CHANGE`
                        : 'PROPOSED NEW MINUTES OF MEETING'}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                    {activeMom.acrId && activeMom.acrChangeId && (
                      <button
                        type="button"
                        onClick={() => {
                          useAcrStore.getState().updateAcrChangeApproval(
                            activeMom.acrId,
                            activeMom.acrChangeId,
                            !activeMom.isApproved
                          );
                        }}
                        className={`text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 border transition-all cursor-pointer flex items-center gap-1.5 ${
                          activeMom.isApproved
                            ? 'bg-qb-black text-white border-qb-black hover:bg-qb-orange hover:border-qb-orange'
                            : 'bg-transparent text-qb-dark-grey border-qb-light-grey hover:border-qb-black'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        {activeMom.isApproved ? 'SELECTED FOR SIGN-OFF' : 'NOT SELECTED (STAYS OPEN)'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (activeMom.acrId) {
                          useAcrStore.getState().setActiveAcrId(activeMom.acrId);
                        }
                        if (activeMom.acrChangeId) {
                          useAcrStore.getState().setActiveAcrChangeId(activeMom.acrChangeId);
                        }
                        useAiStore.getState().setSidebarOpen(true);
                      }}
                      className="text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 bg-qb-cyan/15 border border-qb-cyan text-qb-cyan hover:bg-qb-cyan hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      DISCUSS WITH AI
                    </button>
                  </div>
                </div>
              )}

              {/* What actually changes. Until now this screen showed only the
                  proposed values, so a person signing off could not tell which
                  of them were new and which were already there. */}
              {activeMom.isAcrProposedUpdate && (activeMom.acrDiffs || []).length > 0 && (
                <div className="mb-6 border border-qb-light-grey p-4 bg-qb-box-bg/40">
                  <AcrDiffList
                    diffs={activeMom.acrDiffs}
                    title={`Proposed changes — ${activeMom.acrDiffs.length} field${activeMom.acrDiffs.length === 1 ? '' : 's'}`}
                  />
                </div>
              )}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h1 className="text-3xl font-black uppercase tracking-widest text-qb-black mb-2">
                      {activeMom.title || 'UNTITLED MEETING'}
                  </h1>
                  <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest text-qb-grey mt-4">
                    <span className="flex items-center gap-1"><Calendar className="w-4 h-4"/> {formatDateDisplay(activeMom.date)}</span>
                    <span className="flex items-center gap-1"><Clock className="w-4 h-4"/> {formatTimeDisplay(activeMom.time)}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-4 h-4"/> {activeMom.location || 'UNKNOWN'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleExportText}
                    className="flex items-center gap-2 px-4 py-2 bg-qb-orange text-white text-xs font-black uppercase tracking-widest hover:bg-qb-orange/90 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                    {copied ? 'COPIED TO CLIPBOARD' : 'EXPORT'}
                  </button>
                </div>
              </div>
              
              <hr className="border-t border-qb-light-grey mb-8" />

              <div className="space-y-12">
                <section>
                  <h3 className="text-sm font-black uppercase tracking-widest text-qb-orange mb-4 flex items-center gap-2">
                    <Users className="w-4 h-4" /> ATTENDEES
                  </h3>
                  <div className="text-qb-black font-medium text-lg leading-relaxed bg-qb-box-bg p-4">
                    {activeMom.attendees || 'None specified'}
                  </div>
                </section>

                {/* An empty agenda or decisions block only pushed the action
                    items further down the page. Hidden when empty, except
                    while a proposal is open, where every field stays visible. */}
                {(isProposal || hasText(activeMom.agenda)) && (
                <section>
                  <h3 className="text-sm font-black uppercase tracking-widest text-qb-orange mb-4">AGENDA</h3>
                  <RichTextViewer
                    content={activeMom.agenda}
                    placeholder="No agenda provided"
                    className="qb-prose"
                  />
                </section>
                )}

                <section>
                  <h3 className="text-sm font-black uppercase tracking-widest text-qb-orange mb-4">MEETING NOTES</h3>
                  <RichTextViewer
                    content={activeMom.notes}
                    placeholder="No notes taken"
                    className="qb-prose"
                  />
                </section>

                {(isProposal || hasText(activeMom.keyDecisions)) && (
                <section>
                  <h3 className="text-sm font-black uppercase tracking-widest text-qb-orange mb-4">KEY DECISIONS</h3>
                  <div className="border-l-4 border-qb-orange pl-4">
                    <RichTextViewer
                      content={activeMom.keyDecisions}
                      placeholder="No decisions recorded"
                      className="qb-prose qb-prose-strong"
                    />
                  </div>
                </section>
                )}

                <section>
                  {(() => {
                    // PUSH ALL: only on saved minutes. Signing off a proposal
                    // pushes nothing; the user decides here, afterwards.
                    const pushableCount = isProposal
                      ? 0
                      : (activeMom.actionItems || []).filter((it: any) => isActionItemPushable(it)).length;
                    return (
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-black uppercase tracking-widest text-qb-orange">ACTION ITEMS</h3>
                        {pushableCount > 0 && (
                          <button
                            type="button"
                            onClick={() => pushActionItemsToTracker(activeMom.id)}
                            title="Push every open action item that has no task yet to the task tracker"
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-qb-light-grey text-[10px] font-black uppercase tracking-widest text-qb-dark-grey hover:border-qb-orange hover:text-qb-orange transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" /> PUSH ALL ({pushableCount})
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {activeMom.actionItems.length === 0 ? (
                    <div className="text-qb-dark-grey text-sm">No action items assigned.</div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {activeMom.actionItems.map((item: any) => {
                        const isPushed = !isActionItemUnpushed(item);
                        const linkedTask = (!isProposal && isPushed)
                           ? tasks.find(t => t.id === item.taskId)
                           : null;

                        const rawStatus = linkedTask ? linkedTask.status : item.status;
                        const displayStatus = normalizeMoMActionItemStatus(rawStatus);
                        const isClosed = displayStatus === 'Done' || displayStatus === 'Dropped';
                        const statusColor = MOM_ACTION_STATUS_COLORS[displayStatus] || 'var(--color-qb-orange)';
                        const canPush = !isProposal && isActionItemUnpushed(item)
                          && !!(item.description && item.description.trim());

                        const details = actionItemDetailValues(item, linkedTask);
                        const detailsOpen = !!openDetails[item.id];

                        return (
                        <div key={item.id} id={`mom-action-${item.id}`} className={`border hover:border-qb-black transition-colors ${flashActionId === item.id ? 'border-qb-orange ring-2 ring-qb-orange bg-qb-orange/5' : 'border-qb-light-grey'}`}>
                        <div 
                          className="flex items-center justify-between p-4 bg-transparent cursor-pointer group"
                          title={linkedTask ? 'Open the linked task' : 'Edit this action item'}
                          onClick={() => {
                            // A pushed item opens its task. Anything else opens
                            // the editor. A click never creates a task.
                            if (linkedTask) {
                              setActiveTaskId(linkedTask.id);
                            } else {
                              setIsEditing(true);
                            }
                          }}
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
                            <span className={`text-base font-bold text-qb-black ${isClosed ? 'line-through text-qb-grey' : ''}`}>
                              {(linkedTask ? linkedTask.description : item.description) || 'Empty Description'}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            <DetailsToggle open={detailsOpen} count={filledDetailCount(details)} onToggle={() => toggleDetails(item.id)} />
                            <span className="text-xs font-black uppercase tracking-widest text-qb-dark-grey bg-qb-box-bg px-2 py-1">
                              {(linkedTask ? linkedTask.owner : item.assignee) || 'UNASSIGNED'}
                            </span>
                            <span 
                              className="text-[10px] font-black uppercase tracking-widest px-2 py-1"
                              style={{ 
                                backgroundColor: `${statusColor}18`,
                                color: statusColor 
                              }}
                            >
                              {displayStatus}
                            </span>
                            {canPush && (
                              <button
                                type="button"
                                title="Push to task tracker"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  pushActionItemsToTracker(activeMom.id, [item.id]);
                                }}
                                className="text-qb-grey hover:text-qb-orange transition-colors p-1 z-10"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                            )}
                            {isPushed && !isProposal && (
                              <span className="text-[10px] font-black tracking-widest uppercase text-qb-orange flex items-center gap-1">
                                <Check className="w-3 h-3" /> PUSHED
                              </span>
                            )}
                          </div>
                        </div>
                        {detailsOpen && (
                          <div className="px-4 pb-4 pt-3 mx-4 border-t border-qb-light-grey">
                            <ActionItemDetails values={details} activities={timelineActivities} editable={false} />
                          </div>
                        )}
                        </div>
                      )})}
                    </div>
                  )}
                </section>
              </div>

              <div className="mt-16 pt-8 border-t border-qb-light-grey flex items-center justify-between gap-6 pb-20">
                <button 
                  onClick={() => setIsEditing(true)} 
                  className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-qb-grey hover:text-qb-orange transition-colors"
                >
                    <Edit2 className="w-4 h-4" /> REVISE MOM
                </button>
                {activeMom.isReal && (
                  <button 
                    onClick={() => setShowDeleteConfirm(activeMom.id)}
                    className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-qb-grey hover:text-qb-magenta transition-colors"
                  >
                      <Trash2 className="w-4 h-4" /> DELETE MOM
                  </button>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-qb-grey p-8 h-full">
            <FileText className="w-16 h-16 mb-4 text-qb-light-grey" />
            <p className="text-sm font-black uppercase tracking-widest">SELECT A MEETING TO VIEW CONTENT</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title="DELETE MEETING"
          description="Are you sure you want to delete this meeting minute?"
          subDescription="THIS ACTION CANNOT BE UNDONE."
          confirmText="YES, DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            deleteMom(showDeleteConfirm);
            if (activeMomId === showDeleteConfirm) {
               setActiveMomId(null);
            }
            setShowDeleteConfirm(null);
          }}
          onClose={() => setShowDeleteConfirm(null)}
        />
      )}

      {/* JSON Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-qb-bg border-4 border-qb-black w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center px-6 py-4 border-b border-qb-light-grey">
              <div className="flex items-center gap-2">
                <FileUp className="w-5 h-5 text-qb-orange" />
                <h3 className="text-sm font-black uppercase tracking-widest text-qb-black">Import MoM from JSON</h3>
              </div>
              <button 
                onClick={() => setShowImportModal(false)}
                className="text-qb-grey hover:text-qb-black transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-bold text-qb-grey uppercase tracking-widest">
                  Paste a JSON object or array of objects:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const sample = {
                      title: "Sprint Planning & Architecture Review",
                      date: new Date().toISOString().split('T')[0],
                      time: "10:00",
                      location: "Conference Room A / Remote",
                      attendees: "John Doe, Jane Smith",
                      agenda: "<p>1. Review sprint goals<br>2. Architectural blockers</p>",
                      notes: "<p>Discussed project scope, timeline updates, and risk mitigation strategies.</p>",
                      keyDecisions: "<p>Approved architectural proposal for API revamp.</p>",
                      actionItems: [
                        {
                          description: "Complete module documentation",
                          assignee: "John Doe",
                          status: "Open"
                        }
                      ]
                    };
                    navigator.clipboard.writeText(JSON.stringify(sample, null, 2));
                    setTemplateCopied(true);
                    setTimeout(() => setTemplateCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-qb-orange hover:underline cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {templateCopied ? "Copied Sample JSON!" : "Copy Template"}
                </button>
              </div>

              <textarea
                value={importJsonText}
                onChange={(e) => {
                  setImportJsonText(e.target.value);
                  setImportError(null);
                }}
                placeholder={`{\n  "title": "Meeting Title",\n  "date": "2026-08-17",\n  "time": "10:00",\n  "location": "Conference Room",\n  "attendees": "Alice, Bob",\n  "agenda": "Review deliverables",\n  "notes": "Discussion points...",\n  "keyDecisions": "Decision summary...",\n  "actionItems": [\n    { "description": "Update spec", "assignee": "Alice", "status": "Open" }\n  ]\n}`}
                className="w-full h-64 bg-qb-box-bg border border-qb-light-grey p-4 text-xs font-mono font-medium text-qb-black outline-none focus:ring-1 focus:ring-qb-orange resize-none"
              />

              {importError && (
                <div className="bg-qb-magenta/10 border-l-4 border-qb-magenta p-3 text-xs font-bold text-qb-magenta tracking-wide uppercase">
                  {importError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-qb-light-grey bg-black/5">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-5 py-2.5 bg-transparent border-2 border-qb-light-grey text-qb-black text-xs font-black uppercase tracking-widest hover:border-qb-black transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!importJsonText.trim()) {
                    setImportError("Please paste valid JSON before importing.");
                    return;
                  }
                  try {
                    const parsed = JSON.parse(importJsonText);
                    if (Array.isArray(parsed)) {
                      if (parsed.length === 0) {
                        setImportError("JSON array cannot be empty.");
                        return;
                      }
                      const createdIds = importMoms(activeProjectId, parsed);
                      if (createdIds.length > 0) {
                        setActiveMomId(createdIds[0]);
                      }
                    } else if (typeof parsed === 'object' && parsed !== null) {
                      const createdId = importMom(activeProjectId, parsed);
                      setActiveMomId(createdId);
                    } else {
                      setImportError("JSON must be an object or array of objects.");
                      return;
                    }
                    setShowImportModal(false);
                    setImportJsonText('');
                    setImportError(null);
                  } catch (err: any) {
                    setImportError(`Invalid JSON format: ${err.message || 'Check syntax'}`);
                  }
                }}
                className="px-6 py-2.5 bg-qb-black text-white text-xs font-black uppercase tracking-widest hover:bg-qb-orange transition-colors cursor-pointer"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      <TaskTray
        activeItemId={activeTaskId}
        onClose={() => setActiveTaskId(null)}
      />
    </div>
  );
}
