/**
 * The heart of undo: take the change one step made, and do it (or its
 * reverse) to the rows as they are now. Kept apart from history.ts so the
 * tests can run it without the app's stores.
 */
type Row = { id: string; [key: string]: any };

const FIELDS_SKIP = new Set(['id']);

function sameValue(a: any, b: any) {
  return a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Take the change that went from `from` to `to`, and do it to `cur`.
 * Undo is applyStep(cur, after, before); redo is applyStep(cur, before, after).
 */
export function applyStep(cur: Row[], from: Row[], to: Row[]): Row[] {
  const fromById = new Map(from.map((a) => [a.id, a]));
  const toById = new Map(to.map((a) => [a.id, a]));
  const curById = new Map(cur.map((a) => [a.id, a]));

  // Changed fields of rows that are in both.
  const merged = new Map<string, Row>();
  for (const a of cur) {
    const f = fromById.get(a.id), t = toById.get(a.id);
    if (!f || !t) { merged.set(a.id, a); continue; }
    let row: any = a;
    const keys = new Set([...Object.keys(f), ...Object.keys(t)]);
    for (const k of keys) {
      if (FIELDS_SKIP.has(k)) continue;
      if (!sameValue((f as any)[k], (t as any)[k])) {
        if (row === a) row = { ...a };
        if ((t as any)[k] === undefined) delete row[k];
        else row[k] = (t as any)[k];
      }
    }
    merged.set(a.id, row);
  }

  const sameOrder = cur.length === from.length && cur.every((a, i) => a.id === from[i].id);
  if (sameOrder) {
    // Nothing else moved rows since: take the target order as it was.
    return to.map((t) => merged.get(t.id) ?? t);
  }
  // Rows moved in between: remove what the step added, put back what it removed.
  const out = cur.filter((a) => !(fromById.has(a.id) && !toById.has(a.id))).map((a) => merged.get(a.id) ?? a);
  to.forEach((t, i) => {
    if (!fromById.has(t.id) && !curById.has(t.id)) out.splice(Math.min(i, out.length), 0, t);
  });
  return out;
}

