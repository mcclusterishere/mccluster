import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../supabase/migrations/20260919060000_operational_ontology_v1.sql', import.meta.url), 'utf8');
const ontology = await readFile(new URL('../src/tools/ontology.mjs', import.meta.url), 'utf8');

test('ontology v1 has objects links actions runs and lineage', () => {
  for (const table of [
    'ops_ontology_types',
    'ops_ontology_objects',
    'ops_ontology_link_types',
    'ops_ontology_links',
    'ops_ontology_action_types',
    'ops_ontology_action_runs',
    'ops_ontology_lineage'
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
});

test('ontology v1 is service-mediated and force-RLS protected', () => {
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.ops_ontology_query_service/);
  assert.match(migration, /grant execute on function public\.ops_ontology_apply_action_service/);
  assert.doesNotMatch(migration, /grant execute on function public\.ops_ontology_apply_action_service[^;]+to authenticated/i);
});

test('canonical objectives jobs apps and organizations materialize into the ontology', () => {
  assert.match(migration, /ops_ontology_sync_org_t/);
  assert.match(migration, /ops_ontology_sync_objective_t/);
  assert.match(migration, /ops_ontology_sync_job_t/);
  assert.match(migration, /ops_ontology_sync_app_t/);
  assert.match(migration, /objective_has_job/);
  assert.match(migration, /'table','ops_objectives'/);
  assert.match(migration, /'table','ops_agent_jobs'/);
  assert.match(migration, /'table','platform_apps'/);
});

test('ontology actions are bounded internal effects in v1', () => {
  for (const effect of ["v_effect='annotate'", "v_effect='tag'", "v_effect='link'"]) {
    assert.ok(migration.includes(effect), `missing bounded effect ${effect}`);
  }
  assert.match(migration, /budget ontology actions are not implemented in v1/);
  assert.match(migration, /owner permission required/);
  assert.match(migration, /request_hash is required/);
  assert.doesNotMatch(migration, /execute format\(/i);
});

test('Core computes action hash and requires signed actor context', () => {
  assert.match(ontology, /createHash\('sha256'\)/);
  assert.match(ontology, /options\?\.actor\?\.user_id/);
  assert.match(ontology, /p_request_hash: requestHash/);
  assert.match(ontology, /ops_ontology_apply_action_service/);
});
