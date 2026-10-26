/* CREATE: the bar's record button and the flow behind it.
   ============================================================
   The owner's ask, pinned:
     1. a record button on the bar that opens the phone's own camera
     2. a simple editor: trim, sound, caption, a song, who sees it
     3. post now, or schedule it for later
     4. mobile first, no em dashes, and the house bar left as it is
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

test('Record and Photo open the native camera; Library and Write are there too', async () => {
  const html = await read('create.html');
  assert.match(html, /id="crVideoCam" type="file" accept="video\/\*" capture="environment"/);
  assert.match(html, /id="crPhotoCam" type="file" accept="image\/\*" capture="environment"/);
  assert.match(html, /id="crLibrary" type="file" accept="video\/\*,image\/\*"/);
  assert.match(html, /id="crWrite"/);
  /* live is shown as what it is, not as a working button */
  assert.match(html, /class="cr__live" aria-disabled="true"/);
});

test('the editor trims by reference and the feed plays only the kept stretch', async () => {
  const [js, mnet, api] = await Promise.all([read('js/create.js'), read('js/mnet.js'), read('workers/mccluster/src/platform-api.js')]);
  assert.match(js, /payload\.clip = \{ muted: S\.muted \};/);
  assert.match(js, /payload\.clip\.start_ms = Math\.round\(S\.start \* 1000\)/);
  assert.match(mnet, /frag = "#t=" \+/);
  /* the clip's own fragment, or, with no clip and no picture, a tenth of a second in so a first frame paints */
  assert.match(mnet, /var frag=node\.dataset\.clip\|\|\(posterUrl\?"":"#t=0\.1"\);/);
  assert.match(mnet, /esc\(url\s*\+\s*frag\)/);
  assert.match(api, /function postClip\(c\)/);
});

