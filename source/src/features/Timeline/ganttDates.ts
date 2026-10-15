/**
 * Dates and extents for the Gantt chart (Tabs/GanttChart.tsx).
 *
 * Kept apart from the component so the rules can be tested without a browser
 * (test/run-gantt-dates-test.mjs). Every position on the chart is
 * `ganttDaysDiff(minDate, date) * dayWidth`, so a date read one day wrong puts
 * a bar one day off the grid.
 */

/**
 * A date value as the calendar day the user meant, at local midnight.
 *
 * A plain "YYYY-MM-DD" is that day. A full timestamp is an INSTANT and is read
 * in local time: "2026-06-28T17:00:00.000Z" is 29 Jun in Jakarta (UTC+7).
 * Timestamps like that reached the data before 24 Sep, when Google Sheets
 * turned typed dates into date values on save; reading only the first ten
 * characters put those bars a day early.
 */
export function parseGanttDate(val: string | Date | null | undefined): Date {
  if (!val) return new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  if (val instanceof Date) return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  const text = String(val).trim().replace(/^'/, '');
  const plain = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]));
  const instant = new Date(text);
  if (!isNaN(instant.getTime())) {
    return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
  }
  const loose = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (loose) return new Date(Number(loose[1]), Number(loose[2]) - 1, Number(loose[3]));
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole calendar days from `start` to `end`. Daylight saving cannot shift it. */
export function ganttDaysDiff(start: Date, end: Date): number {
  const utc1 = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utc2 = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

export function addGanttDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Today's date in local time, as "YYYY-MM-DD". Read it when drawing, never once at load. */
export function localTodayString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The parts of an activity group the extent reads. */
export interface GanttGroupDates {
  targetStart?: Date | null;
  targetEnd?: Date | null;
  compareTargetStart?: Date | null;
  compareTargetEnd?: Date | null;
  actualStart?: Date | null;
  actualEnd?: Date | null;
  isOngoing?: boolean;
}

/**
 * First and last day a group's bars occupy: planned, compared, actual, and a
 * running bar up to today. The group's outline is drawn around this.
 *
 * It used to be the planned dates only, so a group whose work started early
 * or finished late had bars sticking out of its own outline.
 */
export function ganttGroupExtent(group: GanttGroupDates, today: Date): { start: Date | null; end: Date | null } {
  const starts = [group.targetStart, group.compareTargetStart, group.actualStart].filter(Boolean) as Date[];
  const ends = [group.targetEnd, group.compareTargetEnd, group.actualEnd].filter(Boolean) as Date[];
  if (group.isOngoing && group.actualStart) ends.push(today);
  if (!starts.length || !ends.length) return { start: null, end: null };
  const start = new Date(Math.min(...starts.map((d) => d.getTime())));
  const end = new Date(Math.max(...ends.map((d) => d.getTime())));
  return { start, end };
}
