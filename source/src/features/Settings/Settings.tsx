/**
 * SETTINGS — rebuilt 24 Sep 2026.
 *
 * Seven tabs named after how they were built ("DATABASE URL", "SYNC JOBS",
 * "AI DEBUG TOOLS") became six sections named after what they are for,
 * grouped as Data / Project / Assistants. Every section has the same frame.
 *
 * What changed besides the look:
 *   - Saving: the Google Sheet section says whether everything is saved, when
 *     it last was, and what is waiting; the old SYNC JOBS table (raw JSON of
 *     every change) is its "Save history", in words.
 *   - The Sheet's web app address is hidden until asked for: anyone who has it
 *     can read the data.
 *   - The risk matrix uses the app's colours (one cell class did not exist),
 *     and SAVE no longer claims "COPIED & SAVED!".
 *
 * The `tab` values in the address are unchanged, so links from Risks,
 * Billing and the chat still land in the right place. `sync` opens the Google
 * Sheet section.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Database, DollarSign, ShieldAlert, Sparkles, Eye, Grid3X3, RotateCcw, Copy, Check,
  RefreshCcw, Trash2, EyeOff, Settings as SettingsIcon, KeyRound,
} from 'lucide-react';
import { GeminiKeyForm } from '../../components/GeminiKeyForm';
import { useAppStore } from '../../store/appStore';
import { useRisksStore, RiskMatrix, ImpactLevel, ProbabilityLevel, RiskValue } from '../../store/risksStore';
import { useBillingStore } from '../../store/billingStore';
import { useSyncQueueStore } from '../../store/syncQueueStore';
import { MOCK_GAS_SCRIPT, EXPECTED_GAS_VERSION, gasSyncService } from '../../services/gasSyncService';
import { RISK_VALUE_COLORS, tint } from '../../utils/statusStyle';
import PIIGlossary from '../PIIGlossary/PIIGlossary';
import { AIDebugPanel } from './AIDebugPanel';
import { PromptTemplatesTab } from './PromptTemplatesTab';
import { PageHeader } from '../../components/PageHeader';

const IMPACT_LEVELS: ImpactLevel[] = ['Positive (Opportunity)', 'Low', 'Moderate', 'High', 'Critical', 'Catastrophic'];
const PROBABILITIES: ProbabilityLevel[] = ['Rare', 'Low', 'Moderate', 'High', 'Almost Certain', 'Uncertain'];
const RISK_VALUES: RiskValue[] = ['Lowest', 'Low', 'Medium', 'High', 'Highest', 'Expert Judgment'];

const DEFAULT_RISK_MATRIX: RiskMatrix = {
  'Positive (Opportunity)': { 'Rare': 'Lowest', 'Low': 'Lowest', 'Moderate': 'Low', 'High': 'Low', 'Almost Certain': 'Low', 'Uncertain': 'Expert Judgment' },
  'Low': { 'Rare': 'Lowest', 'Low': 'Lowest', 'Moderate': 'Low', 'High': 'Low', 'Almost Certain': 'Medium', 'Uncertain': 'Expert Judgment' },
  'Moderate': { 'Rare': 'Lowest', 'Low': 'Low', 'Moderate': 'Medium', 'High': 'Medium', 'Almost Certain': 'High', 'Uncertain': 'Expert Judgment' },
  'High': { 'Rare': 'Low', 'Low': 'Medium', 'Moderate': 'High', 'High': 'High', 'Almost Certain': 'Highest', 'Uncertain': 'Expert Judgment' },
  'Critical': { 'Rare': 'Medium', 'Low': 'High', 'Moderate': 'High', 'High': 'Highest', 'Almost Certain': 'Highest', 'Uncertain': 'Expert Judgment' },
  'Catastrophic': { 'Rare': 'High', 'Low': 'High', 'Moderate': 'Highest', 'High': 'Highest', 'Almost Certain': 'Highest', 'Uncertain': 'Expert Judgment' },
};

type SectionId = 'db' | 'risk' | 'billing' | 'pii' | 'gemini' | 'templates' | 'ai';
const MENU: { group: string; items: { id: SectionId; label: string; hint: string; icon: React.FC<{ className?: string }> }[] }[] = [
  { group: 'Data', items: [
    { id: 'db', label: 'Google Sheet', hint: 'Connection and saving', icon: Database },
  ] },
  { group: 'Project', items: [
    { id: 'risk', label: 'Risk matrix', hint: 'How impact and probability score', icon: Grid3X3 },
    { id: 'billing', label: 'Billing', hint: 'Show or hide; currency', icon: DollarSign },
    { id: 'pii', label: 'Privacy glossary', hint: 'Names hidden from the assistants', icon: ShieldAlert },
  ] },
  { group: 'Assistants', items: [
    { id: 'gemini', label: 'Gemini', hint: 'API key — optional', icon: KeyRound },
    { id: 'templates', label: 'Prompt templates', hint: 'Ready-made requests for the chat', icon: Sparkles },
    { id: 'ai', label: 'What Gemini sees', hint: 'The project summary it is sent', icon: Eye },
  ] },
];

// ------------------------------------------------------------------ pieces

const primaryButton = 'flex items-center justify-center gap-2 bg-qb-black hover:bg-qb-orange text-white px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-40 disabled:hover:bg-qb-black disabled:cursor-not-allowed';
const secondaryButton = 'flex items-center justify-center gap-2 border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-40';

/** The one frame every section uses. */
const Section: React.FC<{ title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, description, actions, children }) => (
  <section className="border border-qb-light-grey relative">
    <div className="absolute top-0 left-0 h-[3px] w-12 bg-qb-orange" />
    <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-qb-light-grey">
      <div className="min-w-0">
        <h2 className="text-base font-black uppercase tracking-widest text-qb-black">{title}</h2>
        {description && <p className="text-sm text-qb-dark-grey mt-1 max-w-2xl leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
    <div className="p-6">{children}</div>
  </section>
);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2">{children}</div>
);

