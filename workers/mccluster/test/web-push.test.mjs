/* WEB PUSH (owner, 2026-10-20). The payload a browser receives decrypts with that browser's own keys (RFC 8291), the
   token verifies with the public VAPID key (RFC 8292), the Worker only posts to browser push services, the routes are
   off until the flag and keys are set, and the cron claims each alert once, sends at most one push per person per
   15 minutes, and forgets subscriptions the push service says are gone. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, vapidAuthorization, validSubscription, runPushCycle, alertUrl, pushEnabled, b64url, unb64url } from '../src/web-push.js';
import { handlePlatformApi } from '../src/platform-api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const enc = new TextEncoder();

async function keyPair(usage) {
  const pair = await crypto.subtle.generateKey(usage === 'sign' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'ECDH', namedCurve: 'P-256' }, true, usage === 'sign' ? ['sign', 'verify'] : ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { pair, pub: b64url(raw), d: jwk.d };
}
async function hkdf(salt, ikm, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}
/* the browser's side of RFC 8291, written independently of the sender */
async function decrypt(body, browser, authSecret) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20], asPublic = body.slice(21, 21 + idlen), sealed = body.slice(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, browser.pair.privateKey, 256));
  const uaPublic = unb64url(browser.pub);
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, shared, info, 256);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return new TextDecoder().decode(plain.slice(0, -1));
}

test('a payload decrypts with the browser keys it was sent to, and not with others', async () => {
  const browser = await keyPair('ecdh'), auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload('{"title":"Ada","body":"commented on your post"}', browser.pub, b64url(auth));
  assert.equal(await decrypt(body, browser, auth), '{"title":"Ada","body":"commented on your post"}');
  const stranger = await keyPair('ecdh');
  await assert.rejects(decrypt(body, stranger, auth));
  await assert.rejects(decrypt(body, browser, crypto.getRandomValues(new Uint8Array(16))));
});

test('the VAPID token names the push service origin, expires within a day, and verifies with the public key', async () => {
  const vapid = await keyPair('sign');
  const env = { WEB_PUSH_VAPID_PUBLIC_KEY: vapid.pub, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.d, WEB_PUSH_CONTACT: 'mailto:alerts@mccluster.org' };
  const now = Date.UTC(2026, 9, 20, 15);
  const header = await vapidAuthorization(env, 'https://fcm.googleapis.com/fcm/send/abc', now);
  const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m); assert.equal(m[4], vapid.pub);
  const claims = JSON.parse(new TextDecoder().decode(unb64url(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.sub, 'mailto:alerts@mccluster.org');
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.pair.publicKey, unb64url(m[3]), enc.encode(m[1] + '.' + m[2]));
  assert.equal(ok, true);
});

test('only a browser push service with real keys is accepted as a subscription', async () => {
  const browser = await keyPair('ecdh'), auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const keys = { p256dh: browser.pub, auth };
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q', 'https://wns2-by3p.notify.windows.com/w/?token=x'])
    assert.ok(validSubscription({ endpoint, keys }), endpoint);
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'https://169.254.169.254/latest'])
    assert.equal(validSubscription({ endpoint, keys }), null, endpoint);
  assert.equal(validSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'short', auth } }), null);
  assert.equal(validSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: browser.pub, auth: 'AAAA' } }), null);
});

test('a tap opens the place the bell would, and never anywhere else', () => {
  const P = '33333333-3333-4333-8333-333333333333';
  assert.equal(alertUrl({ type: 'comment', metadata: { post_id: P } }), `/mnet.html?view=feed&post=${P}&comments=1`);
  assert.equal(alertUrl({ type: 'reply', metadata: { parent_post_id: P } }), `/mnet.html?view=feed&post=${P}`);
  assert.equal(alertUrl({ type: 'action_proof_review', metadata: { mission_id: P } }), `/mnet.html?mission=${P}`);
  assert.equal(alertUrl({ type: 'comment', metadata: { post_id: 'https://evil.example' } }), '/mnet.html?view=notifications');
  assert.equal(alertUrl({ type: 'follow' }), '/mnet.html?view=notifications');
});

