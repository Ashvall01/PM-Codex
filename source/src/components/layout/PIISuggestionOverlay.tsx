import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePIIStore } from '../../store/piiStore';
import { useAppStore } from '../../store/appStore';
import { ShieldAlert } from 'lucide-react';
import { createPIIMatcher, PIIMatch, PIISuggestion } from '../../utils/piiMatcher';

/**
 * PII SUGGESTION OVERLAY — marks glossary names (and near misses) in the text
 * box the user is typing in, and says what each one will be masked as.
 *
 * How it stays fast and in place:
 *   - The text is checked when the user pauses typing (CHECK_DELAY_MS), not on
 *     every key press. See `utils/piiMatcher.ts` for the check itself.
 *   - In a rich-text editor (contentEditable) the browser paints the pink mark
 *     itself, with the CSS Custom Highlight API (`::highlight(pii-suggest)` in
 *     index.css). The mark is part of the text, so it scrolls with it and can
 *     never leave the box.
 *   - In a plain input or textarea the text has no DOM nodes to mark, so pink
 *     boxes are drawn on top. They are moved once per frame while anything
 *     scrolls, and cut to the part of the box you can see.
 */

const CHECK_DELAY_MS = 250;
const HIGHLIGHT_NAME = 'pii-suggest';

type Rect = { top: number; left: number; width: number; height: number };

interface Placed {
  key: number;
  suggestion: PIISuggestion;
  rect: Rect;       // where the match is
  paint?: Rect;     // pink box, cut to the visible area (plain inputs only)
}

const supportsHighlights = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (window as any).Highlight === 'function';

const isTextTarget = (el: HTMLElement | null): el is HTMLElement =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

/** The outermost contentEditable element, so a click inside a bold word still means "the editor". */
const editableRoot = (el: HTMLElement): HTMLElement => {
  if (!el.isContentEditable) return el;
  let root = el;
  while (root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
  return root;
};

const readText = (el: HTMLElement) =>
  el.isContentEditable ? el.textContent || '' : (el as HTMLInputElement).value || '';

const intersect = (a: Rect, b: Rect): Rect | null => {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return null;
  return { top, left, width: right - left, height: bottom - top };
};

/** The inside of an element's border (where its content and scrollbars live). */
const innerRect = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top + el.clientTop, left: r.left + el.clientLeft, width: el.clientWidth || r.width, height: el.clientHeight || r.height };
};

/** Ancestors that cut off what is inside them (scroll boxes, overflow hidden). */
const clippingAncestors = (el: HTMLElement): HTMLElement[] => {
  const out: HTMLElement[] = [];
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip|overlay)/.test(`${cs.overflow} ${cs.overflowX} ${cs.overflowY}`)) out.push(p);
    p = p.parentElement;
  }
  return out;
};

/** Ranges for each match in a contentEditable, following its text nodes like `textContent` does. */
const buildRanges = (root: HTMLElement, matches: PIIMatch[]): (Range | null)[] => {
  const nodes: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const len = n.nodeValue?.length || 0;
    nodes.push({ node: n as Text, start: pos, end: pos + len });
    pos += len;
  }
  const locate = (index: number, isEnd: boolean) => {
    for (const it of nodes) {
      if (isEnd ? index <= it.end && index > it.start : index >= it.start && index < it.end) {
        return { node: it.node, offset: index - it.start };
      }
    }
    return null;
  };
  return matches.map((m) => {
    const a = locate(m.index, false);
    const b = locate(m.index + m.length, true);
    if (!a || !b) return null;
    try {
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      return r;
    } catch {
      return null;
    }
  });
};

