import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { integrationReadiness } from '../integration-readiness.mjs';

test('unconnected preflight preserves available keyless lanes without claiming live service', () => {
  const report = integrationReadiness();
  assert.equal(report.markets.configuration, 'needs_key');
  assert.deepEqual(report.markets.missing_bindings, ['FINNHUB_API_KEY']);
  assert.equal(report.travel.configuration, 'not_connected');
  assert.equal(report.weather.ingest_requested, false);
  assert.equal(report.sources.find(x => x.id === 'usgs').configuration, 'no_required_key');
  assert.equal(report.sources.find(x => x.id === 'cesium_ion').adapter_kind, 'configuration_only');
  assert.equal(report.sources.find(x => x.id === 'epa').adapter_kind, 'verified_gateway');
  assert.equal(report.sources.find(x => x.id === 'aisstream').adapter_kind, 'websocket_gateway');
  assert.ok(report.sources.every(x => x.runtime === 'not_checked'));
  assert.equal(report.live_verified, false);
});

test('present credentials are not live evidence and values never enter output', () => {
  const secret = 'SENSITIVE-fixture-never-output';
  const env = { FINNHUB_API_KEY: secret, TRAVEL_ROUTING_PROVIDER: 'tomtom', TRAVEL_TOMTOM_API_KEY: secret,
    OPENSKY_CLIENT_ID: secret, OPENSKY_CLIENT_SECRET: secret, WEATHER_INGEST_ENABLED: 'true', UNRELATED: secret };
  const before = structuredClone(env), report = integrationReadiness(env);
  assert.equal(report.markets.configuration, 'credentials_present_unverified');
  assert.equal(report.travel.configuration, 'configured_unverified');
  assert.equal(report.weather.ingest_requested, true);
  assert.equal(report.live_verified, false);
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.deepEqual(env, before);
});

test('partial and whitespace credentials stay unconnected; malformed selectors are never echoed', () => {
  const report = integrationReadiness({ MARKETS_PROVIDER: 'do-not-echo-this', OPENSKY_CLIENT_ID: 'fixture', OPENSKY_CLIENT_SECRET: '  ',
    TRAVEL_ROUTING_PROVIDER: 'tomtom', TRAVEL_TOMTOM_API_KEY: '\n', WEATHER_INGEST_ENABLED: 'TRUE', WORLD_GLOBE_WITHDRAWN: 'unknown' });
  assert.equal(report.markets.configuration, 'unknown_provider');
  assert.equal(report.markets.provider, null);
  assert.equal(report.travel.provider, null);
  assert.deepEqual(report.sources.find(x => x.id === 'opensky_research').missing_bindings, ['OPENSKY_CLIENT_SECRET']);
  assert.equal(report.weather.release, 'withdrawn');
  assert.equal(report.weather.ingest_requested, false);
  assert.ok(!JSON.stringify(report).includes('do-not-echo-this'));
});

test('keyless pilot needs explicit opt-in and alternate markets use their own binding', () => {
  assert.equal(integrationReadiness({ TRAVEL_ROUTING_PROVIDER: 'fossgis-pilot' }).travel.provider, null);
  assert.equal(integrationReadiness({ TRAVEL_ROUTING_PROVIDER: 'fossgis-pilot', TRAVEL_ROUTING_PILOT: 'noncommercial' }).travel.provider, 'fossgis-pilot');
  assert.deepEqual(integrationReadiness({ MARKETS_PROVIDER: 'eodhd', FINNHUB_API_KEY: 'fixture' }).markets.missing_bindings, ['EODHD_API_KEY']);
});

test('CLI empty mode ignores inherited credentials and rejects unknown arguments without echoing them', () => {
  const url = new URL('../integration-readiness.mjs', import.meta.url);
  const run = spawnSync(process.execPath, [url.pathname, '--empty'], { encoding: 'utf8', env: { ...process.env, FINNHUB_API_KEY: 'SENSITIVE-fixture' } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).markets.configuration, 'needs_key');
  assert.ok(!run.stdout.includes('SENSITIVE-fixture'));
  const bad = spawnSync(process.execPath, [url.pathname, 'SENSITIVE-fixture'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.ok(!(bad.stdout + bad.stderr).includes('SENSITIVE-fixture'));
});

test('readiness does not call fetch', () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden'); };
  try { assert.equal(integrationReadiness({ FINNHUB_API_KEY: 'fixture' }).network_requests, 0); }
  finally { globalThis.fetch = original; }
});


test('routing readiness exposes local monthly cap without claiming provider quota verification', () => {
  const report = integrationReadiness({ TRAVEL_ROUTING_PROVIDER: 'tomtom', TRAVEL_TOMTOM_API_KEY: 'fixture' });
  assert.deepEqual(report.travel.application_budget, { requests_per_utc_day: 1000, requests_per_utc_month: 20000, minimum_spacing_ms: 1100 });
  assert.equal(report.travel.runtime, 'not_checked');
  assert.match(report.travel.prerequisites.join(' '), /not provider billing totals/);
  assert.equal(integrationReadiness({ TRAVEL_ROUTING_PROVIDER: 'fossgis-pilot', TRAVEL_ROUTING_PILOT: 'noncommercial' }).travel.application_budget.requests_per_utc_month, null);
});
