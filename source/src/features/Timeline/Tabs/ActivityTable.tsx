/**
 * The timeline's activity table: a small spreadsheet.
 *
 * It behaves like Excel and Google Sheets: keys, selection, typing over a
 * cell, the fill handle, moving cells by their edge, copy / cut / paste with
 * other sheets, undo and redo, and formulas that update the moment a cell they
 * use changes. The formula engine and the rules live in ../sheet/.
 *
 * Coordinates: `r` is the row on screen. When a change request is open, the
 * screen also shows proposed rows, so a screen row is not always a sheet row.
 * `realOf(r)` gives the sheet row (the one formulas call row r+1), or null for
 * a row that is only a proposal. Bulk actions touch sheet rows only.
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useTimelineStore, TimelineActivity, Revision } from '../../../store/timelineStore';
import { useAppStore } from '../../../store/appStore';
import { useAcrStore } from '../../../store/acrStore';
import { normalizeHolidayList } from '../../../services/acrExecutor';
import { computeAcrDiffs, acrValuesEqual } from '../../../utils/acrDiff';
import { Plus, Trash2, GripVertical, Undo2, Redo2, CalendarOff, ChevronDown } from 'lucide-react';
import { DateVisualizer } from '../../../components/DateVisualizer';
import { COLUMNS, ColDef, colLetter, colFromLetter } from '../sheet/columns';
import { parseInput, displayText, editText, toTSV, parseTSV, emptyValue } from '../sheet/input';
import { planFill, Seed } from '../sheet/fill';
import { shiftFormula, followMovedBlock, findRefSpans } from '../sheet/refs';
import { evaluateFormulaAt } from '../sheet/recalc';
import { isFormulaText, isErrorText, tokenize } from '../sheet/formula';
import { FUNCS, FUNCTION_HELP } from '../sheet/functions';
import * as D from '../sheet/dates';
import * as H from '../sheet/history';
import { HolidaysPopover, HintBox, HintState, ERROR_HELP } from '../sheet/SheetParts';

const STATUS_COLORS: Record<string, string> = {
  'Completed': 'var(--color-qb-green)',
  'Completed With Delay': 'var(--color-qb-green)',
  'Work In Progress': 'var(--color-qb-cyan)',
  'Delayed WIP': 'var(--color-qb-orange)',
  'Planned': 'var(--color-qb-light-grey)',
  'Not Started': 'var(--color-qb-magenta)',
  'Backlog': 'var(--color-qb-light-grey)',
  'Dropped': 'var(--color-qb-black)',
  'On Hold': 'var(--color-qb-dark-grey)',
};

const REF_COLORS = ['#2dbcd2', '#c11c4d', '#51b53e', '#7c3aed', '#ff7600', '#0ea5e9'];
const ROW_H = 48;
const C = COLUMNS.length;
const ALL_FUNCTIONS = Array.from(new Set([...Object.keys(FUNCTION_HELP), ...Object.keys(FUNCS)])).sort();

type Pos = { r: number; c: number };
type Sel = { anchor: Pos; focus: Pos };
type Rect = { r1: number; c1: number; r2: number; c2: number };
type Edit = { r: number; c: number; mode: 'enter' | 'edit'; origin: 'cell' | 'bar'; initial: string; openList?: boolean };
type Drag =
  | { kind: 'select' }
  | { kind: 'rowselect'; anchorRow: number }
  | { kind: 'colselect'; anchorCol: number }
  | { kind: 'fill'; src: Rect; target: Rect | null }
  | { kind: 'move'; src: Rect; grab: Pos; dest: Pos | null }
  | { kind: 'rowmove'; block: [number, number]; insertAt: number | null; clickRow: number }
  | { kind: 'point'; start: Pos };
type Box = { left: number; top: number; width: number; height: number };
type Clip = { rect: Rect; cells: { value: any; formula?: string; col: ColDef }[][]; text: string; cut: boolean; revKey: string };

const rectOf = (s: Sel): Rect => ({
  r1: Math.min(s.anchor.r, s.focus.r), r2: Math.max(s.anchor.r, s.focus.r),
  c1: Math.min(s.anchor.c, s.focus.c), c2: Math.max(s.anchor.c, s.focus.c),
});
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const inRect = (rc: Rect, r: number, c: number) => r >= rc.r1 && r <= rc.r2 && c >= rc.c1 && c <= rc.c2;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** A stable function that always calls the latest version (for event handlers). */
function useEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}

let measureCanvas: HTMLCanvasElement | null = null;
function textWidth(text: string): number {
  measureCanvas = measureCanvas || document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * 7;
  ctx.font = '400 12px Montserrat, sans-serif';
  return ctx.measureText(text).width;
}

/** Turn a stored value from one column into a value for another (fill or move across columns). */
function convertValue(value: any, from: ColDef, to: ColDef): { ok: boolean; value: any } {
  if (from.type === to.type) return { ok: true, value };
  if (value === '' || value === null || value === undefined) return { ok: true, value: emptyValue(to) };
  const p = parseInput(to, editText({ [from.key]: value }, from));
  return p.invalid ? { ok: false, value } : { ok: true, value: p.value };
}

