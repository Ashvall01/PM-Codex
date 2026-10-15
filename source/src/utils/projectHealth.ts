/**
 * THE PROJECT PICTURE — one calculation of where a project stands.
 *
 * The Overview screen, the project list and the Risks heat map all read it, so
 * a number means the same thing wherever it appears ("9 late" on the project
 * card is the same 9 the Overview lists). Pure: it takes the records and
 * today's date and changes nothing.
 */
import { TimelineActivity, ProjectTimeline } from '../store/timelineStore';
import { Task } from '../store/tasksStore';
import { Deliverable } from '../store/deliverablesStore';
import { ProjectRisk } from '../store/risksStore';
import { MoM } from '../store/momStore';
import { activeOnly } from './archive';
import { isActionItemUnpushed } from '../services/momActionPush';
import { dueState, daysFromToday } from './statusStyle';

export const DONE_ACTIVITY = ['Completed', 'Completed With Delay', 'Dropped'];
export const PAUSED_ACTIVITY = ['On Hold', 'Backlog'];
export const CLOSED_TASK = ['Done', 'Dropped'];
export const CLOSED_DELIVERABLE = ['Signed Off', 'Dropped'];

export const isoDay = (v?: string) => {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};
export const addDaysISO = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
export const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const shortDate = (iso: string) => {
  if (!iso) return '--';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
};

/** Share of an activity's planned span that should be done by `day` (0–1). */
export const plannedShare = (a: TimelineActivity, day: string) => {
  const s = isoDay(a.targetStartDate), e = isoDay(a.targetCompletionDate);
  if (!s || !e) return 0;
  const span = dayNumber(e) - dayNumber(s) + 1;
  if (span <= 0) return day >= e ? 1 : 0;
  return Math.max(0, Math.min(1, (dayNumber(day) - dayNumber(s) + 1) / span));
};

export type Kind = 'TASK' | 'ISSUE' | 'DELIVERABLE' | 'ACTIVITY' | 'RISK' | 'ACTION';
export const KIND_COLOR: Record<Kind, string> = {
  TASK: 'var(--color-qb-dark-grey)',
  ISSUE: 'var(--color-qb-magenta)',
  DELIVERABLE: 'var(--color-qb-cyan)',
  ACTIVITY: 'var(--color-qb-orange)',
  RISK: 'var(--color-qb-magenta)',
  ACTION: 'var(--color-qb-green)',
};

export interface AttentionItem {
  key: string;
  kind: Kind;
  title: string;
  owner?: string;
  date?: string;
  /** Lower sorts first. */
  rank: number;
  tag: string;
  tagTone: 'late' | 'blocked' | 'soon' | 'risk';
  to: string;
}

export const heatKey = (impact: string, probability: string) => `${impact}|${probability}`;

/** Open risks (not Mitigated) per impact × probability cell, plus what does not fit the grid. */
export function countHeat(risks: { status?: string; impactLevel?: string; probability?: string }[]) {
  const heat: Record<string, number> = {};
  let opportunities = 0, uncertain = 0, unassessed = 0;
  risks.filter(r => r.status !== 'Mitigated').forEach(r => {
    if (!r.impactLevel || !r.probability) { unassessed++; return; }
    if (r.impactLevel === 'Positive (Opportunity)') { opportunities++; return; }
    if (r.probability === 'Uncertain') { uncertain++; return; }
    const k = heatKey(r.impactLevel, r.probability);
    heat[k] = (heat[k] || 0) + 1;
  });
  return { heat, opportunities, uncertain, unassessed };
}

export interface PictureInput {
  projectId: string;
  projectTimelines: ProjectTimeline[];
  tasks: Task[];
  deliverables: Deliverable[];
  risks: ProjectRisk[];
  moms: MoM[];
  today: string;
}

