/**
 * The functions a timeline formula can call. Each one follows Excel's rules
 * (the same as Google Sheets for everything listed here).
 */
import * as D from './dates';
import {
  Args, E, FErr, Fn, Grid, Scalar, Val, compare, numText, toBool, toNum, toText,
} from './formula';

const fail = (code: string): never => { throw new FErr(code); };

// ------------------------------------------------------------------ helpers

/** Numbers for SUM, MIN, AVERAGE…: ranges give only their numbers; typed values are converted. */
function numbers(a: Args, from = 0): number[] {
  const out: number[] = [];
  for (let i = from; i < a.length; i++) {
    if (!a.has(i)) continue;
    const v = a.raw(i);
    if (v instanceof Grid) {
      for (const x of v.flat()) if (typeof x === 'number') out.push(x);
    } else if (a.isRange(i)) {
      if (typeof v === 'number') out.push(v);
    } else {
      out.push(toNum(v));
    }
  }
  return out;
}

function roundHalfAway(x: number, digits: number): number {
  const f = Math.pow(10, digits);
  const y = Number((Math.abs(x) * f).toPrecision(15));
  return (Math.sign(x) * Math.round(y)) / f;
}

function day(v: number): number {
  if (v < 0) fail(E.NUM);
  return Math.floor(v);
}

/** Weekend days for WORKDAY.INTL / NETWORKDAYS.INTL. Index = day of week, 0 = Sunday. */
function weekendMask(a: Args, i: number): boolean[] {
  const mask = [false, false, false, false, false, false, false];
  if (!a.has(i)) { mask[0] = mask[6] = true; return mask; }
  const v = a.val(i);
  if (typeof v === 'string' && /^[01]{7}$/.test(v)) {
    for (let k = 0; k < 7; k++) mask[(k + 1) % 7] = v[k] === '1';
    if (mask.every(Boolean)) fail(E.VALUE);
    return mask;
  }
  if (typeof v === 'string' && !/^\d+$/.test(v.trim())) fail(E.VALUE);
  const code = Math.trunc(toNum(v));
  if (code >= 1 && code <= 7) { mask[(code + 5) % 7] = true; mask[(code + 6) % 7] = true; return mask; }
  if (code >= 11 && code <= 17) { mask[code - 11] = true; return mask; }
  return fail(E.NUM);
}

/** Holiday dates: the given range or list, or the project's list when left out. */
function holidays(a: Args, i: number): Set<number> {
  const out = new Set<number>();
  const list: Scalar[] = a.has(i) ? a.flat(i) : a.ev.host.holidays;
  for (const v of list) {
    if (v === null || v === '') continue;
    if (typeof v === 'number') out.add(Math.floor(v));
    else if (typeof v === 'string') {
      const s = D.parseDateText(v);
      if (s === null) fail(E.VALUE);
      out.add(s as number);
    } else fail(E.VALUE);
  }
  return out;
}

function workday(start: number, days: number, mask: boolean[], hol: Set<number>): number {
  let d = day(start);
  const n = Math.trunc(days);
  if (Math.abs(n) > 1e6) fail(E.NUM);
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  while (left > 0) {
    d += step;
    if (!mask[D.dayOfWeek(d)] && !hol.has(d)) left--;
  }
  return d;
}

function networkdays(start: number, end: number, mask: boolean[], hol: Set<number>): number {
  let s = day(start), e = day(end), sign = 1;
  if (s > e) { [s, e] = [e, s]; sign = -1; }
  if (e - s > 1e6) fail(E.NUM);
  let count = 0;
  for (let d = s; d <= e; d++) if (!mask[D.dayOfWeek(d)] && !hol.has(d)) count++;
  return sign * count;
}

function ymd(a: Args, i: number) { return D.serialToYmd(day(a.num(i))); }

