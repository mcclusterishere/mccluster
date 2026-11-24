/* Ask McCluster with an image and the node's browser: the Control Room surface of device-node slice N2
   (docs/control-plane/AGENT-NODE-BROWSER.md) in real Chromium at 390 and 1280. Real control.html and
   every module from this checkout; EVERY network call is a synthetic fixture: the Core bridge is a
   JSON-RPC fixture, Supabase rows are fixtures. A "done" turn here is fixture state, never a model, never
   a node, never a browser task. One browser, every context closed, the browser closed in finally.

   Proves: a 2000x1200 PNG attached in the composer reaches the durable turn as one base64 JPEG at most
   200,000 bytes and 1280 px wide; the owner's "Use the browser" switch sends allow_browser true and a
   member session never sees the switch; live steps render from the checkpointed receipts while the turn
   runs; the fixture turn's two screenshots and 30-entry action log render collapsed with the node badge;
   no horizontal overflow at either width.

   The controls follow what the running Core declares (deploy-readiness review, 2026-11-18): the bridge's
   tools/list answers with real input schemas, this checkout's (core/src/tools/control.mjs,
   core/capabilities/catalog.json) for a Core that honours images and the browser flag, and the schemas of the
   Core on OVH at build eb942248 for one that does not. Against that older Core, at 390 and 1280, the owner
   sees no attach control and no switch, one honest line in place of each, and a turn sent carries neither
   images nor allow_browser; a member sees the owner-only workspace gate. When the tool list cannot be read
   at all (the bridge answers 503), nothing is known about the Core: the controls stay off and each line says it is not
   known, never that the Core refuses (review LDR-F3, 2026-11-18).

   The node badge shows its whole content, the measured rate included, at 390, 820 and 1280: nothing cut
   off, nothing outside its message (verification finding N2V-m2).

   PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/control-ai-browser.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(process.env.CONTROL_E2E_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
const OUT = process.argv[2] || '/tmp/control-ai-browser-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'https://matthew.mccluster.org';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const OWNER = '11111111-1111-4111-8111-111111111111';
const ORG = 'o1';
const THREAD = 'thread-1';
const TOOLS = ['core.resume', 'ai.chat', 'compute.task.get', 'core.ai.turn.submit', 'core.ai.turn.get', 'objective.plan', 'research.web'];
/* The input schemas the bridge's tools/list carries. 'current': this checkout's Core, as the broker lists it (raw tools
   from core/src/tools/control.mjs, capabilities from core/capabilities/catalog.json). 'eb942248': the Core on OVH at that
   build, copied from its two files: no images and no allow_browser on the durable turn, ai.chat's messages a bare array. */
/* This N2 fixture represents the existing automatic vision path. The new
   device-routing rollout has its own owner-ai-workspace acceptance tests. */
const previousOwnerWorkspaceFlag = process.env.CORE_OWNER_AI_WORKSPACE_ENABLED;
process.env.CORE_OWNER_AI_WORKSPACE_ENABLED = '0';
const { CONTROL_TOOLS } = await import(pathToFileURL(join(ROOT, 'core/src/tools/control.mjs')).href);
if (previousOwnerWorkspaceFlag === undefined) delete process.env.CORE_OWNER_AI_WORKSPACE_ENABLED;
else process.env.CORE_OWNER_AI_WORKSPACE_ENABLED = previousOwnerWorkspaceFlag;
const CATALOG = JSON.parse(await readFile(join(ROOT, 'core/capabilities/catalog.json'), 'utf8'));
const SCHEMAS = {
  current: Object.fromEntries([
    ...CATALOG.capabilities.filter((c) => TOOLS.includes(c.id)).map((c) => [c.id, c.inputSchema]),
    ...CONTROL_TOOLS.filter((t) => TOOLS.includes(t.name)).map((t) => [t.name, t.inputSchema])
  ]),
  eb942248: {
    'ai.chat': { type: 'object', properties: { prompt: { type: 'string' }, messages: { type: 'array' }, temperature: { type: 'number' }, num_ctx: { type: 'integer' }, json: { type: 'boolean' } }, anyOf: [{ required: ['prompt'] }, { required: ['messages'] }] },
    'core.ai.turn.submit': { type: 'object', required: ['org_id', 'thread_id', 'message_id', 'content'], properties: { org_id: { type: 'string' }, thread_id: { type: 'string' }, message_id: { type: 'string' }, content: { type: 'string', minLength: 1, maxLength: 12000 }, input_mode: { type: 'string', enum: ['text', 'voice'] } }, additionalProperties: false },
    'core.ai.turn.get': { type: 'object', required: ['org_id', 'turn_id'], properties: { org_id: { type: 'string' }, turn_id: { type: 'string' } }, additionalProperties: false }
  }
};
const results = [];
function check(scope, name, ok, detail) { results.push({ scope, name, pass: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (ok ? '' : ' ' + JSON.stringify(detail ?? null))); }
const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) }).catch(() => {});
const rpc = (route, id, result) => json(route, { jsonrpc: '2.0', id, result });
const toolText = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/* JPEG dimensions from the SOFn marker, so the proof reads the bytes the page sent, not the page's own caption */
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });

