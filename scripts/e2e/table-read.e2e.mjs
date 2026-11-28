/* TABLE READ, end to end in real browsers (Chromium, fake cameras and microphones).

   Three separate browsers on the Prime-local relay (tools/table-read/relay.mjs, the
   Worker's own room code): a host, and two phones at 390 x 844, each phone with
   its own fake camera picture and its own test tone so the two recordings are
   provably different people. It checks, with real WebRTC between the phones:
     - the host starts a private room and gets one link per role;
     - both phones join from their link, see each other's live face, and stay on the
       same cue as the host advances; "Your line" shows on the right phone;
     - the optional scroll moves the cue, a held beat stops it, a pause stops it;
     - nobody is recorded before they allow it; REC shows while a take rolls;
     - each phone records its own full-frame camera while its self-view is a small
       tile, and hiding the self-view keeps the camera and the recording running;
     - the sync cue lands in both takes; markers land in the session;
     - phone A exports its take (media + manifest); phone B sends its take to the
       host peer to peer, with progress, and the host verifies the checksum;
     - a take cut off by closing the page is recovered from the phone's storage;
     - no horizontal scroll at 390 px (scrollWidth === clientWidth).
   Writes the takes to <outDir> for tools/table-read/prime/ to align and import.
   Run:  node scripts/e2e/table-read.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR, default /opt/node-tools/node_modules) and ffmpeg. */
import { createRequire } from 'node:module';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay } from '../../tools/table-read/relay.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'table-read');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await rm(join(OUT, 'takes'), { recursive: true, force: true });
await mkdir(join(OUT, 'fake'), { recursive: true });
await mkdir(join(OUT, 'takes'), { recursive: true });
function fakeMedia(name, pattern, hz) {
  const v = join(OUT, 'fake', `${name}.mjpeg`); const a = join(OUT, 'fake', `${name}.wav`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `${pattern}=size=1280x720:rate=30`, '-t', '4', '-q:v', '6', '-f', 'mjpeg', v]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000`, '-t', '30', a]);
  return [`--use-file-for-fake-video-capture=${v}`, `--use-file-for-fake-audio-capture=${a}`];
}
const base = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

const relay = await startRelay({ port: 0, log: () => {} });
const API = relay.url;
const hostB = await chromium.launch({ args: base });
const daveB = await chromium.launch({ args: [...base, ...fakeMedia('dave', 'testsrc2', 440)] });
const mattB = await chromium.launch({ args: [...base, ...fakeMedia('matthew', 'smptehdbars', 660)] });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, permissions: ['camera', 'microphone'], acceptDownloads: true };
const hostCtx = await hostB.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const daveCtx = await daveB.newContext(phone);
const mattCtx = await mattB.newContext(phone);
const errors = [];
const watch = (p, who) => { p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`)); p.on('dialog', (d) => d.accept()); return p; };

const host = watch(await hostCtx.newPage(), 'host');
const line = (p) => p.locator('#trLine').textContent();
const idx = (p) => p.evaluate(() => window.__tableRead.state?.cue.index);
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);

