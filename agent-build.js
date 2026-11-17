/*!
 * agent-build — a small team of named cursor "agents" builds your UI in front of you.
 *
 * 1) Whole website, no markup changes (recommended for full sites):
 *      <script src="agent-build.js" data-body data-agents="8" data-hud></script>      (put it in <head>)
 *
 * 2) Wrap one part of a page:
 *      <script src="agent-build.js"></script>
 *      <agent-build agents="8" hud> ...your section / component... </agent-build>
 *
 * 3) From JS:
 *      const b = AgentBuild.attach(document.body, { agents: 8, hud: true });   b.rebuild();  b.destroy();
 *
 * Options (attribute / data-attribute / JS option)
 *   agents      number of agents (default 8, max 40)
 *   speed       minimum speed multiplier (default 1)
 *   duration    target build time in seconds; big pages speed up to fit (default 20, 0 = never speed up)
 *   max-layers  most pieces to build; smaller bits get grouped into their parent (default 150)
 *   names       "off" to hide name tags, or a comma list of names
 *   colors      comma list of colours
 *   hud         show the status pill
 *   trigger     "load" (default) | "visible" (start when scrolled into view) | "manual" (call .play())
 *   follow      "off" to stop the page auto-scrolling with the build
 *   finale      "off" to skip the ending (agents rise in a wave with the page back to the top and fly off-screen)
 *
 * Per element:  data-ab-skip  (never touch this subtree)   data-ab-layer  (build as one piece)
 * Event on the root: "agentbuild:done"  detail: { ms, layers }
 *
 * Safety: any error, or a build running far too long, reveals the whole page immediately — content is never left hidden.
 */
