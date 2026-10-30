/**
 * Whole-word masking: the pure part of PII masking, with no app imports so it
 * can be tested on its own (test/run-pii-masking-test.mjs).
 *
 * A term only matches as a whole word. "Rose" masks "Bu Rose" and "Rose's",
 * never the "rose" in "arose"; "Ana" never touches "analysis". A side of the term
 * that is a letter, digit or underscore must not touch another one; a side that
 * is punctuation (a placeholder like "[core app]") needs no boundary.
 *
 * Masking runs in ONE pass over the text, longest term first, so a placeholder
 * put in for one term is never searched again by a shorter term.
 */

export interface MaskPair {
  /** Text to find. */
  find: string;
  /** Text to put in its place. */
  replace: string;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const BEFORE = '(?<![\\p{L}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{N}_])';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The regex source for one term, bounded on its word-character sides. */
export function wholeWordSource(term: string): string {
  const first = term.charAt(0);
  const last = term.charAt(term.length - 1);
  return (WORD_CHAR.test(first) ? BEFORE : '')
    + escapeRegExp(term)
    + (WORD_CHAR.test(last) ? AFTER : '');
}

/**
 * Replaces every whole-word occurrence of each `find` with its `replace`, in a
 * single pass. Longer terms win where two overlap.
 */
export function replaceWholeWords(text: string, pairs: MaskPair[], caseInsensitive: boolean): string {
  if (!text) return text;
  // Drop blanks and repeats (case-folded when matching ignores case); longest first.
  const seen = new Set<string>();
  const list: MaskPair[] = [];
  for (const p of pairs) {
    const find = (p.find || '').trim();
    if (!find || !p.replace) continue;
    const key = caseInsensitive ? find.toLowerCase() : find;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ find, replace: p.replace });
  }
  if (list.length === 0) return text;
  list.sort((a, b) => b.find.length - a.find.length);

  // One capture group per term: the group that matched says which term it was.
  const regex = new RegExp(list.map((p) => '(' + wholeWordSource(p.find) + ')').join('|'), caseInsensitive ? 'giu' : 'gu');
  return text.replace(regex, (whole: string, ...groups: unknown[]) => {
    for (let i = 0; i < list.length; i++) {
      if (groups[i] !== undefined) return list[i].replace;
    }
    return whole;
  });
}
