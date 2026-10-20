// Public Equity Uprise intake finds an existing stakeholder / fellowship
// application by email and then overwrites it or echoes its id back. The
// lookup used `email=ilike.<input>`, so "*@*.*" matched somebody else's row.
// These tests pin the lookup to an exact, case-insensitive match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../supabase/functions/', import.meta.url);
const dir = await mkdtemp(join(tmpdir(), 'eu-intake-email-'));

let handler;
const calls = [];
globalThis.Deno = {
  env: { get: name => ({
    SUPABASE_URL: 'https://local.test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-secret',
    EU_INTAKE_UNPROTECTED: 'true',
  })[name] },
  serve: fn => { handler = fn; },
};

const shared = stripTypeScriptTypes(await readFile(new URL('_shared/eu-policy-os.ts', root), 'utf8'), { mode: 'strip' });
const sharedPath = join(dir, 'eu-policy-os.mjs');
await writeFile(sharedPath, shared);
const intake = stripTypeScriptTypes(await readFile(new URL('eu-intake/index.ts', root), 'utf8'), { mode: 'strip' })
  .replace('"../_shared/eu-policy-os.ts"', JSON.stringify(pathToFileURL(sharedPath).href));
const intakePath = join(dir, 'eu-intake.mjs');
await writeFile(intakePath, intake);

const policy = await import(pathToFileURL(sharedPath).href);
const realWarn = console.warn;
console.warn = () => {};
await import(pathToFileURL(intakePath).href);

const ok = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  calls.push({ href, method: init.method || 'GET' });
  if (href.includes('/rest/v1/orgs?')) return ok([{ id: 'org-1', slug: 'mccluster', name: 'McCluster' }]);
  if (href.includes('/rest/v1/eu_stakeholders?')) return ok([]);
  if (href.endsWith('/rest/v1/eu_stakeholders')) return ok([{ id: 'new-stakeholder' }]);
  if (href.includes('/rest/v1/eu_fellowship_applications?')) return ok([]);
  if (href.endsWith('/rest/v1/eu_fellowship_applications')) return ok([{ id: 'new-app', stage: 'submitted' }]);
  if (href.endsWith('/rest/v1/eu_events')) return ok([{ id: 1 }]);
  throw new Error('Unexpected egress: ' + href);
};

async function post(body) {
  calls.length = 0;
  const realError = console.error;
  console.error = () => {};
  try {
    const res = await handler(new Request('https://local.test/functions/v1/eu-intake', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  } finally { console.error = realError; }
}

test.after(() => { console.warn = realWarn; });

test('safeEmail refuses LIKE wildcards and the escape character', () => {
  for (const bad of ['*@*.*', '%@%.%', 'a%b@x.org', 'a\\_b@x.org', 'A*@X.ORG']) {
    assert.equal(policy.safeEmail(bad), '', bad);
  }
  assert.equal(policy.safeEmail(' Person_One@Example.ORG '), 'person_one@example.org');
});

test('ilikeExact escapes underscore and refuses wildcards', () => {
  assert.equal(policy.ilikeExact('a_b@x.org'), 'ilike.' + encodeURIComponent('a\\_b@x.org'));
  assert.equal(policy.ilikeExact('a_b@x.org'), 'ilike.a%5C_b%40x.org');
  assert.equal(policy.ilikeExact('*@*.*'), '');
  assert.equal(policy.ilikeExact('%'), '');
  assert.equal(policy.ilikeExact('a\\b'), '');
  assert.equal(policy.ilikeExact(''), '');
});

test('a wildcard email is rejected before any stakeholder or application lookup', async () => {
  for (const email of ['*@*.*', '%@%.%']) {
    const r = await post({ action: 'fellowship', name: 'Mallory', email });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /valid email/);
    assert.equal(calls.some(c => c.href.includes('eu_stakeholders') || c.href.includes('eu_fellowship_applications')), false);
  }
});

test('fellowship lookups match the submitted email exactly', async () => {
  const r = await post({ action: 'fellowship', name: 'Pat', email: 'Pat_Lee@Example.org' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lookups = calls.filter(c => c.method === 'GET' && /eu_(stakeholders|fellowship_applications)\?/.test(c.href));
  assert.equal(lookups.length, 2);
  for (const c of lookups) {
    assert.match(c.href, /email=ilike\.pat%5C_lee%40example\.org&/);
    assert.doesNotMatch(c.href, /\*/);
  }
});
