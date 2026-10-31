import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Stems are the owner's unreleased material (owner, 2026-10-31). They live in the
   private bucket and a service-role-only table, are signed only for the house
   operator, and never enter the published repository. */
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('music-access signs stems and queues separation only for the house operator', () => {
  const src = read('supabase/functions/music-access/index.ts');
  const start = src.indexOf('if (action === "operator-stems-list" || action === "operator-stems-queue")');
  assert.ok(start > 0, 'the stems actions exist');
  const block = src.slice(start, src.indexOf('\n    }\n', start));
  assert.match(block.slice(0, 200), /if \(!\(await houseOps\(who\.user\.id\)\)\) return json\(\{ error: "operator permission required" \}, 403\);/, 'operator check is the first thing the stems actions do');
  assert.match(block, /signDownload\("mcc-gated-audio", x\.path, undefined, 900\)/, 'play URLs are short-lived');
  assert.ok(block.includes('/^stems\\/[a-z0-9-]+\\/(r\\d{14}-[0-9a-f]{6}\\/)?[a-z]+\\.(mp3|flac|wav)$/'), 'only stems/<key>/[<run>/]<stem>.<ext> paths are ever signed');
  assert.match(block, /\.eq\("status", "queued"\)/, 'a running separation never suppresses a re-run');
  for (const action of ['operator-lyrics-get', 'operator-lyrics-save', 'operator-lyrics-queue']) {
    const i = src.indexOf(`if (action === "${action}")`);
    assert.ok(i > 0, action);
    assert.match(src.slice(i, i + 200), /houseOps\(who\.user\.id\)/, `${action} is operator-only`);
  }
});

test('the stem manifest table is private and the bucket stays private', () => {
  const sql = read('supabase/pending/20261031190000_music_stem_sets_v1.sql');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.music_stem_sets from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant select on public\.music_stem_sets to (anon|authenticated)/);
  assert.doesNotMatch(sql, /storage\.buckets|create policy/, 'no bucket or storage policy change: mcc-gated-audio is already private');
  assert.ok(read('supabase/pending/20261031190000_music_stem_sets_v1.rollback.sql').includes('drop table if exists public.music_stem_sets'));
});

test('stems never default into the published checkout', () => {
  for (const f of ['tools/lyrics/stems.mjs', 'tools/lyrics/transcribe.mjs']) {
    const s = read(f);
    assert.match(s, /homedir\(\), '\.cache', 'mccluster', 'stems'/, `${f}: default stems dir is outside the repo`);
  }
  assert.match(read('.gitignore'), /^\.lyrics-work\/$/m);
});
