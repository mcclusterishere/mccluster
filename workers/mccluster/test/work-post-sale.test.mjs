/* The post-sale business graph behind Control · Work: relationships, service
   projects, deliverables, renewals and the owner payment ledger, plus the
   read-only contacts list and one client's history.

   What matters: everything links to the canonical company / person / order
   rather than copying it, every link must belong to the caller's org,
   commercial records are owner work (payments are owner-read too), approval
   and payment bookkeeping is stamped server side, a request can never mark
   a payment provider-verified, and a missing table names the post-sale
   migration. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleWorkRequest } from '../src/work.js';

const USER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const HOUSE = '123e4567-e89b-42d3-a456-426614174000';
const OTHER = '223e4567-e89b-42d3-a456-426614174000';
const COMPANY = '523e4567-e89b-42d3-a456-426614174555';
const FOREIGN_COMPANY = '533e4567-e89b-42d3-a456-426614174555';
const PROJECT = '823e4567-e89b-42d3-a456-426614174888';
const DELIVERABLE = '923e4567-e89b-42d3-a456-426614174999';
const RELATIONSHIP = 'a23e4567-e89b-42d3-a456-426614174aaa';
const PAYMENT = 'b23e4567-e89b-42d3-a456-426614174bbb';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

function call(method, path, body) {
  const url = new URL(`https://api.mccluster.org${path}`);
  const init = { method, headers: { 'content-type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return { request: new Request(url, init), url };
}

const ROWS = {
  out_companies: [
    { id: COMPANY, org_id: HOUSE, name: 'Acme Studio', domain: 'acme.example', created_at: '2026-09-01T00:00:00Z' },
    { id: FOREIGN_COMPANY, org_id: OTHER, name: 'Elsewhere' }
  ],
  work_relationships: [{ id: RELATIONSHIP, org_id: HOUSE, title: 'Acme · client', company_id: COMPANY, state: 'active', created_at: '2026-09-02T00:00:00Z' }],
  work_projects: [{ id: PROJECT, org_id: HOUSE, title: 'Site rebuild', company_id: COMPANY, relationship_id: RELATIONSHIP, state: 'active', created_at: '2026-09-03T00:00:00Z' }],
  work_deliverables: [{ id: DELIVERABLE, org_id: HOUSE, project_id: PROJECT, title: 'Launch handoff', state: 'delivered', approval_state: 'pending', approved_at: null, delivered_at: '2026-09-20T00:00:00Z', created_at: '2026-09-04T00:00:00Z' }],
  work_renewals: [{ id: 'c23e4567-e89b-42d3-a456-426614174ccc', org_id: HOUSE, title: 'Annual hosting', company_id: COMPANY, state: 'upcoming', renews_at: '2027-09-01T00:00:00Z', created_at: '2026-09-05T00:00:00Z' }],
  work_payments: [
    { id: PAYMENT, org_id: HOUSE, title: 'Deposit', company_id: COMPANY, project_id: PROJECT, state: 'paid', amount_cents: 150000, verification: 'owner_recorded', paid_at: '2026-09-06T00:00:00Z', created_at: '2026-09-06T00:00:00Z' },
    { id: 'd23e4567-e89b-42d3-a456-426614174ddd', org_id: HOUSE, title: 'Balance', company_id: COMPANY, state: 'due', amount_cents: 350000, verification: 'owner_recorded', due_at: '2026-10-30T00:00:00Z', created_at: '2026-09-07T00:00:00Z' }
  ]
};

function backend({ role = 'owner', missingTables = false } = {}) {
  const calls = [];
  const handler = async (href, options = {}) => {
    href = String(href);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ href, method, body });
    if (href.includes('/rest/v1/org_members?org_id=eq.')) {
      const who = (href.match(/profile_id=eq\.([0-9a-f-]{36})/) || [])[1];
      return json(who === USER.id ? [{ profile_id: USER.id }] : []);
    }
    if (href.includes('/rest/v1/org_members')) {
      return json([{ role, added_at: '2026-01-01T00:00:00Z', orgs: { id: HOUSE, slug: 'mccluster', name: 'McCluster', kind: 'studio', enabled: true } }]);
    }
    if (href.includes('/rest/v1/control_audit') && method === 'POST') return json([{ id: 1, at: '2026-10-05T00:00:00Z' }]);
    if (href.includes('/rest/v1/control_audit')) return json([{ id: 9, event: 'payment.created', resource_type: 'payment', resource_id: PAYMENT, at: '2026-09-06T00:00:01Z' }]);
    const table = href.split('/rest/v1/')[1].split('?')[0];
    if (missingTables && ['work_relationships', 'work_projects', 'work_deliverables', 'work_renewals', 'work_payments'].includes(table)) {
      return json({ code: 'PGRST205', message: `Could not find the table 'public.${table}'` }, 404);
    }
    if (method === 'POST') return json([{ id: 'new-row', ...body }], 201);
    const orgFilter = (href.match(/[?&]org_id=eq\.([0-9a-f-]{36})/) || [])[1];
    const list = (ROWS[table] || []).filter((r) => !orgFilter || r.org_id === orgFilter);
    const id = (href.match(/[?&]id=eq\.([0-9a-f-]{36})/) || [])[1];
    if (method === 'PATCH') return json([{ ...(list.find((r) => r.id === id) || {}), ...body }]);
    return json(id ? list.filter((r) => r.id === id) : list);
  };
  return {
    calls,
    handler,
    writes(table) { return calls.filter((c) => c.method !== 'GET' && c.href.includes(`/rest/v1/${table}`)); }
  };
}

const run = (b, method, path, body) => withFetch(b.handler, () => {
  const c = call(method, path, body);
  return handleWorkRequest(c.request, env, USER, c.url);
});

test('every post-sale kind is a real, org-pinned Work route', async () => {
  const b = backend();
  for (const kind of ['relationships', 'projects', 'deliverables', 'renewals', 'payments']) {
    const out = await run(b, 'GET', `/v1/work/${kind}?org_id=${HOUSE}`);
    assert.ok(Array.isArray(out[kind]), kind);
    assert.ok(b.calls.some((c) => c.href.includes(`work_${kind}?org_id=eq.${HOUSE}`)), `${kind} reads are pinned to the org`);
  }
});

test('a relationship links to a canonical party; it cannot be free-floating or point at another tenant', async () => {
  const b = backend();
  await assert.rejects(run(b, 'POST', '/v1/work/relationships', { org_id: HOUSE, title: 'Nobody' }), /needs a company, contact or lead/);
  await assert.rejects(run(b, 'POST', '/v1/work/relationships', { org_id: HOUSE, title: 'Elsewhere', company_id: FOREIGN_COMPANY }), /company_id does not belong to this organization/);
  assert.equal(b.writes('work_relationships').length, 0, 'nothing was written');
  const out = await run(b, 'POST', '/v1/work/relationships', { org_id: HOUSE, title: 'Acme · client', company_id: COMPANY, relationship_type: 'client', org_id_override: OTHER });
  assert.equal(out.relationship.company_id, COMPANY);
  assert.equal(out.relationship.org_id, HOUSE);
  assert.equal(out.relationship.created_by, USER.id);
});

test('commercial records are owner work, and payments are owner-read too', async () => {
  const staff = backend({ role: 'staff' });
  for (const [kind, body] of [
    ['relationships', { title: 'x', company_id: COMPANY }],
    ['projects', { title: 'x' }],
    ['deliverables', { title: 'x', project_id: PROJECT }],
    ['renewals', { title: 'x' }],
    ['payments', { title: 'x', amount_cents: 1 }]
  ]) {
    await assert.rejects(run(staff, 'POST', `/v1/work/${kind}`, { org_id: HOUSE, ...body }), { status: 403 }, kind);
  }
  await assert.rejects(run(staff, 'GET', `/v1/work/payments?org_id=${HOUSE}`), { status: 403 });
  const projects = await run(staff, 'GET', `/v1/work/projects?org_id=${HOUSE}`);
  assert.ok(Array.isArray(projects.projects), 'staff may still read the delivery side');
});

test('a request can never mark a payment provider-verified; paid stamps paid_at', async () => {
  const b = backend();
  const out = await run(b, 'POST', '/v1/work/payments', {
    org_id: HOUSE, title: 'Balance', amount_cents: 350000, state: 'paid', provider: 'stripe',
    provider_reference: 'pi_123', verification: 'provider_verified', project_id: PROJECT
  });
  const [write] = b.writes('work_payments');
  assert.equal(Object.prototype.hasOwnProperty.call(write.body, 'verification'), false, 'verification is not a request field');
  assert.ok(write.body.paid_at, 'paid_at stamped');
  assert.equal(out.payment.provider_reference, 'pi_123');
  await assert.rejects(run(b, 'POST', '/v1/work/payments', { org_id: HOUSE, title: 'No amount' }), /amount_cents is required/);
});

test('deliverable approval is stamped with who and when, and cleared when it is withdrawn', async () => {
  const b = backend();
  await run(b, 'PATCH', `/v1/work/deliverables/${DELIVERABLE}`, { org_id: HOUSE, approval_state: 'approved' });
  let [patch] = b.writes('work_deliverables');
  assert.equal(patch.body.approval_state, 'approved');
  assert.ok(patch.body.approved_at);
  assert.equal(patch.body.approved_by, USER.id);

  const again = backend();
  await run(again, 'PATCH', `/v1/work/deliverables/${DELIVERABLE}`, { org_id: HOUSE, approval_state: 'changes_requested' });
  [patch] = again.writes('work_deliverables');
  assert.equal(patch.body.approved_at, null);
  assert.equal(patch.body.approved_by, null);
  await assert.rejects(run(again, 'POST', '/v1/work/deliverables', { org_id: HOUSE, title: 'Orphan' }), /project_id is required/);
  await assert.rejects(run(again, 'POST', '/v1/work/deliverables', { org_id: HOUSE, title: 'x', project_id: PROJECT, artifact_url: 'http://insecure.example' }), /https URL/);
});

test('a renewal names its source as a pair, and renewing stamps last_renewed_at', async () => {
  const b = backend();
  await assert.rejects(run(b, 'POST', '/v1/work/renewals', { org_id: HOUSE, title: 'Hosting', source_table: 'site_accounts' }), /go together/);
  await run(b, 'POST', '/v1/work/renewals', { org_id: HOUSE, title: 'Hosting', state: 'renewed', company_id: COMPANY });
  assert.ok(b.writes('work_renewals')[0].body.last_renewed_at);
});

test('a task can be about any Work record of the same org', async () => {
  const b = backend({ role: 'staff' });
  const out = await run(b, 'POST', '/v1/work/tasks', { org_id: HOUSE, title: 'Kickoff call', related_type: 'project', related_id: PROJECT });
  assert.equal(out.task.related_type, 'project');
  assert.ok(b.calls.some((c) => c.href.includes(`work_projects?id=eq.${PROJECT}`)), 'the project is checked against the org');
});

test('client history reads one company graph from the canonical tables as a timeline', async () => {
  const b = backend();
  const out = await run(b, 'GET', `/v1/work/history?org_id=${HOUSE}&company_id=${COMPANY}`);
  assert.equal(out.company.name, 'Acme Studio');
  assert.equal(out.records.projects.length, 1);
  assert.equal(out.records.deliverables.length, 1);
  assert.equal(out.totals.paid_cents, 150000);
  assert.equal(out.totals.billed_cents, 500000);
  assert.equal(out.totals.provider_verified_cents, 0, 'owner-recorded money is not presented as verified');
  assert.equal(out.totals.open_deliverables, 1);
  assert.equal(out.totals.next_renewal_at, '2027-09-01T00:00:00Z');
  assert.ok(out.timeline.some((e) => e.kind === 'audit'), 'the audit trail is in the timeline');
  for (const c of b.calls.filter((x) => x.method === 'GET' && /work_|out_companies|leads\?|control_audit/.test(x.href))) {
    assert.match(c.href, new RegExp(`org_id=eq\\.${HOUSE}`), `every read is org-pinned: ${c.href}`);
  }
  assert.equal(b.calls.filter((c) => c.method !== 'GET').length, 0, 'history only reads');
  await assert.rejects(run(b, 'GET', `/v1/work/history?org_id=${HOUSE}&company_id=${FOREIGN_COMPANY}`), { status: 404 });
  await assert.rejects(run(b, 'GET', `/v1/work/history?org_id=${HOUSE}`), /is required/);
  await assert.rejects(run(backend({ role: 'staff' }), 'GET', `/v1/work/history?org_id=${HOUSE}&company_id=${COMPANY}`), { status: 403 });
});

test('contacts are a read-only, owner-only view of out_contacts', async () => {
  const b = backend();
  const out = await run(b, 'GET', `/v1/work/contacts?org_id=${HOUSE}&company_id=${COMPANY}`);
  assert.ok(Array.isArray(out.contacts));
  const read = b.calls.find((c) => c.href.includes('/rest/v1/out_contacts'));
  assert.match(read.href, new RegExp(`org_id=eq\\.${HOUSE}`));
  assert.match(read.href, new RegExp(`company_id=eq\\.${COMPANY}`));
  assert.equal(await run(b, 'POST', '/v1/work/contacts', { org_id: HOUSE }), null, 'no write route');
  await assert.rejects(run(backend({ role: 'staff' }), 'GET', `/v1/work/contacts?org_id=${HOUSE}`), { status: 403 });
});

test('a database without the post-sale tables answers work_not_provisioned and names that migration', async () => {
  const b = backend({ missingTables: true });
  await assert.rejects(run(b, 'GET', `/v1/work/projects?org_id=${HOUSE}`), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.detail.code, 'work_not_provisioned');
    assert.match(error.detail.migration, /control_post_sale_work_v1/);
    return true;
  });
});
