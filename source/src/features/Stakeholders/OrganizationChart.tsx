/**
 * THE HIERARCHY — who reports to whom, in the organisation or in the project.
 *
 * Rebuilt 24 Sep 2026. The old chart opened at 100% on the middle of a very
 * wide canvas, ignored the scroll wheel unless Ctrl was held (while its own
 * hint said "Scroll to pan"), put every person without a manager in one long
 * top row, and spread a manager's direct reports sideways however many there
 * were. It was hard to find anyone in it.
 *
 * Now:
 *   - It opens fitted to the screen, and FIT brings that back.
 *   - Scrolling pans; pinch or Ctrl/⌘ + scroll zooms; drag pans too.
 *   - FIND jumps to a person, opening the branches above them.
 *   - Three or more direct reports with no reports of their own are stacked
 *     under their manager instead of spread in a row.
 *   - A branch folds away with the button under its manager.
 *   - Hovering (or opening) a person lights up their whole reporting line.
 *   - People with no manager and no reports wait in a tray below the chart.
 *
 * A person with two managers is drawn once, under one of them; the second line
 * is drawn dashed. Positions are measured from the page after it is laid out,
 * so the lines always meet the cards.
 */
import React, { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { Stakeholder } from '../../store/stakeholdersStore';
import { User, Search, Maximize2, Plus, Minus, ChevronDown, ChevronRight, Users } from 'lucide-react';

interface OrgChartProps {
  stakeholders: Stakeholder[];
  onNodeClick: (id: string) => void;
  activeId: string | null;
}

type Hierarchy = 'reportsToId' | 'projectReportsToId';
type Box = { left: number; top: number; width: number; height: number };

/** Direct reports stacked in a column from this many (all without reports of their own). */
const STACK_FROM = 3;
/** How far right of the manager's centre a stacked column starts. */
const STACK_INDENT = 20;
const CARD_WIDTH = 208;

function offsetWithin(element: HTMLElement, container: HTMLElement): Box {
  let top = 0;
  let left = 0;
  let current: HTMLElement | null = element;
  while (current && current !== container) {
    top += current.offsetTop;
    left += current.offsetLeft;
    current = current.offsetParent as HTMLElement | null;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

const listOf = (value: any): string[] => {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v);
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const v = JSON.parse(value); return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []; } catch { return []; }
  }
  return typeof value === 'string' && value ? [value] : [];
};

