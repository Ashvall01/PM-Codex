// PM Codex showcase — the working demo.
//
// The module screens and their record trays are the app's own rendered markup,
// captured from a real build with the sample project (captures/*.html, inlined
// by build.mjs as <template id="tpl-…">). This file only moves between them the
// way the app does: routes, the review panel, trays, sign-off, the assistant.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tint = (c, p = 14) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const tpl = name => { const t = document.getElementById(`tpl-${name}`); return t ? t.innerHTML : ''; };
  const icon = name => tpl(`ico-${name}`);
  const C = {
    orange: 'var(--color-qb-orange)', magenta: 'var(--color-qb-magenta)', cyan: 'var(--color-qb-cyan)',
    green: 'var(--color-qb-green)', grey: 'var(--color-qb-grey)', dark: 'var(--color-qb-dark-grey)', light: 'var(--color-qb-light-grey)',
  };

  const app = $('#app');
  if (!app) return;
  const view = $('#view', app);
  const traySlot = $('#tray-slot', app);
  const aside = $('#ai-aside', app);

  // ------------------------------------------------------------ dates
  const TODAY = '2026-10-15';
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dayNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const daysFromToday = iso => dayNum(iso) - dayNum(TODAY);
  const longDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')} ${MON[m - 1]} ${y}`; };
  const dueTag = iso => {
    const n = daysFromToday(iso);
    if (n < 0) return { tag: `${-n}D LATE`, tone: 'magenta', state: 'late' };
    if (n === 0) return { tag: 'TODAY', tone: 'orange', state: 'soon' };
    if (n <= 7) return { tag: `IN ${n}D`, tone: 'orange', state: 'soon' };
    return { tag: '', tone: 'grey', state: 'later' };
  };
  const clock = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // ------------------------------------------------------------ the change requests
  const CHANGES = {
    c1: { acr: 'claude', kind: 'update', title: 'Move the mapping sign-off to 23 Oct', on: 'Collect sign-off on data mapping v2', action: 'update Task', summary: '2 fields change', route: 'tasks', tray: 't3' },
    c2: { acr: 'claude', kind: 'add', title: 'Add risk: test data not anonymised', action: 'add Project Risk', summary: '9 fields change', route: 'risks', tray: 'r6' },
    c3: { acr: 'claude', kind: 'comment', title: 'Note the extra review round on the mapping spec', action: 'add Deliverable Comment', summary: 'A new comment will be added', text: 'Steering 14 Oct: finance wants one more review round before sign-off.', route: 'deliverables', tray: 'd2' },
    c4: { acr: 'claude', kind: 'update', title: 'Extraction scripts: 45% to 55%', on: '2. Data migration', action: 'update Timeline Row', summary: '1 field change', route: 'timeline' },
    g1: { acr: 'gemini', kind: 'update', title: 'Flag: Collect sign-off on data mapping v2', on: 'Collect sign-off on data mapping v2', action: 'flag Task', summary: '1 field change', route: 'tasks', tray: 't3' },
  };
  const ACR_OF = { claude: ['c1', 'c2', 'c3', 'c4'], gemini: ['g1'] };
  const KIND = { add: ['Proposed new', 'text-[#51b53e]'], update: ['Proposed edit', 'text-[#ff7600]'], comment: ['Proposed comment', 'text-qb-cyan'] };
  const DEFAULT_EDITS = { 'Est. Resolution': '2026-10-23', Remarks: 'Finance asked for one more review round.' };

  const fresh = () => ({
    route: 'overview',
    chat: false, sidebarByAcr: false,
    review: null, reviewOnly: true, focus: null, attached: null,
    tray: null,
    status: { claude: 'pending', gemini: 'none' },
    ticks: { c1: true, c2: true, c3: true, c4: false, g1: true },
    applied: {},
    edits: { ...DEFAULT_EDITS },
    msgs: [], node: null, options: [], thinking: false, gcard: false, title: 'New Conversation', cat: 'All',
    pane: 'chat', seen: {},
  });
  let S = fresh();

  // ------------------------------------------------------------ toast
  let toastTimer;
  function toast(text = 'That works in the installed app. This demo covers the change request and the assistant.') {
    const t = $('#toast', app);
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  // ------------------------------------------------------------ which captured screen
  const reviewing = who => S.review === who && S.status[who] === 'pending';
  function viewName(route) {
    if (route === 'tasks') {
      if (reviewing('claude')) return 'tasks_p';
      if (reviewing('gemini')) return 'tasks_g';
      return S.applied.c1 ? (S.applied.g1 ? 'tasks_sf' : 'tasks_s') : (S.applied.g1 ? 'tasks_f' : 'tasks_b');
    }
    if (route === 'risks') return reviewing('claude') ? 'risks_p' : S.applied.c2 ? 'risks_s' : 'risks_b';
    if (route === 'deliverables') return reviewing('claude') ? 'deliverables_p' : S.applied.c3 ? 'deliverables_s' : 'deliverables_b';
    if (route === 'timeline') return reviewing('claude') ? 'timeline_p' : S.applied.c4 ? 'timeline_s' : 'timeline_b';
    return `${route}_b`;
  }
  function trayName(id) {
    if (id === 't3') {
      if (reviewing('claude')) return 'tray_t3_p';
      if (reviewing('gemini')) return 'tray_t3_g';
      return S.applied.c1 ? (S.applied.g1 ? 'tray_t3_sf' : 'tray_t3_s') : (S.applied.g1 ? 'tray_t3_f' : 'tray_t3_b');
    }
    if (id === 'r6') return reviewing('claude') ? 'tray_r6_p' : S.applied.c2 ? 'tray_r6_s' : null;
    if (id === 'd2') return reviewing('claude') ? 'tray_d2_p' : S.applied.c3 ? 'tray_d2_s' : 'tray_d2_b';
    return null;
  }
  // The proposed date and remarks, as edited in the tray, wherever the screen shows them.
  const signoffDate = () => (S.applied.c1 || reviewing('claude')) ? S.edits['Est. Resolution'] : '2026-10-16';

  // ------------------------------------------------------------ module screens
  const ROUTE_LABEL = { overview: 'Overview', timeline: 'Timeline', deliverables: 'Deliverables', tasks: 'Tasks & Issues', risks: 'Risks', mom: 'MoM', stakeholders: 'Stakeholders', documents: 'Documents', codex: 'Codex', billing: 'Billing' };

  function navigate(route, { tray = null } = {}) {
    S.route = route;
    closeTray(false);
    renderView();
    if (tray) openTray(tray);
  }

  function renderView() {
    view.innerHTML = S.route === 'overview' ? tpl('overview') : tpl(viewName(S.route));
    view.scrollTop = 0;
    if (S.route === 'overview') paintOverview();
    if (S.route === 'tasks') patchTaskRow();
    if (S.route === 'timeline') { ganttToToday(view); attachGantt(view); }
    $$('[data-open]', view).forEach(r => { r.setAttribute('tabindex', '0'); r.setAttribute('role', 'button'); r.dataset.h = `open:${r.dataset.open}`; });
    $$('[data-row]', view).forEach(r => r.setAttribute('tabindex', '-1'));
    $$('#app-nav [data-route]').forEach(b => {
      const on = b.dataset.route === S.route;
      b.classList.toggle('font-black', on); b.classList.toggle('text-qb-black', on);
      b.classList.toggle('font-normal', !on); b.classList.toggle('text-qb-grey', !on);
      b.querySelector('.nav-line')?.remove();
      if (on) b.insertAdjacentHTML('afterbegin', '<span class="nav-line absolute bottom-0 left-0 w-full h-[2px] bg-qb-orange"></span>');
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    $('#demo-url').textContent = `localhost:7800/${S.route === 'tasks' ? 'tasks-issues' : S.route}`;
    if (S.tray) shiftFor(S.tray, true);
  }

  function patchTaskRow() {
    const row = $('[data-open="t3"]', view);
    if (!row) return;
    const span = $$('span', row).find(s => s.classList.contains('whitespace-nowrap') && s.classList.contains('font-mono'));
    if (!span) return;
    const iso = signoffDate();
    const d = dueTag(iso);
    span.classList.remove('text-qb-orange', 'text-qb-magenta', 'text-qb-grey');
    span.classList.add(`text-qb-${d.tone}`);
    span.innerHTML = `${longDate(iso)}${d.tag ? `<span class="ml-1.5 font-black">· ${d.tag}</span>` : ''}`;
  }

  // ------------------------------------------------------------ the Gantt (GanttChart.tsx)
  // A captured chart is one frozen frame: its waves stand still, and bars that
  // were off screen at capture were never drawn (the app draws a bar's line when
  // it scrolls into view). These do the same work the app does, with its numbers.
  const WAVES_CONFIG = [
    { amp: 32, freq: 0.003, base: 50, speed: 0.8, phase: 0 },
    { amp: 42, freq: 0.002, base: 40, speed: 1.2, phase: 2 },
    { amp: 22, freq: 0.004, base: 60, speed: 0.5, phase: 4 },
    { amp: 36, freq: 0.0025, base: 45, speed: 1.0, phase: 1 },
  ];
  const TASK_WAVE_CONFIGS = [
    { interactAmp: 12, freq: 0.06, speed: 2.0 },
    { interactAmp: 18, freq: 0.04, speed: 1.5 },
    { interactAmp: 25, freq: 0.03, speed: 1.0 },
  ];
  const DAY_WIDTH = 12; // the app's DAY_WIDTH at 1.0x, as captured
  const LABEL_COLUMN = 180;
  const charts = new Set();
  const mouse = { x: -9999, y: -9999 };
  window.addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });

  const ganttScroller = root => {
    const label = $$('div', root).find(el => el.childElementCount === 0 && el.textContent.trim().toUpperCase() === 'PRESENT');
    let sc = label?.parentElement;
    while (sc && sc !== root && !/(auto|scroll)/.test(getComputedStyle(sc).overflowX)) sc = sc.parentElement;
    return { sc: sc && sc !== root ? sc : null, marker: label?.parentElement };
  };

  // Open on today, a third of the way across, and down to the first activity
  // with work left (scrollToToday in GanttChart.tsx).
  function ganttToToday(root) {
    const { sc, marker } = ganttScroller(root);
    if (!sc || !marker) return;
    const b = sc.getBoundingClientRect();
    const k = b.width / sc.offsetWidth || 1; // previews are drawn scaled
    const x = (marker.getBoundingClientRect().left - b.left) / k + sc.scrollLeft;
    sc.scrollLeft = Math.max(0, x - LABEL_COLUMN - (sc.clientWidth - LABEL_COLUMN) * 0.3);
    const group = sc.querySelector('[data-gantt-group="2. Design-2. Data mapping"]');
    if (group) sc.scrollTop = Math.max(0, (group.getBoundingClientRect().top - b.top) / k + sc.scrollTop - 48 - 40);
  }

  function restingLine(path, width) { path.setAttribute('d', `M 0 15 L ${width} 15`); }

  function attachGantt(root, { interactive = true } = {}) {
    const bg = $$('svg', root).find(svg => (svg.getAttribute('viewBox') || '') === '0 0 1000 100');
    const { sc } = ganttScroller(root);
    if (!bg || !sc) return;
    const tasks = $$('svg', root).filter(svg => (svg.getAttribute('style') || '').includes('top: -14px')).map(svg => {
      const width = parseFloat(svg.style.width) || 0;
      const paths = $$('path', svg);
      paths.forEach(path => restingLine(path, width));
      return { svg, paths, width, t: Math.random() * 100, live: false };
    });
    const chart = { root, sc, bgPaths: $$('path', bg), tasks, interactive, time: 0, last: 0, lastScroll: sc.scrollLeft, smoothed: 0, offset: 0, visible: true };
    const io = new IntersectionObserver(([e]) => { chart.visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(root);
    chart.io = io;
    charts.add(chart);
    if (!loopRunning) { loopRunning = true; requestAnimationFrame(loop); }
  }

  function drawTaskWave(tw, chart) {
    const { width } = tw;
    const scaleRange = 4 * DAY_WIDTH;
    const mult = Math.max(0, Math.min(1, (width - DAY_WIDTH) / scaleRange));
    const r = tw.svg.getBoundingClientRect();
    const near = chart.interactive && mult > 0 && mouse.x >= r.left - 150 && mouse.x <= r.right + 150 && Math.abs(r.top + 15 - mouse.y) < 150;
    if (!near) { if (tw.live) { tw.paths.forEach(p => restingLine(p, width)); tw.live = false; } return; }
    tw.live = true;
    tw.t += 0.05;
    const step = Math.max(12, Math.min(24, width / 15));
    const sx = r.width / width || 1; // the chart may be scaled (module previews)
    tw.paths.forEach((path, i) => {
      const c = TASK_WAVE_CONFIGS[i];
      if (!c) return;
      let d = 'M 0 15';
      for (let x = 0; x <= width; x += step) {
        const taper = Math.sin((x / width) * Math.PI);
        const dist = Math.hypot(r.left + x * sx - mouse.x, r.top + 15 - mouse.y);
        const amp = (dist < 150 ? ((150 - dist) / 150) * c.interactAmp : 0) * taper * mult;
        d += ` L ${x} ${15 + Math.sin(x * c.freq - tw.t * c.speed) * amp}`;
      }
      path.setAttribute('d', `${d} L ${width} 15`);
    });
  }

  let loopRunning = false;
  function loop(now) {
    requestAnimationFrame(loop);
    charts.forEach(ch => {
      if (!ch.root.isConnected) { ch.io.disconnect(); charts.delete(ch); return; }
      if (!ch.visible) return;
      // The background waves: 12 redraws a second at rest, 30 while scrolling.
      const scrolling = Math.abs(ch.smoothed) > 0.05 || ch.sc.scrollLeft !== ch.lastScroll;
      const interval = scrolling ? 1000 / 30 : 1000 / 12;
      if (!ch.last || now - ch.last >= interval) {
        const frames = ch.last ? Math.min(8, (now - ch.last) / (1000 / 30)) : 1;
        ch.last = now;
        ch.time += 0.004 * frames;
        const delta = ch.sc.scrollLeft - ch.lastScroll;
        ch.lastScroll = ch.sc.scrollLeft;
        ch.smoothed += (delta - ch.smoothed) * 0.08;
        ch.offset += ch.smoothed * 0.015;
        const total = ch.time + ch.offset;
        ch.bgPaths.forEach((path, i) => {
          const w = WAVES_CONFIG[i];
          if (!w) return;
          let d = `M 0 ${w.base}`;
          for (let x = 0; x <= 1000; x += 40) d += ` L ${x} ${w.base + Math.sin(x * w.freq + total * w.speed + w.phase) * w.amp}`;
          path.setAttribute('d', d);
        });
      }
      if (ch.interactive) ch.tasks.forEach(tw => drawTaskWave(tw, ch));
    });
  }
  // The module previews on the page use the same chart.
  window.PMCGantt = { prepare(root) { ganttToToday(root); attachGantt(root, { interactive: false }); } };
  $$('.mod-thumb').forEach(t => { if (t.firstElementChild) window.PMCGantt.prepare(t); });

  // ------------------------------------------------------------ Overview (live numbers)
  const KIND_COLOR = { TASK: C.dark, ISSUE: C.magenta, DELIVERABLE: C.cyan, ACTIVITY: C.orange, RISK: C.magenta, ACTION: C.green };
  const HEAT_IMPACTS = ['Catastrophic', 'Critical', 'High', 'Moderate', 'Low'];
  const HEAT_PROBS = ['Rare', 'Low', 'Moderate', 'High', 'Almost Certain'];
  const MATRIX = {
    Catastrophic: ['High', 'High', 'Highest', 'Highest', 'Highest'],
    Critical: ['Medium', 'High', 'High', 'Highest', 'Highest'],
    High: ['Low', 'Medium', 'High', 'High', 'Highest'],
    Moderate: ['Lowest', 'Low', 'Medium', 'Medium', 'High'],
    Low: ['Lowest', 'Lowest', 'Low', 'Low', 'Medium'],
  };
  const VALUE_COLOR = { Lowest: C.light, Low: C.green, Medium: C.orange, High: C.magenta, Highest: C.magenta };

  // The captured Overview is the real screen; the demo re-reads its lists and
  // re-applies what was signed off, so every count and row follows the app's rules.
  const SIGNOFF = 'Collect sign-off on data mapping v2';
  const NEW_RISK = "Test data not anonymised before UAT. If it isn't, UAT waits for a clean extract.";
  const goFor = (kind, title) => {
    if (title === SIGNOFF) return ['tasks', 't3'];
    if (title === 'Data mapping specification') return ['deliverables', 'd2'];
    if (title === NEW_RISK) return ['risks', 'r6'];
    return { TASK: ['tasks'], ISSUE: ['tasks'], DELIVERABLE: ['deliverables'], ACTIVITY: ['timeline'], RISK: ['risks'], ACTION: ['mom'] }[kind] || ['overview'];
  };
  const tagDays = tag => {
    let m = tag.match(/^(\d+)D LATE$/); if (m) return -Number(m[1]);
    m = tag.match(/^IN (\d+)D$/); if (m) return Number(m[1]);
    return tag === 'TODAY' ? 0 : null;
  };

  function overviewModel() {
    const rows = [...$('[data-hook="items"]', view).children].map(b => {
      const sp = [...b.children].filter(c => c.tagName === 'SPAN');
      const [kind, title, owner, tag] = sp.map(x => x.textContent.trim());
      return { kind, title, owner, tag, tone: sp[3]?.classList.contains('text-qb-magenta') ? 'magenta' : 'orange' };
    }).filter(r => r.title !== SIGNOFF);
    const late = rows.filter(r => /LATE$/.test(r.tag));
    const blocked = rows.filter(r => r.tag === 'BLOCKED');
    const risks = rows.filter(r => r.kind === 'RISK' && !late.includes(r));
    const soon = rows.filter(r => !late.includes(r) && !blocked.includes(r) && !risks.includes(r));
    // The sign-off task, at whatever date the proposal (or the user's edit) gives it.
    const d = dueTag(signoffDate());
    const signoff = { kind: 'TASK', title: SIGNOFF, owner: 'Priya', tag: d.tag, tone: d.tone };
    if (d.state === 'late') late.push(signoff); else if (d.state === 'soon') soon.push(signoff);
    late.sort((x, y) => tagDays(x.tag) - tagDays(y.tag));
    soon.sort((x, y) => tagDays(x.tag) - tagDays(y.tag));
    if (S.applied.c2) risks.unshift({ kind: 'RISK', title: NEW_RISK, owner: 'Rafi', tag: 'HIGH', tone: 'magenta', fresh: !S.seen.risk });
    return { items: [...late, ...blocked, ...risks, ...soon], late: late.length, soon: soon.length };
  }

  function stripModel() {
    const days = [...$('[data-hook="strip"]', view).children].map((cell, n) => {
      const iso = new Date(Date.UTC(2026, 9, 15 + n)).toISOString().slice(0, 10);
      const due = (cell.getAttribute('title') || '').split('\n')
        .map(l => l.match(/^(TASK|ISSUE|DELIVERABLE|ACTIVITY|ACTION|RISK): (.*)$/)).filter(Boolean)
        .map(m => ({ kind: m[1], title: m[2] }))
        .filter(x => !(x.kind === 'TASK' && x.title === SIGNOFF));
      return { iso, due };
    });
    const day = days.find(x => x.iso === signoffDate());
    if (day) day.due.unshift({ kind: 'TASK', title: SIGNOFF });
    return days;
  }

  function paintOverview() {
    // Schedule tile and Build row: the captured screen, or the one captured
    // after the migration line was signed off.
    if (S.applied.c4) {
      const alt = document.createElement('div');
      alt.innerHTML = tpl('overview_s4');
      ['[data-kpi="schedule"]', '[data-phase="build"]'].forEach(sel => { const a = $(sel, alt), b = $(sel, view); if (a && b) b.replaceWith(a); });
    }
    const ov = overviewModel();
    $('[data-kpi="late"] [data-v="value"]', view).textContent = ov.late;
    $('[data-kpi="soon"] [data-v="value"]', view).textContent = ov.soon;
    const high = $('[data-kpi="high"] [data-v="value"]', view);
    high.textContent = Number(high.textContent) + (S.applied.c2 ? 1 : 0);

    const arrow = icon('arrow');
    $('[data-hook="items"]', view).innerHTML = ov.items.map(it => {
      const c = KIND_COLOR[it.kind];
      return `<button type="button" data-h="item:${goFor(it.kind, it.title).join(':')}" class="group flex items-center gap-3 py-2.5 px-3 border-b border-qb-light-grey text-left hover:bg-black/5 transition-colors${it.fresh ? ' landed' : ''}"><span class="w-[86px] shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 text-center" style="color: ${c}; background-color: ${tint(c, 12)};">${it.kind}</span><span class="flex-1 min-w-0 truncate text-sm font-medium text-qb-dark-grey group-hover:text-qb-black">${esc(it.title)}</span><span class="hidden @min-[768px]/app:inline text-[10px] font-bold font-mono uppercase tracking-wider text-qb-dark-grey bg-black/5 px-2 py-0.5 border border-qb-light-grey max-w-[110px] truncate shrink-0">${esc(it.owner)}</span><span class="w-[118px] shrink-0 text-right text-[10px] font-black font-mono uppercase tracking-wider ${it.tone === 'magenta' ? 'text-qb-magenta' : 'text-qb-orange'}">${it.tag}</span>${arrow}</button>`;
    }).join('');
    $('[data-hook="items-count"]', view).textContent = `[${ov.items.length}]`;

    // the next fourteen days
    $('[data-hook="strip"]', view).innerHTML = stripModel().map(({ iso, due }, n) => {
      const wd = new Date(`${iso}T00:00:00Z`).getUTCDay(), weekend = wd === 0 || wd === 6;
      const title = due.length ? due.map(x => `${x.kind}: ${x.title}`).join('\n') : longDate(iso);
      const moved = S.applied.c1 && due.some(x => x.title === SIGNOFF) && iso !== '2026-10-16';
      return `<div class="relative flex flex-col items-center gap-1 pt-1.5 pb-2 min-h-[92px] ${n > 0 ? 'border-l border-qb-light-grey' : ''} ${weekend ? 'bg-black/[0.04]' : ''} ${n === 0 ? 'bg-qb-orange/10' : ''}${moved && !S.seen.signoff ? ' landed' : ''}" title="${esc(title)}"><span class="text-[9px] font-black uppercase tracking-widest ${n === 0 ? 'text-qb-orange' : 'text-qb-grey'}">${'SMTWTFS'[wd]}</span><span class="text-[11px] font-mono font-bold ${n === 0 ? 'text-qb-orange' : 'text-qb-dark-grey'}">${Number(iso.slice(8))}</span><div class="flex flex-col items-center gap-[3px] mt-0.5">${due.slice(0, 5).map(x => `<span class="w-2 h-2" style="background: ${KIND_COLOR[x.kind]};"></span>`).join('')}${due.length > 5 ? `<span class="text-[9px] font-black text-qb-grey">+${due.length - 5}</span>` : ''}</div></div>`;
    }).join('');

    // the risk heat map
    const heat = { 'Critical|Low': 1, 'Critical|Moderate': 1, 'High|High': 1, 'Moderate|Moderate': 1 };
    if (S.applied.c2) heat['High|Moderate'] = 1;
    const rows = HEAT_IMPACTS.map(i => `<span class="flex items-center justify-end text-[9px] font-black uppercase tracking-widest text-qb-grey" style="height: 36px;">${i}</span>`).join('');
    const cells = HEAT_IMPACTS.map(impact => HEAT_PROBS.map((prob, pi) => {
      const value = MATRIX[impact][pi], k = `${impact}|${prob}`, n = heat[k] || 0;
      const bg = tint(VALUE_COLOR[value], n ? (value === 'Highest' ? 70 : 38) : 10);
      return `<button type="button" disabled title="${impact} impact · ${prob} probability · ${value}${n ? ` · ${n} open` : ''}" class="flex items-center justify-center transition-shadow cursor-default ${S.applied.c2 && !S.seen.risk && k === 'High|Moderate' ? 'landed' : ''}" style="height: 36px; background: ${bg};">${n ? `<span class="text-sm font-mono font-black ${value === 'Highest' ? 'text-white' : 'text-qb-black'}">${n}</span>` : ''}</button>`;
    }).join('')).join('');
    const probs = HEAT_PROBS.map(p => `<span class="text-center text-[9px] font-black uppercase tracking-widest text-qb-grey leading-tight">${p}</span>`).join('');
    $('[data-hook="heat"]', view).innerHTML = `<div class="flex"><div class="flex flex-col justify-between pr-2 py-0.5">${rows}</div><div class="flex-1"><div class="grid gap-[2px]" style="grid-template-columns: repeat(5, minmax(0px, 1fr));">${cells}</div><div class="grid mt-1" style="grid-template-columns: repeat(5, minmax(0px, 1fr));">${probs}</div></div></div>`;

    if (S.applied.c2) S.seen.risk = true;
    if (S.applied.c1) S.seen.signoff = true;
  }

  // ------------------------------------------------------------ record trays
  function shiftFor(id, on) {
    const el = $('[data-shift]', view);
    if (!el) return;
    el.classList.remove('@min-[1024px]/app:mr-[600px]', '@min-[1024px]/app:mr-[500px]');
    if (on) el.classList.add(id === 'd2' ? '@min-[1024px]/app:mr-[500px]' : '@min-[1024px]/app:mr-[600px]');
  }

  function openTray(id, animate = true) {
    const name = trayName(id);
    if (!name) { toast('This record only exists once the change request is signed off.'); return; }
    S.tray = id;
    traySlot.innerHTML = tpl(name);
    const el = traySlot.firstElementChild;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Record details');
    const close = $$('header button', el).pop();
    if (close) { close.dataset.h = 'tray-close'; close.setAttribute('aria-label', 'Close'); }
    patchTray(el);
    shiftFor(id, true);
    if (animate && !RM) {
      el.classList.add('translate-x-full');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('translate-x-full')));
    }
  }
  function closeTray(animate = true) {
    const el = traySlot.firstElementChild;
    S.tray = null;
    shiftFor(null, false);
    if (!el) return;
    if (animate && !RM) { el.classList.add('translate-x-full'); setTimeout(() => { if (!S.tray) traySlot.innerHTML = ''; }, 450); }
    else traySlot.innerHTML = '';
  }

  // Replace a text node's value wherever it appears exactly.
  function replaceText(root, from, to) {
    if (from === to) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (n.nodeValue.trim() === from) n.nodeValue = n.nodeValue.replace(from, to);
  }

  function patchTray(el) {
    if (S.tray !== 't3') return;
    const name = trayName('t3');
    if (name === 'tray_t3_p' || name.startsWith('tray_t3_s')) {
      replaceText(el, longDate(DEFAULT_EDITS['Est. Resolution']), longDate(S.edits['Est. Resolution']));
      replaceText(el, DEFAULT_EDITS.Remarks, S.edits.Remarks);
    }
    if (name !== 'tray_t3_p') return;
    // The proposed fields: click to edit the proposal, as in the app.
    $$('span', el).filter(s => s.textContent.trim() === 'Click to edit the proposed value').forEach(hint => {
      const box = hint.closest('.cursor-pointer');
      const label = box?.parentElement?.querySelector('label')?.textContent.trim();
      if (!box || !(label in DEFAULT_EDITS)) return;
      box.dataset.h = `edit:${label}`;
      box.setAttribute('tabindex', '0');
      box.setAttribute('role', 'button');
    });
  }

  function startEdit(label, box) {
    const isDate = label === 'Est. Resolution';
    const value = S.edits[label];
    const input = isDate
      ? `<input data-edit-input class="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-2 focus:ring-qb-orange font-mono uppercase tracking-wide" type="date" value="${esc(value)}" min="2026-10-01" max="2026-12-31">`
      : `<textarea data-edit-input rows="3" class="w-full bg-qb-box-bg border-none p-3 text-sm font-bold text-qb-black outline-none focus:ring-2 focus:ring-qb-orange">${esc(value)}</textarea>`;
    box.outerHTML = `<div class="flex flex-col gap-2 animate-fade-in" data-editing="${esc(label)}">${input}<div class="flex items-center gap-2 mt-1"><button type="button" data-h="edit-save" class="flex items-center gap-1 bg-qb-black text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 hover:bg-qb-orange transition-colors">${icon('check')} Save</button><button type="button" data-h="edit-cancel" class="flex items-center gap-1 bg-transparent text-qb-grey text-[10px] font-black uppercase tracking-widest px-3 py-1.5 hover:text-qb-black border border-qb-light-grey transition-colors">${icon('x')} Cancel</button></div></div>`;
    $('[data-edit-input]', traySlot)?.focus();
  }
  function endEdit(save) {
    const wrap = $('[data-editing]', traySlot);
    if (!wrap) return;
    const label = wrap.dataset.editing;
    const v = $('[data-edit-input]', wrap).value.trim();
    if (save && v) S.edits[label] = v;
    const sc = traySlot.firstElementChild?.querySelector('.overflow-y-auto');
    const top = sc ? sc.scrollTop : 0;
    openTray('t3', false);
    const sc2 = traySlot.firstElementChild?.querySelector('.overflow-y-auto');
    if (sc2) sc2.scrollTop = top;
    if (S.route === 'tasks') patchTaskRow();
    if (save) toast('Saved to the proposal, not the record. Sign off to apply it.');
  }

  // ------------------------------------------------------------ assistant pane + review panel
  // The real avatar (avatar.js) is mounted into this slot after each render; the
  // diamond inside is only the no-WebGL fallback.
  const avatarState = () => (S.thinking ? 'thinking' : S.speaking ? 'responding' : 'idle');
  const AVATAR = () => `<div data-avatar="sidebar" class="ai-avatar relative bg-radial-[circle_at_center,_#0a1520_0%,_#000000_70%] border border-[#00e5ff]/20 rounded-sm overflow-hidden select-none outline-none w-11 h-11 shrink-0" aria-hidden="true"><span class="ai-core"></span></div>`;

  function renderAside() {
    const open = S.chat || !!S.review;
    let chatShown = S.chat && !(S.review && S.reviewOnly);
    // A phone has room for one pane: the one asked for last.
    const narrow = app.clientWidth < 640;
    const reviewShown = !!S.review && !(narrow && chatShown && S.pane === 'chat');
    if (narrow && chatShown && reviewShown) chatShown = false;
    const width = S.review ? (chatShown ? 384 + 360 : 420) : 384;
    aside.style.setProperty('--sidebar-width', `${width}px`);
    aside.className = `flex-shrink-0 absolute @min-[1024px]/app:relative left-0 h-full z-40 overflow-hidden bg-qb-bg shadow-2xl @min-[1024px]/app:shadow-none transition-[width,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? 'w-full @min-[640px]/app:w-[var(--sidebar-width)] border-r border-qb-light-grey translate-x-0' : 'w-full @min-[640px]/app:w-0 -translate-x-full @min-[1024px]/app:translate-x-0 border-transparent @min-[1024px]/app:border-r-0'}`;
    if (open) aside.removeAttribute('inert'); else aside.setAttribute('inert', '');
    $('#ai-toggle', app).classList.toggle('text-qb-orange', open);
    $('#ai-toggle', app).classList.toggle('text-qb-grey', !open);
    $('#ai-toggle', app).setAttribute('aria-expanded', String(open));
    const inner = $('#ai-inner', aside);
    inner.innerHTML = `<div class="w-full min-w-0 flex h-full bg-qb-bg relative">${chatShown ? chatPane() : ''}${reviewShown ? reviewPane(chatShown) : ''}</div>`;
    const slot = $('[data-avatar="sidebar"]', inner);
    if (slot && window.PMCAvatar) window.PMCAvatar.mount(slot, 'sidebar', avatarState());
    const msgs = $('#ai-msgs', inner);
    if (msgs && S.msgs.length) msgs.scrollTop = msgs.scrollHeight;
  }

  function chatPane() {
    return `<div class="flex flex-col h-full bg-qb-bg flex-1 min-w-0 p-0 relative border-r border-[#d1d5db] last:border-r-0">
      <div class="sidebar-content flex flex-row items-center px-6 border-b border-[#d1d5db] shrink-0 bg-qb-bg relative z-20 py-3 gap-4">${AVATAR()}
        <div class="flex flex-col flex-1 min-w-0 justify-center gap-1.5">
          <div class="flex items-center justify-between"><div class="flex items-center text-qb-black font-black uppercase tracking-widest text-sm"><span>Assistant</span></div><button type="button" data-h="ai-close" aria-label="Close the assistant" class="@min-[1024px]/app:hidden p-1.5 hover:bg-qb-light-grey/30 text-qb-grey hover:text-qb-black transition-colors -mr-2 shadow-none">${icon('x5')}</button></div>
          <div class="relative w-full"><div class="flex items-center justify-between group"><span class="text-[10px] font-black text-qb-grey uppercase tracking-widest flex items-center gap-1.5 truncate pr-2">${icon('msg3')}${esc(S.title)}</span><div class="flex items-center gap-1 shrink-0"><button type="button" data-h="ai-new" class="p-1 text-qb-grey hover:text-qb-black transition-colors bg-transparent border-none" title="New Session" aria-label="New conversation">${icon('plus35')}</button></div></div></div>
        </div></div>
      <div id="ai-msgs" class="flex-1 overflow-y-auto p-6 flex flex-col gap-6" aria-live="polite">${S.msgs.length ? messagesHTML() : templatesHTML()}</div>
      ${chatFooter()}
    </div>`;
  }

  const TEMPLATES = [
    { id: 'timeline', cat: 'Timeline', title: 'Timeline Health & Delay Audit', desc: 'Scan all timeline phases, identify delayed WIP activities, and calculate progress variance.', prompt: 'Please perform a comprehensive timeline health and delay audit for the active project. Identify all activities that are behind schedule, calculate overall phase completion rates, and recommend specific schedule compression or fast-tracking actions.' },
    { id: 'risks', cat: 'Risks', title: 'Critical Risk & Exposure Review', desc: 'Analyze high-exposure risks and verify mitigation strategy completeness.', prompt: 'Review all high and critical risks logged for this project. Analyze our current mitigation strategies and contingency plans, point out any unmitigated exposure areas, and suggest proactive measures.' },
    { id: 'general', cat: 'General', title: 'Executive Status Summary', desc: 'Draft a high-level executive briefing on milestones, accomplishments, and blockers.', prompt: 'Generate a concise executive weekly status report for key stakeholders. Include key milestones achieved this period, active deliverables in flight, top friction items/blockers, and next steps.' },
    { id: 'mom', cat: 'MoM', title: 'Draft MOM & Action Items', desc: 'Process meeting notes, summarize key decisions, and propose structured MOM action items.', prompt: 'I want to record minutes from our recent meeting. Please help me summarize the main discussion topics, list all key decisions made, and draft actionable items with assignees and target dates.' },
    { id: 'deliverables', cat: 'Deliverables', title: 'Deliverables Readiness & DoD Audit', desc: 'Audit in-progress deliverables against their Definition of Done criteria.', prompt: 'Audit our active deliverables and their Definition of Done (DoD) criteria. Identify which deliverables are approaching their due date, check if acceptance criteria are fully met, and recommend next steps.' },
    { id: 'tasks', cat: 'Tasks', title: 'Open Friction & Task Prioritization', desc: 'Triage and prioritize friction items, bottlenecks, and open blockers.', prompt: 'Analyze all open tasks and friction items across the project. Prioritize them based on urgency and impact on the critical path, and suggest clear resolution owners and target dates.' },
    { id: 'billing', cat: 'Billing', title: 'Billing & Milestone Reconciliation', desc: 'Verify payment milestone statuses, pending claims, and invoice timelines.', prompt: "Review the project's billing schedule and financial milestones. Check payment statuses, compare invoiced vs remaining contract sums, and highlight any upcoming milestone claim deadlines." },
  ];
  const BADGE = {
    Timeline: 'bg-[#ff7600]/10 text-qb-orange border-qb-orange/30', Risks: 'bg-qb-magenta/10 text-qb-magenta border-qb-magenta/30',
    General: 'bg-qb-box-bg text-qb-dark-grey border-qb-light-grey', MoM: 'bg-[#2dbcd2]/10 text-[#2dbcd2] border-[#2dbcd2]/30',
    Deliverables: 'bg-qb-cyan/10 text-qb-cyan border-qb-cyan/30', Tasks: 'bg-[#51b53e]/10 text-[#51b53e] border-[#51b53e]/30',
    Billing: 'bg-qb-dark-grey/10 text-qb-dark-grey border-qb-dark-grey/30',
  };
  function templatesHTML() {
    const cats = ['All', 'Timeline', 'Risks', 'MoM', 'Deliverables', 'Tasks', 'Billing', 'General'];
    const list = TEMPLATES.filter(t => S.cat === 'All' || t.cat === S.cat);
    return `<div class="flex flex-col gap-5 my-auto py-2">
      <div class="flex flex-col gap-1 border-b border-qb-light-grey pb-4"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="w-2 h-2 bg-qb-orange shrink-0"></span><h3 class="text-xs font-black uppercase tracking-widest text-qb-black">Select a prompt template</h3></div><button type="button" class="text-[10px] font-black uppercase tracking-wider text-qb-grey hover:text-qb-orange transition-colors flex items-center gap-1 cursor-pointer" title="Configure templates in Settings">${icon('settings3')}<span>CONFIGURE</span></button></div>
      <p class="text-[11px] font-medium text-qb-dark-grey leading-relaxed">Choose a prompt template below to jumpstart your analysis or type a custom query.</p></div>
      <div class="flex flex-wrap gap-1.5">${cats.map(c => `<button type="button" data-h="cat:${c}" aria-pressed="${S.cat === c}" class="px-2.5 py-1 text-[10px] font-black tracking-wider uppercase border transition-all cursor-pointer ${S.cat === c ? 'bg-qb-black text-white border-qb-black shadow-xs' : 'bg-white text-qb-dark-grey border-qb-light-grey hover:border-qb-black hover:text-qb-black'}"><span>${c}</span></button>`).join('')}</div>
      <div class="flex flex-col gap-2.5">${list.map(t => `<button type="button" data-h="tpl:${t.id}" class="group relative border border-qb-light-grey bg-white p-3.5 flex flex-col gap-2 hover:border-qb-orange hover:bg-qb-orange/5 cursor-pointer transition-all shadow-xs text-left"><span class="flex items-center justify-between gap-2 w-full"><span class="inline-flex items-center gap-1 px-1.5 py-0.2 text-[8.5px] font-black uppercase tracking-widest border ${BADGE[t.cat]}"><span class="w-1 h-1 bg-current shrink-0"></span>${t.cat}</span><span class="text-[9px] font-bold text-qb-grey group-hover:text-qb-orange uppercase tracking-wider flex items-center gap-1"><span>USE</span>${icon('arrow25')}</span></span><span class="text-xs font-black uppercase tracking-wide text-qb-black group-hover:text-qb-orange transition-colors">${t.title}</span><span class="text-[11px] font-medium text-qb-dark-grey leading-relaxed line-clamp-2">${t.desc}</span></button>`).join('')}</div>
    </div>`;
  }

  function messagesHTML() {
    const turns = S.msgs.map(m => m.role === 'user'
      ? `<div class="chat-message flex flex-col gap-2 items-end"><div class="relative group text-sm leading-relaxed p-4 border font-medium bg-qb-black text-white border-qb-black max-w-[85%]"><div class="flex flex-col gap-3"><div class="whitespace-pre-wrap">${esc(m.text)}</div></div></div></div>`
      : `<div class="chat-message flex flex-col gap-2 items-start w-full${m.fresh ? ' slot-in' : ''}"><div class="relative group text-sm leading-relaxed p-4 border font-medium bg-transparent border-qb-orange text-qb-black w-full overflow-hidden"><div class="flex flex-col gap-3"><div class="markdown-body font-sans text-sm selection:bg-qb-orange selection:text-white [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">${m.html}</div></div><div class="text-[9px] mt-2 opacity-50 flex gap-4 uppercase font-bold tracking-widest justify-between text-qb-black"><span>${m.time}</span><span>gemini-3.7-flash</span></div></div></div>`).join('');
    S.msgs.forEach(m => { m.fresh = false; });
    const card = S.gcard && S.status.gemini === 'pending' ? `<div class="sidebar-content border-2 border-qb-orange p-4 bg-transparent shadow-sm flex flex-col gap-3 shrink-0"><div class="text-xs font-black uppercase tracking-widest text-qb-orange flex items-center gap-2"><span class="animate-pulse flex h-2 w-2 rounded-full bg-qb-orange"></span>1 SYSTEM MODIFICATION(S) PROPOSED</div><div class="flex gap-2 mt-1"><button type="button" data-h="g-approve" class="flex-1 bg-qb-black text-white flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-orange transition-colors cursor-pointer border border-qb-black font-sans">${icon('check3')} APPROVE</button><button type="button" data-h="g-review" class="flex-1 bg-transparent border border-qb-black text-qb-black flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-light-grey/30 transition-colors cursor-pointer font-sans">REVIEW</button><button type="button" data-h="g-reject" class="flex-1 bg-transparent border border-qb-light-grey text-qb-magenta flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-magenta/5 transition-colors cursor-pointer font-sans">${icon('x3')} REJECT</button></div></div>` : '';
    const busy = S.thinking ? `<div class="text-xs font-mono font-black text-qb-grey flex items-center gap-2 tracking-widest uppercase"><span class="w-2 h-2 bg-qb-light-grey animate-bounce"></span> PROCESSING...</div>` : '';
    return `<div class="flex flex-col gap-6 w-full">${turns}</div>${card}${busy}<div class="h-1 shrink-0"></div>`;
  }

  function chatFooter() {
    const att = S.attached && S.review ? CHANGES[S.attached] : null;
    const attached = att ? `<div class="mb-4 border border-qb-orange/40 bg-qb-orange/5 px-3 py-2.5 relative"><div class="text-[9px] font-black uppercase tracking-widest text-qb-orange mb-1">Attached proposal for discussion</div><div class="text-[10px] font-black uppercase tracking-wider text-qb-black truncate pr-6">${esc(att.title)}</div><div class="text-[9px] font-mono text-qb-grey tracking-wider uppercase mt-0.5">Action: ${att.action.split(' ')[0]} ${att.action.split(' ').slice(1).join(' ').toLowerCase()}</div><button type="button" data-h="attach-close" aria-label="Detach" class="absolute top-2 right-2 text-qb-grey hover:text-qb-black">${icon('x35')}</button></div>` : '';
    const opts = S.options.length && !S.thinking ? `<div class="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Replies">${S.options.map(([label, node]) => `<button type="button" data-h="opt:${node}" class="px-2.5 py-1.5 text-[10px] font-black tracking-wider uppercase border transition-all cursor-pointer bg-white text-qb-dark-grey border-qb-light-grey hover:border-qb-orange hover:text-qb-orange text-left">${esc(label)}</button>`).join('')}</div>` : '';
    // The app's own placeholder. In the demo the replies above stand in for typing.
    const placeholder = 'Ask for updates, attach files, or plan your project...';
    return `<div class="sidebar-content p-6 border-t border-qb-light-grey bg-qb-bg shrink-0">${attached}${opts}
      <div class="flex items-center justify-between mb-3 text-[10px] font-black tracking-widest text-qb-black uppercase select-none"><div class="flex items-center gap-1.5 text-qb-dark-grey"><span class="w-1.5 h-1.5 bg-qb-orange rounded-full animate-pulse"></span><span>THINKING ENGINE</span></div><select data-h="engine" aria-label="Thinking engine" class="bg-qb-bg border border-qb-light-grey text-[10px] font-black tracking-widest text-qb-black px-2.5 py-1 focus:border-qb-black focus:outline-none cursor-pointer uppercase transition-colors"><option>Housekeeping</option><option>Competent</option><option>Escalative</option></select></div>
      <div class="relative border transition-all border-qb-dark-grey focus-within:border-qb-black"><textarea readonly${S.thinking ? ' disabled' : ''} aria-label="Message (in the demo, pick a reply above)" placeholder="${placeholder}" class="w-full pl-4 pr-28 py-3 bg-transparent focus:outline-none resize-none text-sm font-medium tracking-wide placeholder-qb-grey transition-colors min-h-[72px]" rows="3"></textarea><div class="absolute bottom-3 right-3 flex items-center gap-2"><button type="button" data-h="ai-new" class="p-1.5 transition-colors cursor-pointer text-qb-dark-grey hover:text-qb-black hover:bg-qb-light-grey/20" title="Choose from Prompt Templates">${icon('sparkles')}</button><button type="button" class="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-qb-light-grey/20 transition-colors cursor-pointer" title="Attach files (PDFs, Images, Audio, Video, CSV, spreadsheets, and documents)">${icon('clip')}</button><button type="button" disabled class="p-1.5 bg-qb-black text-white hover:bg-qb-orange disabled:opacity-50 disabled:hover:bg-qb-black transition-colors" title="Send message">${icon('send4')}</button></div></div>
    </div>`;
  }

  function reviewPane(withChat) {
    const ids = ACR_OF[S.review];
    const n = ids.filter(id => S.ticks[id]).length;
    const all = n === ids.length;
    const cards = ids.map(id => {
      const ch = CHANGES[id], [label, color] = KIND[ch.kind], on = S.ticks[id], focused = S.focus === id;
      return `<div data-h="focus:${id}" role="button" tabindex="0" class="border p-4 transition-all duration-200 cursor-pointer flex gap-3 ${focused ? 'border-qb-orange bg-qb-orange/5 shadow-sm' : 'border-qb-light-grey hover:border-qb-black bg-transparent'}"><div class="pt-0.5"><input data-h="tick:${id}" aria-label="Include this change" class="w-4 h-4 border border-qb-light-grey text-qb-orange accent-qb-orange focus:ring-0 focus:ring-offset-0 focus:outline-none rounded-none cursor-pointer" type="checkbox"${on ? ' checked' : ''}></div><div class="flex-1 min-w-0 ${on ? '' : 'opacity-60'}"><div class="text-[9px] font-black uppercase tracking-widest ${color} mb-1">${label}</div><h4 class="text-xs font-black uppercase tracking-wider mb-1 leading-snug break-words ${on ? 'text-qb-black' : 'text-qb-grey line-through'}">${esc(ch.title)}</h4>${ch.on && ch.kind !== 'comment' ? `<div class="text-[9px] font-mono text-qb-dark-grey tracking-wider mb-1 truncate">ON: ${esc(ch.on)}</div>` : ''}<div class="text-[9px] font-mono font-bold text-qb-grey tracking-widest uppercase">${ch.action} · ${ch.summary}</div>${ch.text ? `<div class="mt-2 border-l-2 border-qb-cyan pl-2.5 py-1 bg-qb-cyan/5"><div class="text-[9px] font-black uppercase tracking-widest text-qb-dark-grey mb-0.5">Comment Text</div><div class="text-[11px] font-mono text-qb-black leading-snug whitespace-pre-wrap break-words">${esc(ch.text)}</div></div>` : ''}<span class="text-[9px] font-mono text-qb-cyan block mt-2 tracking-wider uppercase font-bold hover:underline">→ GO TO PAGE</span></div></div>`;
    }).join('');
    return `<div class="${withChat ? 'w-[360px] border-l border-qb-light-grey' : 'flex-1 w-full min-w-0 border-l-0'} h-full flex flex-col bg-qb-bg relative select-none">
      <div class="h-14 border-b border-qb-light-grey flex items-center justify-between px-6 bg-transparent shrink-0"><span class="text-xs font-black uppercase tracking-widest text-qb-orange">REVIEW PROPOSALS</span><div class="flex items-center gap-1"><button type="button" data-h="review-chat" class="p-1 text-qb-grey hover:text-qb-black transition-colors" title="${withChat ? 'Hide the chat and review on its own' : 'Show the chat'}">${icon(withChat ? 'panel-close' : 'panel-open')}</button><button type="button" data-h="review-close" class="p-1 text-qb-grey hover:text-qb-black transition-colors" title="Close Review">${icon('x4')}</button></div></div>
      <div class="bg-qb-orange/5 border-b border-qb-light-grey p-4 text-[10px] uppercase font-black tracking-widest leading-relaxed text-qb-grey">REVIEW CRITICAL CHANGES PROPOSED BY ASSISTANT. UNCHECK ITEMS TO DECLINE THEM. CLICK TO FOCUS ON TARGET PAGE.</div>
      <div class="px-6 py-3 border-b border-qb-light-grey flex items-center justify-between bg-qb-bg shrink-0"><div class="flex items-center gap-3"><input id="acr-select-all" data-h="tick-all" class="w-4 h-4 border border-qb-light-grey text-qb-orange accent-qb-orange focus:ring-0 focus:ring-offset-0 focus:outline-none rounded-none cursor-pointer" type="checkbox"${all ? ' checked' : ''}><label for="acr-select-all" class="text-[10px] font-black uppercase tracking-widest text-qb-black cursor-pointer select-none">SELECT ALL PROPOSALS</label></div><span class="text-[10px] font-mono font-bold text-qb-grey">${n} / ${ids.length} SELECTED</span></div>
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3">${cards}</div>
      <div class="border-t border-qb-light-grey p-4 bg-transparent flex flex-col gap-2 shrink-0"><button type="button" data-h="sign-off" class="w-full bg-qb-black hover:bg-qb-orange text-white text-xs font-black uppercase tracking-widest py-3 transition-colors text-center cursor-pointer font-sans">SIGN OFF</button><button type="button" data-h="reject-all" class="w-full bg-transparent hover:bg-qb-magenta/5 text-qb-magenta text-xs font-black uppercase tracking-widest py-3 border border-qb-light-grey hover:border-qb-magenta transition-colors text-center cursor-pointer font-sans">REJECT ALL</button></div>
    </div>`;
  }

  function renderBar() {
    const slot = $('#bar-slot', app);
    slot.innerHTML = S.status.claude === 'pending'
      ? `<button type="button" data-h="bar" class="w-full flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-qb-orange/10 border-b border-qb-orange text-left hover:bg-qb-orange/20 transition-colors cursor-pointer"><span class="flex-shrink-0 w-2 h-2 bg-qb-orange animate-pulse"></span><span class="text-[10px] font-black uppercase tracking-widest text-qb-black font-sans">Claude has proposed 4 changes</span><span class="text-[10px] font-mono font-bold uppercase tracking-widest text-qb-orange ml-auto">Review →</span></button>`
      : '';
    $('#demo-reset').hidden = S.status.claude === 'pending' && !S.applied.g1 && S.status.gemini !== 'approved';
  }

  function setBadge(saving) {
    const b = $('#sync-badge', app);
    b.className = saving
      ? 'border border-qb-orange px-2.5 py-1 bg-qb-orange/5 flex items-center gap-1.5 uppercase font-bold tracking-widest text-[10px] text-qb-orange font-sans animate-pulse'
      : 'border border-qb-green px-2.5 py-1 bg-qb-green/5 flex items-center gap-1.5 uppercase font-bold tracking-widest text-[10px] text-qb-green font-sans';
    b.innerHTML = saving ? `${icon('refresh')}<span>SAVING…</span>` : `${icon('cloud')}<span>SAVED</span>`;
  }

  // ------------------------------------------------------------ review actions
  function openReview(who, { withChat = false } = {}) {
    S.pane = 'review';
    if (!S.chat && !withChat) S.sidebarByAcr = true;
    S.review = who;
    S.reviewOnly = !withChat;
    S.focus = null;
    renderAside();
    if (S.route !== 'overview') { const t = S.tray; renderView(); if (t) openTray(t, false); }
    setTimeout(() => $('#acr-select-all', aside)?.focus({ preventScroll: true }), RM ? 0 : 400);
  }
  function closeReview() {
    S.review = null; S.focus = null; S.attached = null;
    if (S.sidebarByAcr) { S.chat = false; S.sidebarByAcr = false; }
    renderAside();
  }
  function focusChange(id) {
    const ch = CHANGES[id];
    S.focus = id;
    if (S.chat && !S.reviewOnly) S.attached = id;
    renderAside();
    navigate(ch.route, { tray: ch.tray || null });
    // No tray for a timeline row: bring the proposed row into view, inside the app only.
    if (!ch.tray) showGanttRow(/^Extraction scripts$/i);
  }
  function showGanttRow(re) {
    const row = $$('*', view).find(el => el.childElementCount === 0 && re.test(el.textContent.trim()));
    const { sc } = ganttScroller(view);
    if (row && sc) sc.scrollTop += row.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 3;
    return row;
  }
  function signOff() {
    const who = S.review;
    ACR_OF[who].filter(id => S.ticks[id]).forEach(id => { S.applied[id] = true; });
    const n = ACR_OF[who].filter(id => S.ticks[id]).length;
    S.status[who] = 'approved';
    const tray = S.tray;
    closeReview();
    setBadge(true);
    setTimeout(() => setBadge(false), RM ? 0 : 900);
    renderView();
    if (tray && trayName(tray)) openTray(tray, false); else closeTray(false);
    // Signed off on the timeline: stay on the row that just changed.
    if (S.route === 'timeline' && S.applied.c4 && S.ticks.c4) showGanttRow(/^Extraction scripts$/i);
    renderBar();
    if (who === 'gemini') {
      if (!S.chat) { S.chat = true; renderAside(); }
      respond(n ? 'after.signoff' : 'after.none');
    }
  }
  function rejectAll() {
    const who = S.review;
    S.status[who] = 'rejected';
    const tray = S.tray;
    closeReview();
    renderView();
    if (tray && trayName(tray)) openTray(tray, false); else closeTray(false);
    // Signed off on the timeline: stay on the row that just changed.
    if (S.route === 'timeline' && S.applied.c4 && S.ticks.c4) showGanttRow(/^Extraction scripts$/i);
    renderBar();
    if (who === 'gemini') { S.chat = true; say('model', `<p class="leading-relaxed text-qb-black my-2 text-sm">✗ Rejected: Proposed modifications have been discarded.</p>`); setOptions(['Start over', 'reset']); }
  }

  // ------------------------------------------------------------ the scripted conversations
  const P = t => `<p class="leading-relaxed text-qb-black my-2 text-sm">${t}</p>`;
  const B = t => `<strong class="font-bold text-qb-black focus:outline-none">${t}</strong>`;
  const UL = items => `<ul class="list-disc pl-4 my-2 space-y-1 text-sm text-qb-black marker:text-qb-orange">${items.map(i => `<li class="pl-1">${i}</li>`).join('')}</ul>`;
  const OL = items => `<ol class="list-decimal pl-4 my-2 space-y-1 text-sm text-qb-black marker:text-qb-orange">${items.map(i => `<li class="pl-1">${i}</li>`).join('')}</ol>`;
  const QUOTE = t => `<blockquote class="border-l-2 border-qb-orange text-qb-dark-grey bg-qb-orange/5 italic my-3 py-2 pl-4 pr-4 text-sm">${t}</blockquote>`;
  const LOG = (k, p) => `<pre class="bg-qb-black text-qb-box-bg p-4 font-mono text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre rounded-none my-4 border-l-2 border-qb-orange">&gt; LOADING CARTRIDGE ........ [##########] 100%\n&gt; KNOWLEDGE PROFILE  : ${k}\n&gt; PERSONALITY PROFILE: ${p}</pre>`;
  const RESTART = ['Start over', 'reset'];

  const NODES = {
    tasks: {
      html: () => LOG('critical path, task triage', 'direct, sparing with words') + P('Two blockers stand between you and UAT.') + OL([
        `${B('Vendor sandbox times out on bulk import')} is blocked on the vendor's patch. Migration can't be tested until it moves.`,
        `${B('Collect sign-off on data mapping v2')} is due tomorrow and waits on a specification that is already 6 days late.`,
      ]) + P('The test accounts task is 2 days late but only needs IT. Shall I flag the sign-off so it stays in front of Priya?'),
      options: [['Yes, flag it', 'tasks.flag'], ['Draft a chaser to the vendor', 'tasks.chaser'], ['Not now', 'tasks.no']],
    },
    'tasks.flag': {
      html: () => P(`Filed. Flagging ${B('Collect sign-off on data mapping v2')} is waiting for your review.`),
      acr: true, options: [],
    },
    'tasks.chaser': {
      html: () => P('Here is a short one for Jonas to send:') + QUOTE('Our bulk import still times out at 5,000 rows. Can you confirm the date for the patch? Our UAT starts on 2 Nov and migration testing depends on it.'),
      options: [['Make it firmer', 'tasks.firmer'], ['Flag the sign-off after all', 'tasks.flag'], RESTART],
    },
    'tasks.firmer': {
      html: () => QUOTE('We need the bulk-import patch by 23 Oct. Without it, migration testing misses UAT on 2 Nov and we escalate to your account lead. Please confirm the date today.'),
      options: [RESTART],
    },
    'tasks.no': { html: () => P('Understood. Nothing changed.'), options: [RESTART] },
    risks: {
      html: () => LOG('risk exposure, mitigation planning', 'cautious, blunt about exposure') + P('Three open risks are rated high. One has nothing written against it.') + UL([
        `${B('Key users on year-end leave during UAT')}: high impact, high probability, no mitigation yet.`,
        `${B('Legacy data quality below migration threshold')}: under mitigation; the merge rule for duplicates is agreed.`,
        `${B('Vendor patch slips past go-live')}: critical impact; tied to the blocked sandbox issue.`,
      ]),
      options: [['What would you do about the leave risk?', 'risks.leave'], ['Which one threatens go-live most?', 'risks.golive']],
    },
    'risks.leave': {
      html: () => P('Book named backup testers per area now, and run the payroll and finance scripts in UAT round 1, before leave starts. Round 2 then needs fewer of the same people.'),
      options: [['Which one threatens go-live most?', 'risks.golive'], RESTART],
    },
    'risks.golive': {
      html: () => P(`The ${B('vendor patch')}. Leave and data quality cost time inside UAT; a missing patch removes migration testing altogether, and go-live is fixed.`),
      options: [RESTART],
    },
    general: {
      html: () => LOG('executive reporting', 'concise, outcome first') + P(`${B('Atlas ERP Rollout, 15 Oct.')} 48% done against 53% planned; go-live holds at 30 Nov.`) + UL([
        'Design is closed apart from the data mapping sign-off.',
        'Build is behind on integrations and data migration.',
        'Three high risks, one without a mitigation.',
        'Ask of steering: decide on a parallel run for payroll.',
      ]),
      options: [['Make it two lines', 'general.short'], ['Add what I need from the sponsor', 'general.sponsor']],
    },
    'general.short': { html: () => P('48% done, 5 points behind; go-live holds at 30 Nov. Build is the gap; one high risk has no mitigation.'), options: [['Add what I need from the sponsor', 'general.sponsor'], RESTART] },
    'general.sponsor': { html: () => P(`From the sponsor: ${B('backup testers for year-end')} and ${B('a decision on the payroll parallel run')} by 22 Oct.`), options: [RESTART] },
    timeline: {
      html: () => LOG('schedule control, critical path', 'calculated, terse') + P(`One activity is past its date: ${B('Mapping v2')}, 6 days over at 80%, and the finance review after it is already running.`) + P(`Build is 10 points behind its plan. ${B('Warehouse scanners')}, at 10% with three weeks left, is the one to watch. Go-live doesn't move yet: UAT round 1 starts 2 Nov.`),
      options: [['How much slack is left?', 'timeline.slack'], RESTART],
    },
    'timeline.slack': { html: () => P('About four working days before UAT round 1 has to slip. After that, round 2 absorbs it until 27 Nov, and then go-live is exposed.'), options: [RESTART] },
    mom: {
      html: () => LOG('meeting minutes, action tracking', 'structured, brief') + P('Paste your notes or attach the recording and I will draft the minutes: attendees, agenda, decisions and action items.') + P('Action items stay on the meeting until you push them to the task tracker.'),
      options: [['Use the 14 Oct steering', 'mom.steering'], RESTART],
    },
    'mom.steering': { html: () => P(`The 14 Oct steering already has minutes with three action items; two are not pushed yet. Open ${B('MoM')} and use ${B('Push all')} when you want them in the tracker.`), options: [RESTART] },
    deliverables: {
      html: () => LOG('acceptance criteria, deliverable readiness', 'exacting, brief') + P(`${B('Data mapping specification')} is in review and 6 days late, with no definition of done. Finance has nothing written to check it against.`) + P(`${B('Cutover plan')} is due 25 Nov and has none either.`),
      options: [RESTART],
    },
    billing: {
      html: () => LOG('milestone billing, cash flow', 'precise, numbers first') + P(`Design is invoiced. ${B('Build')} (40%, 106,560 with VAT) is next, but its documents are pending and the configured system is due 30 Oct, so it can't be claimed before November.`),
      options: [RESTART],
    },
    'after.signoff': { html: () => P(`Flagged. ${B('Collect sign-off on data mapping v2')} stays at the top of Priya's list until finance replies.`), options: [RESTART] },
    'after.none': { html: () => P('Nothing was applied; every line was unticked.'), options: [RESTART] },
  };

  function say(role, content) {
    S.msgs.push(role === 'user' ? { role, text: content } : { role, html: content, time: clock(), fresh: true });
  }
  function setOptions(...opts) { S.options = opts; renderAside(); }
  // Thinking (the avatar turns red), then the reply streams in while the
  // avatar speaks; the replies and any change request come when it's done.
  // Played in full whatever prefers-reduced-motion says, like the app.
  let stream = null;
  function stopReply() { respond.gen = (respond.gen || 0) + 1; clearTimeout(respond.t); stream?.cancel(); stream = null; }
  function respond(node, userText) {
    stopReply();
    const gen = respond.gen;
    if (userText) say('user', userText);
    S.options = []; S.thinking = true;
    renderAside();
    respond.t = setTimeout(() => {
      S.thinking = false;
      S.speaking = true;
      const n = NODES[node];
      say('model', n.html());
      renderAside();
      const done = () => {
        if (gen !== respond.gen) return;
        stream = null;
        S.speaking = false;
        if (n.acr) { S.status.gemini = 'pending'; S.gcard = true; S.ticks.g1 = true; }
        S.options = n.options;
        renderAside();
      };
      const body = [...aside.querySelectorAll('#ai-msgs .markdown-body')].pop();
      const msgs = $('#ai-msgs', aside);
      if (!body || !window.PMCType) { done(); return; }
      stream = window.PMCType.typeOut(body, { onTick: () => { if (msgs) msgs.scrollTop = msgs.scrollHeight; } });
      stream.then(done);
    }, 2000);
  }
  function newConversation() {
    stopReply();
    if (S.status.gemini === 'pending') { S.status.gemini = 'none'; S.gcard = false; if (S.review === 'gemini') S.review = null; }
    Object.assign(S, { msgs: [], options: [], thinking: false, speaking: false, title: 'New Conversation', cat: 'All', attached: null });
    renderAside();
  }

  // ------------------------------------------------------------ one handler for every control
  function handle(action, el, e) {
    const [verb, ...rest] = action.split(':');
    const arg = rest.join(':');
    switch (verb) {
      case 'route': navigate(arg); break;
      case 'item': { const [route, tray] = arg.split(':'); navigate(route, { tray: tray || null }); break; }
      case 'open': openTray(arg); break;
      case 'tray-close': closeTray(); break;
      case 'edit': startEdit(arg, el); break;
      case 'edit-save': endEdit(true); break;
      case 'edit-cancel': endEdit(false); break;
      case 'bar': openReview('claude'); break;
      case 'ai-toggle':
        if (S.chat) { S.chat = false; if (S.review) S.reviewOnly = true; }
        else { S.chat = true; S.sidebarByAcr = false; S.pane = 'chat'; if (S.review) S.reviewOnly = false; }
        renderAside(); break;
      case 'ai-close': S.chat = false; S.review = null; renderAside(); break;
      case 'ai-new': newConversation(); break;
      case 'cat': S.cat = arg; renderAside(); break;
      case 'tpl': { const t = TEMPLATES.find(x => x.id === arg); S.title = t.title; respond(arg, t.prompt); break; }
      case 'opt': {
        if (arg === 'reset') { newConversation(); break; }
        const label = S.options.find(o => o[1] === arg)?.[0] || '';
        respond(arg, label);
        break;
      }
      case 'g-approve':
        S.applied.g1 = true; S.status.gemini = 'approved'; S.gcard = false;
        say('model', P(`✓ Approved: Applied all 1 proposed changes to your project.`));
        S.options = [RESTART];
        setBadge(true); setTimeout(() => setBadge(false), RM ? 0 : 900);
        renderAside(); renderBar();
        if (S.route === 'tasks') { const t = S.tray; renderView(); if (t) openTray(t, false); }
        break;
      case 'g-reject':
        S.status.gemini = 'rejected'; S.gcard = false;
        say('model', P('✗ Rejected: Proposed modifications have been discarded.'));
        S.options = [RESTART]; renderAside(); break;
      case 'g-review': openReview('gemini', { withChat: true }); break;
      case 'review-chat':
        if (S.reviewOnly) { S.chat = true; S.sidebarByAcr = false; S.reviewOnly = false; S.pane = 'chat'; } else { S.reviewOnly = true; S.pane = 'review'; }
        renderAside(); break;
      case 'review-close': closeReview(); if (S.route !== 'overview') { const t = S.tray; renderView(); if (t && trayName(t)) openTray(t, false); else closeTray(false); } break;
      case 'focus': if (!(e.target instanceof HTMLInputElement)) focusChange(arg); break;
      case 'sign-off': signOff(); break;
      case 'reject-all': rejectAll(); break;
      case 'attach-close': S.attached = null; renderAside(); break;
      case 'engine': break;
      default: break;
    }
  }
  function handleChange(el) {
    const a = el.dataset.h || '';
    if (a.startsWith('tick:')) { S.ticks[a.slice(5)] = el.checked; renderAside(); }
    else if (a === 'tick-all') { ACR_OF[S.review].forEach(id => { S.ticks[id] = el.checked; }); renderAside(); }
  }

  app.addEventListener('click', e => {
    const h = e.target.closest('[data-h]');
    if (h && app.contains(h)) {
      if (h.matches('input[type=checkbox], select')) return; // handled on change
      e.preventDefault();
      handle(h.dataset.h, h, e);
      return;
    }
    const c = e.target.closest('button, a, label, [data-row], [role="button"], .cursor-pointer');
    if (c && app.contains(c) && !c.matches('textarea, [readonly]')) { e.preventDefault(); toast(); }
  });
  app.addEventListener('change', e => { if (e.target.closest('[data-h]')) handleChange(e.target); });
  app.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-h][role="button"]')) { e.preventDefault(); handle(e.target.dataset.h, e.target, e); }
    if (e.key === 'Escape') { if ($('[data-editing]', traySlot)) endEdit(false); else if (S.tray) closeTray(); }
  });
  // The captured screens are pictures of the app: their own inputs and menus stay put.
  app.addEventListener('mousedown', e => {
    const f = e.target.closest('select, input, textarea');
    if (f && !f.closest('[data-h]') && !f.matches('[data-edit-input]') && (view.contains(f) || traySlot.contains(f))) { e.preventDefault(); toast(); }
  });

  // ------------------------------------------------------------ outside the frame
  $('#demo-reset').addEventListener('click', () => {
    stopReply();
    S = fresh();
    closeTray(false);
    renderBar(); renderAside(); renderView(); setBadge(false);
    $('#demo').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
  });
  $$('[data-demo]').forEach(b => b.addEventListener('click', () => {
    const [kind, arg] = b.dataset.demo.split(':');
    $('#demo').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
    if (kind === 'route') navigate(arg);
    if (kind === 'review' && S.status.claude === 'pending') openReview('claude');
    if (kind === 'assistant') { S.chat = true; renderAside(); }
  }));

  // The frame stands in for a browser window: its width, not the page's, decides the layout.
  let wasNarrow = app.clientWidth < 640;
  new ResizeObserver(() => { const n = app.clientWidth < 640; if (n !== wasNarrow) { wasNarrow = n; renderAside(); } }).observe(app);
  renderBar(); renderAside(); renderView();
})();
