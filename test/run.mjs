// Cross-site test for agent-build.js — drives headless Chromium over the DevTools protocol (Node 22, no deps).
// usage: node test/run.mjs <outDir> [url ...]
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] || './out'); mkdirSync(OUT, { recursive: true });
const LIB = readFileSync(resolve(here, '../agent-build.js'), 'utf8');
const local = f => 'file://' + resolve(here, f);
const SITES = process.argv.slice(3).length ? process.argv.slice(3) : [
  local('fixture-tricky.html'), local('fixture-appshell.html'), local('fixture-huge.html'), local('demo-body-mode.html'),
  'https://example.com', 'https://en.wikipedia.org/wiki/Cursor_(user_interface)', 'https://news.ycombinator.com',
  'https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image', 'https://github.com', 'https://tailwindcss.com',
  'https://stripe.com', 'https://vercel.com', 'https://www.bbc.com/news', 'https://www.apple.com',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = +(process.env.PORT || 9333);
const HEADED = !!process.env.HEADED; // HEADED=1 opens a real visible window so you can watch

const chrome = spawn('chromium', [...(HEADED ? ['--new-window'] : ['--headless=new']), `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/profile`,
  '--window-size=1280,800', '--no-first-run', '--mute-audio', '--disable-gpu-sandbox', 'about:blank'], { stdio: 'ignore' });
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(200); } }

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(), handlers = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else handlers.forEach(h => h(d)); };
  // every call times out, so a closed/crashed tab can't hang the whole run
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); try { ws.send(JSON.stringify({ id: i, method, params })); } catch (e) { j(e); } setTimeout(() => { if (pend.has(i)) { pend.delete(i); j(new Error('timeout ' + method)); } }, 30000); });
  ws.onclose = () => { for (const [i, r] of pend) r({ error: 'closed' }); pend.clear(); };
  return { send, on: h => handlers.push(h), close: () => ws.close() };
}
const evaluate = async (s, expr) => { const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
const shot = async (s, file) => { const r = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); if (r.result) writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
// structural similarity of before/after screenshots (1.0 = identical) — proves the page ends exactly as it started
function require_ssim(a, b) {
  try {
    const out = execFileSync('bash', ['-c', `ffmpeg -v info -i "${a}" -i "${b}" -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*' | tail -1`], { encoding: 'utf8' });
    return parseFloat(out.split(':')[1]);
  } catch { return null; }
}

const results = [];
for (const url of SITES) {
  const name = url.replace(/^https?:\/\/|^file:\/\/.*\//g, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
  const res = { name, url };
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const s = await connect(t.webSocketDebuggerUrl);
  const errors = [];
  s.on(d => {
    if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; const txt = (x.exception?.description || x.text || '').slice(0, 200); if (/agent-build|AgentBuild|Builder/.test(txt + (x.url || ''))) errors.push(txt); }
    if (d.method === 'Runtime.consoleAPICalled') { const txt = d.params.args.map(a => a.value ?? a.description ?? '').join(' '); if (txt.includes('[agent-build]')) errors.push(txt.slice(0, 200)); }
  });
  try {
    await s.send('Page.enable'); await s.send('Runtime.enable'); await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // headless tabs otherwise start hidden await s.send('Page.setBypassCSP', { enabled: true });
    if (!HEADED) await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const loaded = new Promise(r => s.on(d => d.method === 'Page.loadEventFired' && r()));
    await s.send('Page.bringToFront'); // background tabs throttle rAF to ~1fps
    await s.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(25000)]); await sleep(2500);
    const autoMode = await evaluate(s, '!!window.agentBuild');
    if (!autoMode) { await evaluate(s, 'scrollTo(0,0)'); await sleep(400); await shot(s, `${OUT}/${name}_1before.jpg`); }
    const preMasks = await evaluate(s, `[...document.querySelectorAll('[style*="mask-image"]')].length`);
    await evaluate(s, `(() => {
      ${autoMode ? '' : LIB}
      window.__ab = window.agentBuild || AgentBuild.attach(document.body, { agents: 8, hud: true, duration: 14 });
      { const B = window.__ab; window.__cost = { ms: 0, n: 0, max: 0 }; for (const k of ['_update', '_draw']) { const f = B[k].bind(B); B[k] = (...a) => { const t = performance.now(); const r = f(...a); const d = performance.now() - t; window.__cost.ms += d; if (k === '_update') window.__cost.n++; if (d > window.__cost.max) window.__cost.max = d; return r; }; } }
      window.__abDone = null; document.addEventListener('agentbuild:done', e => window.__abDone = e.detail, true);
      window.__fr = { n: 0, max: 0, sum: 0, last: 0 };
      const tick = t => { const f = window.__fr; if (f.last) { const d = t - f.last; f.n++; f.sum += d; if (d > f.max) f.max = d; } f.last = t; if (!window.__frStop) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    })()`);
    const t0 = Date.now(); let midShot = false, st;
    while (Date.now() - t0 < 75000) {
      await sleep(400);
      st = await evaluate(s, `(() => { const b = window.__ab; const L = b.layers || []; return { layers: L.length, done: L.filter(l => l.state === 'done').length,
        running: !!b.running, finale: b.finale ? b.finale.phase : null, exiting: !!b.exiting, speed: b.s, doneEvt: window.__abDone, sy: Math.round(scrollY) }; })()`);
      if (!midShot && st && st.layers && st.done / st.layers > .35) { await shot(s, `${OUT}/${name}_2mid.jpg`); midShot = true; }
      // behaviour test 1: the visitor scrolls mid-build → page must stay where they put it, then auto-follow resumes
      if (!res.scrollTest && st && st.layers > 20 && st.done / st.layers > .25 && st.done / st.layers < .6) {
        const y0 = await evaluate(s, 'Math.round(scrollY)');
        const maxY = await evaluate(s, 'document.documentElement.scrollHeight - innerHeight');
        await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: y0 > maxY / 2 ? -900 : 900 });
        await sleep(300); const yUser = await evaluate(s, 'Math.round(scrollY)');
        await sleep(1500); const yHeld = await evaluate(s, 'Math.round(scrollY)');
        await sleep(2500); const yAfter = await evaluate(s, 'Math.round(scrollY)');
        const inView = await evaluate(s, `window.__ab.agents.filter(a => a.y > scrollY - 20 && a.y < scrollY + innerHeight + 20).length`);
        res.scrollTest = { y0, yUser, yHeld, yAfter, heldOk: Math.abs(yHeld - yUser) < 40, agentsInViewAfter: inView };
      }
      // behaviour test 2: the page is frozen for 4s (like minimising) → build must not jump ahead, and must still finish
      if (!res.freezeTest && st && st.layers > 20 && st.done / st.layers > .6 && st.done / st.layers < .9 && !st.finale) {
        const before = await evaluate(s, 'window.__ab.layers.filter(l => l.state === "done").length'); // measured right before freezing
        await s.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(4000);
        await s.send('Page.setWebLifecycleState', { state: 'active' });
        await s.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // headless stays "hidden" after unfreeze; a real restored window becomes visible
        await sleep(150);
        const after = await evaluate(s, 'window.__ab.layers.filter(l => l.state === "done").length');
        res.freezeTest = { before, after, jump: after - before };
      }
      if (st && st.doneEvt && !st.running) break;
    }
    res.wallMs = Date.now() - t0;
    Object.assign(res, st);
    const fr = await evaluate(s, 'window.__frStop = true; window.__fr');
    res.avgFrameMs = fr && fr.n ? +(fr.sum / fr.n).toFixed(1) : null; res.maxFrameMs = fr ? Math.round(fr.max) : null;
    const cost = await evaluate(s, 'window.__cost');
    res.ourMsPerFrame = cost && cost.n ? +(cost.ms / cost.n).toFixed(2) : null; res.ourMaxMs = cost ? Math.round(cost.max) : null;
    res.ourMasksLeft = await evaluate(s, `[...document.querySelectorAll('[style*="mask-image"]')].filter(e => /90deg/.test(e.style.maskImage) && /transparent/.test(e.style.maskImage)).map(e => e.tagName + '.' + (e.className && e.className.baseVal === undefined ? String(e.className).slice(0, 30) : '')).slice(0, 5)`);
    res.leftHidden = await evaluate(s, `document.querySelectorAll('[data-ab-state]').length`);
    res.leftMasks = (await evaluate(s, `[...document.querySelectorAll('[style*="mask-image"]')].length`)) - preMasks;
    res.canvasLeft = await evaluate(s, `!!document.querySelector('.ab-canvas')`);
    res.bootLeft = await evaluate(s, `document.documentElement.hasAttribute('data-ab-boot')`);
    await evaluate(s, 'scrollTo(0,0)'); await sleep(3200); // let the HUD fade
    await shot(s, `${OUT}/${name}_3after.jpg`);
    if (!autoMode) res.ssim = require_ssim(`${OUT}/${name}_1before.jpg`, `${OUT}/${name}_3after.jpg`);
  } catch (e) { res.runnerError = String(e).slice(0, 200); }
  res.errors = errors;
  results.push(res); console.log(JSON.stringify(res));
  try { s.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`); } catch {}
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
chrome.kill();