/* THE COVER (owner, 2026-10-20: "when people upload videos, there's no thumbnail, just a black video") */
test('a video post from Create carries a cover, chosen on the filmstrip', async () => {
  const [html, js, css] = await Promise.all([read('create.html'), read('js/create.js'), read('css/create.css')]);
  assert.match(html, /<script src="js\/video-poster\.js\?v=__STAMP__"><\/script>\s*<script src="js\/create\.js\?v=__STAMP__"><\/script>/);
  assert.match(html, /<button class="cr__chip cr__cover" id="crCover" type="button" aria-label="Cover: use the frame on screen"/);
  assert.match(html, /id="crCoverHint">Tap a frame on the strip to make it the cover\./);
  assert.match(html, /id="crCoverMark"/);
  /* the default is taken as soon as the video's length is known, beside the upload */
  assert.match(js, /drawFrames\(\);\s*\/\*[^*]*\*\/\s*setCover\(null, false\);/);
  assert.match(js, /window\.MCCVideoPoster\.capture\(url, chosen \? \{ at: at, name: name \} : \{ start: S\.start, end: S\.end, name: name \}\)/);
  /* a tap on a frame of the strip (not a handle, not a drag) chooses that frame */
  assert.match(js, /\$\("crStrip"\)\.addEventListener\("pointerdown"/);
  assert.match(js, /e\.target\.closest\("\.cr__handle"\)/);
  assert.match(js, /var t = Math\.min\(Math\.max\(0, S\.dur - 0\.05\), \(i \+ 0\.5\) \* S\.dur \/ n\);/);
  assert.match(js, /setCover\(t, true\)/);
  /* through the same upload-url, PUT and finalize, with the picture's size */
  const up = js.slice(js.indexOf('function uploadCover'), js.indexOf('function setCover'));
  assert.match(up, /\/v1\/mnet\/media\/upload-url/);
  assert.match(up, /method: tok \? "PUT" : "POST"/);
  assert.match(up, /\/v1\/mnet\/media\/finalize", \{ method: "POST", body: \{ asset_id: asset\.id, width: meta\.width, height: meta\.height \} \}/);
  /* sent beside the video it belongs to */
  assert.match(js, /if \(asset && up\.poster && S\.kind === "video"\) payload\.poster_asset_ids = \[up\.poster\.id\];/);
  assert.match(js, /payload\.media_asset_ids = \[asset\.id\]/);
  /* replaced, cancelled or never posted: discarded; posted: kept */
  assert.match(js, /if \(!accountChanged && c\.asset && !\(keep && c\.sent\)\) discardUploadAsset\(c\.asset\);/);
  assert.match(js, /S\.coverSeq\+\+; dropCover\(S\.completed,opts\.accountChanged\);/);
  assert.match(js, /S\.coverSeq\+\+; dropCover\(false\); \$\("crCover"\)\.removeAttribute\("aria-busy"\); paintCover\(\);/);
  assert.match(js, /if \(next\.dropped\) discardUploadAsset\(asset\);/);
  /* the details step shows the cover beside the caption */
  assert.match(js, /S\.cover && S\.cover\.preview\s*\? '<img src="' \+ esc\(S\.cover\.preview\) \+ '" alt="Cover">'/);
  assert.match(css, /\.cr__cover-pic \{ width: 32px; height: 32px;/);
  assert.match(css, /\.cr__cover-mark \{ position: absolute;/);
});

test('the upload starts as soon as the file is chosen and posting waits for it', async () => {
  const js = await read('js/create.js');
  assert.ok(js.indexOf('startUpload();') > js.indexOf('function choose(file, source)'));
  assert.match(js, /var ready = S\.file \? S\.upload : Promise\.resolve\(null\);/);
  assert.match(js, /\/v1\/mnet\/media\/upload-url/);
  assert.match(js, /\/v1\/mnet\/media\/finalize/);
});

test('post now or later, and later can be cancelled', async () => {
  const [html, js, api] = await Promise.all([read('create.html'), read('js/create.js'), read('workers/mccluster/src/platform-api.js')]);
  assert.match(html, /data-when="now"/);
  assert.match(html, /data-when="later"/);
  assert.match(js, /payload\.publish_at = at\.toISOString\(\)/);
  assert.match(js, /\/v1\/mnet\/scheduled\//);
  assert.match(api, /path==='\/v1\/mnet\/scheduled'&&req\.method==='GET'/);
  assert.match(api, /export async function publishDueNetworkPosts/);
  const entry = await read('workers/mccluster/src/entry-platform.js');
  assert.match(entry, /publishDueNetworkPosts\(env, \{ limit: 20 \}\)/);
});

test('the scheduled-posts table is the Worker\'s alone', async () => {
  let sql = null;
  for (const dir of ['supabase/migrations', 'supabase/pending_migrations']) {
    const hit = (await readdir(join(ROOT, dir))).find((f) => f.endsWith('_mnet_scheduled_posts.sql'));
    if (hit) { sql = await read(join(dir, hit)); break; }
  }
  assert.ok(sql, 'the scheduled posts migration is missing');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.network_scheduled_posts from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/);
});

test('create follows the mobile rules and the copy rules', async () => {
  const [css, html, js] = await Promise.all([read('css/create.css'), read('create.html'), read('js/create.js')]);
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  assert.doesNotMatch(css, /(?<!minmax\(0,\s?)\b1fr\b/);
  assert.match(css, /font-size: max\(16px, 1rem\)/);
  assert.doesNotMatch(css, /font:[^;]*inherit/);
  assert.doesNotMatch(css, /\.appbar/, 'the house bar is not styled here');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(html, /user-scalable/);
  assert.doesNotMatch(html + js, /—/, 'no em dashes');
});

test('Create survives common client-side failure modes', async () => {
  const [html, js] = await Promise.all([read('create.html'), read('js/create.js')]);
  assert.match(js, /MCCCompositionDraft.browser\("advanced"\)/);
  assert.doesNotMatch(js, /getItem\(DRAFT_KEY\)/);
  assert.match(js, /window\.addEventListener\("beforeunload", saveDraft\)/);
  assert.match(js, /document\.addEventListener\("visibilitychange"/);
  assert.match(js, /restoreDraft\(\)/);
  assert.match(html, /id="crUploadRetry"/);
  assert.match(js, /crUploadRetry/);
  assert.match(js, /MAX_IMAGE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(js, /MAX_VIDEO_BYTES = 500 \* 1024 \* 1024/);
});

test('native Create describes the canonical hardened flow instead of promising missing native features', async () => {
  const native = await read('native/app/(tabs)/create.tsx');
  assert.match(native, /same hardened camera and library flow as web/);
  assert.match(native, /Draft recovery and interrupted-upload retry/);
  assert.doesNotMatch(native, /Native camera capture/);
});

test('upload cancellation cleans abandoned server media and fences stale completion', async () => {
  const [html, js, api, edge] = await Promise.all([
    read('create.html'), read('js/create.js'), read('workers/mccluster/src/platform-api.js'), read('supabase/functions/mnet-media/index.ts')
  ]);
  assert.match(html, /id="crUploadCancel"/);
  assert.match(js, /S\.xhr\.abort\(\)/);
  assert.match(js, /\/v1\/mnet\/media\/discard/);
  assert.match(js, /S\.upload !== mine\.p \|\| S\.uploadCancelled/);
  assert.match(api, /path==='\/v1\/mnet\/media\/discard'/);
  assert.match(edge, /action==="discard"/);
  assert.match(edge, /storage\.from\(asset\.bucket_id\)\.remove/);
  assert.match(edge, /network_media_assets"\)\.delete/);
});

test('Create exposes recoverable network lifecycle states', async () => {
  const js = await read('js/create.js');
  assert.match(js, /window\.addEventListener\("online"/);
  assert.match(js, /window\.addEventListener\("offline"/);
  assert.match(js, /Connection restored\. Ready to retry/);
  assert.match(js, /Connection lost\. The upload can be retried/);
});


test("Create lifecycle fences cancellation, offline reservation, drafts, and attached media", async () => {
  const js = await read("js/create.js");
  assert.match(js, /if \(!S\.owner \|\| S\.busy \|\| S\.completed\) return/);
  assert.match(js, /reset\(\{ preserveComposition: S\.draftRestored \}\)/);
  assert.match(js, /if \(navigator\.onLine === false\)[\s\S]*S\.upload = null; S\.uploadPhase = "waiting"/);
  assert.match(js, /S\.upload !== mine\.p \|\| S\.uploadCancelled/);
  assert.match(js, /The media upload is waiting for a connection/);
  assert.match(js, /S\.completed = true; S\.draftRestored = false; S\.uploadPhase = "attached"/);
  assert.match(js, /var abandoned = S\.completed \|\| opts\.accountChanged \? null/);
});
