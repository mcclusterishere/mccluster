import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { handleActionArchive } from '../src/action-archive.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'server-only-secret' };
const authId = '11111111-1111-4111-8111-111111111111';
const mUid = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
const tokenHash = createHash('sha256').update(token).digest('hex');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const request = (path, body, signedIn = true, extra = {}) => new Request('https://api.mccluster.org/v1/action-archive' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(signedIn ? { authorization: 'Bearer valid-user-token' } : {}), 'content-type': 'application/json', ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

async function mockFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), options, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    return handler(call, calls);
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test('a signed-out claim never calls a privileged RPC', async () => {
  await mockFetch(() => { throw Error('unexpected database request'); }, async calls => {
    const result = await handleActionArchive(request('/claim', { token }, false), env);
    assert.equal(result.status, 401);
    assert.equal(calls.length, 0);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  });
});

test('claim validates the actual bearer and hashes the invitation before storage access', async () => {
  await mockFetch(call => {
    if (call.url.endsWith('/auth/v1/user')) {
      assert.equal(call.options.headers.authorization, 'Bearer valid-user-token');
      return json({ id: authId });
    }
    assert.equal(call.url, env.SUPABASE_URL + '/rest/v1/rpc/action_archive_claim');
    assert.deepEqual(call.body, { p_token_hash: tokenHash, p_auth_user_id: authId });
    assert.equal(call.options.headers.authorization, 'Bearer server-only-secret');
    assert.ok(!JSON.stringify(call.body).includes(token));
    return json({ project_slug: 'docket-516r-2025', participant_slug: 'ocho-great', m_uid: mUid });
  }, async calls => {
    const result = await handleActionArchive(request('/claim', { token }), env);
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.participant_slug, 'ocho-great');
    assert.match(data.profile_url, /cohort-profile\.html\?project=docket-516r-2025&person=ocho-great$/);
    assert.match(data.provider_url, /docket-516r-cohort\.html\?person=ocho-great$/);
    assert.equal(calls.length, 2);
    assert.ok(!JSON.stringify(data).includes(token));
  });
});

test('invalid auth and caller-supplied identity cannot bind a profile', async () => {
  await mockFetch(call => {
    assert.ok(call.url.endsWith('/auth/v1/user'));
    return json({ error: 'expired' }, 401);
  }, async calls => {
    const result = await handleActionArchive(request('/claim', { token }), env);
    assert.equal(result.status, 401);
    assert.equal(calls.length, 1);
  });
  await mockFetch(() => json({ id: authId }), async calls => {
    const result = await handleActionArchive(request('/claim', { token, p_auth_user_id: mUid }), env);
    assert.equal(result.status, 400);
    assert.equal(calls.length, 1);
  });
});

test('consumed/expired invitations return a safe conflict without DB internals', async () => {
  await mockFetch(call => call.url.endsWith('/auth/v1/user') ? json({ id: authId }) : json({ message: 'INVITATION_UNAVAILABLE', details: tokenHash }, 400), async () => {
    const result = await handleActionArchive(request('/claim', { token }), env);
    assert.equal(result.status, 409);
    const body = await result.text();
    assert.match(body, /expired/);
    assert.ok(!body.includes(tokenHash));
  });
});

test('invitation preview is read-only, token-scoped and uncacheable', async () => {
  await mockFetch(call => {
    assert.match(call.url, /rpc\/action_archive_invite_preview$/);
    assert.deepEqual(call.body, { p_token_hash: tokenHash });
    return json({ project_slug: 'docket-516r-2025', participant_slug: 'ocho-great', display_name: 'Ocho Great', project_title: 'Docket 516R' });
  }, async calls => {
    const result = await handleActionArchive(request('/invitation', { token }, false), env);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).display_name, 'Ocho Great');
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.equal(calls.length, 1);
  });
});

test('public archive uses the published-only read RPC and HEAD omits body', async () => {
  const archive = { project: { slug: 'docket-516r-2025' }, participants: [], works: [], event: null, media: [] };
  await mockFetch(call => {
    assert.deepEqual(call.body, { p_project_slug: 'docket-516r-2025' });
    assert.match(call.url, /rpc\/action_archive_get$/);
    return json(archive);
  }, async () => {
    const result = await handleActionArchive(request('/docket-516r-2025', undefined, false), env);
    assert.deepEqual(await result.json(), archive);
    const head = await handleActionArchive(new Request('https://api.mccluster.org/v1/action-archive/docket-516r-2025', { method: 'HEAD' }), env);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});

test('page edit rejects credit/attestation changes and unsafe website links', async () => {
  await mockFetch(() => json({ id: authId }), async calls => {
    const base = { project_slug: 'docket-516r-2025', headline: 'Producer', bio: 'Music', website_url: '' };
    for (const body of [{ ...base, owner_m_uid: mUid }, { ...base, credits: ['anything'] }, { ...base, attestation: 'verified' }, { ...base, website_url: 'javascript:alert(1)' }, { ...base, website_url: 'https://name:secret@example.com' }]) {
      const result = await handleActionArchive(request('/pages/ocho-great', body), env);
      assert.equal(result.status, 400);
    }
    assert.ok(calls.every(call => call.url.endsWith('/auth/v1/user')));
  });
});

test('page edit carries the verified account to the ownership-checked transaction', async () => {
  await mockFetch(call => {
    if (call.url.endsWith('/auth/v1/user')) return json({ id: authId });
    assert.match(call.url, /rpc\/action_archive_update_provider$/);
    assert.deepEqual(call.body, { p_project_slug: 'docket-516r-2025', p_participant_slug: 'ocho-great', p_auth_user_id: authId, p_headline: 'Artist', p_bio: 'New songs.', p_website_url: 'https://example.com' });
    return json({ title: 'Ocho Great', headline: 'Artist', bio: 'New songs.', website_url: 'https://example.com', publication_grant: 'organizer_cohort' });
  }, async () => {
    const result = await handleActionArchive(request('/pages/ocho-great', { project_slug: 'docket-516r-2025', headline: 'Artist', bio: 'New songs.', website_url: 'https://example.com' }), env);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).saved, true);
  });
});

