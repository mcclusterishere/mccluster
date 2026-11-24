/* supabase/functions/_shared/creator-distribution.ts: what Control stages into the store pipeline for a creator's
   release, and the music-access action that writes it. No code is minted; McCluster is never the label by default. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stageCreatorRelease, RESTAGEABLE } from '../../supabase/functions/_shared/creator-distribution.ts';

const ORG = 'org-1';
const base = { id: 't1', m_uid: 'm1', title: ' Song ', artist: 'Fixture Artist', status: 'published', rights_status: 'cleared', duration_ms: 181000,
  poster_url: 'https://x/a.jpg', master_bucket: 'creator-masters', master_path: 'u/m.wav' };
const dist = { v: 1, release_date: '2027-01-15', explicit: false, language: 'en', master_owner: 'Fixture Artist', p_line: '2026 Fixture Artist', c_line: '2026 Fixture Artist',
  isrc: '', upc: '', credits: [{ name: 'Fixture Artist', role: 'Primary artist' }, { name: 'Ada', role: 'Songwriter' }, { name: 'X', role: 'Boss' }],
  splits: [{ kind: 'master', name: 'Fixture Artist', share_pct: 60 }, { kind: 'master', name: 'Ada', share_pct: 40 }, { kind: 'publishing', name: 'Ada', share_pct: 100 }] };

test('refuses what is not approved or has no details', () => {
  assert.match(stageCreatorRelease({ ...base, status: 'draft', distribution: dist }, ORG).refusal, /approve/);
  assert.match(stageCreatorRelease({ ...base, distribution: null }, ORG).refusal, /not entered/);
  assert.match(stageCreatorRelease({ ...base, distribution: [1] }, ORG).refusal, /not entered/);
});

test('maps a complete release; codes stay empty and are named as the only gaps', () => {
  const s = stageCreatorRelease({ ...base, distribution: dist }, ORG);
  assert.equal(s.refusal, undefined);
  assert.deepEqual(s.gaps, ['ISRC', 'UPC']);
  assert.equal(s.recording.isrc, '');
  assert.equal(s.recording.title, 'Song');
  assert.equal(s.recording.recording_year, 2027);
  assert.deepEqual(s.recording.audio_ref, { bucket: 'creator-masters', path: 'u/m.wav' });
  assert.deepEqual(s.recording.metadata.credits.map((c) => c.role), ['Primary artist', 'Songwriter'], 'an unknown role is dropped');
  assert.equal(s.release.status, 'metadata-review');
  assert.equal(s.release.label, 'Fixture Artist', 'the label is the creator\'s, not McCluster Corp');
  assert.equal(s.release.metadata.creator_track_id, 't1');
  assert.deepEqual(s.splits.map((x) => [x.rights_type, x.share_bps]), [['master', 6000], ['master', 4000], ['publishing', 10000]]);
});

test('an owned code is used only when it is valid; bad splits and missing facts are gaps', () => {
  const s = stageCreatorRelease({ ...base, master_path: 'u/m.mp3', distribution: { ...dist, isrc: 'QT6KV2600001', upc: '036000291452', explicit: null,
    credits: [], splits: [{ kind: 'master', name: 'A', share_pct: 70 }] } }, ORG);
  assert.equal(s.recording.isrc, 'QT6KV2600001');
  assert.equal(s.release.upc, '036000291452');
  assert.deepEqual(s.gaps, ['master splits do not add up to 100%', 'lossless master (WAV or FLAC)', 'explicit or clean', 'songwriter credit']);
  const bad = stageCreatorRelease({ ...base, distribution: { ...dist, isrc: 'nope', upc: '036000291453' } }, ORG);
  assert.equal(bad.recording.isrc, '');
  assert.equal(bad.release.upc, '');
});

test('no splits: the whole master to its owner', () => {
  const s = stageCreatorRelease({ ...base, distribution: { ...dist, splits: [] } }, ORG);
  assert.deepEqual(s.splits, [{ party_name: 'Fixture Artist', role: 'master owner', rights_type: 'master', share_bps: 10000 }]);
});

test('a release already with the stores is never restaged in place', () => {
  for (const st of ['delivering', 'delivered', 'live', 'takedown', 'archived']) assert.equal(RESTAGEABLE.has(st), false, st);
  for (const st of ['draft', 'metadata-review', 'approved']) assert.equal(RESTAGEABLE.has(st), true, st);
});

test('music-access stages through the shared module, owner only, dry run by default, never delivering', async () => {
  const src = await readFile(new URL('../../supabase/functions/music-access/index.ts', import.meta.url), 'utf8');
  const i = src.indexOf('if (action === "operator-distribution-stage")');
  assert.ok(i > 0);
  const block = src.slice(i, src.indexOf('/* STEMS, owner only', i));
  assert.match(block, /^if \(action === "operator-distribution-stage"\) \{\s*if \(!\(await houseOps\(who\.user\.id\)\)\) return json\(\{ error: "operator permission required" \}, 403\);/);
  assert.match(block, /stageCreatorRelease\(t, org\.id\)/);
  assert.match(block, /if \(body\.dry_run !== false\) return json\(\{ ok: true, dry_run: true/);
  assert.match(block, /RESTAGEABLE\.has\(prior\.status\)/);
  assert.doesNotMatch(block, /eu_jobs|deliver-ddex|music_assign_creator_isrc|eu_ddex_messages/, 'staging never queues a delivery or mints a code');
});
