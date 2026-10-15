import React, { useEffect } from 'react';
import { usePIIStore } from '../../store/piiStore';
import { useAppStore } from '../../store/appStore';

/**
 * Marks glossary names in the page's normal (not editable) text, with the CSS
 * Custom Highlight API (`::highlight(pii-highlight)` in index.css).
 *
 * Kept cheap because it reacts to changes anywhere on the page:
 *   - one regular expression for all names, built once per glossary change;
 *   - changes inside a text box or editor are ignored (this highlighter skips
 *     editable text anyway, so typing must not make it walk the whole page);
 *   - changes to the PII overlay itself are ignored;
 *   - bursts of changes are grouped into one pass (RESCAN_DELAY_MS).
 */
const RESCAN_DELAY_MS = 150;

const isIgnoredNode = (node: Node | null): boolean => {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement);
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.closest('[data-pii-overlay], input, textarea')) return true;
  return false;
};

export const PIIGlobalHighlighter: React.FC = () => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const entries = usePIIStore(state => state.entries);

  useEffect(() => {
    if (!activeProjectId) return;
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    // @ts-ignore
    const HighlightClass = window.Highlight;

    const terms = new Set<string>();
    for (const entry of entries) {
      if (entry.projectId !== activeProjectId) continue;
      for (const t of [entry.originalTerm, ...(entry.variations || [])]) {
        if (typeof t === 'string' && t.trim().length > 0) terms.add(t);
      }
    }
    if (terms.size === 0 || !HighlightClass) {
      // @ts-ignore
      CSS.highlights?.delete('pii-highlight');
      return;
    }

    // Longest first, so "Jane Doe" wins over "Jane".
    const pattern = [...terms]
      .sort((a, b) => b.length - a.length)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const regex = new RegExp('\\b(?:' + pattern + ')\\b', 'gi');

    let timer: any = null;

    const updateHighlights = () => {
      timer = null;
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (parent) {
            const tag = parent.tagName.toUpperCase();
            if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT'].includes(tag)) return NodeFilter.FILTER_REJECT;
            if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue;
        if (!text || text.length < 2) continue;
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          if (match[0].length === 0) { regex.lastIndex++; continue; }
          try {
            const range = new Range();
            range.setStart(node, match.index);
            range.setEnd(node, match.index + match[0].length);
            ranges.push(range);
          } catch {
            // the text changed while walking; the next pass catches it
          }
        }
      }

      if (ranges.length > 0) {
        // @ts-ignore
        CSS.highlights.set('pii-highlight', new HighlightClass(...ranges));
      } else {
        // @ts-ignore
        CSS.highlights.delete('pii-highlight');
      }
    };

    updateHighlights();

    const observer = new MutationObserver((mutations) => {
      if (mutations.every(m => isIgnoredNode(m.target))) return;
      if (!timer) timer = setTimeout(updateHighlights, RESCAN_DELAY_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      // @ts-ignore
      CSS.highlights?.delete('pii-highlight');
    };
  }, [activeProjectId, entries]);

  return null;
};
