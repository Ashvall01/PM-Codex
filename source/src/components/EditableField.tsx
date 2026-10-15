import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Check, Edit2, X, Search, ChevronDown } from 'lucide-react';
import { DateVisualizer } from './DateVisualizer';

export interface SelectOption {
  label: string;
  value: string;
  secondary?: string;
  phase?: string;
}

interface EditableFieldProps {
  label?: string;
  value: string;
  onSave: (newValue: string) => void;
  type?: 'text' | 'textarea' | 'date' | 'select';
  options?: string[] | SelectOption[];
  searchable?: boolean;
  searchPlaceholder?: string;
  placeholder?: string;
  displayFormatter?: (val: string) => string | React.ReactNode;
  className?: string;
  textClassName?: string;
  isProposalDiff?: boolean;
  proposedValue?: string;
  disabled?: boolean;
  rows?: number;
}

export const EditableField: React.FC<EditableFieldProps> = ({
  label,
  value,
  onSave,
  type = 'text',
  options = [],
  searchable = false,
  searchPlaceholder = 'Search activities...',
  placeholder = '--',
  displayFormatter,
  className = '',
  textClassName = '',
  isProposalDiff = false,
  proposedValue,
  disabled = false,
  rows = 3,
}) => {
  /**
   * When a field carries a proposed change, the field shows OLD and NEW, and
   * the thing the user edits is the NEW one.
   *
   * This used to seed the editor from `value`, which is the value the record
   * holds today. Double-clicking a proposed field therefore threw the proposal
   * away and put the old text back in the box, and `handleSave` then compared
   * the result against the old value too, so retyping the proposed text saved
   * nothing at all. `baseValue` is the single answer to both.
   */
  const hasProposal = isProposalDiff && proposedValue !== undefined;
  const baseValue = hasProposal ? proposedValue : value;

  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(baseValue || '');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedOptions: SelectOption[] = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === 'string') {
        return { label: opt, value: opt };
      }
      return opt;
    });
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return normalizedOptions;
    const q = searchQuery.toLowerCase();
    return normalizedOptions.filter((opt) => {
      const matchLabel = opt.label?.toLowerCase().includes(q);
      const matchVal = opt.value?.toLowerCase().includes(q);
      const matchSecondary = opt.secondary?.toLowerCase().includes(q);
      const matchPhase = opt.phase?.toLowerCase().includes(q);
      return matchLabel || matchVal || matchSecondary || matchPhase;
    });
  }, [normalizedOptions, searchQuery]);

  useEffect(() => {
    if (isEditing && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isEditing, searchable]);

  // The assistant can revise a pending proposal while the panel is open. If the
  // box is closed, follow the new value; if the user is typing, leave them be.
  useEffect(() => {
    if (!isEditing) setDraftValue(baseValue || '');
  }, [baseValue, isEditing]);

  // One click opens the editor (it used to take a double-click, which nothing
  // on screen made obvious). A click on a link inside the value still follows
  // the link, and selecting text to copy it does not open the editor.
  const handleStartEdit = (e: React.MouseEvent) => {
    if (disabled) return;
    if ((e.target as HTMLElement).closest?.('a')) return;
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && e.currentTarget.contains(selection.anchorNode)) return;
    e.stopPropagation();
    setDraftValue(baseValue || '');
    setSearchQuery('');
    setIsEditing(true);
  };

  const handleSave = (valToSave?: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    const finalVal = valToSave !== undefined ? valToSave : draftValue;
    setIsEditing(false);
    setSearchQuery('');
    if (finalVal !== baseValue) {
      onSave(finalVal);
    }
  };

  const handleCancel = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsEditing(false);
    setSearchQuery('');
    setDraftValue(baseValue || '');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (type !== 'textarea' && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div className={`relative group/editable ${className}`}>
      {label && (
        <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-1">
          {label}
        </label>
      )}

      {isEditing ? (
        <div className="flex flex-col gap-2 animate-fade-in" onClick={(e) => e.stopPropagation()}>
          {type === 'textarea' ? (
            <textarea
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={rows}
              autoFocus
              className="w-full bg-qb-box-bg border-none p-3 text-sm font-medium text-qb-black outline-none focus:ring-2 focus:ring-qb-orange resize-none tracking-wide"
            />
          ) : type === 'select' && searchable ? (
            <div className="w-full border-2 border-qb-black bg-qb-box-bg shadow-md flex flex-col">
              {/* Search Bar */}
              <div className="p-2 border-b border-qb-light-grey/40 bg-white flex items-center gap-2">
                <Search className="w-4 h-4 text-qb-grey shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancel();
                    } else if (e.key === 'Enter' && filteredOptions.length > 0) {
                      e.preventDefault();
                      handleSave(filteredOptions[0].value);
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full text-xs font-bold text-qb-black placeholder:text-qb-grey outline-none uppercase tracking-wide bg-transparent"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-qb-grey hover:text-qb-black p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Options list */}
              <div className="max-h-56 overflow-y-auto divide-y divide-qb-light-grey/20 bg-qb-box-bg">
                {filteredOptions.length === 0 ? (
                  <div className="p-4 text-center text-xs font-bold text-qb-grey uppercase tracking-widest">
                    No matching activities found
                  </div>
                ) : (
                  filteredOptions.map((opt) => {
                    const isSelected = draftValue === opt.value;
                    return (
                      <div
                        key={opt.value}
                        onClick={() => {
                          setDraftValue(opt.value);
                          handleSave(opt.value);
                        }}
                        className={`px-3 py-2.5 cursor-pointer transition-all flex items-start justify-between gap-3 text-left ${
                          isSelected
                            ? 'bg-[#111111] text-white border-l-4 border-qb-orange font-bold'
                            : 'hover:bg-white text-qb-black hover:border-l-4 hover:border-qb-cyan'
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {opt.phase && (
                              <span className="text-[9px] font-mono font-bold tracking-widest text-qb-grey uppercase bg-black/5 px-1.5 py-0.2">
                                {opt.phase}
                              </span>
                            )}
                            <span className={`text-xs uppercase tracking-wide truncate ${isSelected ? 'text-white font-black' : 'text-qb-black font-bold'}`}>
                              {opt.label}
                            </span>
                          </div>
                          {opt.secondary && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-qb-grey">
                                Sub-Activity:
                              </span>
                              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isSelected ? 'text-qb-orange' : 'text-qb-dark-grey'}`}>
                                {opt.secondary}
                              </span>
                            </div>
                          )}
                        </div>
                        {isSelected && (
                          <div className="w-4 h-4 bg-qb-orange text-black flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Status bar */}
              <div className="px-3 py-1.5 bg-[#1a1a1a] text-white flex items-center justify-between text-[9px] font-mono uppercase tracking-wider border-t border-qb-light-grey/20">
                <span className="text-qb-grey">
                  {filteredOptions.length} of {normalizedOptions.length} activities
                </span>
                <span className="text-qb-grey">Click item to select</span>
              </div>
            </div>
          ) : type === 'select' ? (
            <select
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              autoFocus
              className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-2 focus:ring-qb-orange uppercase tracking-wide cursor-pointer"
            >
              {options.map((opt) => {
                const val = typeof opt === 'string' ? opt : opt.value;
                const lbl = typeof opt === 'string' ? opt : opt.label;
                return (
                  <option key={val} value={val}>
                    {lbl}
                  </option>
                );
              })}
            </select>
          ) : type === 'date' ? (
            <input
              type="date"
              value={(draftValue || '').split('T')[0]}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-2 focus:ring-qb-orange font-mono uppercase tracking-wide"
            />
          ) : (
            <input
              type="text"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-2 focus:ring-qb-orange uppercase tracking-wide"
            />
          )}

          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => handleSave()}
              className="flex items-center gap-1 bg-qb-black text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 hover:bg-qb-orange transition-colors"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="flex items-center gap-1 bg-transparent text-qb-grey text-[10px] font-black uppercase tracking-widest px-3 py-1.5 hover:text-qb-black border border-qb-light-grey transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={handleStartEdit}
          className={`flex items-start justify-between gap-2 p-1.5 -m-1.5 rounded transition-colors ${
            disabled ? '' : 'hover:bg-black/5 cursor-pointer'
          }`}
        >
          <div className="flex-1 min-w-0">
            {hasProposal ? (
              /* Old above, new below, in the same order and the same colours as
                 the review panel uses. Clicking here edits the NEW line. */
              <div className="flex flex-col gap-1 border-l-4 border-qb-cyan pl-3 bg-qb-cyan/5 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-qb-grey shrink-0 w-7">
                    OLD
                  </span>
                  <span className="text-xs font-mono font-bold text-qb-grey line-through tracking-wider break-words min-w-0">
                    {displayFormatter ? displayFormatter(value) : value || placeholder}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-qb-orange shrink-0 w-7">
                    NEW
                  </span>
                  <span className="text-sm font-black text-qb-black tracking-wider break-words min-w-0">
                    {displayFormatter ? displayFormatter(proposedValue) : proposedValue || placeholder}
                  </span>
                </div>
                {!disabled && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-qb-grey/70 pt-0.5">
                    Click to edit the proposed value
                  </span>
                )}
              </div>
            ) : type === 'date' && value ? (
              <DateVisualizer date={value}>
                <div className={textClassName || 'text-sm font-bold text-qb-black tracking-wide py-1'}>
                  {displayFormatter ? displayFormatter(value) : value || placeholder}
                </div>
              </DateVisualizer>
            ) : (
              <div className={textClassName || 'text-sm font-bold text-qb-black tracking-wide py-1'}>
                {displayFormatter ? displayFormatter(value) : value || placeholder}
              </div>
            )}
          </div>
          {!disabled && (
            <div className="flex items-center shrink-0 self-center opacity-0 group-hover/editable:opacity-100 transition-opacity pointer-events-none">
              <span className="p-1 text-qb-grey">
                <Edit2 className="w-3.5 h-3.5" />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
