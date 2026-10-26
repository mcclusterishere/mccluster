/* fail() renders a thrown error's `detail` to whoever asked, signed in or
   not. A raw PostgREST error body (table, column, constraint, sometimes row
   values) must not reach the caller; details a handler shapes on purpose
   must. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fail, isPostgrestError } from '../src/lib/http.js';

const request = new Request('https://api.mccluster.org/v1/inquiries', { headers: { origin: 'https://matthew.mccluster.org' } });
const env = {};

test('a raw PostgREST error is reduced to its code', async () => {
  const raw = {
    code: '23505',
    details: 'Key (email)=(someone@example.test) already exists.',
    hint: null,
    message: 'duplicate key value violates unique constraint "leads_email_key"'
  };
  const original = console.log;
  const logged = [];
  console.log = (line) => logged.push(line);
  try {
    const res = fail(request, env, 'McCluster database request failed', 409, raw);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.deepEqual(body, { error: 'McCluster database request failed', detail: { code: '23505' } });
    assert.doesNotMatch(JSON.stringify(body), /someone@example\.test|leads_email_key/);
  } finally {
    console.log = original;
  }
  assert.ok(logged.some((line) => line.includes('error_detail_redacted') && line.includes('23505')));
  assert.ok(logged.every((line) => !line.includes('leads_email_key') && !line.includes('someone@example.test')), 'logs retain codes, not sensitive rows');
});

test('details shaped on purpose pass through unchanged', async () => {
  for (const detail of [
    { code: 'work_not_provisioned' },
    { code: 'stale_timestamp', message: 'signature too old' },
    { retry_after: 30 },
    { max_monthly_limit_cents: 2500, monthly_limit_cents: 9000 },
    'plain text',
    undefined
  ]) {
    assert.equal(isPostgrestError(detail), false);
    const body = await fail(request, env, 'x', 400, detail).json();
    assert.deepEqual(body.detail, detail);
  }
});
