/**
 * One colour language for status, priority and dates, in every module.
 *
 * Colours carry the same meaning wherever they appear:
 *   green   — done, signed off, approved, mitigated
 *   cyan    — being worked on
 *   orange  — waiting for someone: open, in review, due soon
 *   magenta — blocked, overdue, high
 *   grey    — paused, draft, not started yet, dropped
 *
 * Until 24 Sep 2026 each module kept its own table and they had drifted:
 * Mitigated and Approved were orange, a Blocked deliverable orange but a
 * Blocked task magenta, and Low priority looked the same as Medium.
 */

const GREEN = 'var(--color-qb-green)';
const CYAN = 'var(--color-qb-cyan)';
const ORANGE = 'var(--color-qb-orange)';
const MAGENTA = 'var(--color-qb-magenta)';
const GREY = 'var(--color-qb-grey)';
const DARK_GREY = 'var(--color-qb-dark-grey)';
const LIGHT_GREY = 'var(--color-qb-light-grey)';

/**
 * A see-through wash of a colour, for a chip's background.
 *
 * The modules used to write `${color}20`, a hex-alpha suffix. On a CSS
 * variable that is not a colour at all, so the browser dropped it and every
 * status chip lost its background.
 */
export const tint = (color: string, percent = 14): string =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

export const TASK_STATUS_COLORS: Record<string, string> = {
  'Open': ORANGE,
  'In Progress': CYAN,
  'On Hold': GREY,
  'Blocked': MAGENTA,
  'Done': GREEN,
  'Dropped': LIGHT_GREY,
};

export const DELIVERABLE_STATUS_COLORS: Record<string, string> = {
  'Pending': GREY,
  'In Progress': CYAN,
  'On Hold': GREY,
  'In Review': ORANGE,
  'Signed Off': GREEN,
  'Dropped': LIGHT_GREY,
  'Blocked': MAGENTA,
};

export const RISK_STATUS_COLORS: Record<string, string> = {
  'Open': ORANGE,
  'Under Mitigation': CYAN,
  'Mitigated': GREEN,
};

/** A risk's value from the matrix. Shared by the heat map and the matrix in Settings. */
export const RISK_VALUE_COLORS: Record<string, string> = {
  'Lowest': LIGHT_GREY,
  'Low': GREEN,
  'Medium': ORANGE,
  'High': MAGENTA,
  'Highest': MAGENTA,
  'Expert Judgment': CYAN,
};

export const DOCUMENT_STATUS_COLORS: Record<string, string> = {
  'Draft': DARK_GREY,
  'In Review': ORANGE,
  'Approved': GREEN,
  'Archived': LIGHT_GREY,
};

/** Tailwind classes for a priority chip: High magenta, Medium orange, Low grey. */
export const priorityChipClass = (priority?: string): string =>
  priority === 'High'
    ? 'border-qb-magenta text-qb-magenta'
    : priority === 'Medium'
      ? 'border-qb-orange text-qb-orange'
      : 'border-qb-grey/60 text-qb-dark-grey';

/** Today as YYYY-MM-DD in this computer's time zone. */
export const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/**
 * Where a due date stands against today, for an item that is still open.
 * "soon" is within the next 7 days. Pass `closed` for a finished item: its
 * date no longer asks for anything.
 */
export const dueState = (date?: string, closed = false): DueState => {
  if (!date || closed) return 'none';
  const day = String(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'none';
  const today = todayISO();
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  const t = new Date(`${today}T00:00:00`);
  t.setDate(t.getDate() + 7);
  const week = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return day <= week ? 'soon' : 'later';
};

/** Text classes for a due date in a list row. */
export const dueDateClass = (state: DueState): string =>
  state === 'overdue'
    ? 'text-qb-magenta'
    : state === 'today' || state === 'soon'
      ? 'text-qb-orange'
      : 'text-qb-grey';

/** Whole days from today to a date (negative when past). */
export const daysFromToday = (date: string): number => {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const t = new Date(todayISO() + 'T00:00:00');
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
};

/** "3D LATE", "TODAY", "IN 2D" — a short tag beside a date that needs attention. */
export const dueTag = (date: string | undefined, state: DueState): string | null => {
  if (!date) return null;
  if (state === 'overdue') return `${Math.abs(daysFromToday(date))}D LATE`;
  if (state === 'today') return 'TODAY';
  if (state === 'soon') return `IN ${daysFromToday(date)}D`;
  return null;
};
