import React, { useState } from 'react';
import { 
  usePromptTemplatesStore, 
  PromptTemplate, 
  TemplateCategory, 
  DEFAULT_PROMPT_TEMPLATES 
} from '../../store/promptTemplatesStore';
import { 
  Plus, 
  Search, 
  Pencil, 
  Trash2, 
  Copy, 
  Check, 
  RotateCcw, 
  Sparkles, 
  Layers, 
  FileText,
  Clock,
  ShieldAlert,
  ListTodo,
  DollarSign,
  Briefcase
} from 'lucide-react';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';

const CATEGORIES: { id: TemplateCategory | 'All'; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'All', label: 'ALL CATEGORIES', icon: Layers },
  { id: 'General', label: 'GENERAL', icon: Briefcase },
  { id: 'Timeline', label: 'TIMELINE', icon: Clock },
  { id: 'Risks', label: 'RISKS', icon: ShieldAlert },
  { id: 'MoM', label: 'MOM & NOTES', icon: FileText },
  { id: 'Deliverables', label: 'DELIVERABLES', icon: Layers },
  { id: 'Tasks', label: 'TASKS & ISSUES', icon: ListTodo },
  { id: 'Billing', label: 'BILLING', icon: DollarSign },
];

export const getCategoryBadgeColor = (category: TemplateCategory) => {
  switch (category) {
    case 'Timeline':
      return 'bg-[#ff7600]/10 text-qb-orange border-qb-orange/30';
    case 'Risks':
      return 'bg-qb-magenta/10 text-qb-magenta border-qb-magenta/30';
    case 'MoM':
      return 'bg-[#2dbcd2]/10 text-[#2dbcd2] border-[#2dbcd2]/30';
    case 'Deliverables':
      return 'bg-qb-cyan/10 text-qb-cyan border-qb-cyan/30';
    case 'Tasks':
      return 'bg-[#51b53e]/10 text-[#51b53e] border-[#51b53e]/30';
    case 'Billing':
      return 'bg-qb-dark-grey/10 text-qb-dark-grey border-qb-dark-grey/30';
    default:
      return 'bg-qb-box-bg text-qb-dark-grey border-qb-light-grey';
  }
};

