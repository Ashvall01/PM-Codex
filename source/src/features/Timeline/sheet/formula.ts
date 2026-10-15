/**
 * The timeline sheet's formula language: reading a formula (tokens, then a
 * tree) and working it out.
 *
 * It follows Excel and Google Sheets:
 *   - operators  + - * / ^ & % = <> < > <= >=, and ranges H2:H9
 *   - refs       I3, $I$3, I$3; whole columns I:I
 *   - this row   [Target Start], [@Target Start], TARGETSTART (old formulas)
 *   - arguments  split by "," or ";" (Indonesian Excel uses ";")
 *   - dates are day numbers, so date + 5 and date - date just work
 *   - errors     #REF! #VALUE! #DIV/0! #NAME? #NUM! #N/A, #CIRCULAR! for a
 *                loop and #ERROR! when the formula cannot be read
 *
 * Nothing here runs typed text as program code.
 */
import { COLUMNS, colFromLetter, colLetter, findColumnByName } from './columns';
import * as D from './dates';

// ------------------------------------------------------------------ errors

export class FErr {
  constructor(public code: string) {}
  toString() { return this.code; }
}

export const E = {
  REF: '#REF!',
  VALUE: '#VALUE!',
  DIV0: '#DIV/0!',
  NAME: '#NAME?',
  NUM: '#NUM!',
  NA: '#N/A',
  CIRC: '#CIRCULAR!',
  ERROR: '#ERROR!',
} as const;

export const ERROR_CODES: string[] = Object.values(E);

export function isErrorText(v: unknown): boolean {
  return typeof v === 'string' && ERROR_CODES.includes(v);
}

const fail = (code: string): never => { throw new FErr(code); };

// ------------------------------------------------------------------ tokens

export interface RefParts { col: number; row: number; colAbs: boolean; rowAbs: boolean }

export type TokType =
  | 'num' | 'str' | 'bool' | 'date' | 'err' | 'ref' | 'colref' | 'sref' | 'name' | 'func'
  | 'op' | 'lp' | 'rp' | 'sep' | 'colon' | 'bad';

export interface Tok {
  type: TokType;
  text: string;
  start: number; // offset in the full formula text (the "=" is offset 0)
  end: number;
  value?: any;
  ref?: RefParts;
}

