/**
 * Dates as the sheet sees them.
 *
 * Inside the formula engine a date is a serial day number, the same as Excel
 * and Google Sheets: 1899-12-30 is day 0, so 2026-09-24 is day 46289. Date + 5
 * is five days later; date - date is a count of days.
 *
 * In the store a date is a plain "YYYY-MM-DD" string. Some old rows hold a full
 * ISO time ("2026-03-30T17:00:00.000Z"); the app has always shown the date part
 * of those, so this file does too.
 *
 * Typed dates read day first: 05/06/2026 is 5 June 2026.
 */

const MS_DAY = 86400000;
const EPOCH = 25569; // serial of 1970-01-01

export function ymdToSerial(y: number, m: number, d: number): number {
  // Date.UTC rolls over like Excel's DATE: month 13 is next January, day 0 is
  // the last day of the month before. It also maps years 0-99 to 1900-1999.
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY) + EPOCH;
}

export function serialToYmd(serial: number): [number, number, number] {
  const d = new Date((Math.floor(serial) - EPOCH) * MS_DAY);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function serialToIso(serial: number): string {
  const [y, m, d] = serialToYmd(serial);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(serial: number): number {
  return (((Math.floor(serial) + 6) % 7) + 7) % 7;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** A stored date string -> serial, or null. Reads the date part only. */
export function isoToSerial(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return ymdToSerial(y, mo, d);
}

/** A stored date string -> "YYYY-MM-DD" (date part), or null. */
export function normalizeIso(value: unknown): string | null {
  const s = isoToSerial(value);
  return s === null ? null : serialToIso(s);
}

export function todaySerial(now = new Date()): number {
  return ymdToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const MONTHS: Record<string, number> = {};
[
  ['jan', 'january', 'januari'],
  ['feb', 'february', 'februari', 'peb'],
  ['mar', 'march', 'maret'],
  ['apr', 'april'],
  ['may', 'mei'],
  ['jun', 'june', 'juni'],
  ['jul', 'july', 'juli'],
  ['aug', 'august', 'agustus', 'agu', 'agt', 'ags'],
  ['sep', 'sept', 'september'],
  ['oct', 'october', 'oktober', 'okt'],
  ['nov', 'november', 'nop'],
  ['dec', 'december', 'desember', 'des'],
].forEach((names, i) => names.forEach((n) => { MONTHS[n] = i + 1; }));

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fullYear(y: string | undefined, now: Date): number | null {
  if (y === undefined || y === '') return now.getFullYear();
  const n = +y;
  if (y.length === 2) return n < 30 ? 2000 + n : 1900 + n; // Excel's rule
  if (y.length === 4) return n;
  return null;
}

function build(y: number | null, m: number, d: number): number | null {
  if (y === null || !(m >= 1 && m <= 12) || !(d >= 1 && d <= daysInMonth(y, m))) return null;
  return ymdToSerial(y, m, d);
}

/**
 * What a person types -> serial, or null when it is not a date.
 *   2026-05-12 · 12/05/2026 · 12-5-26 · 12.05.2026 · 12/5 (this year)
 *   12 May 2026 · 12-May-26 · 12 Mei · May 12, 2026
 */
export function parseDateText(text: string, now = new Date()): number | null {
  const s = String(text).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/);
  if (m) return build(fullYear(m[3], now), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([A-Za-z]{3,})\.?(?:[\s\-/.,]+(\d{2}|\d{4}))?$/);
  if (m && MONTHS[m[2].toLowerCase()]) return build(fullYear(m[3], now), MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,})\.?[\s\-/.]*(\d{1,2})(?:st|nd|rd|th)?(?:[\s\-/.,]+(\d{2}|\d{4}))?$/);
  if (m && MONTHS[m[1].toLowerCase()]) return build(fullYear(m[3], now), MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

/** Stored date -> "24 Sep 2026" for the cell. Anything else is shown as it is. */
export function formatDateCell(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const s = isoToSerial(value);
  if (s === null) return String(value);
  const [y, mo, d] = serialToYmd(s);
  return `${pad(d)} ${MONTH_SHORT[mo - 1]} ${y}`;
}

/** Stored date -> "24/09/2026", the form the editor shows (day first). */
export function formatDateEdit(value: unknown): string {
  const s = isoToSerial(value);
  if (s === null) return value === undefined || value === null ? '' : String(value);
  const [y, mo, d] = serialToYmd(s);
  return `${pad(d)}/${pad(mo)}/${y}`;
}