/** Where each match sits in a plain input or textarea, measured with one hidden copy of the box. */
const measureFieldRects = (target: HTMLElement, text: string, matches: PIIMatch[]): (Rect | null)[] => {
  const input = target as HTMLInputElement | HTMLTextAreaElement;
  const targetRect = target.getBoundingClientRect();
  const computed = window.getComputedStyle(target);
  const div = document.createElement('div');
  div.setAttribute('data-pii-overlay', '');
  Object.assign(div.style, { position: 'fixed', top: '-9999px', left: '-9999px', visibility: 'hidden', zIndex: '-9999' });
  const props = [
    'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily',
    'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing',
  ];
  props.forEach((p) => { (div.style as any)[p] = (computed as any)[p]; });
  if (target.tagName === 'TEXTAREA') {
    div.style.whiteSpace = 'pre-wrap';
    div.style.overflowWrap = 'break-word';
  } else {
    div.style.whiteSpace = 'pre';
  }

  const sorted = matches.map((m, i) => ({ m, i })).sort((a, b) => a.m.index - b.m.index);
  const spans: HTMLSpanElement[] = new Array(matches.length);
  let pos = 0;
  for (const { m, i } of sorted) {
    if (m.index > pos) div.appendChild(document.createTextNode(text.substring(pos, m.index)));
    const span = document.createElement('span');
    span.textContent = text.substring(m.index, m.index + m.length);
    div.appendChild(span);
    spans[i] = span;
    pos = m.index + m.length;
  }
  div.appendChild(document.createTextNode(text.substring(pos) || '​'));
  document.body.appendChild(div);

  const divRect = div.getBoundingClientRect();
  const rects = spans.map((span) => {
    if (!span) return null;
    const s = span.getBoundingClientRect();
    return {
      top: targetRect.top - input.scrollTop + (s.top - divRect.top),
      left: targetRect.left - input.scrollLeft + (s.left - divRect.left),
      width: s.width,
      height: s.height,
    };
  });
  document.body.removeChild(div);
  return rects;
};