(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.AgentBuild) return; // SSR-safe, load once

  const css = document.createElement('style');
  css.textContent = `
    agent-build { display: block; }
    agent-build:not([data-ab-ready]) { opacity: 0; }
    html[data-ab-boot] body { opacity: 0 !important; }
    [data-agent-build]:not([data-ab-ready]) { opacity: 0; }
    [data-ab-state="pending"] { opacity: 0 !important; transition: opacity .25s ease !important; }
    .ab-canvas { position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483000 !important; margin: 0 !important; }
    .ab-hud { position: fixed; left: 50%; bottom: 20px; z-index: 2147483001; display: flex; align-items: center; gap: 12px;
      padding: 6px 6px 6px 8px; border-radius: 999px; color: #f2f2f4; font: 500 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      background: rgba(18,18,22,.72); border: 1px solid rgba(255,255,255,.09); box-shadow: 0 10px 40px rgba(0,0,0,.35);
      -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5); letter-spacing: normal; text-transform: none;
      transform: translate(-50%, 0); transition: opacity .5s, transform .5s cubic-bezier(.2,.8,.2,1); white-space: nowrap; box-sizing: border-box; }
    .ab-hud.ab-hide { opacity: 0; transform: translate(-50%, 12px); pointer-events: none; }
    .ab-av { display: flex; } .ab-av i { width: 22px; height: 22px; border-radius: 50%; margin-left: -6px; display: grid; place-items: center;
      font: 600 10px/1 Inter, ui-sans-serif, system-ui, sans-serif; font-style: normal; color: #fff; border: 2px solid #17171b; box-sizing: border-box; }
    .ab-av i:first-child { margin-left: 0; }
    .ab-tx b { font-weight: 600; margin-right: 6px; color: #f2f2f4; } .ab-tx span { color: #a1a1aa; font-variant-numeric: tabular-nums; }
    .ab-bar { width: 96px; height: 4px; border-radius: 4px; background: rgba(255,255,255,.1); overflow: hidden; }
    .ab-bar i { display: block; height: 100%; width: 0; border-radius: 4px; background: linear-gradient(90deg,#6366f1,#ec4899); transition: width .3s; }
    .ab-hud button { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 999px; background: rgba(255,255,255,.1); font-weight: 600; color: #f2f2f4; }
    .ab-hud button:hover { background: rgba(255,255,255,.18); }`;
  (document.head || document.documentElement).appendChild(css);

  const NAMES = ['Nova', 'Atlas', 'Iris', 'Kai', 'Lyra', 'Milo', 'Orion', 'Vera', 'Juno', 'Theo', 'Zara', 'Echo', 'Rhea', 'Sol', 'Quinn', 'Wren'];
  const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#3b82f6', '#14b8a6', '#f97316'];
  const MEDIA = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'BR', 'NOSCRIPT', 'LINK', 'META', 'WBR', 'HEAD', 'TITLE', 'DIALOG']);
  const STYLE_PROPS = ['mask-image', '-webkit-mask-image', 'filter', 'translate', 'scale'];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
  const rand = (a, b) => a + Math.random() * (b - a);
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const alphaOf = c => {
    if (!c || c === 'transparent') return 0;
    const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return /\/\s*0\s*\)/.test(c) ? 0 : 1;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1;
  };
  const hasBox = cs => alphaOf(cs.backgroundColor) > .02 || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
    (['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && alphaOf(cs['border' + s + 'Color']) > .05));
  const ownText = el => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const domReady = () => document.readyState === 'loading' ? new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true })) : Promise.resolve();

  function normalize(o = {}) {
    const list = v => Array.isArray(v) ? v : String(v).split(',').map(s => s.trim()).filter(Boolean);
    const off = v => v === false || v === 'off' || v === 'false';
    const on = v => v !== undefined && v !== null && !off(v);
    const trigger = o.trigger || 'load';
    return {
      agents: clamp(parseInt(o.agents) || 8, 1, 40),
      speed: Math.max(.1, parseFloat(o.speed) || 1),
      duration: o.duration === undefined || o.duration === null || o.duration === '' ? 20 : Math.max(0, parseFloat(o.duration) || 0),
      maxLayers: clamp(parseInt(o.maxLayers) || 150, 10, 2000),
      showNames: !off(o.names),
      names: o.names && !off(o.names) && o.names !== true && o.names !== '' ? list(o.names) : NAMES,
      colors: o.colors ? list(o.colors) : COLORS,
      hud: on(o.hud), trigger,
      follow: !off(o.follow) && trigger !== 'visible',
      finale: !off(o.finale),
    };
  }

  // ======================================================================================
  class Builder {
    constructor(root, opts) { this.root = root; this.o = normalize(opts); this.layers = null; }

    async start() {
      await domReady(); await frames();
      if (this.destroyed) return;
      try { this._setup(); }
      catch (e) { this._fail(e); }
      finally { document.documentElement.removeAttribute('data-ab-boot'); }
    }

    _setup() {
      this.layers = this._scan();
      this._hideAll();
      this.root.setAttribute && this.root.setAttribute('data-ab-ready', '');
      if (reduced() || !this.layers.length) { this._finishAll(); return; }
      if (this.o.trigger === 'visible') {
        this._io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { this._io.disconnect(); this.play(); } }, { threshold: .15 });
        this._io.observe(this.root);
      } else if (this.o.trigger !== 'manual') this.play();
    }

    // Never leave a site hidden: on any failure, show everything and stop.
    _fail(e) {
      try { console.warn('[agent-build] stopped, page revealed:', e); } catch (_) {}
      try { this._stop(true); } catch (_) {}
      this._finishAll();
      document.documentElement.removeAttribute('data-ab-boot');
    }
    _finishAll() { (this.layers || []).forEach(l => { try { this._finish(l); } catch (_) {} }); }

    // ---------- scanning ----------
    // Collect visible "pieces" (parents before children). If there are too many, small pieces are grouped into
    // their nearest bigger parent piece, so huge pages still build in a sensible number of steps.
    _scan() {
      const cands = [], docW = Math.max(document.documentElement.scrollWidth, innerWidth);
      const walk = (el, parent) => {
        for (const c of el.children) {
          const tag = c.tagName.toUpperCase();
          if (SKIP.has(tag) || c.hasAttribute('data-ab-skip') || c.classList.contains('ab-canvas') || c.classList.contains('ab-hud')) continue;
          const cs = getComputedStyle(c);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
          const r = c.getBoundingClientRect();
          if (r.width > 0 && (r.right < 0 || r.left > docW || r.bottom + scrollY < 0)) continue; // off-canvas menus, hidden carousel slides
          const pinned = cs.position === 'fixed' || cs.position === 'sticky';
          const forced = c.hasAttribute('data-ab-layer') || pinned; // sticky/fixed bars are built as one piece
          let kind = null;
          if (MEDIA.has(tag)) kind = 'media';
          else if (forced || hasBox(cs)) kind = 'box';
          else if (ownText(c)) kind = c.childElementCount === 0 ? 'text' : 'block';
          let me = parent;
          if (kind && r.width >= 4 && r.height >= 4) {
            me = { el: c, kind, parent, state: 'pending', tag: tag.toLowerCase(), area: r.width * r.height };
            cands.push(me);
          }
          if (kind !== 'media' && !forced) walk(c, me);
        }
      };
      walk(this.root, null);

      // budget: raise the minimum area until the piece count fits
      const max = this.o.maxLayers;
      const keptParent = c => { let p = c.parent; while (p && !p.keep) p = p.parent; return p; };
      const fit = list => {
        // score = size, nudged so pieces higher on the page win ties (1000 equal cards no longer vanish in one step)
        list.forEach((c, i) => { c.keep = true; c.score = c.area * (1.5 - i / list.length); });
        let minArea = 0, kept = list;
        while (kept.length > max && minArea < 1e8) {
          minArea = minArea ? minArea * 1.12 : 300;
          for (const c of list) c.keep = c.forcedKeep || c.score >= minArea || !keptParent(c); // top-level pieces always stay
          kept = list.filter(c => c.keep);
        }
        return kept;
      };
      let kept = fit(cands);
      // still too many? lots of top-level siblings (e.g. 1000 product cards in one grid): group them under their container
      if (kept.length > max) {
        const groups = new Map();
        for (const c of kept) if (!keptParent(c) && c.el.parentElement && c.el.parentElement !== this.root) {
          const g = groups.get(c.el.parentElement) || []; g.push(c); groups.set(c.el.parentElement, g);
        }
        const list = cands.slice();
        for (const [el, kids] of groups) {
          if (kids.length < 6) continue;
          const r = el.getBoundingClientRect();
          const S = { el, kind: 'box', parent: null, state: 'pending', tag: el.tagName.toLowerCase(), area: r.width * r.height, forcedKeep: true };
          kids.forEach(k => k.parent = S);
          list.splice(list.indexOf(kids[0]), 0, S); // container goes before its children
        }
        kept = fit(list);
      }
      for (const c of kept) c.parent = keptParent(c);
      return kept;
    }

    _hideAll() { this.layers.forEach(l => { l.state = 'pending'; this._restore(l); l.el.setAttribute('data-ab-state', 'pending'); }); }

    _rect(l) {
      if (!l.el.isConnected) return null;
      let r;
      if (l.kind === 'text') { const rg = document.createRange(); rg.selectNodeContents(l.el); r = rg.getBoundingClientRect(); }
      else r = l.el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    }

    _restore(l) {
      if (!l.saved) return;
      for (const [p, v, pr] of l.saved) v ? l.el.style.setProperty(p, v, pr) : l.el.style.removeProperty(p);
      l.saved = null;
    }
    _finish(l) { this._restore(l); l.state = 'done'; l.el.removeAttribute('data-ab-state'); }

    // ---------- public ----------
    async play() {
      if (!this.layers || this.destroyed) return;
      try {
        this._stop();
        // background tabs throttle animation frames: wait until the visitor can actually see the page
        if (document.hidden) await new Promise(r => { const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } }; document.addEventListener('visibilitychange', f); });
        if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, wait(1500)]);
        if (this.destroyed) return; // destroyed while we were waiting (e.g. React StrictMode remount)
        const o = this.o;
        // auto speed: fit the build into ~duration seconds (≈1.7s of work per piece per agent at speed 1)
        this.s = clamp(Math.max(o.speed, o.duration ? this.layers.length * 1.7 / (o.agents * o.duration) : 0), .1, 6);
        this.W = innerWidth; this.H = innerHeight;
        this.canvas = document.createElement('canvas'); this.canvas.className = 'ab-canvas';
        document.body.appendChild(this.canvas); this.ctx = this.canvas.getContext('2d'); this._resize();
        this._onResize = () => this._resize(); addEventListener('resize', this._onResize);
        this.follow = o.follow && document.documentElement.scrollHeight > innerHeight + 4;
        this.userAt = -1e9; this._onUser = () => { this.userAt = performance.now(); }; // pause auto-scroll while the visitor scrolls
        ['wheel', 'touchstart', 'touchmove', 'keydown', 'mousedown'].forEach(e => addEventListener(e, this._onUser, { passive: true }));

        // agents enter from the edges of the screen
        this.agents = Array.from({ length: o.agents }, (_, i) => {
          const side = i % 4, vx = scrollX, vy = scrollY;
          const x = side === 0 ? vx - 30 : side === 1 ? vx + this.W + 30 : vx + rand(0, this.W);
          const y = side === 2 ? vy - 30 : side === 3 ? vy + this.H + 30 : vy + rand(0, this.H);
          return { name: o.names[i % o.names.length], color: o.colors[i % o.colors.length], x, y, px: x, py: y, vx: 0, vy: 0,
            alpha: 0, task: null, mv: null, idleUntil: 0, delay: i * 70 / this.s };
        });
        this.tasks = []; this.fading = []; this.ripples = []; this.parts = []; this.exiting = false; this.finale = null;
        this.t0 = performance.now(); this.doneMs = 0;
        this.deadline = this.t0 + Math.max(60, (o.duration || 30) * 4) * 1000; // watchdog
        if (o.hud) this._makeHud();
        this.running = true; this.last = 0; this._lastY = undefined;
        this._onVis = () => {
          if (document.hidden) { this._hiddenAt = performance.now(); return; }
          if (this._hiddenAt == null) return;
          const d = performance.now() - this._hiddenAt; this._hiddenAt = null; this._shift(d); this._lastY = undefined;
        };
        document.addEventListener('visibilitychange', this._onVis);
        this.raf = requestAnimationFrame(this._loop);
      } catch (e) { this._fail(e); }
    }

    rebuild() {
      try {
        this._stop(); this._finishAll();
        this.layers = this._scan(); this._hideAll();
        const top = this.root === document.body ? 0 : Math.max(0, this.root.getBoundingClientRect().top + scrollY - 40);
        this._scroll(top); this.play();
      } catch (e) { this._fail(e); }
    }

    destroy() { this.destroyed = true; this._stop(true); this._finishAll(); this._io && this._io.disconnect(); }

    _stop(removeHud) {
      this.running = false; cancelAnimationFrame(this.raf);
      if (this.canvas) { this.canvas.remove(); this.canvas = null; }
      if (this._onResize) removeEventListener('resize', this._onResize);
      if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
      if (this._onUser) ['wheel', 'touchstart', 'touchmove', 'keydown', 'mousedown'].forEach(e => removeEventListener(e, this._onUser));
      if (this.tasks) this.tasks.forEach(t => { this._restore(t.l); if (t.l.state === 'active') { t.l.state = 'pending'; t.l.el.setAttribute('data-ab-state', 'pending'); } });
      this.tasks = [];
      if (removeHud && this.hud) { this.hud.remove(); this.hud = null; }
    }

    // move every timestamp forward by d ms (time spent hidden), so animations continue instead of jumping
    _shift(d) {
      this.t0 += d; this.deadline += d; this.userAt += d; this.last = 0;
      if (this.exitEnd) this.exitEnd += d;
      for (const t of this.tasks || []) if (t.t0) t.t0 += d;
      for (const a of this.agents || []) { if (a.mv) a.mv.t0 += d; a.idleUntil += d; }
      for (const x of [...(this.ripples || []), ...(this.fading || []), ...(this.parts || [])]) x.t0 += d;
      if (this.finale) this.finale.t0 += d;
    }

    _resize() {
      if (!this.canvas) return;
      this.W = innerWidth; this.H = innerHeight; this.dpr = Math.min(devicePixelRatio || 1, 2);
      Object.assign(this.canvas, { width: this.W * this.dpr, height: this.H * this.dpr });
      // CSS size must be the viewport size, otherwise HiDPI screens stretch the drawing and boxes miss their elements
      this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    }

    // ---------- motion ----------
    // Smooth cubic-bezier flight. If the agent is already moving, the curve starts along its current velocity (no jerk).
    _fly(a, x, y, now, slow = 1) {
      const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy) || 1;
      const dur = clamp(320 + d * .55, 360, 1200) * slow / this.s;
      const nx = -dy / d, ny = dx / d, bend = (Math.random() < .5 ? -1 : 1) * Math.min(d * .18, 90);
      const v = Math.hypot(a.vx, a.vy), moving = v > .05;
      let c1x = a.x + dx * .3 + nx * bend, c1y = a.y + dy * .3 + ny * bend;
      if (moving) { const k = Math.min(dur / 9, d * .5 / v); c1x = a.x + a.vx * k; c1y = a.y + a.vy * k; }
      a.mv = { x0: a.x, y0: a.y, x1: c1x, y1: c1y, x2: x - dx * .2 + nx * bend * .4, y2: y - dy * .2 + ny * bend * .4,
        x3: x, y3: y, t0: now, dur, ease: moving ? easeOut : easeIO };
    }
    _step(a, now) {
      const m = a.mv; if (!m) return true;
      const p = clamp((now - m.t0) / m.dur, 0, 1), e = m.ease(p);
      a.x = bez(m.x0, m.x1, m.x2, m.x3, e); a.y = bez(m.y0, m.y1, m.y2, m.y3, e);
      if (p >= 1) { a.mv = null; return true; }
      return false;
    }

    _loop = now => {
      try {
        // the page was frozen (minimised, background, sleep, debugger): treat the gap as paused time, don't jump ahead
        if (this.last && now - this.last > 250) this._shift(now - this.last - 16);
        const dt = this.last ? Math.min(50, now - this.last) : 16; this.last = now;
        if (!this.exiting && !this.finale && now > this.deadline) { this._finishAll(); this.tasks = []; }
        this._update(now, dt); this._draw(now);
        if (this.running) this.raf = requestAnimationFrame(this._loop);
      } catch (e) { this._fail(e); }
    };

    _update(now, dt) {
      const s = this.s;
      if (this._lastY !== undefined && Math.abs(scrollY - this._lastY) > 1) this.userAt = now;
      // hand out work: next pieces in document order (parents first) to the nearest free agent
      if (!this.exiting && !this.finale) {
        const free = this.agents.filter(a => !a.task && now - this.t0 > a.delay);
        const ready = [];
        if (free.length) {
          const top = scrollY - this.H * .2, bot = scrollY + this.H * 1.1;
          for (const l of this.layers) {
            if (l.state !== 'pending' || (l.parent && l.parent.state !== 'done')) continue;
            const r = this._rect(l);
            if (!r) { this._finish(l); continue; }
            l.r = r; l.inView = r.y < bot && r.y + r.h > top;
            ready.push(l);
            if (ready.length > 400) break;
          }
          ready.sort((a, b) => b.inView - a.inView); // stable: keeps page order inside each group
        }
        for (const l of ready) {
          if (!free.length) break;
          const r = l.r;
          free.sort((p, q) => Math.hypot(p.x - r.x, p.y - r.y) - Math.hypot(q.x - r.x, q.y - r.y));
          const a = free.shift(), t = { l, r, a, phase: 'fly', mx: 0, my: 0 };
          a.task = t; l.state = 'active'; this.tasks.push(t); this._fly(a, r.x, r.y, now);
        }
      }

      if (!this.finale) for (const a of this.agents) {
        const t = a.task;
        if (t) {
          t.r = this._rect(t.l) || t.r; const r = t.r;
          if (t.phase === 'fly') {
            if (a.mv) { a.mv.x3 = r.x; a.mv.y3 = r.y; }
            if (this._step(a, now)) {
              t.phase = 'select'; t.t0 = now; t.dur = (420 + Math.min(r.w + r.h, 900) * .45) / s;
              this.ripples.push({ x: a.x, y: a.y, t0: now, color: a.color }); // "click" before dragging
            }
          } else if (t.phase === 'select') {
            const e = easeIO(clamp((now - t.t0) / t.dur, 0, 1));
            t.mx = r.w * e; t.my = r.h * e; a.x = r.x + t.mx; a.y = r.y + t.my;
            if (now - t.t0 >= t.dur) this._startReveal(t, now);
          } else if (t.phase === 'reveal') {
            const p = clamp((now - t.t0) / t.dur, 0, 1), e = easeIO(p), X = -30 + 130 * e, el = t.l.el;
            const mask = `linear-gradient(90deg,#000 ${X}%,transparent ${X + 30}%)`;
            el.style.setProperty('mask-image', mask); el.style.setProperty('-webkit-mask-image', mask);
            if (t.l.kind !== 'box') el.style.setProperty('filter', `blur(${((1 - e) * 6).toFixed(2)}px)`);
            el.style.setProperty('translate', `0 ${((1 - e) * 8).toFixed(2)}px`);
            if (t.l.kind !== 'text') el.style.setProperty('scale', (.97 + .03 * e).toFixed(4));
            // the agent glides along the wipe front
            const er = t.l.el.getBoundingClientRect();
            const fx = clamp(er.left + scrollX + er.width * clamp((X + 15) / 100, 0, 1), r.x, r.x + r.w);
            const fy = r.y + (t.l.kind === 'text' ? r.h * .6 : r.h * .5);
            t.fx = fx; t.p = p;
            const k = 1 - Math.exp(-dt / 90); a.x += (fx - a.x) * k; a.y += (fy - a.y) * k;
            if (p >= 1) {
              this._finish(t.l); t.done = true; a.task = null; a.idleUntil = now + rand(150, 500) / s;
              this.fading.push({ r, t0: now, color: a.color });
            }
          }
        } else if (this.exiting) {
          this._step(a, now); a.alpha = a.mv ? 1 - easeIO(clamp((now - a.mv.t0) / a.mv.dur, 0, 1)) : 0;
        } else {
          // idle: drift calmly around the visible area
          if (!a.mv && now > a.idleUntil && now - this.t0 > a.delay) {
            this._fly(a, scrollX + rand(this.W * .1, this.W * .9), scrollY + rand(this.H * .15, this.H * .8), now, 2.2);
          } else if (a.mv && this._step(a, now)) a.idleUntil = now + rand(400, 1400);
        }
        if (!this.exiting && now - this.t0 > a.delay) a.alpha = Math.min(1, a.alpha + dt / 350);
        a.vx = (a.x - a.px) / dt; a.vy = (a.y - a.py) / dt; a.px = a.x; a.py = a.y;
      }
      this.tasks = this.tasks.filter(t => !t.done && t.l.state === 'active');
      this.agents.forEach(a => { if (a.task && !this.tasks.includes(a.task)) a.task = null; });
      this.fading = this.fading.filter(f => now - f.t0 < 420);

      // keep the build in view
      if (this.follow && this.tasks.length && !this.finale && now - this.userAt > 2500) { // resumes 2.5s after the visitor stops scrolling
        const top = Math.min(...this.tasks.map(t => t.r.y));
        const want = clamp(top - this.H * .3, 0, document.documentElement.scrollHeight - this.H);
        if (Math.abs(want - scrollY) > 1) this._scroll(scrollY + (want - scrollY) * (1 - Math.exp(-dt / 450)));
      }

      // finished: finale (or straight exit), then clean up
      if (!this.exiting && !this.finale && this.layers.every(l => l.state === 'done')) {
        this.doneMs = now - this.t0;
        this.root.dispatchEvent(new CustomEvent('agentbuild:done', { bubbles: true, detail: { ms: this.doneMs, layers: this.layers.length } }));
        !this.o.finale || reduced() ? this._exit(now) : this._startFinale(now);
      }
      if (this.finale) this._updateFinale(now);

      // effects
      this.ripples = this.ripples.filter(r => now - r.t0 < 500);
      for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += .0006 * dt; p.vx *= .985; p.vy *= .985; }
      this.parts = this.parts.filter(p => now - p.t0 < p.life);

      if (this.exiting && now > this.exitEnd) {
        this._stop(); // removes canvas AND every listener (resize after finishing used to crash)
        if (this.hud) setTimeout(() => { if (this.hud && !this.running) this.hud.classList.add('ab-hide'); }, 2600);
      }
      this._updateHud(now);
      this._lastY = scrollY; // our own scrolling is done for this frame; any change before next frame came from the visitor
    }

    _scroll(y) { scrollTo({ left: scrollX, top: y, behavior: 'instant' }); }

    _exit(now) {
      this.exiting = true; this.finale = null;
      for (const a of this.agents) {
        const vx = scrollX, vy = scrollY, cx = a.x - vx, cy = a.y - vy;
        const ex = cx < this.W / 2 ? vx - 60 : vx + this.W + 60;
        this._fly(a, ex, a.y + rand(-80, 80) + (cy < this.H / 2 ? -40 : 40), now + rand(0, 250), 1.3);
      }
      this.exitEnd = now + 1800;
    }

    // ---------- finale: agents spread out → rise together in a wave while the page scrolls to top → leave off the top ----------
    _startFinale(now) {
      this.follow = false;
      const A = this.agents, n = A.length;
      this.finale = { phase: 'spread', t0: now };
      A.forEach((a, i) => {
        a.alpha = 1; a.mv = null; a.hist = [];
        a.sx = n === 1 ? .5 : .08 + .84 * i / (n - 1); // evenly separated across the width
        this._fly(a, scrollX + this.W * a.sx, scrollY + this.H * .86, now + i * 30, .9);
      });
    }

    _updateFinale(now) {
      const f = this.finale, A = this.agents, n = A.length;
      if (f.phase === 'spread') {
        let all = true; for (const a of A) if (!this._step(a, now)) all = false;
        if (all || now - f.t0 > 1800) { f.phase = 'rise'; f.t0 = now; f.s0 = scrollY; f.dur = clamp(1400 + scrollY * .5, 1800, 3600) / Math.sqrt(Math.min(this.s, 3)); }
      } else if (f.phase === 'rise') {
        const p = clamp((now - f.t0) / f.dur, 0, 1);
        if (this.userAt < f.t0) this._scroll(f.s0 * (1 - easeIO(clamp(p / .85, 0, 1)))); // page reaches the top a little before the agents leave (unless the visitor took over)
        const amp = 34 * Math.sin(Math.PI * Math.min(1, p * 1.4)); // wave grows in, then settles
        A.forEach((a, i) => {
          // each agent lags a little behind its neighbour, so the line ripples like a wave as it climbs
          const lag = (Math.sin(i / Math.max(1, n - 1) * Math.PI * 2) * .5 + .5) * .12;
          const e = easeIO(clamp((p - lag) / (1 - .12), 0, 1));
          const sy = this.H * .86 - (this.H * .86 + 140) * e;
          const wave = Math.sin(i * .9 - now / 170) * amp;
          a.x = scrollX + this.W * a.sx + Math.sin(now / 260 + i) * 6;
          a.y = scrollY + sy + wave;
          a.alpha = clamp((sy + wave + 40) / 140, 0, 1); // fade as they cross the top edge
        });
        if (p >= 1) { this.finale = null; this.exiting = true; this.exitEnd = now; }
      }
      // trail kept in screen space, so page scrolling doesn't stretch it
      for (const a of A) { (a.hist ||= []).unshift({ x: a.x - scrollX, y: a.y - scrollY, al: a.alpha }); if (a.hist.length > 14) a.hist.pop(); }
    }

    _drawFinale() {
      const c = this.ctx, f = this.finale; if (!f || f.phase !== 'rise') return;
      for (const a of this.agents) {
        const h = a.hist || []; if (h.length < 2) continue;
        c.save(); c.lineCap = 'round'; c.shadowColor = a.color; c.shadowBlur = 10;
        let len = 0;
        for (let i = 1; i < h.length; i++) {
          len += Math.hypot(h[i].x - h[i - 1].x, h[i].y - h[i - 1].y);
          if (len > 80) break; // short comet tail regardless of frame rate
          c.globalAlpha = .5 * (1 - i / h.length) * h[i].al; c.strokeStyle = a.color; c.lineWidth = 3 * (1 - i / h.length) + .4;
          c.beginPath(); c.moveTo(h[i - 1].x + scrollX, h[i - 1].y + scrollY + 4); c.lineTo(h[i].x + scrollX, h[i].y + scrollY + 4); c.stroke();
        }
        c.restore();
      }
    }

    _startReveal(t, now) {
      const l = t.l, el = l.el;
      l.saved = STYLE_PROPS.map(p => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      const mask = 'linear-gradient(90deg,#000 -30%,transparent 0%)';
      el.style.setProperty('mask-image', mask); el.style.setProperty('-webkit-mask-image', mask);
      el.removeAttribute('data-ab-state');
      t.phase = 'reveal'; t.t0 = now;
      t.dur = (l.kind === 'text' ? clamp(380 + l.el.textContent.length * 9, 500, 1300) : 700) / this.s;
    }

    // ---------- drawing ----------
    _draw(now) {
      if (!this.canvas) return;
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, this.W, this.H); c.translate(-scrollX, -scrollY);
      for (const f of this.fading) this._box(f.r.x, f.r.y, f.r.w, f.r.h, f.color, .5 * (1 - easeOut((now - f.t0) / 420)), false);
      for (const t of this.tasks) {
        if (t.phase === 'select') { this._box(t.r.x, t.r.y, t.mx, t.my, t.a.color, 1, true); this._badge(t, t.mx, t.my); }
        else if (t.phase === 'reveal') {
          const p = clamp((now - t.t0) / t.dur, 0, 1); this._box(t.r.x, t.r.y, t.r.w, t.r.h, t.a.color, 1 - p * .5, true); this._badge(t, t.r.w, t.r.h, 1 - p);
          if (t.fx != null) { // glowing scan bar on the wipe edge
            c.save(); c.globalAlpha = Math.sin(Math.PI * p); c.shadowColor = t.a.color; c.shadowBlur = 12;
            const g = c.createLinearGradient(0, t.r.y, 0, t.r.y + t.r.h);
            g.addColorStop(0, rgba(t.a.color, 0)); g.addColorStop(.5, t.a.color); g.addColorStop(1, rgba(t.a.color, 0));
            c.fillStyle = g; c.fillRect(t.fx - 1, t.r.y - 4, 2, t.r.h + 8); c.restore();
          }
        }
      }
      for (const r of this.ripples) {
        const e = easeOut((now - r.t0) / 500);
        c.globalAlpha = 1 - e; c.strokeStyle = r.color; c.lineWidth = 2;
        c.beginPath(); c.arc(r.x, r.y, 3 + e * 16, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
      }
      this._drawFinale();
      for (const p of this.parts) {
        c.globalAlpha = 1 - (now - p.t0) / p.life; c.fillStyle = p.color;
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
      for (const a of this.agents) if (a.alpha > .01) this._cursor(a);
    }
    _box(x, y, w, h, color, alpha, handles) {
      const c = this.ctx; c.globalAlpha = alpha;
      c.fillStyle = rgba(color, .07); c.fillRect(x, y, w, h);
      c.strokeStyle = color; c.lineWidth = 1; c.strokeRect(Math.round(x) + .5, Math.round(y) + .5, Math.round(w), Math.round(h));
      if (handles && w > 8 && h > 8) {
        c.fillStyle = '#fff';
        for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { c.fillRect(hx - 3, hy - 3, 6, 6); c.strokeRect(Math.round(hx - 3) + .5, Math.round(hy - 3) + .5, 6, 6); }
      }
      c.globalAlpha = 1;
    }
    _badge(t, w, h, alpha = 1) {
      if (t.r.w < 48 || t.r.h < 12) return; // tiny pieces (dots, icons) get no label: avoids stacked clutter
      const c = this.ctx, txt = `${t.l.tag}  ${Math.round(w)} × ${Math.round(h)}`;
      c.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      // sits above the box's top-left corner (Figma-style) so it never collides with the cursor + name at the bottom-right
      const bw = c.measureText(txt).width + 12, x = t.r.x, y = Math.max(scrollY + 2, t.r.y - 22);
      c.globalAlpha = alpha; c.fillStyle = t.a.color; c.beginPath(); c.roundRect(x, y, bw, 17, 4); c.fill();
      c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(txt, x + 6, y + 9); c.globalAlpha = 1;
    }
    _cursor(a) {
      const c = this.ctx; c.save(); c.globalAlpha = a.alpha; c.translate(a.x, a.y);
      c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 16); c.lineTo(4.2, 12.1); c.lineTo(7, 18.2); c.lineTo(9.7, 17); c.lineTo(7, 11); c.lineTo(12.6, 11); c.closePath();
      c.fillStyle = a.color; c.fill(); c.shadowColor = 'transparent'; c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.stroke();
      if (this.o.showNames) {
        c.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif';
        const w = c.measureText(a.name).width + 16;
        c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 8; c.shadowOffsetY = 2;
        c.fillStyle = a.color; c.beginPath(); c.roundRect(11, 17, w, 20, 10); c.fill();
        c.shadowColor = 'transparent'; c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(a.name, 19, 27.5);
      }
      c.restore();
    }

    // ---------- HUD ----------
    _makeHud() {
      if (!this.hud) {
        this.hud = document.createElement('div'); this.hud.className = 'ab-hud ab-hide';
        this.hud.innerHTML = `<div class="ab-av"></div><div class="ab-tx"><b></b><span></span></div><div class="ab-bar"><i></i></div><button type="button">Replay</button>`;
        this.hud.querySelector('button').onclick = () => this.rebuild();
        document.body.appendChild(this.hud);
      }
      this.hud.querySelector('.ab-av').innerHTML = this.agents.slice(0, 5).map(a => `<i style="background:${a.color}">${a.name[0]}</i>`).join('');
      requestAnimationFrame(() => this.hud && this.hud.classList.remove('ab-hide'));
      this._hudKey = '';
    }
    _updateHud(now) {
      if (!this.hud) return;
      const done = this.layers.filter(l => l.state === 'done').length, n = this.layers.length;
      const key = this.doneMs ? 'done' : done + '/' + Math.floor((now - this.t0) / 100);
      if (key === this._hudKey) return; this._hudKey = key;
      const b = this.hud.querySelector('b'), sp = this.hud.querySelector('.ab-tx span');
      if (this.doneMs) { b.textContent = '✓ Built'; sp.textContent = `${this.agents.length} agents · ${(this.doneMs / 1000).toFixed(1)}s`; }
      else { b.textContent = `${this.agents.filter(a => a.task).length} agents building`; sp.textContent = `${done} / ${n} layers`; }
      this.hud.querySelector('.ab-bar i').style.width = (n ? done / n * 100 : 100) + '%';
    }
  }

  // ======================================================================================
  // <agent-build> wrapper element
  class AgentBuildElement extends HTMLElement {
    connectedCallback() {
      if (this.engine) return;
      const g = n => this.getAttribute(n);
      this.engine = new Builder(this, {
        agents: g('agents'), speed: g('speed'), duration: g('duration'), maxLayers: g('max-layers'),
        names: g('names'), colors: g('colors'), hud: this.hasAttribute('hud') ? true : undefined,
        trigger: g('trigger'), follow: g('follow'), finale: g('finale'),
      });
      this.engine.start();
    }
    disconnectedCallback() { if (this.engine) { this.engine.destroy(); this.engine = null; } }
    play() { this.engine && this.engine.play(); }
    rebuild() { this.engine && this.engine.rebuild(); }
  }
  if (!customElements.get('agent-build')) customElements.define('agent-build', AgentBuildElement);

  window.AgentBuild = {
    attach(root = document.body, opts = {}) { const b = new Builder(root, opts); b.ready = b.start(); return b; },
  };

  // <script src="agent-build.js" data-body ...>  → build the whole website in place
  const me = document.currentScript;
  if (me && me.hasAttribute('data-body')) {
    const d = me.dataset;
    document.documentElement.setAttribute('data-ab-boot', '');
    setTimeout(() => document.documentElement.removeAttribute('data-ab-boot'), 5000); // safety: never keep the page hidden
    domReady().then(() => {
      window.agentBuild = window.AgentBuild.attach(document.body, {
        agents: d.agents, speed: d.speed, duration: d.duration, maxLayers: d.maxLayers, names: d.names, colors: d.colors,
        hud: 'hud' in d ? true : undefined, trigger: d.trigger, follow: d.follow, finale: d.finale,
      });
    });
  }
})();
