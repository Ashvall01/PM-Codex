import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Stat, headerButtonClass } from '../../components/PageHeader';
import { useBillingStore, BillingMilestone, Status } from '../../store/billingStore';
import { useDocumentsStore } from '../../store/documentsStore';
import { useAppStore } from '../../store/appStore';
import { Plus, Trash2, Edit2, X, FileText, Link, Calendar, DollarSign, Percent, CheckCircle, Settings, Check } from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { useAcrStore } from '../../store/acrStore';
import { enrichWithAcr } from '../../utils/acrDiff';

const STATUS_OPTIONS: Status[] = ['Pending', 'In Progress', 'Done'];

const getStatusColor = (status: Status | string) => {
  switch (status) {
    case 'Done': return 'var(--color-qb-orange)'; // orange
    case 'In Progress': return 'var(--color-qb-cyan)'; // cyan
    case 'Pending': return 'var(--color-qb-grey)'; // grey
    default: return 'var(--color-qb-grey)';
  }
};

const formatCurrency = (amount: number, currencyCode: string = 'USD') => {
  try {
    if (currencyCode === 'IDR') {
      return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
      }).format(amount);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode || 'USD',
    }).format(amount);
  } catch (e) {
    return new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ` ${currencyCode}`;
  }
};

const getQuarter = (dateString: string) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
};

