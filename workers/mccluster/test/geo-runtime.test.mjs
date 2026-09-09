import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { executeAdapter, GeoAdapterError } from '../src/geo/adapters.js';
import { sourceByKey } from '../src/geo/source-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const migrationPath = resolve(repoRoot, 'supabase', 'migrations', '20260909034000_spatial_intelligence.sql');
const idempotencyPath = resolve(repoRoot, 'supabase', 'migrations', '20260909034100_spatial_observation_idempotency.sql');
const tenantAgentPath = resolve(here, '..', 'src', 'here-tenant-agent.js');

function fakeJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('Open-Meteo adapter uses a fixed upstream and normalizes observations', async (t) => {
  const originalFetch = globalThis.fetch;
  let seenUrl = null;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    seenUrl = String(url);
    return fakeJson({
      latitude: 41.3,
      longitude: -72.9,
      elevation: 20,
      timezone: 'UTC',
      current: { time: '2026-09-09T03:00', temperature_2m: 19.5, wind_speed_10m: 8 },
      current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' },
      hourly: {}
    });
  };

  const result = await executeAdapter('open_meteo', { lat: 41.3, lon: -72.9 }, {});
  assert.match(seenUrl, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.equal(result.source, 'open_meteo');
  assert.equal(result.persistence, 'persistent');
  assert.equal(result.records.filter((row) => row.kind === 'observation').length, 2);
  assert.ok(result.records.every((row) => row.point?.lat === 41.3 && row.point?.lon === -72.9));
});

test('credentialed adapters fail closed with binding names and no invented credential', async () => {
  await assert.rejects(
    () => executeAdapter('census', { year: 2024 }, {}),
    (error) => {
      assert.ok(error instanceof GeoAdapterError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'credential_missing');
      assert.deepEqual(error.detail.required_bindings, ['CENSUS_API_KEY']);
      return true;
    }
  );
});

test('Google key stays out of adapter results and provider URL is redacted', async (t) => {
  const originalFetch = globalThis.fetch;
  const secret = 'google-secret-must-not-leak';
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => fakeJson({
    results: [{ place_id: 'place-1', formatted_address: '1 Test St', geometry: { location: { lat: 41, lng: -73 } } }],
    status: 'OK'
  });

  const result = await executeAdapter('google_maps', { address: '1 Test St' }, { GOOGLE_MAPS_API_KEY: secret });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.match(result.source_url, /key=%5Bredacted%5D|key=%255Bredacted%255D|key=\[redacted\]/);
  assert.equal(result.persistence, 'none');
});

test('provider retention rules keep restricted live feeds out of durable PostGIS by default', () => {
  assert.equal(sourceByKey('google_maps').persistence, 'none');
  assert.equal(sourceByKey('cesium_ion').persistence, 'none');
  assert.equal(sourceByKey('tomtom').persistence, 'transient');
  assert.equal(sourceByKey('opensky_research').persistence, 'transient');
  assert.equal(sourceByKey('aisstream').persistence, 'transient');
  assert.equal(sourceByKey('usgs').persistence, 'persistent');
  assert.equal(sourceByKey('usaspending').persistence, 'persistent');
});

test('spatial migration creates PostGIS graph and keeps browser roles out', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const idempotency = await readFile(idempotencyPath, 'utf8');
  for (const table of [
    'geo_sources', 'geo_source_entitlements', 'geo_layers', 'geo_entities', 'geo_observations',
    'geo_events', 'geo_relationships', 'geo_projects', 'geo_project_entities', 'geo_ingestion_runs',
    'geo_derived_metrics', 'geo_alert_rules', 'geo_alerts'
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
  }
  assert.match(sql, /create extension if not exists postgis with schema extensions/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.%I from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.%I to service_role/i);
  assert.match(sql, /security invoker/gi);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /public\.geo_nearby/);
  assert.match(sql, /public\.geo_bbox/);
  assert.match(sql, /public\.geo_events_nearby/);
  assert.match(idempotency, /unique index if not exists geo_observations_external_uidx/i);
  assert.match(idempotency, /org_id, source_key, external_id/i);
});

test('AIS support extends the existing Durable Object class without creating a second class', async () => {
  const source = await readFile(tenantAgentPath, 'utf8');
  const exportedClasses = [...source.matchAll(/export class\s+(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(exportedClasses, ['HereTenantAgent']);
  assert.match(source, /AISSTREAM_API_KEY/);
  assert.match(source, /wss?:\/\/stream\.aisstream\.io\/v0\/stream/);
  assert.match(source, /\/internal\/geo\/ais\/snapshot/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS ais_vessels/i);
  assert.doesNotMatch(source, /class\s+Geo/i);
});