const RE_REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(.[])/;
const RE_COLREF = /^(\$?)([A-Za-z]{1,3})(?=\s*:\s*\$?[A-Za-z]{1,3}(?![A-Za-z0-9_(]))/;
const RE_COLREF_END = /^(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(.[])/;
const RE_IDENT = /^[A-Za-z_][A-Za-z0-9_.]*/;
const RE_NUM = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const RE_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
const RE_ERR = /^#(?:REF!|VALUE!|DIV\/0!|NAME\?|NUM!|N\/A|CIRCULAR!|ERROR!)/i;

/**
 * Split a formula into tokens. `text` is the whole cell text, "=" included.
 * Never throws: text it cannot read becomes a 'bad' token.
 */
export function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let i = text.startsWith('=') ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    const rest = text.slice(i);
    const push = (type: TokType, len: number, extra: Partial<Tok> = {}) => {
      toks.push({ type, text: text.slice(i, i + len), start: i, end: i + len, ...extra });
      i += len;
    };
    let m: RegExpMatchArray | null;

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = '';
      while (j < n) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) { s += ch; j += 2; continue; }
          break;
        }
        s += text[j++];
      }
      push('str', Math.min(j + 1, n) - i, { value: s });
      continue;
    }
    if (ch === '[') {
      let depth = 0;
      let j = i;
      while (j < n) {
        if (text[j] === '[') depth++;
        else if (text[j] === ']') { depth--; if (depth === 0) { j++; break; } }
        j++;
      }
      const inner = text.slice(i, j).replace(/[[\]@]/g, '').trim();
      push('sref', j - i, { value: findColumnByName(inner) });
      continue;
    }
    if ((m = rest.match(RE_ERR))) { push('err', m[0].length, { value: m[0].toUpperCase() }); continue; }
    if ((m = rest.match(RE_DATE))) {
      const serial = D.isoToSerial(`${m[1]}-${m[2]}-${m[3]}`);
      if (serial !== null) { push('date', m[0].length, { value: serial }); continue; }
    }
    if ((m = rest.match(RE_REF))) {
      push('ref', m[0].length, {
        ref: { colAbs: !!m[1], col: colFromLetter(m[2]), rowAbs: !!m[3], row: +m[4] - 1 },
      });
      continue;
    }
    // A whole column (I:I). Only when a colon and another column follow, or
    // when it closes one, so a name like "TODAY" is never read as a column.
    const prev = toks[toks.length - 1];
    if ((m = rest.match(RE_COLREF)) ||
        (prev && prev.type === 'colon' && toks[toks.length - 2]?.type === 'colref' && (m = rest.match(RE_COLREF_END)))) {
      push('colref', m[0].length, { ref: { colAbs: !!m[1], col: colFromLetter(m[2]), rowAbs: false, row: -1 } });
      continue;
    }
    if ((m = rest.match(RE_NUM))) { push('num', m[0].length, { value: parseFloat(m[0]) }); continue; }
    if ((m = rest.match(RE_IDENT))) {
      const word = m[0];
      const after = text.slice(i + word.length).match(/^\s*\(/);
      const up = word.toUpperCase();
      if (after) push('func', word.length, { value: up });
      else if (up === 'TRUE' || up === 'FALSE') push('bool', word.length, { value: up === 'TRUE' });
      else push('name', word.length, { value: up });
      continue;
    }
    if (rest.startsWith('<=') || rest.startsWith('>=') || rest.startsWith('<>')) { push('op', 2); continue; }
    if ('+-*/^&=<>%'.includes(ch)) { push('op', 1); continue; }
    if (ch === '(') { push('lp', 1); continue; }
    if (ch === ')') { push('rp', 1); continue; }
    if (ch === ',' || ch === ';') { push('sep', 1); continue; }
    if (ch === ':') { push('colon', 1); continue; }
    push('bad', 1);
  }
  return toks;
}

// ------------------------------------------------------------------ tree

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'date'; v: number }
  | { t: 'err'; v: string }
  | { t: 'ref'; col: number; row: number }
  | { t: 'range'; c1: number; r1: number; c2: number; r2: number }
  | { t: 'sref'; col: number }
  | { t: 'name'; name: string }
  | { t: 'fn'; name: string; args: Node[] }
  | { t: 'un'; op: string; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'missing' };

