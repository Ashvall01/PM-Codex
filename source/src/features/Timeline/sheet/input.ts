/**
 * What a person types into a cell -> the stored value, and back.
 * Also the clipboard's tab-separated text, the same form Excel and Google
 * Sheets put on the clipboard.
 */
import { ColDef, STATUS_OPTIONS } from './columns';
import * as D from './dates';
import { isErrorText, isFormulaText, numText } from './formula';

export interface ParsedInput {
  value: any;
  formula?: string;
  /** Why the text cannot go in this column (the cell keeps its old value). */
  invalid?: string;
}

function parseNumber(s: string): number | null {
  let t = s.trim().replace(/\s/g, '');
  if (t === '') return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  return parseFloat(t);
}

export function emptyValue(col: ColDef): any {
  return col.type === 'number' || col.type === 'percent' ? 0 : '';
}

export function parseInput(col: ColDef, raw: string): ParsedInput {
  const text = raw ?? '';
  if (isFormulaText(text.trim())) return { value: emptyValue(col), formula: text.trim() };
  const t = text.trim();
  if (t === '') return { value: emptyValue(col) };
  switch (col.type) {
    case 'number': {
      const n = parseNumber(t);
      return n === null ? { value: t, invalid: 'This column takes a number.' } : { value: n };
    }
    case 'percent': {
      const body = t.endsWith('%') ? t.slice(0, -1) : t;
      const n = parseNumber(body);
      return n === null ? { value: t, invalid: 'This column takes a percent, like 75%.' } : { value: Number((n / 100).toPrecision(15)) };
    }
    case 'date': {
      const s = D.parseDateText(t);
      if (s !== null) return { value: D.serialToIso(s) };
      if (/^\d{5}$/.test(t)) return { value: D.serialToIso(+t) }; // a serial day number pasted from a sheet
      return { value: t, invalid: 'Not a date. Type it day first, like 05/06/2026 or 5 Jun 2026.' };
    }
    case 'select': {
      const opts = col.options ?? STATUS_OPTIONS;
      const hit = opts.find((o) => o.toLowerCase() === t.toLowerCase());
      if (hit) return { value: hit };
      const starts = opts.filter((o) => o.toLowerCase().startsWith(t.toLowerCase()));
      if (starts.length === 1) return { value: starts[0] };
      return { value: t, invalid: `Pick one of: ${opts.join(', ')}.` };
    }
    default:
      return { value: text };
  }
}

/** The text shown in a cell. */
export function displayText(value: any, col: ColDef): string {
  if (value === undefined || value === null || value === '') return '';
  if (isErrorText(value)) return value;
  switch (col.type) {
    case 'date': return D.formatDateCell(value);
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) && String(value).trim() !== '' ? `${Math.round(n * 100)}%` : String(value);
    }
    case 'number': return typeof value === 'number' ? numText(value) : String(value);
    default: return String(value);
  }
}

/** The text the editor starts with: the formula, or the value in a form you can type back. */
export function editText(row: any, col: ColDef): string {
  const f = row?.formulas?.[col.key];
  if (isFormulaText(f)) return f;
  const v = row?.[col.key];
  if (v === undefined || v === null) return '';
  if (isErrorText(v)) return '';
  switch (col.type) {
    case 'date': return D.formatDateEdit(v);
    case 'percent': {
      const n = Number(v);
      return Number.isFinite(n) && String(v).trim() !== '' ? `${numText(Number((n * 100).toPrecision(12)))}%` : String(v);
    }
    case 'number': return typeof v === 'number' ? numText(v) : String(v);
    default: return String(v);
  }
}

// ------------------------------------------------------------ clipboard text

/** Rows of cells -> tab-separated text, quoting cells that hold a tab, a new line or a quote. */
export function toTSV(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t'))
    .join('\n');
}

/** Tab-separated text from any spreadsheet -> rows of cells. */
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  const s = text.replace(/\r\n?/g, '\n');
  let quoted = false;
  let cellStart = true;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cellStart) { quoted = true; cellStart = false; i++; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; cellStart = true; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; cellStart = true; i++; continue; }
    cell += ch; cellStart = false; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
