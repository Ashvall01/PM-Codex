import React, { useState, useEffect, useRef } from 'react';
import { CodexPage } from '../../store/codexStore';
import { RichTextEditor } from '../../components/RichTextEditor';

interface CodexEditorProps {
  page: CodexPage;
  onUpdate: (updates: Partial<CodexPage>) => void;
}

export default function CodexEditor({ page, onUpdate }: CodexEditorProps) {
  const [localTitle, setLocalTitle] = useState(page.title);
  const titleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalTitle(page.title);
  }, [page.id, page.title]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalTitle(val);
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    titleTimeoutRef.current = setTimeout(() => {
      onUpdate({ title: val });
    }, 1500);
  };

  const handleTitleBlur = () => {
    if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
    if (localTitle !== page.title) {
      onUpdate({ title: localTitle });
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="shrink-0 px-4 py-3 lg:px-6 lg:py-4 border-b border-qb-light-grey bg-transparent">
        <input 
          type="text" 
          value={localTitle}
          onChange={handleTitleChange}
          onBlur={handleTitleBlur}
          className="text-xl lg:text-2xl font-black uppercase tracking-widest w-full outline-none bg-transparent placeholder:text-qb-light-grey text-qb-black font-sans"
          placeholder="PAGE TITLE"
        />
      </div>
      
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <RichTextEditor
          id="codex-content-editor"
          value={page.content || ''}
          onChange={(val) => onUpdate({ content: val })}
          placeholder="Start typing rich content here..."
          minHeight="min-h-[400px]"
        />
      </div>
    </div>
  );
}
