/**
 * Moving refs inside formula text, the way Excel does.
 *
 *  - Copy, paste and fill: relative parts move with the cell, $ parts stay.
 *  - Rows added, deleted or moved: every ref follows the row it pointed at
 *    (found by the row's id). A ref to a deleted row becomes #REF!.
 *  - Cells moved by drag or cut: refs to those cells follow them.
 */
import { COLUMNS } from './columns';
import { E, RefParts, Tok, formatRef, tokenize } from './formula';

type MapRef = (r: RefParts) => RefParts | null;
type MapRange = (a: RefParts, b: RefParts) => [RefParts, RefParts] | null;

/** Rewrite every ref in a formula. Returning null for a ref writes #REF!. */
export function rewriteRefs(text: string, mapRef: MapRef, mapRange?: MapRange): string {
  if (!text.startsWith('=')) return text;
  const toks = tokenize(text);
  let out = '';
  let pos = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== 'ref') continue;
    const colon = toks[k + 1];
    const b = toks[k + 2];
    if (colon?.type === 'colon' && b?.type === 'ref') {
      const res = mapRange ? mapRange(t.ref!, b.ref!) : pair(mapRef(t.ref!), mapRef(b.ref!));
      out += text.slice(pos, t.start) + (res ? `${formatRef(res[0])}:${formatRef(res[1])}` : E.REF);
      pos = b.end;
      k += 2;
      continue;
    }
    const r = mapRef(t.ref!);
    out += text.slice(pos, t.start) + (r ? formatRef(r) : E.REF);
    pos = t.end;
  }
  return out + text.slice(pos);
}

function pair(a: RefParts | null, b: RefParts | null): [RefParts, RefParts] | null {
  return a && b ? [a, b] : null;
}

/** Copy a formula dr rows down and dc columns right. */
export function shiftFormula(text: string, dr: number, dc: number): string {
  if (dr === 0 && dc === 0) return text;
  return rewriteRefs(text, (r) => {
    const row = r.rowAbs ? r.row : r.row + dr;
    const col = r.colAbs ? r.col : r.col + dc;
    if (row < 0 || col < 0 || col >= COLUMNS.length) return null;
    return { ...r, row, col };
  });
}

/**
 * Rows were added, deleted or moved. `oldIds` is the row order before;
 * `newIndex` finds a row's new position by its id.
 */
export function remapFormulaRows(
  text: string,
  oldIds: string[],
  newIndex: Map<string, number>,
  newLen: number,
): string {
  const oldLen = oldIds.length;
  // A ref below the last row keeps its distance from the last row that is
  // still there: rows added at the end do not move it, rows added above do.
  let lastKept = -1;
  for (let k = oldLen - 1; k >= 0; k--) if (newIndex.has(oldIds[k])) { lastKept = k; break; }
  const beyond = (row: number) => (lastKept < 0 ? row : newIndex.get(oldIds[lastKept])! + (row - lastKept));
  const one = (row: number): number | null => {
    if (row >= oldLen) return beyond(row);
    const idx = newIndex.get(oldIds[row]);
    return idx === undefined ? null : idx;
  };
  return rewriteRefs(
    text,
    (r) => {
      const row = one(r.row);
      return row === null ? null : { ...r, row };
    },
    (a, b) => {
      // Each end follows its own row; a deleted end moves inward to the
      // nearest row that is still there, as Excel shrinks a range.
      let r1: number | null = null;
      let r2: number | null = null;
      for (let r = a.row; r <= b.row && r1 === null; r++) r1 = one(r);
      for (let r = b.row; r >= a.row && r2 === null; r--) r2 = one(r);
      if (r1 === null || r2 === null) return null;
      if (r1 > r2) [r1, r2] = [r2, r1];
      return [{ ...a, row: r1 }, { ...b, row: r2 }];
    },
  );
}

/** Cells in a block moved by (dr, dc). Refs that point inside the block follow them. */
export function followMovedBlock(
  text: string,
  block: { r1: number; c1: number; r2: number; c2: number },
  dr: number,
  dc: number,
  overwritten?: { r1: number; c1: number; r2: number; c2: number },
): string {
  const inside = (b: typeof block, r: number, c: number) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;
  return rewriteRefs(
    text,
    (r) => {
      if (inside(block, r.row, r.col)) return { ...r, row: r.row + dr, col: r.col + dc };
      if (overwritten && inside(overwritten, r.row, r.col)) return null;
      return r;
    },
    (a, b) => {
      // Excel moves a range only when the whole range is inside the block.
      if (inside(block, a.row, a.col) && inside(block, b.row, b.col)) {
        return [{ ...a, row: a.row + dr, col: a.col + dc }, { ...b, row: b.row + dr, col: b.col + dc }];
      }
      return [a, b];
    },
  );
}

export interface RefSpan {
  start: number;
  end: number;
  r1: number; c1: number; r2: number; c2: number;
}

/** Where the refs are in a formula (for the coloured boxes while you type). */
export function findRefSpans(text: string): RefSpan[] {
  if (!text.startsWith('=')) return [];
  const toks: Tok[] = tokenize(text);
  const out: RefSpan[] = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== 'ref') continue;
    const colon = toks[k + 1];
    const b = toks[k + 2];
    if (colon?.type === 'colon' && b?.type === 'ref') {
      out.push({
        start: t.start, end: b.end,
        r1: Math.min(t.ref!.row, b.ref!.row), r2: Math.max(t.ref!.row, b.ref!.row),
        c1: Math.min(t.ref!.col, b.ref!.col), c2: Math.max(t.ref!.col, b.ref!.col),
      });
      k += 2;
    } else {
      out.push({ start: t.start, end: t.end, r1: t.ref!.row, r2: t.ref!.row, c1: t.ref!.col, c2: t.ref!.col });
    }
  }
  return out;
}
