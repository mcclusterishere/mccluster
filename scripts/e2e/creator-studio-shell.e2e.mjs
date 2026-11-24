/* CREATOR STUDIO SHELL + TAKE BENCH, IN A REAL BROWSER.
   ============================================================
   Serves this checkout on loopback, drives a Chromium browser over the DevTools
   protocol (no dependency: Node's own WebSocket), and writes screenshots and a
   measurements.json. Every request that is not loopback is blocked, so nothing
   reaches production and nothing is uploaded.

   The studio is shown to a signed-out browser by un-hiding it in the page:
   #creatorGate is hidden, #creatorApp is shown, and so are the profile form
   (#creatorIdentity) and the analytics card, which the page keeps hidden until
   a creator signs in. That is a capture aid, not a signed-in session: no
   profile, release or statistic is real, and the upload path is not exercised.

     node scripts/e2e/creator-studio-shell.e2e.mjs [outDir]
   CREATOR_STUDIO_BROWSER=<path to msedge.exe or chrome>   (required off Windows)
   CREATOR_STUDIO_BEFORE=<file>  a creator.html to capture as "before" (for example
                                 the output of: git show origin/main:creator.html)
   ============================================================ */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(HERE, 'docs/music/creator-studio/screenshots');
const BEFORE = process.env.CREATOR_STUDIO_BEFORE || '';
const BROWSER = process.env.CREATOR_STUDIO_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome'
].find((p) => existsSync(p));
if (!BROWSER) { console.error('No browser found: set CREATOR_STUDIO_BROWSER.'); process.exit(2); }
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try {
    const body = (path === '/creator-before.html' || path === '\\creator-before.html') && BEFORE
      ? await readFile(BEFORE) : await readFile(join(HERE, path === '/' || path === '\\' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- a browser over CDP ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(extra = []) {
  const profile = await mkdtemp(join(tmpdir(), 'creator-studio-e2e-'));
  const proc = spawn(BROWSER, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', ...extra, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = '';
  const seen = new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (c) => { buf += c; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { wsUrl = m[1]; resolve(); } });
    proc.on('exit', () => reject(new Error('browser exited before DevTools was ready')));
    setTimeout(() => reject(new Error('no DevTools endpoint after 30s')), 30000);
  });
  await seen;
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const waits = new Map(); const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waits.has(msg.id)) { const w = waits.get(msg.id); waits.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
    else listeners.forEach((fn) => fn(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id; waits.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  async function page() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
    /* key presses reach the page as they would in a focused window */
    await s('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    /* loopback only: nothing leaves this machine */
    const BLOCKED = ['*://*.supabase.co/*', '*://*.mccluster.org/*', '*://*.googleapis.com/*', '*://*.gstatic.com/*', '*://*.cloudflare.com/*', '*://*.cloudflareinsights.com/*', 'https://*'];
    const block = (more = []) => s('Network.setBlockedURLs', { urls: BLOCKED.concat(more) });
    await block();
    const errors = [], dialogs = [];
    listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      /* "Leave site?" while a recording runs: noted, then accepted so the run can go on */
      if (msg.method === 'Page.javascriptDialogOpening') { dialogs.push(msg.params.type); s('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
    });
    const ev = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const goto = async (url) => {
      const loaded = new Promise((resolve) => {
        const fn = (msg) => { if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(fn), 1); resolve(); } };
        listeners.push(fn);
      });
      /* through about:blank, so a change of #chapter is a real load and not a same-page jump */
      await s('Page.navigate', { url: 'about:blank' });
      await sleep(150);
      await s('Page.navigate', { url });
      await Promise.race([loaded, sleep(15000)]);
      /* a "Leave site?" answer can delay the first hop, so the load event seen may be about:blank's: wait for
         the page that was asked for */
      const want = url.split('#')[0];
      for (let i = 0; i < 100; i++) {
        const at = await ev(`document.readyState === 'complete' ? location.href.split('#')[0] : ''`).catch(() => '');
        if (at === want) break;
        await sleep(100);
      }
      await sleep(500);
    };
    const size = async (width, height, mobile) => {
      now = { width, height, mobile: !!mobile };
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
      await s('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: 5 });
    };
    const waitFor = async (expression, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await ev(expression)) return true; await sleep(100); }
      return false;
    };
    let now = { width: 390, height: 844, mobile: true };
    const shot = async (name, full = true) => {
      /* a whole-page picture is taken by making the window as tall as the page, so the page is laid out and
         painted once, as itself; the shared bottom bar and account chip are fixed, so they sit at the window's
         edges (the very top and the very bottom of the picture) */
      if (full) {
        await ev('window.scrollTo(0, 0)');
        const h = await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)');
        await s('Emulation.setDeviceMetricsOverride', { width: now.width, height: Math.min(Math.max(h, now.height), 9000), deviceScaleFactor: now.mobile ? 2 : 1, mobile: now.mobile });
        await sleep(350);
      }
      const r = await s('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
      if (full) { await s('Emulation.setDeviceMetricsOverride', { width: now.width, height: now.height, deviceScaleFactor: now.mobile ? 2 : 1, mobile: now.mobile }); await sleep(150); }
      return name + '.png';
    };
    return { s, ev, goto, size, waitFor, shot, errors, dialogs, block, targetId };
  }
  async function close() {
    try { await send('Browser.close'); } catch {}
    await sleep(600);
    try { proc.kill(); } catch {}
    await sleep(300);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  }
  return { page, close, send };
}

/* ---------- in-page helpers ---------- */
/* answer the site's privacy notice with "Not now" (nothing that needs agreement starts), then show the studio */
const REVEAL = `(() => {
  const gate = document.getElementById('mccPrivacyGate');
  if (gate) {
    const later = Array.from(gate.querySelectorAll('button')).find((b) => /not now/i.test(b.textContent));
    if (later) later.click();
    if (document.documentElement.getAttribute('data-privacy-gate')) {
      gate.remove(); document.getElementById('mccPrivacyGateStyle')?.remove(); document.documentElement.removeAttribute('data-privacy-gate');
    }
  }
  const banner = document.getElementById('mccPrivacyBanner'); if (banner) banner.remove();
  document.getElementById('creatorGate').hidden = true;
  document.getElementById('creatorApp').hidden = false;
  document.getElementById('creatorIdentity').hidden = false;
  const stats = document.getElementById('selfMusicAnalytics').closest('section'); if (stats) stats.hidden = false;
  window.dispatchEvent(new Event('resize'));
  return true;
})()`;
/* smallest rendered text, smallest interactive target, and sideways overflow, inside #creatorApp */
const MEASURE = `(() => {
  const app = document.getElementById('creatorApp');
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  let minFont = Infinity, minFontOn = '';
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement; if (!el || !vis(el) || el.closest('[hidden]')) continue;
    const f = parseFloat(getComputedStyle(el).fontSize);
    if (f < minFont) { minFont = f; minFontOn = (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')) + ' "' + n.nodeValue.trim().slice(0, 32) + '"'; }
  }
  let minControlFont = Infinity;
  app.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]),select,textarea').forEach((el) => {
    if (!vis(el)) return; minControlFont = Math.min(minControlFont, parseFloat(getComputedStyle(el).fontSize));
  });
  const targets = [], inline = [];
  app.querySelectorAll('a[href],button,input,select,textarea,[role=slider],[role=tab]').forEach((el) => {
    if (!vis(el) || el.closest('[hidden]')) return;
    let box = el;
    /* a checkbox is pressed through its label: the label is the target */
    if (el.matches('input[type=checkbox],input[type=radio]')) box = el.closest('label') || el;
    const r = box.getBoundingClientRect();
    const rec = { what: (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    /* a link inside a sentence is exempt from the target size (WCAG 2.5.8, inline) and is listed apart */
    if (el.matches('a') && !el.matches('.creator-btn,.cs-tab') && getComputedStyle(el).display === 'inline') inline.push(rec); else targets.push(rec);
  });
  targets.sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
  const de = document.documentElement;
  return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, bodyScrollWidth: document.body.scrollWidth, pageHeight: de.scrollHeight,
    minFontPx: minFont, minFontOn, minControlFontPx: minControlFont, targets: targets.length,
    smallestTarget: targets[0] || null, under44: targets.filter((t) => Math.min(t.w, t.h) < 43.95), inlineTextLinks: inline };
})()`;