export function buildProjectPicture({ projectId, projectTimelines, tasks: allTasks, deliverables: allDeliverables, risks: allRisks, moms: allMoms, today }: PictureInput) {
  const pid = projectId || '';
  const timeline = projectTimelines.find(t => t.projectId === pid);
  const revision = timeline?.revisions.find(r => r.id === timeline.activeRevisionId) || timeline?.revisions[0];
  const activities = (revision?.activities || []).filter(a => a && a.status !== 'Dropped');
  const holidays = new Set(timeline?.holidays || []);
  const tasks = activeOnly(allTasks.filter(t => t.projectId === pid));
  const deliverables = activeOnly(allDeliverables.filter(d => d.projectId === pid));
  // Archived risks are out of the picture: the heat map, the high-risk count
  // and the attention list all count the active register only.
  const risks = allRisks.filter(r => r.projectId === pid && !r.isArchived);
  const moms = allMoms.filter(m => m.projectId === pid);
  const openTasks = tasks.filter(t => !CLOSED_TASK.includes(t.status));
  const openDeliverables = deliverables.filter(d => !CLOSED_DELIVERABLE.includes(d.status));
  const openRisks = risks.filter(r => r.status !== 'Mitigated');
  // Action items still only in the minutes (not pushed to a task yet).
  const looseActions = moms.flatMap(m => (m.actionItems || [])
    .filter(ai => isActionItemUnpushed(ai) && !CLOSED_TASK.includes(ai.status) && (ai.description || '').trim())
    .map(ai => ({ ...ai, momId: m.id, momTitle: m.title })));

  // ---- schedule: weighted progress, actual against planned for today
  const weightOf = (a: TimelineActivity) => Number(a.weight) || 0;
  const totalWeight = activities.reduce((s, a) => s + weightOf(a), 0);
  const useWeights = totalWeight > 0;
  const denom = useWeights ? totalWeight : activities.length || 1;
  const w = (a: TimelineActivity) => (useWeights ? weightOf(a) : 1);
  const actual = activities.reduce((s, a) => s + w(a) * Math.max(0, Math.min(1, Number(a.progress) || 0)), 0) / denom;
  const planned = activities.reduce((s, a) => s + w(a) * plannedShare(a, today), 0) / denom;
  const starts = activities.map(a => isoDay(a.targetStartDate)).filter(Boolean).sort();
  const ends = activities.map(a => isoDay(a.targetCompletionDate)).filter(Boolean).sort();
  const startDay = starts[0] || '';
  const finishDay = ends[ends.length - 1] || '';
  // The planned curve, sampled across the plan, for the little S-curve.
  const curve: { day: string; planned: number }[] = [];
  if (startDay && finishDay && finishDay > startDay) {
    const span = dayNumber(finishDay) - dayNumber(startDay);
    for (let i = 0; i <= 40; i++) {
      const day = addDaysISO(startDay, Math.round((span * i) / 40));
      curve.push({ day, planned: activities.reduce((s, a) => s + w(a) * plannedShare(a, day), 0) / denom });
    }
  }

  // ---- per phase: actual and planned
  const phaseOrder: string[] = [];
  const phases: Record<string, { w: number; actual: number; planned: number; late: number }> = {};
  activities.forEach(a => {
    const key = a.phase || 'No phase';
    if (!phases[key]) { phases[key] = { w: 0, actual: 0, planned: 0, late: 0 }; phaseOrder.push(key); }
    const ww = w(a);
    phases[key].w += ww;
    phases[key].actual += ww * Math.max(0, Math.min(1, Number(a.progress) || 0));
    phases[key].planned += ww * plannedShare(a, today);
    if (!DONE_ACTIVITY.includes(a.status) && !PAUSED_ACTIVITY.includes(a.status) && isoDay(a.targetCompletionDate) && isoDay(a.targetCompletionDate) < today) phases[key].late++;
  });

  // ---- one list of what needs the user
  const items: AttentionItem[] = [];
  const pushDated = (kind: Kind, key: string, title: string, owner: string | undefined, date: string, closed: boolean, blocked: boolean, to: string) => {
    const state = dueState(date, closed);
    if (state === 'overdue') {
      const late = Math.abs(daysFromToday(date));
      items.push({ key, kind, title, owner, date, rank: 0 - late / 10000, tag: `${late}D LATE`, tagTone: 'late', to });
    } else if (blocked) {
      items.push({ key, kind, title, owner, date, rank: 1, tag: 'BLOCKED', tagTone: 'blocked', to });
    } else if (state === 'today') {
      items.push({ key, kind, title, owner, date, rank: 3, tag: 'TODAY', tagTone: 'soon', to });
    } else if (state === 'soon') {
      items.push({ key, kind, title, owner, date, rank: 4 + daysFromToday(date) / 100, tag: `IN ${daysFromToday(date)}D`, tagTone: 'soon', to });
    }
  };
  openTasks.forEach(t => pushDated(t.type === 'Issue' ? 'ISSUE' : 'TASK', `t-${t.id}`, t.description || 'Untitled', t.owner,
    isoDay(t.estimatedResolutionDate), false, t.status === 'Blocked', `/tasks-issues?open=${encodeURIComponent(t.id)}`));
  openDeliverables.forEach(d => pushDated('DELIVERABLE', `d-${d.id}`, d.title || 'Untitled', d.owner,
    isoDay(d.dueDate), false, d.status === 'Blocked', `/deliverables?open=${encodeURIComponent(d.id)}`));
  activities.forEach(a => {
    if (DONE_ACTIVITY.includes(a.status) || PAUSED_ACTIVITY.includes(a.status)) return;
    const title = [a.activity, a.subActivity].filter(Boolean).join(' — ') || 'Untitled activity';
    const end = isoDay(a.targetCompletionDate);
    const start = isoDay(a.targetStartDate);
    // Not started although it should have: that is late too, by its start.
    if (a.status === 'Not Started' && start && start < today && !(end && end < today)) {
      const late = Math.abs(daysFromToday(start));
      items.push({ key: `a-${a.id}`, kind: 'ACTIVITY', title, owner: a.owner, date: start, rank: 0 - late / 10000, tag: `START ${late}D LATE`, tagTone: 'late', to: '/timeline' });
      return;
    }
    pushDated('ACTIVITY', `a-${a.id}`, title, a.owner, end, false, false, '/timeline');
  });
  looseActions.forEach(ai => pushDated('ACTION', `m-${ai.id}`, ai.description, ai.assignee,
    isoDay(ai.estimatedResolutionDate), false, ai.status === 'Blocked',
    // Opens that meeting's minutes and lands on this action item (see Mom.tsx).
    `/mom?mom=${encodeURIComponent(ai.momId)}&action=${encodeURIComponent(ai.id)}`));
  openRisks
    .filter(r => r.riskValue === 'Highest' || r.riskValue === 'High')
    .forEach(r => {
      const date = isoDay(r.targetResolutionDate);
      if (date && date < today) {
        pushDated('RISK', `r-${r.id}`, r.projectSpecificDescription || r.riskDescription || 'Risk', r.owner, date, false, false, `/risks?open=${encodeURIComponent(r.id)}`);
      } else {
        items.push({ key: `r-${r.id}`, kind: 'RISK', title: r.projectSpecificDescription || r.riskDescription || 'Risk', owner: r.owner, date,
          rank: r.riskValue === 'Highest' ? 2 : 2.5, tag: String(r.riskValue).toUpperCase(), tagTone: 'risk', to: `/risks?open=${encodeURIComponent(r.id)}` });
      }
    });
  items.sort((a, b) => a.rank - b.rank || (a.date || '').localeCompare(b.date || ''));

  const lateCount = items.filter(i => i.tagTone === 'late').length;
  const soonCount = items.filter(i => i.tagTone === 'soon').length;
  const blockedCount = openTasks.filter(t => t.status === 'Blocked').length + openDeliverables.filter(d => d.status === 'Blocked').length;
  const highRiskCount = openRisks.filter(r => r.riskValue === 'Highest' || r.riskValue === 'High').length;

  // ---- the next fourteen days
  const days = Array.from({ length: 14 }, (_, i) => addDaysISO(today, i));
  const byDay: Record<string, { kind: Kind; title: string }[]> = {};
  const onDay = (date: string, kind: Kind, title: string) => {
    if (!date || date < today || date > days[13]) return;
    (byDay[date] = byDay[date] || []).push({ kind, title });
  };
  openTasks.forEach(t => onDay(isoDay(t.estimatedResolutionDate), t.type === 'Issue' ? 'ISSUE' : 'TASK', t.description));
  openDeliverables.forEach(d => onDay(isoDay(d.dueDate), 'DELIVERABLE', d.title));
  activities.filter(a => !DONE_ACTIVITY.includes(a.status)).forEach(a => {
    onDay(isoDay(a.targetCompletionDate), 'ACTIVITY', `Ends: ${[a.activity, a.subActivity].filter(Boolean).join(' — ')}`);
    if (!isoDay(a.actualStartDate)) onDay(isoDay(a.targetStartDate), 'ACTIVITY', `Starts: ${[a.activity, a.subActivity].filter(Boolean).join(' — ')}`);
  });
  looseActions.forEach(ai => onDay(isoDay(ai.estimatedResolutionDate), 'ACTION', ai.description));

  // ---- risk heat map (open risks only)
  const { heat, opportunities, uncertain, unassessed } = countHeat(risks);

  // ---- open work per person
  const owners: Record<string, { open: number; late: number }> = {};
  const count = (who: string | undefined, late: boolean) => {
    const name = (who || '').trim() || 'Unassigned';
    owners[name] = owners[name] || { open: 0, late: 0 };
    owners[name].open++;
    if (late) owners[name].late++;
  };
  openTasks.forEach(t => count(t.owner, dueState(isoDay(t.estimatedResolutionDate)) === 'overdue'));
  openDeliverables.forEach(d => count(d.owner, dueState(isoDay(d.dueDate)) === 'overdue'));
  looseActions.forEach(ai => count(ai.assignee, dueState(isoDay(ai.estimatedResolutionDate)) === 'overdue'));
  activities
    .filter(a => !DONE_ACTIVITY.includes(a.status) && !PAUSED_ACTIVITY.includes(a.status) && isoDay(a.targetStartDate) && isoDay(a.targetStartDate) <= today)
    .forEach(a => count(a.owner, !!isoDay(a.targetCompletionDate) && isoDay(a.targetCompletionDate) < today));
  const workload = Object.entries(owners).sort((a, b) => b[1].late - a[1].late || b[1].open - a[1].open);

  // ---- deliverables by status
  // The whole record of the project's deliverables, archived ones included —
  // archiving files a deliverable away, it does not undo it. Dropped ones are
  // left out: they were never going to be delivered.
  const charted = allDeliverables.filter(d => d.projectId === pid && d.status !== 'Dropped');
  const delStatus: Record<string, number> = {};
  charted.forEach(d => { delStatus[d.status] = (delStatus[d.status] || 0) + 1; });
  const deliverableArchivedCount = charted.filter(d => (d as any).isArchived).length;

  return {
    hasTimeline: activities.length > 0, actual, planned, startDay, finishDay, curve,
    phaseOrder, phases, items, lateCount, soonCount, blockedCount, highRiskCount,
    days, byDay, holidays, heat, opportunities, uncertain, unassessed, workload, delStatus,
    deliverableTotal: charted.length, deliverableArchivedCount, openTaskCount: openTasks.length,
  };
}

export type ProjectPicture = ReturnType<typeof buildProjectPicture>;