const MUID = '11111111-1111-4111-8111-111111111111';
function apiFake(calls, extra = () => null) {
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url)), m = init.method || 'GET';
    calls.push({ u, m, body: init.body ? JSON.parse(init.body) : null });
    const ok = (d, status = 200) => new Response(JSON.stringify(d), { status });
    const hit = extra(u, m); if (hit) return hit;
    if (u.endsWith('/auth/v1/user')) return ok({ id: 'user-1' });
    if (u.includes('/m_auth_user_links')) return ok([{ m_uid: MUID }]);
    if (u.includes('/network_push_subscriptions?m_uid=eq.') && m === 'GET') return ok([]);
    return ok(null, m === 'POST' ? 201 : 200);
  };
}
const call = (env, path, method = 'GET', body) => handlePlatformApi(new Request('https://api.test' + path, {
  method, headers: { authorization: 'Bearer t', origin: 'https://mccluster.org', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
}), { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', ...env });

test('the routes stay off until the flag and both keys are set', async () => {
  const vapid = await keyPair('sign'), calls = []; apiFake(calls);
  assert.equal(pushEnabled({ WEB_PUSH_ENABLED: 'true' }), false);
  assert.equal(pushEnabled({ WEB_PUSH_ENABLED: 'false', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.pub, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.d }), false);
  let res = await call({}, '/v1/mnet/push');
  assert.deepEqual(await res.json(), { enabled: false });
  res = await call({}, '/v1/mnet/push/subscriptions', 'POST', { endpoint: 'https://fcm.googleapis.com/x' });
  assert.equal(res.status, 404);
  assert.equal(calls.some((c) => c.u.includes('network_push_subscriptions')), false);
  res = await call({ WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.pub, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.d }, '/v1/mnet/push');
  assert.deepEqual(await res.json(), { enabled: true, key: vapid.pub, subscribed: false });
});

test('a browser counts as on only when its subscription belongs to the member signed in now', async () => {
  const vapid = await keyPair('sign'), calls = [];
  const env = { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.pub, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.d };
  const MINE = 'https://fcm.googleapis.com/fcm/send/mine';
  apiFake(calls, (u, m) => u.includes('/network_push_subscriptions?m_uid=eq.') && m === 'GET'
    ? new Response(JSON.stringify(u.includes('endpoint=eq.' + MINE) ? [{ id: 's1' }] : [])) : null);
  let res = await call(env, '/v1/mnet/push?endpoint=' + encodeURIComponent(MINE));
  assert.equal((await res.json()).subscribed, true);
  res = await call(env, '/v1/mnet/push?endpoint=' + encodeURIComponent('https://fcm.googleapis.com/fcm/send/someone-elses'));
  assert.equal((await res.json()).subscribed, false);
  const lookup = calls.filter((c) => c.u.includes('/network_push_subscriptions?m_uid=eq.'));
  assert.ok(lookup.every((c) => c.u.includes('m_uid=eq.' + MUID)), 'only the signed-in member\'s rows are consulted');
});

test('a member saves one subscription per browser, a bad one is refused, and turning off deletes only their own', async () => {
  const vapid = await keyPair('sign'), browser = await keyPair('ecdh'), calls = []; apiFake(calls);
  const env = { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.pub, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.d };
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: browser.pub, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
  assert.equal((await call(env, '/v1/mnet/push/subscriptions', 'POST', { ...sub, endpoint: 'https://evil.example/x' })).status, 400);
  assert.equal((await call(env, '/v1/mnet/push/subscriptions', 'POST', sub)).status, 201);
  const saved = calls.find((c) => c.u.includes('/network_push_subscriptions?on_conflict=endpoint') && c.m === 'POST');
  assert.equal(saved.body.m_uid, MUID); assert.equal(saved.body.endpoint, sub.endpoint); assert.equal(saved.body.p256dh, sub.keys.p256dh);
  assert.equal((await call(env, '/v1/mnet/push/subscriptions', 'DELETE', { endpoint: sub.endpoint })).status, 200);
  const del = calls.find((c) => c.m === 'DELETE' && c.u.includes('/network_push_subscriptions?'));
  assert.match(del.u, new RegExp(`m_uid=eq\\.${MUID}&endpoint=eq\\.https://fcm\\.googleapis\\.com/fcm/send/abc`));
});

test('a member with ten devices must turn one off before adding another', async () => {
  const vapid = await keyPair('sign'), browser = await keyPair('ecdh'), calls = [];
  apiFake(calls, (u, m) => u.includes('/network_push_subscriptions?m_uid=eq.') && m === 'GET' ? new Response(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ endpoint: 'https://fcm.googleapis.com/' + i })))) : null);
  const env = { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.pub, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.d };
  const res = await call(env, '/v1/mnet/push/subscriptions', 'POST', { endpoint: 'https://fcm.googleapis.com/new', keys: { p256dh: browser.pub, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } });
  assert.equal(res.status, 409);
});

