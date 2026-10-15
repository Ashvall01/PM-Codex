/**
 * The sheet rules every change to a timeline goes through, whoever makes it:
 * the table, the row editor, Claude's or Gemini's approved proposals.
 *
 *  1. A value that starts with "=" is a formula.
 *  2. Typing a plain value over a formula replaces the formula (as in Excel);
 *     writing back the same value leaves the formula alone.
 *  3. When rows are added, deleted or moved, refs follow their rows.
 *  4. Then every formula is worked out again.
 */
import { COLUMN_BY_KEY } from './columns';
import { isFormulaText } from './formula';
import { recalcRows, SheetRow } from './recalc';
import { remapFormulaRows } from './refs';
import { isoToSerial } from './dates';

function looseEqual(a: any, b: any): boolean {
  if (a === b) return true;
  const blank = (v: any) => v === undefined || v === null || v === '';
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  const da = isoToSerial(a), db = isoToSerial(b);
  if (da !== null && db !== null) return da === db;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}

/** Merge an update into a row, following rules 1 and 2. */
export function mergeRowUpdate<T extends SheetRow>(row: T, updates: Partial<T>): T {
  const next: any = { ...row, ...updates };
  if ('formulas' in updates) {
    const f = { ...((updates as any).formulas || {}) };
    for (const k of Object.keys(f)) if (!isFormulaText(f[k])) delete f[k];
    next.formulas = Object.keys(f).length ? f : undefined;
  } else {
    const f = { ...(row.formulas || {}) };
    let touched = false;
    for (const k of Object.keys(updates)) {
      if (COLUMN_BY_KEY[k] === undefined) continue;
      const v = (updates as any)[k];
      if (isFormulaText(v)) { f[k] = v; touched = true; }
      else if (f[k] !== undefined && !looseEqual(v, (row as any)[k])) { delete f[k]; touched = true; }
    }
    if (touched) next.formulas = Object.keys(f).length ? f : undefined;
  }
  if (next.formulas === undefined) delete next.formulas;
  return next;
}

/** Rule 1 for a whole row: "=…" in a field moves into `formulas`. */
function liftFormulas<T extends SheetRow>(row: T): T {
  let f: Record<string, string> | null = null;
  for (const k of Object.keys(COLUMN_BY_KEY)) {
    const v = (row as any)[k];
    if (isFormulaText(v) && row.formulas?.[k] !== v) {
      f = f ?? { ...(row.formulas || {}) };
      f[k] = v;
    }
  }
  return f ? { ...row, formulas: f } : row;
}

/** Rules 1, 3 and 4 for a new list of rows. `prev` is the list before the change. */
export function applySheetRules<T extends SheetRow>(prev: T[], next: T[], holidays?: string[]): T[] {
  let rows = next.map(liftFormulas);
  if (rows.every((r, i) => r === next[i])) rows = next;
  const sameOrder = prev.length === rows.length && prev.every((r, i) => r.id === rows[i].id);
  if (!sameOrder) {
    const oldIds = prev.map((r) => r.id);
    const prevById = new Map(prev.map((r) => [r.id, r]));
    const newIndex = new Map(rows.map((r, i) => [r.id, i]));
    rows = rows.map((row) => {
      if (!row.formulas) return row;
      const before = prevById.get(row.id);
      let f: Record<string, string> | null = null;
      for (const [k, text] of Object.entries(row.formulas)) {
        // Only formulas that were already there; new ones were written for the new layout.
        if (!before || before.formulas?.[k] !== text) continue;
        const moved = remapFormulaRows(text, oldIds, newIndex, rows.length);
        if (moved !== text) { f = f ?? { ...row.formulas }; f[k] = moved; }
      }
      return f ? { ...row, formulas: f } : row;
    });
    if (rows.every((r, i) => r === next[i])) rows = next;
  }
  return recalcRows(rows, holidays).rows;
}
