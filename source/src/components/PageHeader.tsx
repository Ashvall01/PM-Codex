/**
 * The top of every module: title, a few live counts, and the controls, on one
 * line.
 *
 * Modules used to open with a 36px title and a subtitle that described the
 * module ("TRACK ACTION ITEMS AND RESOLVE ISSUES") — about a sixth of a laptop
 * screen before the first record. The subtitle is replaced by counts that say
 * something today ("14 OPEN · 4 LATE"), and the space goes to the data.
 */
import React from 'react';

export const PageHeader: React.FC<{
  title: React.ReactNode;
  /** Short live counts shown beside the title — use <Stat/>. */
  stats?: React.ReactNode;
  /** Controls on the right: filters, sort, the New button. */
  children?: React.ReactNode;
  className?: string;
}> = ({ title, stats, children, className = '' }) => (
  <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 mb-6 ${className}`}>
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 min-w-0">
      <h1 className="text-2xl font-black text-qb-black uppercase tracking-widest leading-tight">{title}</h1>
      {stats && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] font-mono font-bold uppercase tracking-wider text-qb-grey">
          {stats}
        </div>
      )}
    </div>
    {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
  </div>
);

/** One count beside a page title. Takes colour only when it needs you (n > 0). */
const TONE: Record<string, string> = {
  magenta: 'text-qb-magenta', orange: 'text-qb-orange', cyan: 'text-qb-cyan', green: 'text-qb-green',
};
export const Stat: React.FC<{ n: number; label: string; tone?: 'magenta' | 'orange' | 'cyan' | 'green' }> = ({ n, label, tone }) => (
  <span className={n > 0 && tone ? TONE[tone] : ''}>
    <span className={n > 0 && tone ? '' : 'text-qb-dark-grey'}>{n}</span> {label}
  </span>
);

/** The shared look of a header button. `primary` is the orange "New …" button. */
export const headerButtonClass = (primary = false) =>
  primary
    ? 'flex items-center gap-2 bg-qb-orange hover:bg-qb-orange/90 text-white px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors'
    : 'flex items-center gap-2 bg-qb-box-bg hover:bg-qb-light-grey text-qb-black px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors';
