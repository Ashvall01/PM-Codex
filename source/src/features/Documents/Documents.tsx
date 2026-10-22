import React, { useState } from 'react';
import { format } from 'date-fns';
import { useDocumentsStore, ProjectDocument, DocumentType, DocumentStatus } from '../../store/documentsStore';
import { useAppStore } from '../../store/appStore';
import { Plus, Trash2, Edit2, Link as LinkIcon, ExternalLink, X, File, Calendar, User, Check, Copy } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { EditableField } from '../../components/EditableField';
import { PageHeader, Stat, headerButtonClass } from '../../components/PageHeader';
import { DOCUMENT_STATUS_COLORS } from '../../utils/statusStyle';
import { useDiscardUntouchedNew } from '../../hooks/useDiscardUntouchedNew';

const formatDateDisplay = (dateStr?: string): string => {
  if (!dateStr) return '--';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(T|$)/);
  if (match) {
    const d = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    if (!isNaN(d.getTime())) {
      return format(d, 'dd MMM yyyy').toUpperCase();
    }
  }
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return format(d, 'dd MMM yyyy').toUpperCase();
    }
  } catch (e) {
    console.error('Date parsing error:', e);
  }
  return String(dateStr).toUpperCase();
};

const STATUS_COLORS: Record<string, string> = DOCUMENT_STATUS_COLORS;

const DOC_TYPES: DocumentType[] = ['Requirement', 'Design', 'Test', 'Report', 'Contract', 'Manual', 'Other'];
const STATUS_OPTIONS: DocumentStatus[] = ['Draft', 'In Review', 'Approved', 'Archived'];

