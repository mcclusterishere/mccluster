/* A RELEASE GOES FROM SUBMIT TO ITS ARTIST PAGE, IN A REAL BROWSER (music slice M6, 2026-11-19).
   ============================================================
   Creator Studio publishes and is measured. Every page is the real one, served from this checkout under Matthew
   McCluster's real origin; the auth server, PostgREST, Storage, the music Edge function, the collector and the API
   Worker are the stand-ins in scripts/e2e/support/music-accounts-plane.mjs and music-release-plane.mjs; every other
   request is aborted. Nothing reaches a live host. All at 390 px, where every page is measured
   (scrollWidth === clientWidth).

     submit    a creator, who agreed to the privacy notice, uploads a release in Creator Studio: it waits for review,
               it can be edited (only the version on screen) or withdrawn, and creator_* events reach the collector
     review    the house owner in Control · Create · Music · Review: Publish stays shut until Verify + listen has
               played the pinned master and shown its hash; Publish then carries the version and that hash and the
               release goes live (never "expected_updated_at required"); the vault, which is not in the database,
               says so instead of failing
     artist    the release on its artist page, playing for a guest; nothing is offered on a live release
     consent   a creator who answered "Not now": the studio's events are skipped (analytics.js is on the page and
               sends nothing); withdraw, submit again and delete, and a verified release that stays withdrawn
     door      Creator Studio in the signed-in Profile menu, on Matthew's music pages only: a creator and the owner
               see it; a member, the home page and a World host do not

     node scripts/e2e/music-creator-release.e2e.mjs [outDir]
   outDir (default: the system's temporary folder) receives result.json, every check and its outcome.
   M6_SHOTS=<dir> runs every page at device scale 2 and writes the owner's screenshots there.
   ============================================================ */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePlane, HOUSE, PEOPLE } from './support/music-accounts-plane.mjs';
import { makeReleasePlane, WORLD } from './support/music-release-plane.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const OUT = process.argv[2] || join(tmpdir(), 'music-creator-release-e2e');
const SHOTS = process.env.M6_SHOTS || '';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const failures = [];
const checks = [];
const check = (ok, what) => { checks.push({ ok: !!ok, what }); if (!ok) failures.push(what); console.log((ok ? 'ok   ' : 'FAIL ') + what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (page, fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout, polling: 100 }).then(() => true, () => false);
const wait = async (fn, timeout = 10000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (fn()) return true; await sleep(100); } return !!fn(); };
const fits = async (page, label) => {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  check(m.s === m.c, `${label}: at 390 px scrollWidth ${m.s} === clientWidth ${m.c}`);
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: false }).catch(() => {}); };