/** Excel criteria: 5, ">=5", "<>Done", "Work*", "" … */
function criteria(c: Scalar): (v: Scalar) => boolean {
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => v !== null && compare(v, c) === 0;
  if (c === null) return (v) => v === null || v === '';
  const m = c.match(/^(<=|>=|<>|=|<|>)?(.*)$/s)!;
  const op = m[1] || '=';
  const rest = m[2];
  let target: Scalar = rest;
  const asNum = rest.trim() !== '' && /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?%?$/i.test(rest.trim())
    ? toNum(rest.trim())
    : D.parseDateText(rest);
  if (asNum !== null && asNum !== undefined) target = asNum;
  if (rest === '') {
    if (op === '=') return (v) => v === null || v === '';
    if (op === '<>') return (v) => !(v === null || v === '');
  }
  if (typeof target === 'string' && (op === '=' || op === '<>')) {
    const re = new RegExp('^' + target.replace(/~([*?~])|([.+^${}()|[\]\\])|(\*)|(\?)/g,
      (_, esc, special, star, q) => esc ? '\\' + esc : special ? '\\' + special : star ? '.*' : q ? '.' : _) + '$', 'is');
    return op === '=' ? (v) => v !== null && re.test(toText(v)) : (v) => !(v !== null && re.test(toText(v)));
  }
  return (v) => {
    if (v === null) return op === '<>';
    if (typeof target === 'number' && typeof v !== 'number') return op === '<>';
    const r = compare(v, target);
    switch (op) {
      case '=': return r === 0;
      case '<>': return r !== 0;
      case '<': return r < 0;
      case '>': return r > 0;
      case '<=': return r <= 0;
      default: return r >= 0;
    }
  };
}

/** Pairs of (range, criteria) starting at `from`; returns which cells pass all. */
function ifsMask(a: Args, from: number): { pass: boolean[]; shape: Grid } {
  let pass: boolean[] | null = null;
  let shape: Grid | null = null;
  for (let i = from; i < a.length; i += 2) {
    const g = a.grid(i);
    const test = criteria(a.val(i + 1));
    const cells = g.flat();
    if (pass && cells.length !== pass.length) fail(E.VALUE);
    pass = cells.map((v, k) => (pass ? pass[k] : true) && test(v));
    shape = shape ?? g;
  }
  if (!pass || !shape) return fail(E.VALUE);
  return { pass, shape };
}