test('the cron claims each alert once, pushes one summary per person, waits out 15 minutes, and forgets gone devices', async () => {
  const vapid = await keyPair('sign'), b1 = await keyPair('ecdh'), b2 = await keyPair('ecdh');
  const env = { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.pub, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.d };
  const now = Date.UTC(2026, 9, 20, 15), A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ACTOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const P = '33333333-3333-4333-8333-333333333333';
  const rows = [
    { id: 'n1', recipient_m_uid: A, actor_m_uid: ACTOR, type: 'comment', body: 'commented on your post', metadata: { post_id: P }, created_at: '2026-10-20T14:55:00Z' },
    { id: 'n2', recipient_m_uid: B, actor_m_uid: ACTOR, type: 'follow', body: 'started following you', metadata: {}, created_at: '2026-10-20T14:56:00Z' },
    { id: 'n3', recipient_m_uid: B, actor_m_uid: ACTOR, type: 'reaction', body: 'reacted to your post', metadata: {}, created_at: '2026-10-20T14:57:00Z' },
    { id: 'n4', recipient_m_uid: C, actor_m_uid: ACTOR, type: 'follow', body: 'started following you', metadata: {}, created_at: '2026-10-20T14:58:00Z' },
  ];
  const auth1 = crypto.getRandomValues(new Uint8Array(16)), auth2 = crypto.getRandomValues(new Uint8Array(16));
  const subs = [
    { id: 's1', m_uid: A, endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: b1.pub, auth: b64url(auth1), last_sent_at: null, failures: 0 },
    { id: 's2', m_uid: B, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/b', p256dh: b2.pub, auth: b64url(auth2), last_sent_at: null, failures: 0 },
    { id: 's3', m_uid: C, endpoint: 'https://fcm.googleapis.com/fcm/send/c', p256dh: b1.pub, auth: b64url(auth1), last_sent_at: new Date(now - 5 * 60e3).toISOString(), failures: 0 },
  ];
  const db = [], pushed = [];
  const service = async (_env, path, init = {}) => {
    db.push({ path: decodeURIComponent(path), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (path.startsWith('network_notifications?pushed_at=is.null')) return rows.map((r) => ({ id: r.id }));
    if (path.startsWith('network_notifications?id=in.') && init.method === 'PATCH') return rows;
    if (path.startsWith('network_push_subscriptions?m_uid=in.')) return subs;
    if (path.startsWith('network_profiles?')) return [{ m_uid: ACTOR, display_name: 'Ada' }];
    return null;
  };
  globalThis.fetch = async (url, init) => {
    pushed.push({ url: String(url), headers: init.headers, body: new Uint8Array(await new Response(init.body).arrayBuffer()) });
    return new Response(null, { status: String(url).includes('mozilla') ? 410 : 201 });
  };
  const out = await runPushCycle(env, service, { now });
  assert.deepEqual(out, { enabled: true, read: 4, sent: 1 });
  const claim = db.find((d) => d.method === 'PATCH' && d.path.startsWith('network_notifications?id=in.'));
  assert.match(claim.path, /pushed_at=is\.null/, 'claimed only where still unclaimed');
  assert.ok(db[0].path.includes('created_at=gte.2026-10-20T14:30:00Z'), 'nothing older than 30 minutes');
  assert.equal(pushed.length, 2, 'C was pushed 5 minutes ago and waits');
  const toA = pushed.find((p) => p.url.endsWith('/a'));
  assert.deepEqual(JSON.parse(await decrypt(toA.body, b1, auth1)), { title: 'Ada', body: 'commented on your post', url: `/mnet.html?view=feed&post=${P}&comments=1`, tag: 'mcc-alerts' });
  assert.equal(toA.headers['content-encoding'], 'aes128gcm'); assert.match(toA.headers.authorization, /^vapid t=/);
  const toB = pushed.find((p) => p.url.includes('mozilla'));
  assert.deepEqual(JSON.parse(await decrypt(toB.body, b2, auth2)), { title: '2 new alerts', body: 'Ada reacted to your post', url: '/mnet.html?view=notifications', tag: 'mcc-alerts' });
  assert.ok(db.some((d) => d.method === 'DELETE' && d.path === 'network_push_subscriptions?id=eq.s2'), 'a gone device is forgotten');
  assert.ok(db.some((d) => d.method === 'PATCH' && d.path === 'network_push_subscriptions?id=eq.s1' && d.body.last_sent_at), 'a sent device starts its quiet time');
});

test('with push off the cron makes no database call at all', async () => {
  let touched = false;
  assert.deepEqual(await runPushCycle({}, async () => { touched = true; return []; }), { enabled: false });
  assert.equal(touched, false);
});
