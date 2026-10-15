/**
 * Works out every formula in a timeline, in the right order.
 *
 * A formula cell asks for the cells it needs; if one of those is a formula
 * too, it is worked out first. A cell that ends up needing itself is a loop
 * and shows #CIRCULAR!. The answers are written back into the rows, so the
 * Gantt chart, the snapshot for Claude and the Google Sheet all see plain
 * values; the formula text stays in `formulas`.
 */
import { COLUMNS, ColDef } from './columns';
import * as D from './dates';
import {
  E, Evaluator, FErr, Host, Node, Scalar, isDateExpr, isFormulaText, numText, parseFormula, toText,
} from './formula';
import { FUNCS } from './functions';

export interface SheetRow {
  id: string;
  formulas?: Record<string, string>;
  [key: string]: any;
}

/** A plain (not formula) cell as the engine reads it: dates as day numbers, blanks as null. */
export function rawCellValue(row: SheetRow, col: ColDef): Scalar {
  const v = row[col.key];
  if (v === undefined || v === null || v === '') return null;
  switch (col.type) {
    case 'date': {
      const s = D.isoToSerial(v);
      return s !== null ? s : String(v);
    }
    case 'number':
    case 'percent': {
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v;
      const n = Number(String(v).trim());
      return String(v).trim() !== '' && Number.isFinite(n) ? n : String(v);
    }
    default:
      return typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
  }
}

export function holidaySerials(list: string[] | undefined): number[] {
  const out: number[] = [];
  for (const h of list || []) {
    const s = D.isoToSerial(h) ?? D.parseDateText(h);
    if (s !== null) out.push(s);
  }
  return out;
}

/** A formula's answer -> the value the row stores, by the column's type. */
export function toStored(v: Scalar | FErr, col: ColDef, dateHint: boolean): any {
  if (v instanceof FErr) return v.code;
  switch (col.type) {
    case 'date':
      if (v === null) return '';
      if (typeof v === 'number') return v < 0 ? E.NUM : D.serialToIso(v);
      if (typeof v === 'string') {
        const s = D.isoToSerial(v) ?? D.parseDateText(v);
        return s !== null ? D.serialToIso(s) : v;
      }
      return E.VALUE;
    case 'number':
    case 'percent':
      if (v === null) return 0;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return Number(v.toPrecision(15));
      { const n = Number(v.trim()); return v.trim() !== '' && Number.isFinite(n) ? n : v; }
    default:
      if (typeof v === 'number' && dateHint) return D.formatDateCell(D.serialToIso(v));
      if (typeof v === 'number') return numText(v);
      return toText(v);
  }
}

export function getFormula(row: SheetRow, key: string): string | undefined {
  const f = row.formulas?.[key];
  return isFormulaText(f) ? f : undefined;
}

export function hasAnyFormula(rows: SheetRow[]): boolean {
  return rows.some((r) => r.formulas && Object.values(r.formulas).some(isFormulaText));
}

function sameStored(a: any, b: any): boolean {
  if (a === b) return true;
  if ((a === undefined || a === null || a === '') && (b === undefined || b === null || b === '')) return true;
  return false;
}

/**
 * Recalculate all formulas. Rows that do not change keep their identity, so
 * React redraws only what changed. `changed` is false when nothing moved.
 */