// ------------------------------------------------------------ Google Sheet

const STORE_LABEL: Record<string, string> = {
  projects: 'Projects', projectTimelines: 'Timeline', deliverables: 'Deliverables', tasks: 'Tasks & issues',
  risks: 'Risks', moms: 'Minutes', documents: 'Documents', milestones: 'Billing', stakeholders: 'Stakeholders',
  pages: 'Codex', entries: 'Privacy glossary', sessions: 'Chats', acrs: 'Proposals',
};
const ACTION_LABEL: Record<string, string> = { CREATE: 'added', UPDATE: 'changed', DELETE: 'removed' };

const SheetSection: React.FC = () => {
  const { gasUrl, setGasUrl, syncStatus, lastSyncedAt, syncErrorMessage, syncHeldBack } = useAppStore();
  const jobs = useSyncQueueStore((s) => s.jobs);
  const { clearCompleted, retryFailed } = useSyncQueueStore();
  const [dbInput, setDbInput] = useState(gasUrl || '');
  const [showAddress, setShowAddress] = useState(false);
  const [check, setCheck] = useState<{ tone: 'green' | 'magenta'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const waiting = jobs.filter((j) => j.status !== 'COMPLETED');
  const failed = jobs.filter((j) => j.status === 'FAILED');

  const state = !gasUrl ? { label: 'Not connected', tone: 'var(--color-qb-grey)', text: 'Work is kept in this browser only.' }
    : syncHeldBack ? { label: 'Save held back', tone: 'var(--color-qb-magenta)', text: `A save would remove most rows of ${syncHeldBack}. Your Sheet is untouched until you choose Save anyway.` }
      : syncStatus === 'error' ? { label: 'Saving paused', tone: 'var(--color-qb-magenta)', text: syncErrorMessage || 'The Sheet did not confirm the last save. It is retried every minute.' }
        : syncStatus === 'syncing' ? { label: 'Saving…', tone: 'var(--color-qb-orange)', text: 'Writing your changes to the Sheet.' }
          : waiting.length ? { label: 'Changes waiting', tone: 'var(--color-qb-orange)', text: `${waiting.length} change${waiting.length === 1 ? '' : 's'} not yet in the Sheet; they go within seconds.` }
            : { label: 'All saved', tone: 'var(--color-qb-green)', text: 'Everything is in your Google Sheet.' };

  const connect = async () => {
    const url = dbInput.trim();
    if (!url) { setCheck({ tone: 'magenta', text: 'Paste the web app address first.' }); return; }
    setCheck(null);
    try {
      const response = await fetch(`${url}?action=version&t=${Date.now()}`);
      const text = (await response.text()).trim();
      if (/^<(!DOCTYPE|html)/i.test(text)) {
        setCheck({ tone: 'magenta', text: 'That address returned a web page, not the script. Use the Apps Script web app address (…/exec), not the Sheet’s own address, and deploy it with access set to Anyone.' });
        return;
      }
      let data: any;
      try { data = JSON.parse(text); } catch {
        setCheck({ tone: 'magenta', text: 'The script answered in a form PM Codex cannot read. Check that it is deployed with access set to Anyone.' });
        return;
      }
      if (data.version !== EXPECTED_GAS_VERSION) {
        setCheck({ tone: 'magenta', text: `The script is version ${data.version || 'unknown'}; PM Codex needs ${EXPECTED_GAS_VERSION}. Copy the script below into Apps Script and deploy it again.` });
        return;
      }
      setGasUrl(url);
      setCheck({ tone: 'green', text: 'Connected. PM Codex saves to this Sheet from now on.' });
    } catch {
      setCheck({ tone: 'magenta', text: 'No answer from that address. Check it is the web app address and that you are online.' });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="Saving" description="Every change is written to your own Google Sheet a few seconds after you make it. A save counts only when the Sheet confirms it.">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-1 w-2.5 h-2.5 shrink-0" style={{ background: state.tone }} />
            <div>
              <div className="text-sm font-black uppercase tracking-widest" style={{ color: state.tone }}>{state.label}</div>
              <div className="text-sm text-qb-dark-grey mt-0.5 max-w-xl">{state.text}</div>
              {lastSyncedAt && gasUrl && (
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-qb-grey mt-1">
                  Last saved {new Date(lastSyncedAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {syncHeldBack && (
              <button className={primaryButton} onClick={() => gasSyncService.confirmHeldSave()}>Save anyway</button>
            )}
            <button className={secondaryButton} disabled={!gasUrl} onClick={() => gasSyncService.retryNow()} title="Write everything to the Sheet now">
              <RefreshCcw className="w-3.5 h-3.5" /> Save now
            </button>
          </div>
        </div>

        <div className="mt-6 border-t border-qb-light-grey pt-4">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-[10px] font-black uppercase tracking-widest text-qb-grey hover:text-qb-black">
            {showHistory ? '▾' : '▸'} Save history · {jobs.length}{failed.length ? ` · ${failed.length} failed` : ''}
          </button>
          {showHistory && (
            <div className="mt-3">
              <div className="flex gap-2 mb-3">
                <button className={secondaryButton} disabled={!failed.length} onClick={() => retryFailed()}><RefreshCcw className="w-3.5 h-3.5" /> Retry failed</button>
                <button className={secondaryButton} disabled={!jobs.some((j) => j.status === 'COMPLETED')} onClick={() => clearCompleted()}><Trash2 className="w-3.5 h-3.5" /> Clear saved</button>
              </div>
              {jobs.length === 0 ? (
                <p className="text-sm text-qb-grey">Nothing recorded yet.</p>
              ) : (
                <div className="border border-qb-light-grey max-h-80 overflow-y-auto">
                  {[...jobs].reverse().slice(0, 200).map((job) => {
                    const tone = job.status === 'COMPLETED' ? 'var(--color-qb-green)' : job.status === 'FAILED' ? 'var(--color-qb-magenta)' : job.status === 'SYNCING' ? 'var(--color-qb-orange)' : 'var(--color-qb-grey)';
                    return (
                      <div key={job.id} className="flex items-center gap-4 px-3 py-2 border-b border-qb-light-grey last:border-b-0 text-xs">
                        <span className="font-mono text-[10px] text-qb-grey w-36 shrink-0">{new Date(job.timestamp).toLocaleString()}</span>
                        <span className="flex-1 min-w-0 text-qb-black truncate">
                          {STORE_LABEL[job.entityStore] || job.entityStore} · {ACTION_LABEL[job.actionType] || String(job.actionType).toLowerCase()}
                          {job.error && <span className="text-qb-magenta"> — {job.error}</span>}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 shrink-0" style={{ color: tone, background: tint(tone) }}>
                          {job.status === 'COMPLETED' ? 'Saved' : job.status === 'SYNCING' ? 'Saving' : job.status === 'FAILED' ? 'Failed' : 'Waiting'}
                        </span>
                        {job.status === 'FAILED' && (
                          <button onClick={() => retryFailed(job.id)} className="text-qb-grey hover:text-qb-orange" title="Retry"><RefreshCcw className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Connection" description="The Apps Script web app that reads and writes your Sheet.">
        <FieldLabel>Web app address</FieldLabel>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 flex items-center border border-qb-light-grey focus-within:border-qb-orange bg-white">
            <input
              type={showAddress ? 'text' : 'password'}
              value={dbInput}
              onChange={(e) => setDbInput(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-xs font-mono text-qb-black outline-none"
            />
            <button type="button" onClick={() => setShowAddress((v) => !v)} className="px-3 text-qb-grey hover:text-qb-black" title={showAddress ? 'Hide' : 'Show'}>
              {showAddress ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button className={primaryButton} onClick={connect}>Check & connect</button>
        </div>
        <p className="text-xs text-qb-grey mt-2">Keep this address private: anyone who has it can read your data.</p>
        {check && <p className={`text-xs font-bold mt-2 ${check.tone === 'green' ? 'text-qb-green' : 'text-qb-magenta'}`}>{check.text}</p>}

        <div className="border-t border-qb-light-grey mt-6 pt-5">
          <FieldLabel>Apps Script code</FieldLabel>
          <p className="text-sm text-qb-dark-grey mb-3 max-w-2xl">
            To set up a new Sheet or redeploy: copy the script, paste it into the Sheet’s Extensions → Apps Script, and deploy it as a web app with access set to Anyone.
          </p>
          <button
            className={secondaryButton}
            onClick={() => { navigator.clipboard.writeText(MOCK_GAS_SCRIPT); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          >
            {copied ? <><Check className="w-3.5 h-3.5 text-qb-green" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy the script (v{EXPECTED_GAS_VERSION})</>}
          </button>
        </div>
      </Section>
    </div>
  );
};

// ------------------------------------------------------------------ Gemini

const GeminiSection: React.FC = () => (
  <Section
    title="Gemini"
    description="Optional. A Gemini API key turns on the built-in Gemini assistant and recording analysis. Claude works without it."
  >
    <GeminiKeyForm />
  </Section>
);

// ------------------------------------------------------------ Risk matrix

const RiskSection: React.FC = () => {
  const { riskMatrixConfig, updateRiskMatrix } = useRisksStore();
  const [matrix, setMatrix] = useState<RiskMatrix>(() => JSON.parse(JSON.stringify(riskMatrixConfig)));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setMatrix(JSON.parse(JSON.stringify(riskMatrixConfig))); }, [riskMatrixConfig]);
  const dirty = useMemo(() => JSON.stringify(matrix) !== JSON.stringify(riskMatrixConfig), [matrix, riskMatrixConfig]);

  return (
    <Section
      title="Risk matrix"
      description="The risk value each impact and probability gives. Every risk is scored from this table, and the scores change as soon as you save."
      actions={<>
        <button className={secondaryButton} onClick={() => setMatrix(JSON.parse(JSON.stringify(DEFAULT_RISK_MATRIX)))}>
          <RotateCcw className="w-3.5 h-3.5" /> Default values
        </button>
        <button className={primaryButton} disabled={!dirty} onClick={() => { updateRiskMatrix(matrix); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
          {saved ? <><Check className="w-3.5 h-3.5" /> Saved</> : dirty ? 'Save matrix' : 'No changes'}
        </button>
      </>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-left text-[10px] font-black uppercase tracking-widest text-qb-grey">Impact ↓ · Probability →</th>
              {PROBABILITIES.map((p) => (
                <th key={p} className="p-2 text-center text-[10px] font-black uppercase tracking-widest text-qb-black">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IMPACT_LEVELS.map((impact) => (
              <tr key={impact} className="border-t border-qb-light-grey">
                <td className="p-2 pr-4 text-[11px] font-black uppercase tracking-wide text-qb-black whitespace-nowrap">{impact}</td>
                {PROBABILITIES.map((prob) => {
                  const value = (matrix[impact]?.[prob] || 'Medium') as RiskValue;
                  const color = RISK_VALUE_COLORS[value] || 'var(--color-qb-grey)';
                  const changed = riskMatrixConfig[impact]?.[prob] !== value;
                  return (
                    <td key={prob} className="p-1">
                      <select
                        value={value}
                        onChange={(e) => setMatrix((prev) => ({ ...prev, [impact]: { ...prev[impact], [prob]: e.target.value as RiskValue } }))}
                        className={`w-full px-0.5 py-2 text-[10px] font-black uppercase tracking-wide text-center cursor-pointer outline-none border ${changed ? 'border-qb-orange' : 'border-transparent'}`}
                        style={{ background: tint(color, value === 'Highest' ? 60 : 22), color: value === 'Highest' ? '#fff' : 'var(--color-qb-black)' }}
                        title={changed ? `Was ${riskMatrixConfig[impact]?.[prob]}` : undefined}
                      >
                        {RISK_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dirty && <p className="text-xs text-qb-orange font-bold mt-3">Cells outlined in orange are changed and not saved yet.</p>}
    </Section>
  );
};

// ----------------------------------------------------------------- Billing

const BillingSection: React.FC = () => {
  const { currency, setCurrency, isEnabled, setIsEnabled } = useBillingStore();
  return (
    <Section title="Billing" description="Milestones and invoices. When it is off, the Billing screen and its data are left out of the menu and out of what the assistants are sent.">
      <div className="flex flex-col gap-6 max-w-md">
        <div>
          <FieldLabel>Billing screen</FieldLabel>
          <div className="flex border border-qb-light-grey w-fit" role="group">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                type="button"
                onClick={() => setIsEnabled(on)}
                className={`px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-colors ${isEnabled === on ? 'bg-qb-black text-white' : 'text-qb-grey hover:text-qb-black'}`}
              >
                {on ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>Currency (ISO code)</FieldLabel>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="IDR"
            className="w-32 bg-white border border-qb-light-grey focus:border-qb-orange px-3 py-2.5 text-sm font-mono font-bold text-qb-black uppercase tracking-widest outline-none"
          />
          <p className="text-xs text-qb-grey mt-2">Three letters, for example IDR, USD, EUR. Used to format amounts.</p>
        </div>
      </div>
    </Section>
  );
};

// ------------------------------------------------------------------- page

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab') || 'db';
  const current: SectionId = (requested === 'sync' ? 'db' : requested) as SectionId;

  return (
    <div className="h-full flex flex-col font-sans p-4 sm:px-12 sm:pt-8 sm:pb-12 overflow-y-auto">
      <PageHeader title={<span className="flex items-center gap-3"><SettingsIcon className="w-6 h-6 text-qb-orange" />Settings</span>} />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8 flex-1 items-start">
        <nav className="flex flex-col gap-5 lg:sticky lg:top-0">
          {MENU.map((group) => (
            <div key={group.group}>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-qb-grey mb-1.5 px-3">{group.group}</div>
              <div className="flex flex-col">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = current === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSearchParams({ tab: item.id })}
                      className={`relative text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${active ? 'bg-qb-box-bg' : 'hover:bg-qb-box-bg/60'}`}
                    >
                      {active && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-qb-orange" />}
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-qb-orange' : 'text-qb-grey'}`} />
                      <span className="min-w-0">
                        <span className={`block text-[11px] font-black uppercase tracking-widest ${active ? 'text-qb-black' : 'text-qb-dark-grey'}`}>{item.label}</span>
                        <span className="block text-[11px] text-qb-grey leading-snug">{item.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0 pb-12">
          {current === 'db' && <SheetSection />}
          {current === 'risk' && <RiskSection />}
          {current === 'billing' && <BillingSection />}
          {current === 'gemini' && <GeminiSection />}
          {current === 'templates' && <PromptTemplatesTab />}
          {current === 'pii' && <PIIGlossary />}
          {current === 'ai' && <AIDebugPanel />}
        </div>
      </div>
    </div>
  );
}
