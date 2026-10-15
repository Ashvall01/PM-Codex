/**
 * The Gantt chart's date rules (src/features/Timeline/ganttDates.ts). Run by
 * test/run-gantt-dates-test.mjs, once per time zone.
 *
 * Each check stands for a way a bar landed off the grid:
 *   - a stored timestamp ("2026-06-28T17:00:00.000Z", typed as 29 Jun in
 *     Jakarta) read by its first ten characters, a day early;
 *   - today read once when the tab opened, so the Present line stayed put;
 *   - a group outline drawn from planned dates only, with late or early bars
 *     sticking out of it.
 */
const { parseGanttDate, ganttDaysDiff, addGanttDays, localTodayString, ganttGroupExtent } =
  await import('./ganttDates.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};
const ymd = (d) => localTodayString(d);
const tz = process.env.TZ;

ok('a plain date is that calendar day', ymd(parseGanttDate('2026-09-07')) === '2026-09-07');
ok('…at local midnight', parseGanttDate('2026-09-07').getHours() === 0);
ok('a date kept as text by the Sheet (leading apostrophe) is read the same', ymd(parseGanttDate("'2026-09-07")) === '2026-09-07');

// The instant 2026-06-28T17:00Z is 29 Jun 00:00 in Jakarta and 28 Jun 13:00 in New York.
const stored = parseGanttDate('2026-06-28T17:00:00.000Z');
ok('a stored timestamp is the local day of that instant',
   ymd(stored) === (tz === 'Asia/Jakarta' ? '2026-06-29' : '2026-06-28'), ymd(stored));

ok('a Date keeps its local day', ymd(parseGanttDate(new Date(2026, 8, 30, 23, 59))) === '2026-09-30');
ok('days between two dates across a month end', ganttDaysDiff(parseGanttDate('2026-09-28'), parseGanttDate('2026-10-01')) === 3);
ok('adding days crosses the month', ymd(addGanttDays(parseGanttDate('2026-09-30'), 1)) === '2026-10-01');
ok('today is read from the clock it is given', localTodayString(new Date(2026, 9, 1, 0, 5)) === '2026-10-01');

const d = parseGanttDate;
const group = { targetStart: d('2026-07-12'), targetEnd: d('2026-09-13'), actualStart: d('2026-06-29'), actualEnd: d('2026-09-23') };
const ext = ganttGroupExtent(group, d('2026-09-30'));
ok('a group outline starts at its earliest bar, actual or planned', ymd(ext.start) === '2026-06-29', ymd(ext.start));
ok('…and ends at its latest one', ymd(ext.end) === '2026-09-23', ymd(ext.end));

const running = ganttGroupExtent({ targetStart: d('2026-09-28'), targetEnd: d('2026-09-29'), actualStart: d('2026-09-28'), isOngoing: true }, d('2026-09-30'));
ok('a running group reaches today', ymd(running.end) === '2026-09-30', ymd(running.end));

const compared = ganttGroupExtent({ targetStart: d('2026-09-10'), targetEnd: d('2026-09-12'), compareTargetStart: d('2026-09-01'), compareTargetEnd: d('2026-09-20') }, d('2026-09-30'));
ok('a compared baseline widens the outline too', ymd(compared.start) === '2026-09-01' && ymd(compared.end) === '2026-09-20');

ok('a group with no dates has no outline', ganttGroupExtent({}, d('2026-09-30')).start === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
