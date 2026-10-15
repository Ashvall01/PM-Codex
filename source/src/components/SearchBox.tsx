/**
 * The search box for a record list, and the marks it leaves on the results.
 * Press "/" anywhere on the page to start typing; Escape clears it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Search, X, HelpCircle } from 'lucide-react';
import { highlightPieces } from '../utils/recordSearch';

export const SearchBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown at the right while searching: "12 found". */
  resultLabel?: string;
}> = ({ value, onChange, placeholder = 'Search…', resultLabel }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative flex items-center">
      <div className={`flex items-center gap-2 border px-2.5 py-1.5 w-64 xl:w-80 transition-colors ${value ? 'border-qb-orange bg-qb-orange/5' : 'border-transparent bg-qb-box-bg focus-within:border-qb-orange'}`}>
        <Search className={`w-3.5 h-3.5 shrink-0 ${value ? 'text-qb-orange' : 'text-qb-grey'}`} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { onChange(''); (e.target as HTMLInputElement).blur(); } }}
          placeholder={placeholder}
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent outline-none text-xs font-bold text-qb-black placeholder:text-qb-grey placeholder:font-medium"
        />
        {resultLabel && value && (
          <span className="text-[10px] font-mono font-bold uppercase text-qb-orange whitespace-nowrap">{resultLabel}</span>
        )}
        {value ? (
          <button type="button" onClick={() => { onChange(''); inputRef.current?.focus(); }} className="text-qb-grey hover:text-qb-black" title="Clear (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-[9px] font-mono font-bold text-qb-grey border border-qb-light-grey px-1 leading-4" title="Press / to search">/</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setShowHelp((v) => !v)}
        onBlur={() => setTimeout(() => setShowHelp(false), 150)}
        className="ml-1.5 text-qb-grey hover:text-qb-orange"
        title="How to search"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {showHelp && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-qb-bg border border-qb-light-grey shadow-2xl p-4 text-xs text-qb-dark-grey">
          <div className="text-[10px] font-black uppercase tracking-widest text-qb-black mb-2">How to search</div>
          <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
            <li><b className="text-qb-black">cutover plan</b> — both words, anywhere</li>
            <li><b className="text-qb-black">"cutover plan"</b> — the exact phrase</li>
            <li><b className="text-qb-black">-done</b> — leave out records with it</li>
            <li><b className="text-qb-black">owner:rina</b> · <b className="text-qb-black">status:blocked</b> · <b className="text-qb-black">priority:high</b></li>
            <li><b className="text-qb-black">due:2026-10</b> · <b className="text-qb-black">due:week</b> · <b className="text-qb-black">due:overdue</b></li>
            <li><b className="text-qb-black">is:late</b> · <b className="text-qb-black">is:open</b> · <b className="text-qb-black">is:flagged</b> · <b className="text-qb-black">is:unassigned</b></li>
          </ul>
          <p className="mt-2 leading-relaxed">Looks in titles, descriptions, remarks, comments, owners and linked timeline activities. Press <b>/</b> to start, <b>Esc</b> to clear.</p>
        </div>
      )}
    </div>
  );
};

/** Text with the searched words marked. */
export const Highlight: React.FC<{ text: string; needles: string[] }> = ({ text, needles }) => {
  if (!needles.length) return <>{text}</>;
  return (
    <>
      {highlightPieces(text, needles).map((p, i) =>
        p.hit ? <mark key={i} className="bg-qb-orange/25 text-inherit px-0">{p.text}</mark> : <React.Fragment key={i}>{p.text}</React.Fragment>,
      )}
    </>
  );
};