const BIN_PREC: Record<string, number> = {
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 5,
};

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  expect(type: TokType) {
    const t = this.next();
    if (!t || t.type !== type) fail(E.ERROR);
    return t;
  }

  parse(): Node {
    if (this.toks.length === 0) fail(E.ERROR);
    const node = this.expr(0);
    if (this.i < this.toks.length) fail(E.ERROR);
    return node;
  }

  expr(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.type === 'op' && t.text === '%') { this.next(); left = { t: 'pct', a: left }; continue; }
      if (t.type !== 'op') break;
      const prec = BIN_PREC[t.text];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.expr(prec + 1);
      left = { t: 'bin', op: t.text, a: left, b: right };
    }
    return left;
  }

  unary(): Node {
    const t = this.peek();
    if (t && t.type === 'op' && (t.text === '-' || t.text === '+')) {
      this.next();
      // Negation binds tighter than ^, as in Excel: -2^2 = 4.
      let a = this.unary();
      while (this.peek()?.type === 'op' && this.peek()!.text === '%') { this.next(); a = { t: 'pct', a }; }
      return { t: 'un', op: t.text, a };
    }
    return this.primary();
  }

  primary(): Node {
    const t = this.next();
    if (!t) fail(E.ERROR);
    switch (t.type) {
      case 'num': return { t: 'num', v: t.value };
      case 'str': return { t: 'str', v: t.value };
      case 'bool': return { t: 'bool', v: t.value };
      case 'date': return { t: 'date', v: t.value };
      case 'err': return { t: 'err', v: t.value };
      case 'sref': return { t: 'sref', col: t.value };
      case 'name': return { t: 'name', name: t.value };
      case 'ref': {
        if (this.peek()?.type === 'colon' && this.toks[this.i + 1]?.type === 'ref') {
          this.next();
          const b = this.next().ref!;
          const a = t.ref!;
          return {
            t: 'range',
            c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col),
            r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row),
          };
        }
        return { t: 'ref', col: t.ref!.col, row: t.ref!.row };
      }
      case 'colref': {
        this.expect('colon');
        const b = this.expect('colref').ref!;
        const a = t.ref!;
        return { t: 'range', c1: Math.min(a.col, b.col), c2: Math.max(a.col, b.col), r1: 0, r2: Infinity };
      }
      case 'func': {
        this.expect('lp');
        const args: Node[] = [];
        if (this.peek()?.type === 'rp') { this.next(); return { t: 'fn', name: t.value, args }; }
        for (;;) {
          const p = this.peek();
          if (p && (p.type === 'sep' || p.type === 'rp')) args.push({ t: 'missing' });
          else args.push(this.expr(0));
          const sep = this.next();
          if (!sep) fail(E.ERROR);
          if (sep.type === 'rp') break;
          if (sep.type !== 'sep') fail(E.ERROR);
        }
        return { t: 'fn', name: t.value, args };
      }
      case 'lp': {
        const inner = this.expr(0);
        this.expect('rp');
        return inner;
      }
      default:
        return fail(E.ERROR);
    }
  }
}

const parseCache = new Map<string, Node | FErr>();

/** Formula text ("=…") -> tree. Throws FErr('#ERROR!') when it cannot be read. */
export function parseFormula(text: string): Node {
  let hit = parseCache.get(text);
  if (hit === undefined) {
    try {
      hit = new Parser(tokenize(text)).parse();
    } catch (e) {
      hit = e instanceof FErr ? e : new FErr(E.ERROR);
    }
    if (parseCache.size > 5000) parseCache.clear();
    parseCache.set(text, hit);
  }
  if (hit instanceof FErr) throw hit;
  return hit;
}

export function isFormulaText(v: unknown): v is string {
  return typeof v === 'string' && v.length > 1 && v.startsWith('=');
}

export function formatRef(r: RefParts): string {
  return `${r.colAbs ? '$' : ''}${colLetter(r.col)}${r.rowAbs ? '$' : ''}${r.row + 1}`;
}

// ------------------------------------------------------------------ values

export type Scalar = number | string | boolean | null;

export class Grid {
  constructor(public r1: number, public c1: number, public cells: Scalar[][]) {}
  get rows() { return this.cells.length; }
  get cols() { return this.cells[0]?.length ?? 0; }
  flat(): Scalar[] { return this.cells.flat(); }
}

export type Val = Scalar | Grid;

/** What the engine needs from the sheet around it. */
export interface Host {
  rowCount: number;
  /** A cell's value. Dates come back as day numbers. May throw FErr. */
  cell(row: number, col: number): Scalar;
  /** The row the formula sits in (0-based), or null. */
  thisRow: number | null;
  /** For a row that is not in the sheet yet (a proposed row). */
  thisRowCell?: (col: number) => Scalar;
  holidays: number[];
  today: number;
}

export function toNum(v: Scalar): number {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail(E.NUM);
    return v;
  }
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = v.trim();
  if (s === '') return fail(E.VALUE);
  const pct = s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*%$/);
  if (pct) return parseFloat(pct[1]) / 100;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
  const d = D.parseDateText(s);
  if (d !== null) return d;
  return fail(E.VALUE);
}

