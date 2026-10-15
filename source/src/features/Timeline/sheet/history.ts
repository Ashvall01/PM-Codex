/**
 * Undo and redo for the timeline table.
 *
 * Each user action (a typed cell, a paste of 50 cells, a fill, a row move) is
 * one step. A step keeps the rows before and after. Undo does not simply put
 * the old list back: it takes back only what that step changed, so a change
 * Claude's approved proposal made in between is kept.
 *
 * Steps live in memory for this page only (100 per revision), as a sheet's
 * undo is gone when you close the file.
 */
import { create } from 'zustand';
import { useTimelineStore, TimelineActivity } from '../../../store/timelineStore';
import { applyStep } from './applyStep';

export interface SelectionSnapshot {
  anchor: { r: number; c: number };
  focus: { r: number; c: number };
}

interface Step {
  label: string;
  before: TimelineActivity[];
  after: TimelineActivity[];
  selBefore?: SelectionSnapshot | null;
  selAfter?: SelectionSnapshot | null;
}

const LIMIT = 100;
const stacks = new Map<string, { undo: Step[]; redo: Step[] }>();
const keyOf = (p: string, r: string) => `${p}::${r}`;

/** Only for React: redraws the undo/redo buttons when the stacks change. */
export const useSheetHistory = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

function stack(p: string, r: string) {
  const k = keyOf(p, r);
  let s = stacks.get(k);
  if (!s) { s = { undo: [], redo: [] }; stacks.set(k, s); }
  return s;
}

function current(p: string, r: string): TimelineActivity[] | null {
  const t = useTimelineStore.getState().projectTimelines.find((x) => x.projectId === p);
  return t?.revisions.find((x) => x.id === r)?.activities ?? null;
}

export function canUndo(p: string, r: string) { return (stacks.get(keyOf(p, r))?.undo.length ?? 0) > 0; }
export function canRedo(p: string, r: string) { return (stacks.get(keyOf(p, r))?.redo.length ?? 0) > 0; }
export function undoLabel(p: string, r: string) { const s = stacks.get(keyOf(p, r)); return s?.undo[s.undo.length - 1]?.label ?? ''; }
export function redoLabel(p: string, r: string) { const s = stacks.get(keyOf(p, r)); return s?.redo[s.redo.length - 1]?.label ?? ''; }

/** Run one user action as one undo step. */
export function recordStep(
  p: string,
  r: string,
  label: string,
  action: () => void,
  selBefore?: SelectionSnapshot | null,
  selAfter?: SelectionSnapshot | null,
) {
  const before = current(p, r);
  action();
  const after = current(p, r);
  if (!before || !after || before === after) return;
  const s = stack(p, r);
  s.undo.push({ label, before, after, selBefore, selAfter });
  if (s.undo.length > LIMIT) s.undo.shift();
  s.redo = [];
  useSheetHistory.getState().bump();
}

function move(p: string, r: string, dir: 'undo' | 'redo'): SelectionSnapshot | null | undefined {
  const s = stacks.get(keyOf(p, r));
  const step = dir === 'undo' ? s?.undo.pop() : s?.redo.pop();
  const cur = current(p, r);
  if (!s || !step || !cur) return undefined;
  const next = (dir === 'undo' ? applyStep(cur, step.after, step.before) : applyStep(cur, step.before, step.after)) as TimelineActivity[];
  useTimelineStore.getState().setActivities(p, r, next);
  (dir === 'undo' ? s.redo : s.undo).push(step);
  useSheetHistory.getState().bump();
  return dir === 'undo' ? step.selBefore : step.selAfter;
}

export const undo = (p: string, r: string) => move(p, r, 'undo');
export const redo = (p: string, r: string) => move(p, r, 'redo');
