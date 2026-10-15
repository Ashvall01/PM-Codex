import React, { useState, useEffect } from 'react';
import { useCodexStore, CodexPage } from '../../store/codexStore';
import { useAppStore } from '../../store/appStore';
import { useAcrStore } from '../../store/acrStore';
import { enrichWithAcr } from '../../utils/acrDiff';
import { Plus, Trash2, Edit2, Play, Folder, Search, FileText, ChevronRight, ChevronDown, FolderOpen, Download } from 'lucide-react';
import { RichTextViewer } from '../../components/RichTextViewer';
import CodexEditor from './CodexEditor';
import { format } from 'date-fns';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { isCodexFolder, hasFolderNotes, codexFolderOf, findFolderByTitle } from '../../utils/codexRules';

/** The key of the UNFILED group: pages whose folder is not there. */
const UNFILED = '__unfiled__';

export default function Codex() {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const { pages, activePageId, addPage, updatePage, deletePage, setActivePageId } = useCodexStore();
  
  const [isEditing, setIsEditing] = useState(false);
  const scrollTimeoutRef = React.useRef<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ id: string, type: 'root' | 'child' } | null>(null);
  const [editingRootId, setEditingRootId] = useState<string | null>(null);
  const [editRootTitle, setEditRootTitle] = useState('');
  
  const [expandedRoots, setExpandedRoots] = useState<Record<string, boolean>>({});

  const { activeAcrId, activeAcrChangeId, isMouseOverSidebar } = useAcrStore();
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));

  if (!activeProjectId) return null;

  const projectPages = React.useMemo(() => {
    const realPages = pages.filter(p => p.projectId === activeProjectId);

    // The shared enrichment, then the three `_`-prefixed names this screen has
    // always used, kept as aliases so the rest of the file is untouched.
    return enrichWithAcr<any>(
      realPages,
      acr,
      {
        add: ['createCodexPage', 'createCodexFolder'],
        update: ['updateCodexPage'],
      },
      activeAcrChangeId,
      (chg) => {
        // A proposed folder has no parent. A proposed page shows inside the
        // folder it will land in: named by id, or by title — a title no folder
        // has yet gets a proposed folder of its own, drawn below.
        const isFolder = chg.name === 'createCodexFolder';
        let parentId: string | null = null;
        if (!isFolder) {
          const byId = chg.args.parentId ? realPages.find(p => p.id === chg.args.parentId) : null;
          const byIdFolder = byId ? codexFolderOf(realPages, byId) : null;
          const byTitle = !byId && chg.args.folder ? findFolderByTitle(activeProjectId, String(chg.args.folder)) : null;
          parentId = byIdFolder?.id || byTitle?.id
            || (chg.args.folder ? `acr-newfolder:${String(chg.args.folder).trim().toUpperCase()}` : (chg.args.parentId || null));
        }
        return {
          id: `acr-add-${chg.id}`,
          projectId: activeProjectId,
          title: isFolder ? String(chg.args.title || 'NEW FOLDER').toUpperCase() : (chg.args.title || 'UNNAMED PROPOSED PAGE'),
          content: isFolder ? '' : (chg.args.content || ''),
          parentId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    ).map(row => ({
      ...row,
      _acrType: row.isAcrProposedAdd
        ? 'proposed-add'
        : row.isAcrProposedUpdate
          ? 'proposed-update'
          : 'normal',
      _changeId: row.acrChangeId || null,
      _updateArgs: row.updateArgs || null,
    }));
  }, [pages, activeProjectId, acr, activeAcrChangeId]);

  // Folders, then what each one holds. A page under a page (which the
  // assistants could once create) is shown in the folder at the top of its
  // chain; a page whose folder is not there goes under UNFILED. Nothing a
  // record holds is left off the screen.
  const rootPages = React.useMemo(() => {
    const folders = projectPages.filter(p => isCodexFolder(p));
    // A proposed page into a folder that does not exist yet brings a proposed
    // folder of that name with it.
    const proposedFolders = Array.from(new Set(
      projectPages
        .map(p => String(p.parentId || ''))
        .filter(id => id.startsWith('acr-newfolder:')),
    )).map(id => ({
      id, projectId: activeProjectId, title: id.slice('acr-newfolder:'.length), content: '', parentId: null,
      createdAt: '', updatedAt: '', _acrType: 'proposed-add', _changeId: null, _virtual: true,
    }));
    return [...folders, ...proposedFolders];
  }, [projectPages, activeProjectId]);

  const pagesByFolder = React.useMemo(() => {
    const map: Record<string, any[]> = {};
    const folderIds = new Set(rootPages.map(r => r.id));
    projectPages.filter(p => !isCodexFolder(p)).forEach(p => {
      const direct = p.parentId && folderIds.has(p.parentId) ? p.parentId : null;
      const folder = direct || codexFolderOf(projectPages as any, p)?.id || UNFILED;
      (map[folder] = map[folder] || []).push(p);
    });
    return map;
  }, [projectPages, rootPages]);

  useEffect(() => {
    if (activeAcrChangeId) {
      const found = projectPages.find(p => p._changeId === activeAcrChangeId);
      if (found) {
        setActivePageId(found.id);
        
        // Auto scroll to card/cell ONLY if we are hovering on the ACR sidebar
        if (isMouseOverSidebar) {
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
          scrollTimeoutRef.current = setTimeout(() => {
            const cardEl = document.getElementById(`codex-card-${found.id}`);
            if (cardEl) {
              cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 50);
        }
      }
    }
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [activeAcrChangeId, projectPages, setActivePageId, isMouseOverSidebar]);

  // Initially expand all folders that have pages, or all folders
  useEffect(() => {
    setExpandedRoots(prev => {
      const next = { ...prev };
      let changed = false;
      rootPages.forEach(r => {
        if (next[r.id] === undefined) {
          next[r.id] = true; // unfold by default
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [rootPages]);

  const activePage = projectPages.find(p => p.id === activePageId);
  /** A folder's own older notes are open (not a page). */
  const viewingFolderNotes = !!activePage && isCodexFolder(activePage);
  const activeFolder = activePage && !viewingFolderNotes ? codexFolderOf(projectPages as any, activePage) : null;

  /**
   * Notes saved on a folder, from before folders held only pages, become a
   * page of their own inside that folder. The folder is emptied only after
   * the page exists, so the text is never in neither place.
   */
  const moveFolderNotesIntoPage = (folder: any) => {
    const title = `${String(folder.title || 'Folder').charAt(0)}${String(folder.title || 'Folder').slice(1).toLowerCase()} — notes`;
    const newId = addPage({ projectId: activeProjectId, title, content: folder.content || '', parentId: folder.id });
    if (useCodexStore.getState().pages.some(p => p.id === newId && p.content === (folder.content || ''))) {
      updatePage(folder.id, { content: '' });
    }
    setActivePageId(newId);
    setIsEditing(false);
  };

  const handleExportDocx = async () => {
    if (!activePage) return;
    
    const htmlString = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>${activePage.title}</title>
          <style>
            body { font-family: 'Inter', sans-serif; font-size: 11pt; color: #111111; }
            h1, h2, h3, h4, h5, h6 { font-family: 'Inter', sans-serif; color: #111111; margin-top: 12pt; margin-bottom: 6pt; }
            p { margin-bottom: 10pt; line-height: 1.5; }
            table { border-collapse: collapse; width: 100%; margin-bottom: 12pt; }
            th, td { border: 1px solid #d1d5db; padding: 6px; }
            th { background-color: #f5f6f6; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>${activePage.title}</h1>
          ${activePage.content}
        </body>
      </html>
    `;
    
    try {
      // Loaded on first export rather than with the app.
      const [{ asBlob }, { saveAs }] = await Promise.all([import('html-docx-js-typescript'), import('file-saver')]);
      const blob = await asBlob(htmlString, { orientation: 'portrait' });
      saveAs(blob as Blob, `${activePage.title || 'Export'}.docx`);
    } catch (err) {
      console.error('Failed to export to docx:', err);
    }
  };

  const handleUpdatePage = (id: string, updates: any) => {
    if (activePage && (activePage._acrType === 'proposed-add' || activePage._acrType === 'proposed-update')) {
      const changeId = activePage._changeId;
      if (changeId && activeAcrId) {
        const foundChange = acr?.changes.find(c => c.id === changeId);
        if (foundChange) {
          const newArgs = { ...foundChange.args, ...updates };
          useAcrStore.getState().updateAcrChange(activeAcrId, changeId, { args: newArgs });
        }
      }
    } else {
      updatePage(id, updates);
    }
  };

  // The shared enrichment already merged the proposal into the row, so the
  // editor edits the proposed page rather than the stored one. This used to be
  // a second merge written by hand here.
  const editingPage = activePage;

  // A folder's older notes are read, not edited: they move into a page first.
  const effectiveIsEditing = (isEditing || activePage?._acrType === 'proposed-add') && !(activePage && isCodexFolder(activePage) && activePage._acrType !== 'proposed-add');

  const toggleRoot = (rootId: string) => {
    setExpandedRoots(prev => ({ ...prev, [rootId]: !prev[rootId] }));
  };

  const handleAddRoot = () => {
    const newId = addPage({
      projectId: activeProjectId,
      title: 'NEW FOLDER',
      content: '',
      parentId: null
    });
    setExpandedRoots(prev => ({ ...prev, [newId]: true }));
    setEditingRootId(newId);
    setEditRootTitle('NEW FOLDER');
  };

  const handleAddSub = (rootId: string) => {
    const newId = addPage({
      projectId: activeProjectId,
      title: 'New Entry',
      content: '',
      parentId: rootId
    });
    setExpandedRoots(prev => ({ ...prev, [rootId]: true }));
    setActivePageId(newId);
    setIsEditing(true);
  };

  return (
    <div className={`h-full flex flex-col lg:flex-row px-4 py-4 gap-4 bg-transparent font-sans relative overflow-hidden ${effectiveIsEditing ? 'sm:px-4 sm:py-4 sm:gap-4' : 'sm:px-16 sm:py-16 sm:gap-16'}`}>
      
      {/* Left Sidebar List - Tree Structure */}
      <div className="w-full lg:w-[300px] xl:w-[350px] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-qb-light-grey pb-4 lg:pb-0 lg:pr-4 relative overflow-y-auto bg-transparent h-1/3 lg:h-full hide-scrollbar">
        <div className="flex items-center justify-between mb-8 shrink-0">
          <h2 className="text-xl font-black uppercase tracking-widest text-qb-black">INDEX</h2>
          <button 
            onClick={handleAddRoot}
            className="text-xs font-black uppercase text-qb-grey hover:text-qb-black tracking-widest transition-colors flex items-center gap-1" 
          >
            <Plus className="w-4 h-4" /> FOLDER
          </button>
        </div>

        {rootPages.length === 0 && !(pagesByFolder[UNFILED] || []).length ? (
          <div className="flex flex-col items-center justify-center text-qb-grey mt-12 text-center">
            <p className="text-sm font-light tracking-widest uppercase mb-4">No Folders Available</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {[...rootPages, ...((pagesByFolder[UNFILED] || []).length ? [{ id: UNFILED, title: 'UNFILED', _virtual: true, _unfiled: true } as any] : [])].map(root => {
              const isExpanded = expandedRoots[root.id] ?? true;
              const subPages = pagesByFolder[root.id] || [];
              const isVirtual = !!root._virtual;
              
              return (
                <div key={root.id} className="flex flex-col">
                  {/* Folder Row */}
                  <div className="group flex items-center justify-between py-2 transition-colors">
                    <div className="flex items-center gap-2 flex-1 overflow-hidden" onClick={() => toggleRoot(root.id)}>
                      <button className="text-qb-grey hover:text-qb-black transition-colors shrink-0">
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </button>
                      <Folder className={`w-4 h-4 shrink-0 ${root._unfiled ? 'text-qb-magenta' : root._acrType === 'proposed-add' ? 'text-[#51b53e]' : 'text-qb-orange'}`} />
                      
                      {editingRootId === root.id && !isVirtual ? (
                        <input
                          autoFocus
                          value={editRootTitle}
                          onChange={(e) => setEditRootTitle(e.target.value)}
                          onBlur={() => {
                            if (editRootTitle.trim()) {
                              updatePage(root.id, { title: editRootTitle.trim().toUpperCase() });
                            }
                            setEditingRootId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setEditingRootId(null);
                          }}
                          className="text-sm font-black uppercase tracking-widest text-qb-black bg-transparent border border-qb-light-grey px-2 py-1 outline-none w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span 
                          className={`text-sm font-black uppercase tracking-widest truncate cursor-pointer hover:underline ${root._unfiled ? 'text-qb-magenta' : 'text-qb-black'}`}
                          title={root._unfiled ? 'Pages whose folder is missing. Open one and choose a folder.' : 'Double-click to rename'}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (isVirtual) return;
                            setEditingRootId(root.id);
                            setEditRootTitle(root.title);
                          }}
                        >
                          {root.title}
                        </span>
                      )}
                      {root._acrType === 'proposed-add' && (
                        <span className="text-[9px] font-black text-[#51b53e] bg-[#51b53e]/15 border border-[#51b53e]/30 px-1 py-0.5 uppercase tracking-tighter leading-none shrink-0">PROPOSED</span>
                      )}
                    </div>
                    
                    {/* Folder Actions */}
                    {!editingRootId && !isVirtual && root._acrType !== 'proposed-add' && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <button 
                          title="Add Entry"
                          className="text-qb-grey hover:text-qb-orange transition-colors p-1"
                          onClick={() => handleAddSub(root.id)}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <button 
                          title="Delete Folder"
                          className="text-qb-grey hover:text-qb-magenta transition-colors p-1"
                          onClick={() => setShowDeleteConfirm({ id: root.id, type: 'root' })}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Children List */}
                  {isExpanded && (
                    <div className="flex flex-col ml-6 pl-3 border-l border-qb-box-bg mt-1 gap-1">
                      {/* Notes saved on the folder itself, from before folders
                          held only pages. Shown so they are never lost. */}
                      {hasFolderNotes(root) && (
                        <div
                          onClick={() => { setActivePageId(root.id); setIsEditing(false); }}
                          className={`group flex items-center gap-2 cursor-pointer py-2 pl-2 pr-2 transition-colors relative ${activePageId === root.id ? 'bg-black/5' : 'hover:bg-black/5'}`}
                          title="Notes saved on this folder before folders held only pages"
                        >
                          {activePageId === root.id && <div className="absolute left-[-1px] top-1 bottom-1 w-[3px] bg-qb-orange" />}
                          <FileText className="w-3.5 h-3.5 shrink-0 text-qb-orange" />
                          <span className={`text-sm truncate italic ${activePageId === root.id ? 'font-black text-qb-black' : 'text-qb-dark-grey'}`}>Folder notes</span>
                          <span className="text-[9px] font-black text-qb-orange border border-qb-orange/40 px-1 py-0.5 uppercase tracking-tighter leading-none shrink-0">OLDER</span>
                        </div>
                      )}
                      {subPages.length === 0 && !hasFolderNotes(root) ? (
                        <div className="text-[10px] uppercase font-black tracking-widest text-qb-grey py-2 pl-2">
                          EMPTY FOLDER
                        </div>
                      ) : (
                        subPages.map(sub => {
                          const isActive = activePageId === sub.id;
                          const isAcrItem = sub._acrType && sub._acrType !== 'normal';
                          
                          let bgStyle = isActive ? 'bg-black/5' : 'hover:bg-black/5';
                          if (sub._acrType === 'proposed-add') {
                            bgStyle = isActive ? 'bg-[#51b53e]/20 text-[#51b53e]' : 'bg-[#51b53e]/5 text-[#51b53e] hover:bg-[#51b53e]/10';
                          } else if (sub._acrType === 'proposed-update') {
                            bgStyle = isActive ? 'bg-[#ff7600]/25 font-bold' : 'bg-[#ff7600]/5 hover:bg-[#ff7600]/10';
                          }

                          return (
                            <div
                              key={sub.id}
                              id={`codex-card-${sub.id}`}
                              onClick={() => { setActivePageId(sub.id); setIsEditing(false); }}
                              onMouseEnter={() => {
                                if (sub._changeId) {
                                  useAcrStore.getState().setActiveAcrChangeId(sub._changeId);
                                }
                              }}
                              onMouseLeave={() => {
                                if (sub._changeId && useAcrStore.getState().activeAcrChangeId === sub._changeId) {
                                  useAcrStore.getState().setActiveAcrChangeId(null);
                                }
                              }}
                              className={`group flex justify-between items-center cursor-pointer py-2 pl-2 pr-2 transition-colors relative ${bgStyle}`}
                            >
                              {isActive && (
                                <div className="absolute left-[-1px] top-1 bottom-1 w-[3px] bg-qb-orange" />
                              )}
                              <div className="flex items-center gap-2 overflow-hidden">
                                <FileText className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-qb-orange' : 'text-qb-grey'}`} />
                                <span className={`text-sm truncate ${isActive ? 'font-black text-qb-black' : 'font-light text-qb-dark-grey'}`}>
                                  {sub.title}
                                </span>
                                {/* A page filed under a page, from before the rule: shown in its folder, and says where it hangs. */}
                                {sub.parentId && sub.parentId !== root.id && !String(sub.parentId).startsWith('acr-newfolder:') && projectPages.some(p => p.id === sub.parentId && !isCodexFolder(p)) && (
                                  <span className="text-[9px] font-mono text-qb-grey uppercase shrink-0" title={`Filed under the page "${projectPages.find(p => p.id === sub.parentId)?.title}"`}>↳ sub</span>
                                )}
                                {sub._acrType === 'proposed-add' && (
                                  <span className="text-[9px] font-black text-[#51b53e] bg-[#51b53e]/15 border border-[#51b53e]/30 px-1 py-0.5 uppercase tracking-tighter leading-none shrink-0">PROPOSED</span>
                                )}
                                {sub._acrType === 'proposed-update' && (
                                  <span className="text-[9px] font-black text-[#ff7600] bg-[#ff7600]/15 border border-[#ff7600]/30 px-1 py-0.5 uppercase tracking-tighter leading-none shrink-0 animate-pulse">REVISION</span>
                                )}
                              </div>
                              {!isAcrItem && (
                                <button 
                                  className="opacity-0 group-hover:opacity-100 text-qb-light-grey hover:text-qb-magenta transition-opacity shrink-0 p-1"
                                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm({ id: sub.id, type: 'child' }); }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isAcrItem && (
                                <span className="text-[9px] font-mono text-qb-grey/60 uppercase tracking-widest font-black shrink-0">ACR</span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden h-2/3 lg:h-full ${effectiveIsEditing ? '' : 'lg:pr-8'}`}>
        {activePage ? (
          effectiveIsEditing ? (
            <div className="h-full flex flex-col border border-qb-light-grey shadow-sm bg-transparent overflow-hidden animate-fade-in animate-duration-300">
              <div className="h-10 border-b border-qb-light-grey flex items-center justify-between px-4 bg-transparent shrink-0">
                {activePage._acrType && activePage._acrType !== 'normal' ? (
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#ff7600] animate-pulse">
                    PROPOSAL MODE: ALWAYS EDITABLE (YOUR EDITS UPDATE ACR)
                  </span>
                ) : (
                  <>
                    <span className="text-[10px] font-black uppercase tracking-widest text-qb-orange">EDITING ENTRY</span>
                    <button 
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-1.5 bg-qb-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-qb-orange transition-colors"
                    >
                      DONE
                    </button>
                  </>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                <CodexEditor page={editingPage || activePage} onUpdate={(updates) => handleUpdatePage(activePage.id, updates)} />
              </div>
            </div>
          ) : (
            <div className="w-full max-w-4xl pt-2 pb-16 overflow-y-auto hide-scrollbar h-full">
              {/* Codex draws the stored page and the proposed page side by
                  side below, which is the comparison. Nothing is repeated here. */}

              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-black uppercase tracking-widest">
                {(() => {
                  // Where the page lives, and a way to move it. A page with no
                  // folder (UNFILED) says so and asks for one.
                  if (viewingFolderNotes || activePage._acrType === 'proposed-add') return null;
                  const folders = rootPages.filter(r => !r._virtual);
                  return (
                    <label className="flex items-center gap-2 text-[11px] text-qb-grey" title="Move this page to another folder">
                      <Folder className={`w-3.5 h-3.5 ${activeFolder ? 'text-qb-orange' : 'text-qb-magenta'}`} />
                      <select
                        value={activeFolder?.id || ''}
                        onChange={(e) => { if (e.target.value) handleUpdatePage(activePage.id, { parentId: e.target.value }); }}
                        className={`bg-transparent border-b outline-none cursor-pointer font-black uppercase tracking-widest text-[11px] pb-0.5 ${activeFolder ? 'border-qb-light-grey text-qb-dark-grey hover:text-qb-black' : 'border-qb-magenta text-qb-magenta'}`}
                      >
                        {!activeFolder && <option value="">Not in a folder — choose one…</option>}
                        {folders.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
                      </select>
                    </label>
                  );
                })()}
                <span className="text-qb-orange">
                  {(() => { const d = new Date(activePage.updatedAt); return isNaN(d.getTime()) ? '' : format(d, "yyyy-MM-dd HH:mm"); })()}
                </span>
              </div>

              {viewingFolderNotes && (
                <div className="mb-6 mt-2 border border-qb-orange/40 bg-qb-orange/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-qb-dark-grey leading-relaxed">
                    <span className="font-black uppercase tracking-widest text-qb-orange mr-1">Folder notes.</span>
                    This text was saved on the folder <b>{activePage.title}</b> itself, before folders held only pages. Nothing is lost; move it into a page to edit it like any other.
                  </p>
                  <button
                    onClick={() => moveFolderNotesIntoPage(activePage)}
                    className="shrink-0 px-4 py-2 bg-qb-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-qb-orange transition-colors"
                  >
                    Move into a page
                  </button>
                </div>
              )}
              
              {activePage._acrType === 'proposed-update' ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8 mt-4">
                  {/* Original Side */}
                  <div className="flex flex-col border border-slate-300 p-6 bg-slate-50 relative rounded-none">
                    <span className="absolute top-2 right-2 text-[9px] font-mono select-none px-2 py-0.5 bg-slate-200 text-[#5c666b] font-bold rounded-none">ORIGINAL DETAILS</span>
                    {/* The stored page. The row itself now carries the
                        proposed values, so the original comes from
                        `acrOriginal` rather than from the row. */}
                    <h3 className="text-xl font-bold font-mono text-[#5c666b] line-through uppercase mb-4 tracking-wider leading-tight">
                      {activePage.acrOriginal?.title ?? activePage.title}
                    </h3>
                    <hr className="border-t border-slate-300 mb-6" />
                    <div className="qb-prose opacity-60 line-through">
                      <RichTextViewer
                        content={activePage.acrOriginal?.content ?? activePage.content}
                        placeholder="No content exists."
                      />
                    </div>
                  </div>

                  {/* Proposed Side */}
                  <div className="flex flex-col border border-[#ff7600]/30 p-6 bg-[#ff7600]/5 relative rounded-none">
                    <span className="absolute top-2 right-2 text-[9px] font-mono select-none px-2 py-0.5 bg-[#ff7600]/10 text-[#ff7600] font-black rounded-none">PROPOSAL REVISION</span>
                    <h3 className="text-xl font-black text-qb-black uppercase mb-4 tracking-wider leading-tight">
                      {activePage.title}
                    </h3>
                    <hr className="border-t border-[#ff7600]/30 mb-6" />
                    <div className="qb-prose">
                      <RichTextViewer
                        content={activePage.content}
                        placeholder="No content proposed."
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="text-4xl font-black uppercase tracking-widest text-qb-black mb-6">
                      {activePage.title}
                  </h1>
                  
                  <hr className="border-t border-qb-light-grey mb-8" />

                  <RichTextViewer
                    content={activePage.content}
                    placeholder="No data recorded for this entry."
                    className="qb-prose qb-prose-lg"
                  />
                </>
              )}

              {!(activePage._acrType && activePage._acrType !== 'normal') && !viewingFolderNotes && (
                <div className="mt-16 pt-8 border-t border-qb-light-grey flex items-center justify-between gap-6">
                  <button 
                    onClick={() => setIsEditing(true)} 
                    className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-qb-grey hover:text-qb-orange transition-colors"
                  >
                      <Edit2 className="w-4 h-4" /> REVISE DATA
                  </button>
                  <button 
                    onClick={handleExportDocx}
                    className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-qb-grey hover:text-qb-cyan transition-colors"
                  >
                      <Download className="w-4 h-4" /> EXPORT DOCX
                  </button>
                  <button 
                    onClick={() => {
                      setShowDeleteConfirm({ id: activePage.id, type: 'child' });
                    }}
                    className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-qb-grey hover:text-qb-magenta transition-colors ml-auto"
                  >
                      <Trash2 className="w-4 h-4" /> DELETE CONTENT
                  </button>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-qb-grey p-8 h-full">
            <FileText className="w-16 h-16 mb-4 text-qb-light-grey" />
            <p className="text-sm font-black uppercase tracking-widest">SELECT AN ENTRY TO VIEW CONTENT</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title={showDeleteConfirm.type === 'root' ? "DELETE FOLDER" : "DELETE ENTRY"}
          description={showDeleteConfirm.type === 'root'
            ? `Delete the folder "${projectPages.find(p => p.id === showDeleteConfirm.id)?.title || ''}" and the ${(pagesByFolder[showDeleteConfirm.id] || []).length} page${(pagesByFolder[showDeleteConfirm.id] || []).length === 1 ? '' : 's'} inside it?`
            : 'Are you sure you want to delete this entry?'}
          subDescription="THIS ACTION CANNOT BE UNDONE."
          confirmText="YES, DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            deletePage(showDeleteConfirm.id);
            if (activePageId === showDeleteConfirm.id) {
               setActivePageId(null);
            }
            setShowDeleteConfirm(null);
          }}
          onClose={() => setShowDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
