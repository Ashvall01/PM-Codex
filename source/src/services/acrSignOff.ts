/**
 * Signing off part of a change request (22 Oct 2026).
 *
 * Until then a request was signed off whole: one SIGN OFF applied every ticked
 * line and threw the unticked ones away. The user wanted to approve what they
 * agree with and keep the rest open, to talk over with the assistant. So a
 * sign-off now names lines: those are applied (or rejected) and move to the
 * request's `decided` list, and every other line stays open. The request
 * closes when its last open line is decided.
 *
 * Every sign-off button goes through here — the review panel's footer, a
 * group's buttons, a single line's buttons, and the APPROVE / REJECT on
 * Gemini's card in the chat — so they cannot drift apart the way the three
 * executor copies once did.
 *
 * The executor runs against the request's own project, not the open one. A
 * request filed for another project (Claude can do that since 22 Oct 2026) is
 * applied where it belongs.
 */
import { useAcrStore, ACRChange } from '../store/acrStore';
import { useAppStore } from '../store/appStore';
import { applyProjectChange } from './acrExecutor';

export type AcrDecision = 'applied' | 'rejected';

export interface AcrSignOffResult {
  acrId: string;
  decision: AcrDecision;
  /** The lines this sign-off decided. */
  decidedLines: ACRChange[];
  /** Lines still open after it. */
  stillOpen: ACRChange[];
  /** True when nothing is left open, so the request is finished. */
  closed: boolean;
  /** Lines the executor threw on. They are still marked applied, as before. */
  failures: { change: ACRChange; error: string }[];
}

export function signOffAcrLines(acrId: string, changeIds: string[], decision: AcrDecision): AcrSignOffResult | null {
  const store = useAcrStore.getState();
  const acr = store.acrs.find((a) => a.id === acrId && a.status === 'pending');
  if (!acr) return null;

  const wanted = new Set(changeIds);
  // In the request's own order, so a page created by one line exists before
  // the line after it updates that page.
  const targets = acr.changes.filter((c) => wanted.has(c.id));
  if (!targets.length) return null;

  const projectId = acr.projectId || useAppStore.getState().activeProjectId || '';
  const failures: { change: ACRChange; error: string }[] = [];
  if (decision === 'applied') {
    for (const change of targets) {
      try {
        applyProjectChange(change.name, change.args, projectId);
      } catch (err: any) {
        console.error('Error executing action:', change.name, err);
        failures.push({ change, error: String(err?.message || err) });
      }
    }
  }

  const wasActive = store.activeAcrId === acrId;
  const decidedLines = store.decideAcrChanges(acrId, targets.map((c) => c.id), decision);
  const after = useAcrStore.getState().acrs.find((a) => a.id === acrId);
  const closed = !after || after.status !== 'pending';

  // setActiveAcrId(null) is where a sidebar opened only for this review is put
  // away again (acrStore.ts). Called only when the request is finished: while
  // lines stay open, the review stays where the user left it.
  if (closed && wasActive) useAcrStore.getState().setActiveAcrId(null);

  return {
    acrId,
    decision,
    decidedLines,
    stillOpen: after ? after.changes : [],
    closed,
    failures,
  };
}

/** Every open line of a request, for "approve all" / "reject all". */
export function openLineIds(acrId: string): string[] {
  const acr = useAcrStore.getState().acrs.find((a) => a.id === acrId);
  return acr && acr.status === 'pending' ? acr.changes.map((c) => c.id) : [];
}