test('private me result contains only the signed-in active primary identity', async () => {
  await mockFetch(call => {
    if (call.url.endsWith('/auth/v1/user')) return json({ id: authId });
    if (call.url.includes('/m_auth_user_links?')) {
      assert.match(call.url, /is_primary=eq\.true/);
      return json([{ m_uid: mUid }]);
    }
    if (call.url.includes('/m_people?')) return json([{ id: mUid }]);
    return json({ participants: [{ slug: 'ocho-great', owner_m_uid: mUid }, { slug: 'someone-else', owner_m_uid: authId }] });
  }, async () => {
    const result = await handleActionArchive(request('/me?project=docket-516r-2025'), env);
    const data = await result.json();
    assert.equal(data.participant.slug, 'ocho-great');
    assert.ok(!JSON.stringify(data).includes('someone-else'));
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  });
});

test('only house owner can generate invitations; target identity is never caller authority', async () => {
  await mockFetch(call => {
    if (call.url.endsWith('/auth/v1/user')) return json({ id: authId, user_metadata: { role: 'owner' } });
    if (call.url.includes('/orgs?')) return json([{ id: mUid }]);
    if (call.url.includes('/org_members?')) return json([]);
    throw Error('should not issue invite');
  }, async calls => {
    const result = await handleActionArchive(request('/invitations', { project_slug: 'docket-516r-2025', participant_slug: 'ocho-great' }), env);
    assert.equal(result.status, 403);
    assert.equal(calls.length, 3);
  });
});

test('owner invite response uses a fragment and stores only its hash', async () => {
  let storedHash;
  await mockFetch(call => {
    if (call.url.endsWith('/auth/v1/user')) return json({ id: authId });
    if (call.url.includes('/orgs?')) return json([{ id: mUid }]);
    if (call.url.includes('/org_members?')) return json([{ org_id: mUid }]);
    storedHash = call.body.p_token_hash;
    assert.match(storedHash, /^[a-f0-9]{64}$/);
    assert.ok(!('token' in call.body));
    return json({ project_slug: call.body.p_project_slug, participant_slug: call.body.p_participant_slug, expires_at: call.body.p_expires_at });
  }, async () => {
    const result = await handleActionArchive(request('/invitations', { project_slug: 'docket-516r-2025', participant_slug: 'ocho-great' }), env);
    assert.equal(result.status, 200);
    const invite = await result.json();
    const url = new URL(invite.invitation_url);
    assert.equal(url.search, '');
    const secret = new URLSearchParams(url.hash.slice(1)).get('invite');
    assert.equal(createHash('sha256').update(secret).digest('hex'), storedHash);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  });
});

test('origin, method, and route guards do not touch the database', async () => {
  await mockFetch(() => { throw Error('unexpected call'); }, async calls => {
    assert.equal(await handleActionArchive(new Request('https://api.mccluster.org/v1/unrelated'), env), null);
    assert.equal((await handleActionArchive(request('/claim'), env)).status, 405);
    assert.equal((await handleActionArchive(request('/docket-516r-2025', undefined, false, { origin: 'https://untrusted.example' }), env)).status, 403);
    assert.equal(calls.length, 0);
  });
});

test('chunked and multibyte public invitation bodies stop at 16KB before RPC', async () => {
  await mockFetch(() => { throw Error('oversized payload reached storage'); }, async calls => {
    let cancelled = false;
    const streamed = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(8192).fill(32)); },
      cancel() { cancelled = true; }
    });
    const chunked = new Request('https://api.mccluster.org/v1/action-archive/invitation', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: streamed, duplex: 'half'
    });
    assert.equal((await handleActionArchive(chunked, env)).status, 413);
    assert.equal(cancelled, true);
    const multibyte = request('/invitation', { token: 'é'.repeat(9000) }, false);
    assert.equal((await handleActionArchive(multibyte, env)).status, 413);
    assert.equal(calls.length, 0);
  });
});
