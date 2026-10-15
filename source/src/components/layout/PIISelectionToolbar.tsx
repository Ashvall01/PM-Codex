import React, { useState, useEffect, useRef } from 'react';
import { usePIIStore, PIIType } from '../../store/piiStore';
import { useAppStore } from '../../store/appStore';
import { Shield, Check, X } from 'lucide-react';

export const PIISelectionToolbar: React.FC = () => {
    const activeProjectId = useAppStore(state => state.activeProjectId);
    const addEntry = usePIIStore(state => state.addEntry);
    const updateEntry = usePIIStore(state => state.updateEntry);
    const entries = usePIIStore(state => state.entries);
    const isPlaceholderDuplicate = usePIIStore(state => state.isPlaceholderDuplicate);
    
    const [selectionRect, setSelectionRect] = useState<{top: number, left: number, width: number} | null>(null);
    const [selectedText, setSelectedText] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    
    const [mode, setMode] = useState<'new' | 'existing'>('new');
    const [type, setType] = useState<PIIType>('Name');
    const [existingEntryId, setExistingEntryId] = useState<string>('');

    const formRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<any>(null);

    const projectEntries = entries.filter(e => e.projectId === activeProjectId);

    useEffect(() => {
        if (projectEntries.length > 0 && mode === 'existing' && !existingEntryId) {
            setExistingEntryId(projectEntries[0].id);
        }
    }, [mode, projectEntries, existingEntryId]);

    useEffect(() => {
        const handleSelectionChange = () => {
             // We use a timeout to avoid spamming and to wait for mouseup effectively
             if (timeoutRef.current) clearTimeout(timeoutRef.current);
             
             timeoutRef.current = setTimeout(() => {
                 if (isFormOpen) return; // Don't close if form is open

                 const selection = window.getSelection();
                 if (!selection || selection.isCollapsed) {
                     setSelectionRect(null);
                     setSelectedText('');
                     return;
                 }

                 const text = selection.toString().trim();
                 if (!text || text.length > 100) { // Don't show for huge selections
                     setSelectionRect(null);
                     setSelectedText('');
                     return;
                 }

                 try {
                     const range = selection.getRangeAt(0);
                     const rect = range.getBoundingClientRect();
                     // Only update if it actually has dimensions
                     if (rect.width > 0 && rect.height > 0) {
                         setSelectionRect({ top: rect.top, left: rect.left, width: rect.width });
                         setSelectedText(text);
                     } else {
                         setSelectionRect(null);
                         setSelectedText('');
                     }
                 } catch (e) {
                     setSelectionRect(null);
                     setSelectedText('');
                 }
             }, 200);
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (formRef.current && formRef.current.contains(e.target as Node)) {
                return; // Clicking inside the form
            }
            if (isFormOpen) {
                // Clicking outside closes it
                setIsFormOpen(false);
                setSelectionRect(null);
                setSelectedText('');
                // Clear selection
                const selection = window.getSelection();
                if (selection) selection.removeAllRanges();
            }
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        document.addEventListener('mousedown', handleMouseDown);
        
        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange);
            document.removeEventListener('mousedown', handleMouseDown);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [isFormOpen]);

    if (!activeProjectId || !selectionRect || !selectedText) return null;

    const handleSave = () => {
        if (mode === 'new') {
            let defaultPlaceholder = `[Redacted_${type}_1]`;
            let counter = 1;
            while (isPlaceholderDuplicate(activeProjectId, defaultPlaceholder)) {
              counter++;
              defaultPlaceholder = `[Redacted_${type}_${counter}]`;
            }
            const newPlaceholder = defaultPlaceholder;
            
            addEntry(activeProjectId, {
                originalTerm: selectedText,
                placeholder: newPlaceholder,
                type
            });
        } else {
            if (!existingEntryId) return;
            const existing = projectEntries.find(e => e.id === existingEntryId);
            if (existing) {
                const currentVariations = existing.variations || [];
                if (!currentVariations.includes(selectedText) && existing.originalTerm.trim().toLowerCase() !== selectedText.trim().toLowerCase()) {
                    updateEntry(existingEntryId, {
                        variations: [...currentVariations, selectedText]
                    });
                }
            }
        }

        setIsFormOpen(false);
        setSelectionRect(null);
        setSelectedText('');
        // Clear selection
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
    };

    return (
        <div 
            className="fixed z-[99999]"
            style={{ 
                top: Math.max(10, selectionRect.top - (isFormOpen ? 120 : 40)), 
                left: selectionRect.left + (selectionRect.width / 2),
                transform: 'translateX(-50%)' // Center horizontally above selection
            }}
        >
            {!isFormOpen ? (
                <button
                    className="bg-qb-black hover:bg-qb-cyan text-white p-2 rounded-full shadow-xl transition-all duration-200 animate-in fade-in zoom-in"
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setIsFormOpen(true);
                    }}
                    title="Add to PII Glossary"
                >
                    <Shield className="w-4 h-4" />
                </button>
            ) : (
                <div 
                    ref={formRef}
                    className="bg-white border-2 border-qb-black shadow-2xl p-4 w-72 flex flex-col gap-3 animate-in fade-in zoom-in duration-200"
                    onMouseDown={(e) => e.stopPropagation()} // Prevent closing
                >
                    <div className="flex justify-between items-center pb-2 border-b-2 border-qb-light-grey">
                        <span className="text-xs font-black text-qb-black uppercase tracking-widest flex items-center gap-2">
                            <Shield className="w-4 h-4" /> Add PII
                        </span>
                        <button onClick={() => setIsFormOpen(false)} className="text-qb-grey hover:text-qb-black">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest">Term</span>
                        <div className="bg-qb-bg text-qb-black px-2 py-1 text-sm font-bold truncate">
                            {selectedText}
                        </div>
                    </div>

                    <div className="flex bg-qb-bg rounded p-1 gap-1">
                        <button 
                            onClick={() => setMode('new')}
                            className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-1.5 px-2 transition-colors ${mode === 'new' ? 'bg-qb-black text-white shadow-sm' : 'text-qb-grey hover:bg-white/50'}`}
                        >
                            Create New
                        </button>
                        {projectEntries.length > 0 && (
                            <button 
                                onClick={() => setMode('existing')}
                                className={`flex-1 text-[10px] font-bold uppercase tracking-widest py-1.5 px-2 transition-colors ${mode === 'existing' ? 'bg-qb-black text-white shadow-sm' : 'text-qb-grey hover:bg-white/50'}`}
                            >
                                Add as Variation
                            </button>
                        )}
                    </div>

                    {mode === 'new' ? (
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest">Type</span>
                            <select 
                                value={type}
                                onChange={(e) => setType(e.target.value as PIIType)}
                                className="border-2 border-qb-light-grey bg-white text-qb-black p-1 text-sm font-bold uppercase tracking-widest focus:border-qb-black focus:outline-none"
                            >
                                <option value="Name">Name</option>
                                <option value="Organization">Organization</option>
                                <option value="Email">Email</option>
                                <option value="Phone">Phone</option>
                                <option value="Location">Location</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest">Target Entity</span>
                            <select 
                                value={existingEntryId}
                                onChange={(e) => setExistingEntryId(e.target.value)}
                                className="border-2 border-qb-light-grey bg-white text-qb-black p-1 text-sm font-bold focus:border-qb-black focus:outline-none"
                            >
                                <option value="" disabled>Select entity</option>
                                {projectEntries.map(entry => (
                                    <option key={entry.id} value={entry.id}>
                                        {entry.placeholder} ({entry.originalTerm})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 mt-2">
                        <button 
                            onClick={handleSave}
                            disabled={mode === 'existing' && !existingEntryId}
                            className="bg-qb-black text-white px-3 py-1 text-xs font-bold uppercase tracking-widest hover:bg-qb-cyan transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                            <Check className="w-3 h-3" /> Save
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

