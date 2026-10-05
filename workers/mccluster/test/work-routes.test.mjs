/* /v1/work/* — Control's canonical write routes.

   What matters: the role gate per kind (staff run tasks, only an owner
   creates leads, companies, orders and bookings), every read and write is
   pinned to the caller's org, a request cannot set org_id or created_by,
   a linked id from another org is refused, task completion keeps
   completed_at honest, every write reaches the ledger, and a database
   without the migration answers 503 work_not_provisioned. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleWorkRequest } from '../src/work.js';

const USER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const HOUSE = '123e4567-e89b-42d3-a456-426614174000';
const OTHER = '223e4567-e89b-42d3-a456-426614174000';
const COMPANY = '523e4567-e89b-42d3-a456-426614174555';
const TASK = '623e4567-e89b-42d3-a456-426614174666';
const LEAD = '723e4567-e89b-42d3-a456-426614174777';

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

function backend({ role = 'owner', rows = {}, missingTables = false } = {}) {
  const calls = [];
  const handler = async (href, options = {}) => {
    href = String(href);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ href, method, body });
    if (href.includes('/rest/v1/org_members?') && href.includes('profile_id=eq.')) {
      const assignee = (href.match(/profile_id=eq\.([0-9a-f-]{36})/) || [])[1];
      return json(assignee === USER.id ? [{ profile_id: USER.id }] : []);
    }
    if (href.includes('/rest/v1/org_members')) {
      return json([{ role, added_at: '2026-01-01T00:00:00Z', orgs: { id: HOUSE, slug: 'mccluster', name: 'McCluster', kind: 'studio', enabled: true } }]);
    }
    if (href.includes('/rest/v1/control_audit')) return json([{ id: 1, at: '2026-10-05T00:00:00Z' }]);
    const table = href.split('/rest/v1/')[1].split('?')[0];
    if (missingTables && table.startsWith('work_')) {
      return json({ code: 'PGRST205', message: `Could not find the table 'public.${table}'` }, 404);
    }
    if (method === 'POST') return json([{ id: 'new-row', ...body }], 201);
    if (method === 'PATCH') {
      const existing = (rows[table] || [])[0] || {};
      return json([{ ...existing, ...body }]);
    }
    const id = (href.match(/[?&]id=eq\.([0-9a-f-]{36})/) || [])[1];
    const list = rows[table] || [];
    return json(id ? list.filter((r) => r.id === id) : list);
  };
  return { calls, handler };
}

test('a viewer may read Work but not create anything', async () => {
  const b = backend({ role: 'viewer', rows: { work_tasks: [{ id: TASK, org_id: HOUSE, title: 'Call Sam' }] } });
  await withFetch(b.handler, async () => {
    const list = call('GET', `/v1/work/tasks?org_id=${HOUSE}`);
    const out = await handleWorkRequest(list.request, env, USER, list.url);
    assert.equal(out.tasks.length, 1);
    assert.ok(b.calls.some((c) => c.href.includes(`work_tasks?org_id=eq.${HOUSE}`)), 'reads are pinned to the org');

    const create = call('POST', '/v1/work/tasks', { org_id: HOUSE, title: 'x' });
    await assert.rejects(handleWorkRequest(create.request, env, USER, create.url), { status: 403 });
  });
});

test('staff run tasks; orders, bookings, companies and leads are owner work', async () => {
  const b = backend({ role: 'staff' });
  await withFetch(b.handler, async () => {
    const task = call('POST', '/v1/work/tasks', { org_id: HOUSE, title: 'Send the proof' });
    const out = await handleWorkRequest(task.request, env, USER, task.url);
    assert.equal(out.task.title, 'Send the proof');
    for (const [path, body] of [
      ['/v1/work/orders', { title: 'Print run' }],
      ['/v1/work/bookings', { title: 'Shoot' }],
      ['/v1/work/companies', { name: 'Acme' }],
      ['/v1/work/leads', { name: 'Sam', email: 'sam@example.com' }]
    ]) {
      const c = call('POST', path, { org_id: HOUSE, ...body });
      await assert.rejects(handleWorkRequest(c.request, env, USER, c.url), { status: 403 }, path);
    }
  });
});

test('a request cannot set org_id, created_by or undeclared fields', async () => {
  const b = backend();
  await withFetch(b.handler, async () => {
    const outside = call('POST', '/v1/work/tasks', { org_id: OTHER, title: 'x' });
    await assert.rejects(handleWorkRequest(outside.request, env, USER, outside.url), { status: 403 }, 'not a member of that org');
    const c = call('POST', '/v1/work/tasks', { org_id: HOUSE, title: ' Call Sam ', created_by: 'someone', id: 'forged', completed_at: '2020-01-01', secret: 1 });
    await handleWorkRequest(c.request, env, USER, c.url);
    const inserts = b.calls.filter((x) => x.method === 'POST' && x.href.includes('work_tasks'));
    assert.equal(inserts.length, 1, 'only the member write reached the table');
    assert.deepEqual(inserts[0].body, { title: 'Call Sam', org_id: HOUSE, created_by: USER.id });
    assert.ok(b.calls.some((x) => x.href.includes('control_audit')), 'the write reaches the ledger');
  });
});

test('companies are the one out_companies table, in its own vocabulary', async () => {
  const b = backend();
  await withFetch(b.handler, async () => {
    const c = call('POST', '/v1/work/companies', { org_id: HOUSE, name: ' Acme ', domain: 'https://Acme.com/about', kind: 'brand', created_by: 'someone', source: 'import' });
    await handleWorkRequest(c.request, env, USER, c.url);
    const insert = b.calls.find((x) => x.method === 'POST' && x.href.includes('/rest/v1/out_companies'));
    assert.deepEqual(insert.body, { name: 'Acme', domain: 'acme.com', kind: 'brand', org_id: HOUSE, source: 'manual' });
    assert.ok(!b.calls.some((x) => x.href.includes('work_companies')), 'no second company table');
    const wrongKind = call('POST', '/v1/work/companies', { org_id: HOUSE, name: 'Acme', kind: 'startup' });
    await assert.rejects(handleWorkRequest(wrongKind.request, env, USER, wrongKind.url), { status: 400 });
  });
});

test('a company from another org cannot be linked', async () => {
  const b = backend({ rows: { out_companies: [{ id: COMPANY, org_id: OTHER }] } });
  await withFetch(b.handler, async () => {
    const c = call('POST', '/v1/work/orders', { org_id: HOUSE, title: 'Print run', company_id: COMPANY });
    await assert.rejects(handleWorkRequest(c.request, env, USER, c.url), /does not belong to this organization/);
    assert.ok(!b.calls.some((x) => x.method === 'POST' && x.href.includes('work_orders')));
  });
});


test('a task assignee must be a member of the selected organization', async () => {
  const b = backend();
  await withFetch(b.handler, async () => {
    const ok = call('POST', '/v1/work/tasks', { org_id: HOUSE, title: 'Owner task', assignee: USER.id });
    const created = await handleWorkRequest(ok.request, env, USER, ok.url);
    assert.equal(created.task.assignee, USER.id);

    const outsider = '823e4567-e89b-42d3-a456-426614174888';
    const bad = call('POST', '/v1/work/tasks', { org_id: HOUSE, title: 'Wrong tenant', assignee: outsider });
    await assert.rejects(handleWorkRequest(bad.request, env, USER, bad.url), /assignee does not belong to this organization/);
  });
});

test('legacy null-org leads are house-only, never a cross-tenant wildcard', async () => {
  const legacy = { id: LEAD, org_id: null, company_id: null };
  const house = backend({ role: 'owner', rows: { leads: [legacy] } });
  await withFetch(house.handler, async () => {
    const c = call('PATCH', `/v1/work/leads/${LEAD}`, { org_id: HOUSE, company_id: null });
    const out = await handleWorkRequest(c.request, env, USER, c.url);
    assert.equal(out.changed, true, 'house adoption normalizes the old lead even when company stays null');
    const patch = house.calls.find((x) => x.method === 'PATCH' && x.href.includes('/rest/v1/leads?'));
    assert.deepEqual(patch.body, { company_id: null, org_id: HOUSE });
  });

  const other = backend({ role: 'owner', rows: { leads: [legacy] } });
  const otherHandler = async (href, options = {}) => {
    if (String(href).includes('/rest/v1/org_members')) {
      return json([{ role: 'owner', added_at: '2026-01-01T00:00:00Z', orgs: { id: OTHER, slug: 'client-org', name: 'Client', kind: 'business', enabled: true } }]);
    }
    return other.handler(href, options);
  };
  await withFetch(otherHandler, async () => {
    const c = call('PATCH', `/v1/work/leads/${LEAD}`, { org_id: OTHER, company_id: null });
    await assert.rejects(handleWorkRequest(c.request, env, USER, c.url), { status: 404 });
  });
});


test('closing a task stamps completed_at; reopening clears it', async () => {
  const b = backend({ rows: { work_tasks: [{ id: TASK, org_id: HOUSE, title: 'Call Sam', state: 'open', completed_at: null, related_type: null, related_id: null }] } });
  await withFetch(b.handler, async () => {
    const done = call('PATCH', `/v1/work/tasks/${TASK}`, { org_id: HOUSE, state: 'done' });
    const out = await handleWorkRequest(done.request, env, USER, done.url);
    assert.equal(out.changed, true);
    const patch = b.calls.find((x) => x.method === 'PATCH');
    assert.equal(patch.body.state, 'done');
    assert.ok(patch.body.completed_at, 'done carries a completion time');
    assert.match(patch.href, new RegExp(`org_id=eq\\.${HOUSE}`), 'updates are pinned to the org');
  });
  const reopened = backend({ rows: { work_tasks: [{ id: TASK, org_id: HOUSE, title: 'Call Sam', state: 'done', completed_at: '2026-10-05T00:00:00Z', related_type: null, related_id: null }] } });
  await withFetch(reopened.handler, async () => {
    const c = call('PATCH', `/v1/work/tasks/${TASK}`, { org_id: HOUSE, state: 'open' });
    await handleWorkRequest(c.request, env, USER, c.url);
    assert.equal(reopened.calls.find((x) => x.method === 'PATCH').body.completed_at, null);
  });
});

test('a hand-made lead is attributed to Control, never to a campaign conversion', async () => {
  const b = backend();
  await withFetch(b.handler, async () => {
    const c = call('POST', '/v1/work/leads', { org_id: HOUSE, name: 'Sam', email: 'Sam@Example.com', want: 'Website', source: 'google', status: 'closed' });
    await handleWorkRequest(c.request, env, USER, c.url);
    const insert = b.calls.find((x) => x.method === 'POST' && x.href.includes('/rest/v1/leads'));
    assert.equal(insert.body.source, 'control');
    assert.equal(insert.body.medium, 'manual');
    assert.equal(insert.body.status, 'new');
    assert.equal(insert.body.email, 'sam@example.com');
    assert.equal(insert.body.org_id, HOUSE);
  });
});

test('invalid input is refused before the database', async () => {
  const b = backend();
  await withFetch(b.handler, async () => {
    for (const body of [
      { title: '' },
      { title: 'x', state: 'lost' },
      { title: 'x', due_at: 'tomorrowish' },
      { title: 'x', related_type: 'lead' }
    ]) {
      const c = call('POST', '/v1/work/tasks', { org_id: HOUSE, ...body });
      await assert.rejects(handleWorkRequest(c.request, env, USER, c.url), { status: 400 }, JSON.stringify(body));
    }
    const lead = call('POST', '/v1/work/leads', { org_id: HOUSE, name: 'Sam', note: 'No email supplied' });
    await assert.rejects(handleWorkRequest(lead.request, env, USER, lead.url), { status: 400 }, 'live leads.email is NOT NULL');
    const order = call('POST', '/v1/work/orders', { org_id: HOUSE, title: 'x', amount_cents: 12.5 });
    await assert.rejects(handleWorkRequest(order.request, env, USER, order.url), { status: 400 });
    assert.ok(!b.calls.some((x) => x.method === 'POST' && !x.href.includes('control_audit')));
  });
});

test('before the migration is applied the routes say so', async () => {
  const b = backend({ missingTables: true });
  await withFetch(b.handler, async () => {
    const c = call('GET', `/v1/work/tasks?org_id=${HOUSE}`);
    await assert.rejects(handleWorkRequest(c.request, env, USER, c.url), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.detail.code, 'work_not_provisioned');
      return true;
    });
  });
});

test('unknown kinds and shapes are not Work routes', async () => {
  for (const [method, path] of [['GET', '/v1/work/invoices'], ['DELETE', `/v1/work/tasks/${TASK}`], ['GET', `/v1/work/tasks/${TASK}/x`], ['GET', '/v1/work/leads']]) {
    const c = call(method, path);
    assert.equal(await handleWorkRequest(c.request, env, USER, c.url), null, `${method} ${path}`);
  }
});

test('a lead from another org cannot be relinked', async () => {
  const b = backend({ rows: { leads: [{ id: LEAD, org_id: OTHER, company_id: null }] } });
  await withFetch(b.handler, async () => {
    const c = call('PATCH', `/v1/work/leads/${LEAD}`, { org_id: HOUSE, company_id: null });
    await assert.rejects(handleWorkRequest(c.request, env, USER, c.url), { status: 404 });
  });
});
