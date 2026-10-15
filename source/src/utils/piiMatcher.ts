/**
 * PII SUGGESTION MATCHER — finds glossary names (and near misses) in a text.
 *
 * Used by `PIISuggestionOverlay` while the user types. It must be fast: it
 * runs on the whole text of an editor. The old version ran a full edit-distance
 * check of every 1-, 2- and 3-word phrase against every glossary term on every
 * key press, which took about a second on a long MoM or Codex page.
 *
 * What makes this one fast, with the same results:
 *   - exact names are one Map lookup;
 *   - a term is only compared when the lengths are close enough to match;
 *   - the edit-distance check stops as soon as it cannot get under the limit;
 *   - every phrase's answer is remembered, so the next pass only checks new words.
 */

export interface PIIMatcherEntry {
  originalTerm: string;
  placeholder: string;
  variations?: string[];
}

export interface PIISuggestion {
  originalMatch: string;
  suggestedToken: string;
  suggestedOriginal: string;
  exact: boolean;
}

export interface PIIMatch {
  index: number;
  length: number;
  suggestion: PIISuggestion;
}

interface FuzzyTerm {
  lower: string;
  len: number;
  maxDist: number;
  entry: PIIMatcherEntry;
}

/** Edit distance, or `max + 1` as soon as the answer must be larger than `max`. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j - 1] + cost, prev[j] + 1, curr[j - 1] + 1);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = curr; curr = t;
  }
  return prev[b.length];
}

const WORD = /[\p{L}\p{N}_'-]+/gu;
const CACHE_LIMIT = 20000;

export function createPIIMatcher(entries: PIIMatcherEntry[]) {
  const exact = new Map<string, PIIMatcherEntry>();
  const fuzzy: FuzzyTerm[] = [];
  let longestFuzzy = 0;

  for (const entry of entries) {
    if (!entry || !entry.placeholder) continue;
    if (entry.originalTerm) {
      const key = entry.originalTerm.toLowerCase();
      if (!exact.has(key)) exact.set(key, entry);
    }
    for (const v of entry.variations || []) {
      if (!v) continue;
      const key = v.trim().toLowerCase();
      if (!exact.has(key)) exact.set(key, entry);
    }
    for (const term of [entry.originalTerm, ...(entry.variations || [])]) {
      if (typeof term !== 'string' || term.trim().length === 0) continue;
      // A term shorter than 5 letters can only ever match exactly.
      if (term.length < 5) continue;
      const maxDist = term.length >= 8 ? 2 : 1;
      fuzzy.push({ lower: term.toLowerCase(), len: term.length, maxDist, entry });
      longestFuzzy = Math.max(longestFuzzy, term.length);
    }
  }

  const fuzzyCache = new Map<string, PIIMatcherEntry | null>();

  const fuzzyLookup = (lowerPhrase: string): PIIMatcherEntry | null => {
    const cached = fuzzyCache.get(lowerPhrase);
    if (cached !== undefined) return cached;
    let found: PIIMatcherEntry | null = null;
    const pl = lowerPhrase.length;
    if (pl <= longestFuzzy + 2) {
      for (const t of fuzzy) {
        const isPrefix = pl >= 4 && pl >= t.len - 2 && pl <= t.len && t.lower.startsWith(lowerPhrase);
        if (isPrefix || boundedLevenshtein(lowerPhrase, t.lower, t.maxDist) <= t.maxDist) {
          found = t.entry;
          break;
        }
      }
    }
    if (fuzzyCache.size >= CACHE_LIMIT) fuzzyCache.clear();
    fuzzyCache.set(lowerPhrase, found);
    return found;
  };

  /** Every match in `text`, longest phrase first, never overlapping. */
  const findMatches = (text: string): PIIMatch[] => {
    const out: PIIMatch[] = [];
    if (!text || (exact.size === 0 && fuzzy.length === 0)) return out;

    const words: { index: number; end: number }[] = [];
    WORD.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD.exec(text)) !== null) words.push({ index: m.index, end: m.index + m[0].length });

    // The last matched range. Phrases come in order of their start, so a new
    // phrase can only overlap the most recent match or none.
    let lastEnd = -1;
    const tryPhrase = (start: number, end: number) => {
      if (start < lastEnd) return;
      const phrase = text.substring(start, end);
      const lower = phrase.toLowerCase();
      let entry = exact.get(lower);
      let isExact = !!entry;
      if (!entry) {
        const f = fuzzyLookup(lower);
        if (f) { entry = f; isExact = false; }
      }
      if (!entry) return;
      lastEnd = end;
      out.push({
        index: start,
        length: end - start,
        suggestion: {
          originalMatch: phrase,
          suggestedToken: entry.placeholder,
          suggestedOriginal: entry.originalTerm,
          exact: isExact,
        },
      });
    };

    for (let i = 0; i < words.length; i++) {
      const start = words[i].index;
      if (i < words.length - 2) tryPhrase(start, words[i + 2].end);
      if (i < words.length - 1) tryPhrase(start, words[i + 1].end);
      tryPhrase(start, words[i].end);
    }
    return out;
  };

  return { findMatches, isEmpty: exact.size === 0 && fuzzy.length === 0 };
}
