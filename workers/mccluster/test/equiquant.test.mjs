import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEquiquant } from '../src/equiquant.js';

const actor = '00000000-0000-4000-8000-000000000011';
const org = '00000000-0000-4000-8000-000000000022';
const project = '00000000-0000-4000-8000-000000000033';
const env = { SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture', EQUIQUANT_ENABLED: 'true' };

function action(body, authenticate = async () => ({ id: actor })) {
  const request = new Request('https://api.invalid/v1/equiquant', {
    method: 'POST', body: JSON.stringify({ org_id: org, project_id: project, ...body })
  });
  return handleEquiquant(request, env, authenticate);
}

test('refuses unverified sessions, malformed input, caller-supplied identity and non-allowlisted runs before persistence', async t => {
  const store = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected store call'); });
  assert.equal((await action({ action: 'state' }, async () => null)).status, 401);
  for (const invalid of [
    { action: 'replay', p_actor: actor }, { action: 'replay', data: { scenario: 'custom' } },
    { action: 'replay', data: { scenario: 'pooled', source: 'alternate' } },
    { action: 'evidence', data: { consent: false } }, { action: 'review', data: { confirmed: true } }
  ]) assert.equal((await action(invalid)).status, 400);
  assert.equal((await action({ action: 'state', payload: 'x'.repeat(16500) })).status, 413);
  assert.equal(store.mock.callCount(), 0);
});

test('exports only a frozen private release and keeps the source DOI attached to the data', async t => {
  let release = null;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith(env.SUPABASE_URL + '/rest/v1/org_members?')) {
      return Response.json([{ role: 'viewer', orgs: { id: org, enabled: true } }]);
    }
    assert.equal(url, env.SUPABASE_URL + '/rest/v1/rpc/equiquant_action');
    calls.push(JSON.parse(options.body));
    return Response.json({ release, evidence: [{ credit_name: 'Pending name' }] });
  });
  assert.equal((await action({ action: 'citation' })).status, 409);
  release = {
    id: project, title: 'Reviewed pilot', reviewed_at: '2026-11-27T19:00:00Z',
    credits: ['Formal analysis', 'Software'].map(role => ({ profile_id: actor, role, credit_name: 'Researcher A' })),
    run: { dataset_doi: '10.1594/PANGAEA.958449', source_commit: 'a'.repeat(40),
      observations_sha256: 'b'.repeat(64), result_sha256: 'c'.repeat(64), job_id: project, scenario: 'pooled' }
  };
  const response = await action({ action: 'citation' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const { citation, filename } = await response.json();
  assert.deepEqual(citation.author, [{ literal: 'Researcher A' }]);
  assert.equal(citation.DOI, undefined);
  assert.ok(citation.note.includes(release.run.dataset_doi));
  assert.ok(citation.note.includes(release.run.result_sha256));
  assert.ok(!JSON.stringify(citation).includes('Pending name'));
  assert.ok(filename.endsWith('.csl.json'));
  assert.deepEqual(calls[1], { p_actor: actor, p_org: org, p_project: project, p_action: 'state', p_data: {} });
});

test('unconfigured research route stays closed without workspace or RPC access', async t => {
  const store = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected store call'); });
  const request = new Request('https://api.invalid/v1/equiquant', { method: 'POST', body: '{}' });
  const response = await handleEquiquant(request, {}, async () => ({ id: actor }));
  assert.equal(response.status, 503);
  assert.equal(store.mock.callCount(), 0);
});
