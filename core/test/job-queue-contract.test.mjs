import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('runner owns lead_rescore and executor uses the canonical scoring RPC', async () => {
  const runner = await readFile(new URL('../src/runner.mjs', import.meta.url), 'utf8');
  const executor = await readFile(new URL('../src/executors/lead-rescore.mjs', import.meta.url), 'utf8');
  assert.match(runner, /\['lead_rescore', leadRescore\]/);
  assert.match(executor, /rpc\/ops_recompute_lead_scores/);
  assert.match(executor, /ops_lead_scores/);
});

test('unsupported queued jobs are quarantined instead of silently living forever', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://queue-contract.test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, init });
    if (href.includes('/rest/v1/orgs?')) {
      return new Response(JSON.stringify([{ id: '123e4567-e89b-42d3-a456-426614174000', enabled: true }]), { status: 200 });
    }
    if ((init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify([
        { id: 'legacy-1', org_id: '123e4567-e89b-42d3-a456-426614174000', job_type: 'legacy_job', created_at: '2026-09-01T00:00:00Z' },
        { id: 'known-1', org_id: '123e4567-e89b-42d3-a456-426614174000', job_type: 'lead_rescore', created_at: '2026-09-01T00:00:00Z' },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const patch = JSON.parse(init.body);
    return new Response(JSON.stringify([{ id: 'legacy-1', ...patch }]), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const module = await import(`../src/supabase.mjs?queue-contract=${Date.now()}`);
    const count = await module.quarantineUnsupportedJobs(['lead_rescore'], {
      now: new Date('2026-09-19T04:00:00Z')
    });
    assert.equal(count, 1);
    const patches = calls.filter((call) => (call.init.method || 'GET') === 'PATCH');
    assert.equal(patches.length, 1);
    const body = JSON.parse(patches[0].init.body);
    assert.equal(new URL(patches[0].href).searchParams.get('org_id'), 'eq.123e4567-e89b-42d3-a456-426614174000');
    assert.equal(body.status, 'failed');
    assert.match(body.last_error, /Unsupported job type quarantined by Core: legacy_job/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
});
