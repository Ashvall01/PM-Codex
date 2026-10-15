/**
 * The risk heat map: impact down the side, probability along the bottom, each
 * cell tinted by the project's own risk matrix, with the count of open risks
 * in it. Used by the Overview and, clickable, by the Risks page.
 */
import React from 'react';
import { ImpactLevel, ProbabilityLevel, RiskMatrix } from '../store/risksStore';
import { tint, RISK_VALUE_COLORS } from '../utils/statusStyle';
import { heatKey } from '../utils/projectHealth';

export { heatKey, countHeat } from '../utils/projectHealth';

export const HEAT_IMPACTS: ImpactLevel[] = ['Catastrophic', 'Critical', 'High', 'Moderate', 'Low'];
export const HEAT_PROBS: ProbabilityLevel[] = ['Rare', 'Low', 'Moderate', 'High', 'Almost Certain'];
const VALUE_COLOR = RISK_VALUE_COLORS;

interface Props {
  heat: Record<string, number>;
  matrix: RiskMatrix | any;
  /** When given, cells with risks can be clicked. */
  onCellClick?: (impact: ImpactLevel, probability: ProbabilityLevel) => void;
  /** The cell currently used as a filter, as heatKey(impact, probability). */
  selected?: string | null;
  cellHeight?: number;
}

export const RiskHeatMap: React.FC<Props> = ({ heat, matrix, onCellClick, selected, cellHeight = 36 }) => (
  <div className="flex">
    <div className="flex flex-col justify-between pr-2 py-0.5">
      {HEAT_IMPACTS.map(i => (
        <span key={i} style={{ height: cellHeight }} className="flex items-center justify-end text-[9px] font-black uppercase tracking-widest text-qb-grey">{i}</span>
      ))}
    </div>
    <div className="flex-1">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {HEAT_IMPACTS.map(impact => HEAT_PROBS.map(prob => {
          const value = matrix?.[impact]?.[prob] || '';
          const color = VALUE_COLOR[value] || 'var(--color-qb-light-grey)';
          const k = heatKey(impact, prob);
          const n = heat[k] || 0;
          const isSelected = selected === k;
          const clickable = !!onCellClick && n > 0;
          return (
            <button
              type="button"
              key={k}
              disabled={!clickable}
              onClick={() => clickable && onCellClick!(impact, prob)}
              title={`${impact} impact · ${prob} probability · ${value}${n ? ` · ${n} open` : ''}${clickable ? ' — click to list them' : ''}`}
              className={`flex items-center justify-center transition-shadow ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-qb-black/40' : 'cursor-default'} ${isSelected ? 'ring-2 ring-qb-black' : ''}`}
              style={{ height: cellHeight, background: tint(color, n ? (value === 'Highest' ? 70 : 38) : 10) }}
            >
              {n > 0 && <span className={`text-sm font-mono font-black ${value === 'Highest' ? 'text-white' : 'text-qb-black'}`}>{n}</span>}
            </button>
          );
        }))}
      </div>
      <div className="grid mt-1" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {HEAT_PROBS.map(p => (
          <span key={p} className="text-center text-[9px] font-black uppercase tracking-widest text-qb-grey leading-tight">{p}</span>
        ))}
      </div>
    </div>
  </div>
);
