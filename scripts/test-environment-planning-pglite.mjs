// Isolated actual-DDL insertion/reload rehearsal. No production connection,
// migration application, or native concurrency/RLS claim.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { createEnvironmentPlanningService, prepareEnvironmentSponsorDraft } from '../workers/mccluster/src/environment-mission-planning.js';
globalThis.crypto ||= webcrypto;
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH || '/tmp/owner-postgres-tools/node_modules/@electric-sql/pglite/dist/index.js'));
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = id(1), owner = id(7), articleId = id(2);
const now = Date.parse('2026-11-08T12:00:00Z');
const article = { id: articleId, title: 'Accessible cooling resource announced', canonical_url: 'https://example.org/cooling', published_at: '2026-11-08T09:00:00Z', imported_at: '2026-11-08T09:10:00Z', ingestion_provider: 'gdelt_gkg_v2' };
const event = { id: 'nws:alert', title: 'Heat alert', source: { id: 'nws', url: 'https://www.weather.gov/' }, observed_at: '2026-11-08T09:00:00Z', stale: false, actions: [{ id: 'resource-check' }] };
function extractTable(sql, name) {
  const match = sql.match(new RegExp(`create table (?:if not exists )?public\\.${name} \\([\\s\\S]*?\\n\\s*\\);`, 'i'));
  assert.ok(match, `Canonical ${name} DDL found`);
  return match[0];
}
try {
  const companyDDL = extractTable(await read('supabase/replay_migrations/0065_outreach_engine_core.sql'), 'out_companies');
  const recommendationDDL = extractTable(await read('supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql'), 'ops_recommendations');
  // Only unrelated referenced parent tables are stubbed; both target tables
  // are loaded verbatim, including real defaults, NOT NULL, FKs and CHECKs.
  await db.exec('create table public.orgs(id uuid primary key); create table public.out_campaigns(id uuid primary key); create table public.out_contacts(id uuid primary key); create table public.ops_objectives(id uuid primary key);');
  await db.exec(companyDDL);
  await db.exec(recommendationDDL);
  await db.query('insert into orgs(id) values($1)', [org]);
  for (const status of ['new', 'contacted', 'replied', 'partner', 'declined']) {
    const row = (await db.query('insert into out_companies(org_id,name,notes,status) values($1,$2,$3,$4) returning id,org_id,name,notes,status', [org, `Example ${status}`, 'Accessibility research', status])).rows[0];
    assert.equal(row.status, status);
  }
  await assert.rejects(db.query("insert into out_companies(org_id,name,status) values($1,'Example','invented')", [org]), /out_companies_status_ck/);
  const company = (await db.query("select id,org_id,name,notes,status from out_companies where status='new' limit 1")).rows[0];
  let written;
  const service = createEnvironmentPlanningService({ authorizeOwner: async () => ({ orgId: org, actorId: owner }), now: () => now, repository: {
    readEvent: async () => event,
    readArticles: async () => [article],
    readCompany: async () => company,
    // JSON round-trip models PostgREST timestamp serialization (PGlite returns Date objects).
    readReviews: async () => JSON.parse(JSON.stringify((await db.query('select * from ops_recommendations where org_id=$1', [org])).rows)),
    saveNewsReview: async (_, record) => {
      written = record;
      assert.equal(Object.hasOwn(record, 'confidence'), false, 'Use canonical non-null default, never explicit null');
      const keys = Object.keys(record);
      assert.ok(keys.every(k => /^[a-z_]+$/.test(k)));
      return (await db.query(`insert into ops_recommendations(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, keys.map(k => typeof record[k] === 'object' ? JSON.stringify(record[k]) : record[k]))).rows[0];
    }
  } });
  const request = { eventId: event.id, actionId: 'resource-check' };
  const candidates = await service.listContext(request);
  const saved = await service.reviewContext({ ...request, articleId, revision: candidates.articles[0].revision, headlineExcerpt: 'cooling resource', rationale: 'Review whether this resource provides accessible support for the official alert.' });
  const row = (await db.query('select * from ops_recommendations where id=$1', [saved.review_id])).rows[0];
  assert.equal(row.status, 'approved');
  assert.equal(row.recommendation_type, 'environment_news_context');
  assert.equal(Number(row.confidence), 0.5);
  assert.equal(row.proposed_action.confidence_basis, 'canonical_database_default_not_a_model_score');
  assert.equal(row.title, written.title);
  assert.equal(row.proposed_action.reviewer_id, owner);
  const preview = await service.plan(request);
  assert.equal(preview.news[0].review_id, saved.review_id);
  const draft = await service.sponsorDraft({ ...request, companyId: company.id, alignmentExcerpt: 'Accessibility research' });
  assert.equal(draft.recipient, null);
  assert.throws(() => prepareEnvironmentSponsorDraft({ preview, company: { ...company, status: 'invented' }, alignmentExcerpt: 'Accessibility research' }), /invalid_company_status/);
  // Regression: prove the prior exact bug is rejected by canonical DDL.
  await assert.rejects(db.query("insert into ops_recommendations(org_id,recommendation_type,title,rationale,confidence,status) values($1,'environment_news_context','Test','Test',null,'approved')", [org]), /null value in column "confidence"/);
  // Existing schema uses text rather than bounded varchar or status/type CHECK.
  const columnTypes = (await db.query("select column_name,data_type,character_maximum_length from information_schema.columns where table_name='ops_recommendations' and column_name in ('title','rationale','status','recommendation_type')")).rows;
  assert.equal(columnTypes.length, 4);
  assert.ok(columnTypes.every(column => column.data_type === 'text' && column.character_maximum_length === null));
  console.log('PASS: canonical ops_recommendations INSERT, non-null confidence default, exact review reload, out_companies statuses/fields, sponsor preparation, and old-null regression.');
} finally { await db.close(); }
