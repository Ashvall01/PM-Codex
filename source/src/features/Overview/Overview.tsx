/**
 * OVERVIEW — the project on one screen.
 *
 * Every other module answers "what is in here?". This one answers the two
 * questions a project manager opens the app with: where do we stand, and what
 * needs me today. It reads the stores and changes nothing: no field on this
 * screen is editable, and a click only takes you to the record in its module
 * (?open=<id>), where the usual editing and change-request rules apply.
 *
 * Kept to pictures a glance can read: a schedule meter and planned curve,
 * counts that only turn colour when they need you, one list of what is late or
 * stuck, the next fourteen days as a strip, the risk heat map, and who holds
 * how much open work.
 */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, AlertTriangle, CalendarDays, Flame, Users, Layers, Activity } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useTasksStore } from '../../store/tasksStore';
import { useDeliverablesStore } from '../../store/deliverablesStore';
import { useRisksStore } from '../../store/risksStore';
import { useMomStore } from '../../store/momStore';
import { tint, todayISO, daysFromToday, DELIVERABLE_STATUS_COLORS } from '../../utils/statusStyle';
import { buildProjectPicture, KIND_COLOR, Kind, shortDate, dayNumber } from '../../utils/projectHealth';
import { RiskHeatMap } from '../../components/RiskHeatMap';
import { PageHeader } from '../../components/PageHeader';

// --------------------------------------------------------------- component