// ---------------------------------------------------------------------------
// ACR row highlighting (unchanged behaviour)
// ---------------------------------------------------------------------------
const AcrScroller = () => {
  useEffect(() => {
    const initialId = useAcrStore.getState().activeAcrChangeId;
    if (initialId) {
      document.querySelectorAll(`tr[data-acr-change-id="${initialId}"]`).forEach(el => el.classList.add('acr-highlight-row'));
    }
    const unsub = useAcrStore.subscribe((state, prevState) => {
      const currentId = state.activeAcrChangeId;
      const prevId = prevState.activeAcrChangeId;
      if (currentId !== prevId) {
        if (prevId) document.querySelectorAll(`tr[data-acr-change-id="${prevId}"]`).forEach(el => el.classList.remove('acr-highlight-row'));
        if (currentId) {
          const els = document.querySelectorAll(`tr[data-acr-change-id="${currentId}"]`);
          els.forEach(el => el.classList.add('acr-highlight-row'));
          if (els.length > 0 && state.isMouseOverSidebar) els[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
    return unsub;
  }, []);

  return (
    <style dangerouslySetInnerHTML={{ __html: `
      tr[data-acr-type="original-for-update"] td { border-top: 2px solid #8c9699; }
      tr[data-acr-type="original-for-update"] td:first-child { border-left: 2px solid #8c9699; }
      tr[data-acr-type="original-for-update"] td:last-child { border-right: 2px solid #8c9699; }
      tr[data-acr-type="proposed-update"] td { border-bottom: 2px solid #8c9699; }
      tr[data-acr-type="proposed-update"] td:first-child { border-left: 2px solid #8c9699; }
      tr[data-acr-type="proposed-update"] td:last-child { border-right: 2px solid #8c9699; }
      tr.acr-highlight-row {
        background-color: rgb(255 118 0 / 0.1) !important;
        transform: scaleY(1.05) scaleX(1.002); transform-origin: center center;
        z-index: 50 !important; position: relative;
        box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
        transition: transform 0.05s ease-out, background-color 0.05s ease-out, border 0.05s ease-out !important;
      }
      tr.acr-highlight-row td { position: relative; z-index: 50 !important; transition: border 0.05s ease-out !important; border-right: none !important; }
      tr.acr-highlight-row td:first-child { position: sticky; left: 0; z-index: 60 !important; }
      tr.acr-highlight-row[data-acr-type="original-for-update"] td { border-top: 3px solid #ff7600 !important; border-bottom: none !important; }
      tr.acr-highlight-row[data-acr-type="proposed-update"] td { border-bottom: 3px solid #ff7600 !important; border-top: none !important; }
      tr.acr-highlight-row td:first-child { border-left: 3px solid #ff7600 !important; }
      tr.acr-highlight-row td:last-child { border-right: 3px solid #ff7600 !important; }
      .sheet-cell { scroll-margin-top: ${ROW_H + 4}px; scroll-margin-left: 44px; scroll-margin-bottom: 8px; }
      @keyframes sheet-ants { to { background-position: 16px 0, -16px 100%, 0 -16px, 100% 16px; } }
      .sheet-ants {
        background-image: linear-gradient(90deg, #ff7600 50%, transparent 50%), linear-gradient(90deg, #ff7600 50%, transparent 50%),
                          linear-gradient(0deg, #ff7600 50%, transparent 50%), linear-gradient(0deg, #ff7600 50%, transparent 50%);
        background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
        background-size: 8px 2px, 8px 2px, 2px 8px, 2px 8px;
        background-position: 0 0, 0 100%, 0 0, 100% 0;
        animation: sheet-ants 0.6s linear infinite;
      }
    `}} />
  );
};

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------
interface RowProps {
  act: any;
  index: number;
  label: React.ReactNode;
  isActiveRow: boolean;
  editingCol: number;
  editor: React.ReactNode;
  activities: TimelineActivity[];
  canDragRows: boolean;
  onCellMouseDown: (e: React.MouseEvent, r: number, c: number) => void;
  onCellDoubleClick: (r: number, c: number) => void;
  onStatusArrow: (e: React.MouseEvent, r: number, c: number) => void;
  onRowHeadMouseDown: (e: React.MouseEvent, r: number) => void;
  onRowGripMouseDown: (e: React.MouseEvent, r: number) => void;
  onContextMenu: (e: React.MouseEvent, r: number, c: number) => void;
  onDelete: (r: number) => void;
}

const ActivityRow = React.memo(function ActivityRow(p: RowProps) {
  const { act, index } = p;
  const isAcrRow = !!act._acrType && act._acrType !== 'normal';
  const isReadOnly = act._acrType === 'original-for-update' || act._acrType === 'proposed-delete';
  const originalAct = act._acrType === 'proposed-update' && act._originalIndex >= 0 ? p.activities[act._originalIndex] : null;

  let rowClass = 'group border-b border-qb-box-bg relative ';
  if (act._acrType === 'proposed-add') rowClass += 'bg-[#51b53e]/5 border-l-4 border-l-[#51b53e] opacity-95 text-qb-black ';
  else if (act._acrType === 'proposed-update') rowClass += 'bg-[#ff7600]/5 text-qb-black ';
  else if (act._acrType === 'original-for-update') rowClass += 'bg-slate-200/30 opacity-50 line-through italic text-qb-grey ';
  else if (act._acrType === 'proposed-delete') rowClass += 'bg-[#c11c4d]/5 border-l-4 border-l-[#c11c4d] text-[#c11c4d]/80 line-through decoration-[#c11c4d] ';
  else rowClass += 'bg-transparent hover:bg-black/[0.03] ';

  return (
    <tr
      data-acr-change-id={act._changeId}
      data-acr-type={act._acrType}
      data-row={index}
      className={rowClass}
      onMouseEnter={() => { if (act._changeId) useAcrStore.getState().setActiveAcrChangeId(act._changeId); }}
      onMouseLeave={() => {
        if (act._changeId && useAcrStore.getState().activeAcrChangeId === act._changeId) useAcrStore.getState().setActiveAcrChangeId(null);
      }}
    >
      <td
        data-rowhead={index}
        className={`w-10 min-w-[40px] border-r border-qb-box-bg cursor-pointer relative group/rowhandle sticky left-0 z-20 bg-qb-bg select-none ${p.isActiveRow ? 'font-bold text-qb-orange' : 'text-qb-grey'}`}
        style={{ height: ROW_H }}
        onMouseDown={(e) => p.onRowHeadMouseDown(e, index)}
        onContextMenu={(e) => p.onContextMenu(e, index, -1)}
      >
        {p.isActiveRow && <div className="absolute inset-0 bg-qb-light-grey/30 pointer-events-none" />}
        <div className={`absolute inset-0 flex items-center justify-center font-mono text-[10px] ${p.canDragRows ? 'group-hover/rowhandle:opacity-0' : ''}`}>
          {p.label}
        </div>
        {p.canDragRows && (
          <div
            className="text-qb-orange cursor-grab active:cursor-grabbing absolute inset-0 flex items-center justify-center opacity-0 group-hover/rowhandle:opacity-100"
            onMouseDown={(e) => { if (!e.shiftKey) { e.stopPropagation(); p.onRowGripMouseDown(e, index); } }}
            title="Click to select the row. Drag selected rows to move them."
          >
            <GripVertical className="w-3 h-3" />
          </div>
        )}
      </td>
      {COLUMNS.map((col, c) => {
        const raw = act[col.key];
        const isEditing = p.editingCol === c;
        const text = displayText(raw, col);
        const isErr = isErrorText(raw);
        const isModified = !!(originalAct && !acrValuesEqual(act[col.key], originalAct[col.key]));
        const formula = act.formulas?.[col.key];
        let title: string | undefined;
        if (isModified) title = `Original: ${originalAct[col.key] !== undefined && originalAct[col.key] !== '' ? displayText(originalAct[col.key], col) : '(Empty)'}`;
        else if (isErr) title = `${raw}: ${ERROR_HELP[raw] ?? ''}${formula ? `\n${formula}` : ''}`;
        else if (col.type !== 'date' && text.length > 18) title = text;

        let inner: React.ReactNode = text;
        if (col.key === 'status' && !isErr) {
          inner = (
            <div className="flex items-center gap-2 w-full">
              {text && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[text] || 'var(--color-qb-black)' }} />}
              <span style={{ color: STATUS_COLORS[text] || 'inherit' }} className="font-bold truncate flex-1">{text}</span>
              {!isReadOnly && (
                <span
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-qb-grey flex-shrink-0 cursor-pointer"
                  onMouseDown={(e) => p.onStatusArrow(e, index, c)}
                >
                  <ChevronDown className="w-3 h-3" />
                </span>
              )}
            </div>
          );
        }
        const align = (col.type === 'number' || col.type === 'percent') && !isErr ? 'justify-end' : '';
        let content = (
          <div
            className={`w-full h-full flex items-center px-3 overflow-hidden ${align} ${isErr ? 'text-qb-magenta font-bold font-mono text-[11px]' : ''}`}
            style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
          >
            {inner}
          </div>
        );
        if (col.type === 'date' && raw && !isErr && !isEditing) {
          content = <DateVisualizer date={raw} className="w-full h-full">{content}</DateVisualizer>;
        }

        let cellClass = 'sheet-cell relative border-r border-qb-box-bg text-xs ';
        if (isModified) cellClass += 'bg-[#ff7600]/20 text-qb-orange font-bold border-2 border-qb-orange/30 ';
        return (
          <td
            key={col.id}
            data-cell={`${index}:${c}`}
            className={cellClass}
            style={{ height: ROW_H, zIndex: isEditing ? 30 : undefined }}
            title={isEditing ? undefined : title}
            onMouseDown={(e) => p.onCellMouseDown(e, index, c)}
            onDoubleClick={() => p.onCellDoubleClick(index, c)}
            onContextMenu={(e) => p.onContextMenu(e, index, c)}
          >
            <div className="absolute inset-0 w-full h-full">{isEditing && p.editor ? p.editor : content}</div>
          </td>
        );
      })}
      <td className="w-12 px-2 text-center" style={{ height: ROW_H }}>
        {!isAcrRow && (
          <button
            onClick={() => p.onDelete(index)}
            title="Delete row (undo with Cmd+Z)"
            className="text-qb-light-grey hover:text-qb-orange opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center w-full h-full"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        {isAcrRow && <span className="text-[9px] font-mono text-qb-grey/60 uppercase tracking-widest font-bold">PROPOSAL</span>}
      </td>
    </tr>
  );
});

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------
const NO_HOLIDAYS: string[] = [];

export default function ActivityTable({ projectId, revision }: { projectId: string; revision: Revision }) {
  const setActivities = useTimelineStore(s => s.setActivities);
  const setHolidays = useTimelineStore(s => s.setHolidays);
  const holidays = useTimelineStore(s => s.projectTimelines.find(p => p.projectId === projectId)?.holidays) || NO_HOLIDAYS;
  const activeAcrId = useAcrStore(state => state.activeAcrId);
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));
  // A proposed change to the holiday list shows on the Holidays button and in
  // its list, like every other proposal shows where it applies.
  const holidayChange = acr?.changes.find(c => c.name === 'setTimelineHolidays') || null;
  const proposedHolidays = React.useMemo(
    () => (holidayChange ? normalizeHolidayList(holidayChange.args?.holidays).dates : null),
    [holidayChange],
  );
  H.useSheetHistory(s => s.version);
  const columnWidths = useAppStore(state => state.timelineColumnWidths);
  const setColumnWidth = useAppStore(state => state.setTimelineColumnWidth);

  const acts = revision.activities;
  const revKey = `${projectId}::${revision.id}`;

  // Rows on screen: the sheet, with any open proposal shown in place.
  const view = useMemo(() => {
    const result: any[] = [];
    acts.forEach((act, idx) => {
      const updateChange = acr?.changes.find(c => c.name === 'updateTimelineRow' && String(c.args.id) === String(act.id));
      const deleteChange = acr?.changes.find(c => c.name === 'deleteTimelineRow' && String(c.args.id) === String(act.id));
      if (deleteChange) {
        result.push({ ...act, _acrType: 'proposed-delete', _changeId: deleteChange.id, _originalIndex: idx, acrOriginal: act, acrChange: deleteChange, acrApproved: deleteChange.approved !== false, acrDiffs: [] });
      } else if (updateChange) {
        result.push({ ...act, _acrType: 'original-for-update', _changeId: updateChange.id, _originalIndex: idx });
        result.push({
          ...act, ...updateChange.args, id: `acr-update-${updateChange.id}`, _acrType: 'proposed-update', _changeId: updateChange.id, _originalIndex: idx,
          acrOriginal: act, acrChange: updateChange, acrApproved: updateChange.approved !== false,
          acrDiffs: computeAcrDiffs(act, updateChange.args, updateChange.name),
        });
      } else {
        result.push({ ...act, _acrType: 'normal', _originalIndex: idx });
      }
    });
    const addChanges = acr?.changes.filter(c => c.name === 'addTimelineRow') || [];
    addChanges.forEach(chg => {
      const mockAct = {
        id: `acr-add-${chg.id}`,
        phase: chg.args.phase || '', activity: chg.args.activity || '', subActivity: chg.args.subActivity || '',
        weight: Number(chg.args.weight) || 0, progress: Number(chg.args.progress) || 0, status: chg.args.status || 'Planned',
        owner: chg.args.owner || '', targetStartDate: chg.args.targetStartDate || '', targetCompletionDate: chg.args.targetCompletionDate || '',
        actualStartDate: chg.args.actualStartDate || '', actualCompletionDate: chg.args.actualCompletionDate || '', remarks: chg.args.remarks || '',
        formulas: chg.args.formulas,
        _acrType: 'proposed-add', _changeId: chg.id, _originalIndex: -1, acrOriginal: null, acrChange: chg,
        acrApproved: chg.approved !== false, acrDiffs: computeAcrDiffs(null, chg.args, chg.name, { treatAllAsChanged: true }),
      };
      const insertAfterId = chg.args.insertAfterId;
      if (insertAfterId) {
        const afterIdx = result.findIndex(r => String(r.id) === String(insertAfterId) || String(r.id) === `acr-update-${insertAfterId}`);
        if (afterIdx !== -1) { result.splice(afterIdx + 1, 0, mockAct); return; }
      }
      result.push(mockAct);
    });
    return result;
  }, [acts, acr]);
  const V = view.length;

  const realToView = useMemo(() => {
    const m = new Map<number, number>();
    view.forEach((a, i) => {
      if (a._acrType === 'proposed-add' || a._acrType === 'proposed-update') return;
      if (!m.has(a._originalIndex)) m.set(a._originalIndex, i);
    });
    return m;
  }, [view]);

  /** Sheet row of a screen row that the user may change in bulk, or null. */
  const realOf = (r: number): number | null => (view[r]?._acrType === 'normal' ? view[r]._originalIndex : null);
  /** Sheet row a formula ref means for this screen row (proposed rows have none). */
  const refRowOf = (r: number): number | null => {
    const t = view[r]?._acrType;
    return t === 'normal' || t === 'original-for-update' || t === 'proposed-delete' ? view[r]._originalIndex : null;
  };
  const isEditableRow = (r: number) => {
    const t = view[r]?._acrType;
    return t === 'normal' || t === 'proposed-add' || t === 'proposed-update';
  };

  // ---------------------------------------------------------------- state
  const [sel, setSel] = useState<Sel | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [editError, setEditError] = useState<string | null>(null);
  const [hl, setHl] = useState(-1);
  const [pointSpan, setPointSpan] = useState<{ start: number; end: number; pos: Pos; anchor: Pos } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showHolidays, setShowHolidays] = useState(false);
  // Focusing the holiday proposal in the review panel opens the list it changes.
  const focusedAcrChangeId = useAcrStore(state => state.activeAcrChangeId);
  useEffect(() => {
    if (holidayChange && focusedAcrChangeId === holidayChange.id) setShowHolidays(true);
  }, [focusedAcrChangeId, holidayChange?.id]);
  const [notice, setNotice] = useState<string | null>(null);
  const [nameBox, setNameBox] = useState<string | null>(null);
  const [resizingCol, setResizingCol] = useState<{ id: string; startX: number; startWidth: number } | null>(null);
  const [scrollTo, setScrollTo] = useState<Pos | null>(null);
  const [geo, setGeo] = useState<any>({});

  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const barInputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastPt = useRef({ x: 0, y: 0 });
  const editRef = useRef<Edit | null>(null);
  editRef.current = edit;

  // A new baseline or project starts clean.
  useEffect(() => { setSel(null); setEdit(null); setClip(null); }, [revKey]);
  // Keep the selection inside the table when rows go away.
  useEffect(() => {
    if (!sel) return;
    if (V === 0) { setSel(null); return; }
    const fix = (p: Pos) => ({ r: clamp(p.r, 0, V - 1), c: clamp(p.c, 0, C - 1) });
    if (sel.anchor.r >= V || sel.focus.r >= V) setSel({ anchor: fix(sel.anchor), focus: fix(sel.focus) });
  }, [V]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const close = () => { setMenu(null); setShowHolidays(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });
  const activeInput = () => (edit?.origin === 'bar' ? barInputRef.current : cellInputRef.current);
  const selSnap = (): H.SelectionSnapshot | null => (sel ? { anchor: sel.anchor, focus: sel.focus } : null);

  // ---------------------------------------------------------------- writes
  const record = (label: string, next: TimelineActivity[], selAfter?: Sel | null) => {
    H.recordStep(projectId, revision.id, label, () => setActivities(projectId, revision.id, next), selSnap(), selAfter ?? selSnap());
  };

  const cellData = (rr: number, c: number, base: TimelineActivity[] = acts): Seed => {
    const a: any = base[rr];
    const col = COLUMNS[c];
    const f = a?.formulas?.[col.key];
    return { value: a?.[col.key], formula: isFormulaText(f) ? f : undefined };
  };

  type Change = { r: number; c: number; value: any; formula?: string | null };
  const applyChanges = (changes: Change[], label: string, selAfter?: Sel | null, base: TimelineActivity[] = acts) => {
    if (!changes.length && base === acts) return;
    const next = [...base];
    const touched = new Map<number, any>();
    for (const ch of changes) {
      let row = touched.get(ch.r);
      if (!row) { row = { ...next[ch.r], formulas: { ...(next[ch.r].formulas || {}) } }; touched.set(ch.r, row); }
      const key = COLUMNS[ch.c].key;
      row[key] = ch.value;
      if (ch.formula) row.formulas[key] = ch.formula; else delete row.formulas[key];
    }
    touched.forEach((row, r) => {
      if (!Object.keys(row.formulas).length) delete row.formulas;
      next[r] = row;
    });
    record(label, next, selAfter);
    if (selAfter) setSel(selAfter);
  };

  const blankRow = (): TimelineActivity => ({
    id: crypto.randomUUID(), phase: '', activity: '', subActivity: '', weight: 0, progress: 0,
    status: 'Planned', owner: '', targetStartDate: '', targetCompletionDate: '',
    actualStartDate: '', actualCompletionDate: '', remarks: '',
  });

  // ---------------------------------------------------------------- selection
  const selectCell = (p: Pos, extend = false) => {
    if (V === 0) return;
    const q = { r: clamp(p.r, 0, V - 1), c: clamp(p.c, 0, C - 1) };
    setSel(s => (extend && s ? { anchor: s.anchor, focus: q } : { anchor: q, focus: q }));
    setScrollTo(q);
  };
  const selectRect = (rc: Rect) => setSel({ anchor: { r: rc.r1, c: rc.c1 }, focus: { r: rc.r2, c: rc.c2 } });

  const filled = (r: number, c: number) => {
    const v = view[r]?.[COLUMNS[c].key];
    return !(v === undefined || v === null || v === '');
  };
  /** Cmd/Ctrl + arrow: to the edge of the block of filled cells, as in Excel. */
  const jump = (from: Pos, dr: number, dc: number): Pos => {
    const ok = (p: Pos) => p.r >= 0 && p.r < V && p.c >= 0 && p.c < C;
    let cur = from;
    let nxt = { r: cur.r + dr, c: cur.c + dc };
    if (!ok(nxt)) return from;
    if (filled(cur.r, cur.c) && filled(nxt.r, nxt.c)) {
      while (ok(nxt) && filled(nxt.r, nxt.c)) { cur = nxt; nxt = { r: cur.r + dr, c: cur.c + dc }; }
      return cur;
    }
    cur = nxt;
    nxt = { r: cur.r + dr, c: cur.c + dc };
    while (ok(nxt) && !filled(cur.r, cur.c)) { cur = nxt; nxt = { r: cur.r + dr, c: cur.c + dc }; }
    return cur;
  };

  const a1 = (r: number, c: number) => {
    const rr = refRowOf(r);
    return rr === null ? null : `${colLetter(c)}${rr + 1}`;
  };

  // ---------------------------------------------------------------- editing
  const startEdit = (mode: Edit['mode'], initial?: string, origin: Edit['origin'] = 'cell', openList = false, at?: Pos) => {
    const pos = at ?? sel?.anchor;
    if (!pos || !isEditableRow(pos.r)) return;
    const act = view[pos.r];
    const col = COLUMNS[pos.c];
    const init = editText(act, col);
    const d = initial ?? init;
    setEdit({ r: pos.r, c: pos.c, mode, origin, initial: init, openList });
    setDraft(d);
    setCaret(d.length);
    pendingCaret.current = d.length;
    setEditError(null);
    setPointSpan(null);
    setHl(-1);
    if (clip && !clip.cut) setClip(null);
  };

  const endEdit = () => {
    setEdit(null);
    setEditError(null);
    setPointSpan(null);
    focusGrid();
  };
  const cancelEdit = () => endEdit();

  /** A proposed row lives in the change request, not in the sheet. */
  const commitAcrCell = (act: any, viewR: number, c: number, text: string): boolean => {
    const col = COLUMNS[c];
    const parsed = parseInput(col, text);
    if (parsed.invalid) { setEditError(parsed.invalid); return false; }
    let value = parsed.value;
    const formulas = { ...(act.formulas || {}) };
    if (parsed.formula) {
      formulas[col.key] = parsed.formula;
      const thisRow = act._originalIndex >= 0 ? act._originalIndex : null;
      value = evaluateFormulaAt(parsed.formula, acts, thisRow, c, holidays, act).stored;
    } else delete formulas[col.key];
    const updates: any = { [col.key]: value };
    if (parsed.formula || act.formulas?.[col.key]) updates.formulas = formulas;
    const change = acr?.changes.find(ch => ch.id === act._changeId);
    if (change && activeAcrId) useAcrStore.getState().updateAcrChange(activeAcrId, act._changeId, { args: { ...change.args, ...updates } });
    return true;
  };

  /** Save what is typed. False when the text does not fit the column (the editor stays open). */
  const commitEdit = (opts: { all?: boolean; text?: string } = {}): boolean => {
    const e = editRef.current;
    if (!e) return true;
    const text = opts.text ?? draft;
    const act = view[e.r];
    const col = COLUMNS[e.c];
    if (!act || (text === e.initial && !opts.all)) { endEdit(); return true; }
    if (act._acrType === 'proposed-add' || act._acrType === 'proposed-update') {
      if (!commitAcrCell(act, e.r, e.c, text)) return false;
      endEdit();
      return true;
    }
    const real = realOf(e.r);
    if (real === null) { endEdit(); return true; }
    const parsed = parseInput(col, text);
    if (parsed.invalid) { setEditError(parsed.invalid); return false; }
    const changes: Change[] = [];
    if (opts.all && sel) {
      const rc = rectOf(sel);
      for (let vr = rc.r1; vr <= rc.r2; vr++) {
        const rr = realOf(vr);
        if (rr === null) continue;
        for (let c = rc.c1; c <= rc.c2; c++) {
          const tc = COLUMNS[c];
          if (parsed.formula) {
            changes.push({ r: rr, c, value: (acts[rr] as any)[tc.key], formula: shiftFormula(parsed.formula, rr - real, c - e.c) });
          } else {
            const p2 = parseInput(tc, text);
            if (!p2.invalid) changes.push({ r: rr, c, value: p2.value, formula: null });
          }
        }
      }
    } else {
      changes.push({ r: real, c: e.c, value: parsed.formula ? (acts[real] as any)[col.key] : parsed.value, formula: parsed.formula ?? null });
    }
    applyChanges(changes, parsed.formula ? 'Enter formula' : opts.all ? 'Fill selection' : 'Edit cell');
    endEdit();
    return true;
  };

  const onEditorBlur = () => {
    setTimeout(() => {
      if (!editRef.current) return;
      const ae = document.activeElement;
      if (ae === cellInputRef.current || ae === barInputRef.current) return;
      if (ae && gridRef.current?.contains(ae)) return;
      if (!commitEdit()) cancelEdit();
    }, 0);
  };

  const onDraftChange = (value: string, pos: number | null) => {
    setDraft(value);
    setCaret(pos ?? value.length);
    setPointSpan(null);
    setHl(-1);
    setEditError(null);
  };

  /** Point mode: after "=", "(", "," or an operator, the arrows and the mouse pick a cell. */
  const canPoint = (text: string, pos: number) => {
    if (!text.startsWith('=')) return false;
    if (pointSpan && pos === pointSpan.end) return true;
    const before = text.slice(0, pos).trimEnd();
    return '=(,;+-*/^&<>:'.includes(before[before.length - 1] ?? '');
  };

  const insertPointRef = (from: Pos, to: Pos, caretPos?: number) => {
    const r1 = Math.min(from.r, to.r), r2 = Math.max(from.r, to.r);
    const c1 = Math.min(from.c, to.c), c2 = Math.max(from.c, to.c);
    const t1 = a1(r1, c1), t2 = a1(r2, c2);
    if (!t1 || !t2) return;
    const ref = t1 === t2 ? t1 : `${t1}:${t2}`;
    const pos = caretPos ?? activeInput()?.selectionStart ?? draft.length;
    const start = pointSpan ? pointSpan.start : pos;
    const end = pointSpan ? pointSpan.end : pos;
    const next = draft.slice(0, start) + ref + draft.slice(end);
    setDraft(next);
    setPointSpan({ start, end: start + ref.length, pos: to, anchor: from });
    pendingCaret.current = start + ref.length;
  };

  const pointMove = (dr: number, dc: number, extend: boolean) => {
    if (!edit) return;
    const base = pointSpan ? pointSpan.pos : { r: edit.r, c: edit.c };
    const np = { r: clamp(base.r + dr, 0, V - 1), c: clamp(base.c + dc, 0, C - 1) };
    const from = extend ? (pointSpan?.anchor ?? base) : np;
    insertPointRef(from, np);
  };

  // ---------------------------------------------------------------- hint under the editor
  const hintInfo = useMemo((): { state: HintState; kind: 'func' | 'status' | null; replace?: { start: number; end: number } } => {
    const empty = { state: { list: [], highlighted: 0, error: editError }, kind: null as any };
    if (!edit) return empty;
    const col = COLUMNS[edit.c];
    const act = view[edit.r];
    if (!act) return empty;
    if (draft.startsWith('=')) {
      const upto = draft.slice(0, caret);
      const toks = tokenize(upto);
      const last = toks[toks.length - 1];
      let list: HintState['list'] = [];
      let replace: { start: number; end: number } | undefined;
      if (last && (last.type === 'name' || last.type === 'ref') && last.end === upto.length && /^[A-Za-z]/.test(last.text)) {
        const prefix = last.text.toUpperCase();
        list = ALL_FUNCTIONS.filter(n => n.startsWith(prefix) && n !== prefix).slice(0, 8)
          .map(n => ({ label: n, detail: FUNCTION_HELP[n]?.sig }));
        replace = { start: last.start, end: last.end };
      }
      const stack: { name: string | null; arg: number }[] = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.type === 'func' && toks[i + 1]?.type === 'lp') { stack.push({ name: t.value, arg: 0 }); i++; }
        else if (t.type === 'lp') stack.push({ name: null, arg: 0 });
        else if (t.type === 'sep' && stack.length) stack[stack.length - 1].arg++;
        else if (t.type === 'rp') stack.pop();
      }
      const top = stack.length ? stack[stack.length - 1] : null;
      let signature: HintState['signature'];
      const help = top?.name ? FUNCTION_HELP[top.name] : undefined;
      if (help) {
        const open = help.sig.indexOf('(');
        const args = help.sig.slice(open + 1, -1).split(', ');
        const idx = Math.min(top!.arg, args.length - 1);
        signature = {
          before: help.sig.slice(0, open + 1) + args.slice(0, idx).join(', ') + (idx ? ', ' : ''),
          current: args[idx] ?? '',
          after: (idx < args.length - 1 ? ', ' + args.slice(idx + 1).join(', ') : '') + ')',
          help: help.help,
        };
      }
      let preview: HintState['preview'];
      if (draft.length > 1) {
        const thisRow = act._originalIndex >= 0 ? act._originalIndex : null;
        const virtual = act._acrType === 'normal' ? undefined : act;
        const res = evaluateFormulaAt(draft, acts, thisRow, edit.c, holidays, virtual);
        preview = res.error
          ? { text: `${res.error}  ${ERROR_HELP[res.error] ?? ''}`, bad: true }
          : { text: `= ${displayText(res.stored, col) || '(empty)'}`, bad: false };
      }
      return { state: { list, highlighted: clamp(hl, 0, Math.max(0, list.length - 1)), signature, preview, error: editError }, kind: list.length ? 'func' : null, replace };
    }
    if (col.type === 'select') {
      const opts = col.options ?? [];
      const q = draft.trim().toLowerCase();
      const list = (edit.openList && draft === edit.initial) || !q ? opts : opts.filter(o => o.toLowerCase().includes(q));
      const own = list.indexOf(draft);
      const highlighted = hl < 0 ? Math.max(0, own) : clamp(hl, 0, list.length - 1);
      return { state: { list: list.map(o => ({ label: o })), highlighted, error: editError }, kind: 'status' };
    }
    let preview: HintState['preview'];
    if (col.type === 'date' && draft.trim()) {
      const s = D.parseDateText(draft);
      preview = s !== null
        ? { text: `${D.DAY_LONG[D.dayOfWeek(s)]}, ${D.formatDateCell(D.serialToIso(s))}`, bad: false }
        : { text: 'Not a date yet. Type it day first, like 05/06/2026.', bad: true };
    }
    return { state: { list: [], highlighted: 0, preview, error: editError }, kind: null };
  }, [edit, draft, caret, hl, acts, view, holidays, editError]);

  const pickHint = (i: number) => {
    if (!edit) return;
    const item = hintInfo.state.list[i];
    if (!item) return;
    if (hintInfo.kind === 'status') {
      const e = edit;
      if (commitEdit({ text: item.label })) selectCell({ r: e.r + 1, c: e.c });
      return;
    }
    if (hintInfo.kind === 'func' && hintInfo.replace) {
      const { start, end } = hintInfo.replace;
      const insert = `${item.label}(`;
      const next = draft.slice(0, start) + insert + draft.slice(end);
      setDraft(next);
      pendingCaret.current = start + insert.length;
      setHl(-1);
    }
  };

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (!edit) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const list = hintInfo.state.list;
    const multi = !!sel && (sel.anchor.r !== sel.focus.r || sel.anchor.c !== sel.focus.c);
    if (list.length && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault();
      const cur = hintInfo.state.highlighted;
      setHl((cur + (k === 'ArrowDown' ? 1 : -1) + list.length) % list.length);
      return;
    }
    if (list.length && hintInfo.kind === 'func' && k === 'Tab') { e.preventDefault(); pickHint(hintInfo.state.highlighted); return; }
    const statusPick = hintInfo.kind === 'status' && list.length && draft.trim() !== '' ? list[hintInfo.state.highlighted]?.label : undefined;
    if (k === 'Enter') {
      e.preventDefault();
      const ed = edit;
      const all = mod && multi;
      if (commitEdit({ all, text: statusPick })) {
        if (!all) selectCell({ r: ed.r + (e.shiftKey ? -1 : 1), c: ed.c });
      }
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      const ed = edit;
      if (commitEdit({ text: statusPick })) selectCell({ r: ed.r, c: ed.c + (e.shiftKey ? -1 : 1) });
      return;
    }
    if (k === 'Escape') { e.preventDefault(); cancelEdit(); return; }
    if (k === 'F2') { e.preventDefault(); setEdit({ ...edit, mode: edit.mode === 'enter' ? 'edit' : 'enter' }); return; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k] && !mod) {
      const [dr, dc] = arrows[k];
      const pos = e.currentTarget.selectionStart ?? draft.length;
      if (edit.mode === 'enter' && canPoint(draft, pos)) { e.preventDefault(); pointMove(dr, dc, e.shiftKey); return; }
      if (edit.mode === 'enter' && !e.shiftKey) {
        e.preventDefault();
        const ed = edit;
        if (commitEdit({ text: statusPick })) selectCell({ r: ed.r + dr, c: ed.c + dc });
        return;
      }
      setPointSpan(null);
    }
  };

  // ---------------------------------------------------------------- bulk actions
  /** Screen rows of a rect that are sheet rows, or null when a proposed row is inside. */
  const realRowsOf = (rc: Rect): number[] | null => {
    const out: number[] = [];
    for (let r = rc.r1; r <= rc.r2; r++) {
      const rr = realOf(r);
      if (rr === null) return null;
      out.push(rr);
    }
    return out;
  };
  const onlySheetRows = () => setNotice('That works on sheet rows only. Close the open proposal first, or pick rows without ADD / UPD / DEL marks.');

  const clearSelection = () => {
    if (!sel) return;
    const rc = rectOf(sel);
    const changes: Change[] = [];
    for (let vr = rc.r1; vr <= rc.r2; vr++) {
      const rr = realOf(vr);
      if (rr === null) continue;
      for (let c = rc.c1; c <= rc.c2; c++) {
        const d = cellData(rr, c);
        const empty = emptyValue(COLUMNS[c]);
        if (d.formula || !(d.value === empty || d.value === '' || d.value === undefined || d.value === null)) {
          changes.push({ r: rr, c, value: empty, formula: null });
        }
      }
    }
    if (!changes.length && realOf(sel.anchor.r) === null && isEditableRow(sel.anchor.r)) {
      const act = view[sel.anchor.r];
      commitAcrCell(act, sel.anchor.r, sel.anchor.c, '');
      return;
    }
    applyChanges(changes, 'Clear');
  };

  const applyFill = (src: Rect, target: Rect, alt: boolean) => {
    const rowsT = realRowsOf(target);
    if (!rowsT) { onlySheetRows(); return; }
    const R = (vr: number) => realOf(vr)!;
    const changes: Change[] = [];
    if (target.r1 !== src.r1 || target.r2 !== src.r2) {
      const down = target.r2 > src.r2;
      const count = down ? target.r2 - src.r2 : src.r1 - target.r1;
      for (let c = src.c1; c <= src.c2; c++) {
        const seedRows: number[] = [];
        for (let r = src.r1; r <= src.r2; r++) seedRows.push(R(r));
        if (!down) seedRows.reverse();
        const seeds = seedRows.map(rr => cellData(rr, c));
        planFill(seeds, count, COLUMNS[c], alt, down ? 1 : -1).forEach((o, k) => {
          const tr = R(down ? src.r2 + 1 + k : src.r1 - 1 - k);
          if ('value' in o) { changes.push({ r: tr, c, value: o.value, formula: null }); return; }
          const sd = seeds[o.copyFrom];
          changes.push({ r: tr, c, value: sd.value, formula: sd.formula ? shiftFormula(sd.formula, tr - seedRows[o.copyFrom], 0) : null });
        });
      }
    } else {
      const right = target.c2 > src.c2;
      const count = right ? target.c2 - src.c2 : src.c1 - target.c1;
      for (let vr = src.r1; vr <= src.r2; vr++) {
        const rr = R(vr);
        const seedCols: number[] = [];
        for (let c = src.c1; c <= src.c2; c++) seedCols.push(c);
        if (!right) seedCols.reverse();
        const seeds = seedCols.map(c => cellData(rr, c));
        const lastCol = COLUMNS[seedCols[seedCols.length - 1]];
        planFill(seeds, count, lastCol, alt, right ? 1 : -1).forEach((o, k) => {
          const tc = right ? src.c2 + 1 + k : src.c1 - 1 - k;
          if ('value' in o) {
            const cv = convertValue(o.value, lastCol, COLUMNS[tc]);
            if (cv.ok) changes.push({ r: rr, c: tc, value: cv.value, formula: null });
            return;
          }
          const sc = seedCols[o.copyFrom];
          const sd = seeds[o.copyFrom];
          if (sd.formula) { changes.push({ r: rr, c: tc, value: (acts[rr] as any)[COLUMNS[tc].key], formula: shiftFormula(sd.formula, 0, tc - sc) }); return; }
          const cv = convertValue(sd.value, COLUMNS[sc], COLUMNS[tc]);
          if (cv.ok) changes.push({ r: rr, c: tc, value: cv.value, formula: null });
        });
      }
    }
    applyChanges(changes, 'Fill', { anchor: { r: target.r1, c: target.c1 }, focus: { r: target.r2, c: target.c2 } });
  };

  const fillToEnd = () => {
    if (!sel) return;
    const src = rectOf(sel);
    const adj = src.c1 > 0 ? src.c1 - 1 : src.c2 + 1;
    let end = src.r2;
    while (end + 1 < V && realOf(end + 1) !== null && adj < C && filled(end + 1, adj)) end++;
    if (end === src.r2) {
      while (end + 1 < V && realOf(end + 1) !== null) end++;
    }
    if (end > src.r2) applyFill(src, { ...src, r2: end }, false);
  };

  /** Cmd+D copies the top row of the selection down; Cmd+R the left column right. */
  const fillCopy = (dir: 'down' | 'right') => {
    if (!sel) return;
    const rc = rectOf(sel);
    const changes: Change[] = [];
    if (dir === 'down') {
      const srcV = rc.r1 === rc.r2 ? rc.r1 - 1 : rc.r1;
      const from = rc.r1 === rc.r2 ? rc.r1 : rc.r1 + 1;
      const sr = srcV >= 0 ? realOf(srcV) : null;
      if (sr === null) return;
      for (let vr = from; vr <= rc.r2; vr++) {
        const tr = realOf(vr);
        if (tr === null) continue;
        for (let c = rc.c1; c <= rc.c2; c++) {
          const d = cellData(sr, c);
          changes.push({ r: tr, c, value: d.value, formula: d.formula ? shiftFormula(d.formula, tr - sr, 0) : null });
        }
      }
    } else {
      const srcC = rc.c1 === rc.c2 ? rc.c1 - 1 : rc.c1;
      const from = rc.c1 === rc.c2 ? rc.c1 : rc.c1 + 1;
      if (srcC < 0) return;
      for (let vr = rc.r1; vr <= rc.r2; vr++) {
        const rr = realOf(vr);
        if (rr === null) continue;
        const d = cellData(rr, srcC);
        for (let c = from; c <= rc.c2; c++) {
          if (d.formula) { changes.push({ r: rr, c, value: (acts[rr] as any)[COLUMNS[c].key], formula: shiftFormula(d.formula, 0, c - srcC) }); continue; }
          const cv = convertValue(d.value, COLUMNS[srcC], COLUMNS[c]);
          if (cv.ok) changes.push({ r: rr, c, value: cv.value, formula: null });
        }
      }
    }
    applyChanges(changes, dir === 'down' ? 'Fill down' : 'Fill right');
  };

  /** Move (or copy) a block of cells, as dragging its edge does in Excel. Refs to the cells follow them. */
  const applyMove = (src: Rect, destR: number, destC: number, copy: boolean) => {
    if (activeAcrId) { onlySheetRows(); return; }
    const h = src.r2 - src.r1, w = src.c2 - src.c1;
    destR = clamp(destR, 0, acts.length - 1 - h);
    destC = clamp(destC, 0, C - 1 - w);
    const dr = destR - src.r1, dc = destC - src.c1;
    if (dr === 0 && dc === 0) return;
    const block: Seed[][] = [];
    for (let r = src.r1; r <= src.r2; r++) {
      const row: Seed[] = [];
      for (let c = src.c1; c <= src.c2; c++) row.push(cellData(r, c));
      block.push(row);
    }
    const next: any[] = acts.map(a => ({ ...a, formulas: { ...(a.formulas || {}) } }));
    if (!copy) {
      for (let r = src.r1; r <= src.r2; r++) for (let c = src.c1; c <= src.c2; c++) {
        next[r][COLUMNS[c].key] = emptyValue(COLUMNS[c]);
        delete next[r].formulas[COLUMNS[c].key];
      }
    }
    block.forEach((row, i) => row.forEach((d, j) => {
      const tr = destR + i, tc = destC + j;
      const key = COLUMNS[tc].key;
      if (d.formula) {
        next[tr].formulas[key] = copy ? shiftFormula(d.formula, dr, dc) : d.formula;
      } else {
        delete next[tr].formulas[key];
        const cv = convertValue(d.value, COLUMNS[src.c1 + j], COLUMNS[tc]);
        next[tr][key] = cv.ok ? cv.value : d.value;
      }
    }));
    if (!copy) {
      const dest = { r1: destR, c1: destC, r2: destR + h, c2: destC + w };
      next.forEach(row => {
        for (const k of Object.keys(row.formulas)) row.formulas[k] = followMovedBlock(row.formulas[k], src, dr, dc, dest);
      });
    }
    next.forEach(row => { if (!Object.keys(row.formulas).length) delete row.formulas; });
    const after = { anchor: { r: destR, c: destC }, focus: { r: destR + h, c: destC + w } };
    record(copy ? 'Copy cells' : 'Move cells', next, after);
    setSel(after);
  };

  const applyRowMove = (block: [number, number], insertAt: number | null) => {
    if (insertAt === null || activeAcrId) return;
    const [b1, b2] = block;
    if (insertAt >= b1 && insertAt <= b2 + 1) return;
    const moving = acts.slice(b1, b2 + 1);
    const rest = acts.filter((_, i) => i < b1 || i > b2);
    const at = insertAt > b2 ? insertAt - moving.length : insertAt;
    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    const after = { anchor: { r: at, c: 0 }, focus: { r: at + moving.length - 1, c: C - 1 } };
    record(moving.length > 1 ? `Move ${moving.length} rows` : 'Move row', next, after);
    setSel(after);
  };

  const selectedRealRows = (): number[] => {
    if (!sel) return [];
    const rc = rectOf(sel);
    const out: number[] = [];
    for (let r = rc.r1; r <= rc.r2; r++) { const rr = realOf(r); if (rr !== null) out.push(rr); }
    return out;
  };

  const insertRows = (above: boolean) => {
    const rows = selectedRealRows();
    const count = Math.max(1, rows.length);
    const at = rows.length ? (above ? Math.min(...rows) : Math.max(...rows) + 1) : acts.length;
    const next = [...acts];
    next.splice(at, 0, ...Array.from({ length: count }, blankRow));
    const vr = realToView.get(at) ?? at;
    const after = { anchor: { r: vr, c: 0 }, focus: { r: vr + count - 1, c: C - 1 } };
    record(count > 1 ? `Insert ${count} rows` : 'Insert row', next, after);
    setSel(after);
  };

  const duplicateRows = () => {
    const rows = selectedRealRows();
    if (!rows.length) return;
    const b1 = Math.min(...rows), b2 = Math.max(...rows), n = b2 - b1 + 1;
    const copies = acts.slice(b1, b2 + 1).map(a => {
      const f = a.formulas ? Object.fromEntries(Object.entries(a.formulas).map(([k, v]) => [k, shiftFormula(v, n, 0)])) : undefined;
      return { ...a, id: crypto.randomUUID(), ...(f ? { formulas: f } : {}) };
    });
    const next = [...acts];
    next.splice(b2 + 1, 0, ...copies);
    record(n > 1 ? `Duplicate ${n} rows` : 'Duplicate row', next);
  };

  const deleteRows = (rows: number[]) => {
    if (!rows.length) return;
    const drop = new Set(rows);
    const next = acts.filter((_, i) => !drop.has(i));
    record(rows.length > 1 ? `Delete ${rows.length} rows` : 'Delete row', next);
    setNotice(`${rows.length > 1 ? `${rows.length} rows` : 'Row'} deleted. ${MOD}Z brings ${rows.length > 1 ? 'them' : 'it'} back.`);
  };

  // ---------------------------------------------------------------- undo / redo
  const doUndo = () => {
    if (edit) cancelEdit();
    const s = H.undo(projectId, revision.id);
    if (s === undefined) setNotice('Nothing to undo.');
    else if (s) setSel(s);
  };
  const doRedo = () => {
    if (edit) cancelEdit();
    const s = H.redo(projectId, revision.id);
    if (s === undefined) setNotice('Nothing to redo.');
    else if (s) setSel(s);
  };

  // ---------------------------------------------------------------- clipboard
  const gridHasFocus = () => !!gridRef.current && gridRef.current.contains(document.activeElement) && !editRef.current;

  const buildClip = (cut: boolean): Clip | null => {
    if (!sel) return null;
    const rc = rectOf(sel);
    const texts: string[][] = [];
    for (let r = rc.r1; r <= rc.r2; r++) {
      const row: string[] = [];
      for (let c = rc.c1; c <= rc.c2; c++) row.push(displayText(view[r]?.[COLUMNS[c].key], COLUMNS[c]));
      texts.push(row);
    }
    const text = toTSV(texts);
    const rows = realRowsOf(rc);
    if (!rows) return { rect: rc, cells: [], text, cut: false, revKey: '' };
    const cells = rows.map(rr => Array.from({ length: rc.c2 - rc.c1 + 1 }, (_, j) => ({ ...cellData(rr, rc.c1 + j), col: COLUMNS[rc.c1 + j] })));
    return { rect: { r1: rows[0], c1: rc.c1, r2: rows[rows.length - 1], c2: rc.c2 }, cells, text, cut: cut && !activeAcrId, revKey };
  };

  const pasteArea = (h: number, w: number) => {
    const rc = rectOf(sel!);
    const sh = rc.r2 - rc.r1 + 1, sw = rc.c2 - rc.c1 + 1;
    const tile = sh % h === 0 && sw % w === 0 && (sh > h || sw > w);
    return { r1: rc.r1, c1: rc.c1, rows: tile ? sh : h, cols: Math.min(tile ? sw : w, C - rc.c1) };
  };

  /** Sheet rows for a paste, adding rows at the end when it runs past the last row. */
  const pasteRows = (r1: number, rows: number): { base: TimelineActivity[]; reals: (number | null)[] } => {
    let base = acts;
    const reals: (number | null)[] = [];
    for (let i = 0; i < rows; i++) {
      const vr = r1 + i;
      if (vr < V) reals.push(realOf(vr));
      else if (!activeAcrId) { base = [...base, blankRow()]; reals.push(base.length - 1); }
      else reals.push(null);
    }
    return { base, reals };
  };

  const pasteInternal = (cb: Clip) => {
    if (cb.cut && cb.revKey === revKey) {
      const dest = sel!.anchor;
      const dr = realOf(dest.r);
      if (dr === null) { onlySheetRows(); return; }
      applyMove(cb.rect, dr, dest.c, false);
      setClip(null);
      return;
    }
    const h = cb.cells.length, w = cb.cells[0].length;
    const area = pasteArea(h, w);
    const { base, reals } = pasteRows(area.r1, area.rows);
    const changes: Change[] = [];
    reals.forEach((tr, i) => {
      if (tr === null) return;
      for (let j = 0; j < area.cols; j++) {
        const tc = area.c1 + j;
        const d = cb.cells[i % h][j % w];
        if (d.formula) {
          changes.push({ r: tr, c: tc, value: (base[tr] as any)[COLUMNS[tc].key], formula: shiftFormula(d.formula, tr - (cb.rect.r1 + (i % h)), tc - (cb.rect.c1 + (j % w))) });
        } else {
          const cv = convertValue(d.value, d.col, COLUMNS[tc]);
          if (cv.ok) changes.push({ r: tr, c: tc, value: cv.value, formula: null });
        }
      }
    });
    const after = { anchor: { r: area.r1, c: area.c1 }, focus: { r: area.r1 + area.rows - 1, c: area.c1 + area.cols - 1 } };
    applyChanges(changes, 'Paste', after, base);
  };

  const pasteText = (text: string) => {
    const grid = parseTSV(text);
    if (!grid.length) return;
    const h = grid.length, w = Math.max(...grid.map(r => r.length));
    const area = pasteArea(h, w);
    const { base, reals } = pasteRows(area.r1, area.rows);
    const changes: Change[] = [];
    let skipped = 0;
    reals.forEach((tr, i) => {
      if (tr === null) return;
      for (let j = 0; j < area.cols; j++) {
        const tc = area.c1 + j;
        const p = parseInput(COLUMNS[tc], grid[i % h][j % w] ?? '');
        if (p.invalid) { skipped++; continue; }
        changes.push({ r: tr, c: tc, value: p.formula ? (base[tr] as any)[COLUMNS[tc].key] : p.value, formula: p.formula ?? null });
      }
    });
    const after = { anchor: { r: area.r1, c: area.c1 }, focus: { r: area.r1 + area.rows - 1, c: area.c1 + area.cols - 1 } };
    applyChanges(changes, 'Paste', after, base);
    if (skipped) setNotice(`${skipped} cell${skipped > 1 ? 's were' : ' was'} not pasted: the text does not fit the column (for example, text in a date column).`);
  };

  const doPaste = (text: string) => {
    if (!sel) return;
    const norm = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n$/, '');
    if (clip && clip.cells.length && norm(text) === norm(clip.text)) pasteInternal(clip);
    else pasteText(text);
  };

  const onCopyEvt = useEvent((e: ClipboardEvent, cut: boolean) => {
    if (!gridHasFocus() || !sel) return;
    const cb = buildClip(cut);
    if (!cb) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', cb.text);
    setClip(cb);
  });
  const onPasteEvt = useEvent((e: ClipboardEvent) => {
    if (!gridHasFocus() || !sel) return;
    e.preventDefault();
    doPaste(e.clipboardData?.getData('text/plain') ?? '');
  });
  useEffect(() => {
    const copy = (e: ClipboardEvent) => onCopyEvt(e, false);
    const cut = (e: ClipboardEvent) => onCopyEvt(e, true);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', onPasteEvt);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', onPasteEvt);
    };
  }, [onCopyEvt, onPasteEvt]);

  // ---------------------------------------------------------------- keys on the grid
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (edit || e.target !== gridRef.current) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); doRedo(); return; }
    if (V === 0) return;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (!sel) {
      if (arrows[k] || k === 'Tab' || k === 'Enter') { e.preventDefault(); selectCell({ r: 0, c: 0 }); }
      return;
    }
    const { anchor, focus } = sel;
    if (arrows[k]) {
      e.preventDefault();
      const [dr, dc] = arrows[k];
      const from = e.shiftKey ? focus : anchor;
      const to = mod ? jump(from, dr, dc) : { r: from.r + dr, c: from.c + dc };
      selectCell(to, e.shiftKey);
      return;
    }
    switch (k) {
      case 'Tab': e.preventDefault(); selectCell({ r: anchor.r, c: anchor.c + (e.shiftKey ? -1 : 1) }); return;
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) selectCell({ r: anchor.r - 1, c: anchor.c });
        else startEdit('edit');
        return;
      case 'F2': e.preventDefault(); startEdit('edit'); return;
      case 'Escape': setClip(null); setMenu(null); return;
      case 'Backspace':
      case 'Delete': e.preventDefault(); clearSelection(); return;
      case 'Home': e.preventDefault(); selectCell(mod ? { r: 0, c: 0 } : { r: (e.shiftKey ? focus : anchor).r, c: 0 }, e.shiftKey); return;
      case 'End': e.preventDefault(); selectCell(mod ? { r: V - 1, c: C - 1 } : { r: (e.shiftKey ? focus : anchor).r, c: C - 1 }, e.shiftKey); return;
      case 'PageDown': e.preventDefault(); selectCell({ r: (e.shiftKey ? focus : anchor).r + 10, c: (e.shiftKey ? focus : anchor).c }, e.shiftKey); return;
      case 'PageUp': e.preventDefault(); selectCell({ r: (e.shiftKey ? focus : anchor).r - 10, c: (e.shiftKey ? focus : anchor).c }, e.shiftKey); return;
    }
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 'a') { e.preventDefault(); selectRect({ r1: 0, c1: 0, r2: V - 1, c2: C - 1 }); return; }
      if (lk === 'd') { e.preventDefault(); fillCopy('down'); return; }
      if (lk === 'r') { e.preventDefault(); fillCopy('right'); return; }
      if (k === ';') { e.preventDefault(); startEdit('enter', D.formatDateEdit(D.serialToIso(D.todaySerial()))); return; }
      return; // Cmd+C / X / V go to the clipboard events
    }
    if (k.length === 1) {
      // Typing replaces the cell, as in Excel. (Option + key gives a special character on a Mac.)
      e.preventDefault();
      startEdit('enter', k);
    }
  };

  // ---------------------------------------------------------------- mouse
  const hitTest = (x: number, y: number): { cell?: Pos; row?: number; col?: number } | null => {
    const sc = scrollerRef.current;
    if (!sc) return null;
    const rc = sc.getBoundingClientRect();
    const cx = clamp(x, rc.left + 44, rc.right - 6);
    const cy = clamp(y, rc.top + ROW_H + 2, rc.bottom - 6);
    const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
    if (!el) return null;
    const cellEl = el.closest('[data-cell]') as HTMLElement | null;
    if (cellEl) {
      const [r, c] = cellEl.dataset.cell!.split(':').map(Number);
      return { cell: { r, c }, row: r, col: c };
    }
    const rh = el.closest('[data-rowhead]') as HTMLElement | null;
    if (rh) { const r = Number(rh.dataset.rowhead); return { row: r, cell: { r, c: 0 } }; }
    const ch = el.closest('[data-colhead]') as HTMLElement | null;
    if (ch) return { col: Number(ch.dataset.colhead) };
    return null;
  };

  const fillTarget = (src: Rect, cell: Pos): Rect | null => {
    if (inRect(src, cell.r, cell.c)) return null;
    const dDown = cell.r - src.r2, dUp = src.r1 - cell.r, dRight = cell.c - src.c2, dLeft = src.c1 - cell.c;
    const v = Math.max(dDown, dUp, 0), h = Math.max(dRight, dLeft, 0);
    if (v >= h) return dDown > 0 ? { ...src, r2: cell.r } : { ...src, r1: cell.r };
    return dRight > 0 ? { ...src, c2: cell.c } : { ...src, c1: cell.c };
  };

  const setDragBoth = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  const updateDrag = useEvent(() => {
    const d = dragRef.current;
    if (!d) return;
    const hit = hitTest(lastPt.current.x, lastPt.current.y);
    if (!hit) return;
    switch (d.kind) {
      case 'select':
        if (hit.cell) setSel(s => (s ? { anchor: s.anchor, focus: hit.cell! } : s));
        break;
      case 'rowselect':
        if (hit.row !== undefined) setSel({ anchor: { r: d.anchorRow, c: 0 }, focus: { r: hit.row, c: C - 1 } });
        break;
      case 'colselect':
        if (hit.col !== undefined) setSel({ anchor: { r: 0, c: d.anchorCol }, focus: { r: V - 1, c: hit.col } });
        break;
      case 'fill':
        if (hit.cell) setDragBoth({ ...d, target: fillTarget(d.src, hit.cell) });
        break;
      case 'move':
        if (hit.cell) {
          const h = d.src.r2 - d.src.r1, w = d.src.c2 - d.src.c1;
          setDragBoth({ ...d, dest: { r: clamp(hit.cell.r - d.grab.r, 0, V - 1 - h), c: clamp(hit.cell.c - d.grab.c, 0, C - 1 - w) } });
        }
        break;
      case 'rowmove': {
        const r = hit.row;
        if (r === undefined) break;
        const tr = gridRef.current?.querySelector(`tr[data-row="${r}"]`);
        if (!tr) break;
        const b = tr.getBoundingClientRect();
        setDragBoth({ ...d, insertAt: lastPt.current.y < b.top + b.height / 2 ? r : r + 1 });
        break;
      }
      case 'point':
        if (hit.cell) insertPointRef(d.start, hit.cell);
        break;
    }
  });

  const onWindowMove = useEvent((e: MouseEvent) => { lastPt.current = { x: e.clientX, y: e.clientY }; updateDrag(); });
  const onWindowUp = useEvent((e: MouseEvent) => {
    const d = dragRef.current;
    setDragBoth(null);
    window.removeEventListener('mousemove', onWindowMove);
    window.removeEventListener('mouseup', onWindowUp);
    if (!d) return;
    if (d.kind === 'fill' && d.target) applyFill(d.src, d.target, e.altKey);
    else if (d.kind === 'move' && d.dest) {
      const rows = realRowsOf(d.src);
      const dr = realOf(d.dest.r);
      if (rows && dr !== null) applyMove({ r1: rows[0], c1: d.src.c1, r2: rows[rows.length - 1], c2: d.src.c2 }, dr, d.dest.c, e.altKey);
    } else if (d.kind === 'rowmove') {
      if (d.insertAt === null) setSel({ anchor: { r: d.clickRow, c: 0 }, focus: { r: d.clickRow, c: C - 1 } });
      else applyRowMove(d.block, d.insertAt);
    }
    else if (d.kind === 'point') activeInput()?.focus();
  });

  const beginDrag = (d: Drag, e: React.MouseEvent) => {
    lastPt.current = { x: e.clientX, y: e.clientY };
    setDragBoth(d);
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);
  };

  // Scroll while dragging near an edge.
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const tick = () => {
      const sc = scrollerRef.current;
      if (sc && dragRef.current) {
        const rc = sc.getBoundingClientRect();
        const { x, y } = lastPt.current;
        let dx = 0, dy = 0;
        if (y > rc.bottom - 28) dy = Math.min(24, (y - rc.bottom + 28) / 2);
        else if (y < rc.top + ROW_H + 16) dy = -Math.min(24, (rc.top + ROW_H + 16 - y) / 2);
        if (x > rc.right - 28) dx = Math.min(24, (x - rc.right + 28) / 2);
        else if (x < rc.left + 48) dx = -Math.min(24, (rc.left + 48 - x) / 2);
        if (dx || dy) { sc.scrollBy(dx, dy); updateDrag(); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [!!drag]);

  const onCellMouseDown = useEvent((e: React.MouseEvent, r: number, c: number) => {
    if (e.button === 2) {
      if (!(sel && inRect(rectOf(sel), r, c))) selectCell({ r, c });
      return;
    }
    if (e.button !== 0) return;
    if (edit) {
      if (edit.r === r && edit.c === c && edit.origin === 'cell') return;
      const input = activeInput();
      const pos = input?.selectionStart ?? draft.length;
      if (draft.startsWith('=') && canPoint(draft, pos)) {
        e.preventDefault();
        insertPointRef({ r, c }, { r, c }, pos);
        beginDrag({ kind: 'point', start: { r, c } }, e);
        return;
      }
      if (!commitEdit()) { e.preventDefault(); return; }
    }
    e.preventDefault();
    focusGrid();
    if (e.shiftKey && sel) setSel({ anchor: sel.anchor, focus: { r, c } });
    else setSel({ anchor: { r, c }, focus: { r, c } });
    beginDrag({ kind: 'select' }, e);
  });

  const onCellDoubleClick = useEvent((r: number, c: number) => {
    if (edit) return;
    startEdit('edit', undefined, 'cell', false, { r, c });
  });

  const onStatusArrow = useEvent((e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (edit && !commitEdit()) return;
    setSel({ anchor: { r, c }, focus: { r, c } });
    startEdit('edit', undefined, 'cell', true, { r, c });
  });

  const onRowHeadMouseDown = useEvent((e: React.MouseEvent, r: number) => {
    if (e.button !== 0) { if (!(sel && inRect(rectOf(sel), r, 0))) selectRect({ r1: r, c1: 0, r2: r, c2: C - 1 }); return; }
    if (edit && !commitEdit()) return;
    e.preventDefault();
    focusGrid();
    const anchorRow = e.shiftKey && sel ? sel.anchor.r : r;
    setSel({ anchor: { r: anchorRow, c: 0 }, focus: { r, c: C - 1 } });
    beginDrag({ kind: 'rowselect', anchorRow }, e);
  });

  const onRowGripMouseDown = useEvent((e: React.MouseEvent, r: number) => {
    if (e.button !== 0 || activeAcrId) return;
    if (edit && !commitEdit()) return;
    e.preventDefault();
    focusGrid();
    // As in Google Sheets: the first press selects rows (drag to select more);
    // pressing again on selected rows drags them to a new place.
    const rc = sel ? rectOf(sel) : null;
    const inside = !!rc && rc.c1 === 0 && rc.c2 === C - 1 && r >= rc.r1 && r <= rc.r2 && !!realRowsOf(rc);
    if (!inside) {
      const anchorRow = r;
      setSel({ anchor: { r: anchorRow, c: 0 }, focus: { r, c: C - 1 } });
      beginDrag({ kind: 'rowselect', anchorRow }, e);
      return;
    }
    beginDrag({ kind: 'rowmove', block: [rc!.r1, rc!.r2], insertAt: null, clickRow: r }, e);
  });

  const onColHeadMouseDown = (e: React.MouseEvent, c: number) => {
    if (e.button !== 0 || V === 0) return;
    if (edit && !commitEdit()) return;
    e.preventDefault();
    focusGrid();
    const anchorCol = e.shiftKey && sel ? sel.anchor.c : c;
    setSel({ anchor: { r: 0, c: anchorCol }, focus: { r: V - 1, c } });
    beginDrag({ kind: 'colselect', anchorCol }, e);
  };

  const onFillHandleDown = (e: React.MouseEvent) => {
    if (!sel || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrag({ kind: 'fill', src: rectOf(sel), target: null }, e);
  };

  const onEdgeDown = (e: React.MouseEvent) => {
    if (!sel || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (activeAcrId) { onlySheetRows(); return; }
    const src = rectOf(sel);
    const hit = hitTest(e.clientX, e.clientY);
    const at = hit?.cell ?? { r: src.r1, c: src.c1 };
    const grab = { r: clamp(at.r, src.r1, src.r2) - src.r1, c: clamp(at.c, src.c1, src.c2) - src.c1 };
    beginDrag({ kind: 'move', src, grab, dest: null }, e);
  };

  const onContextMenu = useEvent((e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (!isEditableRow(r) && view[r]?._acrType !== 'normal') return;
    if (edit && !commitEdit()) return;
    if (!(sel && inRect(rectOf(sel), r, c < 0 ? 0 : c))) {
      if (c < 0) selectRect({ r1: r, c1: 0, r2: r, c2: C - 1 });
      else selectCell({ r, c });
    }
    focusGrid();
    setMenu({ x: e.clientX, y: e.clientY });
  });

  const onDeleteRow = useEvent((r: number) => {
    const rr = realOf(r);
    if (rr !== null) deleteRows([rr]);
  });

  // ---------------------------------------------------------------- focus, caret, scroll
  useLayoutEffect(() => {
    if (!edit) return;
    const input = edit.origin === 'bar' ? barInputRef.current : cellInputRef.current;
    if (input && document.activeElement !== input) input.focus({ preventScroll: true });
  }, [edit?.r, edit?.c, edit?.origin, !!edit]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const input = activeInput();
    if (!input) return;
    const p = pendingCaret.current;
    pendingCaret.current = null;
    input.setSelectionRange(p, p);
    setCaret(p);
  });

  useLayoutEffect(() => {
    if (!scrollTo) return;
    const el = gridRef.current?.querySelector(`[data-cell="${scrollTo.r}:${scrollTo.c}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setScrollTo(null);
  }, [scrollTo]);

  // ---------------------------------------------------------------- where things are drawn
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const gr = grid.getBoundingClientRect();
    const box = (rc: Rect | null): Box | null => {
      if (!rc) return null;
      const a = grid.querySelector(`[data-cell="${rc.r1}:${rc.c1}"]`) as HTMLElement | null;
      const b = grid.querySelector(`[data-cell="${rc.r2}:${rc.c2}"]`) as HTMLElement | null;
      if (!a || !b) return null;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return { left: ra.left - gr.left, top: ra.top - gr.top, width: rb.right - ra.left, height: rb.bottom - ra.top };
    };
    const next: any = {};
    if (sel) {
      next.sel = box(rectOf(sel));
      next.active = box({ r1: sel.anchor.r, c1: sel.anchor.c, r2: sel.anchor.r, c2: sel.anchor.c });
    }
    if (clip && clip.revKey === revKey && clip.cells.length) {
      const v1 = realToView.get(clip.rect.r1), v2 = realToView.get(clip.rect.r2);
      if (v1 !== undefined && v2 !== undefined) next.clip = box({ r1: v1, c1: clip.rect.c1, r2: v2, c2: clip.rect.c2 });
    }
    if (drag?.kind === 'fill' && drag.target) next.preview = box(drag.target);
    if (drag?.kind === 'move' && drag.dest) {
      next.preview = box({ r1: drag.dest.r, c1: drag.dest.c, r2: drag.dest.r + drag.src.r2 - drag.src.r1, c2: drag.dest.c + drag.src.c2 - drag.src.c1 });
    }
    if (drag?.kind === 'rowmove' && drag.insertAt !== null) {
      const at = drag.insertAt;
      const tr = grid.querySelector(`tr[data-row="${Math.min(at, V - 1)}"]`) as HTMLElement | null;
      if (tr) {
        const b = tr.getBoundingClientRect();
        next.line = { top: (at >= V ? b.bottom : b.top) - gr.top - 1, left: 0, width: b.width, height: 3 };
      }
    }
    if (edit) {
      next.edit = box({ r1: edit.r, c1: edit.c, r2: edit.r, c2: edit.c });
      if (draft.startsWith('=')) {
        next.refs = findRefSpans(draft).slice(0, 12).map((s, i) => {
          const v1 = realToView.get(s.r1), v2 = realToView.get(Math.min(s.r2, acts.length - 1));
          if (v1 === undefined || v2 === undefined || s.c1 < 0 || s.c2 >= C) return null;
          const b = box({ r1: v1, c1: s.c1, r2: v2, c2: s.c2 });
          return b ? { ...b, color: REF_COLORS[i % REF_COLORS.length] } : null;
        }).filter(Boolean);
      }
    }
    const json = JSON.stringify(next);
    if (json !== JSON.stringify(geo)) setGeo(next);
  });

  // ---------------------------------------------------------------- column widths
  useEffect(() => {
    if (!resizingCol) return;
    const move = (e: MouseEvent) => setColumnWidth(resizingCol.id, Math.max(resizingCol.startWidth + e.clientX - resizingCol.startX, 40));
    const up = () => setResizingCol(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [resizingCol, setColumnWidth]);

  const autoFit = (col: ColDef) => {
    let max = textWidth(col.title) + 32;
    for (const act of acts) max = Math.max(max, textWidth(displayText((act as any)[col.key], col)) + 40);
    setColumnWidth(col.id, Math.min(Math.ceil(max), 600));
  };

  // ---------------------------------------------------------------- toolbar values
  const anchor = sel?.anchor;
  const anchorAct = anchor ? view[anchor.r] : null;
  const anchorCol = anchor ? COLUMNS[anchor.c] : null;
  const rc = sel ? rectOf(sel) : null;
  const multi = !!rc && (rc.r1 !== rc.r2 || rc.c1 !== rc.c2);
  const nameText = (() => {
    if (!anchor) return '';
    const own = a1(anchor.r, anchor.c) ?? (view[anchor.r]?._acrType === 'proposed-add' ? `${colLetter(anchor.c)} (new)` : colLetter(anchor.c));
    return multi ? `${own}  ${rc!.r2 - rc!.r1 + 1}R × ${rc!.c2 - rc!.c1 + 1}C` : own;
  })();
  const barText = edit ? draft : anchorAct && anchorCol ? editText(anchorAct, anchorCol) : '';
  const canEditAnchor = !!anchor && isEditableRow(anchor.r);

  const summary = useMemo(() => {
    if (!rc || !multi) return '';
    let count = 0, sum = 0, n = 0, dMin = Infinity, dMax = -Infinity, dates = 0;
    for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) {
      const col = COLUMNS[c];
      const v = view[r]?.[col.key];
      if (v === '' || v === null || v === undefined) continue;
      count++;
      if (col.type === 'date') {
        const s = D.isoToSerial(v);
        if (s !== null) { dates++; dMin = Math.min(dMin, s); dMax = Math.max(dMax, s); }
      } else if ((col.type === 'number' || col.type === 'percent') && typeof v === 'number') { sum += v; n++; }
    }
    const parts = [`COUNT ${count}`];
    if (n) {
      const pct = rc.c1 === rc.c2 && COLUMNS[rc.c1].type === 'percent';
      const f = (x: number) => (pct ? `${Math.round(x * 1000) / 10}%` : String(Number(x.toPrecision(10))));
      parts.push(`SUM ${f(sum)}`, `AVG ${f(sum / n)}`);
    }
    if (dates > 1) {
      const hol = new Set(holidays.map(h => D.isoToSerial(h)).filter(x => x !== null) as number[]);
      let wd = 0;
      for (let d = dMin; d <= dMax && d - dMin < 20000; d++) { const w = D.dayOfWeek(d); if (w !== 0 && w !== 6 && !hol.has(d)) wd++; }
      parts.push(`${D.formatDateCell(D.serialToIso(dMin))} → ${D.formatDateCell(D.serialToIso(dMax))}`, `${wd} WORKING DAYS`);
    }
    return parts.join(' · ');
  }, [rc?.r1, rc?.r2, rc?.c1, rc?.c2, multi, view, holidays]);

  const goToName = (text: string) => {
    const m = text.trim().toUpperCase().match(/^([A-Z]{1,2})(\d+)(?::([A-Z]{1,2})(\d+))?$/);
    if (!m) { setNotice('Type a cell like H12, or a range like H3:J7.'); return; }
    const c1 = colFromLetter(m[1]), r1 = +m[2] - 1;
    const c2 = m[3] ? colFromLetter(m[3]) : c1, r2 = m[4] ? +m[4] - 1 : r1;
    const v1 = realToView.get(Math.min(r1, r2)), v2 = realToView.get(Math.max(r1, r2));
    if (v1 === undefined || v2 === undefined || Math.max(c1, c2) >= C) { setNotice(`${text.toUpperCase()} is outside the table.`); return; }
    setSel({ anchor: { r: v1, c: Math.min(c1, c2) }, focus: { r: v2, c: Math.max(c1, c2) } });
    setScrollTo({ r: v1, c: Math.min(c1, c2) });
    focusGrid();
  };

  // ---------------------------------------------------------------- editor
  const editorNode = (() => {
    if (!edit) return null;
    if (edit.origin === 'bar') {
      return <div className="absolute inset-0 px-3 flex items-center text-xs bg-white overflow-hidden whitespace-nowrap shadow-[inset_0_0_0_2px_#ff7600]">{draft}</div>;
    }
    const col = COLUMNS[edit.c];
    const width = Math.min(Math.max((columnWidths[col.id] || col.defaultWidth), textWidth(draft) + 32), 640);
    return (
      <input
        ref={cellInputRef}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onKeyDown={onEditorKeyDown}
        onBlur={onEditorBlur}
        onMouseDown={(e) => e.stopPropagation()}
        className={`absolute left-0 top-0 h-full bg-white text-qb-black outline-none px-3 text-xs ${draft.startsWith('=') ? 'font-mono' : ''}`}
        style={{ width, boxShadow: `inset 0 0 0 2px ${editError ? '#c11c4d' : '#ff7600'}`, zIndex: 30 }}
      />
    );
  })();

  const hintStyle: React.CSSProperties | null = (() => {
    if (!edit) return null;
    if (edit.origin === 'bar') return null;
    const b: Box | undefined = geo.edit;
    if (!b) return null;
    return { left: b.left, top: b.top + b.height + 2 };
  })();

  // ---------------------------------------------------------------- render
  const canUndoNow = H.canUndo(projectId, revision.id);
  const canRedoNow = H.canRedo(projectId, revision.id);
  const selEditable = !!rc && !!realRowsOf(rc);
  const dragging = !!drag;

  return (
    <div className="h-full flex flex-col bg-qb-bg overflow-hidden font-sans">
      <AcrScroller />

      {/* Formula bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-qb-box-bg bg-qb-bg flex-shrink-0 text-xs relative z-40">
        <button
          onClick={doUndo}
          disabled={!canUndoNow}
          title={canUndoNow ? `Undo ${H.undoLabel(projectId, revision.id)} (${MOD}Z)` : 'Nothing to undo'}
          className="p-1.5 text-qb-dark-grey hover:text-qb-orange disabled:text-qb-light-grey disabled:hover:text-qb-light-grey"
        ><Undo2 className="w-4 h-4" /></button>
        <button
          onClick={doRedo}
          disabled={!canRedoNow}
          title={canRedoNow ? `Redo ${H.redoLabel(projectId, revision.id)} (${MOD}⇧Z)` : 'Nothing to redo'}
          className="p-1.5 text-qb-dark-grey hover:text-qb-orange disabled:text-qb-light-grey disabled:hover:text-qb-light-grey"
        ><Redo2 className="w-4 h-4" /></button>
        <div className="w-px h-5 bg-qb-light-grey mx-1" />
        <input
          value={nameBox ?? nameText}
          onFocus={(e) => { setNameBox(a1(anchor?.r ?? -1, anchor?.c ?? 0) ?? ''); requestAnimationFrame(() => e.target.select()); }}
          onChange={(e) => setNameBox(e.target.value)}
          onBlur={() => setNameBox(null)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { goToName(e.currentTarget.value); setNameBox(null); }
            if (e.key === 'Escape') { setNameBox(null); focusGrid(); }
          }}
          title="Cell name. Type one (H12) and press Enter to go there."
          className="w-32 font-mono text-[11px] border border-qb-light-grey bg-white px-2 py-1 outline-none focus:border-qb-orange"
        />
        <span className="font-mono italic text-qb-grey px-1 select-none">fx</span>
        <input
          ref={barInputRef}
          value={barText}
          readOnly={!canEditAnchor}
          spellCheck={false}
          autoComplete="off"
          placeholder={canEditAnchor ? 'Type a value, or = for a formula' : ''}
          onFocus={() => {
            if (!canEditAnchor) return;
            if (edit) { if (edit.origin !== 'bar') setEdit({ ...edit, origin: 'bar' }); }
            else startEdit('edit', undefined, 'bar');
          }}
          onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={onEditorKeyDown}
          onBlur={onEditorBlur}
          className={`flex-1 min-w-0 font-mono text-[11px] border bg-white px-2 py-1 outline-none ${editError && edit?.origin === 'bar' ? 'border-qb-magenta' : 'border-qb-light-grey focus:border-qb-orange'}`}
        />
        {summary && <div className="hidden xl:block font-mono text-[10px] text-qb-dark-grey whitespace-nowrap px-2">{summary}</div>}
        <div className="relative">
          <button
            onClick={() => setShowHolidays(v => !v)}
            onMouseDown={(e) => e.stopPropagation()}
            title={holidayChange ? 'A change to the holidays is proposed — open to see it' : 'Days off that WORKDAY and NETWORKDAYS skip'}
            className={`flex items-center gap-1.5 px-2 py-1.5 font-black uppercase tracking-widest text-[10px] border ${holidayChange ? 'border-[#ff7600] text-[#ff7600] bg-[#ff7600]/10' : showHolidays ? 'border-qb-orange text-qb-orange' : 'border-qb-light-grey text-qb-dark-grey hover:text-qb-orange hover:border-qb-orange'}`}
          >
            <CalendarOff className="w-3.5 h-3.5" /> Holidays{holidays.length ? ` (${holidays.length})` : ''}
            {holidayChange && proposedHolidays && <span>→ {proposedHolidays.length} proposed</span>}
          </button>
          {showHolidays && (
            <HolidaysPopover
              holidays={holidays}
              proposed={proposedHolidays}
              onChange={(list) => {
                // Open proposal: the edit lands on the proposal, never on the record.
                if (holidayChange && activeAcrId) {
                  useAcrStore.getState().updateAcrChange(activeAcrId, holidayChange.id, { args: { ...holidayChange.args, holidays: Array.from(new Set(list)).sort() } });
                } else {
                  setHolidays(projectId, list);
                }
              }}
              onClose={() => setShowHolidays(false)}
            />
          )}
        </div>
      </div>
      {edit?.origin === 'bar' && (hintInfo.state.list.length || hintInfo.state.signature || hintInfo.state.preview || editError) ? (
        <div className="relative z-40">
          <HintBox hint={hintInfo.state} style={{ left: 200, top: 0 }} onPick={pickHint} />
        </div>
      ) : null}
      {notice && (
        <div className="px-3 py-1.5 text-[11px] bg-qb-orange/10 text-qb-dark-grey border-b border-qb-orange/30 flex-shrink-0">{notice}</div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-auto relative">
        <div
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onGridKeyDown}
          className={`outline-none relative inline-block min-w-full ${dragging ? 'select-none' : ''}`}
          style={{ cursor: drag?.kind === 'move' ? 'move' : drag?.kind === 'fill' ? 'crosshair' : drag?.kind === 'rowmove' ? 'grabbing' : undefined }}
        >
          <table className="w-auto text-sm text-left border-collapse" style={{ tableLayout: 'fixed' }}>
            <thead className="text-[10px] uppercase font-black text-qb-dark-grey bg-qb-bg sticky top-0 z-30 border-b border-qb-box-bg tracking-widest" style={{ height: ROW_H }}>
              <tr>
                <th
                  className="w-10 min-w-[40px] sticky left-0 z-30 bg-qb-bg border-r border-qb-box-bg cursor-pointer hover:bg-qb-light-grey/30"
                  title="Select all"
                  onMouseDown={(e) => { e.preventDefault(); if (V) { focusGrid(); selectRect({ r1: 0, c1: 0, r2: V - 1, c2: C - 1 }); } }}
                />
                {COLUMNS.map((col, idx) => {
                  const isActiveCol = !!rc && idx >= rc.c1 && idx <= rc.c2;
                  const width = columnWidths[col.id] || col.defaultWidth;
                  return (
                    <th
                      key={col.id}
                      data-colhead={idx}
                      className={`relative px-3 whitespace-nowrap border-r border-qb-box-bg hover:bg-qb-light-grey/30 select-none cursor-pointer bg-qb-bg ${isActiveCol ? 'bg-qb-light-grey/30' : ''}`}
                      style={{ width, minWidth: width, maxWidth: width }}
                      onMouseDown={(e) => onColHeadMouseDown(e, idx)}
                    >
                      <div className="flex flex-col pt-1 pb-1 relative pointer-events-none">
                        <span className={`text-[9px] font-mono leading-none mb-0.5 ${isActiveCol ? 'text-qb-orange font-bold text-[10px]' : 'text-qb-grey'}`}>{colLetter(idx)}</span>
                        <span className={`truncate ${isActiveCol ? 'text-qb-black' : ''}`}>{col.title}</span>
                      </div>
                      <div
                        className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-qb-orange z-10 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizingCol({ id: col.id, startX: e.clientX, startWidth: width }); }}
                        onDoubleClick={(e) => { e.stopPropagation(); autoFit(col); }}
                      />
                    </th>
                  );
                })}
                <th className="w-12 border-qb-box-bg" />
              </tr>
            </thead>
            <tbody className="text-qb-black select-none">
              {view.map((act, index) => {
                let label: React.ReactNode = act._originalIndex + 1;
                switch (act._acrType) {
                  case 'proposed-add': label = <span className="text-[9px] font-black text-[#51b53e] tracking-tight font-sans leading-none bg-[#51b53e]/10 px-1 py-0.5 border border-[#51b53e]/20">ADD</span>; break;
                  case 'proposed-update': label = <span className="text-[9px] font-black text-[#ff7600] tracking-tight font-sans leading-none bg-[#ff7600]/10 px-1 py-0.5 border border-[#ff7600]/20 animate-pulse">UPD</span>; break;
                  case 'original-for-update': label = <span className="text-[9px] font-black text-[#5c666b] tracking-tight font-sans leading-none bg-slate-200 px-1 py-0.5">ORIG</span>; break;
                  case 'proposed-delete': label = <span className="text-[9px] font-black text-[#c11c4d] tracking-tight font-sans leading-none bg-[#c11c4d]/10 px-1 py-0.5 border border-[#c11c4d]/20">DEL</span>; break;
                }
                const isEditingRow = edit?.r === index;
                return (
                  <ActivityRow
                    key={act.id}
                    act={act}
                    index={index}
                    label={label}
                    isActiveRow={!!rc && index >= rc.r1 && index <= rc.r2}
                    editingCol={isEditingRow ? edit!.c : -1}
                    editor={isEditingRow ? editorNode : null}
                    activities={act._acrType === 'proposed-update' ? acts : (NO_HOLIDAYS as any)}
                    canDragRows={!activeAcrId && act._acrType === 'normal'}
                    onCellMouseDown={onCellMouseDown}
                    onCellDoubleClick={onCellDoubleClick}
                    onStatusArrow={onStatusArrow}
                    onRowHeadMouseDown={onRowHeadMouseDown}
                    onRowGripMouseDown={onRowGripMouseDown}
                    onContextMenu={onContextMenu}
                    onDelete={onDeleteRow}
                  />
                );
              })}
              <tr>
                <td colSpan={C + 2} className="p-4">
                  <button
                    onClick={() => {
                      const next = [...acts, blankRow()];
                      const vr = V;
                      record('Add row', next, { anchor: { r: vr, c: 0 }, focus: { r: vr, c: 0 } });
                      setSel({ anchor: { r: vr, c: 0 }, focus: { r: vr, c: 0 } });
                      setScrollTo({ r: vr, c: 0 });
                      focusGrid();
                    }}
                    className="flex items-center gap-2 text-xs font-black text-qb-grey hover:text-qb-orange uppercase tracking-widest transition-colors w-full p-2 border-2 border-dashed border-qb-box-bg hover:border-qb-orange hover:bg-qb-orange/5 justify-center mt-4"
                  >
                    <Plus className="w-4 h-4" /> ADD ROW
                  </button>
                  <div className="text-center text-[10px] text-qb-grey mt-3 tracking-wide normal-case">
                    Type to replace · Enter or F2 to edit · = for a formula · drag the square to fill · drag the edge to move · {MOD}Z undo
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Selection, fill handle, copy marks and previews */}
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 15 }}>
            {geo.refs?.map((b: any, i: number) => (
              <div key={i} className="absolute" style={{ left: b.left, top: b.top, width: b.width, height: b.height, border: `2px solid ${b.color}`, background: `${b.color}14` }} />
            ))}
            {geo.sel && multi && (
              <div className="absolute bg-qb-orange/10" style={{ left: geo.sel.left, top: geo.sel.top, width: geo.sel.width, height: geo.sel.height }} />
            )}
            {geo.active && !edit && (
              <div className="absolute" style={{ left: geo.active.left, top: geo.active.top, width: geo.active.width, height: geo.active.height, boxShadow: multi ? 'inset 0 0 0 1px #ff7600' : 'none' }} />
            )}
            {geo.sel && !edit && (
              <>
                <div className="absolute" style={{ left: geo.sel.left - 1, top: geo.sel.top - 1, width: geo.sel.width + 1, height: geo.sel.height + 1, border: '2px solid #ff7600' }} />
                {selEditable && (
                  <>
                    {/* Edges: drag to move the cells */}
                    {[
                      { left: geo.sel.left - 4, top: geo.sel.top - 4, width: geo.sel.width + 6, height: 6 },
                      { left: geo.sel.left - 4, top: geo.sel.top + geo.sel.height - 3, width: geo.sel.width + 6, height: 6 },
                      { left: geo.sel.left - 4, top: geo.sel.top - 4, width: 6, height: geo.sel.height + 6 },
                      { left: geo.sel.left + geo.sel.width - 3, top: geo.sel.top - 4, width: 6, height: geo.sel.height + 6 },
                    ].map((s, i) => (
                      <div key={i} className="absolute" style={{ ...s, cursor: 'move', pointerEvents: dragging ? 'none' : 'auto' }} onMouseDown={onEdgeDown} title="Drag to move. Hold Option to copy." />
                    ))}
                    <div
                      className="absolute bg-qb-orange border border-white"
                      style={{ left: geo.sel.left + geo.sel.width - 5, top: geo.sel.top + geo.sel.height - 5, width: 9, height: 9, cursor: 'crosshair', pointerEvents: dragging ? 'none' : 'auto', zIndex: 2 }}
                      onMouseDown={onFillHandleDown}
                      onDoubleClick={(e) => { e.stopPropagation(); fillToEnd(); }}
                      title="Drag to fill. Double-click to fill down. Hold Option to copy instead of counting up."
                    />
                  </>
                )}
              </>
            )}
            {geo.clip && <div className="absolute sheet-ants" style={{ left: geo.clip.left - 1, top: geo.clip.top - 1, width: geo.clip.width + 1, height: geo.clip.height + 1 }} />}
            {geo.preview && (
              <div className="absolute" style={{ left: geo.preview.left - 1, top: geo.preview.top - 1, width: geo.preview.width + 1, height: geo.preview.height + 1, border: '2px dashed #5c666b' }} />
            )}
            {geo.line && <div className="absolute bg-qb-orange" style={{ left: geo.line.left, top: geo.line.top, width: geo.line.width, height: geo.line.height }} />}
          </div>

          {hintStyle && <HintBox hint={hintInfo.state} style={hintStyle} onPick={pickHint} />}
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 bg-qb-bg border border-qb-light-grey shadow-2xl py-1 w-56 text-xs"
          style={{ top: Math.min(menu.y, window.innerHeight - 330), left: Math.min(menu.x, window.innerWidth - 240) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(() => {
            const rows = selectedRealRows();
            const n = Math.max(1, rows.length);
            const item = (label: string, keys: string, action: () => void, danger = false, disabled = false) => (
              <button
                key={label}
                disabled={disabled}
                className={`w-full text-left px-4 py-2 flex justify-between transition-colors disabled:text-qb-light-grey ${danger ? 'hover:bg-qb-orange hover:text-white' : 'hover:bg-qb-box-bg'} text-qb-black`}
                onClick={() => { setMenu(null); focusGrid(); action(); }}
              >
                <span>{label}</span><span className="text-qb-grey font-mono">{keys}</span>
              </button>
            );
            return (
              <>
                {item('Cut', `${MOD}X`, () => document.execCommand('cut'), false, !selEditable)}
                {item('Copy', `${MOD}C`, () => document.execCommand('copy'))}
                {item('Paste', `${MOD}V`, () => {
                  navigator.clipboard?.readText?.().then(t => doPaste(t)).catch(() => setNotice(`Your browser blocked the paste from this menu. Press ${MOD}V instead.`));
                }, false, !selEditable)}
                <div className="h-px bg-qb-box-bg my-1" />
                {item(n > 1 ? `Insert ${n} rows above` : 'Insert row above', '', () => insertRows(true))}
                {item(n > 1 ? `Insert ${n} rows below` : 'Insert row below', '', () => insertRows(false))}
                {item(n > 1 ? `Duplicate ${n} rows` : 'Duplicate row', '', duplicateRows, false, !rows.length)}
                {item('Clear contents', 'Delete', clearSelection, false, !selEditable)}
                <div className="h-px bg-qb-box-bg my-1" />
                {item(n > 1 ? `Delete ${n} rows` : 'Delete row', '', () => deleteRows(rows), true, !rows.length)}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
