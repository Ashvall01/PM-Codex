import React, { useState } from 'react';
import { FunctionCall } from '@google/genai';
import { X, Check } from 'lucide-react';

interface AIReviewModalProps {
  calls: { id: string; call: FunctionCall; name: string; args: any }[];
  onApprove: (editedCalls: { id: string; call: FunctionCall; name: string; args: any }[]) => void;
  onCancel: () => void;
}

const AIReviewModal: React.FC<AIReviewModalProps> = ({ calls, onApprove, onCancel }) => {
  const [editedCalls, setEditedCalls] = useState(calls);

  const handleArgChange = (callId: string, key: string, value: any) => {
    setEditedCalls(prev => prev.map(c => {
      if (c.id === callId) {
        return {
          ...c,
          args: {
            ...c.args,
            [key]: value
          }
        };
      }
      return c;
    }));
  };

  const getInputType = (key: string, value: any) => {
    if (key.includes('Date')) return 'date';
    if (typeof value === 'number' || key === 'weight' || key === 'progress') return 'number';
    return 'text';
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-qb-black/80 backdrop-blur-sm p-4 md:p-8">
      <div className="bg-qb-box-bg w-full max-w-5xl h-full max-h-full flex flex-col border-2 border-qb-orange shadow-2xl relative">
        <div className="flex items-center justify-between p-6 border-b border-qb-light-grey shrink-0 bg-transparent">
          <h2 className="text-xl font-black uppercase tracking-widest flex items-center gap-2">
             <span className="w-2 h-2 bg-qb-orange"></span> REVIEW PROPOSED CHANGES
          </h2>
          <button onClick={onCancel} className="p-2 hover:bg-qb-light-grey/30 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
           {editedCalls.map((c, i) => (
             <div key={c.id} className="bg-transparent border border-qb-light-grey shadow-sm p-4 flex flex-col gap-4">
                <div className="text-xs font-black uppercase tracking-widest text-qb-grey flex items-center justify-between">
                   <span>ACTION {i + 1}: {c.name}</span>
                </div>
                {/* Arguments Editor */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(c.args).map(([key, val]) => {
                     const isId = key === 'id';
                     const isObject = typeof val === 'object' && val !== null;
                     return (
                       <div key={key} className={`flex flex-col gap-1 ${isObject ? 'col-span-full' : ''}`}>
                         <label className="text-[10px] font-black text-qb-dark-grey uppercase tracking-widest">{key}</label>
                         {isObject ? (
                           <textarea
                             value={JSON.stringify(val, null, 2)}
                             onChange={(e) => {
                               try {
                                 const newVal = JSON.parse(e.target.value);
                                 handleArgChange(c.id, key, newVal);
                               } catch (err) {
                                 // Let them type invalid JSON temporarily, but maybe just store as string until valid?
                                 // Simplified for now - just keep it as parsed if possible, else ignore
                                 handleArgChange(c.id, key, e.target.value);
                               }
                             }}
                             className="w-full px-2 py-2 text-xs font-mono border-b-2 border-qb-light-grey focus:border-qb-orange outline-none bg-transparent min-h-[100px]"
                           />
                         ) : (
                           <input 
                             type={getInputType(key, val)}
                             value={val !== undefined && val !== null ? (val as string | number) : ''}
                             onChange={(e) => {
                               let newVal: string | number = e.target.value;
                               if (getInputType(key, val) === 'number') newVal = Number(newVal);
                               handleArgChange(c.id, key, newVal);
                             }}
                             disabled={isId}
                             className="w-full px-2 py-2 text-sm border-b-2 border-qb-light-grey focus:border-qb-orange outline-none bg-transparent font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                           />
                         )}
                       </div>
                     );
                  })}
                </div>
             </div>
           ))}
        </div>

        <div className="p-6 border-t border-qb-light-grey bg-transparent shrink-0 flex items-center justify-end gap-4">
           <button onClick={onCancel} className="px-6 py-3 border border-qb-black text-xs font-black uppercase tracking-widest hover:bg-qb-light-grey/30 transition-colors">
             CANCEL
           </button>
           <button onClick={() => onApprove(editedCalls)} className="px-6 py-3 bg-qb-black text-white text-xs font-black uppercase tracking-widest flex items-center gap-2 hover:bg-qb-orange transition-colors">
             <Check className="w-4 h-4" /> APPROVE {editedCalls.length} ACTION(S)
           </button>
        </div>
      </div>
    </div>
  );
};

export default AIReviewModal;
