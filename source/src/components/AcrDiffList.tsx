import React from 'react';
import { ArrowRight, Plus, Trash2, MessageSquare, Pencil } from 'lucide-react';
import {
  AcrFieldDiff,
  formatAcrValue,
  getAcrActionSpec,
  AcrActionKind,
} from '../utils/acrDiff';

/**
 * ACR DIFF LIST — the one block that draws "what it was" next to "what it
 * becomes".
 *
 * Used in two places, and it must look the same in both:
 *   - the review side panel, on every change card;
 *   - every module's detail panel, under the fields that module draws itself.
 *
 * The second use is the safety net. A module only draws the fields somebody
 * wrote a line for. This block draws whatever is left, so an argument no module
 * knows about is still on the screen before anyone signs it off.
 */

// ---------------------------------------------------------------------------

interface AcrValueBlockProps {
  value: any;
  tone: 'old' | 'new' | 'plain';
}

const AcrValueBlock: React.FC<AcrValueBlockProps> = ({ value, tone }) => {
  const text = formatAcrValue(value);
  const isLong = text.length > 90 || text.includes('\n');

  const toneClass =
    tone === 'old'
      ? 'text-qb-grey line-through decoration-qb-grey/60'
      : tone === 'new'
        ? 'text-qb-black font-bold'
        : 'text-qb-dark-grey';

  return (
    <span
      className={`text-[11px] font-mono leading-snug break-words ${toneClass} ${
        isLong ? 'whitespace-pre-wrap block' : ''
      }`}
    >
      {text}
    </span>
  );
};

// ---------------------------------------------------------------------------

export interface AcrDiffListProps {
  diffs: AcrFieldDiff[];
  /** Shown above the rows. Leave out for no heading. */
  title?: string;
  /** A brand new record has no old value worth drawing, so only NEW is shown. */
  hideOldValues?: boolean;
  /** Drawn when there is nothing to list. Leave out to render nothing at all. */
  emptyLabel?: string;
  className?: string;
  dense?: boolean;
}

export const AcrDiffList: React.FC<AcrDiffListProps> = ({
  diffs,
  title,
  hideOldValues = false,
  emptyLabel,
  className = '',
  dense = false,
}) => {
  if (!diffs || diffs.length === 0) {
    if (!emptyLabel) return null;
    return (
      <div
        className={`text-[10px] font-black uppercase tracking-widest text-qb-grey ${className}`}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${dense ? 'gap-1.5' : 'gap-2'} ${className}`}>
      {title && (
        <div className="text-[10px] font-black uppercase tracking-widest text-qb-grey border-b border-qb-light-grey pb-1">
          {title}
        </div>
      )}

      {diffs.map((diff) => (
        <div
          key={diff.key}
          className="border-l-2 border-qb-cyan pl-2.5 py-1 bg-qb-cyan/5"
        >
          <div className="text-[9px] font-black uppercase tracking-widest text-qb-dark-grey mb-0.5 flex items-center gap-1.5">
            {diff.label}
            {diff.isAddition && !hideOldValues && (
              <span className="text-[9px] font-black uppercase tracking-widest text-[#51b53e] bg-[#51b53e]/10 px-1 py-px border border-[#51b53e]/25">
                WAS EMPTY
              </span>
            )}
          </div>

          {hideOldValues ? (
            <AcrValueBlock value={diff.newValue} tone="new" />
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-qb-grey shrink-0 w-7">
                  OLD
                </span>
                <AcrValueBlock value={diff.oldValue} tone="old" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-qb-orange shrink-0 w-7">
                  NEW
                </span>
                <AcrValueBlock value={diff.newValue} tone="new" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------

const KIND_STYLE: Record<
  AcrActionKind,
  { label: string; color: string; bg: string; border: string; Icon: any }
> = {
  add: {
    label: 'PROPOSED NEW',
    color: 'text-[#51b53e]',
    bg: 'bg-[#51b53e]/5',
    border: 'border-[#51b53e]',
    Icon: Plus,
  },
  update: {
    label: 'PROPOSED EDIT',
    color: 'text-[#ff7600]',
    bg: 'bg-[#ff7600]/5',
    border: 'border-[#ff7600]',
    Icon: Pencil,
  },
  delete: {
    label: 'PROPOSED REMOVAL',
    color: 'text-qb-magenta',
    bg: 'bg-qb-magenta/5',
    border: 'border-qb-magenta',
    Icon: Trash2,
  },
  comment: {
    label: 'PROPOSED COMMENT',
    color: 'text-qb-cyan',
    bg: 'bg-qb-cyan/5',
    border: 'border-qb-cyan',
    Icon: MessageSquare,
  },
  other: {
    label: 'PROPOSED ACTION',
    color: 'text-qb-dark-grey',
    bg: 'bg-qb-light-grey/20',
    border: 'border-qb-dark-grey',
    Icon: ArrowRight,
  },
};

export function acrKindStyle(kind: AcrActionKind) {
  return KIND_STYLE[kind] || KIND_STYLE.other;
}

// ---------------------------------------------------------------------------

export interface AcrStatusLineProps {
  /** The action name, e.g. `deleteTask`. */
  actionName: string;
  /** True when the user has unticked this change in the review panel. */
  declined?: boolean;
  /** Overrides the default wording. */
  text?: string;
  className?: string;
}

/**
 * One line, for the two things a field cannot say by itself.
 *
 * There used to be a banner here that repeated the change title and then listed
 * every changed field. It was removed: each field already shows its own old and
 * new value, so the banner said everything twice.
 *
 * What no field can say is that a whole record is about to be removed — a
 * removal changes no field, so without this line the most destructive action of
 * the three would have nothing on the screen at all. Use it for that, and for
 * telling someone they are editing a proposal rather than the record, on
 * screens whose fields do not show the comparison themselves.
 */
export const AcrStatusLine: React.FC<AcrStatusLineProps> = ({
  actionName,
  declined = false,
  text,
  className = '',
}) => {
  const spec = getAcrActionSpec(actionName);
  const style = acrKindStyle(spec.kind);
  const { Icon } = style;

  const wording =
    text ||
    (spec.kind === 'delete'
      ? 'Signing off removes this record.'
      : 'You are editing the proposal, not the record.');

  return (
    <div
      className={`flex items-center gap-2 border-l-4 ${style.border} ${style.bg} px-3 py-2 ${
        declined ? 'opacity-50' : ''
      } ${className}`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${style.color}`} />
      <span
        className={`text-[10px] font-black uppercase tracking-widest ${style.color}`}
      >
        {style.label}
        {declined && ' · DECLINED'}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-qb-dark-grey">
        {wording}
      </span>
    </div>
  );
};

export default AcrDiffList;
