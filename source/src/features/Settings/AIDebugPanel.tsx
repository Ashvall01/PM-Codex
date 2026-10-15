import React from 'react';
import { useAppStore } from '../../store/appStore';
import { useBillingStore } from '../../store/billingStore';
import { useAiStore } from '../../store/aiStore';
import { useAIContextString } from '../../hooks/useAIContextString';
import { QUERY_TOOL_NAMES } from '../../components/layout/AISidebar';

/**
 * What Gemini is sent with every message: the standing instructions and the
 * project summary. Claude reads the same summary through the bridge
 * (start_session), without the chat-specific instructions. Read-only.
 */
export const AIDebugPanel: React.FC = () => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const activeSessionId = useAiStore(state => state.activeSessionId);
  const isBillingEnabled = useBillingStore(state => state.isEnabled);
  const systemContext = useAIContextString(activeProjectId || undefined, activeSessionId || undefined, isBillingEnabled);

  return (
    <section className="border border-qb-light-grey relative">
      <div className="absolute top-0 left-0 h-[3px] w-12 bg-qb-orange" />
      <header className="px-6 pt-6 pb-4 border-b border-qb-light-grey">
        <h2 className="text-base font-black uppercase tracking-widest text-qb-black">What Gemini sees</h2>
        <p className="text-sm text-qb-dark-grey mt-1 max-w-2xl leading-relaxed">
          Sent with every chat message: the standing instructions, then a summary of this project, with names already
          replaced by their privacy-glossary tokens. Claude reads the same project summary through the bridge.
          {' '}{systemContext.length.toLocaleString()} characters.
        </p>
      </header>
      <div className="p-6 flex flex-col gap-5">
        <textarea
          readOnly
          value={systemContext}
          className="w-full h-[520px] p-4 font-mono text-[11px] leading-relaxed bg-qb-black text-white border-none outline-none resize-y"
        />
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-qb-grey mb-2">Detail it can look up</div>
          <div className="flex flex-wrap gap-1.5">
            {QUERY_TOOL_NAMES.map((name) => (
              <span key={name} className="font-mono text-[11px] px-1.5 py-0.5 bg-qb-box-bg text-qb-black">{name}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