export function numText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function toText(v: Scalar): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return numText(v);
  return v;
}

export function toBool(v: Scalar): boolean {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  const s = v.trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  return fail(E.VALUE);
}

const typeRank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);

/** Excel's order: numbers < text < TRUE/FALSE; text ignores case; blank = 0 / "" / FALSE. */
export function compare(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === 'number' ? 0 : typeof b === 'string' ? '' : false;
  if (b === null) b = typeof a === 'number' ? 0 : typeof a === 'string' ? '' : false;
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') {
    const x = a.toLowerCase(), y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(a), y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// ------------------------------------------------------------------ evaluator

export class Args {
  constructor(public nodes: Node[], public ev: Evaluator) {}
  get length() { return this.nodes.length; }
  has(i: number) { return i < this.nodes.length && this.nodes[i].t !== 'missing'; }
  node(i: number) { return this.nodes[i]; }
  raw(i: number): Val { return this.has(i) ? this.ev.eval(this.nodes[i]) : null; }
  val(i: number): Scalar { return this.has(i) ? this.ev.scalar(this.nodes[i]) : null; }
  num(i: number, def?: number): number {
    if (!this.has(i)) { if (def !== undefined) return def; }
    return toNum(this.val(i));
  }
  int(i: number, def?: number): number { return Math.trunc(this.num(i, def)); }
  str(i: number, def?: string): string {
    if (!this.has(i) && def !== undefined) return def;
    return toText(this.val(i));
  }
  bool(i: number, def?: boolean): boolean {
    if (!this.has(i) && def !== undefined) return def;
    return toBool(this.val(i));
  }
  grid(i: number): Grid {
    const v = this.raw(i);
    return v instanceof Grid ? v : new Grid(-1, -1, [[v]]);
  }
  flat(i: number): Scalar[] {
    const v = this.raw(i);
    return v instanceof Grid ? v.flat() : [v];
  }
  isRange(i: number): boolean {
    const n = this.nodes[i];
    return !!n && (n.t === 'range' || n.t === 'ref' || n.t === 'sref' || (n.t === 'name' && n.name === 'HOLIDAYS'));
  }
}

export type Fn = (a: Args) => Val;

export class Evaluator {
  constructor(public host: Host, public funcs: Record<string, Fn>) {}

  eval(n: Node): Val {
    const h = this.host;
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'date': return n.v;
      case 'err': return fail(n.v);
      case 'missing': return null;
      case 'ref':
        if (n.col < 0 || n.col >= COLUMNS.length || n.row < 0) return fail(E.REF);
        if (n.row >= h.rowCount) return null;
        return h.cell(n.row, n.col);
      case 'sref': return this.thisRowCell(n.col);
      case 'range': {
        if (n.c1 < 0 || n.c2 >= COLUMNS.length || n.r1 < 0) return fail(E.REF);
        const r2 = Math.min(n.r2, h.rowCount - 1);
        const cells: Scalar[][] = [];
        for (let r = n.r1; r <= r2; r++) {
          const row: Scalar[] = [];
          for (let c = n.c1; c <= n.c2; c++) row.push(h.cell(r, c));
          cells.push(row);
        }
        if (cells.length === 0) cells.push(new Array(n.c2 - n.c1 + 1).fill(null));
        return new Grid(n.r1, n.c1, cells);
      }
      case 'name': {
        if (n.name === 'HOLIDAYS') return new Grid(-1, -1, h.holidays.map((d) => [d]));
        const col = findColumnByName(n.name);
        if (col >= 0) return this.thisRowCell(col);
        return fail(E.NAME);
      }
      case 'fn': {
        const f = this.funcs[n.name] ?? this.funcs[n.name.replace(/^_XLFN\./, '')];
        if (!f) return fail(E.NAME);
        return f(new Args(n.args, this));
      }
      case 'un': {
        const v = this.scalar(n.a);
        return n.op === '-' ? -toNum(v) : v;
      }
      case 'pct': return toNum(this.scalar(n.a)) / 100;
      case 'bin': {
        const a = this.scalar(n.a);
        const b = this.scalar(n.b);
        switch (n.op) {
          case '+': return finite(toNum(a) + toNum(b));
          case '-': return finite(toNum(a) - toNum(b));
          case '*': return finite(toNum(a) * toNum(b));
          case '/': { const d = toNum(b); if (d === 0) return fail(E.DIV0); return finite(toNum(a) / d); }
          case '^': return finite(Math.pow(toNum(a), toNum(b)));
          case '&': return toText(a) + toText(b);
          case '=': return compare(a, b) === 0;
          case '<>': return compare(a, b) !== 0;
          case '<': return compare(a, b) < 0;
          case '>': return compare(a, b) > 0;
          case '<=': return compare(a, b) <= 0;
          case '>=': return compare(a, b) >= 0;
        }
        return fail(E.ERROR);
      }
    }
    return fail(E.ERROR);
  }

  thisRowCell(col: number): Scalar {
    const h = this.host;
    if (col < 0 || col >= COLUMNS.length) return fail(E.REF);
    if (h.thisRowCell) return h.thisRowCell(col);
    if (h.thisRow === null) return fail(E.REF);
    return h.cell(h.thisRow, col);
  }

  /** One value. A range gives the cell in this row (Excel's "implicit intersection"). */
  scalar(n: Node): Scalar {
    const v = this.eval(n);
    if (!(v instanceof Grid)) return v;
    if (v.rows === 1 && v.cols === 1) return v.cells[0][0];
    const r = this.host.thisRow;
    if (v.cols === 1 && r !== null && v.r1 >= 0 && r >= v.r1 && r < v.r1 + v.rows) return v.cells[r - v.r1][0];
    return fail(E.VALUE);
  }
}

