import spatial from '../src/seek-first/index.js';
import { persistAdapterResult, listSourceRecords } from '../src/seek-first/store.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProvider } from '../src/seek-first/gateway.js';
import { sourceCatalog } from '../src/seek-first/source-registry.js';

const input = { series_id: 'LNS14000000', start_year: 2024, end_year: 2024 };
const fixture = () => ({ status: 'REQUEST_SUCCEEDED', message: [], Results: { series: [{ seriesID: input.series_id,
  data: [{ year: '2024', period: 'M07', value: '4.3' }, { year: '2024', period: 'M13', value: '-' }] }] } });
async function withFetch(handler, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

test('BLS catalog offers a keyless lane and lists the optional upgrade binding', () => {
  const bls = sourceCatalog({}).find(x => x.key === 'bls');
  assert.equal(bls.configured, true);
  assert.equal(bls.credential_required, false);
  assert.deepEqual(bls.optional_credential_bindings, ['BLS_API_KEY']);
});

test('canonical gateway requests v1 without a key, preserves periods, and labels limits', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://api.bls.gov/publicAPI/v1/timeseries/data/');
    assert.equal(init.redirect, 'manual');
    assert.ok(!('registrationkey' in JSON.parse(init.body)));
    const f = fixture(); f.Results = [f.Results];
    return Response.json(f);
  }, async () => {
    const r = await executeProvider('bls', input, {});
    assert.equal(r.access_mode, 'unregistered');
    assert.equal(r.daily_query_limit, 25);
    assert.equal(r.records[0].observed_at, '2024-07-01T00:00:00.000Z');
    assert.equal(r.records[0].properties.time_basis, 'period_start_not_release_time');
    assert.equal(r.records[1].observed_at, '2024-01-01T00:00:00.000Z');
    assert.equal(r.records[1].properties.period_kind, 'annual_average');
    assert.equal(r.records[1].value_number, null);
    assert.equal(r.raw, null);
  });
});

test('adding a key selects v2 and never returns the key', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://api.bls.gov/publicAPI/v2/timeseries/data/');
    assert.equal(JSON.parse(init.body).registrationkey, 'fixture-secret');
    return Response.json(fixture());
  }, async () => {
    const r = await executeProvider('bls', input, { BLS_API_KEY: 'fixture-secret' });
    assert.equal(r.access_mode, 'registered');
    assert.equal(r.daily_query_limit, 500);
    assert.ok(!JSON.stringify(r).includes('fixture-secret'));
  });
});

test('per-request limits reject oversized series and year ranges before network', async () => {
  await withFetch(() => { assert.fail('must not fetch'); }, async () => {
    for (const [request, env] of [
      [{ ...input, series_ids: [] }, {}],
      [{ ...input, series_ids: Array(26).fill(input.series_id) }, {}],
      [{ ...input, series_ids: Array(51).fill(input.series_id) }, { BLS_API_KEY: 'fixture' }],
      [{ ...input, start_year: 2014 }, {}],
      [{ ...input, start_year: 2004 }, { BLS_API_KEY: 'fixture' }],
      [{ ...input, start_year: 2024.5 }, {}],
      [{ ...input, series_id: 'not-a-valid-id' }, {}],
    ]) await assert.rejects(executeProvider('bls', request, env), e => e.code === 'invalid_parameter');
  });
});

test('HTTP 200 provider failures and partial responses are not successful empty data', async () => {
  const partial = fixture(); partial.Results.series = [];
  const warning = fixture(); warning.message = ['fixture-secret invalid series'];
  for (const body of [{ status: 'REQUEST_NOT_PROCESSED', message: ['fixture-secret'] }, partial, warning]) {
    await withFetch(async () => Response.json(body), async () => {
      await assert.rejects(executeProvider('bls', input, { BLS_API_KEY: 'fixture-secret' }), e => {
        assert.ok(!JSON.stringify(e).includes('fixture-secret'));
        assert.ok(!e.message.includes('fixture-secret'));
        return e.code === 'provider_response_error';
      });
    });
  }
});

