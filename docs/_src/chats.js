// Chat motion for the showcase: replies that stream in word by word, and the
// two Change Requests figures played as live conversations.
//
// PMCType.typeOut(el) streams the text already inside el (bold, code blocks
// and all) by emptying its text and writing it back a few words at a time,
// with a caret. Children marked data-instant appear only when it's done.
// Returns a promise with .cancel(), which shows everything at once.
//
// Like the avatar, this plays whatever prefers-reduced-motion says: the
// thinking-then-typing is what the page is showing.
(() => {
  function typeOut(root, { wordMs = 26, onTick } = {}) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push([walker.currentNode, walker.currentNode.nodeValue]);
    // Top-level children and nested blocks (list items, paragraphs…) stay
    // hidden until the stream reaches their first word.
    const instant = [...root.children].filter(k => k.hasAttribute('data-instant'));
    const inInstant = n => instant.some(k => k.contains(n));
    const hide = [...root.children, ...root.querySelectorAll('li, p, pre, blockquote, h1, h2, h3, h4, tr')]
      .filter((el, i, a) => a.indexOf(el) === i);
    const prev = new Map(hide.map(k => [k, k.style.display]));
    hide.forEach(k => { k.style.display = 'none'; });
    const reveal = n => {
      for (let el = n.parentElement; el && el !== root; el = el.parentElement)
        if (prev.has(el) && !inInstant(el)) el.style.display = prev.get(el);
    };
    nodes.forEach(([n]) => { n.nodeValue = ''; });
    const caret = document.createElement('span');
    caret.className = 'type-caret';
    caret.setAttribute('aria-hidden', 'true');

    let timer = 0, finished = false, resolve;
    const p = new Promise(r => { resolve = r; });
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      nodes.forEach(([n, full]) => { n.nodeValue = full; });
      hide.forEach(k => { k.style.display = prev.get(k); });
      caret.remove();
      onTick?.();
      resolve();
    };
    let i = 0, tokens = null, ti = 0;
    const tick = () => {
      if (finished) return;
      while (i < nodes.length) {
        const [n, full] = nodes[i];
        if (inInstant(n)) { i++; continue; }
        if (!full.trim()) { n.nodeValue = full; i++; continue; }
        reveal(n);
        break;
      }
      if (i >= nodes.length) { finish(); return; }
      const [n, full] = nodes[i];
      if (!tokens) { tokens = full.match(/\s*\S+\s*/g) || [full]; ti = 0; n.after(caret); }
      const take = 1 + Math.floor(Math.random() * 3);
      n.nodeValue += tokens.slice(ti, ti + take).join('');
      ti += take;
      if (ti >= tokens.length) { i++; tokens = null; }
      onTick?.();
      timer = setTimeout(tick, wordMs * take + Math.random() * 20);
    };
    tick();
    p.cancel = finish;
    return p;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window.PMCType = { typeOut, wait };

  // ---------------------------------------------------------- Change Requests figures
  // Each [data-chat] plays once, when it scrolls into view. Its [data-step]
  // children start hidden and play in order:
  //   data-think-ms  a thinking pause first (data-think: the label, Claude only)
  //   data-step="type"  stream the text in; "show"  appear
  //   data-pause     a quiet pause first
  // [data-after="name"] elsewhere appears when that chat is done.
  // The chat keeps its full height throughout, so nothing below it moves.
  const THINK = {
    claude: label => Object.assign(document.createElement('p'), { className: 'cl-think mt-4', textContent: `${label}…` }),
    gemini: () => {
      const d = document.createElement('div');
      d.className = 'text-xs font-mono font-black text-qb-grey flex items-center gap-2 tracking-widest uppercase';
      d.innerHTML = '<span class="w-2 h-2 bg-qb-light-grey animate-bounce"></span> PROCESSING...';
      return d;
    },
  };

  function seen(el, fn) {
    let done = false;
    const check = () => {
      if (done) return;
      const r = el.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < vh * 0.7 && r.bottom > vh * 0.2) {
        done = true;
        window.removeEventListener('scroll', check);
        clearInterval(iv);
        fn();
      }
    };
    window.addEventListener('scroll', check, { passive: true });
    const iv = setInterval(check, 400);
    check();
  }

  document.querySelectorAll('[data-chat]').forEach(chat => {
    const name = chat.dataset.chat;
    const steps = [...chat.querySelectorAll(':scope > [data-step]')];
    const after = [...document.querySelectorAll(`[data-after="${name}"]`)];
    const avatar = () => chat.closest('figure')?.querySelector('[data-avatar-static]')?._pmcAvatar;
    const h = chat.offsetHeight;
    chat.style.minHeight = `${h}px`;
    steps.forEach(s => { s.style.display = 'none'; });
    after.forEach(a => { a.style.visibility = 'hidden'; });

    seen(chat, async () => {
      for (const s of steps) {
        if (s.dataset.pause) await wait(+s.dataset.pause);
        if (s.dataset.thinkMs) {
          const t = THINK[name](s.dataset.think || 'Thinking');
          s.before(t);
          avatar()?.setState('thinking');
          await wait(+s.dataset.thinkMs);
          t.remove();
        }
        s.style.display = '';
        if (s.dataset.step === 'type') {
          avatar()?.setState('responding');
          await typeOut(s);
        } else {
          s.classList.add('slot-in');
        }
        avatar()?.setState('idle');
      }
      after.forEach(a => { a.style.visibility = ''; a.classList.add('slot-in'); });
      chat.style.minHeight = '';
    });
  });
})();
