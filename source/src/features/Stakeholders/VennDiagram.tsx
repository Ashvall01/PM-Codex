/**
 * POWER · INTEREST · KNOWLEDGE — where each person's weight lies, and what
 * that asks of you.
 *
 * Redrawn 24 Sep 2026. The old version was three blurred, blended discs with
 * one-letter dots scattered over them: no names, nothing to click, and no way
 * to tell what a dot in an overlap meant. This one keeps the idea — three
 * circles, one per quality — and makes it readable:
 *
 *   - Crisp circles, each named with how many people are high in it.
 *   - Every overlap shows its count; hovering it (or its group on the right)
 *     lights that exact area up.
 *   - Beside the diagram, the same groups as a list with names, what the
 *     combination means and how to handle it. A name opens the stakeholder.
 *
 * "In a circle" means rated High. Medium and Low sit outside it, so people
 * who are high in nothing are listed last, under Monitor.
 */
import React, { useMemo, useState } from 'react';
import { Stakeholder } from '../../store/stakeholdersStore';

type Key = 'P' | 'I' | 'K';
interface Segment {
  id: string;
  has: Key[];
  title: string;
  how: string;
  /** Where its count sits in the drawing. */
  at?: [number, number];
}

const C: Record<Key, { cx: number; cy: number; label: string; color: string }> = {
  P: { cx: 150, cy: 150, label: 'Power', color: 'var(--color-qb-orange)' },
  I: { cx: 262, cy: 150, label: 'Interest', color: 'var(--color-qb-magenta)' },
  K: { cx: 206, cy: 245, label: 'Knowledge', color: 'var(--color-qb-cyan)' },
};
const R = 100;

// Most weight first. The positions sit inside each area of the drawing.
const SEGMENTS: Segment[] = [
  { id: 'PIK', has: ['P', 'I', 'K'], title: 'Key players', how: 'High in all three. Involve them in decisions and keep them close.', at: [206, 182] },
  { id: 'PI', has: ['P', 'I'], title: 'Manage closely', how: 'Can decide and care about the outcome. Meet regularly.', at: [206, 112] },
  { id: 'PK', has: ['P', 'K'], title: 'Consult on direction', how: 'Can decide and know the subject. Test key choices with them early.', at: [150, 222] },
  { id: 'IK', has: ['I', 'K'], title: 'Experts & champions', how: 'Care and know the subject. Use them as reviewers and advocates.', at: [262, 222] },
  { id: 'P', has: ['P'], title: 'Keep satisfied', how: 'Power without close interest. Brief them on outcomes, not detail.', at: [100, 128] },
  { id: 'I', has: ['I'], title: 'Keep informed', how: 'Interested but without power. Regular updates keep them on side.', at: [312, 128] },
  { id: 'K', has: ['K'], title: 'Consult for expertise', how: 'Know the subject. Draw on them when a question needs it.', at: [206, 296] },
  { id: '', has: [], title: 'Monitor', how: 'High in none of the three. Light touch; watch for changes.' },
];

const high = (v: any) => String(v || '').toLowerCase() === 'high';
const segmentOf = (s: Stakeholder): string =>
  `${high(s.power) ? 'P' : ''}${high(s.interest) ? 'I' : ''}${high(s.knowledge) ? 'K' : ''}`;