export const Billing: React.FC = () => {
  const navigate = useNavigate();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const { milestones, currency, addMilestone, updateMilestone, deleteMilestone, setCurrency } = useBillingStore();
  const allDocuments = useDocumentsStore((state) => state.documents);
  const projectDocs = activeProjectId ? allDocuments.filter(d => d.projectId === activeProjectId) : [];

  const [activeMilestoneId, setActiveMilestoneId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  /**
   * Billing had no change-request code at all.
   *
   * `updateMilestone` is an action the assistants can propose, so a proposal
   * could sit pending against a milestone with nothing anywhere on this screen
   * to say so. It is now enriched exactly like every other module.
   *
   * `updateMilestone` used to do nothing when approved from the review panel,
   * because the only case for it lived in Gemini's own review-modal path. All
   * three paths now share one executor, so it applies from any of them.
   */
  const activeAcrId = useAcrStore(state => state.activeAcrId);
  const activeAcrChangeId = useAcrStore(state => state.activeAcrChangeId);
  const acr = useAcrStore(state => state.acrs.find(a => a.status === 'pending' && a.id === activeAcrId));

  const projectMilestones = useMemo(() => {
    const real = activeProjectId ? milestones.filter((m) => m.projectId === activeProjectId) : [];
    return enrichWithAcr<any>(
      real,
      acr,
      { update: ['updateMilestone'] },
      activeAcrChangeId,
    );
  }, [milestones, activeProjectId, acr, activeAcrChangeId]);

  const activeMilestone = activeMilestoneId
    ? projectMilestones.find((m) => m.id === activeMilestoneId) || null
    : null;

  const handleAddNew = () => {
    if (!activeProjectId) return;
    const newId = addMilestone(activeProjectId, {
      agreementName: 'New Agreement',
    });
    setActiveMilestoneId(newId);
    setIsEditing(true);
  };

  const handleUpdate = (id: string, updates: Partial<BillingMilestone>) => {
    // While a proposal is open on this milestone, an edit belongs to the
    // proposal. Writing to the real record would apply the change before
    // anyone had signed anything off — the same fault the other modules had.
    const row: any = projectMilestones.find((m) => m.id === id);
    if (row?.isAcrProposedUpdate && row.acrChangeId && acr?.id) {
      const change = acr.changes.find((c) => c.id === row.acrChangeId);
      if (change) {
        useAcrStore.getState().updateAcrChange(acr.id, row.acrChangeId, {
          args: { ...change.args, ...updates },
        });
        return;
      }
    }
    updateMilestone(id, updates);
  };

  // Values can arrive as text (from the Sheet, or a proposal). Adding "120000"
  // to a number glues the digits on instead of adding, so read them as numbers.
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const totalValueNet = projectMilestones.reduce((acc, curr) => acc + num(curr.valueNet), 0);
  const totalValueVat = projectMilestones.reduce((acc, curr) => acc + num(curr.valueVat), 0);
  const totalInvoiced = projectMilestones
    .filter(m => m.invoicingStatus === 'Done')
    .reduce((acc, curr) => acc + num(curr.valueVat), 0);

  const getDocUrl = (linkOrId: string) => {
    if (!linkOrId) return '';
    const doc = projectDocs.find(d => d.id === linkOrId);
    return doc ? doc.url : linkOrId;
  };
  
  const getDocTitle = (linkOrId: string) => {
     if (!linkOrId) return '';
     const doc = projectDocs.find(d => d.id === linkOrId);
     return doc ? doc.title : 'Link';
  };

  // Group milestones by agreementName
  const groupedMilestones = useMemo(() => {
    const groups: Record<string, BillingMilestone[]> = {};
    projectMilestones.forEach(m => {
      const name = m.agreementName || 'Unnamed Agreement';
      if (!groups[name]) groups[name] = [];
      groups[name].push(m);
    });
    return groups;
  }, [projectMilestones]);

  // Quarterly Data
  const quarterlyData = useMemo(() => {
    const data: Record<string, { billed: number; pending: number }> = {};
    projectMilestones.forEach(m => {
      const q = getQuarter(m.invoiceDate);
      if (!q) return;
      if (!data[q]) data[q] = { billed: 0, pending: 0 };
      if (m.invoicingStatus === 'Done') {
        data[q].billed += num(m.valueVat);
      } else {
        data[q].pending += num(m.valueVat);
      }
    });
    // Sort keys: e.g. Q1 2023, Q2 2023
    const sortedKeys = Object.keys(data).sort((a, b) => {
      const [qa, ya] = a.split(' ');
      const [qb, yb] = b.split(' ');
      if (ya !== yb) return parseInt(ya) - parseInt(yb);
      return qa.localeCompare(qb);
    });
    return sortedKeys.map(key => ({ quarter: key, ...data[key] }));
  }, [projectMilestones]);

  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="h-full flex bg-transparent font-sans">
      {/* List View */}
      <div className={`flex-1 flex flex-col pt-4 sm:pt-8 px-4 sm:pl-12 sm:pr-6 overflow-y-auto ${activeMilestone || showSettings ? 'lg:mr-[600px]' : ''} transition-all duration-300`}>
        <PageHeader
          title="Billing"
          stats={<>
            <Stat n={projectMilestones.length} label="milestones" />
            <Stat n={projectMilestones.filter((m: any) => m.invoicingStatus === 'Done').length} label="invoiced" tone="green" />
            <Stat n={projectMilestones.filter((m: any) => m.workStatus === 'Done' && m.invoicingStatus !== 'Done').length} label="ready to invoice" tone="orange" />
          </>}
        >
            <button
               onClick={() => navigate('/settings?tab=billing')}
               className={headerButtonClass()}
            >
               <Settings className="w-5 h-5" /> Settings
            </button>
            <button
              onClick={handleAddNew}
              className={headerButtonClass(true)}
            >
              <Plus className="w-5 h-5" /> New Milestone
            </button>
        </PageHeader>

        {/* Global Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-transparent border border-qb-light-grey p-6 relative">
            <div className="absolute top-0 right-0 w-2 h-2 bg-qb-black"></div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2">Total Net Value</h3>
            <p className="text-2xl font-mono text-qb-black">{formatCurrency(totalValueNet, currency)}</p>
          </div>
          <div className="bg-transparent border border-qb-light-grey p-6 relative">
            <div className="absolute top-0 right-0 w-2 h-2 bg-qb-black"></div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2">Total Value (+VAT)</h3>
            <p className="text-2xl font-mono text-qb-black">{formatCurrency(totalValueVat, currency)}</p>
          </div>
          <div className="bg-transparent border-l-4 border-l-qb-orange border-y border-r border-qb-light-grey p-6 relative">
            <div className="absolute top-0 right-0 w-2 h-2 bg-qb-orange"></div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2">Invoiced (Done)</h3>
            <p className="text-2xl font-mono text-qb-orange">{formatCurrency(totalInvoiced, currency)}</p>
          </div>
        </div>

        {/* Quarterly Data */}
        <div className="mb-12 p-8 bg-transparent border border-qb-light-grey">
           <div className="flex items-center gap-3 mb-6">
              <span className="text-[10px] bg-qb-black text-white px-2 py-0.5 font-black uppercase tracking-widest">Q-PROJ</span>
              <h3 className="text-sm font-black text-qb-black uppercase tracking-widest">Quarterly Projection (Value + VAT)</h3>
           </div>
           {quarterlyData.length > 0 ? (
             <div className="flex gap-6 overflow-x-auto pb-2 no-scrollbar">
               {quarterlyData.map(q => (
                  <div key={q.quarter} className="min-w-[220px] bg-transparent border border-qb-light-grey p-5 relative group hover:border-qb-orange transition-colors">
                     <div className="absolute top-0 left-0 w-1 h-full bg-transparent group-hover:bg-qb-orange transition-colors"></div>
                     <p className="text-xs font-black uppercase tracking-widest text-qb-black mb-4 border-b border-qb-light-grey pb-2">{q.quarter}</p>
                     <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] uppercase font-black text-qb-grey">Billed</span>
                        <span className="text-sm font-mono text-qb-orange">{formatCurrency(q.billed, currency)}</span>
                     </div>
                     <div className="flex justify-between items-center">
                        <span className="text-[10px] uppercase font-black text-qb-grey">Pending</span>
                        <span className="text-sm font-mono text-qb-orange">{formatCurrency(q.pending, currency)}</span>
                     </div>
                  </div>
               ))}
            </div>
          ) : (
            <p className="text-sm text-qb-grey italic">Set an invoice date on your milestones to see quarterly projections here.</p>
          )}
        </div>

        <div className="flex-1 pb-12 space-y-12">
            {Object.keys(groupedMilestones).length === 0 ? (
              <div className="text-center py-20 text-qb-grey font-medium tracking-widest uppercase border border-dashed border-qb-light-grey">
                No billing milestones found. Click 'New Milestone' to begin.
              </div>
            ) : (
               Object.entries(groupedMilestones).map(([groupName, groupMilestones]) => (
                  <div key={groupName}>
                     <h2 className="text-xl font-black text-qb-black uppercase tracking-widest mb-6 pb-2 border-b-2 border-qb-black inline-block">{groupName}</h2>
                     <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {groupMilestones.map((m) => (
                           <div
                              key={m.id}
                              onClick={() => { setActiveMilestoneId(m.id); setIsEditing(false); setShowSettings(false); }}
                              className={`bg-transparent border cursor-pointer hover:border-qb-orange hover:bg-qb-box-bg transition-all p-6 relative group ${activeMilestoneId === m.id ? 'border-qb-orange ring-1 ring-qb-orange bg-qb-box-bg' : 'border-qb-light-grey'} ${(m as any).isAcrProposedUpdate ? 'border-l-4 border-l-[#ff7600] bg-[#ff7600]/5' : ''} ${(m as any).isFocusedChange ? 'ring-2 ring-qb-orange' : ''}`}
                           >
                              {(m as any).isAcrProposedUpdate && (
                                <span className="absolute top-2 right-2 text-[9px] font-black tracking-widest text-[#ff7600] border border-[#ff7600] px-1.5 py-0.5 uppercase bg-[#ff7600]/10 z-10">
                                  PROPOSED EDIT · {(m as any).acrChangedFieldCount} FIELD{(m as any).acrChangedFieldCount === 1 ? '' : 'S'}
                                </span>
                              )}
                              <div className={`absolute top-0 left-0 w-full h-1 transition-colors ${activeMilestoneId === m.id ? 'bg-qb-orange' : 'bg-transparent group-hover:bg-qb-orange'}`}></div>
                              <div className="flex justify-between items-start mb-4">
                                <div className="flex flex-col gap-1 pr-8">
                                    <div className="flex items-center gap-2 mb-1">
                                       <span className="bg-qb-black text-white px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">Phase: {m.phase || 'N/A'}</span>
                                       <span className="text-xs font-bold text-qb-dark-grey uppercase tracking-widest">{m.agreementNo || 'No Agreement #'}</span>
                                    </div>
                                    <p className="text-sm font-bold text-qb-grey uppercase tracking-widest mt-2">{m.term || 'No term details'}</p>
                                </div>
                                <div className="flex gap-2">
                                    {getDocUrl(m.agreementLink) && (
                                       <a href={getDocUrl(m.agreementLink)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 text-qb-grey hover:text-qb-orange transition-all p-1" title="Agreement Link">
                                          <Link className="w-5 h-5" />
                                       </a>
                                    )}
                                    <button
                                    className="opacity-0 group-hover:opacity-100 text-qb-light-grey hover:text-qb-magenta transition-opacity p-1"
                                    onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(m.id); }}
                                    title="Delete Milestone"
                                    >
                                    <Trash2 className="w-5 h-5" />
                                    </button>
                                </div>
                              </div>

                              <div className="flex items-center gap-6 mt-4 pt-4 border-t border-qb-light-grey mb-4">
                                <div className="flex-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-1">Value (+VAT)</p>
                                    <p className="font-mono text-qb-black text-lg">{formatCurrency(m.valueVat, currency)}</p>
                                </div>
                                <div className="w-px h-8 bg-qb-light-grey"></div>
                                <div className="flex-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-1">Percentage</p>
                                    <p className="font-mono text-qb-black text-lg">{m.percentage}%</p>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2 text-[9px] font-black uppercase tracking-widest">
                                <div className="p-2 border" style={{ borderColor: getStatusColor(m.workStatus), color: getStatusColor(m.workStatus) }}>
                                    <span className="block mb-1 text-qb-grey">Work</span>
                                    {m.workStatus}
                                </div>
                                <div className="p-2 border" style={{ borderColor: getStatusColor(m.prerequisiteDocumentStatus), color: getStatusColor(m.prerequisiteDocumentStatus) }}>
                                    <span className="block mb-1 text-qb-grey">Docs</span>
                                    {m.prerequisiteDocumentStatus}
                                </div>
                                <div className="p-2 border" style={{ borderColor: getStatusColor(m.invoicingStatus), color: getStatusColor(m.invoicingStatus) }}>
                                    <span className="block mb-1 text-qb-grey">Invoice</span>
                                    {m.invoicingStatus}
                                </div>
                              </div>

                              {m.invoiceDate && (
                                <div className="mt-4 flex items-center gap-2 text-xs font-bold text-qb-dark-grey uppercase tracking-widest">
                                    <Calendar className="w-4 h-4 text-qb-orange" /> Invoice Date: {m.invoiceDate}
                                </div>
                              )}
                           </div>
                        ))}
                     </div>
                  </div>
               ))
            )}
        </div>
      </div>

      {/* Slide-out Detail Panel or Settings Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full lg:w-[600px] bg-qb-bg lg:border-l-4 border-l-0 border-qb-black transform transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col z-40 lg:z-30 shadow-2xl lg:shadow-none ${(activeMilestone || showSettings) ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {showSettings ? (
          <>
            <header className="flex justify-between items-center px-12 py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
              <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
              <div className="flex items-center gap-4">
                <Settings className="w-6 h-6 text-qb-grey" />
                <h2 className="text-2xl font-black text-qb-black uppercase tracking-widest">
                  Billing Settings
                </h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-qb-grey hover:text-qb-black transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-12 py-8 flex flex-col gap-8 bg-transparent no-scrollbar">
               <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-qb-black mb-4">Currency Format</h3>
                  <p className="text-xs text-qb-grey font-medium mb-4">Select the ISO currency code for billing tracking values.</p>
                  <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Currency Code</label>
                  <input
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    className="w-full bg-transparent border border-qb-light-grey p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                    placeholder="USD, EUR, MYR..."
                    maxLength={3}
                  />
               </div>
            </div>
          </>
        ) : activeMilestone && (
          <>
            <header className="flex justify-between items-center px-12 py-8 border-b border-qb-light-grey bg-transparent shrink-0 relative">
              <div className="absolute bottom-0 left-0 h-0.5 w-12 bg-qb-orange"></div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-qb-grey uppercase tracking-widest leading-none">MILESTONE DETAILS</span>
                <h2 className="text-2xl font-black text-qb-black uppercase tracking-widest mt-1">
                  {isEditing ? 'EDIT MILESTONE' : 'VIEW MILESTONE'}
                </h2>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowDeleteConfirm(activeMilestone.id)}
                  className="p-3 bg-transparent text-qb-grey border-2 border-transparent hover:text-qb-magenta hover:border-qb-magenta transition-colors"
                  title="Delete Milestone"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className={`p-3 border-2 transition-all duration-300 ${isEditing ? 'bg-qb-black text-white border-qb-black' : 'bg-transparent text-qb-grey border-qb-light-grey hover:border-qb-black hover:text-qb-black'}`}
                  title={isEditing ? "Done Editing" : "Edit Milestone"}
                >
                  {isEditing ? <Check className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { setActiveMilestoneId(null); setIsEditing(false); }}
                  className="p-3 bg-transparent border-2 border-transparent text-qb-grey hover:text-qb-black transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-12 py-8 flex flex-col gap-8 bg-transparent no-scrollbar relative">
              {isEditing ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Agreement Name</label>
                      <input
                        type="text"
                        value={activeMilestone.agreementName}
                        onChange={(e) => handleUpdate(activeMilestone.id, { agreementName: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                        placeholder="Agreement Name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Phase</label>
                      <input
                        type="text"
                        value={activeMilestone.phase}
                        onChange={(e) => handleUpdate(activeMilestone.id, { phase: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                        placeholder="Phase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Agreement No.</label>
                      <input
                        type="text"
                        value={activeMilestone.agreementNo}
                        onChange={(e) => handleUpdate(activeMilestone.id, { agreementNo: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                        placeholder="AGR-001"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Agreement Link / Document</label>
                      <select
                        value={activeMilestone.agreementLink}
                        onChange={(e) => handleUpdate(activeMilestone.id, { agreementLink: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                      >
                         <option value="">Select Document...</option>
                         {projectDocs.map(doc => (
                            <option key={doc.id} value={doc.id}>{doc.title}</option>
                         ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Term Details</label>
                      <input
                        type="text"
                        value={activeMilestone.term}
                        onChange={(e) => handleUpdate(activeMilestone.id, { term: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                        placeholder="E.g., Upon Signature"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Percentage (%)</label>
                      <input
                        type="number"
                        value={activeMilestone.percentage}
                        onChange={(e) => handleUpdate(activeMilestone.id, { percentage: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange tracking-wide"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Value (Net)</label>
                      <input
                        type="number"
                        value={activeMilestone.valueNet}
                        onChange={(e) => handleUpdate(activeMilestone.id, { valueNet: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange tracking-wide"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Value (+VAT)</label>
                      <input
                        type="number"
                        value={activeMilestone.valueVat}
                        onChange={(e) => handleUpdate(activeMilestone.id, { valueVat: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange tracking-wide"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-qb-grey uppercase tracking-widest mb-2">Work Status</label>
                      <select
                        value={activeMilestone.workStatus}
                        onChange={(e) => handleUpdate(activeMilestone.id, { workStatus: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                      >
                        {STATUS_OPTIONS.map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-qb-grey uppercase tracking-widest mb-2">Prereq Doc Status</label>
                      <select
                        value={activeMilestone.prerequisiteDocumentStatus}
                        onChange={(e) => handleUpdate(activeMilestone.id, { prerequisiteDocumentStatus: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                      >
                        {STATUS_OPTIONS.map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-qb-grey uppercase tracking-widest mb-2">Invoicing Status</label>
                      <select
                        value={activeMilestone.invoicingStatus}
                        onChange={(e) => handleUpdate(activeMilestone.id, { invoicingStatus: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-xs font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                      >
                        {STATUS_OPTIONS.map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Prerequisite Doc Link / Document</label>
                      <select
                        value={activeMilestone.documentLink}
                        onChange={(e) => handleUpdate(activeMilestone.id, { documentLink: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange tracking-wide"
                      >
                         <option value="">Select Document...</option>
                         {projectDocs.map(doc => (
                            <option key={doc.id} value={doc.id}>{doc.title}</option>
                         ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Invoice Link</label>
                      <input
                        type="text"
                        value={activeMilestone.invoiceLink}
                        onChange={(e) => handleUpdate(activeMilestone.id, { invoiceLink: e.target.value })}
                        className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange tracking-wide"
                        placeholder="https://..."
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Invoice Date / Plan</label>
                    <input
                      type="date"
                      value={(activeMilestone.invoiceDate || '').split('T')[0]}
                      onChange={(e) => handleUpdate(activeMilestone.id, { invoiceDate: e.target.value })}
                      className="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-1 focus:ring-qb-orange uppercase tracking-wide"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-qb-grey uppercase tracking-widest mb-2">Remarks</label>
                    <textarea
                      value={activeMilestone.remarks || ''}
                      onChange={(e) => handleUpdate(activeMilestone.id, { remarks: e.target.value })}
                      className="w-full h-24 bg-qb-box-bg border-none p-4 text-sm font-medium text-qb-black outline-none focus:ring-1 focus:ring-qb-orange resize-none tracking-wide"
                      placeholder="Additional notes..."
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="bg-qb-black text-white px-3 py-1 text-xs font-black uppercase tracking-widest">{activeMilestone.phase || 'N/A Phase'}</span>
                        <span className="text-sm font-bold text-qb-dark-grey uppercase tracking-widest">{activeMilestone.agreementNo || 'No Agreement #'}</span>
                    </div>
                    <h3 className="text-3xl font-black text-qb-black uppercase tracking-widest leading-tight mb-2">{activeMilestone.agreementName}</h3>
                    <p className="font-bold text-qb-grey text-lg uppercase tracking-widest">{activeMilestone.term || 'No term defined'}</p>
                    
                    {getDocUrl(activeMilestone.agreementLink) && (
                       <a href={getDocUrl(activeMilestone.agreementLink)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-4 text-xs font-black uppercase tracking-widest text-qb-cyan hover:text-qb-orange transition-colors">
                          <Link className="w-4 h-4" /> View Agreement: {getDocTitle(activeMilestone.agreementLink)}
                       </a>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-qb-light-grey border-t border-b border-qb-light-grey py-6 gap-4 sm:gap-0">
                    <div className="sm:pr-6">
                      <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2 flex items-center gap-1"><Percent className="w-3 h-3" /> Percentage</p>
                      <p className="font-mono text-2xl text-qb-black">{activeMilestone.percentage}%</p>
                    </div>
                     <div className="px-6">
                      <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Net Value</p>
                      <p className="font-mono text-xl text-qb-dark-grey">{formatCurrency(activeMilestone.valueNet, currency)}</p>
                    </div>
                    <div className="pl-6 relative">
                      <div className="absolute top-0 right-0 w-2 h-2 bg-qb-orange"></div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2 flex items-center gap-1"><DollarSign className="w-3 h-3 text-qb-orange" /> Value (+VAT)</p>
                      <p className="font-mono text-2xl text-qb-orange">{formatCurrency(activeMilestone.valueVat, currency)}</p>
                    </div>
                  </div>

                  <div className="space-y-6 mt-4">
                     <h4 className="text-xs font-black uppercase tracking-widest text-qb-black mb-4">Status Tracking</h4>
                     
                     <div className="grid grid-cols-[1fr_auto] gap-4 items-center border-b border-qb-light-grey border-dashed pb-4">
                        <div>
                           <p className="font-bold text-sm uppercase tracking-widest text-qb-black">Work Status</p>
                        </div>
                        <div className="px-3 py-1 border-2 font-black text-xs uppercase tracking-widest text-center min-w-[120px]" style={{ borderColor: getStatusColor(activeMilestone.workStatus), color: getStatusColor(activeMilestone.workStatus)}}>
                           {activeMilestone.workStatus}
                        </div>
                     </div>

                     <div className="grid grid-cols-[1fr_auto] gap-4 items-center border-b border-qb-light-grey border-dashed pb-4">
                        <div>
                           <p className="font-bold text-sm uppercase tracking-widest text-qb-black">Prerequisite Docs</p>
                           {getDocUrl(activeMilestone.documentLink) && (
                              <a href={getDocUrl(activeMilestone.documentLink)} target="_blank" rel="noreferrer" className="text-[10px] flex items-center gap-1 font-bold text-qb-orange hover:underline uppercase tracking-widest mt-1">
                                 <FileText className="w-3 h-3" /> {getDocTitle(activeMilestone.documentLink)}
                              </a>
                           )}
                        </div>
                        <div className="px-3 py-1 border-2 font-black text-xs uppercase tracking-widest text-center min-w-[120px]" style={{ borderColor: getStatusColor(activeMilestone.prerequisiteDocumentStatus), color: getStatusColor(activeMilestone.prerequisiteDocumentStatus)}}>
                           {activeMilestone.prerequisiteDocumentStatus}
                        </div>
                     </div>

                     <div className="grid grid-cols-[1fr_auto] gap-4 items-center">
                        <div>
                           <p className="font-bold text-sm uppercase tracking-widest text-qb-black flex items-center gap-2">Invoicing Status {activeMilestone.invoicingStatus === 'Done' && <CheckCircle className="w-4 h-4 text-qb-orange" />}</p>
                           {activeMilestone.invoiceDate && (
                              <p className="text-[10px] font-black uppercase tracking-widest text-qb-grey mt-1">
                                 Plan/Date: {activeMilestone.invoiceDate}
                              </p>
                           )}
                           {activeMilestone.invoiceLink && (
                              <a href={activeMilestone.invoiceLink} target="_blank" rel="noreferrer" className="text-[10px] flex items-center gap-1 font-bold text-qb-orange hover:underline uppercase tracking-widest mt-1">
                                 <Link className="w-3 h-3" /> View Invoice
                              </a>
                           )}
                        </div>
                        <div className="px-3 py-1 border-2 font-black text-xs uppercase tracking-widest text-center min-w-[120px]" style={{ borderColor: getStatusColor(activeMilestone.invoicingStatus), color: getStatusColor(activeMilestone.invoicingStatus)}}>
                           {activeMilestone.invoicingStatus}
                        </div>
                     </div>

                  </div>

                  {activeMilestone.remarks && (
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-qb-orange mb-3 mt-6">Remarks</h4>
                      <p className="text-sm font-medium text-qb-dark-grey leading-relaxed bg-qb-box-bg p-6 whitespace-pre-wrap">
                        {activeMilestone.remarks}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmationDialog
          isOpen={true}
          title="Delete Milestone"
          description={`Are you sure you want to remove '${milestones.find((m) => m.id === showDeleteConfirm)?.agreementName}'?`}
          subDescription="This action cannot be undone."
          confirmText="Yes, Delete"
          cancelText="Cancel"
          onConfirm={() => {
            deleteMilestone(showDeleteConfirm);
            if (activeMilestoneId === showDeleteConfirm) {
              setActiveMilestoneId(null);
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
