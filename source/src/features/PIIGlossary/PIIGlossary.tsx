import { tint } from '../../utils/statusStyle';
import React, { useState } from 'react';
import { usePIIStore, PIIType, PIIEntry } from '../../store/piiStore';
import { useAppStore } from '../../store/appStore';
import { Plus, Trash2, Edit2, X, ChevronRight, ShieldAlert, Check } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { PageHeader, Stat, headerButtonClass } from '../../components/PageHeader';

const TYPE_COLORS: Record<PIIType, string> = {
  'Name': 'var(--color-qb-magenta)',
  'Organization': 'var(--color-qb-cyan)',
  'Email': 'var(--color-qb-green)',
  'Phone': 'var(--color-qb-orange)',
  'Location': 'var(--color-qb-orange)',
  'Application': 'var(--color-qb-dark-grey)', // there is no qb-blue: this chip had no colour
  'Other': 'var(--color-qb-light-grey)'
};

const TYPE_OPTIONS: PIIType[] = ['Name', 'Organization', 'Email', 'Phone', 'Location', 'Application', 'Other'];

export default function PIIGlossary() {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const { entries, addEntry, updateEntry, deleteEntry, isPlaceholderDuplicate } = usePIIStore();

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const realActiveItem = activeItemId ? entries.find(e => e.id === activeItemId) || null : null;
  const isDuplicate = realActiveItem && activeProjectId ? isPlaceholderDuplicate(activeProjectId, realActiveItem.placeholder, realActiveItem.id) : false;
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const projectEntries = activeProjectId ? entries.filter(e => e.projectId === activeProjectId) : [];
  
  let filteredEntries = [...projectEntries];
  if (filterType !== 'All') {
    filteredEntries = filteredEntries.filter(e => e.type === filterType);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredEntries = filteredEntries.filter(e => 
      e.originalTerm.toLowerCase().includes(q) || 
      e.placeholder.toLowerCase().includes(q)
    );
  }

  filteredEntries.sort((a, b) => a.originalTerm.localeCompare(b.originalTerm));

  const groupedEntries = filteredEntries.reduce((acc, curr) => {
    const cat = curr.type || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(curr);
    return acc;
  }, {} as Record<string, PIIEntry[]>);

  const handleAddNew = () => {
    if (!activeProjectId) return;
    
    let defaultPlaceholder = '[Redacted_Name_1]';
    let counter = 1;
    while (isPlaceholderDuplicate(activeProjectId, defaultPlaceholder)) {
      counter++;
      defaultPlaceholder = `[Redacted_Name_${counter}]`;
    }

    const id = addEntry(activeProjectId, {
      projectId: activeProjectId,
      originalTerm: 'New Term',
      placeholder: defaultPlaceholder,
      type: 'Name',
      notes: ''
    });
    setActiveItemId(id);
    setIsEditing(true);
  };

  const generatePlaceholder = (type: string, currentId?: string) => {
     let defaultPlaceholder = `[Redacted_${type}_1]`;
     let counter = 1;
     while (isPlaceholderDuplicate(activeProjectId!, defaultPlaceholder, currentId)) {
       counter++;
       defaultPlaceholder = `[Redacted_${type}_${counter}]`;
     }
     return defaultPlaceholder;
  };

  const handleUpdate = (id: string, updates: Partial<PIIEntry>) => {
    if (updates.type && realActiveItem && updates.type !== realActiveItem.type) {
       updates.placeholder = generatePlaceholder(updates.type, id);
    }
    updateEntry(id, updates);
  };

  return (
    <div className="flex font-sans border border-qb-light-grey relative">
      <div className="absolute top-0 left-0 h-[3px] w-12 bg-qb-orange" />
      {/* List View — framed like every other Settings section */}
      <div className={`flex-1 flex flex-col p-6 ${realActiveItem ? 'lg:mr-[500px]' : ''} transition-all duration-300`}>
        <p className="text-sm text-qb-dark-grey -mt-1 mb-4 max-w-2xl leading-relaxed">
          Names and organisations listed here are replaced by tokens such as [Redacted_Name_1] before anything is sent to
          Gemini or Claude, and turned back into the real words in the app.
        </p>
        <PageHeader
          title={<span className="text-base">Privacy glossary</span>}
          stats={<><Stat n={projectEntries.length} label="masked terms" /></>}
          className="order-first"
        >
            <div className="flex items-center gap-2">
              <input 
                type="text" 
                placeholder="Search terms…" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-qb-box-bg border-none px-4 py-2 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange w-56"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-black text-qb-grey uppercase tracking-widest">Filter:</label>
              <select 
                value={filterType} 
                onChange={e => setFilterType(e.target.value)}
                className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
              >
                <option value="All">All Types</option>
                {TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <button 
              onClick={handleAddNew}
              className={headerButtonClass(true)}
            >
              <Plus className="w-4 h-4" /> New entry
            </button>
        </PageHeader>

        <div className="flex-1 pb-12">
          <div className="flex flex-col gap-8">
            {projectEntries.length === 0 ? (
              <div className="text-center py-20 text-qb-grey font-medium tracking-widest uppercase border border-dashed border-qb-light-grey">
                No entries yet. Click 'New Entry' to start mapping sensitive terms.
              </div>
            ) : Object.keys(groupedEntries).length === 0 ? (
              <div className="text-center py-20 text-qb-grey font-medium tracking-widest uppercase border border-dashed border-qb-light-grey">
                No entries match your filters.
              </div>
            ) : (
              Object.keys(groupedEntries).sort().map(category => (
                <div key={category} className="relative transition-colors">
                  <div className="flex items-center gap-3 mb-2">
                    <ChevronRight className="w-5 h-5 text-qb-orange" />
                    <h2 className="text-xl font-black text-qb-dark-grey uppercase tracking-[0.15em]">{category}</h2>
                  </div>
                  <div className="pl-8 relative">
                    <div className="absolute left-[11px] top-0 bottom-0 w-[2px] bg-qb-light-grey"></div>
                    <div className="flex flex-col">
                      {groupedEntries[category].map((item) => (
                        <div 
                          key={item.id}
                          onClick={() => { setActiveItemId(item.id); setIsEditing(false); }}
                          className={`cursor-pointer group flex items-center justify-between py-4 border-b border-qb-light-grey transition-colors hover:bg-black/5 px-4 ${realActiveItem?.id === item.id ? 'bg-qb-box-bg' : ''}`}
                        >
                          <div className="flex flex-col gap-1 w-1/3">
                            <span className="text-xs font-black text-qb-grey uppercase tracking-widest">Original Term</span>
                            <h3 className={`text-lg tracking-wide truncate ${realActiveItem?.id === item.id ? 'font-black text-qb-magenta' : 'font-medium text-qb-magenta'}`}>
                              {item.originalTerm || 'UNNAMED TERM'}
                            </h3>
                          </div>
                          
                          <div className="flex items-center justify-center -mx-4 text-qb-grey opacity-50">
                            →
                          </div>

                          <div className="flex flex-col gap-1 w-1/3">
                             <span className="text-xs font-black text-qb-grey uppercase tracking-widest">Masked As</span>
                             <h3 className={`text-lg tracking-wide font-mono truncate ${realActiveItem?.id === item.id ? 'font-black text-qb-black' : 'font-medium text-qb-dark-grey'}`}>
                                {item.placeholder || '[UNSET]'}
                             </h3>
                          </div>

                          <div className="flex items-center gap-6 w-1/4 justify-end text-right">
                            <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5" style={{ backgroundColor: tint(TYPE_COLORS[item.type]), color: TYPE_COLORS[item.type] }}>
                              {item.type}
                            </span>
                            <button 
                              onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(item.id); }}
                              className="text-qb-light-grey hover:text-qb-magenta transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Details / Edit Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full lg:w-[500px] bg-qb-bg lg:border-l-4 border-l-0 border-qb-black transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col z-40 lg:z-30 shadow-2xl lg:shadow-none ${realActiveItem ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {realActiveItem && (
          <>
            <header className="flex justify-between items-center px-6 lg:px-12 py-6 lg:py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
              <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest leading-none">PII ENTRY DETAILS</span>
                <h2 className="text-2xl font-black text-qb-black uppercase tracking-widest mt-1">
                  {isEditing ? 'EDIT ENTRY' : 'VIEW ENTRY'}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowDeleteConfirm(realActiveItem.id)}
                  className="p-3 bg-transparent text-qb-grey border-2 border-transparent hover:text-qb-magenta hover:border-qb-magenta transition-colors"
                  title="Delete Entry"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (isEditing && isDuplicate) return;
                    setIsEditing(!isEditing);
                  }}
                  disabled={isEditing && isDuplicate}
                  className={`p-3 border-2 transition-all duration-300 ${isEditing && isDuplicate ? 'opacity-40 cursor-not-allowed bg-transparent text-qb-grey border-qb-light-grey' : isEditing ? 'bg-qb-black text-white border-qb-black' : 'bg-transparent text-qb-grey border-qb-light-grey hover:border-qb-black hover:text-qb-black'}`}
                  title={isEditing && isDuplicate ? "Double-check: Duplicate Mask Found" : isEditing ? "Done Editing" : "Edit Entry"}
                >
                  {isEditing ? <Check className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { setActiveItemId(null); setIsEditing(false); }}
                  className="p-3 bg-transparent border-2 border-transparent text-qb-grey hover:text-qb-black transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-6 lg:py-8 flex flex-col gap-10 bg-transparent no-scrollbar relative">
            <div>
              <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Original Term (Sensitive)</label>
              {isEditing ? (
                <input 
                  type="text" 
                  value={realActiveItem.originalTerm}
                  onChange={(e) => handleUpdate(realActiveItem.id, { originalTerm: e.target.value })}
                  className="w-full bg-qb-box-bg border border-transparent p-4 text-2xl font-black text-qb-magenta outline-none focus:border-qb-orange transition-colors"
                  placeholder="e.g. John Doe, ACME Corp"
                />
              ) : (
                <div className="text-3xl font-black text-qb-magenta uppercase tracking-tight leading-none mb-6">
                  {realActiveItem.originalTerm || 'UNNAMED TERM'}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Masked Token (Placeholder)</label>
              <div className="text-2xl font-mono font-bold text-qb-magenta tracking-tight leading-none mb-6">
                 {realActiveItem.placeholder || '[UNSET]'}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
              <div>
                <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Entity Type</label>
                {isEditing ? (
                  <select
                    value={realActiveItem.type}
                    onChange={(e) => handleUpdate(realActiveItem.id, { type: e.target.value as PIIType })}
                    className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide mt-2"
                  >
                    {TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <span className="inline-block text-sm font-black uppercase tracking-widest mt-2" style={{ color: TYPE_COLORS[realActiveItem.type] }}>
                    {realActiveItem.type}
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Variations (Nicknames / Full Names / Initials)</label>
              {isEditing ? (
                <div>
                  <div className="flex flex-wrap gap-2 mt-2 mb-3">
                    {(realActiveItem.variations || []).length > 0 ? (
                      (realActiveItem.variations || []).map((v, i) => (
                        <span key={i} className="flex items-center gap-2 px-3 py-1.5 bg-qb-black text-white text-xs font-black uppercase tracking-wider">
                          {v}
                          <button 
                            type="button"
                            onClick={() => {
                              const updated = (realActiveItem.variations || []).filter((_, idx) => idx !== i);
                              handleUpdate(realActiveItem.id, { variations: updated });
                            }}
                            className="text-qb-grey hover:text-qb-orange transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-qb-grey italic uppercase tracking-wider">No variations added. Type a variation below and press Enter.</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="ADD VARIATION (e.g. JD, Johnny)..."
                      id="new-variation-input"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = e.currentTarget.value.trim();
                          if (val) {
                            const variations = realActiveItem.variations || [];
                            if (!variations.includes(val)) {
                              handleUpdate(realActiveItem.id, { variations: [...variations, val] });
                            }
                            e.currentTarget.value = '';
                          }
                        }
                      }}
                      className="flex-1 bg-qb-box-bg border border-transparent px-4 py-2.5 text-xs font-bold text-qb-black outline-none focus:border-qb-orange uppercase"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById('new-variation-input') as HTMLInputElement;
                        if (input) {
                          const val = input.value.trim();
                          if (val) {
                            const variations = realActiveItem.variations || [];
                            if (!variations.includes(val)) {
                              handleUpdate(realActiveItem.id, { variations: [...variations, val] });
                            }
                            input.value = '';
                          }
                        }
                      }}
                      className="bg-qb-black text-white hover:bg-qb-orange font-black uppercase px-6 py-2.5 text-xs transition-colors tracking-widest cursor-pointer"
                    >
                      ADD
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {(realActiveItem.variations || []).length > 0 ? (
                    (realActiveItem.variations || []).map((v, i) => (
                      <span key={i} className="px-3 py-1.5 bg-qb-box-bg border border-qb-light-grey text-qb-black text-xs font-bold uppercase tracking-wider">
                        {v}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-qb-grey italic uppercase tracking-widest mt-1">No variations defined yet</span>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-2">Context/Notes</label>
              {isEditing ? (
                <textarea 
                  value={realActiveItem.notes}
                  onChange={(e) => handleUpdate(realActiveItem.id, { notes: e.target.value })}
                  className="w-full h-32 bg-qb-box-bg border-none p-3 text-sm font-medium text-qb-black outline-none focus:ring-1 focus:ring-qb-orange resize-none tracking-wide mt-2"
                  placeholder="Notes about when this term is used, variations to watch out for, etc."
                />
              ) : (
                <div className="text-base text-qb-dark-grey leading-relaxed whitespace-pre-wrap mt-2">{realActiveItem.notes || '--'}</div>
              )}
            </div>

          </div>
          </>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title="Delete PII Entry"
          description="Are you sure you want to delete this glossary entry?"
          subDescription="THIS WILL STOP THE SYSTEM FROM MASKING THIS TERM AUTOMATICALLY."
          confirmText="YES, DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            deleteEntry(showDeleteConfirm);
            if (realActiveItem?.id === showDeleteConfirm) {
              setActiveItemId(null);
            }
            setShowDeleteConfirm(null);
          }}
          onClose={() => setShowDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