export default function Overview() {
  const navigate = useNavigate();
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const project = useAppStore(s => s.projects.find(p => p.id === s.activeProjectId));
  const projectTimelines = useTimelineStore(s => s.projectTimelines);
  const allTasks = useTasksStore(s => s.tasks);
  const allDeliverables = useDeliverablesStore(s => s.deliverables);
  const allRisks = useRisksStore(s => s.risks);
  const riskMatrix = useRisksStore(s => s.riskMatrixConfig);
  const allMoms = useMomStore(s => s.moms);

  const today = todayISO();

  const data = useMemo(
    () => buildProjectPicture({ projectId: activeProjectId || '', projectTimelines, tasks: allTasks, deliverables: allDeliverables, risks: allRisks, moms: allMoms, today }),
    [activeProjectId, projectTimelines, allTasks, allDeliverables, allRisks, allMoms, today],
  );

  if (!activeProjectId) return null;

  const gap = Math.round((data.actual - data.planned) * 100);
  const scheduleTone = !data.hasTimeline ? 'grey' : gap <= -5 ? 'magenta' : gap < 0 ? 'orange' : 'green';
  const toneText: Record<string, string> = { magenta: 'text-qb-magenta', orange: 'text-qb-orange', green: 'text-qb-green', grey: 'text-qb-grey' };
  const finishIn = data.finishDay ? daysFromToday(data.finishDay) : null;

  return (
    <div className="h-full overflow-y-auto pt-4 sm:pt-8 px-4 sm:px-12 pb-16 font-sans">
      {/* Header, the same shape as every module's */}
      <PageHeader
        title="Overview"
        stats={<span>{project?.name ? `${project.name} · ` : ''}as of {shortDate(today)}</span>}
      />

      {/* ---------------------------------------------------------------- KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-10">
        {/* Schedule: the one tile two tiles wide */}
        <div className="col-span-2 border border-qb-light-grey p-5 relative">
          <div className="absolute top-0 right-0 w-2 h-2 bg-qb-orange" />
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-qb-grey flex items-center gap-1.5"><Activity className="w-3 h-3" /> Schedule</h3>
            {data.hasTimeline && (
              <span className={`text-[10px] font-black uppercase tracking-widest ${toneText[scheduleTone]}`}>
                {gap === 0 ? 'ON PLAN' : `${Math.abs(gap)} PT${Math.abs(gap) === 1 ? '' : 'S'} ${gap > 0 ? 'AHEAD' : 'BEHIND'}`}
              </span>
            )}
          </div>
          {data.hasTimeline ? (
            <>
              <div className="flex items-baseline gap-3 mb-3">
                <span className={`text-4xl font-mono ${toneText[scheduleTone]}`}>{Math.round(data.actual * 100)}%</span>
                <span className="text-xs font-mono text-qb-grey">DONE · PLAN SAYS {Math.round(data.planned * 100)}%</span>
              </div>
              {/* Actual as the bar, planned as the tick */}
              <div className="relative h-2 bg-qb-box-bg mb-4">
                <div className="absolute inset-y-0 left-0" style={{ width: `${data.actual * 100}%`, background: `var(--color-qb-${scheduleTone === 'grey' ? 'grey' : scheduleTone})` }} />
                <div className="absolute -top-1 -bottom-1 w-[2px] bg-qb-black" style={{ left: `calc(${data.planned * 100}% - 1px)` }} title={`Planned today: ${Math.round(data.planned * 100)}%`} />
              </div>
              <PlannedCurve curve={data.curve} today={today} actual={data.actual} tone={scheduleTone} />
            </>
          ) : (
            <p className="text-xs text-qb-grey uppercase tracking-widest">No timeline yet</p>
          )}
        </div>

        <KpiTile label="Finish" icon={<CalendarDays className="w-3 h-3" />}
          value={finishIn === null ? '--' : finishIn >= 0 ? `${finishIn}D` : `${Math.abs(finishIn)}D AGO`}
          sub={data.finishDay ? shortDate(data.finishDay) : 'NO END DATE'} tone="grey" />
        <KpiTile label="Late" icon={<AlertTriangle className="w-3 h-3" />} value={String(data.lateCount)}
          sub="PAST THEIR DATE" tone={data.lateCount ? 'magenta' : 'green'} />
        <KpiTile label="Due in 7 days" icon={<CalendarDays className="w-3 h-3" />} value={String(data.soonCount)}
          sub={`${data.blockedCount} BLOCKED`} tone={data.soonCount ? 'orange' : 'grey'} />
        <KpiTile label="High risks" icon={<Flame className="w-3 h-3" />} value={String(data.highRiskCount)}
          sub="OPEN, HIGH OR HIGHEST" tone={data.highRiskCount ? 'magenta' : 'green'} onClick={() => navigate('/risks')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-10">
        {/* ----------------------------------------------------- needs attention */}
        <section className="xl:col-span-3">
          <SectionTitle icon={<AlertTriangle className="w-3.5 h-3.5" />} title="Needs attention" count={data.items.length} />
          {data.items.length === 0 ? (
            <p className="text-xs font-bold uppercase tracking-widest text-qb-green border border-dashed border-qb-light-grey p-6 text-center">
              Nothing late, blocked or due this week
            </p>
          ) : (
            <div className="flex flex-col">
              {data.items.slice(0, 14).map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.to)}
                  className="group flex items-center gap-3 py-2.5 px-3 border-b border-qb-light-grey text-left hover:bg-black/5 transition-colors"
                >
                  <span className="w-[86px] shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 text-center"
                    style={{ color: KIND_COLOR[item.kind], backgroundColor: tint(KIND_COLOR[item.kind], 12) }}>
                    {item.kind}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-qb-dark-grey group-hover:text-qb-black">{item.title}</span>
                  {item.owner && (
                    <span className="hidden md:inline text-[10px] font-bold font-mono uppercase tracking-wider text-qb-dark-grey bg-black/5 px-2 py-0.5 border border-qb-light-grey max-w-[110px] truncate shrink-0">
                      {item.owner}
                    </span>
                  )}
                  <span className={`w-[118px] shrink-0 text-right text-[10px] font-black font-mono uppercase tracking-wider ${
                    item.tagTone === 'late' || item.tagTone === 'risk' || item.tagTone === 'blocked' ? 'text-qb-magenta' : 'text-qb-orange'}`}>
                    {item.tag}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-qb-light-grey group-hover:text-qb-orange shrink-0" />
                </button>
              ))}
              {data.items.length > 14 && (
                <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey pt-3">+ {data.items.length - 14} more</p>
              )}
            </div>
          )}
        </section>

        <div className="xl:col-span-2 flex flex-col gap-10">
          {/* --------------------------------------------------- next 14 days */}
          <section>
            <SectionTitle icon={<CalendarDays className="w-3.5 h-3.5" />} title="Next 14 days" />
            <div className="grid border border-qb-light-grey" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
              {data.days.map((day, i) => {
                const d = new Date(`${day}T00:00:00`);
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const holiday = data.holidays.has(day);
                const due = data.byDay[day] || [];
                return (
                  <div key={day}
                    className={`relative flex flex-col items-center gap-1 pt-1.5 pb-2 min-h-[92px] ${i > 0 ? 'border-l border-qb-light-grey' : ''} ${weekend || holiday ? 'bg-black/[0.04]' : ''} ${i === 0 ? 'bg-qb-orange/10' : ''}`}
                    title={[holiday ? 'Holiday' : '', ...due.map(x => `${x.kind}: ${x.title}`)].filter(Boolean).join('\n') || shortDate(day)}>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${i === 0 ? 'text-qb-orange' : 'text-qb-grey'}`}>
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()]}
                    </span>
                    <span className={`text-[11px] font-mono font-bold ${i === 0 ? 'text-qb-orange' : 'text-qb-dark-grey'}`}>{d.getDate()}</span>
                    <div className="flex flex-col items-center gap-[3px] mt-0.5">
                      {due.slice(0, 5).map((x, j) => (
                        <span key={j} className="w-2 h-2" style={{ background: KIND_COLOR[x.kind] }} />
                      ))}
                      {due.length > 5 && <span className="text-[9px] font-black text-qb-grey">+{due.length - 5}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <Legend kinds={['TASK', 'ISSUE', 'DELIVERABLE', 'ACTIVITY', 'ACTION']} />
          </section>

          {/* ------------------------------------------------------ risk heat */}
          <section>
            <SectionTitle icon={<Flame className="w-3.5 h-3.5" />} title="Open risks" onClick={() => navigate('/risks')} />
            <RiskHeatMap heat={data.heat} matrix={riskMatrix} />
            <p className="text-[9px] font-black uppercase tracking-widest text-qb-grey mt-2">
              {[data.opportunities ? `${data.opportunities} opportunit${data.opportunities === 1 ? 'y' : 'ies'}` : '',
                data.uncertain ? `${data.uncertain} uncertain` : '',
                data.unassessed ? `${data.unassessed} not assessed` : ''].filter(Boolean).join(' · ') || ' '}
            </p>
          </section>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10 mt-12">
        {/* --------------------------------------------------------- by phase */}
        <section>
          <SectionTitle icon={<Layers className="w-3.5 h-3.5" />} title="Progress by phase" onClick={() => navigate('/timeline')} />
          {data.phaseOrder.length === 0 ? <Empty text="No timeline yet" /> : (
            <div className="flex flex-col gap-3">
              {data.phaseOrder.map(key => {
                const p = data.phases[key];
                const a = p.w ? p.actual / p.w : 0, pl = p.w ? p.planned / p.w : 0;
                const behind = pl - a > 0.05;
                return (
                  <div key={key}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[11px] font-black uppercase tracking-widest text-qb-dark-grey truncate">{key}</span>
                      <span className={`text-[10px] font-mono font-bold ${behind ? 'text-qb-magenta' : 'text-qb-grey'}`}>
                        {Math.round(a * 100)}% <span className="text-qb-grey">/ {Math.round(pl * 100)}%</span>
                        {p.late > 0 && <span className="text-qb-magenta"> · {p.late} LATE</span>}
                      </span>
                    </div>
                    <div className="relative h-1.5 bg-qb-box-bg">
                      <div className="absolute inset-y-0 left-0" style={{ width: `${a * 100}%`, background: a >= 1 ? 'var(--color-qb-green)' : behind ? 'var(--color-qb-magenta)' : 'var(--color-qb-cyan)' }} />
                      <div className="absolute -top-0.5 -bottom-0.5 w-[2px] bg-qb-black" style={{ left: `calc(${pl * 100}% - 1px)` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-[9px] font-black uppercase tracking-widest text-qb-grey">Bar: done · tick: where the plan says it should be today</p>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------ open work */}
        <section>
          <SectionTitle icon={<Users className="w-3.5 h-3.5" />} title="Open work by person" />
          {data.workload.length === 0 ? <Empty text="No open work" /> : (
            <div className="flex flex-col gap-2.5">
              {(() => {
                const max = Math.max(...data.workload.map(([, v]) => v.open));
                return data.workload.slice(0, 8).map(([name, v]) => (
                  <div key={name} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-[10px] font-black uppercase tracking-widest text-qb-dark-grey truncate" title={name}>{name}</span>
                    <div className="flex-1 flex h-3">
                      <div style={{ width: `${(v.late / max) * 100}%`, background: 'var(--color-qb-magenta)' }} />
                      <div style={{ width: `${((v.open - v.late) / max) * 100}%`, background: 'var(--color-qb-cyan)', opacity: 0.55 }} />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[10px] font-mono font-bold text-qb-dark-grey">
                      {v.open}{v.late ? <span className="text-qb-magenta"> · {v.late}</span> : null}
                    </span>
                  </div>
                ));
              })()}
              <p className="text-[9px] font-black uppercase tracking-widest text-qb-grey">Tasks, deliverables, running activities and unpushed MoM actions · magenta = late</p>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- deliverables */}
        <section>
          <SectionTitle icon={<Layers className="w-3.5 h-3.5" />} title="Deliverables" count={data.deliverableTotal} onClick={() => navigate('/deliverables')} />
          {data.deliverableTotal === 0 ? <Empty text="No deliverables yet" /> : (
            <>
              <div className="flex h-5 w-full border border-qb-light-grey">
                {['Signed Off', 'In Review', 'In Progress', 'Blocked', 'On Hold', 'Pending'].map(st => {
                  const n = data.delStatus[st] || 0;
                  if (!n) return null;
                  return <div key={st} title={`${st}: ${n}`} style={{ width: `${(n / data.deliverableTotal) * 100}%`, background: DELIVERABLE_STATUS_COLORS[st] }} />;
                })}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                {['Signed Off', 'In Review', 'In Progress', 'Blocked', 'On Hold', 'Pending'].filter(st => data.delStatus[st]).map(st => (
                  <span key={st} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">
                    <span className="w-2 h-2" style={{ background: DELIVERABLE_STATUS_COLORS[st] }} />
                    {st} <span className="font-mono text-qb-grey">{data.delStatus[st]}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-qb-grey">
                Includes archived deliverables{data.deliverableArchivedCount ? ` (${data.deliverableArchivedCount})` : ''} · dropped ones are left out
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ small parts

const TONE_TEXT: Record<string, string> = {
  magenta: 'text-qb-magenta', orange: 'text-qb-orange', green: 'text-qb-green', grey: 'text-qb-black',
};

const KpiTile: React.FC<{ label: string; value: string; sub: string; tone: string; icon?: React.ReactNode; onClick?: () => void }> = ({ label, value, sub, tone, icon, onClick }) => (
  <div
    onClick={onClick}
    className={`border border-qb-light-grey p-5 relative ${onClick ? 'cursor-pointer hover:border-qb-dark-grey transition-colors' : ''}`}
  >
    <div className={`absolute top-0 right-0 w-2 h-2 ${tone === 'magenta' ? 'bg-qb-magenta' : tone === 'orange' ? 'bg-qb-orange' : 'bg-qb-black'}`} />
    <h3 className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-3 flex items-center gap-1.5">{icon}{label}</h3>
    <p className={`text-4xl font-mono ${TONE_TEXT[tone] || 'text-qb-black'}`}>{value}</p>
    <p className="text-[9px] font-black uppercase tracking-widest text-qb-grey mt-2">{sub}</p>
  </div>
);

const SectionTitle: React.FC<{ title: string; icon?: React.ReactNode; count?: number; onClick?: () => void }> = ({ title, icon, count, onClick }) => (
  <div className="flex items-center justify-between border-b border-qb-black/60 pb-2 mb-4">
    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-qb-black flex items-center gap-2">
      <span className="text-qb-orange">{icon}</span>
      {title}
      {count !== undefined && <span className="text-qb-grey font-mono">[{count}]</span>}
    </h2>
    {onClick && (
      <button type="button" onClick={onClick} className="text-[9px] font-black uppercase tracking-widest text-qb-grey hover:text-qb-orange flex items-center gap-1">
        Open <ArrowRight className="w-3 h-3" />
      </button>
    )}
  </div>
);

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey border border-dashed border-qb-light-grey p-5 text-center">{text}</p>
);

const Legend: React.FC<{ kinds: Kind[] }> = ({ kinds }) => (
  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
    {kinds.map(k => (
      <span key={k} className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-qb-grey">
        <span className="w-2 h-2" style={{ background: KIND_COLOR[k] }} />{k}
      </span>
    ))}
  </div>
);

/** The plan's cumulative curve, with today's actual as a dot. */
const PlannedCurve: React.FC<{ curve: { day: string; planned: number }[]; today: string; actual: number; tone: string }> = ({ curve, today, actual, tone }) => {
  if (curve.length < 2) return null;
  const W = 300, H = 56;
  const first = dayNumber(curve[0].day), last = dayNumber(curve[curve.length - 1].day);
  const x = (day: string) => ((dayNumber(day) - first) / Math.max(1, last - first)) * W;
  const y = (v: number) => H - 4 - v * (H - 8);
  const path = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.planned).toFixed(1)}`).join(' ');
  const tx = Math.max(0, Math.min(W, x(today)));
  const color = tone === 'magenta' ? 'var(--color-qb-magenta)' : tone === 'orange' ? 'var(--color-qb-orange)' : 'var(--color-qb-green)';
  // The curve stretches to the tile's width; the dot and the dates do not.
  // They were drawn inside the stretched drawing, so the dot came out as an
  // oval and the dates squashed flat, with the curve running through them.
  const leftPct = (tx / W) * 100;
  const showToday = leftPct > 14 && leftPct < 86;
  return (
    <div>
      <div className="relative h-14">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
          <path d={`${path} L${W},${H} L0,${H} Z`} fill="var(--color-qb-dark-grey)" opacity={0.07} />
          <path d={path} fill="none" stroke="var(--color-qb-dark-grey)" strokeOpacity={0.55} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <line x1={tx} x2={tx} y1={0} y2={H} stroke="var(--color-qb-orange)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 ring-2 ring-qb-bg"
          style={{ left: `${leftPct}%`, top: `${(y(actual) / H) * 100}%`, background: color }}
          title={`Today: ${Math.round(actual * 100)}% done`}
        />
      </div>
      <div className="relative flex justify-between mt-1.5 text-[9px] font-mono font-bold uppercase tracking-wider text-qb-grey">
        <span>{shortDate(curve[0].day)}</span>
        {showToday && (
          <span className="absolute -translate-x-1/2 text-qb-orange" style={{ left: `${leftPct}%` }}>Today</span>
        )}
        <span>{shortDate(curve[curve.length - 1].day)}</span>
      </div>
    </div>
  );
};

