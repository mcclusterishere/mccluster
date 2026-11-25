import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../ontology/graph-v2.json'));
const forward = await read('../../supabase/pending/20261125010000_ops_ontology_graph_v2.sql');
const rollback = await read('../../supabase/pending/20261125010000_ops_ontology_graph_v2.rollback.sql');
const code = forward.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
const v1 = await read('../../supabase/migrations/20260919053445_operational_ontology_v1.sql');

const v2Types = manifest.object_types.filter((t) => t.since === 'v2');
const v2Links = manifest.link_types.filter((l) => l.since === 'v2');

test('graph v2 grows the ontology from 4 to 22 object types and 1 to 30 link types', () => {
  assert.equal(manifest.object_types.length, 22);
  assert.equal(manifest.object_types.filter((t) => t.since === 'v1').length, 4);
  assert.equal(v2Types.length, 18);
  assert.equal(manifest.link_types.length, 30);
  assert.equal(v2Links.length, 29);
  assert.equal(new Set(manifest.object_types.map((t) => t.type_key)).size, 22, 'type keys are unique');
  assert.equal(new Set(manifest.link_types.map((l) => l.link_key)).size, 30, 'link keys are unique');
});

test('v1 types in the manifest are exactly the v1 migration base types', () => {
  for (const t of manifest.object_types.filter((x) => x.since === 'v1')) {
    assert.match(v1, new RegExp(`\\(p_org,'${t.type_key}','`), `${t.type_key} is a v1 base type`);
  }
});

test('every v2 object type is registered, materialized from its table and rolled back', () => {
  for (const t of v2Types) {
    const table = t.table.replace(/^public\./, '');
    assert.match(forward, new RegExp(`\\('${t.type_key}','${t.display_name.replace(/[()]/g, '\\$&')}','[^']+','${table}'`), `${t.type_key} registered with ${table}`);
    assert.match(forward, new RegExp(`'${t.type_key}'(::text as type_key)?,[^\\n]*\\n[\\s\\S]*?from public\\.${table} r`), `${t.type_key} materialized from ${table}`);
    assert.match(rollback, new RegExp(`'${t.type_key}'`), `${t.type_key} in rollback`);
  }
});

test('every v2 link type is registered with matching ends, materialized and rolled back', () => {
  const typeKeys = new Set(manifest.object_types.map((t) => t.type_key));
  for (const l of v2Links) {
    assert.ok(typeKeys.has(l.source) && typeKeys.has(l.target), `${l.link_key} ends are declared types`);
    assert.match(forward, new RegExp(`\\('${l.link_key}','[^']+','[^']+','${l.source}','${l.target}','${l.from.replace(/[.=]/g, '\\$&')}'\\)`), `${l.link_key} registered`);
    if (!l.link_key.startsWith('task_about_')) {
      assert.match(forward, new RegExp(`'${l.link_key}','${l.source}'`), `${l.link_key} materialized`);
    }
    assert.match(rollback, new RegExp(`'${l.link_key}'`), `${l.link_key} in rollback`);
  }
  assert.match(forward, /'task_about_'\|\|related_type/);
});

test('graph v2 changes no existing object and adds no source-table trigger', () => {
  assert.doesNotMatch(code, /create (or replace )?function private\.ops_ontology_(ensure_base_types|upsert_source_object|delete_source_object|sync_)/);
  assert.doesNotMatch(code, /create (or replace )?function public\.ops_ontology_(schema|query|neighbors|apply_action)_service/);
  assert.doesNotMatch(code, /create trigger/i);
  assert.doesNotMatch(code, /\b(alter|drop) table\b/i);
  assert.doesNotMatch(code, /\b(insert into|update|delete from) public\.(leads|out_\w+|work_\w+|offerings|engagements|eu_\w+|control_approvals)\b/i);
  assert.doesNotMatch(code, /ops_entity_/, 'entity resolution tables are left to the matching change');
});

test('refresh only touches rows it owns and the service entry is service_role only', () => {
  assert.match(forward, /o\.source_ref->>'materializer' = 'ontology_graph_v2'/);
  assert.match(forward, /k\.source_ref->>'materializer' = 'ontology_graph_v2'/);
  assert.match(forward, /where public\.ops_ontology_links\.source_ref->>'materializer' = 'ontology_graph_v2'/);
  assert.match(forward, /'_annotations',c\.properties->'_annotations','_tags',c\.properties->'_tags'/);
  assert.match(forward, /pg_advisory_xact_lock/);
  assert.match(forward, /revoke all on function public\.ops_ontology_graph_v2_refresh_service\(uuid\) from public, anon, authenticated/);
  assert.match(forward, /grant execute on function public\.ops_ontology_graph_v2_refresh_service\(uuid\) to service_role/);
  assert.match(forward, /revoke all on private\.ops_ontology_graph_v2_objects, private\.ops_ontology_graph_v2_links from public, anon, authenticated/);
  assert.match(forward, /set search_path = ''/);
});

test('private and secret fields are not copied into object properties', () => {
  const objectsView = forward.slice(forward.indexOf('create or replace view private.ops_ontology_graph_v2_objects'), forward.indexOf('create or replace view private.ops_ontology_graph_v2_links'));
  for (const field of ["'note',", "'notes',", "'gclid'", "'unsub_token'", "'body_text'", "'body_html'", "'external_join_url'", "'transcript_ref'", "'request_hash'", "'detail',", "'agenda'"]) {
    assert.ok(!objectsView.includes(field), `${field} is not copied`);
  }
});

test('pending file is guarded, transactional and owner-gated', () => {
  assert.match(forward, /PENDING ONLY\. Never applied to production\. Owner approval required/);
  assert.match(forward, /^begin;$/m);
  assert.match(forward, /^commit;$/m);
  assert.match(forward, /source columns missing: %; nothing changed/);
  assert.match(rollback, /Owner approval required/);
});