function formatNumber(n: number, fmt: string): string {
  const m = fmt.match(/^([^#0.,%]*)([#0,]*)(?:\.([0#]+))?(%?)(.*)$/);
  if (!m) return numText(n);
  const [, pre, intPart, dec = '', pct, post] = m;
  let x = pct ? n * 100 : n;
  const decimals = dec.length;
  x = roundHalfAway(x, decimals);
  let [i, f = ''] = Math.abs(x).toFixed(decimals).split('.');
  if (intPart.includes(',')) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const minInt = (intPart.replace(/[^0]/g, '')).length;
  if (i === '0' && minInt === 0 && intPart !== '') i = '';
  const minDec = (dec.match(/^0*/) as RegExpMatchArray)[0].length;
  while (f.length > minDec && f.endsWith('0')) f = f.slice(0, -1);
  return `${x < 0 ? '-' : ''}${pre}${i}${f ? '.' + f : ''}${pct}${post}`;
}

function formatDate(serial: number, fmt: string): string {
  const [y, m, d] = D.serialToYmd(serial);
  const dow = D.dayOfWeek(serial);
  const pad = (n: number) => String(n).padStart(2, '0');
  let out = '';
  let i = 0;
  while (i < fmt.length) {
    const rest = fmt.slice(i);
    const lower = rest.toLowerCase();
    if (rest[0] === '"') { const j = rest.indexOf('"', 1); out += rest.slice(1, j < 0 ? undefined : j); i += j < 0 ? rest.length : j + 1; continue; }
    if (rest[0] === '\\') { out += rest[1] ?? ''; i += 2; continue; }
    const tok = ['yyyy', 'mmmm', 'dddd', 'mmm', 'ddd', 'yy', 'mm', 'dd', 'm', 'd'].find((t) => lower.startsWith(t));
    if (!tok) { out += rest[0]; i++; continue; }
    switch (tok) {
      case 'yyyy': out += String(y); break;
      case 'yy': out += pad(y % 100); break;
      case 'mmmm': out += D.MONTH_LONG[m - 1]; break;
      case 'mmm': out += D.MONTH_SHORT[m - 1]; break;
      case 'mm': out += pad(m); break;
      case 'm': out += String(m); break;
      case 'dddd': out += D.DAY_LONG[dow]; break;
      case 'ddd': out += D.DAY_SHORT[dow]; break;
      case 'dd': out += pad(d); break;
      case 'd': out += String(d); break;
    }
    i += tok.length;
  }
  return out;
}

function lookupIndex(v: Scalar, cells: Scalar[], mode: number): number {
  if (mode === 0) {
    const test = typeof v === 'string' ? criteria('=' + v) : (x: Scalar) => x !== null && compare(x, v) === 0;
    return cells.findIndex((x) => test(x));
  }
  let best = -1;
  for (let k = 0; k < cells.length; k++) {
    const x = cells[k];
    if (x === null || typeof x !== typeof v) continue;
    const r = compare(x, v);
    if (mode > 0 ? r <= 0 : r >= 0) best = k;
    else break;
  }
  return best;
}

// ------------------------------------------------------------------ table

export const FUNCS: Record<string, Fn> = {
  // ---- dates
  TODAY: (a) => a.ev.host.today,
  NOW: (a) => a.ev.host.today,
  DATE: (a) => {
    let y = a.int(0);
    if (y < 0 || y > 9999) fail(E.NUM);
    if (y < 1900) y += 1900;
    const s = D.ymdToSerial(y, a.int(1), a.int(2));
    return s < 0 ? fail(E.NUM) : s;
  },
  DATEVALUE: (a) => { const s = D.parseDateText(a.str(0)); return s === null ? fail(E.VALUE) : s; },
  YEAR: (a) => ymd(a, 0)[0],
  MONTH: (a) => ymd(a, 0)[1],
  DAY: (a) => ymd(a, 0)[2],
  WEEKDAY: (a) => {
    const dow = D.dayOfWeek(day(a.num(0)));
    const type = a.int(1, 1);
    if (type === 1 || type === 17) return dow + 1;
    if (type === 2 || type === 11) return ((dow + 6) % 7) + 1;
    if (type === 3) return (dow + 6) % 7;
    if (type >= 12 && type <= 16) return ((dow - (type - 10) + 7) % 7) + 1;
    return fail(E.NUM);
  },
  WEEKNUM: (a) => {
    const s = day(a.num(0));
    const type = a.int(1, 1);
    if (type === 21) return FUNCS.ISOWEEKNUM(a);
    let start: number;
    if (type === 1 || type === 17) start = 0;
    else if (type === 2 || type === 11) start = 1;
    else if (type >= 12 && type <= 16) start = type - 10;
    else return fail(E.NUM);
    const [y] = D.serialToYmd(s);
    const jan1 = D.ymdToSerial(y, 1, 1);
    const offset = (D.dayOfWeek(jan1) - start + 7) % 7;
    return Math.floor((s - jan1 + offset) / 7) + 1;
  },
  ISOWEEKNUM: (a) => {
    const s = day(a.num(0));
    const thursday = s - ((D.dayOfWeek(s) + 6) % 7) + 3;
    const [ty] = D.serialToYmd(thursday);
    return Math.floor((thursday - D.ymdToSerial(ty, 1, 1)) / 7) + 1;
  },
  EDATE: (a) => {
    const [y, m, d] = ymd(a, 0);
    const total = m - 1 + a.int(1);
    const ny = y + Math.floor(total / 12);
    const nm = (((total % 12) + 12) % 12) + 1;
    const s = D.ymdToSerial(ny, nm, Math.min(d, D.daysInMonth(ny, nm)));
    return s < 0 ? fail(E.NUM) : s;
  },
  EOMONTH: (a) => {
    const [y, m] = ymd(a, 0);
    const s = D.ymdToSerial(y, m + a.int(1) + 1, 0);
    return s < 0 ? fail(E.NUM) : s;
  },
  DAYS: (a) => day(a.num(0)) - day(a.num(1)),
  DATEDIF: (a) => {
    const s = day(a.num(0)), e = day(a.num(1));
    if (s > e) fail(E.NUM);
    const unit = a.str(2).toUpperCase();
    const [sy, sm, sd] = D.serialToYmd(s);
    const [ey, em, ed] = D.serialToYmd(e);
    const months = (ey - sy) * 12 + (em - sm) - (ed < sd ? 1 : 0);
    switch (unit) {
      case 'D': return e - s;
      case 'M': return months;
      case 'Y': return Math.floor(months / 12);
      case 'YM': return months % 12;
      case 'MD': return ed >= sd ? ed - sd : e - D.ymdToSerial(ey, em - 1, sd);
      case 'YD': {
        let t = D.ymdToSerial(ey, sm, Math.min(sd, D.daysInMonth(ey, sm)));
        if (t > e) t = D.ymdToSerial(ey - 1, sm, Math.min(sd, D.daysInMonth(ey - 1, sm)));
        return e - t;
      }
    }
    return fail(E.NUM);
  },
  WORKDAY: (a) => {
    const mask = [true, false, false, false, false, false, true];
    return workday(a.num(0), a.num(1), mask, holidays(a, 2));
  },
  'WORKDAY.INTL': (a) => workday(a.num(0), a.num(1), weekendMask(a, 2), holidays(a, 3)),
  NETWORKDAYS: (a) => {
    const mask = [true, false, false, false, false, false, true];
    return networkdays(a.num(0), a.num(1), mask, holidays(a, 2));
  },
  'NETWORKDAYS.INTL': (a) => networkdays(a.num(0), a.num(1), weekendMask(a, 2), holidays(a, 3)),

  // ---- logic
  IF: (a) => {
    const c = toBool(a.val(0));
    if (c) return a.has(1) ? a.val(1) : 0;
    if (a.length < 3) return false;
    return a.has(2) ? a.val(2) : 0;
  },
  IFS: (a) => {
    for (let i = 0; i + 1 < a.length; i += 2) if (toBool(a.val(i))) return a.val(i + 1);
    return fail(E.NA);
  },
  SWITCH: (a) => {
    const v = a.val(0);
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (compare(v, a.val(i)) === 0) return a.val(i + 1);
    return i < a.length ? a.val(i) : fail(E.NA);
  },
  IFERROR: (a) => { try { return a.val(0); } catch (e) { if (e instanceof FErr) return a.val(1); throw e; } },
  IFNA: (a) => { try { return a.val(0); } catch (e) { if (e instanceof FErr && e.code === E.NA) return a.val(1); throw e; } },
  AND: (a) => logic(a, (xs) => xs.every(Boolean)),
  OR: (a) => logic(a, (xs) => xs.some(Boolean)),
  XOR: (a) => logic(a, (xs) => xs.filter(Boolean).length % 2 === 1),
  NOT: (a) => !toBool(a.val(0)),
  TRUE: () => true,
  FALSE: () => false,
  ISBLANK: (a) => { const v = a.val(0); return v === null || v === ''; },
  ISNUMBER: (a) => { try { return typeof a.val(0) === 'number'; } catch { return false; } },
  ISTEXT: (a) => { try { return typeof a.val(0) === 'string'; } catch { return false; } },
  ISLOGICAL: (a) => { try { return typeof a.val(0) === 'boolean'; } catch { return false; } },
  ISERROR: (a) => { try { a.val(0); return false; } catch (e) { if (e instanceof FErr) return true; throw e; } },
  ISNA: (a) => { try { a.val(0); return false; } catch (e) { if (e instanceof FErr) return e.code === E.NA; throw e; } },
  NA: () => fail(E.NA),

  // ---- maths
  SUM: (a) => numbers(a).reduce((s, x) => s + x, 0),
  PRODUCT: (a) => numbers(a).reduce((s, x) => s * x, 1),
  AVERAGE: (a) => { const xs = numbers(a); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : fail(E.DIV0); },
  MIN: (a) => { const xs = numbers(a); return xs.length ? Math.min(...xs) : 0; },
  MAX: (a) => { const xs = numbers(a); return xs.length ? Math.max(...xs) : 0; },
  MEDIAN: (a) => {
    const xs = numbers(a).sort((x, y) => x - y);
    if (!xs.length) return fail(E.NUM);
    const mid = xs.length >> 1;
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  },
  LARGE: (a) => { const xs = numbers(a, 0).sort((x, y) => y - x); const k = a.int(1); return k >= 1 && k <= xs.length ? xs[k - 1] : fail(E.NUM); },
  SMALL: (a) => { const xs = numbers(a, 0).sort((x, y) => x - y); const k = a.int(1); return k >= 1 && k <= xs.length ? xs[k - 1] : fail(E.NUM); },
  COUNT: (a) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      if (!a.has(i)) continue;
      const v = a.raw(i);
      if (v instanceof Grid) n += v.flat().filter((x) => typeof x === 'number').length;
      else if (typeof v === 'number') n++;
      else if (!a.isRange(i)) { try { toNum(v); n++; } catch { /* not a number */ } }
    }
    return n;
  },
  COUNTA: (a) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      if (!a.has(i)) continue;
      const v = a.raw(i);
      if (v instanceof Grid) n += v.flat().filter((x) => x !== null && x !== '').length;
      else if (v !== null) n++;
    }
    return n;
  },
  COUNTBLANK: (a) => a.flat(0).filter((x) => x === null || x === '').length,
  ROUND: (a) => roundHalfAway(a.num(0), a.int(1, 0)),
  ROUNDUP: (a) => { const f = Math.pow(10, a.int(1, 0)); const x = a.num(0); return Math.sign(x) * Math.ceil(Number((Math.abs(x) * f).toPrecision(15))) / f; },
  ROUNDDOWN: (a) => { const f = Math.pow(10, a.int(1, 0)); const x = a.num(0); return Math.sign(x) * Math.floor(Number((Math.abs(x) * f).toPrecision(15))) / f; },
  TRUNC: (a) => FUNCS.ROUNDDOWN(a),
  INT: (a) => Math.floor(a.num(0)),
  ABS: (a) => Math.abs(a.num(0)),
  SIGN: (a) => Math.sign(a.num(0)),
  MOD: (a) => { const n = a.num(0), d = a.num(1); if (d === 0) fail(E.DIV0); return n - d * Math.floor(n / d); },
  POWER: (a) => Math.pow(a.num(0), a.num(1)),
  SQRT: (a) => { const x = a.num(0); return x < 0 ? fail(E.NUM) : Math.sqrt(x); },
  CEILING: (a) => { const x = a.num(0), s = a.num(1, 1); if (s === 0) return 0; return Math.ceil(Number((x / s).toPrecision(15))) * s; },
  FLOOR: (a) => { const x = a.num(0), s = a.num(1, 1); if (s === 0) return fail(E.DIV0); return Math.floor(Number((x / s).toPrecision(15))) * s; },
  SUMPRODUCT: (a) => {
    const grids = Array.from({ length: a.length }, (_, i) => a.grid(i).flat());
    const len = grids[0]?.length ?? 0;
    if (grids.some((g) => g.length !== len)) fail(E.VALUE);
    let s = 0;
    for (let k = 0; k < len; k++) s += grids.reduce((p, g) => p * (typeof g[k] === 'number' ? (g[k] as number) : 0), 1);
    return s;
  },
  SUMIF: (a) => {
    const test = criteria(a.val(1));
    const range = a.flat(0);
    const sums = a.has(2) ? a.flat(2) : range;
    return range.reduce<number>((s, v, k) => s + (test(v) && typeof sums[k] === 'number' ? (sums[k] as number) : 0), 0);
  },
  COUNTIF: (a) => { const test = criteria(a.val(1)); return a.flat(0).filter((v) => test(v)).length; },
  AVERAGEIF: (a) => {
    const test = criteria(a.val(1));
    const range = a.flat(0);
    const vals = a.has(2) ? a.flat(2) : range;
    const xs = range.map((v, k) => (test(v) && typeof vals[k] === 'number' ? (vals[k] as number) : null)).filter((x) => x !== null) as number[];
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : fail(E.DIV0);
  },
  SUMIFS: (a) => {
    const sums = a.flat(0);
    const { pass } = ifsMask(a, 1);
    if (pass.length !== sums.length) fail(E.VALUE);
    return sums.reduce<number>((s, v, k) => s + (pass[k] && typeof v === 'number' ? v : 0), 0);
  },
  COUNTIFS: (a) => ifsMask(a, 0).pass.filter(Boolean).length,
  MAXIFS: (a) => {
    const vals = a.flat(0);
    const { pass } = ifsMask(a, 1);
    const xs = vals.filter((v, k) => pass[k] && typeof v === 'number') as number[];
    return xs.length ? Math.max(...xs) : 0;
  },
  MINIFS: (a) => {
    const vals = a.flat(0);
    const { pass } = ifsMask(a, 1);
    const xs = vals.filter((v, k) => pass[k] && typeof v === 'number') as number[];
    return xs.length ? Math.min(...xs) : 0;
  },

  // ---- text
  CONCAT: (a) => { let s = ''; for (let i = 0; i < a.length; i++) s += a.flat(i).map(toText).join(''); return s; },
  CONCATENATE: (a) => FUNCS.CONCAT(a),
  TEXTJOIN: (a) => {
    const sep = a.str(0);
    const skip = a.bool(1, true);
    const parts: string[] = [];
    for (let i = 2; i < a.length; i++) for (const v of a.flat(i)) { const t = toText(v); if (!skip || t !== '') parts.push(t); }
    return parts.join(sep);
  },
  LEFT: (a) => { const n = a.int(1, 1); if (n < 0) fail(E.VALUE); return a.str(0).slice(0, n); },
  RIGHT: (a) => { const n = a.int(1, 1); if (n < 0) fail(E.VALUE); const s = a.str(0); return n === 0 ? '' : s.slice(-n); },
  MID: (a) => { const s = a.str(0), st = a.int(1), n = a.int(2); if (st < 1 || n < 0) fail(E.VALUE); return s.substr(st - 1, n); },
  LEN: (a) => a.str(0).length,
  UPPER: (a) => a.str(0).toUpperCase(),
  LOWER: (a) => a.str(0).toLowerCase(),
  PROPER: (a) => a.str(0).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, p, c) => p + c.toUpperCase()),
  TRIM: (a) => a.str(0).trim().replace(/ {2,}/g, ' '),
  REPT: (a) => { const n = a.int(1); if (n < 0) fail(E.VALUE); return a.str(0).repeat(n); },
  SUBSTITUTE: (a) => {
    const s = a.str(0), from = a.str(1), to = a.str(2);
    if (!from) return s;
    if (!a.has(3)) return s.split(from).join(to);
    const nth = a.int(3);
    let idx = -1;
    for (let k = 0; k < nth; k++) { idx = s.indexOf(from, idx + 1); if (idx < 0) return s; }
    return s.slice(0, idx) + to + s.slice(idx + from.length);
  },
  FIND: (a) => { const i = a.str(1).indexOf(a.str(0), a.int(2, 1) - 1); return i < 0 ? fail(E.VALUE) : i + 1; },
  SEARCH: (a) => { const i = a.str(1).toLowerCase().indexOf(a.str(0).toLowerCase(), a.int(2, 1) - 1); return i < 0 ? fail(E.VALUE) : i + 1; },
  VALUE: (a) => toNum(a.str(0)),
  TEXT: (a) => {
    const v = a.val(0);
    const fmt = a.str(1);
    if (fmt === '@') return toText(v);
    if (/[dmy]/i.test(fmt.replace(/"[^"]*"/g, ''))) return formatDate(day(toNum(v)), fmt);
    if (typeof v === 'string' && !/^[\d.+-]/.test(v.trim())) return v;
    return formatNumber(toNum(v), fmt);
  },

  // ---- lookup
  ROW: (a) => {
    if (a.has(0)) { const n = a.node(0); if (n.t === 'ref') return n.row + 1; if (n.t === 'range') return n.r1 + 1; }
    const r = a.ev.host.thisRow;
    return r === null ? fail(E.REF) : r + 1;
  },
  COLUMN: (a) => {
    if (a.has(0)) { const n = a.node(0); if (n.t === 'ref') return n.col + 1; if (n.t === 'range') return n.c1 + 1; }
    return fail(E.REF);
  },
  ROWS: (a) => a.grid(0).rows,
  COLUMNS: (a) => a.grid(0).cols,
  CHOOSE: (a) => { const i = a.int(0); return i >= 1 && i < a.length ? a.val(i) : fail(E.VALUE); },
  INDEX: (a) => {
    const g = a.grid(0);
    let r = a.int(1, 0), c = a.int(2, 0);
    if (g.rows === 1 && !a.has(2)) { c = r; r = 1; }
    if (r === 0) r = 1;
    if (c === 0) c = 1;
    if (r < 1 || r > g.rows || c < 1 || c > g.cols) fail(E.REF);
    return g.cells[r - 1][c - 1];
  },
  MATCH: (a) => {
    const i = lookupIndex(a.val(0), a.flat(1), a.int(2, 1));
    return i < 0 ? fail(E.NA) : i + 1;
  },
  XLOOKUP: (a) => {
    const i = lookupIndex(a.val(0), a.flat(1), 0);
    if (i < 0) return a.has(3) ? a.val(3) : fail(E.NA);
    const back = a.flat(2);
    return i < back.length ? back[i] : fail(E.VALUE);
  },
  VLOOKUP: (a) => {
    const g = a.grid(1);
    const col = a.int(2);
    if (col < 1 || col > g.cols) fail(E.REF);
    const approx = a.has(3) ? toBool(a.val(3)) : true;
    const i = lookupIndex(a.val(0), g.cells.map((r) => r[0]), approx ? 1 : 0);
    return i < 0 ? fail(E.NA) : g.cells[i][col - 1];
  },
};

function logic(a: Args, f: (xs: boolean[]) => boolean): boolean {
  const xs: boolean[] = [];
  for (let i = 0; i < a.length; i++) {
    if (!a.has(i)) continue;
    const v = a.raw(i);
    if (v instanceof Grid) {
      for (const x of v.flat()) if (typeof x === 'boolean' || typeof x === 'number') xs.push(toBool(x));
    } else xs.push(toBool(v as Scalar));
  }
  if (!xs.length) fail(E.VALUE);
  return f(xs);
}

/** For the formula hint: how each function is called, and what it does. */
export const FUNCTION_HELP: Record<string, { sig: string; help: string }> = {
  WORKDAY: { sig: 'WORKDAY(start_date, days, [holidays])', help: 'The date that is a number of working days away. Skips weekends and the project holidays.' },
  'WORKDAY.INTL': { sig: 'WORKDAY.INTL(start_date, days, [weekend], [holidays])', help: 'Like WORKDAY, with your own weekend. weekend: 1 = Sat+Sun, 11 = Sun only, or "0000011".' },
  NETWORKDAYS: { sig: 'NETWORKDAYS(start_date, end_date, [holidays])', help: 'How many working days are between two dates, both counted.' },
  'NETWORKDAYS.INTL': { sig: 'NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])', help: 'Like NETWORKDAYS, with your own weekend.' },
  EDATE: { sig: 'EDATE(start_date, months)', help: 'The same day, a number of months later (or earlier).' },
  EOMONTH: { sig: 'EOMONTH(start_date, months)', help: 'The last day of the month, a number of months away.' },
  DATEDIF: { sig: 'DATEDIF(start_date, end_date, unit)', help: 'The time between two dates. unit: "D" days, "M" months, "Y" years.' },
  DAYS: { sig: 'DAYS(end_date, start_date)', help: 'The number of days between two dates.' },
  DATE: { sig: 'DATE(year, month, day)', help: 'Makes a date from a year, a month and a day.' },
  DATEVALUE: { sig: 'DATEVALUE(text)', help: 'Changes text like "12/05/2026" into a date.' },
  TODAY: { sig: 'TODAY()', help: "Today's date. It changes each day." },
  YEAR: { sig: 'YEAR(date)', help: 'The year of a date.' },
  MONTH: { sig: 'MONTH(date)', help: 'The month of a date, 1 to 12.' },
  DAY: { sig: 'DAY(date)', help: 'The day of the month, 1 to 31.' },
  WEEKDAY: { sig: 'WEEKDAY(date, [type])', help: 'The day of the week. type 1: Sunday = 1. type 2: Monday = 1.' },
  WEEKNUM: { sig: 'WEEKNUM(date, [type])', help: 'The week number in the year.' },
  ISOWEEKNUM: { sig: 'ISOWEEKNUM(date)', help: 'The ISO week number (weeks start on Monday).' },
  IF: { sig: 'IF(test, value_if_true, [value_if_false])', help: 'One value when the test is true, another when it is false.' },
  IFS: { sig: 'IFS(test1, value1, [test2, value2], …)', help: 'The value of the first test that is true.' },
  IFERROR: { sig: 'IFERROR(value, value_if_error)', help: 'Shows another value when the first one is an error.' },
  AND: { sig: 'AND(test1, [test2], …)', help: 'TRUE when all tests are true.' },
  OR: { sig: 'OR(test1, [test2], …)', help: 'TRUE when one test or more is true.' },
  NOT: { sig: 'NOT(test)', help: 'Turns TRUE into FALSE, and FALSE into TRUE.' },
  SWITCH: { sig: 'SWITCH(value, case1, result1, …, [default])', help: 'The result for the case that matches the value.' },
  ISBLANK: { sig: 'ISBLANK(value)', help: 'TRUE when the cell is empty.' },
  SUM: { sig: 'SUM(value1, [value2], …)', help: 'Adds numbers.' },
  SUMPRODUCT: { sig: 'SUMPRODUCT(range1, [range2], …)', help: 'Multiplies the ranges item by item, then adds. Good for weighted progress.' },
  SUMIF: { sig: 'SUMIF(range, criteria, [sum_range])', help: 'Adds the cells that match the criteria.' },
  SUMIFS: { sig: 'SUMIFS(sum_range, range1, criteria1, …)', help: 'Adds the cells that match all criteria.' },
  COUNTIF: { sig: 'COUNTIF(range, criteria)', help: 'Counts the cells that match the criteria, e.g. "Completed" or ">=50%".' },
  COUNTIFS: { sig: 'COUNTIFS(range1, criteria1, …)', help: 'Counts the rows that match all criteria.' },
  AVERAGE: { sig: 'AVERAGE(value1, [value2], …)', help: 'The average of the numbers.' },
  AVERAGEIF: { sig: 'AVERAGEIF(range, criteria, [average_range])', help: 'The average of the cells that match.' },
  MIN: { sig: 'MIN(value1, [value2], …)', help: 'The smallest number, or the earliest date.' },
  MAX: { sig: 'MAX(value1, [value2], …)', help: 'The largest number, or the latest date.' },
  MINIFS: { sig: 'MINIFS(min_range, range1, criteria1, …)', help: 'The smallest value of the rows that match.' },
  MAXIFS: { sig: 'MAXIFS(max_range, range1, criteria1, …)', help: 'The largest value of the rows that match.' },
  COUNT: { sig: 'COUNT(value1, …)', help: 'Counts the numbers (and dates).' },
  COUNTA: { sig: 'COUNTA(value1, …)', help: 'Counts the cells that are not empty.' },
  COUNTBLANK: { sig: 'COUNTBLANK(range)', help: 'Counts the empty cells.' },
  ROUND: { sig: 'ROUND(value, [digits])', help: 'Rounds a number.' },
  ROUNDUP: { sig: 'ROUNDUP(value, [digits])', help: 'Rounds up, away from zero.' },
  ROUNDDOWN: { sig: 'ROUNDDOWN(value, [digits])', help: 'Rounds down, toward zero.' },
  INT: { sig: 'INT(value)', help: 'Rounds down to a whole number.' },
  ABS: { sig: 'ABS(value)', help: 'The number without its minus sign.' },
  MOD: { sig: 'MOD(number, divisor)', help: 'What is left after a division.' },
  TEXT: { sig: 'TEXT(value, format)', help: 'Shows a value as text, e.g. TEXT(I3, "dd mmm yyyy") or TEXT(E3, "0%").' },
  CONCAT: { sig: 'CONCAT(value1, [value2], …)', help: 'Joins text together. You can also use &.' },
  TEXTJOIN: { sig: 'TEXTJOIN(separator, skip_empty, value1, …)', help: 'Joins text with a separator between.' },
  LEFT: { sig: 'LEFT(text, [count])', help: 'The first characters of the text.' },
  RIGHT: { sig: 'RIGHT(text, [count])', help: 'The last characters of the text.' },
  MID: { sig: 'MID(text, start, count)', help: 'Characters from the middle of the text.' },
  LEN: { sig: 'LEN(text)', help: 'How many characters the text has.' },
  UPPER: { sig: 'UPPER(text)', help: 'The text in capital letters.' },
  LOWER: { sig: 'LOWER(text)', help: 'The text in small letters.' },
  TRIM: { sig: 'TRIM(text)', help: 'Removes extra spaces.' },
  SUBSTITUTE: { sig: 'SUBSTITUTE(text, old, new, [which])', help: 'Replaces some text with new text.' },
  VALUE: { sig: 'VALUE(text)', help: 'Changes text into a number.' },
  ROW: { sig: 'ROW([cell])', help: 'The row number.' },
  INDEX: { sig: 'INDEX(range, row, [column])', help: 'The value at a position in a range.' },
  MATCH: { sig: 'MATCH(value, range, [type])', help: 'The position of a value in a range. type 0 = exact.' },
  XLOOKUP: { sig: 'XLOOKUP(value, look_in, return_from, [if_not_found])', help: 'Finds a value and gives the item next to it.' },
  VLOOKUP: { sig: 'VLOOKUP(value, table, column, [approximate])', help: 'Finds a value in the first column and gives a value from another column.' },
  CHOOSE: { sig: 'CHOOSE(index, value1, value2, …)', help: 'Picks one value from a list by its number.' },
};
