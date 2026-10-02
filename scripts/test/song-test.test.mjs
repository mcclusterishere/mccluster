/* THE SONG TEST — "Was this song racist? Why?"
   ============================================================
   The owner's rules, pinned:
     1. only someone the server counted as hearing the whole song answers
        (a completed listen; for the earned record, a granted play)
     2. a reason is required
     3. listeners see the split only after answering; the reasons are the
        owner's alone, and nobody writes an answer around the function
     4. the cards live in the album player and on end-racism.html, and the
        gateway's own play buttons count toward a full listen
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');
async function migration() {
  for (const dir of ['supabase/migrations', 'supabase/pending_migrations']) {
    const hit = (await readdir(join(ROOT, dir))).find((f) => f.endsWith('_song_test.sql'));
    if (hit) return read(join(dir, hit));
  }
  throw new Error('the song test migration is missing');
}

test('only a full listen (or a granted play of the earned record) unlocks an answer', async () => {
  const sql = await migration();
  assert.match(sql, /then exists \(select 1 from public\.music_gated_plays g where g\.user_id = p_user and g\.track_key = t\.track_key\)/);
  assert.match(sql, /else exists \(select 1 from public\.music_listens l where l\.user_id = p_user and l\.track_key = t\.track_key and l\.completed\)/);
  assert.match(sql, /if not public\.song_test_heard\(v_user, p_track\) then raise exception 'hear the whole song first'|if not public\.song_test_heard\(v_user, p_track\) then\s+raise exception 'hear the whole song first'/);
  assert.match(sql, /char_length\(btrim\(why\)\) between 3 and 1000/, 'a reason is required');
  assert.match(sql, /p_verdict not in \('yes','no','unsure'\)/);
});

test('the split shows only after answering, and only the owner reads the reasons', async () => {
  const sql = await migration();
  assert.match(sql, /'split', case when v\.user_id is null then null else \(/);
  assert.match(sql, /using \(user_id = \(select auth\.uid\(\)\) or \(select public\.eu_is_admin\(\)\)\)/);
  assert.doesNotMatch(sql, /on public\.song_verdicts\s+for (insert|update|all)/, 'no direct writes');
  assert.match(sql, /revoke all on function public\.song_test_heard\(uuid, text\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.song_test_answer\(text, text, text\) from public, anon;/);
  /* the split itself never carries reasons */
  const split = sql.match(/'split'[\s\S]*?end\s*\) order by/)[0];
  assert.doesNotMatch(split, /\bwhy\b/);
});

test('the earned record is named by a label, never its title, on public cards', async () => {
  const sql = await migration();
  assert.match(sql, /\('niggy-nigg', 'cia-mind-control', 'The earned track', true, 2\)/);
  const js = await read('js/song-test.js');
  assert.match(js, /head\.appendChild\(el\("b", null, r\.label\)\);/);
});

test('the cards are in the album player and on End Racism, and gateway plays count', async () => {
  const [album, er, gw] = await Promise.all([read('album.html'), read('end-racism.html'), read('js/gateway.js')]);
  assert.match(album, /var TESTED = \{ "cia-mind-control": true \};/);
  /* the mount has to live where boot() can see it */
  assert.ok(album.indexOf('function mountTest()') < album.indexOf('function boot(data, pls, ct)'), 'mountTest is defined beside boot');
  assert.match(album, /if \(d && d\.counted && songTest\) songTest\.refresh\(\)/);
  assert.match(album, /js\/song-test\.js/);
  assert.match(er, /MCC_SONGTEST\.mount\(document\.getElementById\("gwTest"\), "cia-mind-control"/);
  assert.match(er, /js\/listen-ledger\.js[\s\S]*js\/gateway\.js/);
  assert.match(gw, /if \(!h && a\.currentTime < 3\) h = L\.start\(key, playing\);/);
  assert.match(gw, /if \(h && a\.currentTime \+ 2 < last\) \{ L\.finish\(h\); h = L\.start\(key, playing\); \}/);
});

test('the song test follows the mobile rules', async () => {
  const css = await read('css/song-test.css');
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  assert.doesNotMatch(css, /repeat\(\d+,\s*1fr\)|(?<!minmax\(0,\s?)\b1fr\b(?!\))/);
  assert.match(css, /\.stq-why textarea \{[\s\S]*?font-size: max\(16px, 1rem\)/);
  assert.doesNotMatch(css, /font:[^;]*inherit/, 'no font shorthand with inherit (the whole declaration would be dropped)');
});

test('Control has the owner view of the answers', async () => {
  const [html, v2, mod] = await Promise.all([read('control.html'), read('js/control-room-v2.js'), read('js/control-room/song-test.js')]);
  assert.match(html, /js\/control-room\/song-test\.js/);
  assert.match(v2, /window\.CR\.songTest\.render\(\)/);
  assert.match(mod, /song_verdicts\?select=track_key,verdict,why/);
});