const report = { base: 'loopback', browser: BROWSER.split(/[\\/]/).pop(), revealed: '#creatorGate hidden; #creatorApp, #creatorIdentity and the analytics card un-hidden in the page (signed out)', screenshots: [], chapters: {}, before: {}, shell: {}, bench: {}, recording: {}, errors: [] };
const CHAPTERS = ['make', 'releases', 'page', 'stats'];
const SIZES = [[390, 844, true], [1280, 900, false]];

/* ---------- the review findings, each measured in the page ---------- */
const TONE = (name, seconds, sr = 44100, ch = 1) => `(async () => {
  const P = window.MCC_TAKE_BENCH.pure, n = Math.round(${sr} * ${seconds}), a = new Float32Array(n);
  /* whole 16-bit steps, so "the samples it went in with" can be checked exactly */
  for (let i = 0; i < n; i++) a[i] = Math.round(0.6 * 32767 * Math.sin(2 * Math.PI * 440 * i / ${sr})) / 32768;
  const chans = []; for (let c = 0; c < ${ch}; c++) chans.push(a);
  window.__src = P.encodeWav(chans, ${sr});
  return window.MCC_TAKE_BENCH.importFile(new File([window.__src], ${JSON.stringify(name)} + '.wav', { type: 'audio/wav' }));
})()`;
const SAVE = `window.MCC_TAKE_BENCH.save().then((t) => t && t.id)`;
const WIPE = `(async () => {
  for (let i = 0; i < 30; i++) {
    const b = document.querySelector('#tbTakes [data-take-act="delete"]'); if (!b) break;
    const n = document.querySelectorAll('#tbTakes [data-take]').length;
    b.click(); b.click();
    for (let k = 0; k < 60 && document.querySelectorAll('#tbTakes [data-take]').length === n; k++) await new Promise((r) => setTimeout(r, 50));
  }
  return document.querySelectorAll('#tbTakes [data-take]').length;
})()`;
const IDLE = '!window.MCC_TAKE_BENCH.state().busy && !window.MCC_TAKE_BENCH.state().recording && !window.MCC_TAKE_BENCH.state().pending';

