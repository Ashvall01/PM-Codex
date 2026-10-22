/**
 * Add, replace or remove the Gemini key. Used by the setup wizard and by
 * Settings → Gemini. PLAN.md section 22.4.
 *
 * The key lives in this component's state only while it is being typed; once
 * the server has it, the field is cleared. The page never holds a saved key.
 */
import React, { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, KeyRound, Trash2, ExternalLink } from 'lucide-react';
import { GeminiKeyStatus, getGeminiKeyStatus, removeGeminiKey, saveGeminiKey } from '../services/geminiKey';

const primaryButton = 'flex items-center justify-center gap-2 bg-qb-black hover:bg-qb-orange text-white px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-40 disabled:hover:bg-qb-black disabled:cursor-not-allowed';
const secondaryButton = 'flex items-center justify-center gap-2 border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-40';

export const GEMINI_KEY_PAGE = 'https://aistudio.google.com/apikey';

function describe(status: GeminiKeyStatus | null): { label: string; tone: string; text: string } {
  if (!status) return { label: 'Checking…', tone: 'var(--color-qb-grey)', text: '' };
  if (!status.configured) return { label: 'Not set', tone: 'var(--color-qb-grey)', text: 'Gemini features are off. Everything else, Claude included, works without a key.' };
  const where = status.source === 'pinokio' ? 'from Pinokio’s settings' : 'saved on this computer';
  return { label: 'Key set', tone: 'var(--color-qb-green)', text: `Key ending in …${status.last4}, ${where}. Gemini features are on.` };
}

export const GeminiKeyForm: React.FC<{ onStatus?: (s: GeminiKeyStatus) => void }> = ({ onStatus }) => {
  const [status, setStatus] = useState<GeminiKeyStatus | null>(null);
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [message, setMessage] = useState<{ tone: 'green' | 'magenta'; text: string } | null>(null);

  const apply = (s: GeminiKeyStatus) => { setStatus(s); onStatus?.(s); };

  useEffect(() => {
    let live = true;
    getGeminiKeyStatus()
      .then((s) => { if (live) apply(s); })
      .catch((e) => { if (live) setMessage({ tone: 'magenta', text: e.message }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!input.trim() || busy) return;
    setBusy('save'); setMessage(null);
    try {
      apply(await saveGeminiKey(input));
      setInput(''); setShow(false);
      setMessage({ tone: 'green', text: 'Google accepted the key. Gemini features are on — no restart needed.' });
    } catch (e: any) {
      setMessage({ tone: 'magenta', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy('remove'); setMessage(null);
    try {
      const s = await removeGeminiKey();
      apply(s);
      setMessage({ tone: 'green', text: s.configured ? 'Removed. The key in Pinokio’s settings is used instead.' : 'Removed. Gemini features are off.' });
    } catch (e: any) {
      setMessage({ tone: 'magenta', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const state = describe(status);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <KeyRound className="w-4 h-4 mt-0.5 shrink-0" style={{ color: state.tone }} />
        <div className="min-w-0">
          <div className="text-sm font-black uppercase tracking-widest" style={{ color: state.tone }}>{state.label}</div>
          {state.text && <p className="text-sm text-qb-dark-grey mt-0.5">{state.text}</p>}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2">
          {status?.configured ? 'Replace the key' : 'Gemini API key'}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 flex items-center border border-qb-light-grey focus-within:border-qb-orange bg-white">
            <input
              type={show ? 'text' : 'password'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              placeholder="Paste your key"
              name="pm-codex-gemini-key"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-xs font-mono text-qb-black outline-none"
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="px-3 text-qb-grey hover:text-qb-black" title={show ? 'Hide' : 'Show'}>
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button className={primaryButton} onClick={save} disabled={!input.trim() || busy !== null}>
            {busy === 'save' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</> : <><Check className="w-3.5 h-3.5" /> Check & save</>}
          </button>
          {status?.source === 'app' && (
            <button className={secondaryButton} onClick={remove} disabled={busy !== null} title="Remove the key saved in PM Codex">
              {busy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove
            </button>
          )}
        </div>
        <p className="text-xs text-qb-grey mt-2">
          Make one at{' '}
          <a href={GEMINI_KEY_PAGE} target="_blank" rel="noopener noreferrer" className="text-qb-dark-grey underline hover:text-qb-orange inline-flex items-center gap-1">
            aistudio.google.com/apikey <ExternalLink className="w-3 h-3" />
          </a>
          . The key is checked with Google, then kept on this computer only — never in this page, your Sheet or the repo.
        </p>
        {message && <p className={`text-xs font-bold mt-2 ${message.tone === 'green' ? 'text-qb-green' : 'text-qb-magenta'}`}>{message.text}</p>}
      </div>
    </div>
  );
};

export default GeminiKeyForm;
