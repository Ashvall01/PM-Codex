/**
 * SEARCH — one way to find a record, shared by Tasks and Deliverables.
 *
 * What a person types:
 *   cutover plan         both words, anywhere in the record, in any order
 *   "cutover plan"       that exact phrase
 *   -done  -"on hold"    leave out records containing it
 *   owner:rina           a field filter; also status:, type:, priority:, due:
 *   due:2026-10          due in that month (or a day: due:2026-10-01)
 *   is:late  is:open  is:flagged  is:done   (also: due:overdue, due:week)
 *
 * Case, accents and punctuation between words do not matter. Every word is
 * looked for in every searchable field — title, description, remarks,
 * comments, owner, linked activities — so the question "where did we write
 * that down?" gets an answer even when the words are in a comment.
 */
import { dueState } from './statusStyle';

export interface SearchQuery {
  raw: string;
  terms: string[];
  phrases: string[];
  excludes: string[];
  fields: Record<string, string[]>;
  flags: string[];
}

/** The fields a record offers to the search, by the name the result shows. */
export interface SearchDoc {
  /** Free text, keyed by what the result calls it: "title", "remarks", "comments" … */
  text: Record<string, string>;
  owner?: string;
  status?: string;
  type?: string;
  priority?: string;
  due?: string;
  flagged?: boolean;
  closed?: boolean;
}

export interface SearchHit {
  match: boolean;
  /** Text fields a word or phrase was found in, in the order the doc lists them. */
  fields: string[];
}

const FIELD_ALIASES: Record<string, string> = {
  owner: 'owner', who: 'owner', by: 'owner', assignee: 'owner',
  status: 'status', state: 'status',
  type: 'type', kind: 'type',
  priority: 'priority', prio: 'priority',
  due: 'due', date: 'due',
  is: 'is', has: 'is',
};

/** Lower case, no accents: "Café" finds "cafe". */
export const fold = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function parseSearch(input: string): SearchQuery {
  const q: SearchQuery = { raw: input || '', terms: [], phrases: [], excludes: [], fields: {}, flags: [] };
  const re = /(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input || ''))) {
    const negate = m[1] === '-';
    const key = m[2] ? FIELD_ALIASES[m[2].toLowerCase()] : undefined;
    const quoted = m[3] !== undefined;
    const value = fold(quoted ? m[3] : m[4] ?? '').trim();
    if (!value) continue;
    if (m[2] && !key) {
      // "abc:def" that is not a known field is just text.
      const text = fold(`${m[2]}:${quoted ? m[3] : m[4]}`);
      (negate ? q.excludes : q.terms).push(text);
      continue;
    }
    if (key === 'is') { if (!negate) q.flags.push(value); continue; }
    if (key) { (q.fields[key] = q.fields[key] || []).push(value); continue; }
    if (negate) q.excludes.push(value);
    else if (quoted) q.phrases.push(value);
    else q.terms.push(value);
  }
  return q;
}

export const isEmptySearch = (q: SearchQuery): boolean =>
  !q.terms.length && !q.phrases.length && !q.excludes.length && !Object.keys(q.fields).length && !q.flags.length;

function dueMatches(due: string | undefined, want: string, closed: boolean): boolean {
  const d = String(due || '').slice(0, 10);
  if (want === 'none') return !d;
  if (!d) return false;
  const state = dueState(d, closed);
  if (want === 'overdue' || want === 'late') return state === 'overdue';
  if (want === 'today') return state === 'today';
  if (want === 'week' || want === 'soon') return state === 'today' || state === 'soon';
  return d.startsWith(want);
}

function flagMatches(doc: SearchDoc, flag: string): boolean {
  switch (flag) {
    case 'late': case 'overdue': return !doc.closed && dueMatches(doc.due, 'overdue', false);
    case 'open': return !doc.closed;
    case 'done': case 'closed': return !!doc.closed;
    case 'flagged': case 'flag': return !!doc.flagged;
    case 'unassigned': return !String(doc.owner || '').trim();
    default: return true;
  }
}

export function matchSearch(q: SearchQuery, doc: SearchDoc): SearchHit {
  const entries = Object.entries(doc.text).map(([k, v]) => [k, fold(v)] as const);
  const all = entries.map(([, v]) => v).join(' \u0001 ');
  const found = new Set<string>();

  for (const needle of [...q.terms, ...q.phrases]) {
    let any = false;
    for (const [k, v] of entries) if (v.includes(needle)) { found.add(k); any = true; }
    if (!any) return { match: false, fields: [] };
  }
  for (const ex of q.excludes) if (all.includes(ex)) return { match: false, fields: [] };

  for (const [key, values] of Object.entries(q.fields)) {
    for (const want of values) {
      if (key === 'due') { if (!dueMatches(doc.due, want, !!doc.closed)) return { match: false, fields: [] }; continue; }
      const have = fold((doc as any)[key]);
      if (key === 'owner' && (want === 'none' || want === 'unassigned')) { if (have.trim()) return { match: false, fields: [] }; continue; }
      if (!have.includes(want)) return { match: false, fields: [] };
    }
  }
  for (const flag of q.flags) if (!flagMatches(doc, flag)) return { match: false, fields: [] };

  return { match: true, fields: entries.map(([k]) => k).filter((k) => found.has(k)) };
}

/**
 * A list field as it may arrive: an array, or the same list as JSON text (a
 * Sheet cell, or a record saved before the load path parsed it). Anything
 * else is an empty list — search must never be the thing that breaks a page.
 */
export function asList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/** The words to mark in a piece of text: terms and phrases, longest first. */
export function highlightNeedles(q: SearchQuery): string[] {
  return Array.from(new Set([...q.phrases, ...q.terms, ...(q.fields.owner || [])]))
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length);
}

/** Splits text into plain and matched pieces, keeping the original spelling. */
export function highlightPieces(text: string, needles: string[]): { text: string; hit: boolean }[] {
  const src = String(text ?? '');
  if (!needles.length || !src) return [{ text: src, hit: false }];
  const folded = fold(src);
  // Folding can change length only for characters with accents; map by position when it does not.
  if (folded.length !== src.length) return [{ text: src, hit: false }];
  const marks = new Array(src.length).fill(false);
  for (const n of needles) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(n, from);
      if (at < 0) break;
      for (let i = at; i < at + n.length; i++) marks[i] = true;
      from = at + Math.max(1, n.length);
    }
  }
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < src.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += src[i];
    else out.push({ text: src[i], hit: marks[i] });
  }
  return out;
}

/** A short piece of `text` around the first match, for "found in remarks: … ". */
export function snippetAround(text: string, needles: string[], radius = 40): string {
  const plain = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const folded = fold(plain);
  let at = -1;
  for (const n of needles) { const i = folded.indexOf(n); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return plain.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(plain.length, at + radius);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}
