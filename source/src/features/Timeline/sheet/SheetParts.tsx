/**
 * Small pieces of the timeline table: the holiday list, the hint under the
 * editor, and the help text for each error.
 */
import React, { useState } from 'react';
import { CalendarOff, X } from 'lucide-react';
import * as D from './dates';

export const ERROR_HELP: Record<string, string> = {
  '#REF!': 'This formula points to a cell that is not there any more (a deleted row, or above row 1).',
  '#VALUE!': 'Wrong kind of value. For example, text where a number or a date must be.',
  '#DIV/0!': 'The formula divides by zero.',
  '#NAME?': 'Unknown function or name. Check the spelling.',
  '#NUM!': 'A number is out of range (for example, a date before 1900).',
  '#N/A': 'The value was not found.',
  '#CIRCULAR!': 'A loop: this formula needs its own answer, through other cells or directly.',
  '#ERROR!': 'The formula cannot be read. Check the brackets, commas and quotes.',
};

export function HolidaysPopover({
  holidays: stored, proposed, onChange, onClose,
}: {
  holidays: string[];
  /** A pending change request's list. Shown against the stored one; edits go to it. */
  proposed?: string[] | null;
  onChange: (list: string[]) => void;
  onClose: () => void;
}) {
  // While a proposal is open, the popover edits the PROPOSED list and marks
  // what it adds and removes; the stored list changes only on sign-off.
  const holidays = proposed ?? stored;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const parts = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const found: string[] = [];
    const bad: string[] = [];
    for (const p of parts) {
      const s = D.parseDateText(p);
      if (s === null) bad.push(p); else found.push(D.serialToIso(s));
    }
    if (found.length) onChange([...holidays, ...found]);
    setError(bad.length ? `Not a date: ${bad.join(', ')}` : null);
    setText(bad.join(', '));
  };

  const sorted = Array.from(new Set([...holidays, ...(proposed ? stored : [])])).sort();
  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 w-80 bg-qb-bg border border-qb-light-grey shadow-2xl p-4 text-xs"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-black uppercase tracking-widest text-qb-black text-[10px] flex items-center gap-2">
          <CalendarOff className="w-3.5 h-3.5 text-qb-orange" /> Project holidays
        </span>
        <button onClick={onClose} className="text-qb-grey hover:text-qb-orange"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-qb-dark-grey mb-3 leading-relaxed">
        WORKDAY and NETWORKDAYS skip these days, and weekends. Type a date, day first (28/09/2026), or paste many.
      </p>
      {proposed && (
        <p className="mb-3 px-2 py-1.5 border border-qb-orange/50 bg-qb-orange/10 text-qb-orange font-black uppercase tracking-widest text-[9px]">
          Proposed change — edits here go to the proposal
        </p>
      )}
      <div className="flex gap-2 mb-2">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="e.g. 17/08/2026"
          className="flex-1 border border-qb-light-grey bg-white px-2 py-1.5 outline-none focus:border-qb-orange font-mono"
        />
        <button onClick={add} className="px-3 bg-qb-black text-white font-black uppercase tracking-widest text-[10px] hover:bg-qb-orange">Add</button>
      </div>
      {error && <div className="text-qb-magenta mb-2">{error}</div>}
      <div className="max-h-56 overflow-auto border-t border-qb-box-bg">
        {sorted.length === 0 && <div className="py-3 text-qb-grey">No holidays yet.</div>}
        {sorted.map((h) => {
          const s = D.isoToSerial(h)!;
          const added = !!proposed && !stored.includes(h);
          const removed = !!proposed && !proposed.includes(h);
          return (
            <div key={h} className="flex items-center justify-between py-1.5 border-b border-qb-box-bg">
              <span className={`font-mono ${removed ? 'line-through text-qb-magenta' : added ? 'text-qb-green font-bold' : ''}`}>
                {D.DAY_SHORT[D.dayOfWeek(s)]}, {D.formatDateCell(h)}
                {added && <span className="ml-2 text-[9px] font-black uppercase tracking-widest">new</span>}
                {removed && <span className="ml-2 text-[9px] font-black uppercase tracking-widest no-underline">removed</span>}
              </span>
              {removed ? (
                <button onClick={() => onChange([...holidays, h])} className="text-[9px] font-black uppercase tracking-widest text-qb-grey hover:text-qb-orange">Keep</button>
              ) : (
                <button onClick={() => onChange(holidays.filter((x) => x !== h))} className="text-qb-light-grey hover:text-qb-magenta">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface HintState {
  /** Choices to pick from (functions or status values). */
  list: { label: string; detail?: string }[];
  highlighted: number;
  /** "WORKDAY(start_date, days, [holidays])", split so the current argument can be bold. */
  signature?: { before: string; current: string; after: string; help: string };
  /** The answer so far, or how a typed date is read. */
  preview?: { text: string; bad: boolean };
  error?: string | null;
}

export function HintBox({
  hint, style, onPick,
}: { hint: HintState; style: React.CSSProperties; onPick: (i: number) => void }) {
  const has = hint.list.length || hint.signature || hint.preview || hint.error;
  if (!has) return null;
  return (
    <div
      className="absolute z-40 bg-qb-bg border border-qb-light-grey shadow-xl text-xs min-w-[220px] max-w-[420px] pointer-events-auto"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {hint.error && <div className="px-3 py-2 text-qb-magenta font-bold border-b border-qb-box-bg">{hint.error}</div>}
      {hint.signature && (
        <div className="px-3 py-2 border-b border-qb-box-bg">
          <div className="font-mono text-[11px] text-qb-dark-grey">
            {hint.signature.before}<b className="text-qb-black">{hint.signature.current}</b>{hint.signature.after}
          </div>
          <div className="text-qb-grey mt-1 leading-snug">{hint.signature.help}</div>
        </div>
      )}
      {hint.list.length > 0 && (
        <div className="max-h-56 overflow-auto">
          {hint.list.map((item, i) => (
            <div
              key={item.label}
              onMouseDown={(e) => { e.preventDefault(); onPick(i); }}
              className={`px-3 py-1.5 cursor-pointer ${i === hint.highlighted ? 'bg-qb-orange/15 text-qb-black' : 'hover:bg-black/5 text-qb-dark-grey'}`}
            >
              <div className="font-mono font-bold text-[11px]">{item.label}</div>
              {item.detail && <div className="text-[10px] text-qb-grey truncate">{item.detail}</div>}
            </div>
          ))}
        </div>
      )}
      {hint.preview && (
        <div className={`px-3 py-1.5 font-mono text-[11px] ${hint.preview.bad ? 'text-qb-magenta' : 'text-qb-grey'}`}>
          {hint.preview.text}
        </div>
      )}
    </div>
  );
}