export const Documents: React.FC = () => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const { documents, addDocument, updateDocument, deleteDocument } = useDocumentsStore();

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const activeDoc = activeDocId ? documents.find(d => d.id === activeDocId) || null : null;
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  
  const [filterType, setFilterType] = useState<string>('All');

  const projectDocs = activeProjectId ? documents.filter(d => d.projectId === activeProjectId) : [];
  
  let filteredDocs = [...projectDocs];
  if (filterType !== 'All') {
    filteredDocs = filteredDocs.filter(d => d.type === filterType);
  }

  filteredDocs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // New Document makes a record at once; closed untouched, it is removed again.
  const markNewDoc = useDiscardUntouchedNew(
    activeDocId,
    (id) => useDocumentsStore.getState().documents.find(d => d.id === id),
    (d) => !!d && d.title === 'Untitled Document' && d.type === 'Other' && d.status === 'Draft' && d.version === '1.0'
      && !(d.url || '').trim() && !(d.description || '').trim() && !(d.owner || '').trim(),
    (id) => useDocumentsStore.getState().deleteDocument(id),
  );

  const handleAddNew = () => {
    if (!activeProjectId) return;
    const newId = addDocument(activeProjectId, {
      title: 'Untitled Document',
      type: 'Other',
      status: 'Draft',
    });
    markNewDoc(newId);
    setActiveDocId(newId);
    setIsEditing(true);
  };

  const handleUpdate = (id: string, updates: Partial<ProjectDocument>) => {
    updateDocument(id, updates);
  };

  return (
    <div className="h-full flex bg-transparent font-sans">
      {/* List View */}
      <div className={`flex-1 flex flex-col pt-4 sm:pt-8 px-4 sm:pl-12 sm:pr-6 overflow-y-auto ${activeDoc ? 'lg:mr-[var(--tray-w,600px)]' : ''} transition-all duration-300`}>
        <PageHeader
          title="Documents"
          stats={<>
            <Stat n={projectDocs.length} label="documents" />
            <Stat n={projectDocs.filter(d => d.status === 'In Review').length} label="in review" tone="orange" />
            <Stat n={projectDocs.filter(d => d.status === 'Draft').length} label="draft" />
          </>}
        >
            <div className="flex items-center gap-2">
              <label className="text-xs font-black text-qb-grey uppercase tracking-widest">Filter:</label>
              <select 
                value={filterType} 
                onChange={e => setFilterType(e.target.value)}
                className="bg-qb-box-bg border-none px-3 py-1.5 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase"
              >
                <option value="All">All Types</option>
                {DOC_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <button 
              onClick={handleAddNew}
              className={headerButtonClass(true)}
            >
              <Plus className="w-5 h-5" /> New Document
            </button>
        </PageHeader>

        <div className="flex-1 pb-12">
          <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
            {filteredDocs.length === 0 ? (
              <div className="col-span-full text-center py-20 text-qb-grey font-medium tracking-widest uppercase">
                No documents found. Click 'New Document' to add one.
              </div>
            ) : (
              filteredDocs.map(doc => (
                <div 
                  key={doc.id}
                  onClick={() => { setActiveDocId(doc.id); setIsEditing(false); }}
                  className={`bg-transparent border cursor-pointer hover:border-qb-orange transition-all p-6 relative group ${activeDocId === doc.id ? 'border-qb-orange ring-1 ring-qb-orange' : 'border-qb-light-grey'}`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-1 pr-8">
                      <h3 className="font-bold text-qb-black text-lg line-clamp-1">{doc.title}</h3>
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-qb-grey">
                        <span className="bg-qb-box-bg px-2 py-1 text-qb-dark-grey">{doc.type}</span>
                        <span className="flex items-center gap-1" style={{ color: STATUS_COLORS[doc.status as DocumentStatus] || 'var(--color-qb-grey)' }}>
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[doc.status as DocumentStatus] || 'var(--color-qb-grey)' }} />
                          {doc.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                    {doc.url && (
                      <a 
                        href={doc.url} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-qb-grey hover:text-qb-orange p-1 transition-colors"
                        onClick={e => e.stopPropagation()}
                        title="Open Document"
                      >
                        <ExternalLink className="w-5 h-5" />
                      </a>
                    )}
                      <button 
                        className="opacity-0 group-hover:opacity-100 text-qb-light-grey hover:text-qb-magenta transition-opacity p-1"
                        onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(doc.id); }}
                        title="Delete Document"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-6 text-xs text-qb-grey font-medium tracking-widest uppercase border-t border-qb-box-bg pt-4">
                    <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {doc.owner || 'Unassigned'}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDateDisplay(doc.updatedAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Slide-out Detail Panel */}
      <div 
        className={`@container/tray fixed top-0 right-0 h-full w-full lg:w-[var(--tray-w,600px)] bg-qb-bg lg:border-l-4 border-l-0 border-qb-black transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col z-40 lg:z-30 shadow-2xl lg:shadow-none ${activeDoc ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {activeDoc && (
          <>
            <header className="flex justify-between items-center gap-3 px-6 @min-[540px]/tray:px-12 py-6 lg:py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
              <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest leading-none">DOCUMENT DETAILS</span>
                <h2 className="text-lg @min-[540px]/tray:text-2xl font-black text-qb-black uppercase tracking-widest mt-1">
                  VIEW DOCUMENT
                </h2>
              </div>
              <div className="flex items-center gap-2 @min-[540px]/tray:gap-4 shrink-0">
                <button
                  onClick={() => setShowDeleteConfirm(activeDoc.id)}
                  className="p-3 bg-transparent text-qb-grey border-2 border-transparent hover:text-qb-magenta hover:border-qb-magenta transition-colors cursor-pointer"
                  title="Delete Document"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="relative group/editbtn flex items-center">
                  <div
                    className="p-3 border-2 border-qb-light-grey text-qb-grey bg-transparent cursor-default select-none flex items-center justify-center"
                  >
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <span className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-2 whitespace-nowrap bg-qb-black text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded shadow-lg opacity-0 group-hover/editbtn:opacity-100 transition-opacity z-50">
                    click a field to edit
                  </span>
                </div>
                <button 
                  onClick={() => { setActiveDocId(null); setIsEditing(false); }}
                  className="p-3 bg-transparent border-2 border-transparent text-qb-grey hover:text-qb-black transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-6 @min-[540px]/tray:px-12 py-6 lg:py-8 flex flex-col gap-10 bg-transparent no-scrollbar relative">
              {/* Document Title */}
              <div>
                <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2 border-b border-qb-light-grey pb-1">
                  Document Title
                </label>
                <EditableField
                  value={activeDoc.title || ''}
                  placeholder="UNTITLED DOCUMENT"
                  onSave={(newVal) => handleUpdate(activeDoc.id, { title: newVal })}
                  textClassName="text-3xl font-black text-qb-black uppercase tracking-tight leading-snug py-1"
                />
              </div>

              {/* URL / Link */}
              <div>
                <EditableField
                  label="URL / Link"
                  value={activeDoc.url || ''}
                  placeholder="NONE (DOUBLE CLICK TO ADD URL)"
                  onSave={(newVal) => handleUpdate(activeDoc.id, { url: newVal.trim() ? newVal.trim() : undefined })}
                  textClassName="text-sm font-bold text-qb-black tracking-wide py-1"
                />
                {activeDoc.url && (
                  <a 
                    href={activeDoc.url} 
                    target="_blank" 
                    rel="noreferrer"
                    className="mt-3 flex items-center justify-center gap-2 w-full py-3 px-4 bg-qb-black hover:bg-qb-orange text-white text-xs font-black uppercase tracking-widest transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" /> Open Document
                  </a>
                )}
              </div>

              {/* Type & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                <EditableField
                  label="Type"
                  type="select"
                  options={DOC_TYPES}
                  value={activeDoc.type}
                  onSave={(newVal) => handleUpdate(activeDoc.id, { type: newVal as DocumentType })}
                  displayFormatter={(val) => (
                    <span className="bg-qb-box-bg px-2.5 py-1 text-qb-black text-xs font-bold uppercase tracking-widest inline-block">
                      {val}
                    </span>
                  )}
                />

                <EditableField
                  label="Status"
                  type="select"
                  options={STATUS_OPTIONS}
                  value={activeDoc.status}
                  onSave={(newVal) => handleUpdate(activeDoc.id, { status: newVal as DocumentStatus })}
                  displayFormatter={(val) => (
                    <span className="flex items-center gap-2 bg-qb-box-bg px-2.5 py-1 text-qb-black text-xs font-bold uppercase tracking-widest inline-flex" style={{ borderLeft: `4px solid ${STATUS_COLORS[val as DocumentStatus] || 'var(--color-qb-grey)'}` }}>
                      {val}
                    </span>
                  )}
                />
              </div>

              {/* Version & Owner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
                <EditableField
                  label="Version"
                  value={activeDoc.version || ''}
                  placeholder="1.0"
                  onSave={(newVal) => handleUpdate(activeDoc.id, { version: newVal.trim() ? newVal.trim() : undefined })}
                  textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                />

                <EditableField
                  label="Owner"
                  value={activeDoc.owner || ''}
                  placeholder="UNASSIGNED"
                  onSave={(newVal) => handleUpdate(activeDoc.id, { owner: newVal.trim() ? newVal.trim() : undefined })}
                  textClassName="text-sm font-bold text-qb-black uppercase tracking-wide py-1"
                />
              </div>

              {/* Description */}
              <EditableField
                label="Description"
                type="textarea"
                value={activeDoc.description || ''}
                placeholder="No description provided. Double click to add details..."
                onSave={(newVal) => handleUpdate(activeDoc.id, { description: newVal.trim() ? newVal.trim() : undefined })}
                textClassName="text-sm font-medium text-qb-dark-grey leading-relaxed whitespace-pre-wrap p-4 bg-qb-box-bg/50 border border-qb-light-grey min-h-[100px] block"
              />

              {/* Last Updated Footer */}
              <div className="border-t border-qb-light-grey pt-4 flex justify-between items-center text-xs text-qb-grey font-medium uppercase tracking-widest">
                <span>Last Updated</span>
                <span className="font-bold text-qb-black">{formatDateDisplay(activeDoc.updatedAt)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title="Delete Document"
          description={`Are you sure you want to remove '${documents.find(d => d.id === showDeleteConfirm)?.title}'?`}
          subDescription="This action cannot be undone."
          confirmText="Yes, Delete"
          cancelText="Cancel"
          onConfirm={() => {
            deleteDocument(showDeleteConfirm);
            if (activeDocId === showDeleteConfirm) {
              setActiveDocId(null);
              setIsEditing(false);
            }
            setShowDeleteConfirm(null);
          }}
          onClose={() => setShowDeleteConfirm(null)}
        />
      )}
    </div>
  );
};
