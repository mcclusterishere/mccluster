/* js/music-distribution.js: the creator's store details and the checklist, plus the pending SQL that stores them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const D = require('../../js/music-distribution.js');
const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

test('codes: ISRC shape and UPC check digit', () => {
  assert.equal(D.isIsrc('QT6KV2600001'), true);
  assert.equal(D.isIsrc('QT-6KV-26-00001'), false);
  assert.equal(D.isUpc('036000291452'), true);
  assert.equal(D.isUpc('036000291453'), false);
  assert.equal(D.isUpc('4006381333931'), true);
  assert.equal(D.isDate('2026-02-30'), false);
  assert.equal(D.isDate('2026-12-24'), true);
});

test('normalize keeps the stored shape bounded and drops what it does not know', () => {
  const d = D.normalize({ release_date: '2026-12-24', explicit: 'yes', isrc: 'qt-6kv-26-00001', upc: '0360 0029 1452', evil: 1,
    credits: [{ name: '  Ada   Writer ', role: 'Composer' }, { name: 'X', role: 'Boss' }, {}],
    splits: [{ kind: 'master', name: 'Ada', share_pct: '60' }, { kind: 'nope', name: 'Bo', share_pct: 40 }] });
  assert.equal(d.evil, undefined);
  assert.equal(d.explicit, null);
  assert.equal(d.isrc, 'QT6KV2600001');
  assert.equal(d.upc, '036000291452');
  assert.deepEqual(d.credits, [{ name: 'Ada Writer', role: 'Composer' }, { name: 'X', role: '' }]);
  assert.deepEqual(d.splits, [{ kind: 'master', name: 'Ada', share_pct: 60 }, { kind: 'master', name: 'Bo', share_pct: 40 }]);
});

test('problems: splits must add up to 100 per kind; bad codes and nameless credits are named', () => {
  assert.deepEqual(D.problems({ splits: [{ kind: 'master', name: 'A', share_pct: 50 }, { kind: 'master', name: 'B', share_pct: 50 }] }), []);
  assert.match(D.problems({ splits: [{ kind: 'publishing', name: 'A', share_pct: 70 }] }).join(' '), /publishing splits add up to 70%/);
  assert.match(D.problems({ isrc: 'ABC' }).join(' '), /ISRC/);
  assert.match(D.problems({ upc: '123456789013' }).join(' '), /UPC/);
  assert.match(D.problems({ credits: [{ role: 'Producer' }] }).join(' '), /Credit 1 needs a name/);
});

test('readiness: a bare draft is blocked; a complete approved release is ready, codes left to McCluster', () => {
  const bare = D.readiness({ title: 'T', artist: 'A', status: 'draft', rights_status: 'incomplete' }, null, { today: '2026-11-23' });
  assert.equal(bare.ready, false);
  const state = (r, k) => r.items.find((i) => i.key === k).state;
  assert.equal(state(bare, 'review'), 'todo');
  assert.equal(state(bare, 'isrc'), 'mccluster');
  const track = { title: 'T', artist: 'A', status: 'published', rights_status: 'cleared', poster_url: 'https://x/a.jpg', master_path: 'u/m.wav', lyr_reviewed: 'true' };
  const dist = { release_date: '2027-01-15', explicit: false, master_owner: 'A', p_line: '2026 A', credits: [{ name: 'A', role: 'Songwriter' }] };
  const ok = D.readiness(track, dist, { today: '2026-11-23', art: { w: 3000, h: 3000 } });
  assert.equal(ok.ready, true, JSON.stringify(ok.items.filter((i) => i.state === 'todo')));
  assert.equal(state(ok, 'upc'), 'mccluster');
  const soon = D.readiness({ ...track, master_path: 'u/m.mp3' }, { ...dist, release_date: '2026-11-30' }, { today: '2026-11-23', art: { w: 1400, h: 1400 } });
  assert.equal(state(soon, 'release_date'), 'warn');
  assert.equal(state(soon, 'master'), 'warn');
  assert.equal(state(soon, 'artwork'), 'warn');
  assert.equal(soon.ready, true, 'warnings never block');
});

test('the pending SQL adds a bounded object column and leaves it out of release content (and only it)', async () => {
  const sql = await read('supabase/pending/20261123200000_music_creator_distribution_v1.sql');
  const applied = await read('supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql');
  const rollback = await read('supabase/pending/20261123200000_music_creator_distribution_v1.rollback.sql');
  assert.match(sql, /add column if not exists distribution jsonb/);
  assert.match(sql, /jsonb_typeof\(distribution\) = 'object' and pg_column_size\(distribution\) <= 65536/);
  const list = (s) => /music_track_content\(p_row public\.creator_tracks\)[\s\S]*?- array\[([^\]]+)\]/.exec(s)[1].replace(/\s+/g, '');
  assert.equal(list(sql), list(applied) + ",'distribution'");
  assert.equal(list(rollback), list(applied));
  const order = await read('supabase/pending/PROMOTION-ORDER.md');
  assert.match(order, /20261123200000_music_creator_distribution_v1\.sql/);
});
