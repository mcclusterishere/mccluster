/* Actual protected staging UI, Playwright 1.57.0. No route interception,
   fulfilled responses, injected auth, fake DOM, or production requests.

   MCCLUSTER_STAGING_STATE_FILE=/private/state.json PLAYWRIGHT_DIR=/deps/node_modules \
     node scripts/e2e/owner-ai-staging.e2e.mjs /private/browser-proof

   The state file supplies {url,access_code,expires_at}. Only the artifact
   directory is a CLI argument. Credentials are never printed, captured in
   traces/videos, or written to the report; screenshots require cleared setup.
   Synthetic identities/model text and simulated Mac hardware remain explicit.
*/
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || process.env.MCCLUSTER_STAGING_BROWSER_OUT || '/tmp/owner-ai-staging-browser-proof');
const stateFile = process.env.MCCLUSTER_STAGING_STATE_FILE;
if (!stateFile) throw new Error('MCCLUSTER_STAGING_STATE_FILE must name the private staging state file.');
const stage = JSON.parse(await readFile(stateFile, 'utf8'));
const origin = new URL(stage.url);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Expected the protected HTTPS staging origin.');
if (!/^[A-Za-z0-9_-]{32}$/.test(stage.access_code || '') || Date.parse(stage.expires_at) < Date.now() + 120_000) throw new Error('The temporary stage access artifact is invalid or near expiry.');
const require = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'loader.cjs'));
if (require('playwright/package.json').version !== '1.57.0') throw new Error('This acceptance script requires Playwright 1.57.0.');
const { chromium } = require('playwright');
await mkdir(OUT, { recursive: true, mode: 0o700 });
const results = [], contexts = [], observed = new Map(), responseTasks = new Set();
let phase = 'browser startup', parallelObserved = false, activePage = null;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
function check(name, pass, detail) {
  results.push({ name, status: pass ? 'passed' : 'failed', ...(detail ? { detail } : {}) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) throw new Error(name);
}
function skip(name, reason) { results.push({ name, status: 'not_verified', reason }); console.log(`NOT VERIFIED ${name}`); }
function safeError(error) {
  return String(error?.message || error).replaceAll(stage.access_code, '[staging code redacted]')
    .replace(/mcen1_[A-Za-z0-9_-]+/g, '[enrollment credential redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[session redacted]').slice(0, 1800);
}
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const panel = (page, name) => page.locator(`[data-action="ai-panel"][data-panel="${name}"]`).click();
const assistant = page => page.locator('.cr-ai-message--assistant:not(.cr-ai-message--pending)');
async function until(test, message, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await new Promise(resolveWait => setTimeout(resolveWait, 250)); }
  throw new Error(message);
}
function unwrap(response) {
  let value = response?.result?.structuredContent;
  if (!value) { const text = response?.result?.content?.find(item => item.type === 'text')?.text; if (text) try { value = JSON.parse(text); } catch {} }
  for (let n = 0; n < 5 && value?.result; n += 1) value = value.result;
  return value;
}
function observe(page) {
  page.on('response', response => {
    if (new URL(response.url()).pathname !== '/v1/core/mcp') return;
    const request = response.request(); let rpc;
    try { rpc = request.postDataJSON(); } catch { return; }
    if (rpc?.params?.name !== 'core.ai.turn.get') return;
    const pending = (async () => {
      const value = unwrap(await response.json());
      const id = value?.turn?.id || rpc.params.arguments?.turn_id;
      if (!id || !value?.turn) return;
      const record = observed.get(id) || { id, statuses: [], chunks: 0, node_id: null, terminal: false };
      record.statuses.push(value.turn.status);
      record.node_id = value.progress?.node?.node_id || value.assistant_message?.metadata?.node?.node_id || record.node_id;
      if (value.progress?.content) record.chunks += 1;
      record.terminal = ['done', 'failed', 'canceled'].includes(value.turn.status);
      record.last_seen_at = Date.now(); observed.set(id, record);
      const active = [...observed.values()].filter(item => !item.terminal && item.chunks > 0 && Date.now() - item.last_seen_at < 5000);
      if (new Set(active.map(item => item.node_id).filter(Boolean)).size >= 2) parallelObserved = true;
    })().catch(() => {}).finally(() => responseTasks.delete(pending));
    responseTasks.add(pending);
  });
}
async function login(role, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
  contexts.push(context); const page = await context.newPage(); activePage = page; page.setDefaultTimeout(20_000); observe(page);
  await page.goto(origin.href, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Access code', { exact: true }).fill(stage.access_code);
  await page.getByRole('button', { name: 'Open staging workspace', exact: true }).click();
  await page.locator('#cpIn').waitFor({ state: 'visible' });
  await page.locator(`[data-staging-role="${role}"]`).click();
  await page.locator('#cpIn').click();
  await page.locator('#cpGate').waitFor({ state: 'hidden' });
  await page.locator(role === 'owner' ? '.cr-ai-workspace' : '.cr-ai-owner-gate').waitFor();
  return page;
}
async function screenshot(page, filename, fullPage = true) {
  check(`${filename}: enrollment fields are cleared before screenshot`, await page.locator('#crAiCredential').count() === 0 && await page.locator('#stagingWorkerCredential').inputValue() === '' && await page.locator('#code').count() === 0);
  await page.screenshot({ path: join(OUT, filename), fullPage });
}
async function layout(page, width, screen) {
  const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, workspace: document.querySelector('.cr-ai-workspace')?.getBoundingClientRect().toJSON() }));
  check(`${screen} fits ${width}px without horizontal page overflow`, metrics.viewport === width && metrics.document <= width + 1 && metrics.body <= width + 1, metrics);
  await screenshot(page, `${screen}-${width}.png`);
  if (screen === 'chat') {
    /* A full-page image alone cannot prove the floating mobile navigation
       leaves the composer usable. Trial actions scroll normally and perform
       real hit testing without submitting another job. */
    await page.locator('#crAiComposer').click({ trial: true });
    await action(page, 'ai-send').click({ trial: true });
    check(`Composer and Send are reachable above navigation at ${width}px`, true);
    await screenshot(page, `chat-composer-${width}.png`, false);
    await page.locator('#crAiComposeTools > summary').click();
    const card = await page.locator('.cr-ai-chat__main').evaluate(element => ({ client_height: element.clientHeight, scroll_height: element.scrollHeight, overflow_y: getComputedStyle(element).overflowY }));
    check(`Expanded tools are not vertically clipped inside the chat card at ${width}px`, !['hidden', 'clip'].includes(card.overflow_y) || card.scroll_height <= card.client_height + 2, card);
    await action(page, 'ai-send').click({ trial: true });
    check(`Opening attachment tools leaves Send reachable at ${width}px`, true);
    await screenshot(page, `chat-tools-${width}.png`, false);
    await page.locator('#crAiComposeTools > summary').click();
  }
}
async function newChat(page) {
  await panel(page, 'chat');
  if (!await action(page, 'ai-new-thread').isVisible()) await page.locator('#crAiHistory > summary').click();
  const previous = await page.locator('.cr-ai-thread.is-on').getAttribute('data-id').catch(() => null);
  await action(page, 'ai-new-thread').click();
  await until(async () => { const current = await page.locator('.cr-ai-thread.is-on').getAttribute('data-id').catch(() => null); return current && current !== previous && await page.locator('#crAiComposer').isEnabled(); }, 'New conversation did not become ready.');
  return page.locator('.cr-ai-thread.is-on').getAttribute('data-id');
}
async function selectThread(page, id) {
  await panel(page, 'chat');
  if (!await page.locator(`[data-action="ai-select-thread"][data-id="${id}"]`).isVisible()) await page.locator('#crAiHistory > summary').click();
  await page.locator(`[data-action="ai-select-thread"][data-id="${id}"]`).click();
}
async function send(page, nodeId, content) {
  await page.locator('#crAiDevice').selectOption(`node:${nodeId}`);
  await page.locator('#crAiComposer').fill(content); await action(page, 'ai-send').click();
  await action(page, 'ai-stop').waitFor();
}
async function partial(page) {
  await until(async () => await page.locator('#crAiProgress').count() > 0 && /Staging test output\./.test(await page.locator('#crAiProgress').innerText()), 'No actual streamed partial text appeared before completion.');
}
async function completed(page, name, previous = 0) {
  await until(async () => await assistant(page).count() > previous && !await action(page, 'ai-stop').count(), `No final reply from ${name}.`, 60_000);
  const receipt = await assistant(page).last().locator('.cr-ai-receipt > summary').innerText();
  check(`Final receipt names ${name}`, receipt.includes(name), { receipt });
  check(`Reply from ${name} is explicitly synthetic`, /synthetic/.test(await assistant(page).last().innerText()));
}
async function install(page, name) {
  await panel(page, 'devices'); await action(page, 'ai-add-device').click();
  await page.locator('#crAiDeviceName').fill(name); await action(page, 'ai-enroll').click();
  await page.locator('#crAiCredential').waitFor();
  check('Enrollment is masked and setup command is secret-free', await page.locator('#crAiCredential').getAttribute('type') === 'password' && !/mcen1_/.test(await page.locator('#crAiSetupCommand').innerText()));
  let credential = await page.locator('#crAiCredential').inputValue();
  if (!/^mcen1_[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error('Core did not issue the expected one-time credential format.');
  if (!await page.locator('#stagingWorkerCredential').isVisible()) await page.locator('#ownerAiStagingWorkers > summary').click();
  await page.locator('#stagingWorkerName').fill(name);
  await page.locator('#stagingWorkerCredential').fill(credential); credential = '';
  await page.locator('#stagingInstallWorker').click();
  await until(async () => (await page.locator('#stagingWorkerStatus').innerText()).startsWith('Simulated Mac worker installed.'), 'The explicit test-worker installation did not finish.', 60_000);
  check('Simulator clears the one-time credential after posting', await page.locator('#stagingWorkerCredential').inputValue() === '');
  await action(page, 'ai-forget-enrollment').click();
  await page.locator('#ownerAiStagingWorkers > summary').click();
  await action(page, 'ai-refresh-devices').click();
  const card = page.locator('.cr-ai-device[data-ai-device]').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card.waitFor();
  await until(() => card.locator('[data-action="ai-device-test"]').isEnabled(), `Signed worker ${name} did not become ready.`);
  const nodeId = await card.getAttribute('data-ai-device');
  check(`${name} appears as an enrolled signed worker`, Boolean(nodeId));
  await card.locator('[data-action="ai-device-test"]').click();
  await until(async () => (await card.locator('.cr-ai-state').innerText()) === 'Test passed', `Device benchmark did not pass for ${name}.`, 60_000);
  check(`${name} passed the actual queued device test`, true);
  return nodeId;
}

try {
  phase = 'owner login';
  const page = await login('owner', { width: 1280, height: 900 });
  check('Actual staging owner login opens McCluster AI', await page.getByRole('heading', { name: 'McCluster AI', exact: true }).isVisible());
  check('Staging distinguishes simulated hardware and model output', /simulated Mac workers and synthetic model output/.test(await page.locator('#ownerAiStagingBanner').innerText()));
  await until(() => page.locator('#crAiDevice').isEnabled(), 'Core routing tools did not become available.');
  phase = 'enrollment and signed worker test';
  const suffix = Date.now().toString(36), firstName = `Browser iMac A ${suffix}`, secondName = `Browser iMac B ${suffix}`;
  const first = await install(page, firstName), second = await install(page, secondName);
  for (const width of [390, 820, 1280]) { await page.setViewportSize({ width, height: width === 820 ? 1180 : 900 }); await layout(page, width, 'devices'); }
  phase = 'parallel pinned conversations';
  const firstThread = await newChat(page); await send(page, first, 'Show the staged execution path through this first Mac worker.');
  await partial(page); check('First pinned job renders actual partial model text', true);
  const secondThread = await newChat(page); await send(page, second, 'Run this independent staged task on the second Mac worker.');
  await partial(page); check('Second pinned job renders actual partial model text', true);
  await completed(page, secondName);
  await selectThread(page, firstThread); await completed(page, firstName);
  if (parallelObserved) check('Different worker conversations had overlapping observed streamed progress', true);
  else skip('Overlapping worker execution in the browser observation', 'Both independent pinned jobs completed, but browser polling did not capture both before terminal completion. The signed runtime E2E separately checks concurrency.');
  phase = 'responsive chat and reconnect';
  for (const width of [390, 820, 1280]) { await page.setViewportSize({ width, height: width === 820 ? 1180 : 900 }); await layout(page, width, 'chat'); }
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.cr-ai-workspace').waitFor();
  await selectThread(page, firstThread); await assistant(page).first().waitFor();
  check('Reload recovers the durable conversation and worker receipt', (await assistant(page).last().locator('.cr-ai-receipt > summary').innerText()).includes(firstName));
  phase = 'stop, retry and review';
  await newChat(page); await send(page, first, 'Produce a staged answer so I can stop the run.'); await partial(page);
  await action(page, 'ai-stop').click();
  await until(async () => !await action(page, 'ai-stop').count() && /Stopped/.test(await page.locator('.cr-ai-message--user').last().innerText()), 'Stop was not durably reflected in the conversation.');
  check('Stop becomes a durable stopped message', true);
  await action(page, 'ai-retry').last().click(); await completed(page, firstName);
  check('Retry completes through the current pinned worker', true);
  await action(page, 'ai-review').last().click();
  await page.locator('#crAiDevice').selectOption(`node:${second}`);
  await action(page, 'ai-send').click(); await completed(page, secondName, 1);
  check('Saved result review finishes on the second worker', true);
  phase = 'revoke and unavailable pin';
  await panel(page, 'devices');
  const card = page.locator(`[data-ai-device="${first}"]`);
  await card.locator('[data-action="ai-device-revoke"]').click(); await card.locator('[data-action="ai-device-confirm-revoke"]').click();
  await until(async () => (await card.locator('.cr-ai-state').innerText()) === 'Revoked', 'The worker was not shown as revoked.');
  check('Revocation is confirmed by the actual device list', true);
  await panel(page, 'chat'); await page.locator('#crAiDevice').selectOption(`node:${first}`);
  check('Pinning the revoked worker blocks Send with a recovery reason', !await action(page, 'ai-send').isEnabled() && await page.locator('.cr-ai-route-error').isVisible());
  await screenshot(page, 'revoked-worker-pin.png');
  phase = 'member access boundary';
  const member = await login('member', { width: 390, height: 844 });
  check('Member receives the owner-only workspace gate', await member.locator('.cr-ai-owner-gate').isVisible() && await member.locator('#crAiComposer').count() === 0 && await action(member, 'ai-add-device').count() === 0);
  await screenshot(member, 'member-owner-only-390.png');
  skip('Physical Mac installer, Ollama speed and shared-model fit', 'These are simulated signed Mac workers and synthetic output. No physical Mac, GPU benchmark or distributed 27B model was verified.');
  skip('Expired/reused enrollment and revoked lease protocol in this browser script', 'Covered by the real SQL/signed gateway acceptance suite and staging preflight; this UI script does not claim to have waited ten minutes or sent raw protocol probes.');
} catch (error) {
  /* Visible text and known page states diagnose redirects without dumping
     form values, HTML, URLs with queries, session storage or network bodies. */
  let pageState;
  if (activePage && !activePage.isClosed()) try {
    const diagnostic = await activePage.evaluate(() => ({
      title: document.title, pathname: location.pathname,
      staging_gate: Boolean(document.querySelector('#code')),
      login_button: Boolean(document.querySelector('#cpIn')),
      owner_workspace: Boolean(document.querySelector('.cr-ai-workspace')),
      body_excerpt: document.body?.innerText.slice(0, 2400) || ''
    }));
    pageState = Object.fromEntries(Object.entries(diagnostic).map(([key, value]) => [key, typeof value === 'string' ? safeError(value) : value]));
  } catch { pageState = { diagnostic_unavailable: true }; }
  results.push({ name: phase, status: 'failed', error: safeError(error), ...(pageState ? { page_state: pageState } : {}) });
  console.error(`FAIL ${phase}: ${safeError(error)}`); process.exitCode = 1;
} finally {
  await Promise.allSettled([...responseTasks]);
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
  const report = { schema: 'mccluster-owner-ai-staging-browser/1', origin: origin.origin, observed_at: new Date().toISOString(), evidence: 'Actual protected staging HTTP/Core/SQL and signed worker protocol; synthetic auth/model output and simulated Mac hardware.', production_changed: false, results, runs: [...observed.values()] };
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`Browser evidence: ${results.filter(result => result.status === 'passed').length} passed; ${results.filter(result => result.status === 'failed').length} failed; ${results.filter(result => result.status === 'not_verified').length} explicitly unverified.`);
}
