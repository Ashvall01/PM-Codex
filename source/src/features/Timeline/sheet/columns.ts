/**
 * The timeline table's columns, in sheet order. Column A is PHASE, B is
 * ACTIVITY, and so on. The formula engine, the store and the table all read
 * this one list, so a cell address means the same thing everywhere.
 */

export type ColType = 'text' | 'number' | 'percent' | 'select' | 'date';

export interface ColDef {
  id: string;
  /** The field in the timeline row (TimelineActivity). */
  key: string;
  title: string;
  type: ColType;
  options?: string[];
  defaultWidth: number;
  /** Other names a formula may use for this column: [Target Start], [@start] … */
  aliases: string[];
}

export const STATUS_OPTIONS = [
  'Completed',
  'Completed With Delay',
  'Work In Progress',
  'Delayed WIP',
  'Not Started',
  'Planned',
  'Backlog',
  'Dropped',
  'On Hold',
];

export const COLUMNS: ColDef[] = [
  { id: 'phase', key: 'phase', title: 'PHASE', type: 'text', defaultWidth: 96, aliases: [] },
  { id: 'activity', key: 'activity', title: 'ACTIVITY', type: 'text', defaultWidth: 192, aliases: [] },
  { id: 'subActivity', key: 'subActivity', title: 'SUB ACTIVITY', type: 'text', defaultWidth: 192, aliases: ['sub'] },
  { id: 'weight', key: 'weight', title: 'WEIGHT', type: 'number', defaultWidth: 64, aliases: [] },
  { id: 'progress', key: 'progress', title: 'PROG %', type: 'percent', defaultWidth: 80, aliases: ['progress', 'prog'] },
  { id: 'status', key: 'status', title: 'STATUS', type: 'select', options: STATUS_OPTIONS, defaultWidth: 192, aliases: [] }, // wide enough for "Completed With Delay"
  { id: 'owner', key: 'owner', title: 'OWNER', type: 'text', defaultWidth: 112, aliases: [] },
  { id: 'targetStartDate', key: 'targetStartDate', title: 'TARGET START', type: 'date', defaultWidth: 112, aliases: ['start', 'targetstart'] },
  { id: 'targetCompletionDate', key: 'targetCompletionDate', title: 'TARGET END', type: 'date', defaultWidth: 112, aliases: ['end', 'targetend', 'targetcompletion'] },
  { id: 'actualStartDate', key: 'actualStartDate', title: 'ACTUAL START', type: 'date', defaultWidth: 112, aliases: ['actualstart'] },
  { id: 'actualCompletionDate', key: 'actualCompletionDate', title: 'ACTUAL END', type: 'date', defaultWidth: 112, aliases: ['actualend', 'actualcompletion'] },
  { id: 'remarks', key: 'remarks', title: 'REMARKS', type: 'text', defaultWidth: 128, aliases: ['remark', 'notes'] },
];

export const COLUMN_BY_KEY: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c, i) => [c.key, i]),
);

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colLetter(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" -> 0, "aa" -> 26. */
export function colFromLetter(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const NAME_INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  COLUMNS.forEach((c, i) => {
    [c.title, c.key, c.id, ...c.aliases].forEach((n) => {
      const k = norm(n);
      if (k && m[k] === undefined) m[k] = i;
    });
  });
  return m;
})();

/** A column name as a formula writes it ("Target Start", "@start", "targetStartDate") -> index, or -1. */
export function findColumnByName(name: string): number {
  const k = norm(name.replace(/^@/, ''));
  return NAME_INDEX[k] ?? -1;
}