test('rate limits, redirects, oversized bodies and network errors fail without raw provider data', async () => {
  for (const handler of [
    async () => new Response('fixture-secret', { status: 429 }),
    async () => new Response('fixture-secret', { status: 302, headers: { location: 'https://example.invalid' } }),
    async () => new Response('x'.repeat(2_100_000)),
    async () => { throw new Error('fixture-secret'); },
  ]) {
    await withFetch(handler, async () => {
      await assert.rejects(executeProvider('bls', input, {}), e => {
        assert.ok(!e.message.includes('fixture-secret'));
        assert.ok(!JSON.stringify(e).includes('fixture-secret'));
        return [429, 502].includes(e.status);
      });
    });
  }
});


test('default gateway persistence and archive preserve BLS period dates and missing values', async () => {
  const periods = ['M07', 'M13', 'A01', 'Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'S01', 'S02', 'S03'];
  const months = ['07', '01', '01', '01', '04', '07', '10', '01', '01', '07', '01'];
  let saved = [], authorized = 0;
  const env = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
  await withFetch(async (url, init = {}) => {
    if (String(url).startsWith('https://api.bls.gov/')) {
      const f = fixture();
      f.Results.series[0].data = periods.map((period, i) => ({ year: '2024', period, value: i === 1 ? '-' : '0' }));
      return Response.json(f);
    }
    const u = new URL(url), table = u.pathname.split('/').at(-1);
    if (table === 'orgs') return Response.json([{ id: 'org-fixture', slug: 'mccluster' }]);
    if (table === 'seek_first_source_entitlements') return Response.json([]);
    if (table === 'seek_first_sources') return Response.json([{ source_key: 'bls' }]);
    if (table === 'seek_first_ingestion_runs') return Response.json(init.method === 'POST' ? [{ id: 'run-fixture' }] : null);
    if (table === 'seek_first_observations' && init.method === 'POST') {
      saved = JSON.parse(init.body);
      // Mirror the existing NOT NULL timestamp contract at the DB boundary.
      assert.ok(saved.every(row => row.observed_at && Number.isFinite(Date.parse(row.observed_at))));
      return Response.json(saved);
    }
    if (table === 'seek_first_observations') return Response.json(saved);
    if (['seek_first_entities', 'seek_first_events'].includes(table)) return Response.json([]);
    assert.fail(`unexpected request: ${url}`);
  }, async () => {
    const response = await spatial.fetch(new Request('https://api.invalid/v1/seek-first/fetch/bls', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input)
    }), env, { requireHouseOwner: async () => { authorized++; return { id: 'owner-fixture' }; } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(authorized, 1);
    assert.equal(body.result.persistence.persisted, true);
    assert.equal(saved.length, periods.length);
    saved.forEach((row, i) => {
      assert.equal(row.observed_at, `2024-${months[i]}-01T00:00:00.000Z`);
      assert.equal(row.observed_at, body.result.records[i].observed_at);
      assert.notEqual(row.observed_at, row.provenance.fetched_at);
      assert.equal(row.payload.time_basis, 'period_start_not_release_time');
      assert.equal(row.payload.period, periods[i]);
    });
    assert.equal(saved[1].value_number, null);
    assert.equal(saved[1].value_text, null);
    assert.equal(saved[0].value_number, 0);
    const archive = await listSourceRecords(env, 'org-fixture', { source: 'bls' });
    assert.equal(archive[0].payload.period, 'Q04');
    assert.ok(archive.every(row => row.observed_at.startsWith('2024-')));
    await assert.rejects(persistAdapterResult(env, 'org-fixture', {
      source: 'bls', fetched_at: new Date().toISOString(), records: [{ kind: 'observation', observed_at: null }]
    }), error => error.code === 'invalid_observation_timestamp');
  });
});

test('unknown BLS periods fail before persistence rather than acquiring fetch timestamps', async () => {
  for (const period of ['M00', 'M14', 'Q00', 'Q06', 'S00', 'S04', 'A02']) {
    await withFetch(async () => {
      const f = fixture(); f.Results.series[0].data[0].period = period; return Response.json(f);
    }, async () => assert.rejects(executeProvider('bls', input, {}), error => error.code === 'provider_response_error'));
  }
});
