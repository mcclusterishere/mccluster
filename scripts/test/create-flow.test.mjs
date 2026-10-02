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
  assert.match(mnet, /esc\(url \+ \(node\.dataset\.clip \|\| ""\)\)/);
  assert.match(api, /function postClip\(c\)/);
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
  assert.match(js, /DRAFT_KEY = "mnet_create_draft_v1"/);
  assert.match(js, /window\.addEventListener\("beforeunload", saveDraft\)/);
  assert.match(js, /document\.addEventListener\("visibilitychange"/);
  assert.match(js, /restoreDraft\(\)/);
  assert.match(html, /id="crUploadRetry"/);
  assert.match(js, /crUploadRetry/);
  assert.match(js, /MAX_IMAGE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(js, /MAX_VIDEO_BYTES = 1024 \* 1024 \* 1024/);
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