/* a short WAV of a fixed tone pattern; two seeds, two different masters */
function wav(seconds, seed) {
  const rate = 8000, n = Math.ceil(seconds * rate), b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin((i * (seed + 2) * Math.PI) / 40));
  return b;
}
const MASTER_1 = wav(3, 1), MASTER_2 = wav(2, 5), MASTER_3 = wav(2, 9);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const plane = makePlane();
const rel = makeReleasePlane(plane);
const errors = [];
async function context(browser, width = 390) {
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block' });
  await plane.install(ctx, ROOT);
  await rel.install(ctx, ROOT);
  ctx.setDefaultTimeout(8000);
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push({ page: p.url(), message: String(e && e.message), stack: String(e && e.stack || '') })));
  open.push(ctx);
  return ctx;
}
/* one scenario: a failure in it is a failed check, its browsers are closed, and the next scenario still runs */
const open = [];
async function scenario(name, fn) {
  try { await fn(); }
  catch (e) { check(false, name + ': finished without an exception: ' + String(e && e.message || e).split('\n')[0]); }
  finally { while (open.length) await open.pop().close().catch(() => {}); }
}
/* a fresh profile on an origin: the privacy notice agreed to (consent) or answered "Not now", then a session */
async function seed(page, who, { consent, origin = HOUSE } = {}) {
  const items = {};
  if (who) { const v = JSON.stringify(plane.storedSession(who)); items.mccdb_session = v; items.mcc_sess_keep = v; }
  await page.goto(origin + '/__blank');
  await page.evaluate(({ it, consent }) => {
    localStorage.clear(); sessionStorage.clear();
    if (consent) localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    localStorage.setItem('mcc_privacy_seen', JSON.stringify({ version: '2026-10-19', seen_at: new Date().toISOString() }));
    for (const k of Object.keys(it)) localStorage.setItem(k, it[k]);
  }, { it: items, consent: !!consent });
}
async function openStudio(page) {
  await page.goto(HOUSE + '/creator.html', { waitUntil: 'domcontentloaded' });
  return until(page, () => { const a = document.getElementById('creatorApp'); return a && !a.hidden && !!document.querySelector('#creatorTracks'); }, null, 15000);
}
const row = (page, title) => page.locator('[data-release-row]', { hasText: title });
async function rowState(page, title) {
  return page.evaluate((title) => {
    const r = [...document.querySelectorAll('[data-release-row]')].find((x) => x.querySelector('b') && x.querySelector('b').textContent === title);
    if (!r) return null;
    const vis = (e) => !!e && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0;
    return { pill: (r.querySelector('.creator-pill') || {}).textContent || '', actions: [...r.querySelectorAll('[data-release-action]')].filter(vis).map((b) => b.textContent.trim()) };
  }, title);
}
async function submitRelease(page, { title, file, bytes, genre }) {
  rel.expectFile(file, bytes);
  await page.fill('#trackTitle', title);
  if (genre) await page.fill('#trackGenre', genre);
  await page.selectOption('#trackAccess', 'public');
  await page.setInputFiles('#trackMaster', { name: file, mimeType: 'audio/wav', buffer: bytes });
  for (const box of ['#ownsMaster', '#controlsComposition', '#samplesCleared', '#collaboratorsCleared', '#releaseTerms']) await page.check(box);
  /* the line under the form still says how the last submission went: this one is read from a clean line */
  await page.evaluate(() => { document.getElementById('trackStatus').textContent = ''; });
  await page.click('#submitTrack');
  const ok = await until(page, () => /Submitted for rights and publication review/.test(document.getElementById('trackStatus').textContent), null, 20000);
  if (!ok) console.log('  (studio said: ' + JSON.stringify(await page.evaluate(() => document.getElementById('trackStatus').textContent)) + ')');
  return ok && await until(page, (title) => [...document.querySelectorAll('#creatorTracks .creator-item b')].some((b) => b.textContent === title), title, 8000);
}
const eventNames = (from) => rel.events.slice(from).map((e) => e.name);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
await mkdir(OUT, { recursive: true });
if (SHOTS) await mkdir(SHOTS, { recursive: true });
const TITLE = 'Fixture Release', EDITED = 'Fixture Release (edited)';
let releaseId = null;