/* Fixture images drawn by Chromium itself (no image encoder in Node): the big PNG the owner attaches,
   a small JPEG for the saved user message, and two "screenshots" for the saved browser turn. */
async function fixtureImages() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const made = await page.evaluate(() => {
    function draw(w, h, type, quality) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#10203a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e5383b'; g.fillRect(w * 0.1, h * 0.15, w * 0.35, h * 0.5);
      g.fillStyle = '#f4efe6'; g.fillRect(w * 0.55, h * 0.3, w * 0.3, h * 0.55);
      g.fillStyle = '#35d07f'; g.font = Math.round(h / 8) + 'px sans-serif'; g.fillText('fixture ' + w + 'x' + h, w * 0.08, h * 0.9);
      return c.toDataURL(type, quality).split(',')[1];
    }
    return { png: draw(2000, 1200, 'image/png'), small: draw(64, 64, 'image/jpeg', 0.7), shotA: draw(320, 200, 'image/jpeg', 0.6), shotB: draw(320, 200, 'image/jpeg', 0.45) };
  });
  await ctx.close();
  return made;
}
const IMG = await fixtureImages();
const LOG = Array.from({ length: 30 }, (_, i) => ({ at: '2026-11-17T22:00:00Z', task_id: 'task-saved', index: i, type: i % 3 === 0 ? 'open' : (i % 3 === 1 ? 'find' : 'click'), host: 'fixture.test', outcome: i === 29 ? 'refused' : 'ok', code: i === 29 ? 'BROWSER_HOST_NOT_ALLOWED' : null }));
const NODE = { route: 'fabric', node_id: 'node_fixture0000000000000000000000', node_name: 'laptop-fixture', site: 'owner-windows-gpu', hardware_mode: 'gpu-verified', generation_tokens_per_second: 21.37, measured_generation_tokens_per_second: 24.1, implementation: 'qwen3-vl.8b.local', model: 'qwen3-vl:8b' };
function browserMeta(taskId, pageUrl) {
  return { enabled: true, tasks: [
    { task_id: taskId, node_id: NODE.node_id, ok: true, steps: [{ index: 0, type: 'open', outcome: 'ok' }, { index: 1, type: 'read', outcome: 'ok' }, { index: 2, type: 'find', outcome: 'ok' }], page: { url: pageUrl, title: 'Fixture page' }, usage: { steps: 3, wall_ms: 1200 } },
    { task_id: taskId + '-b', node_id: NODE.node_id, ok: false, steps: [{ index: 0, type: 'open', outcome: 'refused', code: 'BROWSER_HOST_NOT_ALLOWED' }], page: { url: pageUrl, title: 'Fixture page' }, usage: { steps: 1, wall_ms: 40 } },
  ], screenshots: [
    { task_id: taskId, step: 1, base64: IMG.shotA, width: 320, height: 200, bytes: Math.floor(IMG.shotA.length * 3 / 4) },
    { task_id: taskId, step: 2, base64: IMG.shotB, width: 320, height: 200, bytes: Math.floor(IMG.shotB.length * 3 / 4) },
  ], action_log: LOG, dropped_screenshots: 1 };
}
const SAVED_USER = { id: 'saved-user-1', thread_id: THREAD, org_id: ORG, role: 'user', content: 'What does this page say? (saved fixture turn)', created_at: '2026-11-17T21:58:00Z', metadata: { input_mode: 'text', execution_kind: 'resident_ai_turn', agent_job_id: 'saved-user-1', task_status: 'done', images: [IMG.small], allow_browser: true } };
const SAVED_ASSISTANT = { id: 'saved-asst-1', thread_id: THREAD, org_id: ORG, role: 'assistant', content: 'The fixture page says hello. (saved fixture reply)', model: 'qwen3-vl:8b', implementation: 'qwen3-vl.8b.local', created_at: '2026-11-17T22:00:00Z', metadata: { agent_job_id: 'saved-user-1', task_status: 'done', images_in: 1, node: NODE, browser: browserMeta('task-saved', 'https://fixture.test/ok'), tool_receipts: [] } };