export function recalcRows<T extends SheetRow>(
  rows: T[],
  holidays: string[] = [],
  today: number = D.todaySerial(),
): { rows: T[]; changed: boolean } {
  if (!hasAnyFormula(rows)) return { rows, changed: false };
  const C = COLUMNS.length;
  const n = rows.length;
  const trees: (Node | FErr | null)[] = new Array(n * C).fill(null);
  const hints: boolean[] = new Array(n * C).fill(false);
  for (let r = 0; r < n; r++) {
    const fs = rows[r].formulas;
    if (!fs) continue;
    for (let c = 0; c < C; c++) {
      const f = fs[COLUMNS[c].key];
      if (!isFormulaText(f)) continue;
      try {
        const tree = parseFormula(f);
        trees[r * C + c] = tree;
        hints[r * C + c] = isDateExpr(tree);
      } catch (e) {
        trees[r * C + c] = e instanceof FErr ? e : new FErr(E.ERROR);
      }
    }
  }

  const state = new Uint8Array(n * C); // 0 = not yet, 1 = working, 2 = done
  const memo: (Scalar | FErr)[] = new Array(n * C).fill(null);
  const holidayList = holidaySerials(holidays);

  const cell = (r: number, c: number): Scalar => {
    const k = r * C + c;
    const tree = trees[k];
    if (tree === null) return rawCellValue(rows[r], COLUMNS[c]);
    if (state[k] === 2) { const v = memo[k]; if (v instanceof FErr) throw v; return v; }
    if (state[k] === 1) throw new FErr(E.CIRC);
    state[k] = 1;
    let v: Scalar | FErr;
    if (tree instanceof FErr) v = tree;
    else {
      try {
        v = new Evaluator(hostFor(r), FUNCS).scalar(tree);
      } catch (e) {
        v = e instanceof FErr ? e : new FErr(E.ERROR);
      }
    }
    memo[k] = v;
    state[k] = 2;
    if (v instanceof FErr) throw v;
    return v;
  };

  const hostFor = (r: number): Host => ({ rowCount: n, cell, thisRow: r, holidays: holidayList, today });

  let changed = false;
  const out = rows.map((row, r) => {
    let next: T | null = null;
    for (let c = 0; c < C; c++) {
      const k = r * C + c;
      if (trees[k] === null) continue;
      let v: Scalar | FErr;
      try { v = cell(r, c); } catch (e) { v = e instanceof FErr ? e : new FErr(E.ERROR); }
      const col = COLUMNS[c];
      const stored = toStored(v, col, hints[k]);
      if (!sameStored(stored, row[col.key])) {
        next = next ?? ({ ...row } as T);
        (next as any)[col.key] = stored;
      }
    }
    if (next) { changed = true; return next; }
    return row;
  });
  return { rows: changed ? out : rows, changed };
}

/**
 * Work out one formula for a cell, with the sheet around it. Used for the
 * live answer while you type, and for proposed rows that are not in the
 * sheet yet (pass `virtualRow` and thisRow = null).
 */
export function evaluateFormulaAt(
  text: string,
  rows: SheetRow[],
  thisRow: number | null,
  colIndex: number,
  holidays: string[] = [],
  virtualRow?: SheetRow,
): { stored: any; error: string | null } {
  const col = COLUMNS[colIndex];
  let tree: Node;
  try { tree = parseFormula(text); } catch (e) { return { stored: E.ERROR, error: E.ERROR }; }
  // Other formula cells already hold their answers, so read stored values,
  // except the cell being edited, which would be a loop.
  const cell = (r: number, c: number): Scalar => {
    if (r === thisRow && c === colIndex) throw new FErr(E.CIRC);
    const row = rows[r];
    const v = row?.[COLUMNS[c].key];
    if (typeof v === 'string' && v.startsWith('#') && getFormula(row, COLUMNS[c].key)) throw new FErr(v);
    return row ? rawCellValue(row, COLUMNS[c]) : null;
  };
  const host: Host = {
    rowCount: rows.length,
    cell,
    thisRow,
    holidays: holidaySerials(holidays),
    today: D.todaySerial(),
    thisRowCell: virtualRow ? (c: number) => rawCellValue(virtualRow, COLUMNS[c]) : undefined,
  };
  try {
    const v = new Evaluator(host, FUNCS).scalar(tree);
    return { stored: toStored(v, col, isDateExpr(tree)), error: null };
  } catch (e) {
    const code = e instanceof FErr ? e.code : E.ERROR;
    return { stored: code, error: code };
  }
}
