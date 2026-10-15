/**
 * POWER × INTEREST — where each stakeholder sits, and what to do about them.
 *
 * The Venn shows how power, interest and knowledge overlap, but not what to
 * do. This is the classic grid: power up the side, interest along the bottom,
 * and the four strategies it implies. High counts as the upper half; Medium
 * and Low as the lower one. Reads the Power and Interest already recorded —
 * nothing new to fill in. A click opens the stakeholder, as in the list.
 */
import React from 'react';
import { tint } from '../../utils/statusStyle';

const LEVELS = ['High', 'Medium', 'Low'] as const;
const INTEREST = ['Low', 'Medium', 'High'] as const;

type Zone = 'manage' | 'satisfy' | 'inform' | 'monitor';
const ZONES: Record<Zone, { label: string; how: string; color: string }> = {
  manage: { label: 'Manage closely', how: 'Involve in decisions; meet regularly.', color: 'var(--color-qb-magenta)' },
  satisfy: { label: 'Keep satisfied', how: 'Brief on outcomes; do not overload with detail.', color: 'var(--color-qb-orange)' },
  inform: { label: 'Keep informed', how: 'Regular updates; use their interest and ideas.', color: 'var(--color-qb-cyan)' },
  monitor: { label: 'Monitor', how: 'Light touch; watch for changes.', color: 'var(--color-qb-grey)' },
};
const zoneOf = (power: string, interest: string): Zone =>
  power === 'High' ? (interest === 'High' ? 'manage' : 'satisfy') : (interest === 'High' ? 'inform' : 'monitor');
/** Each zone is named once, in its top-left cell. */
const LABEL_CELL: Record<string, Zone> = {
  'High|Low': 'satisfy', 'High|High': 'manage', 'Medium|High': 'inform', 'Medium|Low': 'monitor',
};

const shortName = (name: string) => {
  const parts = (name || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : (parts[0] || 'Unnamed');
};

export const PowerInterestGrid: React.FC<{
  stakeholders: any[];
  activeId: string | null;
  onSelect: (id: string) => void;
}> = ({ stakeholders, activeId, onSelect }) => {
  const rated = stakeholders.filter(s => LEVELS.includes(s.power) && LEVELS.includes(s.interest));
  const unrated = stakeholders.filter(s => !rated.includes(s));

  const chip = (s: any) => {
    const mark = s.isAcrProposedAdd ? 'border-[#51b53e] bg-[#51b53e]/10'
      : s.isAcrProposedUpdate ? 'border-[#ff7600] bg-[#ff7600]/10'
      : s.isAcrProposedDelete ? 'border-qb-magenta line-through opacity-70'
      : 'border-qb-light-grey bg-qb-bg';
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => onSelect(s.id)}
        title={`${s.name}${s.projectRole || s.role ? ` — ${s.projectRole || s.role}` : ''}${s.organization ? `, ${s.organization}` : ''} · power ${s.power}, interest ${s.interest}, knowledge ${s.knowledge}`}
        className={`px-2 py-1 border text-[10px] font-mono font-bold uppercase tracking-wide text-qb-black hover:border-qb-black transition-colors ${mark} ${activeId === s.id ? 'ring-2 ring-qb-orange' : ''}`}
      >
        {shortName(s.name)}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-3">
        {/* Power axis */}
        <div className="flex flex-col w-16 shrink-0">
          {LEVELS.map(p => (
            <div key={p} className="flex-1 min-h-[120px] flex items-center justify-end pr-1 text-[10px] font-black uppercase tracking-widest text-qb-grey">{p}</div>
          ))}
          <div className="h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {LEVELS.map(power => INTEREST.map(interest => {
              const zone = zoneOf(power, interest);
              const z = ZONES[zone];
              const people = rated.filter(s => s.power === power && s.interest === interest);
              const labelHere = LABEL_CELL[`${power}|${interest}`];
              return (
                <div
                  key={`${power}|${interest}`}
                  className="min-h-[120px] p-3 pt-7 relative flex flex-wrap content-start gap-1.5"
                  style={{ background: tint(z.color, zone === 'monitor' ? 8 : 12) }}
                >
                  {labelHere && (
                    <span className="absolute top-2 left-3 text-[10px] font-black uppercase tracking-widest" style={{ color: z.color }}>
                      {z.label}
                    </span>
                  )}
                  {people.map(chip)}
                </div>
              );
            }))}
          </div>
          <div className="grid mt-1.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {INTEREST.map(i => (
              <span key={i} className="text-center text-[10px] font-black uppercase tracking-widest text-qb-grey">{i}</span>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-qb-dark-grey">
            <span>Power ↑</span><span>Interest →</span>
          </div>
        </div>
      </div>

      {/* What each zone asks of you */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {(Object.keys(ZONES) as Zone[]).map(k => (
          <div key={k} className="border-l-4 pl-3 py-1" style={{ borderColor: ZONES[k].color }}>
            <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: ZONES[k].color }}>
              {ZONES[k].label} <span className="text-qb-grey font-mono">· {rated.filter(s => zoneOf(s.power, s.interest) === k).length}</span>
            </div>
            <div className="text-xs text-qb-dark-grey mt-0.5">{ZONES[k].how}</div>
          </div>
        ))}
      </div>

      {unrated.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-qb-grey mr-1">Power or interest not set:</span>
          {unrated.map(chip)}
        </div>
      )}
    </div>
  );
};
