import React, { useState } from 'react';
import { Bold, Italic, Link, List, ListOrdered, Code, Quote, Table } from 'lucide-react';
import TurndownService from 'turndown';

interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ id, value, onChange, placeholder, className = '', minHeight = 'min-h-[200px]' }) => {
  const [showTablePopup, setShowTablePopup] = useState(false);
  const [tableCols, setTableCols] = useState(3);
  const [tableRows, setTableRows] = useState(3);

  const insertText = (before: string, after: string = '') => {
    const textarea = document.getElementById(id) as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = value || '';
    const selectedText = currentText.substring(start, end);
    
    const newText = currentText.substring(0, start) + before + selectedText + after + currentText.substring(end);
    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  };

  const handleInsertTable = (cols: number, rows: number) => {
    let table = '\n';
    table += '| ' + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(' | ') + ' |\n';
    table += '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n';
    for (let r = 0; r < rows; r++) {
      table += '| ' + Array.from({ length: cols }, (_, i) => `Cell ${r + 1}-${i + 1}`).join(' | ') + ' |\n';
    }
    table += '\n';

    insertText(table, '');
    setShowTablePopup(false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    
    if (html) {
      e.preventDefault();
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced'
      });
      const markdown = turndownService.turndown(html);
      
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentText = value || '';
      
      const newText = currentText.substring(0, start) + markdown + currentText.substring(end);
      onChange(newText);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + markdown.length, start + markdown.length);
      }, 0);
    }
  };

  return (
    <div className={`flex flex-col border border-qb-light-grey bg-transparent ${className}`}>
      <div className="flex items-center gap-1 px-4 py-2 border-b border-qb-light-grey bg-qb-box-bg shrink-0 overflow-x-auto">
        <button type="button" onClick={() => insertText('**', '**')} className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" title="Bold"><Bold className="w-4 h-4" /></button>
        <button type="button" onClick={() => insertText('_', '_')} className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" title="Italic"><Italic className="w-4 h-4" /></button>
        <div className="w-px h-4 bg-qb-light-grey mx-1" />
        <button type="button" onClick={() => insertText('[', '](url)')} className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" title="Link"><Link className="w-4 h-4" /></button>
        <button type="button" onClick={() => insertText('> ')} className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" title="Quote"><Quote className="w-4 h-4" /></button>
        <button type="button" onClick={() => insertText('`', '`')} className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" title="Code"><Code className="w-4 h-4" /></button>
        <div className="w-px h-4 bg-qb-light-grey mx-1" />
        <button type="button" onClick={() => insertText('- ')} className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" title="Bulleted List"><List className="w-4 h-4" /></button>
        <button type="button" onClick={() => insertText('1. ')} className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" title="Numbered List"><ListOrdered className="w-4 h-4" /></button>
        <div className="w-px h-4 bg-qb-light-grey mx-1" />
        <button type="button" onClick={() => setShowTablePopup(!showTablePopup)} className={`p-1.5 rounded transition-colors ${showTablePopup ? 'bg-qb-orange/15 text-qb-orange' : 'text-qb-dark-grey hover:text-qb-black hover:bg-black/5'}`} title="Insert Table"><Table className="w-4 h-4" /></button>
      </div>

      {showTablePopup && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-b border-qb-light-grey bg-qb-bg">
          <span className="text-xs font-black text-qb-black uppercase tracking-widest font-sans">TABLE GENERATOR</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-qb-grey font-sans">COLS:</span>
            <input 
              type="number" 
              min={1} 
              max={15} 
              value={tableCols} 
              onChange={(e) => setTableCols(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-12 border border-qb-light-grey bg-white text-center text-xs font-bold p-1 outline-none text-qb-black"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-qb-grey font-sans">ROWS:</span>
            <input 
              type="number" 
              min={1} 
              max={30} 
              value={tableRows} 
              onChange={(e) => setTableRows(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-12 border border-qb-light-grey bg-white text-center text-xs font-bold p-1 outline-none text-qb-black"
            />
          </div>
          <div className="flex items-center gap-2">
            <button 
              type="button" 
              onClick={() => handleInsertTable(tableCols, tableRows)}
              className="px-3 py-1 bg-qb-orange text-white text-[10px] font-black uppercase tracking-widest hover:opacity-90 duration-150 cursor-pointer font-sans"
            >
              INSERT
            </button>
            <button 
              type="button" 
              onClick={() => setShowTablePopup(false)}
              className="px-3 py-1 bg-qb-light-grey/50 text-qb-dark-grey hover:text-qb-black text-[10px] font-black uppercase tracking-widest duration-150 cursor-pointer font-sans"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        <textarea
          id={id}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          className={`w-full p-4 outline-none resize-y font-mono text-sm leading-relaxed text-qb-dark-grey bg-transparent placeholder:text-qb-light-grey ${minHeight}`}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
};
