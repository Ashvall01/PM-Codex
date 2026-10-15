/**
 * The fill handle: what goes into the new cells when you drag the small
 * square. It follows Excel:
 *   - one number: copied. Two or more: the series goes on (1, 2 -> 3, 4).
 *   - one date: one day more each cell. Two or more: the same step (a week,
 *     or a month when the days of the month match).
 *   - text ending in a number: the number counts up (Item 1 -> Item 2).
 *   - formulas: copied, with their refs moved.
 *   - anything else: the cells are repeated.
 * Holding Option (Alt) swaps "copy" and "series".
 */
import { ColDef } from './columns';
import * as D from './dates';
import { isFormulaText } from './formula';

export interface Seed { value: any; formula?: string }
export type FillOut = { value: any } | { copyFrom: number };

function linear(ys: number[]): (x: number) => number {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) * (x - mx); });
  const b = den === 0 ? 0 : num / den;
  const a = my - b * mx;
  return (x) => Number((a + b * x).toPrecision(12));
}

const cycle = (n: number, count: number): FillOut[] => Array.from({ length: count }, (_, k) => ({ copyFrom: k % n }));

/**
 * `seeds` are in fill order (for a fill up or left, the caller passes them
 * reversed, and dir = -1 so a single seed counts down). Output k is the k-th
 * new cell away from the seeds.
 */
export function planFill(seeds: Seed[], count: number, col: ColDef, altKey: boolean, dir: 1 | -1 = 1): FillOut[] {
  const n = seeds.length;
  if (n === 0 || count <= 0) return [];
  if (seeds.some((s) => isFormulaText(s.formula))) return cycle(n, count);

  // Dates
  const serials = seeds.map((s) => (col.type === 'date' || typeof s.value === 'string' ? D.isoToSerial(s.value) : null));
  if (serials.every((s) => s !== null)) {
    const ss = serials as number[];
    if (altKey) return n === 1 ? cycle(1, count) : cycle(n, count);
    if (n === 1) return Array.from({ length: count }, (_, k) => ({ value: D.serialToIso(ss[0] + dir * (k + 1)) }));
    const ymd = ss.map(D.serialToYmd);
    const monthIdx = ymd.map(([y, m]) => y * 12 + (m - 1));
    const stepM = monthIdx[1] - monthIdx[0];
    const sameDay = ymd.every(([, , d]) => d === ymd[0][2]);
    const evenM = monthIdx.every((m, i) => i === 0 || m - monthIdx[i - 1] === stepM);
    if (sameDay && evenM && stepM !== 0) {
      const last = monthIdx[n - 1];
      const day = ymd[0][2];
      return Array.from({ length: count }, (_, k) => {
        const mi = last + stepM * (k + 1);
        const y = Math.floor(mi / 12), m = (mi % 12) + 1;
        return { value: D.serialToIso(D.ymdToSerial(y, m, Math.min(day, D.daysInMonth(y, m)))) };
      });
    }
    const f = linear(ss);
    return Array.from({ length: count }, (_, k) => ({ value: D.serialToIso(Math.round(f(n + k))) }));
  }

  // Numbers
  const nums = seeds.map((s) => (typeof s.value === 'number' ? s.value : null));
  if (nums.every((x) => x !== null)) {
    const xs = nums as number[];
    const series = n === 1 ? altKey : !altKey;
    if (!series) return cycle(n, count);
    if (n === 1) {
      const step = col.type === 'percent' ? 0.01 : 1;
      return Array.from({ length: count }, (_, k) => ({ value: Number((xs[0] + dir * step * (k + 1)).toPrecision(12)) }));
    }
    const f = linear(xs);
    return Array.from({ length: count }, (_, k) => ({ value: f(n + k) }));
  }

  // Text that ends in a number
  const parts = seeds.map((s) => (typeof s.value === 'string' ? s.value.match(/^(.*?)(\d+)(\D*)$/) : null));
  if (!altKey && parts.every((p) => p !== null)) {
    const ps = parts as RegExpMatchArray[];
    const samePattern = ps.every((p) => p[1] === ps[0][1] && p[3] === ps[0][3]);
    if (samePattern) {
      const ns = ps.map((p) => parseInt(p[2], 10));
      const step = n === 1 ? dir : Math.round((ns[n - 1] - ns[0]) / (n - 1)) || 1;
      const width = ps[n - 1][2].length;
      return Array.from({ length: count }, (_, k) => {
        const v = Math.max(0, ns[n - 1] + step * (k + 1));
        const digits = ps[n - 1][2].startsWith('0') ? String(v).padStart(width, '0') : String(v);
        return { value: ps[0][1] + digits + ps[0][3] };
      });
    }
  }

  return cycle(n, count);
}
