/**
 * Groups the lines of a change request under the headings the assistant gave
 * them (22 Oct 2026).
 *
 * A request of twenty lines read as one flat list is hard to judge. The
 * assistant sends a short heading with each line (`changeGroup`, kept on the
 * line as `group`), and the review panel draws one section per heading, in the
 * order the headings first appear. Lines without one come last, under
 * "Other changes". Headings match without regard to case or spacing, so
 * "LOINC follow-ups" and "loinc  follow-ups" are one section.
 */
import type { ACRChange } from '../store/acrStore';

export const UNGROUPED_TITLE = 'Other changes';

export interface AcrLineGroup {
  /** Stable key for the section ('' for the ungrouped lines). */
  key: string;
  title: string;
  changes: ACRChange[];
}

const keyOf = (title: string) => title.replace(/\s+/g, ' ').trim().toLowerCase();

export function groupAcrLines(changes: ACRChange[]): AcrLineGroup[] {
  const groups = new Map<string, AcrLineGroup>();
  let ungrouped: AcrLineGroup | null = null;
  for (const change of changes || []) {
    const title = String(change.group || '').replace(/\s+/g, ' ').trim();
    if (!title) {
      if (!ungrouped) ungrouped = { key: '', title: UNGROUPED_TITLE, changes: [] };
      ungrouped.changes.push(change);
      continue;
    }
    const key = keyOf(title);
    if (!groups.has(key)) groups.set(key, { key, title, changes: [] });
    groups.get(key)!.changes.push(change);
  }
  const out = [...groups.values()];
  if (ungrouped) out.push(ungrouped);
  return out;
}

/** True when at least one line carries a heading, so sections are worth drawing. */
export function hasNamedGroups(changes: ACRChange[]): boolean {
  return (changes || []).some((c) => String(c.group || '').trim() !== '');
}
