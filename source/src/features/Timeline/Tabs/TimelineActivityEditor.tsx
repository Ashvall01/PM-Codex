import React, { useState, useEffect } from 'react';
import { TimelineActivity } from '../../../store/timelineStore';
import { X, Save } from 'lucide-react';
import { DateVisualizer } from '../../../components/DateVisualizer';
import { AcrStatusLine } from '../../../components/AcrDiffList';

interface Props {
  activity: TimelineActivity;
  onSave: (id: string, updates: Partial<TimelineActivity>) => void;
  onClose: () => void;
}

export const TimelineActivityEditor: React.FC<Props> = ({ activity, onSave, onClose }) => {
  /**
   * The row may be a proposal rather than a stored activity.
   *
   * The caller enriches it, so the change and its field comparison are already
   * on the object. Showing them here means the Gantt editor says the same thing
   * the table, the review panel and every other module say.
   */
  const acrChange = (activity as any)?.acrChange;
  const acrDiffs = (activity as any)?.acrDiffs || [];
  const isProposal = !!acrChange;
  const [formData, setFormData] = useState<Partial<TimelineActivity>>({});

  useEffect(() => {
    setFormData(activity);
  }, [activity]);

  const getSafeDateString = (dateVal: any) => {
    if (!dateVal) return '';
    const strVal = String(dateVal);
    if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) return strVal;
    if (strVal.includes('T')) return strVal.split('T')[0];
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    let parsedValue: any = value;
    
    if (type === 'number') {
      parsedValue = value === '' ? 0 : parseFloat(value);
      if (name === 'progress') {
        parsedValue = parsedValue / 100;
      }
    }

    setFormData(prev => ({ ...prev, [name]: parsedValue }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(activity.id, formData);
    onClose();
  };

  return (
    <div className="flex flex-col h-full font-sans">
      <div className="flex items-center justify-between p-6 border-b border-qb-light-grey shrink-0">
        <h3 className="text-sm font-black uppercase tracking-widest text-qb-black">
          {isProposal ? 'Edit Proposed Activity' : 'Edit Activity'}
        </h3>
        <button onClick={onClose} className="p-1 text-qb-dark-grey hover:text-qb-black hover:bg-black/5 rounded">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* This editor uses plain input boxes, not the field component that
            shows old above new, so one line has to say where a save lands.
            The changed cells are marked in the activity table itself. */}
        {isProposal && (
          <div className="mb-6">
            <AcrStatusLine
              actionName={acrChange.name}
              declined={(activity as any).acrApproved === false}
              text="Saving here changes the proposal, not the activity."
            />
          </div>
        )}
        <form id="activity-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Phase</label>
            <input 
              name="phase"
              value={formData.phase || ''} 
              onChange={handleChange}
              className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Activity Group</label>
            <input 
              name="activity"
              value={formData.activity || ''} 
              onChange={handleChange}
              className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Sub Activity (Task)</label>
            <textarea 
              name="subActivity"
              value={formData.subActivity || ''} 
              onChange={handleChange}
              rows={2}
              className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black resize-y"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Status</label>
              <select
                name="status"
                value={formData.status || 'Planned'}
                onChange={handleChange}
                className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black"
              >
                <option value="Completed">Completed</option>
                <option value="Completed With Delay">Completed With Delay</option>
                <option value="Work In Progress">Work In Progress</option>
                <option value="Delayed WIP">Delayed WIP</option>
                <option value="Not Started">Not Started</option>
                <option value="Planned">Planned</option>
                <option value="Backlog">Backlog</option>
                <option value="Dropped">Dropped</option>
                <option value="On Hold">On Hold</option>
              </select>
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Owner</label>
              <input 
                name="owner"
                value={formData.owner || ''} 
                onChange={handleChange}
                className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Target Start</label>
              <DateVisualizer date={formData.targetStartDate} className="w-full">
                <input 
                  type="date"
                  name="targetStartDate"
                  value={getSafeDateString(formData.targetStartDate)} 
                  onChange={handleChange}
                  className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black uppercase"
                />
              </DateVisualizer>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Target End</label>
              <DateVisualizer date={formData.targetCompletionDate} className="w-full">
                <input 
                  type="date"
                  name="targetCompletionDate"
                  value={getSafeDateString(formData.targetCompletionDate)} 
                  onChange={handleChange}
                  className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black uppercase"
                />
              </DateVisualizer>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Actual Start</label>
              <DateVisualizer date={formData.actualStartDate} className="w-full">
                <input 
                  type="date"
                  name="actualStartDate"
                  value={getSafeDateString(formData.actualStartDate)} 
                  onChange={handleChange}
                  className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black uppercase"
                />
              </DateVisualizer>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Actual End</label>
              <DateVisualizer date={formData.actualCompletionDate} className="w-full">
                <input 
                  type="date"
                  name="actualCompletionDate"
                  value={getSafeDateString(formData.actualCompletionDate)} 
                  onChange={handleChange}
                  className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black uppercase"
                />
              </DateVisualizer>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">% Complete</label>
              <input 
                type="number"
                min="0"
                max="100"
                name="progress"
                value={formData.progress !== undefined ? Math.round(formData.progress * 100) : 0} 
                onChange={handleChange}
                className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black"
              />
            </div>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Weight</label>
              <input 
                type="number"
                min="0"
                name="weight"
                value={formData.weight || 0} 
                onChange={handleChange}
                className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-qb-dark-grey">Remarks</label>
            <textarea 
              name="remarks"
              value={formData.remarks || ''} 
              onChange={handleChange}
              rows={3}
              className="w-full border border-qb-light-grey px-3 py-2 text-sm font-medium outline-none focus:border-qb-orange bg-white text-qb-black resize-y"
            />
          </div>
        </form>
      </div>

      <div className="p-6 border-t border-qb-light-grey shrink-0">
        <button 
          form="activity-form"
          type="submit"
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-qb-black text-white text-xs font-black uppercase tracking-widest hover:bg-qb-orange transition-colors"
        >
          <Save className="w-4 h-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
};