async function setup(viewport, { owner = true, core = 'current' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 1000, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const submits = [], errors = [], polls = {};
  await ctx.addInitScript(({ OWNER }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: OWNER, email: 'owner@fixture.invalid' })).replace(/=+$/, '') + '.y', refresh_token: 'fixture-only', expires_at: exp, user: { id: OWNER, email: 'owner@fixture.invalid' } }));
  }, { OWNER });
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.hostname === 'cesium.com' || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return route.abort();
    if (u.origin === 'https://api.mccluster.org') {
      if (p === '/health') return json(route, { ok: true });
      if (p === '/v1/status') return owner ? json(route, { ok: true, operator: { email: 'owner@fixture.invalid' }, database: { reachable: true } }) : json(route, { error: 'Forbidden' }, 403);
      if (p === '/v1/workspaces/me') return json(route, { ok: true, profile: { id: OWNER }, default_org_id: ORG, workspaces: [{ org_id: ORG, slug: 'mccluster', kind: 'studio', role: owner ? 'owner' : 'viewer', enabled: true, name: 'McCluster' }] });
      if (p === '/v1/core/mcp' && req.method() === 'POST') {
        const body = req.postDataJSON();
        if (body.method === 'tools/list') {
          /* 'down': the bridge cannot reach the Core, so the tool list is never read */
          if (core === 'down') return json(route, { error: 'Core bridge unavailable' }, 503);
          return rpc(route, body.id, { tools: TOOLS.map((name) => ({ name, description: 'fixture', inputSchema: SCHEMAS[core][name] || { type: 'object' } })) });
        }
        if (body.method === 'tools/call') {
          const name = body.params?.name, args = body.params?.arguments || {};
          if (name === 'core.ai.turn.submit') {
            submits.push(args);
            if (!owner && args.allow_browser) return rpc(route, body.id, { isError: true, content: [{ type: 'text', text: 'BROWSER_OWNER_REQUIRED' }] });
            return rpc(route, body.id, toolText({ turn_id: args.message_id, job_status: 'queued' }));
          }
          if (name === 'core.ai.turn.get') {
            const id = args.turn_id; polls[id] = (polls[id] || 0) + 1;
            const submitted = submits.find((s) => s.message_id === id) || {};
            const userMessage = { id, thread_id: THREAD, org_id: ORG, role: 'user', content: submitted.content || '', created_at: new Date().toISOString(), metadata: { input_mode: 'text', execution_kind: 'resident_ai_turn', agent_job_id: id, task_status: 'running', images: submitted.images || [], allow_browser: submitted.allow_browser === true, actor_user_id: OWNER, tool_receipts: [{ tool: 'browser_act', ok: true, duration_ms: 1200, task_id: 'task-live', node_id: NODE.node_id, steps: [{ index: 0, type: 'open', outcome: 'ok' }, { index: 1, type: 'read', outcome: 'ok' }], page: { url: 'https://fixture.test/ok', title: 'Fixture page' }, screenshots: 1 }] } };
            /* the first poll finds the turn still running with one checkpointed receipt; the second finds it done */
            if (polls[id] < 2) return rpc(route, body.id, toolText({ turn: { id, status: 'running', job_type: 'resident_ai_turn' }, user_message: userMessage, assistant_message: null }));
            userMessage.metadata.task_status = 'done';
            const assistant = { id: 'asst-' + id, thread_id: THREAD, org_id: ORG, role: 'assistant', content: 'The fixture page shows a heading and a form. (fixture reply)', model: 'qwen3-vl:8b', implementation: 'qwen3-vl.8b.local', created_at: new Date().toISOString(), metadata: { agent_job_id: id, task_status: 'done', images_in: (submitted.images || []).length, node: NODE, browser: browserMeta('task-live', 'https://fixture.test/ok'), tool_receipts: userMessage.metadata.tool_receipts } };
            return rpc(route, body.id, toolText({ turn: { id, status: 'done', job_type: 'resident_ai_turn' }, user_message: userMessage, assistant_message: assistant }));
          }
          if (name === 'core.resume') return rpc(route, body.id, toolText({ pending_approvals: [] }));
          return rpc(route, body.id, toolText({}));
        }
        return rpc(route, body.id, {});
      }
      return json(route, { ok: true, threads: [], apps: [], events: [], jobs: [], decisions: [], leads: [], total: 0 });
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') return json(route, { id: OWNER, email: 'owner@fixture.invalid' });
      if (p === '/rest/v1/ops_ai_threads') return json(route, [{ id: THREAD, org_id: ORG, title: 'Fixture chat', status: 'active', last_message_at: '2026-11-17T22:00:00Z', created_at: '2026-11-17T21:00:00Z' }]);
      if (p === '/rest/v1/ops_ai_messages' && req.method() === 'GET') return json(route, [SAVED_USER, SAVED_ASSISTANT]);
      if (p === '/rest/v1/leads') return json(route, [], 200, { 'content-range': '0-0/0' });
      return json(route, []);
    }
    if (u.origin === BASE) {
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\//, '')); const file = resolve(ROOT, rel);
      if (!file.startsWith(resolve(ROOT) + sep)) return route.abort();
      try { return route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.goto(BASE + '/control.html#home:ask', { waitUntil: 'domcontentloaded' });
  return { ctx, page, submits, errors, polls };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/* every node badge as drawn: its words, whether any of them is cut off (scrollWidth past clientWidth), and whether it stays
   inside its own message */
const badges = (page) => page.evaluate(() => [...document.querySelectorAll('.cr-ai-node')].map((b) => {
  const r = b.getBoundingClientRect(), m = b.closest('.cr-ai-message').getBoundingClientRect();
  return { text: b.textContent, sw: b.scrollWidth, cw: b.clientWidth, inside: r.left >= m.left - 0.5 && r.right <= m.right + 0.5, w: Math.round(r.width), h: Math.round(r.height) };
}));
const wholeBadges = (list) => list.length >= 1 && list.every((b) => b.sw <= b.cw + 1 && b.inside && /tok\/s/.test(b.text));
/* the composer's controls and lines as drawn */
const composer = (page) => page.evaluate(() => ({ attach: document.querySelectorAll('[data-action="ai-attach"]').length, picker: document.querySelectorAll('#crAiAttach').length,
  switch: document.querySelectorAll('[data-action="ai-browser-toggle"]').length,
  images: (document.querySelector('[data-ai-capability="images"]') || {}).textContent || '', browser: (document.querySelector('[data-ai-capability="browser"]') || {}).textContent || '' }));
async function until(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; }

try {
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const S = vp.width + 'px owner';
    const app = await setup(vp); const { page, submits } = app;
    await page.waitForSelector('#crAiComposer:not([disabled])', { timeout: 30000 });
    await page.waitForSelector('.cr-ai-browser', { timeout: 15000 });
    /* the saved fixture turn renders as the thread is read */
    const saved = await page.evaluate(() => {
      const details = document.querySelector('.cr-ai-message--assistant .cr-ai-browser');
      return { collapsed: !!details && !details.open, summary: details ? details.querySelector('summary').textContent : '', imgs: details ? details.querySelectorAll('figure img').length : 0, log: details ? details.querySelectorAll('.cr-ai-browser__log li').length : 0, badge: (document.querySelector('.cr-ai-node') || {}).textContent || '', userImgs: document.querySelectorAll('.cr-ai-message--user .cr-ai-message__images img').length, refused: details ? details.querySelectorAll('.is-bad').length : 0 };
    });
    check(S, 'the saved browser turn renders collapsed: "Browser: 4 steps on fixture.test"', saved.collapsed && saved.summary === 'Browser: 4 steps on fixture.test', saved);
    check(S, 'its two screenshots and 30 action-log entries are inside the block, the refused step marked', saved.imgs === 2 && saved.log === 30 && saved.refused >= 2, saved);
    check(S, 'the node badge names the node, its hardware mode and the measured rate', saved.badge === 'laptop-fixture · gpu-verified · 21.4 tok/s', saved.badge);
    const drawn = await badges(page);
    check(S, 'the node badge shows its whole content, the rate included, inside its message', wholeBadges(drawn), drawn);
    const honoured = await composer(page);
    check(S, 'a Core that declares images and the browser flag gets both controls and neither off line', honoured.attach === 1 && honoured.picker === 1 && honoured.switch === 1 && !honoured.images && !honoured.browser, honoured);
    check(S, "the saved user message shows its attached image", saved.userImgs === 1, saved.userImgs);
    const naturalOk = await page.evaluate(async () => { const img = document.querySelector('.cr-ai-browser figure img'); if (!img) return false; if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; }); return img.naturalWidth === 320 && img.naturalHeight === 200; });
    check(S, 'a screenshot decodes as the 320x200 JPEG the fixture carries', naturalOk);
    check(S, 'no horizontal overflow with the thread rendered', (await overflow(page)) === 0, await overflow(page));
    await page.screenshot({ path: join(OUT, `ask-thread-${vp.width}.png`) });
    /* the owner's switch, honest about readiness, off by default */
    await page.locator('#crAiComposeTools > summary').click();
    const sw = page.locator('[data-action="ai-browser-toggle"]');
    check(S, 'the owner sees the "Use the browser" switch, off, with the readiness line from the last browser turn', (await sw.count()) === 1 && (await sw.getAttribute('aria-checked')) === 'false' && (await sw.getAttribute('role')) === 'switch' && (await page.locator('[data-ai-browser-ready="ready"]').count()) === 1);
    /* attach the big PNG: downscaled on the client */
    await page.setInputFiles('#crAiAttach', { name: 'big-fixture.png', mimeType: 'image/png', buffer: Buffer.from(IMG.png, 'base64') });
    await page.waitForSelector('.cr-ai-thumb', { timeout: 15000 });
    const thumbMeta = await page.locator('.cr-ai-thumb__meta').first().textContent();
    check(S, 'the thumbnail says the image was downscaled to 1280×768', /^1280×768 · /.test(thumbMeta || ''), thumbMeta);
    check(S, 'the attach button and hint count one of two', /1\/2/.test(await page.locator('#crAiAttachHint').textContent()));
    await sw.click();
    check(S, 'the switch turns on', (await sw.getAttribute('aria-checked')) === 'true');
    await page.fill('#crAiComposer', 'What is on this page? (proof turn)');
    await page.click('[data-action="ai-send"]');
    check(S, 'one durable turn is submitted', await until(() => submits.length === 1), submits.length);
    const sent = submits[0] || {};
    const b64 = Array.isArray(sent.images) ? sent.images[0] : null;
    const buf = b64 && B64.test(b64) ? Buffer.from(b64, 'base64') : Buffer.alloc(0);
    const size = buf.length ? jpegSize(buf) : null;
    check(S, 'the submit carries exactly one image as bare base64 JPEG at most 200,000 bytes and 1280 px wide', Array.isArray(sent.images) && sent.images.length === 1 && B64.test(b64) && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf.length <= 200000 && size && size.width === 1280 && size.height === 768, { count: sent.images && sent.images.length, bytes: buf.length, size });
    check(S, 'the submit carries allow_browser true and the typed content', sent.allow_browser === true && sent.content === 'What is on this page? (proof turn)' && sent.thread_id === THREAD, { allow_browser: sent.allow_browser, content: sent.content });
    check(S, 'the attachments are cleared once the turn is submitted', await until(async () => (await page.locator('.cr-ai-thumb').count()) === 0, 5000));
    check(S, 'live steps from the checkpointed receipts show while the turn runs', await until(async () => (await page.locator('.cr-ai-steps').count()) === 1, 8000));
    const liveText = await page.locator('.cr-ai-steps').first().textContent().catch(() => '');
    check(S, 'the live steps name the task and its steps', /browser_act · task-live · 2 steps · fixture\.test/.test(liveText) && /0 open ok/.test(liveText), liveText);
    check(S, 'the turn settles with a second browser record and no pending bubble', await until(async () => (await page.locator('.cr-ai-message--assistant .cr-ai-browser').count()) === 2 && (await page.locator('.cr-ai-message--pending').count()) === 0, 15000));
    const newer = await page.evaluate(() => { const all = document.querySelectorAll('.cr-ai-message--assistant .cr-ai-browser'); const d = all[all.length - 1]; return { summary: d.querySelector('summary').textContent, imgs: d.querySelectorAll('figure img').length, open: d.open, badges: document.querySelectorAll('.cr-ai-node').length, images: document.querySelectorAll('.cr-ai-message--user .cr-ai-message__images img').length }; });
    check(S, 'the new reply renders its own collapsed browser record, screenshots and badge, and the sent image shows on the user message', newer.summary === 'Browser: 4 steps on fixture.test' && newer.imgs === 2 && !newer.open && newer.badges === 2 && newer.images === 2, newer);
    check(S, 'no horizontal overflow after the turn', (await overflow(page)) === 0, await overflow(page));
    await page.screenshot({ path: join(OUT, `ask-turn-${vp.width}.png`) });
    check(S, 'no script errors', app.errors.length === 0, app.errors);
    await app.ctx.close();
  }
  {
    /* the badge at the tablet width (N2V-m2): the saved turn's node badge, whole and inside its message */
    const S = '820px owner';
    const app = await setup({ width: 820, height: 1180 }); const { page } = app;
    await page.waitForSelector('.cr-ai-node', { timeout: 30000 });
    const drawn = await badges(page);
    check(S, 'the node badge shows its whole content, the rate included, inside its message', wholeBadges(drawn), drawn);
    check(S, 'no horizontal overflow', (await overflow(page)) === 0, await overflow(page));
    await page.screenshot({ path: join(OUT, 'ask-thread-820.png') });
    check(S, 'no script errors', app.errors.length === 0, app.errors);
    await app.ctx.close();
  }
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    /* the Core on OVH at eb942248: it would drop a turn's images and the browser flag and send an image to a text model */
    const S = vp.width + 'px owner, Core eb942248';
    const app = await setup(vp, { core: 'eb942248' }); const { page, submits } = app;
    await page.waitForSelector('#crAiComposer:not([disabled])', { timeout: 30000 });
    await page.waitForSelector('.cr-ai-browser', { timeout: 15000 });
    const off = await composer(page);
    check(S, 'no attach control, and one honest line in its place', off.attach === 0 && off.picker === 0 && off.images === 'Attach image is off: the Core running now does not accept images in a turn.', off);
    check(S, 'no browser switch for the owner, and one honest line in its place', off.switch === 0 && off.browser === 'Use the browser is off: the Core running now does not honour browser turns.', off);
    check(S, 'the saved thread still renders, badge and all', (await page.locator('.cr-ai-message--assistant .cr-ai-browser').count()) === 1 && wholeBadges(await badges(page)));
    await page.fill('#crAiComposer', 'A plain question for the older Core (proof turn)');
    await page.click('[data-action="ai-send"]');
    check(S, 'one durable turn is submitted', await until(() => submits.length === 1), submits.length);
    const sent = submits[0] || {};
    check(S, 'it carries neither images nor allow_browser: only the fields that Core declares', !('images' in sent) && !('allow_browser' in sent) && sent.content === 'A plain question for the older Core (proof turn)'
      && Object.keys(sent).every((k) => Object.keys(SCHEMAS.eb942248['core.ai.turn.submit'].properties).includes(k)), Object.keys(sent));
    check(S, 'no horizontal overflow', (await overflow(page)) === 0, await overflow(page));
    await page.screenshot({ path: join(OUT, `ask-older-core-${vp.width}.png`) });
    check(S, 'no script errors', app.errors.length === 0, app.errors);
    await app.ctx.close();
  }
  {
    /* the tool list could not be read (review LDR-F3): the page does not know what the Core accepts, and says so */
    const S = '390px owner, tool list unreadable';
    const app = await setup({ width: 390, height: 844 }, { core: 'down' }); const { page, submits } = app;
    await page.waitForSelector('[data-ai-capability="images"]', { timeout: 30000, state: 'attached' });
    await page.locator('#crAiComposeTools > summary').click();
    await page.waitForSelector('.cr-source', { timeout: 15000 }).catch(() => {});
    const off = await composer(page);
    const basis = await page.evaluate(() => [...document.querySelectorAll('[data-ai-capability]')].map((l) => l.getAttribute('data-ai-capability-basis') + ' ' + l.getAttribute('title')));
    check(S, 'no attach control and no switch, and each line says the Core\'s word is not known', off.attach === 0 && off.picker === 0 && off.switch === 0
      && off.images === "Attach image is off: the Core's tool list has not been read, so whether it accepts images is not known."
      && off.browser === "Use the browser is off: the Core's tool list has not been read, so whether it honours browser turns is not known.", off);
    check(S, 'the lines and their titles claim nothing about the Core', basis.length === 2 && basis.every((b) => /^unknown /.test(b) && !/declares no/.test(b)), basis);
    const words = await page.evaluate(() => document.body.innerText);
    check(S, 'nothing on the page says the Core refuses what the page could not read', !/does not accept images|does not honour browser turns/.test(words));
    const banner = await page.evaluate(() => [...document.querySelectorAll('.cr-source')].map((b) => b.textContent).join(' | '));
    check(S, 'the page says the tool list did not answer', /Source unavailable/.test(banner) && /AI execution path/.test(banner) && /HTTP 503/.test(banner), banner);
    check(S, 'nothing was submitted', submits.length === 0, submits.length);
    check(S, 'no horizontal overflow', (await overflow(page)) === 0, await overflow(page));
    await page.locator('[data-ai-capability="browser"]').scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: join(OUT, 'ask-tools-unread-390.png') });
    check(S, 'no script errors', app.errors.length === 0, app.errors);
    await app.ctx.close();
  }
  {
    const S = '390px member, Core eb942248';
    const app = await setup({ width: 390, height: 844 }, { owner: false, core: 'eb942248' }); const { page } = app;
    await page.waitForSelector('.cr-ai-owner-gate', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const off = await composer(page);
    check(S, 'a member sees no owner composer or private controls', off.attach === 0 && !off.images && off.switch === 0 && !off.browser && await page.locator('#crAiComposer').count() === 0, off);
    await app.ctx.close();
  }
  {
    const S = '390px member';
    const app = await setup({ width: 390, height: 844 }, { owner: false }); const { page, submits } = app;
    await page.waitForSelector('.cr-ai-owner-gate', { timeout: 30000 });
    await page.waitForTimeout(1500);
    check(S, 'a member never sees the browser switch', (await page.locator('[data-action="ai-browser-toggle"]').count()) === 0);
    check(S, 'the owner workspace hides the composer and attachments', (await page.locator('[data-action="ai-attach"]').count()) === 0 && (await page.locator('#crAiComposer').count()) === 0);
    check(S, 'nothing was submitted', submits.length === 0);
    check(S, 'no horizontal overflow', (await overflow(page)) === 0, await overflow(page));
    await page.screenshot({ path: join(OUT, 'ask-member-390.png') });
    await app.ctx.close();
  }
} catch (error) {
  console.log('FAIL [harness] ' + (error && error.stack || error));
  results.push({ scope: 'harness', name: 'ran to completion', pass: false });
} finally { await browser.close(); }
const failed = results.filter((r) => !r.pass).length;
console.log((results.length - failed) + '/' + results.length + ' checks passed');
if (failed) process.exitCode = 1;