try {
  await host.goto(`${API}/table-read.html?api=${encodeURIComponent(API)}`);
  await host.locator('#trStart button[type=submit]').click();
  await host.locator('#trInvites input').first().waitFor();
  const links = await host.locator('#trInvites li').evaluateAll((lis) => lis.map((li) => ({ role: li.querySelector('.tr-role').textContent, url: li.querySelector('input').value })));
  check('host starts a private room with one link per role', links.length === 2 && links.map((l) => l.role).join() === 'DAVE,MATTHEW', links.map((l) => l.role).join());
  check('the actor links carry the pass in the fragment, not the query', links.every((l) => new URL(l.url).hash.includes('pass=') && !new URL(l.url).search.includes('pass')));

  const join1 = async (ctx, link, name, who) => {
    const p = watch(await ctx.newPage(), who);
    await p.goto(link.url);
    await p.locator('#trJoinForm').waitFor();
    const role = await p.locator('#trJoinRole').textContent();
    await p.locator('#trName').fill(name);
    await p.locator('#trJoinForm button').click();
    await p.waitForFunction(() => window.__tableRead.state?.seats.filter((s) => s.connected).length >= 2, null, { timeout: 15000 })
      .catch(async (e) => { throw new Error(`${who} did not join: status "${await p.locator('#trStatus').textContent()}", notice "${await p.locator('#trNotice').textContent()}", errors ${errors.join(' | ')}`); });
    return { p, role };
  };
  const dave = await join1(daveCtx, links[0], 'Dave stand-in', 'dave');
  const matt = await join1(mattCtx, links[1], 'Matthew stand-in', 'matthew');
  check('each phone opens its own role from its link', dave.role === 'DAVE' && matt.role === 'MATTHEW', `${dave.role} / ${matt.role}`);
  await host.waitForFunction(() => window.__tableRead.state?.seats.filter((s) => s.connected).length === 3);

  const partnerLive = (p) => p.waitForFunction(() => [...document.querySelectorAll('#trTiles .tr-tile:not(.tr-self) video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20000 }).then(() => true, () => false);
  check('phone A sees phone B live (WebRTC, peer to peer)', await partnerLive(dave.p));
  check('phone B sees phone A live', await partnerLive(matt.p));
  check('host sees both phones live', await host.waitForFunction(() => [...document.querySelectorAll('#trTiles .tr-tile:not(.tr-self) video')].filter((v) => v.readyState >= 2).length >= 2, null, { timeout: 20000 }).then(() => true, () => false));

  for (const [who, p] of [['A', dave.p], ['B', matt.p]]) check(`phone ${who}: no horizontal scroll at 390 px`, await noScroll(p));
  await dave.p.screenshot({ path: join(OUT, 'phone-a-joined.png'), fullPage: false });

  // same cue everywhere
  await host.locator('#trNextBtn').click(); await host.locator('#trNextBtn').click(); await host.locator('#trNextBtn').click();
  await sleep(400);
  const [h3, a3, b3] = await Promise.all([line(host), line(dave.p), line(matt.p)]);
  check('host and both phones show the same active line', h3 === a3 && a3 === b3 && /thinking about you/.test(h3), JSON.stringify(a3));
  check('"Your line" shows on the speaking phone only (MATTHEW speaks line 4)', await matt.p.locator('#trYours').isVisible() && !(await dave.p.locator('#trYours').isVisible()));
  const nextVisible = await dave.p.locator('#trNext li').count();
  check('next lines are visible under the active line', nextVisible >= 2, `${nextVisible} next lines`);
  await host.locator('#trBack').click(); await sleep(300);
  check('rewind moves every phone back', (await idx(dave.p)) === 2 && (await idx(matt.p)) === 2);

  // optional scroll, a held beat, a real pause
  await host.locator('#trRate').selectOption('190');
  await host.locator('#trPause').click(); // resume
  await dave.p.waitForFunction(() => window.__tableRead.state.cue.index > 2, null, { timeout: 8000 });
  check('the optional scroll advances the cue', true);
  await dave.p.locator('#trHold').click();
  const held = await idx(matt.p); await sleep(3500);
  check('a held beat stops the scroll on every phone', (await idx(matt.p)) === held && (await idx(dave.p)) === held, `index stayed ${held}`);
  check('the host sees who is holding', /Dave stand-in/.test(await host.locator('#trHolds').textContent()));
  await dave.p.locator('#trHold').click();
  check('releasing the beat lets the scroll go on', await matt.p.waitForFunction((h) => window.__tableRead.state.cue.index > h, held, { timeout: 8000 }).then(() => true, () => false));
  await host.locator('#trPause').click(); // pause
  await sleep(300); const paused = await idx(dave.p); await sleep(3500);
  check('pause holds the cue', (await idx(dave.p)) === paused && (await idx(matt.p)) === paused, `paused at ${paused}`);
  await host.locator('#trRate').selectOption('');
  await host.evaluate(() => window.__tableRead.ws.send(JSON.stringify({ type: 'goto', index: 1 })));
  await sleep(300);

  // consent before any recording
  await host.locator('#trTake').click(); await sleep(500);
  check('a take cannot roll before the actors allow it', !(await dave.p.locator('#trRec').isVisible()) && /consent/i.test(await host.locator('#trNotice').textContent()));
  await host.locator('#trAsk').click();
  await dave.p.locator('#trConsent[open]').waitFor(); await matt.p.locator('#trConsent[open]').waitFor();
  check('each phone is asked for recording consent', true);
  await dave.p.locator('#trConsentYes').click(); await matt.p.locator('#trConsentYes').click();
  await host.waitForFunction(() => window.__tableRead.state.seats.filter((s) => s.consent === 'granted').length === 2);

  await host.locator('#trTake').click();
  await dave.p.locator('#trRec').waitFor(); await matt.p.locator('#trRec').waitFor();
  check('REC shows on both phones while the take rolls', true);
  const frame = await dave.p.evaluate(() => {
    const t = window.__tableRead.stream.getVideoTracks()[0].getSettings();
    return { w: t.width, h: t.height, tile: document.querySelector('#trSelf').getBoundingClientRect().width };
  });
  check('the take is full-frame while the self-view is a small tile', frame.w >= 1280 && frame.tile <= 80, `${frame.w}x${frame.h} recorded, tile ${Math.round(frame.tile)} px`);
  await dave.p.locator('#trHideSelf').click();
  const hidden = await dave.p.evaluate(() => ({ hidden: document.querySelector('#trSelf').hidden, track: window.__tableRead.stream.getVideoTracks()[0].readyState, rec: window.__tableRead.recorder?.state }));
  check('hiding self-view keeps the camera and the recording on', hidden.hidden && hidden.track === 'live' && hidden.rec === 'recording', JSON.stringify(hidden));
  await host.locator('#trSync').click(); await sleep(2200);
  await host.locator('#trNextBtn').click(); await sleep(900);
  await host.locator('#trMark').click(); await sleep(700);
  await host.locator('#trNextBtn').click(); await sleep(1500);
  await host.locator('#trSync').click(); await sleep(2200);
  await host.locator('#trTake').click();
  await dave.p.waitForFunction(() => !window.__tableRead.recorder); await matt.p.waitForFunction(() => !window.__tableRead.recorder);
  await sleep(500);

  const takeOf = (p) => p.evaluate(async () => (await window.__tableRead.store.list()).find((t) => t.state === 'complete'));
  const ta = await takeOf(dave.p); const tb = await takeOf(matt.p);
  check('two independent recordings, one per phone', ta && tb && ta.seat_id !== tb.seat_id && ta.bytes > 50_000 && tb.bytes > 50_000, `${ta?.bytes} B / ${tb?.bytes} B`);
  check('both takes caught both sync cues with device timestamps', ta?.sync.length === 2 && tb?.sync.length === 2 && ta.sync.every((s) => Number.isFinite(s.in_take_ms)), JSON.stringify(ta?.sync.map((s) => Math.round(s.in_take_ms))));
  check('each take carries its clock offset and the line timeline', ta?.clock?.samples > 3 && ta.lines.length >= 3, `rtt ${ta?.clock?.best_rtt_ms?.toFixed(1)} ms, ${ta?.lines.length} cue changes`);
  check('the cue marker is in the take', ta?.markers?.length === 1);

  // phone A exports; phone B sends to the host
  await dave.p.locator('#trHideSelf').click();
  const dl = [];
  dave.p.on('download', (d) => dl.push(d));
  await dave.p.locator('#trTakes li', { hasText: ta.take_id }).locator('[data-act=export]').click();
  await dave.p.waitForFunction(() => true); await sleep(1500);
  for (const d of dl) await d.saveAs(join(OUT, 'takes', d.suggestedFilename()));
  check('phone A exports its take as media plus manifest', dl.length === 2 && dl.some((d) => /\.webm$/.test(d.suggestedFilename())) && dl.some((d) => /\.take\.json$/.test(d.suggestedFilename())), dl.map((d) => d.suggestedFilename()).join(', '));

  await matt.p.locator('#trTakes li', { hasText: tb.take_id }).locator('[data-act=send]').click();
  const sawProgress = await host.waitForFunction(() => /Receiving from/.test(document.querySelector('#trRecv').textContent), null, { timeout: 10000 }).then(() => true, () => false);
  await host.waitForFunction(() => /checksum verified/.test(document.querySelector('#trNotice').textContent), null, { timeout: 20000 });
  check('phone B sends its take to the host with progress; checksum verified', sawProgress && (await matt.p.locator('#trTakes progress').first().evaluate((e) => e.value)) === 100);
  const hdl = []; host.on('download', (d) => hdl.push(d));
  await host.locator('#trTakes li', { hasText: 'MATTHEW' }).locator('[data-act=export]').click(); await sleep(1500);
  for (const d of hdl) await d.saveAs(join(OUT, 'takes', d.suggestedFilename()));
  check('the host exports the received take', hdl.length === 2, hdl.map((d) => d.suggestedFilename()).join(', '));
  const sdl = []; host.on('download', (d) => sdl.push(d));
  await host.locator('#trExportSession').click(); await sleep(800);
  for (const d of sdl) await d.saveAs(join(OUT, 'takes', d.suggestedFilename()));

  // an interrupted take comes back
  await host.locator('#trTake').click();
  await dave.p.locator('#trRec').waitFor(); await sleep(3200);
  await dave.p.close({ runBeforeUnload: false });
  await sleep(500);
  await host.locator('#trTake').click();
  const back = watch(await daveCtx.newPage(), 'dave-again');
  await back.goto(links[0].url);
  check('the phone warns about the interrupted take before rejoining', await back.waitForFunction(() => /interrupted take/.test(document.querySelector('#trNotice').textContent), null, { timeout: 5000 }).then(() => true, () => false));
  await back.locator('#trName').fill('Dave stand-in'); await back.locator('#trJoinForm button').click();
  await back.waitForFunction(() => document.querySelector('#trTakes').textContent.includes('interrupted, recovered'), null, { timeout: 10000 }).catch(() => {});
  const rec = await back.evaluate(async () => (await window.__tableRead.store.list()).find((t) => t.state === 'recording'));
  check('a take cut off mid-recording is recovered from the phone', rec && rec.chunks >= 2 && rec.bytes > 20_000, rec ? `${rec.chunks} chunks, ${rec.bytes} B` : 'none');
  check('consent survives the rejoin', await back.waitForFunction(() => window.__tableRead.consent === 'granted', null, { timeout: 5000 }).then(() => true, () => false));
  const rdl = []; back.on('download', (d) => rdl.push(d));
  await back.locator('#trTakes li', { hasText: 'interrupted' }).locator('[data-act=export]').click(); await sleep(1500);
  for (const d of rdl) await d.saveAs(join(OUT, 'takes', `recovered_${d.suggestedFilename()}`));
  check('the recovered take exports', rdl.length === 2);

  // the exported files are real media
  const vids = (await import('node:fs')).readdirSync(join(OUT, 'takes')).filter((f) => /\.webm$/.test(f) && !f.startsWith('recovered_'));
  for (const v of vids) {
    let dur = 0;
    try { dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(OUT, 'takes', v)]).toString().trim()); }
    catch { dur = 0; }
    if (!Number.isFinite(dur) || dur <= 0) {
      // MediaRecorder WebM carries no duration header; count the decoded frames instead.
      const frames = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0', join(OUT, 'takes', v)]).toString().trim();
      check(`exported ${v} decodes`, /^\d+,\d+,\d+$/.test(frames) && Number(frames.split(',')[2]) > 30, frames);
    } else check(`exported ${v} decodes`, dur > 1, `${dur}s`);
  }
  check('no page errors', !errors.length, errors.join(' | '));
} catch (e) {
  check('run completed', false, e.stack || String(e));
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await Promise.all([hostB.close(), daveB.close(), mattB.close()]);
  await relay.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Output: ${OUT}`);
process.exit(failed.length ? 1 : 0);