export const PromptTemplatesTab: React.FC = () => {
  const { 
    templates, 
    addTemplate, 
    updateTemplate, 
    deleteTemplate, 
    duplicateTemplate, 
    resetToDefaults 
  } = usePromptTemplatesStore();

  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal / Form state
  const [isEditing, setIsEditing] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    title: string;
    category: TemplateCategory;
    description: string;
    prompt: string;
  }>({
    title: '',
    category: 'General',
    description: '',
    prompt: '',
  });

  // Delete confirmation
  const [templateToDelete, setTemplateToDelete] = useState<PromptTemplate | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // Filter templates
  const filteredTemplates = templates.filter((t) => {
    const matchesCategory = selectedCategory === 'All' || t.category === selectedCategory;
    const matchesQuery = 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.prompt.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  const handleOpenAdd = () => {
    setEditingTemplateId(null);
    setFormData({
      title: '',
      category: selectedCategory === 'All' ? 'General' : selectedCategory,
      description: '',
      prompt: '',
    });
    setIsEditing(true);
  };

  const handleOpenEdit = (template: PromptTemplate) => {
    setEditingTemplateId(template.id);
    setFormData({
      title: template.title,
      category: template.category,
      description: template.description,
      prompt: template.prompt,
    });
    setIsEditing(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.prompt.trim()) return;

    if (editingTemplateId) {
      updateTemplate(editingTemplateId, {
        title: formData.title.trim(),
        category: formData.category,
        description: formData.description.trim(),
        prompt: formData.prompt.trim(),
      });
    } else {
      addTemplate({
        title: formData.title.trim(),
        category: formData.category,
        description: formData.description.trim(),
        prompt: formData.prompt.trim(),
        isDefault: false,
      });
    }

    setIsEditing(false);
    setEditingTemplateId(null);
  };

  const handleCopyPrompt = (template: PromptTemplate) => {
    navigator.clipboard.writeText(template.prompt);
    setCopiedId(template.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="border border-qb-light-grey p-6 flex flex-col gap-6 relative bg-transparent">
      <div className="absolute top-0 left-0 h-[3px] w-12 bg-qb-orange" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-qb-light-grey pb-6">
        <div>
          <h2 className="text-base font-black text-qb-black uppercase tracking-widest">
            Prompt templates
          </h2>
          <p className="text-sm text-qb-dark-grey leading-relaxed max-w-2xl mt-1">
            Ready-made requests you can pick in the Gemini chat instead of typing them out.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setIsResetConfirmOpen(true)}
            className="flex items-center gap-2 bg-transparent hover:bg-qb-light-grey/20 text-qb-dark-grey border border-qb-light-grey px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-colors"
            title="Reset to default prompt templates"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>RESET DEFAULTS</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-qb-black hover:bg-qb-orange text-white px-5 py-2.5 text-xs font-black uppercase tracking-widest transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>NEW TEMPLATE</span>
          </button>
        </div>
      </div>

      {/* Search & Category Filter Bar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-qb-grey absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates…"
              className="w-full bg-white border border-qb-light-grey pl-10 pr-4 py-2.5 text-xs font-bold text-qb-black outline-none focus:border-qb-orange transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-qb-grey hover:text-qb-black uppercase"
              >
                CLEAR
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-2 pt-1">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            const count = cat.id === 'All' 
              ? templates.length 
              : templates.filter((t) => t.category === cat.id).length;

            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-3 py-1.5 text-[11px] font-black tracking-widest uppercase border transition-all ${
                  isSelected
                    ? 'bg-qb-black text-white border-qb-black shadow-xs'
                    : 'bg-white text-qb-dark-grey border-qb-light-grey hover:border-qb-black hover:text-qb-black'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cat.label}</span>
                <span className={`text-[9px] px-1 py-0.2 font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-black/5 text-qb-grey'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Templates Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="border border-dashed border-qb-light-grey p-12 text-center flex flex-col items-center justify-center gap-3 bg-white/50">
          <Sparkles className="w-8 h-8 text-qb-grey opacity-50" />
          <p className="text-xs font-black uppercase tracking-widest text-qb-black">
            NO TEMPLATES FOUND
          </p>
          <p className="text-xs font-medium text-qb-grey max-w-sm">
            {searchQuery
              ? `No prompt templates matched "${searchQuery}". Try changing your search query.`
              : 'There are no prompt templates in this category. Click "+ NEW TEMPLATE" to create one.'}
          </p>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-xs font-black uppercase tracking-widest text-qb-orange hover:underline"
            >
              CLEAR SEARCH FILTER
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTemplates.map((template) => {
            const badgeClass = getCategoryBadgeColor(template.category);

            return (
              <div
                key={template.id}
                className="group relative border border-qb-light-grey bg-white p-5 flex flex-col justify-between gap-4 hover:border-qb-orange transition-all shadow-xs"
              >
                {/* Accent indicator bar */}
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-transparent group-hover:bg-qb-orange transition-colors" />

                <div className="flex flex-col gap-2.5">
                  {/* Top Bar: Category + Badges */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border ${badgeClass}`}>
                      <span className="w-1.5 h-1.5 bg-current shrink-0" />
                      {template.category}
                    </span>

                    {template.isDefault && (
                      <span className="text-[9px] font-mono font-bold text-qb-grey uppercase tracking-wider bg-black/5 px-1.5 py-0.5">
                        DEFAULT
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-black text-qb-black uppercase tracking-wide group-hover:text-qb-orange transition-colors">
                    {template.title}
                  </h3>

                  {/* Description */}
                  {template.description && (
                    <p className="text-xs font-medium text-qb-dark-grey leading-relaxed line-clamp-2">
                      {template.description}
                    </p>
                  )}

                  {/* Prompt Preview Box */}
                  <div className="mt-2 bg-qb-box-bg border border-qb-light-grey/60 p-3 font-mono text-[11px] text-qb-dark-grey leading-relaxed max-h-24 overflow-y-auto no-scrollbar relative">
                    <span className="text-[9px] font-sans font-black text-qb-grey uppercase tracking-widest block mb-1">
                      PROMPT INSTRUCTION:
                    </span>
                    <p className="whitespace-pre-wrap">{template.prompt}</p>
                  </div>
                </div>

                {/* Bottom Actions Bar */}
                <div className="flex items-center justify-between pt-3 border-t border-qb-light-grey/60 mt-2">
                  <div />

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopyPrompt(template)}
                      className="p-1.5 text-qb-grey hover:text-qb-black hover:bg-black/5 transition-colors"
                      title="Copy prompt to clipboard"
                    >
                      {copiedId === template.id ? (
                        <Check className="w-3.5 h-3.5 text-qb-green" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={() => duplicateTemplate(template.id)}
                      className="p-1.5 text-qb-grey hover:text-qb-black hover:bg-black/5 transition-colors"
                      title="Duplicate template"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleOpenEdit(template)}
                      className="p-1.5 text-qb-grey hover:text-qb-orange hover:bg-black/5 transition-colors"
                      title="Edit template"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => setTemplateToDelete(template)}
                      className="p-1.5 text-qb-grey hover:text-qb-magenta hover:bg-black/5 transition-colors"
                      title="Delete template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-qb-bg border-2 border-qb-black shadow-2xl p-6 sm:p-8 flex flex-col gap-6 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-qb-orange" />

            <div className="flex items-center justify-between border-b border-qb-light-grey pb-4">
              <div>
                <h3 className="text-base font-black text-qb-black uppercase tracking-widest flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-qb-orange" />
                  {editingTemplateId ? 'EDIT PROMPT TEMPLATE' : 'CREATE PROMPT TEMPLATE'}
                </h3>
                <p className="text-xs font-medium text-qb-grey uppercase tracking-wider mt-0.5">
                  Configure the title, category, and prompt instruction
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveForm} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-qb-black">
                    Template Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Weekly Executive Status Report"
                    className="bg-white border border-qb-light-grey p-2.5 text-xs font-bold text-qb-black outline-none focus:border-qb-orange"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-qb-black">
                    Category *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as TemplateCategory })}
                    className="bg-white border border-qb-light-grey p-2.5 text-xs font-bold text-qb-black outline-none focus:border-qb-orange cursor-pointer"
                  >
                    <option value="General">General</option>
                    <option value="Timeline">Timeline</option>
                    <option value="Risks">Risks</option>
                    <option value="MoM">MoM & Notes</option>
                    <option value="Deliverables">Deliverables</option>
                    <option value="Tasks">Tasks & Issues</option>
                    <option value="Billing">Billing</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-qb-black">
                  Short Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief summary of what this prompt accomplishes"
                  className="bg-white border border-qb-light-grey p-2.5 text-xs font-medium text-qb-black outline-none focus:border-qb-orange"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-qb-black">
                    Prompt Instructions *
                  </label>
                  <span className="text-[9px] font-mono text-qb-grey uppercase">
                    Plain text or structured instructions
                  </span>
                </div>
                <textarea
                  required
                  rows={6}
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  placeholder="Enter the full instruction for the AI assistant when this template is selected..."
                  className="bg-white border border-qb-light-grey p-3 text-xs font-mono text-qb-black outline-none focus:border-qb-orange resize-y leading-relaxed"
                />
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-qb-light-grey mt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-5 py-2.5 border border-qb-light-grey text-xs font-black uppercase tracking-widest text-qb-dark-grey hover:bg-black/5 transition-colors"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-qb-black hover:bg-qb-orange text-white text-xs font-black uppercase tracking-widest transition-colors shadow-xs"
                >
                  {editingTemplateId ? 'SAVE CHANGES' : 'CREATE TEMPLATE'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!templateToDelete}
        title="Delete Prompt Template"
        description={`Are you sure you want to delete "${templateToDelete?.title}"? This cannot be undone.`}
        confirmText="CONFIRM DELETE"
        cancelText="CANCEL"
        onConfirm={() => {
          if (templateToDelete) {
            deleteTemplate(templateToDelete.id);
            setTemplateToDelete(null);
          }
        }}
        onClose={() => setTemplateToDelete(null)}
      />

      {/* Reset Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={isResetConfirmOpen}
        title="Reset All Prompt Templates"
        description="Are you sure you want to restore all prompt templates to system defaults? Any custom templates will be overwritten."
        confirmText="RESTORE DEFAULTS"
        cancelText="CANCEL"
        onConfirm={() => {
          resetToDefaults();
          setIsResetConfirmOpen(false);
        }}
        onClose={() => setIsResetConfirmOpen(false)}
      />
    </div>
  );
};