function finite(n: number): number {
  if (!Number.isFinite(n)) fail(E.NUM);
  return n;
}

// ------------------------------------------------------------------ date hint

const DATE_FUNCS = new Set(['DATE', 'DATEVALUE', 'TODAY', 'NOW', 'WORKDAY', 'WORKDAY.INTL', 'EDATE', 'EOMONTH']);
const PASS_FUNCS: Record<string, number[] | 'all'> = {
  MIN: 'all', MAX: 'all', IF: [1, 2], IFERROR: [0, 1], IFNA: [0, 1], INDEX: [0], XLOOKUP: [2], VLOOKUP: [1],
  CHOOSE: 'all', IFS: 'all', SWITCH: 'all', MINIFS: [0], MAXIFS: [0], LARGE: [0], SMALL: [0], MEDIAN: 'all',
};

/**
 * Does this formula give a date? Excel decides by the cells it reads; this is
 * the same idea. Only used to show a date nicely in a text column.
 */
export function isDateExpr(n: Node): boolean {
  switch (n.t) {
    case 'date': return true;
    case 'ref': case 'sref': return COLUMNS[n.col]?.type === 'date';
    case 'range': return COLUMNS[n.c1]?.type === 'date';
    case 'name': { const c = findColumnByName(n.name); return c >= 0 && COLUMNS[c].type === 'date'; }
    case 'fn': {
      if (DATE_FUNCS.has(n.name)) return true;
      const pass = PASS_FUNCS[n.name];
      if (!pass) return false;
      const idx = pass === 'all' ? n.args.map((_, i) => i) : pass;
      return idx.some((i) => n.args[i] && isDateExpr(n.args[i]));
    }
    case 'bin':
      if (n.op === '+') return isDateExpr(n.a) !== isDateExpr(n.b);
      if (n.op === '-') return isDateExpr(n.a) && !isDateExpr(n.b);
      return false;
    default: return false;
  }
}