async function findings(p) {
  const F = report.findings = {};
  const check = async (name, fn) => { try { F[name] = await fn(); } catch (e) { F[name] = { error: String((e && e.message) || e) }; } };
  const fresh = async (tail = '#make') => { await p.goto(BASE + '/creator.html' + tail); await p.ev(REVEAL); await sleep(300); };
  const VK = { Tab: 9, Enter: 13, Escape: 27 };
  const press = async (key, modifiers = 0) => {
    await p.s('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: VK[key], modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await p.s('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: VK[key], modifiers });
    await sleep(70);
  };
  const state = () => p.ev('window.MCC_TAKE_BENCH.state()');
  const focusId = () => p.ev(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : ''`);
  await p.size(390, 844, true);

  await fresh('');
  await check('roles', () => p.ev(`({ tablists: document.querySelectorAll('[role=tablist]').length, tabs: document.querySelectorAll('[role=tab]').length, panels: document.querySelectorAll('[role=tabpanel]').length, selected: document.querySelectorAll('[role=tab][aria-selected=true]').length, panelTabIndex: Array.from(document.querySelectorAll('[role=tabpanel]')).map((x) => x.tabIndex), labelled: Array.from(document.querySelectorAll('[role=tabpanel]')).every((x) => document.getElementById(x.getAttribute('aria-labelledby'))) })`));

  /* mnet.html links to creator.html#artistAnalyticsHeading; that heading is in the Stats chapter */
  await fresh('#artistAnalyticsHeading');
  await check('deepLink', async () => {
    const out = await p.ev(`({ chapter: window.MCC_STUDIO_SHELL.current(), statsShown: !document.getElementById('cs-panel-stats').hidden, selected: document.querySelector('[role=tab][aria-selected=true]').textContent, headingInView: (() => { const r = document.getElementById('artistAnalyticsHeading').getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; })() })`);
    await p.ev(`location.hash = 'creatorHandle'`); await sleep(350);
    out.inPage = await p.ev('window.MCC_STUDIO_SHELL.current()');
    out.fieldClearOfRow = await p.ev(`document.getElementById('creatorHandle').getBoundingClientRect().top >= document.getElementById('creatorChapters').getBoundingClientRect().bottom`);
    await p.ev(`location.hash = 'nothing-by-this-name'`); await sleep(200);
    out.unknownLeavesChapter = await p.ev('window.MCC_STUDIO_SHELL.current()');
    return out;
  });

  await check('back', async () => {
    await p.goto(BASE + '/creator.html'); await p.ev(REVEAL); await sleep(300);
    const out = { entry: await p.ev('window.MCC_STUDIO_SHELL.current()') };
    await p.ev(`document.getElementById('cs-tab-releases').click()`); await sleep(150);
    await p.ev(`document.getElementById('cs-tab-page').click()`); await sleep(150);
    await p.ev('history.back()'); await sleep(400);
    out.afterOneBack = await p.ev('window.MCC_STUDIO_SHELL.current()');
    await p.ev('history.back()'); await sleep(400);
    out.afterTwoBacks = await p.ev('window.MCC_STUDIO_SHELL.current()');
    out.hashAfterTwoBacks = await p.ev('location.hash');
    out.selectedAfterTwoBacks = await p.ev(`document.querySelector('[role=tab][aria-selected=true]').textContent`);
    await p.ev('history.forward()'); await sleep(400);
    out.afterForward = await p.ev('window.MCC_STUDIO_SHELL.current()');
    return out;
  });

  await check('altArrow', () => p.ev(`(() => { window.MCC_STUDIO_SHELL.go('stats'); const t = document.getElementById('cs-tab-stats'); t.focus(); const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }); t.dispatchEvent(e); const plain = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }); const before = window.MCC_STUDIO_SHELL.current(); t.dispatchEvent(plain); return { prevented: e.defaultPrevented, chapter: before, plainArrowStillMoves: window.MCC_STUDIO_SHELL.current() === 'page' && plain.defaultPrevented }; })()`));

  /* Tab through the long chapter both ways: no focused control may sit under the parked row or the bottom bar */
  await check('focus', async () => {
    await fresh('#releases');
    const STOP = `(() => { const el = document.activeElement; if (!el || el === document.body) return null; const box = el.matches('input[type=checkbox]') ? (el.closest('label') || el) : el; const r = box.getBoundingClientRect(); const x = Math.min(innerWidth - 3, Math.max(3, r.left + Math.min(r.width / 2, 40))); let covered = 0; const hits = [r.top + 2, r.top + r.height / 2, r.bottom - 2].map((y) => { if (y < 0 || y > innerHeight) { covered++; return 'off-screen'; } const h = document.elementFromPoint(x, y); const chrome = h && h.closest('#creatorChapters,.appbar,#mccAuthChip,#tbRecStrip'); if (chrome && !chrome.contains(el)) { covered++; return chrome.id || chrome.className; } return ''; }); return { id: el.id || el.tagName, top: Math.round(r.top), bottom: Math.round(r.bottom), covered, hits, inPanel: !!el.closest('#cs-panel-releases') }; })()`;
    const walk = async (modifiers, startExpr) => {
      await p.ev(startExpr); await sleep(250);
      const covered = []; let stops = 0;
      for (let i = 0; i < 60; i++) {
        await press('Tab', modifiers);
        /* let the page finish scrolling to the focused control before it is judged */
        await p.ev(`new Promise((done) => { let last = -1, same = 0; const t = setInterval(() => { if (Math.abs(scrollY - last) < 0.5) same++; else same = 0; last = scrollY; if (same >= 3) { clearInterval(t); done(true); } }, 60); })`);
        const s = await p.ev(STOP);
        if (!s || !s.inPanel) break;
        stops++;
        if (s.covered) covered.push(s);
      }
      return { stops, covered };
    };
    const chrome = await p.ev(`(() => { window.scrollTo(0, 1500); const row = document.getElementById('creatorChapters').getBoundingClientRect(); const bar = document.querySelector('.appbar'); const b = bar ? bar.getBoundingClientRect() : null; const cs = getComputedStyle(document.documentElement); return { rowTop: row.top, rowBottom: row.bottom, barTop: b && b.top, scrollPaddingTop: cs.scrollPaddingTop, scrollPaddingBottom: cs.scrollPaddingBottom }; })()`);
    const backward = await walk(8, `window.scrollTo(0, document.documentElement.scrollHeight); document.getElementById('submitTrack').focus({ preventScroll: true })`);
    const forward = await walk(0, `window.scrollTo(0, 0); document.getElementById('cs-tab-releases').focus({ preventScroll: true })`);
    /* the same walk with the reserved space taken away, to show it is what keeps the fields clear (not a check) */
    await p.ev(`document.documentElement.style.scrollPaddingTop = ''; document.documentElement.style.scrollPaddingBottom = ''`);
    const b0 = await walk(8, `window.scrollTo(0, document.documentElement.scrollHeight); document.getElementById('submitTrack').focus({ preventScroll: true })`);
    const f0 = await walk(0, `window.scrollTo(0, 0); document.getElementById('cs-tab-releases').focus({ preventScroll: true })`);
    await p.ev(`window.dispatchEvent(new Event('resize'))`);
    return { chrome, backward, forward, withoutReservedSpace: { backwardCovered: b0.covered.map((s) => s.id), forwardCovered: f0.covered.map((s) => s.id) } };
  });

  /* Record and Save from the keyboard: the pressed button keeps focus */
  await check('keyboard', async () => {
    await fresh('#make'); await p.ev(WIPE);
    const out = {};
    await p.ev(`document.getElementById('tbRecord').focus()`);
    await press('Enter');
    out.started = await p.waitFor('window.MCC_TAKE_BENCH.state().recording', 8000);
    out.whileRecording = await focusId();
    out.label = await p.ev(`document.getElementById('tbRecordLabel').textContent`);
    await sleep(700);
    await press('Enter');
    out.secondEnterStopped = await p.waitFor('!window.MCC_TAKE_BENCH.state().recording', 3000);
    await p.waitFor(IDLE + ' && window.MCC_TAKE_BENCH.state().takes.length === 1', 15000);
    out.afterStop = await focusId();
    await p.ev(`document.getElementById('tbSave').focus()`);
    await p.ev(`window.__busySeen = false; window.__focusWhileBusy = ''; new MutationObserver(() => { if (document.getElementById('tbSave').getAttribute('aria-disabled') === 'true') { window.__busySeen = true; window.__focusWhileBusy = document.activeElement.id; } }).observe(document.getElementById('tbSave'), { attributes: true })`);
    await press('Enter');
    await p.waitFor(IDLE + ' && window.MCC_TAKE_BENCH.state().takes.length === 2', 15000);
    out.busySeen = await p.ev('window.__busySeen');
    out.whileSaving = await p.ev('window.__focusWhileBusy');
    out.afterSave = await focusId();
    out.saveIsDisabledProperty = await p.ev(`document.getElementById('tbSave').disabled`);
    return out;
  });

  /* a recording goes on when another chapter is opened, and stays in sight there */
  await check('recordAway', async () => {
    await fresh('#make'); await p.ev(WIPE);
    await p.ev(`document.getElementById('tbRecord').click()`);
    await p.waitFor('window.MCC_TAKE_BENCH.state().recording', 8000);
    await p.ev(`location.hash = 'releases'`); await sleep(500);
    const out = await p.ev(`(() => { const s = document.getElementById('tbRecStrip'), b = document.getElementById('tbStripStop'), t = document.getElementById('cs-tab-make'); const r = s.getBoundingClientRect(), br = b.getBoundingClientRect(); return { recording: window.MCC_TAKE_BENCH.state().recording, chapter: window.MCC_STUDIO_SHELL.current(), stripShown: !s.hidden && r.height > 0, strip: { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) }, said: document.getElementById('tbStripSay').textContent, time: document.getElementById('tbStripTime').textContent, stopHeight: br.height, stopWidth: br.width, tabMarked: t.hasAttribute('data-recording'), tabName: t.getAttribute('aria-label'), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }; })()`);
    report.screenshots.push(await p.shot('after-releases-while-recording-390', false));
    await p.ev('window.scrollTo(0, 1600)'); await sleep(400);
    out.stripInViewWhenScrolled = await p.ev(`(() => { const r = document.getElementById('tbRecStrip').getBoundingClientRect(), row = document.getElementById('creatorChapters').getBoundingClientRect(); return r.top >= row.bottom - 1 && r.bottom < innerHeight / 2; })()`);
    out.timeMoves = await p.ev(`document.getElementById('tbStripTime').textContent`) !== out.time;
    await p.ev(`document.getElementById('tbStripStop').click()`);
    await p.waitFor(IDLE + ' && window.MCC_TAKE_BENCH.state().takes.length === 1', 15000);
    out.afterStop = await p.ev(`({ recording: window.MCC_TAKE_BENCH.state().recording, kept: window.MCC_TAKE_BENCH.state().takes.length === 1, chapter: window.MCC_STUDIO_SHELL.current(), stripHidden: document.getElementById('tbRecStrip').hidden, tabMarked: document.getElementById('cs-tab-make').hasAttribute('data-recording'), focus: document.activeElement && document.activeElement.id })`);
    return out;
  });

  /* the page closes mid-take: what was captured is kept on the next visit */
  await check('recovery', async () => {
    await fresh('#make'); await p.ev(WIPE);
    await p.ev(`document.getElementById('tbRecord').click()`);
    await p.waitFor('window.MCC_TAKE_BENCH.state().recording', 8000);
    await sleep(1600);
    p.dialogs.length = 0;
    await fresh('#make');
    const out = { askedBeforeLeaving: p.dialogs.includes('beforeunload'), takesRightAfterReload: (await state()).takes.length };
    out.recovered = await p.waitFor(IDLE + ' && window.MCC_TAKE_BENCH.state().takes.length === 1', 20000);
    const s = await state();
    out.take = s.takes[0] && { name: s.takes[0].name, duration: s.takes[0].duration, bytes: s.takes[0].bytes };
    out.status = await p.ev(`document.getElementById('tbStatus').textContent`);
    out.piecesLeft = await p.ev(`(async () => { const db = await new Promise((res, rej) => { const r = indexedDB.open('mcc-creator-takes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); const n = await new Promise((res) => { const r = db.transaction('rec').objectStore('rec').count(); r.onsuccess = () => res(r.result); }); db.close(); return n; })()`);
    out.micStillLive = await p.ev(`window.MCC_TAKE_BENCH.state().recording`);
    return out;
  });

  /* a 16-bit file that is only trimmed: same sample rate, same samples */
  await check('exact', async () => {
    await fresh('#make'); await p.ev(WIPE);
    await p.ev(TONE('Exact', 1.5, 44100, 1));
    const rate = (await state()).sampleRate;
    const format = await p.ev(`document.getElementById('tbFormat').textContent`);
    const id = await p.ev(SAVE);
    const cmp = await p.ev(`(async () => { const out = new Uint8Array(await window.MCC_TAKE_BENCH.bytes(${JSON.stringify(id)})), src = new Uint8Array(window.__src); let diff = 0; for (let i = 0; i < Math.max(out.length, src.length); i++) if (out[i] !== src[i]) diff++; return { identical: out.length === src.length && diff === 0, bytes: out.length, differingBytes: diff, wavRate: window.MCC_TAKE_BENCH.pure.wavInfo(out.buffer).sampleRate }; })()`);
    return { rate, format, ...cmp };
  });

  /* a file that is too long is refused from its header: nothing is decoded */
  await check('longFile', async () => {
    await fresh('#make');
    await p.ev(`window.__decodes = 0; (() => { const o = BaseAudioContext.prototype.decodeAudioData; BaseAudioContext.prototype.decodeAudioData = function () { window.__decodes++; return o.apply(this, arguments); }; })()`);
    const wav = await p.ev(`(async () => { const P = window.MCC_TAKE_BENCH.pure, bytes = 31 * 60 * 8000 * 2; const head = new Uint8Array(P.encodeWav([new Float32Array(1)], 8000).slice(0, 44)); const v = new DataView(head.buffer); v.setUint32(4, 36 + bytes, true); v.setUint32(40, bytes, true); const t0 = performance.now(); const ok = await window.MCC_TAKE_BENCH.importFile(new File([head, new Uint8Array(bytes)], 'thirty-one-minutes.wav', { type: 'audio/wav' })); return { opened: ok, ms: Math.round(performance.now() - t0), decodes: window.__decodes, error: document.getElementById('tbError').textContent, fileBytes: 44 + bytes }; })()`);
    const mp3 = await p.ev(`(async () => { const body = new Uint8Array(40 * 1024 * 1024); body.set([0xFF, 0xFB, 0x90, 0x00]); const t0 = performance.now(); const ok = await window.MCC_TAKE_BENCH.importFile(new File([body], 'long.mp3', { type: 'audio/mpeg' })); return { opened: ok, ms: Math.round(performance.now() - t0), decodes: window.__decodes, error: document.getElementById('tbError').textContent, fileBytes: body.length }; })()`);
    return { wav, mp3 };
  });

  /* the write fails while reads still work: the take is held in the tab, listed, and can still be used */
  await check('writeFails', async () => {
    await fresh('#make'); await p.ev(WIPE);
    await p.ev(TONE('putfail', 1, 44100, 1));
    await p.ev(`window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('refused', 'DataCloneError'); }`);
    const id = await p.ev(SAVE);
    await p.ev(`IDBObjectStore.prototype.put = window.__put`);
    const out = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(), t = s.takes.find((x) => x.id === ${JSON.stringify(id)}); return { listed: !!t, held: !!(t && t.held), volatile: s.volatile, status: document.getElementById('tbStatus').textContent, row: (document.querySelector('#tbTakes .tb-take__meta') || {}).textContent, note: document.getElementById('tbTakesNote').textContent }; })()`);
    await p.ev(`document.querySelector('#tbTakes [data-take-act="use"]').click()`);
    out.usable = await p.waitFor(`document.getElementById('trackMaster').files.length === 1`, 4000);
    return out;
  });

  /* the audio session is given back when nothing sounds; anything else that starts takes over */
  await check('audioIdle', async () => {
    await fresh('#make');
    await p.ev(TONE('Idle', 3, 48000, 1));
    await p.ev(`document.getElementById('tbPlay').click()`); await sleep(400);
    const out = { whilePlaying: (await state()).audioState, playing: (await state()).playing };
    await p.ev(`document.getElementById('tbStop').click()`); await sleep(900);
    out.afterStop = (await state()).audioState;
    await p.ev(`document.getElementById('tbClose').click()`); await sleep(500);
    out.afterClose = (await state()).audioState;
    return out;
  });
  await check('otherMedia', async () => {
    await p.ev(TONE('Yield', 3, 48000, 1));
    await p.ev(`document.getElementById('tbPlay').click()`); await sleep(300);
    const out = { benchPlayingBefore: (await state()).playing };
    await p.ev(`(() => { const a = document.createElement('audio'); a.id = 'e2eOther'; a.loop = true; a.src = URL.createObjectURL(new Blob([window.MCC_TAKE_BENCH.pure.encodeWav([new Float32Array(8000)], 8000)], { type: 'audio/wav' })); document.body.appendChild(a); return a.play().then(() => true, () => false); })()`);
    await sleep(300);
    out.benchPlayingAfter = (await state()).playing;
    out.otherPlaying = await p.ev(`!document.getElementById('e2eOther').paused`);
    out.button = await p.ev(`document.getElementById('tbPlay').textContent`);
    await p.ev(`document.getElementById('e2eOther').remove(); document.getElementById('tbClose').click()`);
    return out;
  });

  /* hand-off: the title follows the take, a take can be the preview, and the 50 MB listener-file limit is said */
  await check('handoff', async () => {
    await fresh('#make'); await p.ev(WIPE);
    await p.ev(TONE('Persist A', 1, 44100, 1)); const a = await p.ev(SAVE);
    await p.ev(TONE('Persist B', 1, 44100, 1)); const b = await p.ev(SAVE);
    const use = async (id, act) => { await p.ev(`location.hash = 'make'`); await sleep(150); await p.ev(`document.querySelector('#tbTakes [data-take="${id}"] [data-take-act="${act}"]').click()`); await sleep(500); };
    const out = { actions: await p.ev(`Array.from(document.querySelector('#tbTakes .tb-take__actions').children).map((x) => x.textContent)`) };
    await use(a, 'use'); out.titleAfterA = await p.ev(`document.getElementById('trackTitle').value`);
    await use(b, 'use'); out.titleAfterB = await p.ev(`document.getElementById('trackTitle').value`);
    out.masterFile = await p.ev(`document.getElementById('trackMaster').files[0].name`);
    await use(a, 'preview');
    out.previewFile = await p.ev(`document.getElementById('trackPreview').files[0] && document.getElementById('trackPreview').files[0].name`);
    out.previewNote = await p.ev(`(document.getElementById('tbHandoffPreview') || {}).textContent`);
    out.masterUnchangedByPreview = await p.ev(`document.getElementById('trackMaster').files[0].name`) === out.masterFile;
    out.chapterAfterPreview = await p.ev('window.MCC_STUDIO_SHELL.current()');
    /* a typed title is never replaced */
    await p.ev(`(() => { const t = document.getElementById('trackTitle'); t.value = 'My own title'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await use(a, 'use'); out.typedTitleKept = await p.ev(`document.getElementById('trackTitle').value`);
    /* four minutes fifty of 48 kHz stereo: 55.7 MB of WAV, over the 52,428,800-byte listener-file ceiling */
    await p.ev(`location.hash = 'make'`); await sleep(150);
    await p.ev(TONE('Big', 290, 48000, 2)); const big = await p.ev(SAVE);
    out.bigBytes = (await state()).takes.find((t) => t.id === big).bytes;
    out.bigRow = await p.ev(`Array.from(document.querySelectorAll('#tbTakes [data-take="${big}"] .tb-take__meta')).map((x) => x.textContent).join(' | ')`);
    await p.ev(`document.getElementById('tbClose').click()`);
    await use(big, 'use');
    out.bigNote = await p.ev(`document.getElementById('tbHandoff').textContent`);
    out.bigMasterBytes = await p.ev(`document.getElementById('trackMaster').files[0].size`);
    await use(big, 'preview');
    out.bigPreviewError = await p.ev(`document.getElementById('tbError').textContent`);
    out.previewStillA = await p.ev(`document.getElementById('trackPreview').files[0].name`);
    await p.ev(`location.hash = 'make'`); await sleep(150);
    await p.ev(`(async () => { const b = document.querySelector('#tbTakes [data-take="${big}"] [data-take-act="delete"]'); b.click(); b.click(); })()`); await sleep(600);
    return out;
  });

  /* Delete: the second press is named for what it does, said aloud, and Escape calls it off */
  await check('deleteA11y', async () => {
    await p.ev(`location.hash = 'make'`); await sleep(200);
    const out = { takesBefore: (await state()).takes.length };
    await p.ev(`(() => { const b = document.querySelector('#tbTakes [data-take-act="delete"]'); b.focus(); b.click(); })()`); await sleep(100);
    Object.assign(out, await p.ev(`(() => { const b = document.querySelector('#tbTakes [data-take-act="delete"]'); return { armedText: b.textContent, armedName: b.getAttribute('aria-label'), armedSaid: document.getElementById('tbStatus').textContent }; })()`));
    await press('Escape');
    Object.assign(out, await p.ev(`(() => { const b = document.querySelector('#tbTakes [data-take-act="delete"]'); return { afterEscape: b.textContent, nameAfterEscape: b.getAttribute('aria-label'), saidAfterEscape: document.getElementById('tbStatus').textContent, takesAfter: window.MCC_TAKE_BENCH.state().takes.length }; })()`));
    return out;
  });

  await check('sliders', async () => {
    await p.ev(TONE('Sliders', 4, 44100, 1));
    await p.ev(`window.MCC_TAKE_BENCH.setTrim(1, 3)`);
    const out = await p.ev(`(() => { const a = document.getElementById('tbHandleStart'), b = document.getElementById('tbHandleEnd'); return { duration: window.MCC_TAKE_BENCH.state().duration, startMin: +a.getAttribute('aria-valuemin'), startMax: +a.getAttribute('aria-valuemax'), startNow: +a.getAttribute('aria-valuenow'), endMin: +b.getAttribute('aria-valuemin'), endMax: +b.getAttribute('aria-valuemax'), endNow: +b.getAttribute('aria-valuenow') }; })()`);
    await p.ev(`document.getElementById('tbClose').click()`);
    return out;
  });

  /* the meter's number and its words are the same reading */
  await check('meter', async () => {
    await fresh('#make');
    await p.ev(`document.getElementById('tbRecord').click()`);
    await p.waitFor('window.MCC_TAKE_BENCH.state().recording', 8000);
    const samples = [];
    for (let i = 0; i < 14; i++) { await sleep(170); samples.push(await p.ev(`[document.getElementById('tbMeter').getAttribute('aria-valuenow'), document.getElementById('tbMeter').getAttribute('aria-valuetext')]`)); }
    const record = await p.ev(`({ pressed: document.getElementById('tbRecord').getAttribute('aria-pressed'), name: document.getElementById('tbRecord').textContent })`);
    await p.ev(`document.getElementById('tbRecord').click()`);
    await p.waitFor(IDLE, 15000);
    await sleep(900);
    const afterRecording = (await state()).audioState;
    const consistent = samples.every(([now, text]) => {
      if (text === null) return now === '0';
      if (text === 'Silent') return now === '0';
      if (text === 'Too loud') return Number(now) >= 99;
      const db = parseFloat(text); return Math.abs(Number(now) - Math.round((db + 60) / 60 * 100)) <= 2;
    });
    return { samples, consistent, record, audioAfterRecording: afterRecording };
  });
  if (F.audioIdle && !F.audioIdle.error) F.audioIdle.afterRecording = F.meter && F.meter.audioAfterRecording;

  await check('statusGap', async () => {
    await fresh('#make'); await p.ev(WIPE); await p.ev(`document.getElementById('tbClose').click()`); await sleep(100);
    return p.ev(`(() => { const a = document.getElementById('tbFormats').getBoundingClientRect(), b = document.getElementById('tbEmpty').getBoundingClientRect(), s = document.getElementById('tbStatus'); return { gap: Math.round((b.top - a.bottom) * 10) / 10, statusEmpty: s.textContent === '', statusInTree: getComputedStyle(s).display !== 'none' && getComputedStyle(s).visibility !== 'hidden' }; })()`);
  });

  /* a field's edge against the card it sits on, and placeholder text against the field */
  await check('contrast', async () => {
    const CONTRAST = `(() => {
      const parse = (c) => { const m = (c.match(/[\\d.]+/g) || [0, 0, 0, 0]).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
      const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
      const ground = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor)); let c = { r: 0, g: 0, b: 0, a: 1 }; for (let i = chain.length - 1; i >= 0; i--) c = over(chain[i], c); return c; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
      const out = {};
      for (const id of IDS) { const el = document.getElementById(id); if (!el || !el.getClientRects().length) continue; const card = ground(el.parentElement), field = ground(el); out[id] = { edgeVsCard: ratio(over(parse(getComputedStyle(el).borderTopColor), card), card), fillVsCard: ratio(field, card), placeholderVsField: ratio(over(parse(getComputedStyle(el, '::placeholder').color), field), field), textVsField: ratio(over(parse(getComputedStyle(el).color), field), field) }; }
      return out;
    })()`;
    const out = {};
    await fresh('#releases'); Object.assign(out, await p.ev(CONTRAST.replace('IDS', `['trackTitle', 'trackAccess', 'trackDescription', 'trackLyricSheet', 'trackAccent']`)));
    await fresh('#page'); Object.assign(out, await p.ev(CONTRAST.replace('IDS', `['creatorHandle', 'creatorBio']`)));
    await fresh('#make'); await p.ev(TONE('Edge', 1, 44100, 1)); Object.assign(out, await p.ev(CONTRAST.replace('IDS', `['tbName', 'tbStart']`)));
    await p.ev(`document.getElementById('tbClose').click()`);
    return out;
  });

  /* the shell script does not arrive: no dead tabs are announced, and every card still shows */
  await check('noShell', async () => {
    await p.block(['*creator-studio-shell.js*']);
    try {
      await fresh('#make');
      const out = await p.ev(`(() => { const row = document.getElementById('creatorChapters'); const cards = Array.from(document.querySelectorAll('#creatorApp .creator-card')).filter((c) => c.getClientRects().length); return { shell: typeof window.MCC_STUDIO_SHELL, rowShown: getComputedStyle(row).display !== 'none', tabRoles: document.querySelectorAll('[role=tab],[role=tablist],[role=tabpanel]').length, cardsShown: cards.length, cards: cards.map((c) => c.id || (c.querySelector('h2') || {}).textContent), benchLoaded: !!window.MCC_TAKE_BENCH, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }; })()`);
      await p.ev(TONE('NoShell', 1, 44100, 1)); const id = await p.ev(SAVE);
      await p.ev(`document.querySelector('#tbTakes [data-take="${id}"] [data-take-act="use"]').click()`);
      out.handOffStillWorks = await p.waitFor(`document.getElementById('trackMaster').files.length === 1`, 4000);
      await p.ev(WIPE);
      return out;
    } finally { await p.block(); }
  });
  await check('noBench', async () => {
    await p.block(['*creator-studio-take.js*']);
    try {
      await fresh('#make');
      return await p.ev(`({ mount: document.getElementById('takeBenchMount').textContent, chapters: window.MCC_STUDIO_SHELL.chapters.length })`);
    } finally { await p.block(); }
  });
  await fresh('#make'); await p.ev(WIPE);
}

/* a browser with no Web Audio, and one whose database never answers */
async function hostile(browser) {
  const F = report.findings ||= {};
  const mini = async (source, tail = '#make') => {
    const p = await browser.page();
    await p.size(390, 844, true);
    await p.s('Page.addScriptToEvaluateOnNewDocument', { source });
    await p.goto(BASE + '/creator.html' + tail); await p.ev(REVEAL); await sleep(300);
    return p;
  };
  try {
    const p = await mini('try { Object.defineProperty(window, "AudioContext", { value: undefined }); Object.defineProperty(window, "webkitAudioContext", { value: undefined }); } catch (e) {}');
    F.noAudio = await p.ev(`({ recordDisabled: document.getElementById('tbRecord').disabled, importDisabled: document.getElementById('tbImport').disabled, error: document.getElementById('tbError').textContent })`);
    report.errors.push(...p.errors);
  } catch (e) { F.noAudio = { error: String(e.message || e) }; }
  try {
    const p = await mini('IDBFactory.prototype.open = function () { return {}; };');
    const t0 = Date.now();
    await p.ev(TONE('Hang', 1, 44100, 1));
    const id = await p.ev(`Promise.race([${SAVE}, new Promise((r) => setTimeout(() => r('timed-out'), 14000))])`);
    const out = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(); return { volatile: s.volatile, takes: s.takes.length, held: s.takes.every((t) => t.held), locked: ['tbSave', 'tbPlay', 'tbStop', 'tbImport', 'tbClose', 'tbRecord'].some((id) => document.getElementById(id).getAttribute('aria-disabled') === 'true'), status: document.getElementById('tbStatus').textContent, note: document.getElementById('tbTakesNote').textContent }; })()`);
    out.saved = typeof id === 'string' && id !== 'timed-out';
    out.secondsToSave = Math.round((Date.now() - t0) / 100) / 10;
    await p.ev(`document.querySelector('#tbTakes [data-take-act="use"]').click()`);
    out.usable = await p.waitFor(`document.getElementById('trackMaster').files.length === 1`, 4000);
    F.idbHang = out;
    report.errors.push(...p.errors);
  } catch (e) { F.idbHang = { error: String(e.message || e) }; }
}

const browser = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
try {
  const p = await browser.page();

  /* ---- before (pristine creator.html), if one was supplied ---- */
  if (BEFORE) {
    for (const [w, h, mobile] of SIZES) {
      await p.size(w, h, mobile);
      await p.goto(BASE + '/creator-before.html');
      await p.ev(REVEAL);
      await sleep(400);
      report.before[w] = await p.ev(MEASURE);
      report.screenshots.push(await p.shot(`before-${w}`));
    }
  }

  /* ---- after: each chapter at each width ---- */
  for (const [w, h, mobile] of SIZES) {
    await p.size(w, h, mobile);
    for (const c of CHAPTERS) {
      await p.goto(BASE + '/creator.html#' + c);
      await p.ev(REVEAL);
      await sleep(400);
      const m = await p.ev(MEASURE);
      m.selected = await p.ev(`Array.from(document.querySelectorAll('[role=tab]')).filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent)`);
      m.visiblePanels = await p.ev(`Array.from(document.querySelectorAll('[role=tabpanel]')).filter((x) => !x.hidden).map((x) => x.id)`);
      (report.chapters[w] ||= {})[c] = m;
      report.screenshots.push(await p.shot(`after-${c}-${w}`));
    }
  }

  /* ---- the shell at 390 ---- */
  await p.size(390, 844, true);
  await p.goto(BASE + '/creator.html');
  await p.ev(REVEAL); await sleep(300);
  report.shell.defaultChapter = await p.ev('window.MCC_STUDIO_SHELL.current()');
  report.shell.tabs = await p.ev(`Array.from(document.querySelectorAll('#creatorChapters [role=tab]')).map((t) => { const r = t.getBoundingClientRect(); const cs = getComputedStyle(t); return { text: t.textContent, w: Math.round(r.width * 10) / 10, h: r.height, font: cs.fontSize, weight: cs.fontWeight, underline: cs.borderBottomWidth + ' ' + cs.borderBottomColor, selected: t.getAttribute('aria-selected'), tabindex: t.tabIndex, controls: t.getAttribute('aria-controls'), href: t.getAttribute('href') }; })`);
  report.shell.cardsInChapters = await p.ev(`Object.fromEntries(Array.from(document.querySelectorAll('[role=tabpanel]')).map((x) => [x.id, Array.from(x.children).map((c) => c.id || (c.querySelector('h2') ? c.querySelector('h2').textContent : c.className))]))`);
  report.shell.strayCards = await p.ev(`Array.from(document.getElementById('creatorApp').children).filter((c) => !c.matches('.cs-tabs,.cs-panel,.cs-sentinel,.tb-strip')).length`);
  report.shell.releaseGroups = await p.ev(`Array.from(document.querySelectorAll('#trackForm .cs-group')).map((g) => g.querySelector('.cs-group__title').textContent + ' (' + g.querySelectorAll('input,select,textarea').length + ')')`);
  report.shell.releaseControlsStillInForm = await p.ev(`document.getElementById('trackForm').querySelectorAll('input,select,textarea,button').length`);
  /* keyboard: focus the selected tab, arrow right twice, End, Home */
  await p.ev(`document.getElementById('cs-tab-make').focus()`);
  const key = async (k) => { await p.s('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37, End: 35, Home: 36 }[k] }); await p.s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k }); await sleep(80); };
  const where = () => p.ev(`({chapter: window.MCC_STUDIO_SHELL.current(), hash: location.hash, focus: document.activeElement && document.activeElement.id})`);
  report.shell.keyboard = [];
  for (const k of ['ArrowRight', 'ArrowRight', 'End', 'ArrowRight', 'Home', 'ArrowLeft']) { await key(k); report.shell.keyboard.push({ key: k, ...(await where()) }); }
  await p.goto(BASE + '/creator.html?edit=profile');
  await p.ev(REVEAL);
  report.shell.editProfileOpensOn = await p.ev('window.MCC_STUDIO_SHELL.current()');
  /* the row parks under the account chip, deep in the long chapter */
  await p.goto(BASE + '/creator.html#releases');
  await p.ev(REVEAL); await sleep(300);
  await p.ev('window.scrollTo(0, 1400)'); await sleep(400);
  report.shell.parked = await p.ev(`(() => { const row = document.getElementById('creatorChapters').getBoundingClientRect(); const chip = document.getElementById('mccAuthChip'); const c = chip ? chip.getBoundingClientRect() : null; return { rowTop: row.top, rowBottom: row.bottom, chip: c ? { top: c.top, bottom: c.bottom, left: c.left, right: c.right } : null, chipOverRow: !!c && c.bottom > row.top && c.top < row.bottom && c.left < row.right && c.right > row.left, isParked: document.getElementById('creatorChapters').classList.contains('is-parked') }; })()`);
  report.screenshots.push(await p.shot('after-releases-390-scrolled', false));
  await p.ev(`document.getElementById('cs-tab-make').click()`); await sleep(300);
  report.shell.afterTabClickFromDeep = await p.ev(`({ chapter: window.MCC_STUDIO_SHELL.current(), scrollY: Math.round(scrollY), rowTop: Math.round(document.getElementById('creatorChapters').getBoundingClientRect().top) })`);

  /* ---- the Take bench at 390: import a generated tone ---- */
  await p.goto(BASE + '/creator.html#make');
  await p.ev(REVEAL); await sleep(300);
  const B = report.bench;
  B.startState = await p.ev('window.MCC_TAKE_BENCH.state()');
  /* a 2.000 s 440 Hz mono tone, made in the page, given to the real file input */
  B.importOk = await p.ev(`(async () => {
    const P = window.MCC_TAKE_BENCH.pure, sr = 44100, n = sr * 2, a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = 0.6 * Math.sin(2 * Math.PI * 440 * i / sr);
    const file = new File([P.encodeWav([a], sr)], 'Test tone 440.wav', { type: 'audio/wav' });
    const input = document.getElementById('tbFile'), dt = new DataTransfer();
    dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return file.size;
  })()`);
  B.opened = await p.waitFor('window.MCC_TAKE_BENCH.state().open && !window.MCC_TAKE_BENCH.state().busy');
  B.afterImport = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(); const cv = document.getElementById('tbCanvas'); const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++; return { name: s.name, duration: s.duration, region: s.region, status: document.getElementById('tbStatus').textContent, canvas: cv.width + 'x' + cv.height, canvasPixelsDrawn: lit, editorShown: !document.getElementById('tbEditor').hidden }; })()`);
  /* trim with the numeric fields, then drag the start handle with a touch */
  await p.ev(`(() => { const set = (id, v, type) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(type, { bubbles: true })); };
    set('tbStart', '0.50', 'change'); set('tbEnd', '1.50', 'change'); set('tbFadeIn', '0.25', 'input'); set('tbFadeOut', '0.25', 'input'); })()`);
  B.afterNumericTrim = (await p.ev('window.MCC_TAKE_BENCH.state()')).region;
  await p.ev(`document.getElementById('tbWave').scrollIntoView({ block: 'center' })`); await sleep(200);
  const hs = await p.ev(`(() => { const r = document.getElementById('tbHandleStart').getBoundingClientRect(); const wv = document.getElementById('tbWave').getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2, waveLeft: wv.left, waveWidth: wv.width, handleW: r.width, handleH: r.height }; })()`);
  B.handle = { w: hs.handleW, h: hs.handleH };
  const dragTo = hs.waveLeft + hs.waveWidth * 0.375;   /* 0.75 s of 2 s */
  await p.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hs.x, y: hs.y }] });
  for (let i = 1; i <= 6; i++) await p.s('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hs.x + (dragTo - hs.x) * i / 6, y: hs.y }] });
  await p.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  B.afterHandleDrag = (await p.ev('window.MCC_TAKE_BENCH.state()')).region;
  B.startFieldAfterDrag = await p.ev(`document.getElementById('tbStart').value`);
  /* keyboard on the end handle */
  await p.ev(`document.getElementById('tbHandleEnd').focus()`);
  await p.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await p.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft' });
  B.afterEndHandleArrowLeft = (await p.ev('window.MCC_TAKE_BENCH.state()')).region.end;
  /* back to the exact trim the render is judged on */
  await p.ev(`(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }; set('tbStart', '0.50'); set('tbEnd', '1.50'); })()`);
  B.regionForRender = (await p.ev('window.MCC_TAKE_BENCH.state()')).region;
  report.screenshots.push(await p.shot('after-make-take-open-390'));
  B.measuredWithTakeOpen = await p.ev(MEASURE);
  /* play the trimmed region: the bench's own graph, a site <audio> must be paused by it */
  await p.ev(`(() => { const a = document.createElement('audio'); a.id = 'e2eSiteAudio'; a.loop = true; const sr = 8000, n = sr, f = new Float32Array(n); a.src = URL.createObjectURL(new Blob([window.MCC_TAKE_BENCH.pure.encodeWav([f], sr)], { type: 'audio/wav' })); document.body.appendChild(a); return a.play().then(() => true, () => false); })()`);
  await sleep(200);
  B.siteAudioPlayingBefore = await p.ev(`!document.getElementById('e2eSiteAudio').paused`);
  await p.ev(`document.getElementById('tbPlay').click()`);
  await sleep(450);
  B.playing = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(); return { playing: s.playing, position: s.position, button: document.getElementById('tbPlay').textContent, siteAudioPaused: document.getElementById('e2eSiteAudio').paused, mediaElementsInBench: document.getElementById('takeBench').querySelectorAll('audio,video').length }; })()`);
  await p.ev(`document.getElementById('tbPlay').click()`); await sleep(120);
  B.paused = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(); return { playing: s.playing, position: s.position }; })()`);
  await p.ev(`document.getElementById('tbPlay').click()`); await sleep(1300);
  B.afterRegionEnds = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(); return { playing: s.playing, position: s.position }; })()`);
  await p.ev(`document.getElementById('tbStop').click(); document.getElementById('e2eSiteAudio').remove()`);
  /* render and keep */
  await p.ev(`document.getElementById('tbSave').click()`);
  B.saved = await p.waitFor('window.MCC_TAKE_BENCH.state().takes.length === 1 && !window.MCC_TAKE_BENCH.state().busy');
  B.take = await p.ev(`(async () => {
    const s = window.MCC_TAKE_BENCH.state(), t = s.takes[0];
    const db = await new Promise((res, rej) => { const r = indexedDB.open('mcc-creator-takes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (store) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).get(t.id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec = await get('takes'), sound = await get('audio');
    db.close();
    /* the list record holds no audio; the audio is a Blob in its own store, read on request */
    const data = await window.MCC_TAKE_BENCH.bytes(t.id);
    const info = window.MCC_TAKE_BENCH.pure.wavInfo(data), v = new DataView(data);
    const at = (sec) => Math.abs(v.getInt16(44 + Math.round(sec * info.sampleRate) * info.channels * 2, true)) / 32768;
    const peak = (a, b) => { let m = 0; for (let x = a; x < b; x += 1 / info.sampleRate) m = Math.max(m, at(x)); return Math.round(m * 1000) / 1000; };
    return { listed: { name: t.name, duration: t.duration, bytes: t.bytes, createdAt: t.createdAt }, volatile: s.volatile, status: document.getElementById('tbStatus').textContent,
      wav: info, bytes: data.byteLength, sessionDoc: rec.session, openedAtRate: s.sampleRate,
      listRecordHasAudio: 'data' in rec, listHoldsAudio: s.takes.some((x) => x.hasAudioInList), audioIsBlob: sound.data instanceof Blob, audioBlobBytes: sound.data.size,
      peakFirst20ms: peak(0, 0.02), peakMiddle: peak(0.45, 0.55), peakLast20ms: peak(info.duration - 0.02, info.duration - 0.0001),
      row: document.querySelector('#tbTakes .tb-take__meta').textContent };
  })()`);
  report.screenshots.push(await p.shot('after-make-take-saved-390'));
  /* a reload keeps it */
  await p.goto(BASE + '/creator.html#make');
  await p.ev(REVEAL);
  await p.waitFor('window.MCC_TAKE_BENCH.state().takes.length >= 0 && document.getElementById("tbTakes").children.length > 0', 5000);
  B.afterReload = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(); return { takes: s.takes.length, name: s.takes[0] && s.takes[0].name, duration: s.takes[0] && s.takes[0].duration, rows: document.getElementById('tbTakes').children.length }; })()`);
  /* use in a release */
  await p.ev(`document.querySelector('#tbTakes [data-take-act="use"]').click()`);
  await p.waitFor(`document.getElementById('trackMaster').files.length === 1 && window.MCC_STUDIO_SHELL.current() === 'releases'`, 5000);
  await sleep(300);
  B.useInRelease = await p.ev(`(async () => {
    const input = document.getElementById('trackMaster'), f = input.files[0];
    const info = f ? window.MCC_TAKE_BENCH.pure.wavInfo(await f.arrayBuffer()) : null;
    return { hash: location.hash, chapter: window.MCC_STUDIO_SHELL.current(), releasesShown: !document.getElementById('cs-panel-releases').hidden,
      files: input.files.length, name: f && f.name, type: f && f.type, size: f && f.size, wav: info,
      acceptsWav: /audio\\/wav/.test(input.accept), validity: input.validity.valid, title: document.getElementById('trackTitle').value,
      note: document.getElementById('tbHandoff') && document.getElementById('tbHandoff').textContent, focus: document.activeElement && document.activeElement.id };
  })()`);
  report.screenshots.push(await p.shot('after-releases-take-handed-off-390', false));
  /* delete: two presses, then a reload to prove it is gone */
  await p.ev(`location.hash = 'make'`); await sleep(200);
  await p.ev(`document.querySelector('#tbTakes [data-take-act="delete"]').click()`); await sleep(100);
  B.deleteArmed = await p.ev(`({ label: document.querySelector('#tbTakes [data-take-act="delete"]').textContent, name: document.querySelector('#tbTakes [data-take-act="delete"]').getAttribute('aria-label'), said: document.getElementById('tbStatus').textContent, takes: window.MCC_TAKE_BENCH.state().takes.length })`);
  await p.ev(`document.querySelector('#tbTakes [data-take-act="delete"]').click()`);
  await p.waitFor('window.MCC_TAKE_BENCH.state().takes.length === 0', 5000);
  await p.goto(BASE + '/creator.html#make'); await p.ev(REVEAL); await sleep(500);
  B.afterDeleteAndReload = await p.ev(`({ takes: window.MCC_TAKE_BENCH.state().takes.length, emptyShown: !document.getElementById('tbTakesEmpty').hidden })`);
  /* a file that is not audio */
  await p.ev(`(() => { const input = document.getElementById('tbFile'), dt = new DataTransfer(); dt.items.add(new File(['not audio'], 'notes.wav', { type: 'audio/wav' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await p.waitFor(`!document.getElementById('tbError').hidden`, 5000);
  B.badFile = await p.ev(`({ error: document.getElementById('tbError').textContent, editorOpen: window.MCC_TAKE_BENCH.state().open })`);

  /* ---- recording, with Chromium's fake microphone ---- */
  const R = report.recording;
  await p.goto(BASE + '/creator.html#make'); await p.ev(REVEAL); await sleep(300);
  R.flags = '--use-fake-device-for-media-stream --use-fake-ui-for-media-stream';
  R.canRecord = await p.ev('window.MCC_TAKE_BENCH.state().canRecord');
  await p.ev(`document.getElementById('tbRecord').click()`);
  R.started = await p.waitFor('window.MCC_TAKE_BENCH.state().recording', 8000);
  if (R.started) {
    const levels = [];
    for (let i = 0; i < 12; i++) { await sleep(150); levels.push(Number(await p.ev(`document.getElementById('tbMeter').getAttribute('aria-valuenow')`))); }
    R.meterLevels = levels;
    R.during = await p.ev(`({ label: document.getElementById('tbRecordLabel').textContent, liveShown: !document.getElementById('tbLive').hidden, timer: document.getElementById('tbRecTime').textContent, importWaiting: document.getElementById('tbImport').getAttribute('aria-disabled') === 'true', meter: document.getElementById('tbMeter').getAttribute('aria-valuenow') + ' / ' + document.getElementById('tbMeter').getAttribute('aria-valuetext') })`);
    report.screenshots.push(await p.shot('after-make-recording-390', false));
    await p.ev(`document.getElementById('tbRecord').click()`);
    R.kept = await p.waitFor('window.MCC_TAKE_BENCH.state().takes.length === 1 && !window.MCC_TAKE_BENCH.state().busy', 15000);
    R.after = await p.ev(`(() => { const s = window.MCC_TAKE_BENCH.state(); return { open: s.open, duration: s.duration, takes: s.takes.map((t) => ({ name: t.name, duration: t.duration, bytes: t.bytes })), status: document.getElementById('tbStatus').textContent, error: document.getElementById('tbError').hidden ? '' : document.getElementById('tbError').textContent, label: document.getElementById('tbRecordLabel').textContent }; })()`);
    await p.ev(`(async () => { const b = document.querySelector('#tbTakes [data-take-act="delete"]'); if (b) { b.click(); b.click(); } })()`);
    await sleep(400);
  } else {
    R.error = await p.ev(`document.getElementById('tbError').textContent`);
  }
  await findings(p);
  report.errors.push(...p.errors);
} finally { await browser.close(); }

/* ---- the microphone refused, and a browser that cannot record ---- */
const plain = await launch([]);
try {
  const p = await plain.page();
  await p.size(390, 844, true);
  try { await plain.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: BASE }); report.recording.denySet = true; }
  catch (e) { report.recording.denySet = 'Browser.setPermission failed: ' + e.message; }
  await p.goto(BASE + '/creator.html#make'); await p.ev(REVEAL); await sleep(300);
  await p.ev(`document.getElementById('tbRecord').focus(); document.getElementById('tbRecord').click()`);
  await p.waitFor(`!document.getElementById('tbError').hidden || window.MCC_TAKE_BENCH.state().recording`, 8000);
  await sleep(800);
  report.recording.denied = await p.ev(`({ audio: window.MCC_TAKE_BENCH.state().audioState, focusKept: document.activeElement && document.activeElement.id, recording: window.MCC_TAKE_BENCH.state().recording, error: document.getElementById('tbError').hidden ? '' : document.getElementById('tbError').textContent, label: document.getElementById('tbRecordLabel').textContent, recordDisabled: document.getElementById('tbRecord').disabled })`);
  report.screenshots.push(await p.shot('after-make-mic-blocked-390', false));
  await p.s('Page.addScriptToEvaluateOnNewDocument', { source: 'try { delete window.MediaRecorder; Object.defineProperty(window, "MediaRecorder", { value: undefined }); } catch (e) {}' });
  await p.goto(BASE + '/creator.html#make'); await p.ev(REVEAL); await sleep(300);
  report.recording.unsupported = await p.ev(`({ canRecord: window.MCC_TAKE_BENCH.state().canRecord, recordDisabled: document.getElementById('tbRecord').disabled, importDisabled: document.getElementById('tbImport').disabled, hint: document.getElementById('tbFormats').textContent })`);
  report.screenshots.push(await p.shot('after-make-cannot-record-390', false));
  report.errors.push(...p.errors);
  await hostile(plain);
} finally { await plain.close(); }
server.close();

/* ---- what must hold: each is true or the run fails ---- */
const F = report.findings || {}, C = report.checks = {};
const each = (o, fn) => Object.values(o || {}).every(fn);
for (const w of [390, 1280]) {
  C[`controls were measured at ${w}`] = ['releases', 'page'].every((c) => report.chapters[w][c].minControlFontPx >= 16);
  C[`no sideways scroll at ${w}`] = each(report.chapters[w], (m) => m.scrollWidth === m.clientWidth && m.bodyScrollWidth <= m.clientWidth);
  C[`no text under 12px at ${w}`] = each(report.chapters[w], (m) => m.minFontPx >= 12);
  C[`form controls at 16px or more at ${w}`] = each(report.chapters[w], (m) => m.minControlFontPx === null || m.minControlFontPx >= 16);
  C[`no target under 44px at ${w}`] = each(report.chapters[w], (m) => m.under44.length === 0);
}
C['take open: no sideways scroll, no small target'] = report.bench.measuredWithTakeOpen.scrollWidth === report.bench.measuredWithTakeOpen.clientWidth && report.bench.measuredWithTakeOpen.under44.length === 0;
C['roles are given by the shell'] = F.roles?.tablists === 1 && F.roles?.tabs === 4 && F.roles?.panels === 4 && F.roles?.selected === 1;
C['an element fragment opens its chapter'] = F.deepLink?.chapter === 'stats' && F.deepLink?.inPage === 'page';
C['Back to the entry address shows Make'] = F.back?.afterOneBack === 'releases' && F.back?.afterTwoBacks === 'make' && F.back?.hashAfterTwoBacks === '';
C['Alt+Arrow is left to the browser'] = F.altArrow?.prevented === false && F.altArrow?.chapter === 'stats';
C['no focused field under the chapter row or the bottom bar'] = F.focus?.backward?.stops >= 10 && F.focus?.backward?.covered.length === 0 && F.focus?.forward?.stops >= 10 && F.focus?.forward?.covered.length === 0;
C['focus stays on Record and Save from the keyboard'] = F.keyboard?.whileRecording === 'tbRecord' && F.keyboard?.afterStop === 'tbRecord' && F.keyboard?.whileSaving === 'tbSave' && F.keyboard?.afterSave === 'tbSave' && F.keyboard?.secondEnterStopped === true;
C['a recording stays in sight outside Make'] = F.recordAway?.recording === true && F.recordAway?.stripShown === true && F.recordAway?.stopHeight >= 44 && F.recordAway?.tabMarked === true && F.recordAway?.stripInViewWhenScrolled === true && F.recordAway?.afterStop?.recording === false && F.recordAway?.afterStop?.kept === true;
C['an interrupted recording is recovered'] = F.recovery?.recovered === true && F.recovery?.askedBeforeLeaving === true && F.recovery?.piecesLeft === 0;
C['the list holds no audio'] = report.bench.take?.listRecordHasAudio === false && report.bench.take?.listHoldsAudio === false && report.bench.take?.audioIsBlob === true;
C['a trimmed-only 16-bit file keeps its rate and its samples'] = F.exact?.rate === 44100 && F.exact?.wavRate === 44100 && F.exact?.identical === true;
C['a long file is refused before it is decoded'] = F.longFile?.wav?.decodes === 0 && /31 minutes long/.test(F.longFile?.wav?.error || '') && F.longFile?.mp3?.decodes === 0 && /minutes long/.test(F.longFile?.mp3?.error || '');
C['a take that cannot be written is held and listed'] = F.writeFails?.listed === true && F.writeFails?.held === true && /Until this tab closes/.test(F.writeFails?.row || '') && /download/.test(F.writeFails?.status || '') && F.writeFails?.usable === true;
C['the audio session rests when idle'] = F.audioIdle?.whilePlaying === 'running' && F.audioIdle?.afterStop === 'suspended' && F.audioIdle?.afterRecording === 'suspended' && report.recording.denied?.audio !== 'running';
C['other media starting stops the bench'] = F.otherMedia?.benchPlayingBefore === true && F.otherMedia?.benchPlayingAfter === false && F.otherMedia?.otherPlaying === true;
C['hand-off: title follows, preview slot, 50 MB said'] = F.handoff?.titleAfterA === 'Persist A' && F.handoff?.titleAfterB === 'Persist B' && F.handoff?.previewFile === 'Persist-A.wav' && /over 50 MB/i.test(F.handoff?.bigNote || '') && /50 MB at most/.test(F.handoff?.bigPreviewError || '') && /Over 50 MB/.test(F.handoff?.bigRow || '');
C['Delete: the second press is named, said and called off by Escape'] = /for good\?$/.test(F.deleteA11y?.armedName || '') && /Press Delete again/.test(F.deleteA11y?.armedSaid || '') && F.deleteA11y?.afterEscape === 'Delete' && F.deleteA11y?.takesAfter === F.deleteA11y?.takesBefore;
C['the trim sliders publish the range they can reach'] = F.sliders?.startMax < F.sliders?.duration && F.sliders?.endMin > 0;
C['the meter says one level'] = F.meter?.consistent === true;
C['no gap from an empty status line'] = F.statusGap?.gap <= 14.5;
C['a field edge is 3:1 or better; placeholders 4.5:1'] = each(F.contrast, (v) => v.edgeVsCard >= 3 && v.placeholderVsField >= 4.5);
C['without the shell script: no dead tabs, every card shown'] = F.noShell?.rowShown === false && F.noShell?.tabRoles === 0 && F.noShell?.cardsShown >= 6 && F.noShell?.scrollWidth === F.noShell?.clientWidth;
C['no AudioContext: Record and Import are both off'] = F.noAudio?.recordDisabled === true && F.noAudio?.importDisabled === true;
C['a database that never answers does not lock the bench'] = F.idbHang?.saved === true && F.idbHang?.volatile === true && F.idbHang?.locked === false && F.idbHang?.usable === true;
C['no page error'] = report.errors.length === 0;
report.failed = Object.keys(C).filter((k) => C[k] !== true);

await writeFile(join(OUT, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.failed.length) { console.error('FAILED: ' + report.failed.join(' | ')); process.exitCode = 1; }