const shortName = (name: string) => {
  const parts = (name || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : (parts[0] || 'Unnamed');
};

export const VennDiagram: React.FC<{
  stakeholders: Stakeholder[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}> = ({ stakeholders, activeId = null, onSelect }) => {
  const [hover, setHover] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map: Record<string, Stakeholder[]> = {};
    SEGMENTS.forEach((seg) => { map[seg.id] = []; });
    stakeholders.forEach((s) => { map[segmentOf(s)].push(s); });
    return map;
  }, [stakeholders]);

  const circleCount = (k: Key) => stakeholders.filter((s) => segmentOf(s).includes(k)).length;
  const hoveredSeg = SEGMENTS.find((s) => s.id === hover) || null;
  const activeSeg = activeId ? segmentOf(stakeholders.find((s) => s.id === activeId) || ({} as any)) : null;

  /** The exact area of one segment: inside its circles, outside the others. */
  const regionMask = (seg: Segment) => {
    const out = (['P', 'I', 'K'] as Key[]).filter((k) => !seg.has.includes(k));
    const [first, ...rest] = seg.has;
    let shape: React.ReactNode = <circle cx={C[first].cx} cy={C[first].cy} r={R} fill="white" />;
    rest.forEach((k) => { shape = <g clipPath={`url(#venn-clip-${k})`}>{shape}</g>; });
    return (
      <mask id={`venn-mask-${seg.id}`} key={seg.id}>
        <rect x="0" y="0" width="412" height="360" fill="black" />
        {shape}
        {out.map((k) => <circle key={k} cx={C[k].cx} cy={C[k].cy} r={R} fill="black" />)}
      </mask>
    );
  };

  const chip = (s: any) => (
    <button
      key={s.id}
      type="button"
      onClick={() => onSelect?.(s.id)}
      title={`${s.name}${s.projectRole || s.role ? ` — ${s.projectRole || s.role}` : ''} · power ${s.power}, interest ${s.interest}, knowledge ${s.knowledge}`}
      className={`px-2 py-1 border text-[10px] font-bold uppercase tracking-wide text-qb-black hover:border-qb-black transition-colors ${
        s.isAcrProposedAdd ? 'border-[#51b53e] bg-[#51b53e]/10'
          : s.isAcrProposedUpdate ? 'border-[#ff7600] bg-[#ff7600]/10'
            : s.isAcrProposedDelete ? 'border-qb-magenta line-through opacity-70'
              : 'border-qb-light-grey bg-white'
      } ${activeId === s.id ? 'ring-2 ring-qb-orange' : ''}`}
    >
      {shortName(s.name)}
    </button>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,440px)_1fr] gap-8 items-start">
      {/* The diagram */}
      <div className="flex flex-col items-center">
        <svg viewBox="0 0 412 360" className="w-full max-w-[440px]" role="img" aria-label="Stakeholders by power, interest and knowledge">
          <defs>
            {(['P', 'I', 'K'] as Key[]).map((k) => (
              <clipPath id={`venn-clip-${k}`} key={k}><circle cx={C[k].cx} cy={C[k].cy} r={R} /></clipPath>
            ))}
            {SEGMENTS.filter((s) => s.has.length).map(regionMask)}
          </defs>

          {/* The circles: a faint fill, a crisp edge. */}
          {(['P', 'I', 'K'] as Key[]).map((k) => (
            <circle
              key={k}
              cx={C[k].cx} cy={C[k].cy} r={R}
              fill={C[k].color}
              fillOpacity={hoveredSeg ? (hoveredSeg.has.includes(k) ? 0.08 : 0.03) : 0.07}
              stroke={C[k].color}
              strokeWidth={1.5}
              strokeOpacity={hoveredSeg && !hoveredSeg.has.includes(k) ? 0.35 : 0.9}
              className="transition-all duration-200"
            />
          ))}

          {/* The area being pointed at, lit exactly. */}
          {hoveredSeg && hoveredSeg.has.length > 0 && (
            <rect x="0" y="0" width="412" height="360" mask={`url(#venn-mask-${hoveredSeg.id})`}
              fill={C[hoveredSeg.has[hoveredSeg.has.length - 1]].color} fillOpacity={0.28} />
          )}

          {/* Circle names, outside the circles */}
          <text x={C.P.cx - 62} y={36} textAnchor="middle" className="font-montserrat" fontSize="11" fontWeight="900" letterSpacing="2" fill={C.P.color}>POWER · {circleCount('P')}</text>
          <text x={C.I.cx + 62} y={36} textAnchor="middle" className="font-montserrat" fontSize="11" fontWeight="900" letterSpacing="2" fill={C.I.color}>INTEREST · {circleCount('I')}</text>
          <text x={C.K.cx} y={356} textAnchor="middle" className="font-montserrat" fontSize="11" fontWeight="900" letterSpacing="2" fill={C.K.color}>KNOWLEDGE · {circleCount('K')}</text>

          {/* One count per area. Hover to light it up; the list follows. */}
          {SEGMENTS.filter((s) => s.at).map((seg) => {
            const n = groups[seg.id].length;
            const isHot = hover === seg.id || activeSeg === seg.id;
            return (
              <g
                key={seg.id}
                transform={`translate(${seg.at![0]} ${seg.at![1]})`}
                onMouseEnter={() => setHover(seg.id)}
                onMouseLeave={() => setHover(null)}
                className="cursor-default"
              >
                <circle r={16} fill={n ? 'var(--color-qb-bg)' : 'transparent'} stroke={n ? (isHot ? 'var(--color-qb-black)' : 'var(--color-qb-light-grey)') : 'transparent'} strokeWidth={isHot ? 2 : 1} />
                <text textAnchor="middle" dy="4.5" fontSize="13" fontWeight="800" fontFamily="JetBrains Mono, monospace"
                  fill={n ? 'var(--color-qb-black)' : 'var(--color-qb-light-grey)'}>{n}</text>
              </g>
            );
          })}
        </svg>
        <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-qb-grey text-center">
          Inside a circle = rated High · Medium and Low sit outside
        </p>
      </div>

      {/* The same groups, named */}
      <div className="flex flex-col gap-2">
        {SEGMENTS.map((seg) => {
          const people = groups[seg.id];
          const isHot = hover === seg.id || activeSeg === seg.id;
          return (
            <div
              key={seg.id || 'none'}
              onMouseEnter={() => setHover(seg.id)}
              onMouseLeave={() => setHover(null)}
              className={`border px-4 py-3 transition-colors ${isHot ? 'border-qb-black bg-qb-box-bg/60' : 'border-qb-light-grey'} ${people.length ? '' : 'opacity-50'}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex gap-1 shrink-0" aria-hidden>
                  {(['P', 'I', 'K'] as Key[]).map((k) => (
                    <span key={k} className="w-2.5 h-2.5 rounded-full border"
                      style={{ borderColor: C[k].color, background: seg.has.includes(k) ? C[k].color : 'transparent' }} />
                  ))}
                </div>
                <span className="text-[11px] font-black uppercase tracking-widest text-qb-black">{seg.title}</span>
                <span className="text-[10px] font-mono font-bold text-qb-grey">
                  {seg.has.length ? seg.has.map((k) => C[k].label).join(' + ') : 'none high'} · {people.length}
                </span>
              </div>
              <p className="text-xs text-qb-dark-grey mt-1">{seg.how}</p>
              {people.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{people.map(chip)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