try {
  /* ---------- submit: a creator who agreed to the privacy notice ---------- */
  await scenario('submit', async () => {
    const ctx = await context(browser);
    const page = await ctx.newPage();
    await seed(page, 'creator', { consent: true });
    check(await openStudio(page), 'submit: Creator Studio opens for the creator');
    const measured = await page.evaluate(() => ({ script: document.querySelectorAll('script[src*="js/analytics.js"]').length, track: typeof window.MCC_TRACK }));
    check(measured.script === 1 && measured.track === 'function', `submit: creator.html loads js/analytics.js once and MCC_TRACK is there (${measured.script}, ${measured.track})`);
    const from = rel.events.length;
    check(await submitRelease(page, { title: TITLE, file: 'fixture-master.wav', bytes: MASTER_1, genre: 'Soul' }), 'submit: the release is uploaded and submitted for review');
    const t = rel.byTitle(TITLE);
    releaseId = t && t.id;
    check(!!t && t.status === 'pending_review' && t.rights_status === 'attested', `submit: the database holds it pending review, attested (${t && t.status}, ${t && t.rights_status})`);
    check(!!t && rel.objects.has('creator-masters/' + t.master_path) && rel.sha(rel.objects.get('creator-masters/' + t.master_path)) === sha256(MASTER_1), 'submit: the master in Storage is the file the creator chose, byte for byte');
    await until(page, (title) => [...document.querySelectorAll('[data-release-row] b')].some((b) => b.textContent === title), TITLE, 8000);
    const st = await rowState(page, TITLE);
    check(!!st && /pending review/.test(st.pill) && st.actions.join('|') === 'Edit|Withdraw', `submit: Your releases offers Edit and Withdraw on the pending release (${st && st.actions.join('|')})`);
    check(await wait(() => eventNames(from).includes('creator_track_submitted'), 9000), 'submit: creator_track_submitted reached the collector (consent given)');
    await fits(page, 'submit: Creator Studio with a pending release');

    /* edit the words of the pending release: only the version on screen */
    const ev = rel.events.length;
    if (!(await row(page, TITLE).locator('[data-release-action="edit"]').count())) { check(false, 'edit: the pending release has an Edit control'); return; }
    await row(page, TITLE).locator('[data-release-action="edit"]').click();
    const form = row(page, TITLE).locator('[data-release-form]');
    check(await form.isVisible(), 'edit: the edit form opens under the release');
    const span = await page.evaluate((title) => {
      const r = [...document.querySelectorAll('[data-release-row]')].find((x) => x.querySelector('b') && x.querySelector('b').textContent === title);
      const box = r && r.querySelector('[data-release-edit]'), acts = r && r.querySelector('.creator-release__actions');
      if (!box || !acts) return { form: 0, formLeft: -1, left: -1 };
      const R = r.getBoundingClientRect(), F = box.getBoundingClientRect();
      return { form: F.width / R.width, formLeft: Math.round(F.left - R.left), left: Math.round(acts.getBoundingClientRect().left - R.left) };
    }, TITLE);
    check(span.form > 0.95 && span.formLeft === 0 && span.left === 0, `edit: the controls sit under the title and the form takes the release's whole row (${Math.round(span.form * 100)}% from ${span.formLeft} px; controls at ${span.left} px)`);
    await fits(page, 'edit: Creator Studio with the edit form open');
    const sizes = await page.evaluate(() => [...document.querySelectorAll('[data-release-form] input, [data-release-form] textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((f) => f < 16).length);
    check(sizes === 0, 'edit: its fields are at least 16 px (no zoom on a phone)');
    await shot(page, 'm6-creator-studio-edit-390');
    await form.locator('input[name="title"]').fill(EDITED);
    await form.locator('[type="submit"]').click();
    check(await until(page, () => /Saved\. The reviewer sees this version/.test(document.getElementById('releaseStatus').textContent), null, 10000), 'edit: saved, and the studio says the reviewer sees this version');
    const after = rel.tracks.get(releaseId);
    check(after && after.title === EDITED && after.status === 'pending_review' && after.rights_status === 'attested', 'edit: the release has its new title and is still pending review, attested');
    const editWrite = rel.writes.filter((w) => w.method === 'PATCH' && w.query.includes('updated_at=eq.')).pop();
    check(!!editWrite && editWrite.rows === 1 && /status=eq\.pending_review/.test(editWrite.query) && Object.keys(editWrite.body).every((k) => ['title', 'artist', 'genre', 'description', 'music_video_url', 'lyrics_url'].includes(k)), 'edit: the change names the version and state on screen and carries only words and links');
    check(await wait(() => eventNames(ev).includes('creator_release_edited'), 9000), 'edit: creator_release_edited reached the collector');

    /* an edit made on an older screen changes nothing (the reviewer acted meanwhile) */
    await row(page, EDITED).locator('[data-release-action="edit"]').click();
    const stale = rel.tracks.get(releaseId);
    rel.tracks.set(releaseId, { ...stale, updated_at: stale.updated_at.replace(/\.\d+/, '.999999') });
    await row(page, EDITED).locator('[data-release-form] input[name="title"]').fill('Fixture Release (stale screen)');
    await row(page, EDITED).locator('[data-release-form] [type="submit"]').click();
    check(await until(page, () => /changed since your list loaded/.test(document.getElementById('releaseStatus').textContent), null, 10000), 'edit: an edit on an older version is refused and the studio says so');
    check(rel.tracks.get(releaseId).title === EDITED, 'edit: the older screen changed nothing');
  });

  /* ---------- review: the house owner in Control · Create · Music · Review ---------- */
  await scenario('review', async () => {
    const ctx = await context(browser);
    const page = await ctx.newPage();
    await seed(page, 'owner', { consent: true });
    await page.goto(HOUSE + '/control.html#create:music', { waitUntil: 'domcontentloaded' });
    const listed = await until(page, (id) => !!document.querySelector('[data-crom-review="publish"][data-id="' + id + '"]'), releaseId, 30000);
    check(listed, 'review: the release waits in Control · Create · Music · Review');
    const pub = page.locator(`[data-crom-review="publish"][data-id="${releaseId}"]`);
    check(listed && await pub.isDisabled(), 'review: Publish is shut until the audio is verified and heard');
    await fits(page, 'review: the review desk');
    const t = rel.tracks.get(releaseId);
    const canVerify = listed && await page.locator(`[data-crom-prepare="${releaseId}"]`).count() === 1;
    check(canVerify, 'review: each release waiting for review has Verify + listen');
    if (canVerify) {
    await page.locator(`[data-crom-prepare="${releaseId}"]`).click();
    const heard = await until(page, (id) => { const b = document.querySelector('[data-crom-review="publish"][data-id="' + id + '"]'); return b && !b.disabled && !!b.getAttribute('data-sha'); }, releaseId, 15000);
    check(heard, 'review: Verify + listen opens Publish');
    const shown = await page.evaluate((id) => {
      const b = document.querySelector('[data-crom-review="publish"][data-id="' + id + '"]');
      const item = b && (b.closest('.cro-item') || b.closest('[class*="cro"]').parentElement);
      const audio = document.querySelector('audio[src*="creator-masters"]');
      const code = document.querySelector('code[title]');
      return { version: b && b.getAttribute('data-version'), sha: b && b.getAttribute('data-sha'), audio: audio ? audio.getAttribute('src') : '', code: code ? code.textContent : '', item: !!item };
    }, releaseId);
    check(shown.sha === sha256(MASTER_1), 'review: the hash Publish will carry is the SHA-256 of the master the creator uploaded');
    check(shown.version === t.updated_at, 'review: Publish carries the version the desk loaded');
    check(/\/storage\/v1\/object\/sign\/creator-masters\//.test(shown.audio) && shown.code === sha256(MASTER_1).slice(0, 12) + '…' + sha256(MASTER_1).slice(-4), 'review: the owner plays the pinned master and sees its short hash');
    await fits(page, 'review: the desk after Verify + listen');
    await shot(page, 'm6-control-review-verified-390');
    }
    /* the owner's Publish, as the probe pressed it */
    if (listed && await pub.isEnabled()) await pub.click();
    const done = await wait(() => rel.calls.some((c) => c.action === 'operator-review'), 10000);
    await sleep(600);
    const call = rel.calls.filter((c) => c.action === 'operator-review').pop();
    check(done && call.status === 200 && call.body.decision === 'publish' && call.body.expected_updated_at === t.updated_at && call.body.expected_master_sha256 === sha256(MASTER_1), `review: Publish reaches music_operator_review with the version and the hash (probe p2-edge/run.ts)${call && call.status !== 200 ? ': the music service answered ' + call.status + ', ' + (call.answer && call.answer.error) : ''}`);
    check(rel.tracks.get(releaseId).status === 'published' && rel.tracks.get(releaseId).rights_status === 'cleared', `review: the release is published and cleared (${rel.tracks.get(releaseId).status})`);
    const refusals = rel.dialogs.filter((d) => /expected_updated_at required|expected_master_sha256 required|Review failed/.test(d.message));
    check(refusals.length === 0, `review: no "expected_updated_at required" alert (probe p2-edge/control-room-click.mjs)${refusals.length ? ': the owner saw "' + refusals[0].message + '"' : ''}`);
    check(!rel.calls.some((c) => c.action === 'operator-review' && c.status === 400), 'review: the music service refused nothing');
    /* the vault is not set up: it says so, and offers nothing that could not be saved */
    await page.locator('[data-crom-section="catalog"]').click();
    check(await until(page, () => /The vault is not set up yet/.test(document.body.innerText), null, 8000), 'vault: Catalog says the vault is not set up yet');
    check(await page.locator('[data-crom-savehouse],[data-crom-asset-status],[data-crom-savecred],[data-crom-toggle]').count() === 0, 'vault: no vault controls that could save nothing');
    check(!/Some music sources failed/.test(await page.evaluate(() => document.body.innerText)), 'vault: no vague failure line');
    await fits(page, 'vault: Catalog');
    await page.locator('[data-crom-section="distribution"]').click();
    check(await until(page, () => /The vault is not set up yet/.test(document.body.innerText), null, 8000), 'vault: Distribution says the same');
    await page.locator('[data-crom-section="review"]').click();
    check(await until(page, () => !/vault is not set up/.test((document.querySelector('.cro') || document.body).innerText), null, 8000), 'vault: release review does not carry the vault note');
  });

  /* ---------- artist: the release on its artist page, for a guest ---------- */
  await scenario('artist', async () => {
    const ctx = await context(browser);
    const page = await ctx.newPage();
    await seed(page, null, { consent: false });
    await page.goto(HOUSE + '/music-creator.html?handle=' + PEOPLE.creator.handle, { waitUntil: 'domcontentloaded' });
    const shown = await until(page, (title) => [...document.querySelectorAll('.ap-track b')].some((b) => b.textContent === title), EDITED, 15000);
    check(shown, 'artist: the published release is on its artist page');
    await fits(page, 'artist: the artist page');
    await shot(page, 'm6-artist-page-390');
    if (shown) {
      await page.locator('.ap-track', { hasText: EDITED }).locator('[data-music-play]').click();
      const t = rel.tracks.get(releaseId);
      const src = rel.publicUrl('creator-previews', t.preview_path);
      check(await until(page, (src) => !!(window.MCC_MUSIC && window.MCC_MUSIC.audio && window.MCC_MUSIC.audio.currentSrc === src), src, 10000), 'artist: it plays for a guest, from its public listener audio');
    }
  });

  /* ---------- the creator again: nothing is offered on a live release ---------- */
  await scenario('live', async () => {
    const ctx = await context(browser);
    const page = await ctx.newPage();
    await seed(page, 'creator', { consent: true });
    await openStudio(page);
    await until(page, (title) => [...document.querySelectorAll('[data-release-row] b')].some((b) => b.textContent === title), EDITED, 8000);
    const st = await rowState(page, EDITED);
    check(!!st && /published/.test(st.pill) && st.actions.length === 0, `live: the published release shows as published, with nothing offered (${st && st.pill}; ${st && st.actions.join('|')})`);
  });

  /* ---------- consent: "Not now" means nothing is sent; withdraw, submit again, delete ---------- */
  await scenario('consent', async () => {
    await sleep(1500);
    const sent = rel.collects.length, evs = rel.events.length;
    const ctx = await context(browser);
    const page = await ctx.newPage();
    await seed(page, 'creator', { consent: false });
    check(await openStudio(page), 'consent: Creator Studio opens for the creator who said "Not now"');
    const off = await page.evaluate(() => ({ script: document.querySelectorAll('script[src*="js/analytics.js"]').length, ret: typeof window.MCC_TRACK === 'function' ? window.MCC_TRACK('creator_probe', {}) : 'missing' }));
    check(off.script === 1 && off.ret === false, `consent: analytics.js is on the page and MCC_TRACK records nothing (${off.script}, ${off.ret})`);
    check(await submitRelease(page, { title: 'Second Fixture', file: 'second-master.wav', bytes: MASTER_2 }), 'consent: a second release is submitted');
    const second = rel.byTitle('Second Fixture');
    await until(page, () => [...document.querySelectorAll('[data-release-row] b')].some((b) => b.textContent === 'Second Fixture'), null, 8000);
    const canWithdraw = await row(page, 'Second Fixture').locator('[data-release-action="withdraw"]').count() === 1;
    check(canWithdraw, 'withdraw: a pending release can be withdrawn from Your releases');
    if (canWithdraw) {
    await row(page, 'Second Fixture').locator('[data-release-action="withdraw"]').click();
    check(await until(page, () => /Withdrawn\./.test(document.getElementById('releaseStatus').textContent), null, 10000), 'withdraw: the studio says it is withdrawn');
    let st = await rowState(page, 'Second Fixture');
    check(rel.tracks.get(second.id).status === 'draft' && !!st && st.actions.join('|') === 'Submit again|Delete', `withdraw: back in drafts, out of review, with Submit again and Delete (${st && st.actions.join('|')})`);
    await row(page, 'Second Fixture').locator('[data-release-action="resubmit"]').click();
    check(await until(page, () => /Submitted again\./.test(document.getElementById('releaseStatus').textContent), null, 10000) && rel.tracks.get(second.id).status === 'pending_review', 'resubmit: a withdrawn release goes back to the review queue');
    await row(page, 'Second Fixture').locator('[data-release-action="withdraw"]').click();
    await until(page, () => /Withdrawn\./.test(document.getElementById('releaseStatus').textContent), null, 10000);
    const master = 'creator-masters/' + second.master_path;
    await row(page, 'Second Fixture').locator('[data-release-action="delete"]').click();
    check(await until(page, () => /^Deleted /.test(document.getElementById('releaseStatus').textContent), null, 10000), 'delete: the studio says it is deleted');
    check(!rel.tracks.has(second.id) && !rel.objects.has(master), 'delete: the record and its files are gone');
    check(await page.locator('[data-release-row]', { hasText: 'Second Fixture' }).count() === 0, 'delete: it is no longer in Your releases');

    /* the reviewer verified this one: withdrawn, never deleted */
    check(await submitRelease(page, { title: 'Third Fixture', file: 'third-master.wav', bytes: MASTER_3 }), 'verified: a third release is submitted');
    const third = rel.byTitle('Third Fixture');
    rel.pinned.set(third.id, { version_id: 'fixture-version', sha256: sha256(MASTER_3), size_bytes: MASTER_3.length });
    await until(page, () => [...document.querySelectorAll('[data-release-row] b')].some((b) => b.textContent === 'Third Fixture'), null, 8000);
    await row(page, 'Third Fixture').locator('[data-release-action="withdraw"]').click();
    await until(page, () => /Withdrawn\./.test(document.getElementById('releaseStatus').textContent), null, 10000);
    await row(page, 'Third Fixture').locator('[data-release-action="delete"]').click();
    check(await until(page, () => /stays withdrawn: the reviewer has already verified its audio/.test(document.getElementById('releaseStatus').textContent), null, 10000), 'verified: delete is refused by the database and the studio says why');
    check(rel.tracks.has(third.id) && rel.objects.has('creator-masters/' + third.master_path), 'verified: its record and its master stay');
    await fits(page, 'consent: Creator Studio after withdraw and delete');
    }

    await sleep(4000); // past the collector's linger (2.5 s)
    const outbox = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('mcc_event_outbox_v1:') === 0).length);
    await ctx.close();
    await sleep(500);
    const leaked = rel.events.slice(evs).map((e) => e.name);
    check(rel.collects.length === sent && leaked.length === 0, `consent: nothing reached the collector without consent (${leaked.join(',') || 'none'})`);
    check(outbox === 0, 'consent: nothing waits in the outbox either');
  });

  /* ---------- door: Creator Studio in the Profile menu, where creators look ---------- */
  await scenario('door', async () => {
    const door = async (who, origin, path) => {
      const ctx = await context(browser);
      const page = await ctx.newPage();
      await seed(page, who, { consent: true, origin });
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      const chip = await until(page, () => { const c = document.getElementById('mccAuthChip'); return !!c && !c.hidden && c.getBoundingClientRect().width > 0; }, null, 15000);
      if (!chip) { await ctx.close(); return { chip: false, link: false }; }
      if (who === 'owner') await until(page, () => document.body.hasAttribute('data-appbar-admin'), null, 10000);
      await page.click('#mccAuthChip');
      await until(page, () => !!document.querySelector('#mccProfileMenu:popover-open'), null, 5000);
      const shows = await until(page, () => { const a = document.querySelector('#mccProfileMenu [data-creator-studio]'); return !!a && !a.hidden && a.getBoundingClientRect().width > 0; }, null, 6000);
      const href = await page.evaluate(() => { const a = document.querySelector('#mccProfileMenu [data-creator-studio]'); return a ? a.href : ''; });
      if (shows && who === 'creator' && path === '/listen.html') { await fits(page, 'door: Listen with the Profile menu open'); await shot(page, 'm6-profile-menu-creator-studio-390'); }
      await ctx.close();
      return { chip: true, link: shows, href };
    };
    const c = await door('creator', HOUSE, '/listen.html');
    check(c.chip && c.link && c.href === HOUSE + '/creator.html', `door: a creator finds Creator Studio in the Profile menu on Listen (${c.href || 'none'})`);
    const o = await door('owner', HOUSE, '/listen.html');
    check(o.chip && o.link, 'door: the house owner finds it too');
    const m = await door('member', HOUSE, '/listen.html');
    check(m.chip && !m.link, 'door: a member who is not a creator does not');
    const h = await door('creator', HOUSE, '/index.html');
    check(h.chip && !h.link, 'door: not on a page that is not a music page (the home page)');
    const w = await door('creator', WORLD, '/listen.html');
    check(!w.link, `door: never on a World host, even on a copy of a music page there (profile chip there: ${w.chip ? 'yes' : 'no'})`);
  });
} catch (e) {
  check(false, 'the run finished without an exception: ' + (e && e.stack || e));
} finally {
  await browser.close();
}

const mine = errors.filter((e) => /music-ops|music-creator-studio|music-creator-page|site-navigation|creator-onboarding/.test(e.stack));
check(mine.length === 0, `no page error from this slice's files (${mine.map((e) => e.message).join(' | ') || 'none'})`);
await writeFile(join(OUT, 'result.json'), JSON.stringify({ ok: failures.length === 0, failures, checks, errors, calls: rel.calls.map((c) => ({ action: c.action, who: c.who, status: c.status })), writes: rel.writes.map((w) => ({ method: w.method, who: w.who, query: w.query, status: w.status, rows: w.rows })), dialogs: rel.dialogs, collects: rel.collects, events: rel.events.map((e) => ({ name: e.name, page: e.page })), blocked: plane.blocked }, null, 2));
console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
