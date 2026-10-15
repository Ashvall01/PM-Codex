import React, { useRef, useEffect, useState } from 'react';
import { 
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3, 
  AlignLeft, AlignCenter, AlignRight, 
  List, ListOrdered, Quote, Link, Table,
  Undo, Redo, Eraser, Type, Code, Terminal, Minus,
  Palette, Highlighter
} from 'lucide-react';

interface RichTextEditorProps {
  id: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ 
  id, 
  value, 
  onChange, 
  placeholder = 'Start typing rich text here...', 
  minHeight = 'min-h-[200px]' 
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showTablePopup, setShowTablePopup] = useState(false);
  const [showColorPopup, setShowColorPopup] = useState(false);
  const [showHighlightPopup, setShowHighlightPopup] = useState(false);
  const [tableCols, setTableCols] = useState(3);
  const [tableRows, setTableRows] = useState(3);
  const [activeCell, setActiveCell] = useState<HTMLTableCellElement | null>(null);
  const [activeTable, setActiveTable] = useState<HTMLTableElement | null>(null);

  const textColors = [
    { name: 'Default', value: '#596c70' },
    { name: 'Dark Grey', value: '#657b80' },
    { name: 'Grey', value: '#8c9699' },
    { name: 'Orange', value: '#ff7600' },
    { name: 'Magenta', value: '#c11c4d' },
    { name: 'Cyan', value: '#2dbcd2' },
    { name: 'Green', value: '#51b53e' },
  ];

  const highlightColors = [
    { name: 'None', value: 'transparent' },
    { name: 'Orange', value: 'rgba(255, 118, 0, 0.2)' },
    { name: 'Magenta', value: 'rgba(193, 28, 77, 0.2)' },
    { name: 'Cyan', value: 'rgba(45, 188, 210, 0.2)' },
    { name: 'Green', value: 'rgba(81, 181, 62, 0.2)' },
    { name: 'Yellow', value: 'rgba(254, 240, 138, 0.3)' },
  ];

  // Sync prop value to DOM innerHTML only when it differs to prevent cursor jumping
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

  const flushChange = (html: string) => {
    if (html === '<br>' || html === '<p><br></p>') {
      onChangeRef.current('');
    } else {
      onChangeRef.current(html);
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      debounceTimeout.current = setTimeout(() => {
        flushChange(html);
      }, 2000);
    }
  };

  const handleBlur = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      flushChange(html);
    }
  };

  const executeCommand = (command: string, argVal: string = '') => {
    document.execCommand(command, false, argVal);
    if (editorRef.current) {
      flushChange(editorRef.current.innerHTML);
    }
  };

  const handleInsertLink = () => {
    const url = prompt('Enter the link URL (e.g. https://google.com):');
    if (url) {
      // Direct execute
      executeCommand('createLink', url);
    }
  };

  const insertHtmlAtCursor = (html: string) => {
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();

      const el = document.createElement('div');
      el.innerHTML = html;
      const frag = document.createDocumentFragment();
      let node;
      let lastNode;
      while ((node = el.firstChild)) {
        lastNode = frag.appendChild(node);
      }
      range.insertNode(frag);

      // Preserve cursor position after the inserted nodes
      if (lastNode) {
        const nextRange = range.cloneRange();
        nextRange.setStartAfter(lastNode);
        nextRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(nextRange);
      }
      handleInput();
    } else {
      // Fallback: append
      if (editorRef.current) {
        editorRef.current.innerHTML += html;
        flushChange(editorRef.current.innerHTML);
      } else {
        onChangeRef.current((value || '') + html);
      }
    }
  };

  const handleInsertTable = (cols: number, rows: number) => {
    let tableHtml = '<table class="border-collapse border border-qb-light-grey my-4 w-full"><thead><tr>';
    for (let c = 0; c < cols; c++) {
      tableHtml += `<th class="border border-qb-light-grey p-2 bg-qb-box-bg text-qb-black font-black uppercase text-xs">Header ${c + 1}</th>`;
    }
    tableHtml += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      tableHtml += '<tr>';
      for (let c = 0; c < cols; c++) {
        tableHtml += `<td class="border border-qb-light-grey p-2 text-sm text-qb-black">Cell ${r + 1}-${c + 1}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p><br></p>';

    insertHtmlAtCursor(tableHtml);
    setShowTablePopup(false);
  };

  const handleInsertCode = () => {
    const selection = window.getSelection();
    const text = selection ? selection.toString() : '';
    const codeHtml = `<code class="bg-qb-box-bg px-1.5 py-0.5 rounded font-mono text-xs border border-qb-light-grey text-qb-magenta">${text || 'code_snippet'}</code>`;
    insertHtmlAtCursor(codeHtml);
  };

  const handleInsertCodeBlock = () => {
    const selection = window.getSelection();
    const text = selection ? selection.toString() : '';
    const blockHtml = `<pre class="bg-qb-black border border-qb-light-grey p-4 my-4 font-mono text-xs text-white max-w-none overflow-x-auto rounded-none whitespace-pre-wrap"><code>${text || '// Enter code here...'}</code></pre><p><br></p>`;
    insertHtmlAtCursor(blockHtml);
  };

  const handleInsertHR = () => {
    insertHtmlAtCursor('<hr class="border-t border-qb-light-grey my-6" /><p><br></p>');
  };

  const checkSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      let node = selection.getRangeAt(0).startContainer as Node | null;
      let foundCell: HTMLTableCellElement | null = null;
      let foundTable: HTMLTableElement | null = null;

      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.tagName === 'TD' || el.tagName === 'TH') {
            foundCell = el as HTMLTableCellElement;
          }
          if (el.tagName === 'TABLE') {
            foundTable = el as HTMLTableElement;
            break; // Stop climbing once we hit the table
          }
        }
        node = node.parentNode;
      }
      
      setActiveCell(foundCell);
      setActiveTable(foundTable);
    } else {
      setActiveCell(null);
      setActiveTable(null);
    }
  };

  const handleAddRow = (direction: 'above' | 'below') => {
    if (!activeTable || !activeCell) return;
    const tr = activeCell.closest('tr');
    if (!tr) return;
    
    const newTr = document.createElement('tr');
    const colsCount = tr.children.length;
    for (let i = 0; i < colsCount; i++) {
      const td = document.createElement('td');
      td.className = 'border border-qb-light-grey p-2 text-sm text-qb-black';
      td.textContent = 'New Cell';
      newTr.appendChild(td);
    }

    if (direction === 'above') {
      tr.parentNode?.insertBefore(newTr, tr);
    } else {
      tr.parentNode?.insertBefore(newTr, tr.nextSibling);
    }
    handleInput();
  };

  const handleAddColumn = (direction: 'left' | 'right') => {
    if (!activeTable || !activeCell) return;
    const tr = activeCell.closest('tr');
    if (!tr) return;
    
    // Find the index of the active cell
    let cellIndex = 0;
    let curr = activeCell as HTMLElement | null;
    while (curr?.previousElementSibling) {
      cellIndex++;
      curr = curr.previousElementSibling as HTMLElement;
    }

    // Add cell to all rows
    const rows = activeTable.querySelectorAll('tr');
    rows.forEach(row => {
      const isHeader = row.parentNode?.nodeName.toLowerCase() === 'thead';
      const newCell = document.createElement(isHeader ? 'th' : 'td');
      newCell.className = isHeader 
        ? 'border border-qb-light-grey p-2 bg-qb-box-bg text-qb-black font-black uppercase text-xs' 
        : 'border border-qb-light-grey p-2 text-sm text-qb-black';
      newCell.textContent = isHeader ? 'New Header' : 'New Cell';

      const targetCell = row.children[cellIndex];
      if (targetCell) {
        if (direction === 'left') {
          row.insertBefore(newCell, targetCell);
        } else {
          row.insertBefore(newCell, targetCell.nextSibling);
        }
      } else {
        row.appendChild(newCell);
      }
    });
    handleInput();
  };

  const handleDeleteRow = () => {
    if (!activeTable || !activeCell) return;
    const tr = activeCell.closest('tr');
    if (!tr) return;
    
    tr.remove();
    // Check if table is empty
    if (activeTable.querySelectorAll('tr').length === 0) {
      activeTable.remove();
    }
    checkSelection();
    handleInput();
  };

  const handleDeleteColumn = () => {
    if (!activeTable || !activeCell) return;
    const tr = activeCell.closest('tr');
    if (!tr) return;

    let cellIndex = 0;
    let curr = activeCell as HTMLElement | null;
    while (curr?.previousElementSibling) {
      cellIndex++;
      curr = curr.previousElementSibling as HTMLElement;
    }

    const rows = activeTable.querySelectorAll('tr');
    rows.forEach(row => {
      const cell = row.children[cellIndex];
      if (cell) cell.remove();
    });

    // Check if table has no columns left
    if (activeTable.querySelector('tr')?.children.length === 0) {
      activeTable.remove();
    }
    checkSelection();
    handleInput();
  };

  const handleDeleteTable = () => {
    if (!activeTable) return;
    activeTable.remove();
    checkSelection();
    handleInput();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    const html = clipboardData.getData('text/html');
    const text = clipboardData.getData('text/plain');

    if (html) {
      // Create a sandbox DOM parsed view of the input html
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Node sanitization walker
      const sanitizeNode = (node: Node): Node | null => {
        if (node.nodeType === Node.TEXT_NODE) {
          return document.createTextNode(node.nodeValue || '');
        }
        
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const tagName = el.tagName.toLowerCase();
          
          // Allowed structural tags to preserve rich features
          const allowedTags = [
            'p', 'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li', 'br', 'hr', 'blockquote',
            'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre'
          ];
          
          if (!allowedTags.includes(tagName)) {
            // Flatten non-allowed tags (keep child text content)
            const frag = document.createDocumentFragment();
            el.childNodes.forEach(child => {
              const sanitizedChild = sanitizeNode(child);
              if (sanitizedChild) {
                frag.appendChild(sanitizedChild);
              }
            });
            return frag;
          }
          
          const cleanEl = document.createElement(tagName);
          
          // Keep only safe attributes to preserve functioning links
          if (tagName === 'a') {
            const href = el.getAttribute('href');
            if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/') || href.startsWith('mailto:'))) {
              cleanEl.setAttribute('href', href);
              cleanEl.setAttribute('target', '_blank');
              cleanEl.setAttribute('rel', 'noopener noreferrer');
            }
          }
          
          // Keep colspan/rowspan details for merged table cells
          if (tagName === 'td' || tagName === 'th') {
            const colspan = el.getAttribute('colspan');
            const rowspan = el.getAttribute('rowspan');
            if (colspan) {
              cleanEl.setAttribute('colspan', colspan);
            }
            if (rowspan) {
              cleanEl.setAttribute('rowspan', rowspan);
            }
          }
          
          // Apply styled layout classes automatically for rich tables
          if (tagName === 'table') {
            cleanEl.setAttribute('class', 'border-collapse border border-qb-light-grey my-4 w-full');
          } else if (tagName === 'th') {
            cleanEl.setAttribute('class', 'border border-qb-light-grey p-2 bg-qb-box-bg text-qb-black font-black uppercase text-xs');
          } else if (tagName === 'td') {
            cleanEl.setAttribute('class', 'border border-qb-light-grey p-2 text-sm text-qb-black');
          }
          
          el.childNodes.forEach(child => {
            const sanitizedChild = sanitizeNode(child);
            if (sanitizedChild) {
              cleanEl.appendChild(sanitizedChild);
            }
          });
          
          return cleanEl;
        }
        
        return null;
      };
      
      const cleanFragment = document.createDocumentFragment();
      doc.body.childNodes.forEach(child => {
        const sanitized = sanitizeNode(child);
        if (sanitized) {
          cleanFragment.appendChild(sanitized);
        }
      });
      
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(cleanFragment);
      insertHtmlAtCursor(tempDiv.innerHTML);
    } else if (text) {
      // Escape HTML special characters for plain text pasting to prevent script injection or unwanted DOM conversion
      const cleanLines = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .split('\n')
        .join('<br>');
      insertHtmlAtCursor(cleanLines);
    }
  };

  return (
    <div className="flex flex-col border border-qb-light-grey bg-white text-qb-black w-full" id={`rich-editor-wrapper-${id}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-qb-box-bg/50 border-b border-qb-light-grey select-none">
        <button 
          type="button" 
          onClick={() => executeCommand('bold')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Bold"
        >
          <Bold className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('italic')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Italic"
        >
          <Italic className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('underline')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Underline"
        >
          <Underline className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('strikeThrough')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Strikethrough"
        >
          <Strikethrough className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-qb-light-grey mx-1" />

        <button 
          type="button" 
          onClick={() => executeCommand('formatBlock', '<h1>')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors font-bold text-xs flex items-center gap-0.5" 
          title="Heading 1"
        >
          <Heading1 className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('formatBlock', '<h2>')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors font-bold text-xs flex items-center gap-0.5" 
          title="Heading 2"
        >
          <Heading2 className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('formatBlock', '<h3>')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors font-bold text-xs flex items-center gap-0.5" 
          title="Heading 3"
        >
          <Heading3 className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('formatBlock', '<p>')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded pr-2 text-xs font-black uppercase tracking-widest flex items-center gap-1" 
          title="Normal Text"
        >
          <Type className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-qb-light-grey mx-1" />

        <button 
          type="button" 
          onClick={() => executeCommand('justifyLeft')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Align Left"
        >
          <AlignLeft className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('justifyCenter')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Align Center"
        >
          <AlignCenter className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('justifyRight')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Align Right"
        >
          <AlignRight className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-qb-light-grey mx-1" />

        <button 
          type="button" 
          onClick={() => executeCommand('insertUnorderedList')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Bullet List"
        >
          <List className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('insertOrderedList')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('formatBlock', '<blockquote>')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Quote"
        >
          <Quote className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={handleInsertLink} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Insert Link"
        >
          <Link className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={handleInsertHR} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Horizontal Line"
        >
          <Minus className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-qb-light-grey mx-1" />

        <button 
          type="button" 
          onClick={() => handleInsertCode()} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Inline Code"
        >
          <Code className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => handleInsertCodeBlock()} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Code Block"
        >
          <Terminal className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => setShowColorPopup(!showColorPopup)} 
          className={`p-1.5 rounded transition-colors ${showColorPopup ? 'bg-qb-orange/15 text-qb-orange' : 'text-qb-dark-grey hover:text-qb-black hover:bg-black/5'}`} 
          title="Text Color"
        >
          <Palette className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => setShowHighlightPopup(!showHighlightPopup)} 
          className={`p-1.5 rounded transition-colors ${showHighlightPopup ? 'bg-qb-orange/15 text-qb-orange' : 'text-qb-dark-grey hover:text-qb-black hover:bg-black/5'}`} 
          title="Highlight Text"
        >
          <Highlighter className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-qb-light-grey mx-1" />

        <button 
          type="button" 
          onClick={() => setShowTablePopup(!showTablePopup)} 
          className={`p-1.5 rounded transition-colors ${showTablePopup ? 'bg-qb-orange/15 text-qb-orange' : 'text-qb-dark-grey hover:text-qb-black hover:bg-black/5'}`} 
          title="Insert Table"
        >
          <Table className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-qb-light-grey mx-1" />

        <button 
          type="button" 
          onClick={() => executeCommand('undo')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Undo"
        >
          <Undo className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('redo')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Redo"
        >
          <Redo className="w-4 h-4" />
        </button>
        <button 
          type="button" 
          onClick={() => executeCommand('removeFormat')} 
          className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded transition-colors" 
          title="Clear Formatting"
        >
          <Eraser className="w-4 h-4" />
        </button>
      </div>

      {/* Text Color Overlay */}
      {showColorPopup && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-qb-light-grey bg-qb-bg animate-in slide-in-from-top-1 duration-150">
          <span className="text-[10px] font-black text-qb-black uppercase tracking-widest font-sans">TEXT COLOR</span>
          <div className="flex flex-wrap items-center gap-2">
            {textColors.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => {
                  executeCommand('foreColor', c.value);
                  setShowColorPopup(false);
                }}
                className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey hover:border-qb-black cursor-pointer bg-white"
                style={{ color: c.value }}
              >
                {c.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowColorPopup(false)}
              className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest bg-qb-light-grey/50 hover:bg-qb-light-grey text-qb-dark-grey cursor-pointer ml-2 font-sans"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Text Highlight Overlay */}
      {showHighlightPopup && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-qb-light-grey bg-qb-bg animate-in slide-in-from-top-1 duration-150">
          <span className="text-[10px] font-black text-qb-black uppercase tracking-widest font-sans">HIGHLIGHT COLOR</span>
          <div className="flex flex-wrap items-center gap-2">
            {highlightColors.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => {
                  executeCommand('backColor', c.value);
                  setShowHighlightPopup(false);
                }}
                className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey hover:border-qb-black cursor-pointer bg-white text-qb-black"
                style={{ backgroundColor: c.value !== 'transparent' ? c.value : undefined }}
              >
                {c.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowHighlightPopup(false)}
              className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest bg-qb-light-grey/50 hover:bg-qb-light-grey text-qb-dark-grey cursor-pointer ml-2 font-sans"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table Generator Overlay */}
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

      {/* Table Edit Overlay */}
      {activeTable && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-qb-light-grey bg-qb-bg animate-in slide-in-from-top-1 duration-150">
          <span className="text-xs font-black text-qb-black uppercase tracking-widest font-sans mr-2">TABLE OPTIONS</span>
          
          <button type="button" onClick={() => handleAddRow('above')} className="px-2 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey bg-white hover:border-qb-black text-qb-black">Add Row Above</button>
          <button type="button" onClick={() => handleAddRow('below')} className="px-2 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey bg-white hover:border-qb-black text-qb-black">Add Row Below</button>
          
          <div className="w-px h-4 bg-qb-light-grey mx-1" />
          
          <button type="button" onClick={() => handleAddColumn('left')} className="px-2 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey bg-white hover:border-qb-black text-qb-black">Add Col Left</button>
          <button type="button" onClick={() => handleAddColumn('right')} className="px-2 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey bg-white hover:border-qb-black text-qb-black">Add Col Right</button>

          <div className="w-px h-4 bg-qb-light-grey mx-1" />

          <button type="button" onClick={handleDeleteRow} className="px-2 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey bg-white hover:border-qb-magenta text-qb-magenta">Del Row</button>
          <button type="button" onClick={handleDeleteColumn} className="px-2 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-light-grey bg-white hover:border-qb-magenta text-qb-magenta">Del Col</button>
          <button type="button" onClick={handleDeleteTable} className="px-2 py-1 text-[10px] font-black uppercase tracking-widest border border-qb-magenta bg-qb-magenta/10 hover:bg-qb-magenta text-qb-magenta hover:text-white">Del Table</button>
        </div>
      )}

      {/* Editor Body */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onBlur={handleBlur}
          onPaste={handlePaste}
          onKeyUp={checkSelection}
          onClick={checkSelection}
          className={`w-full ${minHeight} p-4 outline-none resize-none font-sans overflow-y-auto prose qb-prose focus:ring-1 focus:ring-qb-orange`}
          data-placeholder={placeholder}
          style={{ minHeight: '150px' }}
        />
      </div>
    </div>
  );
};
