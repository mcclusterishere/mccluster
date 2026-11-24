/* Creator Studio → Lyrics: a creator edits their own release's lyrics with the editor Control uses, at 390px first.
   Real creator.html + js/music-creator-studio.js + js/control-room/lyrics-review.js + js/lyrics-sync.js from this
   checkout; Supabase is a fixture (no network). Audio is a silent WAV served for the owner's "stream" URL.
     - every release shows its lyric state (approved / timed: check them / timing pending / none);
     - "Edit lyrics" opens the release in the editor with its own audio (music-access "stream");
     - a draft saves straight onto creator_tracks.lyrics (PATCH under the creator's row rights), reviewed by the creator;
     - a live release asks first (its lyrics changing sends it back to review), and cancelling writes nothing;
     - sheet-only lyrics say they are being timed; no Control-only re-run button is offered;
     - signing out takes the lyrics off the screen.
   [PLAYWRIGHT_DIR=<node_modules>] node scripts/e2e/creator-lyrics.e2e.mjs [outDir] */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out-creator-lyrics');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }
const OB = require(join(ROOT, 'js/creator-onboarding.js'));
const { validateLyrics } = await import(pathToFileURL(join(ROOT, 'core/src/lyrics/align.mjs')).href);
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  const file = path === '/' ? 'index.html' : path;
  try { const body = await readFile(join(ROOT, file)); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SB = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const UID = '00000000-0000-4000-8000-00000000b001';
const MUID = '10000000-0000-4000-8000-00000000b001';
const LIVE = '20000000-0000-4000-8000-00000000b001';
const DRAFT = '20000000-0000-4000-8000-00000000b002';
const SHEET = '20000000-0000-4000-8000-00000000b003';
const NONE = '20000000-0000-4000-8000-00000000b004';

function silentWav(seconds) { const n = Math.ceil(seconds * 8000), b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; }
const WAV = silentWav(60);
function serveWav(route, req) {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers().range || '');
  if (!m) return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' }, body: WAV });
  const a = +m[1], b = m[2] ? Math.min(+m[2], WAV.length - 1) : WAV.length - 1;
  return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${WAV.length}`, 'access-control-allow-origin': '*' }, body: WAV.subarray(a, b + 1) });
}

/* invented songs, invented people */
const line = (begin, end, content) => { const w = content.split(' '), step = (end - begin) / w.length; return { begin, end, content, words: w.map((x, k) => ({ begin: +(begin + step * k).toFixed(3), end: +(begin + step * (k + 1)).toFixed(3), content: x })) }; };
const timed = (source) => ({ schema: 'mccluster-lyrics/1', source, reviewed: false, plain: 'first line here\nsecond line here\nthird line here',
  timed: { line: [line(2, 5, 'first line here'), line(6, 9, 'second lyne here'), line(10, 13, 'third line here')] } });

const results = [];
const check = (scope, name, ok, detail) => { results.push({ scope, name, pass: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (ok ? '' : ' ' + JSON.stringify(detail))); };

async function run(browser, width) {
  const scope = String(width);
  const db = {
    tracks: [
      { id: LIVE, title: 'Fixture Live', artist: 'Fixture Artist', status: 'published', rights_status: 'cleared', lyrics: timed('aligned') },
      { id: DRAFT, title: 'Fixture Draft', artist: 'Fixture Artist', status: 'draft', rights_status: 'attested', lyrics: timed('auto') },
      { id: SHEET, title: 'Fixture Sheet', artist: 'Fixture Artist', status: 'draft', rights_status: 'attested', lyrics: { source: 'sheet', reviewed: false, plain: 'only words' } },
      { id: NONE, title: 'Fixture Bare', artist: 'Fixture Artist', status: 'draft', rights_status: 'incomplete', lyrics: null }
    ],
    patches: [], streams: [], noDist: false
  };
  const creator = { handle: 'fixture-artist', artist_name: 'Fixture Artist', bio: '', website_url: '', avatar_url: '', banner_url: '', status: 'active', verification_state: 'unverified', payout_state: 'not_started', settings: {}, updated_at: 't1' };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([uid]) => {
    try { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); } catch (_) {}
    try { localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'fixture-token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } })); } catch (_) {}
  }, [UID]);
  const rowOf = (t, select) => {
    const out = {};
    for (const part of select.split(',')) {
      const [alias, expr] = part.includes(':') ? part.split(':') : [part, part];
      if (expr === 'lyrics->>source') out[alias] = t.lyrics?.source ?? null;
      else if (expr === 'lyrics->>reviewed') out[alias] = t.lyrics && t.lyrics.reviewed != null ? String(t.lyrics.reviewed) : null;
      else if (expr === 'lyrics->timed->line->0->>begin') out[alias] = t.lyrics?.timed?.line?.[0] ? String(t.lyrics.timed.line[0].begin) : null;
      else out[alias] = t[expr] ?? null;
    }
    return out;
  };
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.startsWith('/auth/')) return json({});
    if (p === '/rest/v1/rpc/m_my_uid') return json(MUID);
    if (p === '/rest/v1/rpc/music_creator_state') { const st = OB.fallbackState({ creator, network: { display_name: 'Fixture Artist' }, platform: { mccluster_id: 'fixture-artist' }, linked: true }); delete st.insert; return json(st); }
    if (p.startsWith('/rest/v1/rpc/')) return json(null);
    if (p === '/rest/v1/music_creator_profiles') return json([creator]);
    if (p === '/rest/v1/network_profiles') return json([{ display_name: 'Fixture Artist' }]);
    if (p === '/rest/v1/platform_profiles') return json([{ mccluster_id: 'fixture-artist' }]);
    if (p === '/rest/v1/identity_presentations') return req.method() === 'GET' ? json([{ music_enabled: true }]) : route.fulfill({ status: 201, body: '' });
    if (p === '/rest/v1/creator_tracks') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const select = url.searchParams.get('select') || '*';
      const noColumn = () => json({ code: '42703', message: 'column creator_tracks.distribution does not exist' }, 400);
      if (req.method() === 'PATCH') {
        const t = db.tracks.find((x) => x.id === id);
        const body = req.postDataJSON();
        if ('distribution' in body && db.noDist) return noColumn();
        db.patches.push({ id, body, mine: url.searchParams.get('m_uid') === 'eq.' + MUID });
        if (!t) return json([]);
        /* the pending SQL leaves distribution out of release content: a live release stays live */
        if ('distribution' in body) { t.distribution = body.distribution; return json([rowOf(t, select)]); }
        t.lyrics = body.lyrics;
        /* music_track_guard (b): a reviewed release whose content changes goes back to review */
        if (t.status === 'published' || t.status === 'approved') { t.status = 'pending_review'; t.rights_status = 'review'; }
        return json([rowOf(t, select)]);
      }
      if (db.noDist && /distribution/.test(select)) return noColumn();
      const rows = id ? db.tracks.filter((x) => x.id === id) : db.tracks;
      return json(rows.map((t) => rowOf(t, select)));
    }
    if (p === '/functions/v1/music-access') {
      const b = req.postDataJSON() || {};
      if (b.action === 'stream') { db.streams.push(b.track_id); return json({ ok: true, url: 'https://fixture-storage.invalid/' + b.track_id + '.wav', expires_in: 3600 }); }
      return json({ ok: true });
    }
    return json([]);
  });
  await ctx.route('https://fixture-storage.invalid/**', (route) => serveWav(route, route.request()));
  await ctx.route(/^https:\/\/api\.mccluster\.org\//, (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, creator: true, next_step: 'feed', identity: { mccluster_id: 'fixture.artist' }, profile: { display_name: 'Fixture Artist' }, tracks: [], counts: {}, page_traffic: { views: 0, sources: {} } }) }));
  await ctx.route(/^https:\/\/(?!zmnhbrjyhxzhkxmhkexs|api\.mccluster|fixture-storage)/, (route) => route.fulfill({ status: 204, body: '' }));

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/creator.html`, { waitUntil: 'load' });
  await page.waitForSelector('#creatorTracks [data-lyrics-open]', { timeout: 15000 }).catch(async (err) => {
    console.log(errors, await page.evaluate(() => ['creatorGate', 'creatorOnboard', 'creatorApp', 'creatorSummary'].map((id) => id + ':' + (document.getElementById(id) || {}).hidden).join(' ') + ' | ' + document.getElementById('creatorTracks').innerHTML.slice(0, 300)));
    throw err;
  });
  const fit = async (label) => {
    if (width !== 390) return;
    const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    check(scope, `${label}: scrollWidth ${m.s} === clientWidth ${m.c}`, m.s === m.c, m);
  };

  /* the list: every release says where its lyrics stand */
  const chips = await page.$$eval('#creatorTracks .creator-item', (rows) => rows.map((r) => ({ title: r.querySelector('b').textContent, lyr: (r.querySelector('.creator-lyr .creator-pill') || {}).textContent || '', edit: !!r.querySelector('[data-lyrics-open]') })));
  const by = (t) => chips.find((c) => c.title === t) || {};
  check(scope, 'timed, unreviewed lyrics say "check them" and can be edited', by('Fixture Live').lyr === 'Lyrics timed: check them' && by('Fixture Live').edit, chips);
  check(scope, 'sheet-only lyrics say timing is pending', by('Fixture Sheet').lyr === 'Lyrics: timing pending', chips);
  check(scope, 'a release without lyrics says so, with nothing to edit', by('Fixture Bare').lyr === 'No lyrics' && !by('Fixture Bare').edit, chips);
  check(scope, 'the Lyrics card shows once there are lyrics', await page.locator('#creatorLyrics').isVisible());
  const hit = await page.$eval('#creatorTracks [data-lyrics-open]', (b) => Math.round(b.getBoundingClientRect().height));
  check(scope, '"Edit lyrics" is a 44px target', hit >= 44, hit);
  await fit('the release list');

  /* a draft: open, fix a word, approve, save */
  await page.click(`[data-lyrics-open="${DRAFT}"]`);
  await page.waitForSelector('#creatorLyrics .crl-line', { timeout: 10000 });
  check(scope, 'the draft opens in the editor with its own audio (music-access stream)', db.streams.includes(DRAFT) && /fixture-storage\.invalid\/.+\.wav$/.test(await page.getAttribute('#creatorLyrics .crl-audio', 'src')), db.streams);
  check(scope, 'the picker lists only releases with lyrics', (await page.$$eval('#creatorLyrics [data-crl-pick] option', (o) => o.map((x) => x.value).filter(Boolean))).sort().join() === ['mine:' + DRAFT, 'mine:' + LIVE, 'mine:' + SHEET].sort().join());
  check(scope, 'no re-run button (that is Control\'s)', (await page.locator('#creatorLyrics [data-crl-queue]').count()) === 0);
  check(scope, 'the creator note is shown', /never overwrites lyrics you approved/.test(await page.textContent('#creatorLyrics .crl-foot')));
  await fit('the editor');
  if (width === 390) { await page.screenshot({ path: join(OUT, `creator-lyrics-${width}-editor.png`) }); await page.locator('#creatorLyrics').screenshot({ path: join(OUT, `creator-lyrics-${width}-card.png`) }); }
  const input = page.locator('#creatorLyrics [data-crl-text="1"]');
  await input.fill('second line here'); await input.press('Tab');
  await page.check('#creatorLyrics [data-crl-reviewed]');
  await page.click('#creatorLyrics [data-crl-save]');
  await page.waitForFunction(() => /Saved and marked reviewed/.test(document.querySelector('#creatorLyrics .crl-msg').textContent), null, { timeout: 10000 });
  const draftPatch = db.patches.find((x) => x.id === DRAFT);
  const saved = draftPatch && draftPatch.body.lyrics;
  check(scope, 'the save is one PATCH of lyrics only, scoped to the creator', !!draftPatch && draftPatch.mine && Object.keys(draftPatch.body).join() === 'lyrics', draftPatch);
  check(scope, 'the fixed word, the reviewed mark and the creator are on the saved lyrics', saved && saved.timed.line[1].content === 'second line here' && saved.reviewed === true && saved.reviewed_by === 'creator' && saved.edited_by_creator === true && !saved.edited_by_owner && /second line here/.test(saved.plain), saved);
  let schema = null; try { validateLyrics(saved); schema = true; } catch (err) { schema = err.message; }
  check(scope, 'the saved lyrics pass the lyrics schema the players read', schema === true, schema);
  await page.waitForFunction(() => /Lyrics approved/.test(document.getElementById('creatorTracks').textContent), null, { timeout: 10000 }).catch(() => {});
  check(scope, 'the release list now says "Lyrics approved"', /Lyrics approved/.test(await page.textContent('#creatorTracks')));

  /* a live release: asked first; cancelling writes nothing, accepting sends it back to review */
  await page.click(`[data-lyrics-open="${LIVE}"]`);
  await page.waitForFunction(() => { const s = document.querySelector('#creatorLyrics [data-crl-pick]'); return s && /b001$/.test(s.value) && document.querySelector('#creatorLyrics .crl-line'); }, null, { timeout: 10000 });
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.click('#creatorLyrics [data-crl-save]');
  await page.waitForTimeout(300);
  check(scope, 'saving a live release asks first, and says it goes back to review', /back to review/.test(asked), asked);
  check(scope, 'cancelling writes nothing', !db.patches.some((x) => x.id === LIVE), db.patches);
  page.once('dialog', (d) => d.accept());
  await page.click('#creatorLyrics [data-crl-save]');
  await page.waitForFunction(() => /back in review/.test(document.querySelector('#creatorLyrics .crl-msg').textContent), null, { timeout: 10000 }).catch(() => {});
  check(scope, 'accepting saves, and the creator is told the release is back in review', db.patches.some((x) => x.id === LIVE) && /back in review/.test(await page.textContent('#creatorLyrics .crl-msg')));
  await page.waitForFunction(() => /pending review/.test(document.getElementById('creatorTracks').textContent), null, { timeout: 10000 }).catch(() => {});
  check(scope, 'the list shows the live release pending review', /Fixture Live[\s\S]*pending review/.test(await page.textContent('#creatorTracks')));

  /* sheet-only: the editor says McCluster is timing it */
  await page.selectOption('#creatorLyrics [data-crl-pick]', 'mine:' + SHEET);
  await page.waitForFunction(() => /McCluster times it/.test(document.querySelector('#creatorLyrics .crl-body').textContent), null, { timeout: 10000 }).catch(() => {});
  check(scope, 'sheet-only lyrics say McCluster is timing them', /McCluster times it/.test(await page.textContent('#creatorLyrics .crl-body')));
  await fit('the sheet-only state');

  /* distribution: the store checklist and details for one release */
  await page.click(`[data-dist-open="${DRAFT}"]`);
  await page.waitForFunction(() => document.querySelectorAll('#distCheck li').length > 5 && !/Loading/.test(document.getElementById('distStatus').textContent), null, { timeout: 10000 });
  const items = async () => page.$$eval('#distCheck li', (li) => Object.fromEntries(li.map((x) => [x.querySelector('b').textContent, x.className.replace(/.*is-/, '')])));
  let it = await items();
  check(scope, 'the checklist shows: review to do, codes left to McCluster, lossless master missing', it['Approved by McCluster'] === 'todo' && it['ISRC'] === 'mccluster' && it['UPC'] === 'mccluster' && it['Release date'] === 'todo', it);
  check(scope, 'the primary artist is prefilled as a credit, and the master owner', (await page.inputValue('#distCredits [data-k="name"]')) === 'Fixture Artist' && (await page.inputValue('#distOwner')) === 'Fixture Artist');
  await fit('the distribution card');
  await page.fill('#distDate', '2027-02-05');
  await page.selectOption('#distExplicit', 'false');
  await page.click('#distAddCredit');
  await page.locator('#distCredits .creator-dist__row').nth(1).locator('[data-k="name"]').fill('Fixture Writer');
  await page.locator('#distCredits .creator-dist__row').nth(1).locator('[data-k="role"]').selectOption('Songwriter');
  await page.click('#distAddSplit'); await page.click('#distAddSplit');
  const split = (n) => page.locator('#distSplits .creator-dist__row').nth(n);
  await split(0).locator('[data-k="name"]').fill('Fixture Artist'); await split(0).locator('[data-k="share_pct"]').fill('60');
  await split(1).locator('[data-k="name"]').fill('Fixture Writer'); await split(1).locator('[data-k="share_pct"]').fill('30');
  it = await items();
  check(scope, 'the checklist follows the form: date and credits done, a 90% split flagged', it['Release date'] === 'ok' && it['Songwriter credits'] === 'ok' && it['Splits'] === 'todo', it);
  const before = db.patches.length;
  await page.click('#distSave');
  await page.waitForTimeout(200);
  check(scope, 'a split that does not add up is not saved, and says why', db.patches.length === before && /add up to 90%/.test(await page.textContent('#distStatus')));
  await split(1).locator('[data-k="share_pct"]').fill('40');
  await fit('the filled distribution card');
  if (width === 390) { await page.screenshot({ path: join(OUT, `creator-distribution-${width}.png`), fullPage: false }); await page.locator('#creatorDist').screenshot({ path: join(OUT, `creator-distribution-${width}-card.png`) }); }
  await page.click('#distSave');
  await page.waitForFunction(() => /^Saved/.test(document.getElementById('distStatus').textContent), null, { timeout: 10000 }).catch(() => {});
  const dp = db.patches.find((x) => x.id === DRAFT && x.body.distribution);
  const dd = dp && dp.body.distribution;
  check(scope, 'the details save as one PATCH of distribution only, scoped to the creator', !!dp && dp.mine && Object.keys(dp.body).join() === 'distribution', dp);
  check(scope, 'the saved details are the normalized shape', dd && dd.v === 1 && dd.release_date === '2027-02-05' && dd.explicit === false && dd.credits.length === 2 && dd.splits.map((x) => x.share_pct).join() === '60,40' && dd.isrc === '' , dd);
  await page.click(`[data-dist-open="${LIVE}"]`);
  await page.waitForFunction(() => /Fixture Live/.test(document.getElementById('distTitle').textContent) && !/Loading/.test(document.getElementById('distStatus').textContent), null, { timeout: 10000 });
  await page.fill('#distDate', '2027-03-01'); await page.selectOption('#distExplicit', 'true');
  await page.click('#distSave');
  await page.waitForFunction(() => /^Saved/.test(document.getElementById('distStatus').textContent), null, { timeout: 10000 }).catch(() => {});
  check(scope, 'saving details on a live release does not ask, and leaves it live', db.tracks.find((x) => x.id === LIVE).distribution?.explicit === true && db.tracks.find((x) => x.id === LIVE).status === 'pending_review' /* from the lyrics save above */);
  db.noDist = true;
  await page.click(`[data-dist-open="${SHEET}"]`);
  await page.waitForFunction(() => /switches them on/.test(document.getElementById('distStatus').textContent), null, { timeout: 10000 }).catch(() => {});
  check(scope, 'before the SQL is applied the card says so and cannot save', /switches them on/.test(await page.textContent('#distStatus')) && await page.isDisabled('#distSave'));
  db.noDist = false;

  /* sign out: the lyrics leave the screen */
  await page.evaluate(() => { localStorage.removeItem('mccdb_session'); window.dispatchEvent(new StorageEvent('storage', { key: 'mccdb_session', newValue: null })); });
  await page.waitForFunction(() => document.getElementById('creatorLyrics').hidden, null, { timeout: 10000 }).catch(() => {});
  check(scope, 'signing out hides the lyrics and the distribution details', await page.evaluate(() => document.getElementById('creatorLyrics').hidden && document.getElementById('creatorDist').hidden && !document.getElementById('distCredits').children.length));
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try { for (const w of [390, 1280]) await run(browser, w); }
finally { await browser.close(); server.close(); }
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
