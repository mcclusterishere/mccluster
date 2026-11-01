import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActorEvidence, evidenceReceipt } from '../src/actors/evidence.mjs';
const now = new Date('2026-11-01T12:00:00Z');
const news = { kind: 'news', id: 'n1', title: 'Neighborhood library opens a community recording studio', canonical_url: 'https://publisher.example/story', published_at: now.toISOString() };
const grant = { id: 'test-owned-license', reviewer: 'fixture-reviewer', status: 'approved', reviewed_at: '2026-10-01', expires_at: '2026-12-01', terms_url: 'https://publisher.example/terms', basis: 'owned', scope: 'article', canonical_url: news.canonical_url, adapter_ids: ['fixture'], native_layout: true, full_text_display: true, storage: true, automated_ingestion: true, attribution_required: true };
const full = { ...news, publisher: 'Synthetic Publisher', byline: 'Fixture Desk', attribution: 'Synthetic testing text', adapter_id: 'fixture', requirements_reviewed: true, body: { format: 'text_blocks', complete: true, blocks: [{ type: 'paragraph', text: 'The studio lends microphones and provides free training every Tuesday.' }] } };

test('discovery metadata is headline-only, never a publisher date or reading claim', () => {
  const p = buildActorEvidence(news, { now });
  assert.equal(p.access.level, 'headline'); assert.equal(p.item.published_at, null);
  assert.equal(p.item.discovered_at, now.toISOString()); assert.equal(p.access.full_text_in_context, false);
  assert.ok(p.unknowns.includes('publisher_date_unknown')); assert.equal(p.sources.length, 1);
});
test('missing, expired, paywalled and source-supplied permission cannot authorize article text', () => {
  for (const readerGrants of [[], [{ ...grant, expires_at: '2026-10-31' }], [{ ...grant, canonical_url: 'https://publisher.example/elsewhere' }]]) {
    const p = buildActorEvidence({ ...full, permission: grant, paywalled: true }, { now, readerGrants });
    assert.equal(p.access.level, 'headline'); assert.ok(!JSON.stringify(p).includes('lends microphones'));
  }
});
test('authorized complete, excerpt and budget-truncated content have truthful provenance', () => {
  const options = { now, readerGrants: [grant] };
  const p = buildActorEvidence(full, options);
  assert.equal(p.access.level, 'full'); assert.equal(p.access.full_text_received, true); assert.equal(p.access.full_text_in_context, true);
  assert.equal(p.sources[1].grant_id, grant.id);
  const excerpt = buildActorEvidence({ ...full, body: { ...full.body, complete: false } }, options);
  assert.equal(excerpt.access.level, 'partial'); assert.equal(excerpt.access.full_text_received, false);
  const long = buildActorEvidence({ ...full, body: { ...full.body, blocks: [{ type: 'paragraph', text: '漢語'.repeat(8000) }] } }, { ...options, maxBytes: 256 });
  assert.equal(long.access.level, 'partial'); assert.equal(long.access.full_text_received, true); assert.equal(long.access.full_text_in_context, false);
  assert.ok(long.sources.reduce((n, s) => n + Buffer.byteLength(s.text), 0) <= 256);
  assert.equal(long.sources[1].truncated, true); assert.ok(!long.sources[1].text.includes('\uFFFD'));
  assert.equal(Object.hasOwn(evidenceReceipt(p).sources[1], 'text'), false);
});
test('stable source IDs and hashes change with content, not preview time', () => {
  const a = buildActorEvidence(full, { now, readerGrants: [grant] });
  const b = buildActorEvidence(full, { now: new Date('2026-11-01T12:01:00Z'), readerGrants: [grant] });
  assert.equal(a.evidence_sha256, b.evidence_sha256);
  const c = buildActorEvidence({ ...full, title: 'Changed title' }, { now, readerGrants: [grant] });
  assert.notEqual(a.sources[0].source_id, c.sources[0].source_id);
});
test('stale article snapshots are unavailable; old publisher dates stay visibly old', () => {
  const stale = buildActorEvidence({ ...news, revision: 'r2', expected_revision: 'r1' }, { now });
  assert.equal(stale.access.reason, 'stale_revision'); assert.equal(stale.sources.length, 0);
  const old = buildActorEvidence({ ...news, publisher_published_at: '2020-01-01' }, { now });
  assert.ok(old.unknowns.includes('older_article_not_breaking_news'));
});
test('songs distinguish catalog, versioned authorized lyrics, and never claim audio observation', () => {
  const song = { kind: 'song', id: 's1', revision: 'v2', title: 'Synthetic Track', artist_name: 'Test Artist', lyrics: { revision: 'v2', complete: true, text: 'The streetlights guide us back to the library.' }, audio_observed: true };
  const contentGrants = [{ id: 'lyrics-fixture', item_id: 's1', revision: 'v2', reviewer: 'test', status: 'approved', reviewed_at: '2026-10-01', expires_at: '2026-12-01', automated_analysis: true, scope: 'lyrics' }];
  const p = buildActorEvidence(song, { now, contentGrants });
  assert.equal(p.access.reason, 'lyrics_only'); assert.equal(p.access.audio_observed, false);
  assert.ok(p.sources.some(s => s.type === 'lyrics'));
  for (const bad of [{ ...song, lyrics: { ...song.lyrics, revision: 'v1' } }, { ...song, expected_revision: 'v1' }]) {
    assert.ok(!buildActorEvidence(bad, { now, contentGrants }).sources.some(s => s.type === 'lyrics'));
  }
  assert.equal(buildActorEvidence(song, { now }).access.reason, 'catalog_only');
});
test('posts exclude private, group and deleted context, and attribute public replies', () => {
  const post = { kind: 'post', id: 'p1', visibility: 'public', body: 'I am planning a neighborhood studio workshop.', author_m_uid: 'author1', replies: [
    { id: 'r1', visibility: 'public', body: 'Could the workshop include microphones?', author_m_uid: 'author2' },
    { id: 'r2', visibility: 'private', body: 'PRIVATE SECRET' },
  ] };
  const p = buildActorEvidence(post, { now }); assert.equal(p.access.level, 'full'); assert.equal(p.sources[1].author_id, 'author2');
  assert.ok(!JSON.stringify(p).includes('PRIVATE SECRET'));
  for (const change of [{ visibility: 'private' }, { group_id: 'g' }, { deleted_at: '2026-11-01' }]) {
    assert.equal(buildActorEvidence({ ...post, ...change }, { now }).sources.length, 0);
  }
});
