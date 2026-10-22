import React from 'react';
import { formatAcrValue } from '../utils/acrDiff';

/**
 * A proposed comment, drawn where comments live — one card for every module.
 *
 * Two kinds of proposal arrive here. A NEW comment (addTaskComment,
 * addDeliverableComment) shows its text and says it is not posted yet. An EDIT
 * (editTaskComment, editDeliverableComment) carries a `commentId`: the card
 * finds that comment on the record and shows the old text above the new, so the
 * person signing off sees what the comment says now and what it will say.
 */
interface ProposedCommentCardProps {
  change: any;
  /** The comments already on the record. */
  comments: { id: string; text: string; author?: string }[];
}

export const ProposedCommentCard: React.FC<ProposedCommentCardProps> = ({ change, comments }) => {
  const commentId = change?.args?.commentId;
  const isEdit = !!commentId;
  const original = isEdit ? (comments || []).find((c) => c.id === commentId) : undefined;
  const declined = change?.approved === false;

  return (
    <div className={`border-l-4 border-qb-cyan bg-qb-cyan/5 p-4 relative ${declined ? 'opacity-50' : ''}`}>
      <div className="text-[9px] font-black uppercase tracking-widest text-qb-cyan mb-1.5">
        {isEdit ? 'Proposed Comment Edit' : 'Proposed Comment'}{declined ? ' · Not selected' : ''}
      </div>
      {isEdit && (
        <div className="mb-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-qb-grey mb-0.5">
            Now{original?.author === 'Assistant' ? ' (by Assistant)' : original ? ' (by User)' : ''}
          </div>
          <p className="text-sm text-qb-grey leading-relaxed whitespace-pre-wrap line-through decoration-qb-grey/50">
            {original ? original.text : 'That comment is no longer on this record.'}
          </p>
          <div className="text-[9px] font-black uppercase tracking-widest text-qb-cyan mt-2 mb-0.5">Becomes</div>
        </div>
      )}
      <p className="text-sm text-qb-black mb-2 leading-relaxed whitespace-pre-wrap">
        {formatAcrValue(change?.args?.text)}
      </p>
      <div className="text-[10px] font-bold text-qb-grey uppercase tracking-widest border-t border-qb-cyan/30 pt-2">
        {isEdit ? 'Not changed yet — applied when you sign off' : 'Not posted yet — added when you sign off'}
      </div>
    </div>
  );
};
