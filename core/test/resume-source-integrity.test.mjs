import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Each case starts with explicitly healthy, empty sources. No inherited jobs.
const root = await mkdtemp(path.join(tmpdir(), 'resume-integrity-'));
const manifest = path.join(root, 'manifest.json');
const catalog = path.join(root, 'catalog.json');
process.env.SUPABASE_URL = 'https://resume.test';
process.env.SUPABASE_SECRET_KEY = 'test-only';
process.env.MCCLUSTER_DEPLOY_MANIFEST = manifest;
process.env.MCCLUSTER_CATALOG_PATH = catalog;
const { coreResume } = await import('../src/tools/resume.mjs');
const originalFetch = globalThis.fetch;
let responses;
beforeEach(async () => {
  responses = new Map();
  await writeFile(manifest, JSON.stringify({ commit_sha: 'a'.repeat(40) }));
  await writeFile(catalog, JSON.stringify({ catalogVersion: 'test', capabilities: [], bindings: [] }));
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const key = url.pathname.split('/').pop() + (url.searchParams.get('status') || '');
    return new Response(JSON.stringify(responses.has(key) ? responses.get(key) : []));
  };
});
after(async () => { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); });
const resume = () => coreResume({ orgId: '00000000-0000-4000-8000-000000000001' });

for (const value of [null, {}, 'not rows', [null], [42], [{}]]) {
  test(`recent jobs reject ${JSON.stringify(value)} without claiming zero failures`, async () => {
    responses.set('ops_agent_jobs', value);
    const result = await resume();
    assert.equal(result.sources.recent_jobs, 'invalid');
    assert.equal(result.work.recent_failures, null);
    assert.doesNotMatch(result.next_step_hint, /^No approvals pending/);
  });
  test(`objectives reject ${JSON.stringify(value)} without claiming an empty portfolio`, async () => {
    responses.set('ops_objectives', value);
    const result = await resume();
    assert.equal(result.sources.objectives, 'invalid');
    assert.equal(result.work.objectives, null);
  });
}

for (const value of [null, [], {}, { commit_sha: 'unknown' }, { commit_sha: 42 }]) {
  test(`parseable but invalid manifest ${JSON.stringify(value)} is not healthy`, async () => {
    await writeFile(manifest, JSON.stringify(value));
    const result = await resume();
    assert.equal(result.sources.runtime, 'invalid');
    assert.equal(result.runtime.core_commit, null);
  });
}
for (const value of [null, [], {}, { catalogVersion: 'v', capabilities: {}, bindings: [] }]) {
  test(`parseable but invalid catalog ${JSON.stringify(value)} is not healthy`, async () => {
    await writeFile(catalog, JSON.stringify(value));
    const result = await resume();
    assert.equal(result.sources.catalog, 'invalid');
    assert.equal(result.catalog.catalog_version, null);
  });
}
test('bad signal rows preserve the independently readable contract', async () => {
  responses.set('ops_signals', [null]);
  const result = await resume();
  assert.equal(result.sources.health, 'partial');
  assert.equal(result.health.sources.system_contract, 'ok');
  assert.equal(result.health.sources.signals, 'invalid');
  assert.equal(result.health.recent_signals, null);
});
test('bad approval rows degrade without rejecting the entire resume call', async () => {
  responses.set('control_approvals', [null]);
  const result = await resume();
  assert.equal(result.sources.approvals, 'invalid');
  assert.equal(result.pending_approvals, null);
  assert.match(result.next_step_hint, /^Approval state unavailable/);
});
test('known empty sources remain distinguishable from unavailable sources', async () => {
  const result = await resume();
  assert.deepEqual(result.degraded_sources, []);
  assert.deepEqual(result.work.recent_failures, []);
  assert.deepEqual(result.work.objectives, []);
  assert.match(result.next_step_hint, /^No approvals pending/);
});