export const OrganizationChart: React.FC<OrgChartProps> = ({ stakeholders, onNodeClick, activeId }) => {
  const [hierarchy, setHierarchy] = useState<Hierarchy>('reportsToId');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [findText, setFindText] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [scalePct, setScalePct] = useState(100);
  const [positions, setPositions] = useState<Record<string, Box>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ReactZoomPanPinchRef | null>(null);

  const isOrg = hierarchy === 'reportsToId';
  const accent = isOrg ? 'var(--color-qb-cyan)' : 'var(--color-qb-orange)';

  // ------------------------------------------------------------ structure
  const byId = useMemo(() => new Map(stakeholders.map((s) => [s.id, s])), [stakeholders]);

  const parentsOf = useCallback((s: Stakeholder): string[] => {
    const many = isOrg ? (s as any).reportsToIds : (s as any).projectReportsToIds;
    const one = isOrg ? s.reportsToId : s.projectReportsToId;
    const ids = listOf(many).length ? listOf(many) : listOf(one);
    return Array.from(new Set(ids)).filter((id) => id !== s.id && byId.has(id));
  }, [isOrg, byId]);

  const { level, renderParent, childrenOf, allChildrenOf } = useMemo(() => {
    const level: Record<string, number> = {};
    const visiting = new Set<string>();
    const calc = (id: string): number => {
      if (level[id] !== undefined) return level[id];
      if (visiting.has(id)) return 0; // a loop: stop here
      visiting.add(id);
      const s = byId.get(id);
      const lvl = s ? Math.max(-1, ...parentsOf(s).map(calc)) + 1 : 0;
      visiting.delete(id);
      level[id] = lvl;
      return lvl;
    };
    stakeholders.forEach((s) => calc(s.id));

    // Each person is drawn once, under the manager one level up.
    const renderParent: Record<string, string> = {};
    const childrenOf: Record<string, string[]> = {};
    const allChildrenOf: Record<string, string[]> = {};
    stakeholders.forEach((s) => {
      const parents = parentsOf(s);
      parents.forEach((p) => { (allChildrenOf[p] = allChildrenOf[p] || []).push(s.id); });
      if (!parents.length) return;
      const pick = parents.find((p) => level[p] === level[s.id] - 1) || parents[0];
      renderParent[s.id] = pick;
      (childrenOf[pick] = childrenOf[pick] || []).push(s.id);
    });
    return { level, renderParent, childrenOf, allChildrenOf };
  }, [stakeholders, byId, parentsOf]);

  const unplaced = useMemo(
    () => stakeholders.filter((s) => !parentsOf(s).length && !(allChildrenOf[s.id] || []).length),
    [stakeholders, parentsOf, allChildrenOf],
  );
  const roots = useMemo(
    () => stakeholders.filter((s) => !renderParent[s.id] && (allChildrenOf[s.id] || []).length > 0),
    [stakeholders, renderParent, allChildrenOf],
  );

  /** Everyone above and below a person: their reporting line. */
  const lineOf = useCallback((id: string | null): Set<string> => {
    const out = new Set<string>();
    if (!id || !byId.has(id)) return out;
    const up = (x: string) => { if (out.has(x) && x !== id) return; out.add(x); const s = byId.get(x); if (s) parentsOf(s).forEach(up); };
    const down = (x: string) => { (allChildrenOf[x] || []).forEach((c) => { if (!out.has(c)) { out.add(c); down(c); } }); };
    up(id);
    down(id);
    return out;
  }, [byId, parentsOf, allChildrenOf]);

  const focusId = hoveredId || activeId;
  const lit = useMemo(() => lineOf(focusId), [lineOf, focusId]);
  const dimming = !!focusId && byId.has(focusId) && !unplaced.some((u) => u.id === focusId);

  // ------------------------------------------------------------- measuring
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const next: Record<string, Box> = {};
    container.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
      next[el.getAttribute('data-node-id')!] = offsetWithin(el, container);
    });
    setPositions(next);
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, stakeholders, hierarchy, collapsed]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    return () => ro.disconnect();
  }, [measure]);

  // ------------------------------------------------------------ view control
  const fit = useCallback((animate = 300) => {
    const zoom = zoomRef.current;
    const content = containerRef.current;
    const wrapper = zoom?.instance.wrapperComponent;
    if (!zoom || !content || !wrapper) return;
    const scale = Math.min(1, 0.94 * Math.min(wrapper.offsetWidth / content.offsetWidth, wrapper.offsetHeight / content.offsetHeight));
    zoom.zoomToElement(content, Math.max(0.2, scale), animate);
  }, []);

  // Opened, or switched to the other hierarchy: fit it to the screen.
  useEffect(() => {
    const t = setTimeout(() => fit(0), 60);
    return () => clearTimeout(t);
  }, [hierarchy, fit]);

  const showPerson = (id: string) => {
    // Open every folded branch above them, then centre on them.
    const above = new Set<string>();
    let cur = renderParent[id];
    while (cur && !above.has(cur)) { above.add(cur); cur = renderParent[cur]; }
    setCollapsed((prev) => { const next = new Set(prev); above.forEach((a) => next.delete(a)); return next; });
    setFindText('');
    setFindOpen(false);
    setFlashId(id);
    setTimeout(() => {
      const el = containerRef.current?.querySelector(`[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null;
      if (el) zoomRef.current?.zoomToElement(el, Math.max(0.9, zoomRef.current.instance.state.scale), 400);
    }, 80);
    setTimeout(() => setFlashId(null), 2200);
  };

  const findMatches = useMemo(() => {
    const q = findText.trim().toLowerCase();
    if (!q) return [];
    return stakeholders
      .filter((s) => [s.name, s.projectRole, s.role, s.orgRole, s.organization].some((f) => String(f || '').toLowerCase().includes(q)))
      .slice(0, 8);
  }, [findText, stakeholders]);

  // Plain scrolling pans (trackpad or wheel). Pinch arrives as Ctrl + wheel
  // and zooms, handled by the library.
  const onWheelCapture = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    const zoom = zoomRef.current;
    if (!zoom) return;
    e.stopPropagation();
    const { positionX, positionY, scale } = zoom.instance.state;
    zoom.setTransform(positionX - e.deltaX, positionY - e.deltaY, scale, 0);
  };

  const toggleBranch = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const hasBranches = roots.length > 0;
  const allFolded = hasBranches && Object.keys(childrenOf).every((id) => collapsed.has(id));

  // ------------------------------------------------------------------ cards
  const roleOf = (s: Stakeholder) => (isOrg ? (s.orgRole || s.projectRole || s.role) : (s.projectRole || s.role));

  const markClass = (s: any) =>
    s.isAcrProposedAdd ? 'border-[#51b53e] bg-[#51b53e]/10'
      : s.isAcrProposedUpdate ? 'border-[#ff7600] bg-[#ff7600]/10'
        : s.isAcrProposedDelete ? 'border-qb-magenta opacity-60 line-through'
          : '';

  const renderCard = (s: Stakeholder) => {
    const reports = (childrenOf[s.id] || []).length;
    const isActive = activeId === s.id;
    const isLit = lit.has(s.id);
    const isFolded = collapsed.has(s.id);
    return (
      <div
        data-node-id={s.id}
        onClick={() => onNodeClick(s.id)}
        onMouseEnter={() => setHoveredId(s.id)}
        onMouseLeave={() => setHoveredId(null)}
        style={{ width: CARD_WIDTH }}
        className={`group relative shrink-0 flex items-center gap-3 p-3 pl-4 cursor-pointer bg-white border transition-all duration-200 ${
          isActive ? 'border-qb-black shadow-[4px_4px_0_0_rgba(89,108,112,1)]' : isLit ? 'border-qb-black' : 'border-qb-light-grey hover:border-qb-black'
        } ${dimming && !isLit ? 'opacity-35' : ''} ${flashId === s.id ? 'ring-2 ring-qb-orange ring-offset-2 ring-offset-qb-bg' : ''} ${markClass(s)}`}
      >
        <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: isActive || isLit ? accent : 'var(--color-qb-light-grey)' }} />
        <div className="w-8 h-8 border border-qb-box-bg bg-qb-bg flex items-center justify-center shrink-0">
          <User className="w-4 h-4" style={{ color: isActive || isLit ? accent : 'var(--color-qb-grey)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-montserrat uppercase font-extrabold text-[11px] tracking-wider text-qb-black truncate" title={s.name}>{s.name || 'Unnamed'}</div>
          {roleOf(s) && <div className="text-[10px] text-qb-dark-grey truncate" title={roleOf(s)}>{roleOf(s)}</div>}
        </div>
        {reports > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleBranch(s.id); }}
            className="absolute left-1/2 -bottom-3 -translate-x-1/2 z-10 flex items-center gap-1 px-1.5 h-5 bg-qb-bg border border-qb-light-grey hover:border-qb-black text-[9px] font-mono font-bold text-qb-dark-grey"
            title={isFolded ? `Show ${reports} report${reports === 1 ? '' : 's'}` : 'Fold this branch'}
          >
            {isFolded ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{reports}
          </button>
        )}
      </div>
    );
  };

  const isStacked = (id: string) => {
    const kids = childrenOf[id] || [];
    return kids.length >= STACK_FROM && kids.every((k) => !(childrenOf[k] || []).length);
  };

  // A plain function, not a component: a component defined in here would be a
  // new type on every render, and every hover would rebuild the whole tree.
  const renderTree = (id: string): React.ReactNode => {
    const s = byId.get(id);
    if (!s) return null;
    const kids = collapsed.has(id) ? [] : (childrenOf[id] || []);
    const stacked = isStacked(id);
    return (
      <div key={id} className="flex flex-col items-center shrink-0">
        {renderCard(s)}
        {kids.length > 0 && (stacked ? (
          // A column under the manager, starting just right of its centre.
          <div className="flex flex-col gap-3 mt-9" style={{ paddingLeft: 2 * (STACK_INDENT + CARD_WIDTH / 2) }}>
            {kids.map((k) => <div key={k}>{renderCard(byId.get(k)!)}</div>)}
          </div>
        ) : (
          <div className="flex flex-row justify-center items-start gap-10 mt-16">
            {kids.map((k) => renderTree(k))}
          </div>
        ))}
      </div>
    );
  };

  // ------------------------------------------------------------------ lines
  const edges = useMemo(() => {
    const list: { id: string; d: string; lit: boolean; secondary: boolean }[] = [];
    stakeholders.forEach((child) => {
      const c = positions[child.id];
      if (!c) return;
      parentsOf(child).forEach((pid) => {
        const p = positions[pid];
        if (!p) return;
        const px = p.left + p.width / 2;
        const pBottom = p.top + p.height;
        const secondary = renderParent[child.id] !== pid;
        const isLit = lit.has(pid) && lit.has(child.id);
        let d: string;
        if (!secondary && isStacked(pid)) {
          const cy = c.top + c.height / 2;
          d = `M ${px} ${pBottom} L ${px} ${cy} L ${c.left} ${cy}`;
        } else {
          const cx = c.left + c.width / 2;
          const midY = pBottom + Math.max(16, (c.top - pBottom) / 2);
          d = `M ${px} ${pBottom} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${c.top}`;
        }
        list.push({ id: `${pid}>${child.id}`, d, lit: isLit, secondary });
      });
    });
    return list.sort((a, b) => Number(a.lit) - Number(b.lit));
  }, [stakeholders, positions, parentsOf, renderParent, lit, childrenOf]);

  if (stakeholders.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-qb-grey font-medium tracking-widest uppercase p-6">
        No stakeholders yet.
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col border border-qb-light-grey bg-qb-bg" style={{ height: 'max(560px, calc(100vh - 230px))' }}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-qb-light-grey bg-qb-box-bg/60 shrink-0">
        <div className="flex border border-qb-light-grey" role="group" aria-label="Which hierarchy">
          {([['reportsToId', 'Organisation'], ['projectReportsToId', 'Project']] as [Hierarchy, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setHierarchy(key); setCollapsed(new Set()); }}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-colors ${hierarchy === key ? 'bg-qb-black text-white' : 'text-qb-grey hover:text-qb-black'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <div className="flex items-center gap-2 bg-qb-bg border border-qb-light-grey focus-within:border-qb-orange px-2 py-1.5 w-56">
            <Search className="w-3.5 h-3.5 text-qb-grey shrink-0" />
            <input
              value={findText}
              onChange={(e) => { setFindText(e.target.value); setFindOpen(true); }}
              onFocus={() => setFindOpen(true)}
              onBlur={() => setTimeout(() => setFindOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && findMatches[0]) showPerson(findMatches[0].id);
                if (e.key === 'Escape') { setFindText(''); (e.target as HTMLInputElement).blur(); }
              }}
              placeholder="Find a person…"
              className="flex-1 min-w-0 bg-transparent outline-none text-xs font-bold text-qb-black placeholder:text-qb-grey placeholder:font-medium"
            />
          </div>
          {findOpen && findMatches.length > 0 && (
            <div className="absolute left-0 top-full mt-1 z-30 w-72 bg-qb-bg border border-qb-light-grey shadow-xl">
              {findMatches.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => showPerson(s.id)}
                  className="w-full text-left px-3 py-2 hover:bg-qb-box-bg border-b border-qb-box-bg last:border-b-0"
                >
                  <div className="text-[11px] font-black uppercase tracking-wider text-qb-black truncate">{s.name}</div>
                  <div className="text-[10px] text-qb-dark-grey truncate">
                    {roleOf(s) || '—'}{unplaced.some((u) => u.id === s.id) ? ' · not in this hierarchy' : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center border border-qb-light-grey divide-x divide-qb-light-grey ml-auto">
          <button type="button" onClick={() => zoomRef.current?.zoomOut(0.25)} className="px-2 py-1.5 hover:bg-qb-bg" title="Zoom out"><Minus className="w-3.5 h-3.5" /></button>
          <span className="px-2 py-1 font-mono text-[10px] font-bold text-qb-dark-grey w-12 text-center">{scalePct}%</span>
          <button type="button" onClick={() => zoomRef.current?.zoomIn(0.25)} className="px-2 py-1.5 hover:bg-qb-bg" title="Zoom in"><Plus className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => fit()} className="px-2.5 py-1.5 hover:bg-qb-bg flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" title="Fit the whole chart on screen">
            <Maximize2 className="w-3.5 h-3.5" /> Fit
          </button>
          {hasBranches && (
            <button
              type="button"
              onClick={() => { setCollapsed(allFolded ? new Set() : new Set(Object.keys(childrenOf))); setTimeout(() => fit(), 120); }}
              className="px-2.5 py-1.5 hover:bg-qb-bg text-[10px] font-black uppercase tracking-widest"
            >
              {allFolded ? 'Open all' : 'Fold all'}
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="relative flex-1 min-h-0" onWheelCapture={onWheelCapture}>
        <TransformWrapper
          ref={zoomRef}
          initialScale={1}
          minScale={0.2}
          maxScale={2.5}
          limitToBounds={false}
          centerOnInit
          wheel={{ step: 0.08, activationKeys: ['Control', 'Meta'] }}
          trackPadPanning={{ disabled: true }}
          doubleClick={{ disabled: true }}
          panning={{ velocityDisabled: true, excluded: ['input', 'button'] }}
          onTransform={(_, state) => setScalePct(Math.round(state.scale * 100))}
        >
          <TransformComponent wrapperClass="!w-full !h-full cursor-grab active:cursor-grabbing" contentClass="!w-max !h-max">
            <div
              ref={containerRef}
              className="relative p-16 flex flex-row items-start gap-16"
              style={{
                backgroundImage: 'radial-gradient(var(--color-qb-light-grey) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            >
              <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ zIndex: 0 }}>
                {edges.map((e) => (
                  <path
                    key={e.id}
                    d={e.d}
                    fill="none"
                    stroke={e.lit ? accent : 'var(--color-qb-grey)'}
                    strokeOpacity={e.lit ? 1 : dimming ? 0.15 : 0.45}
                    strokeWidth={e.lit ? 2 : 1}
                    strokeDasharray={e.secondary ? '4 4' : undefined}
                    className="transition-all duration-200"
                  />
                ))}
              </svg>
              <div className="relative z-10 flex flex-row items-start gap-16">
                {roots.length ? roots.map((r) => renderTree(r.id)) : (
                  <div className="text-qb-grey text-xs font-black uppercase tracking-widest py-16 px-8 max-w-sm text-center leading-relaxed">
                    Nobody reports to anybody here yet. Open a person and set whom they report to{isOrg ? ' in the organisation' : ' in the project'}.
                  </div>
                )}
              </div>
            </div>
          </TransformComponent>
        </TransformWrapper>

        <div className="absolute bottom-3 left-3 text-[9px] font-mono uppercase tracking-widest text-qb-grey bg-qb-bg/90 border border-qb-light-grey px-2 py-1 pointer-events-none">
          Scroll or drag to move · Pinch or Ctrl + scroll to zoom
        </div>
      </div>

      {/* People without a place in this hierarchy */}
      {unplaced.length > 0 && (
        <div className="shrink-0 border-t border-qb-light-grey px-4 py-3 flex flex-wrap items-center gap-2 max-h-32 overflow-y-auto">
          <span className="text-[10px] font-black uppercase tracking-widest text-qb-grey flex items-center gap-1.5 mr-1">
            <Users className="w-3.5 h-3.5" /> Not in this hierarchy · {unplaced.length}
          </span>
          {unplaced.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onNodeClick(s.id)}
              title={`${s.name}${roleOf(s) ? ` — ${roleOf(s)}` : ''}. Open to set whom they report to.`}
              className={`px-2 py-1 border text-[10px] font-bold uppercase tracking-wide text-qb-black hover:border-qb-black ${activeId === s.id ? 'ring-2 ring-qb-orange' : ''} ${markClass(s) || 'border-qb-light-grey bg-white'}`}
            >
              {s.name || 'Unnamed'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
