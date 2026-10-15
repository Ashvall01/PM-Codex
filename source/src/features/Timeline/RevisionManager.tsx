import React, { useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { ChevronDown, Plus, Trash2, Check, Clock } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';

interface RevisionManagerProps {
  projectId: string;
}

export const RevisionManager: React.FC<RevisionManagerProps> = ({ projectId }) => {
  const projectTimeline = useTimelineStore(state => state.getProjectTimeline(projectId));
  const switchRevision = useTimelineStore(state => state.switchRevision);
  const deleteRevision = useTimelineStore(state => state.deleteRevision);
  const createRevision = useTimelineStore(state => state.createRevision);
  
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newRevisionName, setNewRevisionName] = useState('');
  const [revisionToDelete, setRevisionToDelete] = useState<string | null>(null);

  if (!projectTimeline) return null;

  const revisions = projectTimeline.revisions;
  const activeRevision = revisions.find(r => r.id === projectTimeline.activeRevisionId);

  const handleCreate = () => {
    if (newRevisionName.trim()) {
      createRevision(projectId, newRevisionName.trim(), activeRevision?.id);
      setNewRevisionName('');
      setIsCreating(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative flex items-center">
      <div className="flex items-center gap-2 mr-4">
        <Clock className="w-4 h-4 text-qb-grey" />
        <div className="text-xs font-black text-qb-grey uppercase tracking-widest hidden md:block">
          Revision:
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 border border-qb-light-grey hover:border-qb-black hover:bg-qb-black hover:text-white transition-colors bg-transparent text-qb-black text-xs font-black uppercase tracking-widest"
        >
          <span className="max-w-[150px] truncate">{activeRevision?.name || 'Unknown'}</span>
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full right-4 mt-2 w-72 bg-qb-bg border-2 border-qb-black shadow-[4px_4px_0_0_rgba(17,17,17,1)] z-50">
            <div className="p-3 border-b-2 border-qb-black bg-qb-black text-white">
              <div className="text-[10px] font-black uppercase tracking-widest text-qb-box-bg">Version History</div>
            </div>
            
            <div className="max-h-64 overflow-y-auto">
              {revisions.map((rev) => {
                const isActive = rev.id === projectTimeline.activeRevisionId;
                return (
                  <div 
                    key={rev.id} 
                    className={`flex items-center justify-between p-3 border-b border-qb-light-grey last:border-b-0 hover:bg-qb-light-grey/30 transition-colors ${isActive ? "bg-qb-orange/10" : "bg-transparent"}`}
                  >
                    <button 
                      className="flex-1 flex items-center text-left"
                      onClick={() => {
                        switchRevision(projectId, rev.id);
                        setIsOpen(false);
                      }}
                    >
                      <div className="flex flex-col">
                        <span className={`text-xs font-black uppercase tracking-widest truncate max-w-[180px] ${isActive ? "text-qb-orange" : "text-qb-black"}`}>
                          {rev.name}
                        </span>
                        <span className="text-[10px] text-qb-grey uppercase tracking-wider">
                          {new Date(rev.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {isActive && <Check className="w-4 h-4 text-qb-orange ml-auto mr-2" />}
                    </button>
                    
                    {revisions.length > 1 && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setRevisionToDelete(rev.id);
                        }}
                        className="p-1.5 text-qb-light-grey hover:text-qb-orange transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t-2 border-qb-black bg-transparent">
              {isCreating ? (
                <div className="flex flex-col gap-2">
                  <input 
                    type="text" 
                    value={newRevisionName}
                    onChange={(e) => setNewRevisionName(e.target.value)}
                    placeholder="E.g. Phase 1 Plan"
                    className="w-full text-xs font-mono p-2 border border-qb-light-grey focus:outline-none focus:border-qb-black hover:border-qb-dark-grey bg-transparent transition-colors"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') setIsCreating(false);
                    }}
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={handleCreate}
                      disabled={!newRevisionName.trim()}
                      className="flex-1 bg-qb-black text-white py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-qb-orange transition-colors disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button 
                      onClick={() => setIsCreating(false)}
                      className="flex-1 bg-transparent border border-qb-light-grey text-qb-black py-1.5 text-[10px] font-black flex items-center justify-center uppercase tracking-widest hover:border-qb-black hover:bg-qb-black hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setIsCreating(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-black uppercase tracking-widest text-qb-black hover:bg-qb-black hover:text-white transition-colors border-2 border-dotted border-qb-light-grey hover:border-qb-black"
                >
                  <Plus className="w-4 h-4" />
                  Save as New Revision
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {revisionToDelete && (
        <ConfirmationDialog
          isOpen={true}
          title="DELETE REVISION?"
          description={`Are you sure you want to delete this revision?`}
          subDescription="This action cannot be undone."
          confirmText="DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            deleteRevision(projectId, revisionToDelete);
            setRevisionToDelete(null);
          }}
          onClose={() => setRevisionToDelete(null)}
        />
      )}
    </div>
  );
};