export const PIISuggestionOverlay: React.FC = () => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const entries = usePIIStore(state => state.entries);

  const matcher = useMemo(
    () => createPIIMatcher(entries.filter(e => e.projectId === activeProjectId)),
    [entries, activeProjectId],
  );

  const [placed, setPlaced] = useState<Placed[]>([]);
  const [hoverKey, setHoverKey] = useState('');

  useEffect(() => {
    if (!activeProjectId || matcher.isEmpty) return;

    const useHighlight = supportsHighlights();
    let target: HTMLElement | null = null;
    let lastText = '';
    let matches: PIIMatch[] = [];
    let ranges: (Range | null)[] = [];
    let clippers: HTMLElement[] = [];
    let current: Placed[] = [];
    let checkTimer: any = null;
    let clearTimer: any = null;
    let layoutFrame = 0;
    let hoverFrame = 0;
    let mouse = { x: -9999, y: -9999 };
    let lastHover = '';

    const setHighlight = (rs: (Range | null)[]) => {
      if (!useHighlight) return;
      const live = rs.filter((r): r is Range => !!r);
      const HighlightClass = (window as any).Highlight;
      if (live.length) (CSS as any).highlights.set(HIGHLIGHT_NAME, new HighlightClass(...live));
      else (CSS as any).highlights.delete(HIGHLIGHT_NAME);
    };

    const updateHover = () => {
      hoverFrame = 0;
      // One flag pair per match: over the text, over the tip.
      const key = current.map((p) => {
        const r = p.rect;
        const onText = mouse.x >= r.left - 5 && mouse.x <= r.left + r.width + 5
          && mouse.y >= r.top - 5 && mouse.y <= r.top + r.height + 5;
        const onTip = mouse.x >= r.left - 10 && mouse.x <= r.left + 250
          && mouse.y >= r.top - 50 && mouse.y <= r.top - 10;
        return `${onText ? 1 : 0}${onTip ? 1 : 0}`;
      }).join('');
      if (key !== lastHover) { lastHover = key; setHoverKey(key); }
    };

    const layout = () => {
      layoutFrame = 0;
      if (!target || !target.isConnected || matches.length === 0) {
        if (current.length) { current = []; setPlaced([]); }
        return;
      }
      // The part of the page where this box's text can be seen.
      let visible: Rect | null = { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
      for (const el of [target, ...clippers]) {
        visible = visible && intersect(visible, innerRect(el));
        if (!visible) break;
      }

      const isEditable = target.isContentEditable;
      const rects: (Rect | null)[] = isEditable
        ? ranges.map((r) => {
            if (!r) return null;
            const b = r.getBoundingClientRect();
            return b.width || b.height ? { top: b.top, left: b.left, width: b.width, height: b.height } : null;
          })
        : measureFieldRects(target, lastText, matches);

      const next: Placed[] = [];
      rects.forEach((rect, i) => {
        if (!rect || !visible) return;
        const cut = intersect(rect, visible);
        if (!cut) return; // scrolled out of sight: no mark, no tip
        next.push({
          key: i,
          suggestion: matches[i].suggestion,
          rect,
          paint: isEditable && useHighlight ? undefined : cut,
        });
      });
      current = next;
      setPlaced(next);
      updateHover();
    };

    const scheduleLayout = () => {
      if (!layoutFrame) layoutFrame = requestAnimationFrame(layout);
    };

    const reset = () => {
      target = null;
      lastText = '';
      matches = [];
      ranges = [];
      setHighlight([]);
      if (current.length) { current = []; setPlaced([]); }
    };

    const check = (el: HTMLElement) => {
      checkTimer = null;
      if (!el.isConnected) { reset(); return; }
      const text = readText(el);
      if (el === target && text === lastText) { scheduleLayout(); return; }
      if (el !== target) clippers = clippingAncestors(el);
      target = el;
      lastText = text;
      matches = text ? matcher.findMatches(text) : [];
      ranges = el.isContentEditable ? buildRanges(el, matches) : [];
      setHighlight(ranges);
      scheduleLayout();
    };

    const onInput = (e: Event) => {
      const raw = e.target as HTMLElement;
      if (!isTextTarget(raw)) return;
      const el = editableRoot(raw);
      if (el === target && !el.isContentEditable && current.length) {
        // The old positions are wrong the moment a letter is added. Hide the
        // boxes until the next check. (In an editor the browser keeps the
        // marks on their words by itself, so they stay.)
        current = [];
        setPlaced([]);
      }
      if (checkTimer) clearTimeout(checkTimer);
      checkTimer = setTimeout(() => check(el), CHECK_DELAY_MS);
      if (el.isContentEditable) scheduleLayout();
    };

    const onFocusOrClick = (e: Event) => {
      const raw = e.target as HTMLElement;
      if (!isTextTarget(raw)) return;
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
      check(editableRoot(raw));
    };

    const onFocusOut = () => {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        clearTimer = null;
        if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
        reset();
      }, 200);
    };

    const onMouseMove = (e: MouseEvent) => {
      mouse = { x: e.clientX, y: e.clientY };
      if (current.length && !hoverFrame) hoverFrame = requestAnimationFrame(updateHover);
    };

    document.addEventListener('input', onInput, true);
    document.addEventListener('focusin', onFocusOrClick, true);
    document.addEventListener('click', onFocusOrClick, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('scroll', scheduleLayout, true);
    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // The box may already have focus when the glossary changes.
    const focused = document.activeElement as HTMLElement | null;
    if (isTextTarget(focused)) check(editableRoot(focused));

    return () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('focusin', onFocusOrClick, true);
      document.removeEventListener('click', onFocusOrClick, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('scroll', scheduleLayout, true);
      window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('mousemove', onMouseMove);
      if (checkTimer) clearTimeout(checkTimer);
      if (clearTimer) clearTimeout(clearTimer);
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      if (useHighlight) (CSS as any).highlights.delete(HIGHLIGHT_NAME);
      setPlaced([]);
    };
  }, [activeProjectId, matcher]);

  if (placed.length === 0 || !activeProjectId) return null;

  return (
    <div data-pii-overlay="" className="fixed inset-0 z-[99999] pointer-events-none">
      {placed.map((item, idx) => {
        const flags = hoverKey.slice(idx * 2, idx * 2 + 2);
        const isHoveringText = flags[0] === '1';
        const isHoveringTooltip = flags[1] === '1';
        const showItem = !item.suggestion.exact || isHoveringText;
        const opaque = showItem && !isHoveringTooltip;

        return (
          <React.Fragment key={item.key}>
            {item.paint && (
              <div
                className="absolute bg-qb-magenta opacity-20"
                style={{ top: item.paint.top, left: item.paint.left, width: item.paint.width, height: item.paint.height }}
              />
            )}
            <div
              className={`absolute bg-qb-black text-white px-3 py-1.5 text-xs font-bold tracking-widest uppercase flex items-center gap-2 shadow-lg duration-200 whitespace-nowrap transition-opacity ${opaque ? 'opacity-100' : 'opacity-0'}`}
              style={{ top: item.rect.top - 40, left: item.rect.left }}
            >
              <ShieldAlert className="w-4 h-4 text-qb-magenta" />
              {item.suggestion.exact ? (
                <span>Protected: {item.suggestion.suggestedOriginal} → {item.suggestion.suggestedToken}</span>
              ) : (
                <span>Did you mean <span className="text-qb-magenta">{item.suggestion.suggestedOriginal}</span>? It will be masked as {item.suggestion.suggestedToken}</span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
