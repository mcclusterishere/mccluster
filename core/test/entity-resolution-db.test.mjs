// End to end: the Core scan against the real pending SQL on an in-process
// PostgreSQL (PGlite). Skipped when PGlite is not installed; CI proves the SQL on
// its own with .github/workflows/ai-context-entity-resolution-db.yml.
// Local run: PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test test/entity-resolution-db.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runEntityMatchScan } from '../src/entity-resolution/scan.mjs';

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch { PGlite = null; }

const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-0000000000aa';
const sql = (path) => readFile(new URL(`../../supabase/${path}`, import.meta.url), 'utf8');
const CASTS = { p_org: 'uuid', p_actor: 'uuid', p_match: 'uuid', p_object: 'uuid', p_after_id: 'uuid', p_type_keys: 'text[]', p_run: 'jsonb', p_limit: 'integer', p_status: 'text', p_reason: 'text' };

function dbRpc(db) {
  return async (name, args) => {
    const keys = Object.keys(args);
    const params = keys.map((k) => (CASTS[k] === 'jsonb' ? JSON.stringify(args[k]) : args[k]));
    const { rows } = await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${CASTS[k]}`).join(', ')}) as r`, params);
    return rows[0].r;
  };
}

test('scan -> auto link, owner review, approval, unlink: all through the real SQL', { skip: !PGlite && 'PGlite not installed' }, async () => {
  const db = new PGlite();
  await db.exec(await sql('tests/ai_context_entity_resolution.stub.sql'));
  await db.exec(await sql('pending/20261125001000_ai_context_entity_resolution_v1.sql'));
  // The fixture objects the unit tests use, in the database this time.
  await db.exec('delete from public.ops_ontology_objects');
  const objects = JSON.parse(await readFile(new URL('./fixtures/entity-resolution/objects.json', import.meta.url), 'utf8'));
  for (const o of objects) {
    await db.query('insert into public.ops_ontology_objects (id, org_id, type_key, object_key, display_name, properties) values ($1, $2, $3, $4, $5, $6::jsonb)',
      [o.id, ORG, o.type_key, o.object_key, o.display_name, JSON.stringify(o.properties)]);
  }
  const rpc = dbRpc(db);

  const first = await runEntityMatchScan({ orgId: ORG, actorUserId: OWNER, rpc });
  assert.equal(first.auto_linked, 2);
  assert.equal(first.queued_for_review, 2);
  const again = await runEntityMatchScan({ orgId: ORG, actorUserId: OWNER, rpc });
  assert.equal(again.auto_linked + again.queued_for_review, 0, 'a second scan changes nothing');
  assert.equal(again.unchanged_or_skipped, 4);

  const pending = (await rpc('ops_entity_match_list', { p_org: ORG, p_status: 'pending_review', p_limit: 50 })).matches;
  assert.equal(pending.length, 2);
  // Owner approves one in Control, denies the other.
  await db.query(`update public.control_approvals set state = 'approved', decided_by = $1, decided_at = now() where id = $2`, [OWNER, pending[0].approval_id]);
  await db.query(`update public.control_approvals set state = 'denied', decided_by = $1, decided_at = now() where id = $2`, [OWNER, pending[1].approval_id]);
  const third = await runEntityMatchScan({ orgId: ORG, actorUserId: OWNER, rpc });
  assert.equal(third.settled.length, 2, 'the next scan applies Control decisions first');
  const linked = (await rpc('ops_entity_match_list', { p_org: ORG, p_status: 'linked', p_limit: 50 })).matches;
  assert.equal(linked.length, 3);

  const undo = await rpc('ops_entity_match_unlink', { p_org: ORG, p_actor: OWNER, p_match: linked[0].id, p_reason: 'Checked by hand: different people' });
  assert.equal(undo.match.status, 'unlinked');
  const { rows: [audit] } = await db.query(`select (select count(*)::int from ai_context.decisions where metadata->>'ingress' = 'entity_resolution') d,
    (select count(*)::int from public.ops_entity_resolution_events where namespace = 'ontology.same_as') e,
    (select count(*)::int from public.ops_ontology_objects) o`);
  assert.deepEqual(audit, { d: 7, e: 7, o: objects.length }, 'every transition audited; no object removed');
  await db.exec(await sql('pending/20261125001000_ai_context_entity_resolution_v1.rollback.sql'));
  const { rows: [after] } = await db.query(`select to_regclass('ai_context.entity_matches') is null gone, (select count(*)::int from ai_context.decisions) kept`);
  assert.deepEqual(after, { gone: true, kept: 7 }, 'rollback drops the new objects and keeps the audit');
  await db.close();
});
