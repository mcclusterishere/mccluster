/* WEB PUSH (owner, 2026-10-20: people come back when something happened for them). A member can turn alerts on for
   one device; when they get a reply, a comment, a review decision or anything else the bell already shows, that
   device is told within the five-minute cron.

   - Off unless WEB_PUSH_ENABLED is "true" and both VAPID keys are set (WEB_PUSH_VAPID_PUBLIC_KEY: the 65-byte
     uncompressed P-256 point, base64url; WEB_PUSH_VAPID_PRIVATE_KEY: its 32-byte scalar, base64url). The table it
     writes to is supabase/pending/20261020150000_network_web_push.sql.
   - The Worker only ever posts to a browser's own push service (the hosts below), never to an address a page names.
   - Payloads are encrypted for that one browser (RFC 8291, aes128gcm) and signed for this server (RFC 8292, VAPID).
   - At most one push per person per 15 minutes; anything else waits in the bell. A push service that says the
     subscription is gone (404/410) has it deleted. Nothing older than 30 minutes is ever pushed. */

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
const enc = new TextEncoder();

export function pushEnabled(env) {
  return env.WEB_PUSH_ENABLED === 'true' && /^[A-Za-z0-9_-]{86,88}$/.test(env.WEB_PUSH_VAPID_PUBLIC_KEY || '') && /^[A-Za-z0-9_-]{42,44}$/.test(env.WEB_PUSH_VAPID_PRIVATE_KEY || '');
}

export function b64url(bytes) {
  let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

/* A subscription the page hands over: a push service URL and the browser's two keys. Anything else is refused. */
export function validSubscription(input) {
  const endpoint = String(input?.endpoint || ''), p256dh = String(input?.keys?.p256dh || ''), auth = String(input?.keys?.auth || '');
  let host = '';
  try { const u = new URL(endpoint); if (u.protocol !== 'https:' || u.port || u.username || u.password) return null; host = u.hostname; } catch { return null; }
  if (endpoint.length > 1000 || !PUSH_HOSTS.some((re) => re.test(host))) return null;
  if (!/^[A-Za-z0-9_-]{86,88}$/.test(p256dh) || unb64url(p256dh).length !== 65 || unb64url(p256dh)[0] !== 4) return null;
  if (!/^[A-Za-z0-9_-]{21,24}$/.test(auth) || unb64url(auth).length !== 16) return null;
  return { endpoint, p256dh, auth };
}

async function hkdf(salt, ikm, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

/* RFC 8291: one record, aes128gcm, encrypted to the browser's key with a fresh server key and salt. */
export async function encryptPayload(text, p256dh, auth, { salt = crypto.getRandomValues(new Uint8Array(16)), serverKeys } = {}) {
  const uaPublic = unb64url(p256dh), authSecret = unb64url(auth);
  const pair = serverKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 256);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), Uint8Array.of(2))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, Uint8Array.of(asPublic.length), asPublic, sealed);
}

/* RFC 8292: a short-lived ES256 token for the push service's origin. */
export async function vapidAuthorization(env, endpoint, now = Date.now()) {
  const pub = unb64url(env.WEB_PUSH_VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: env.WEB_PUSH_VAPID_PRIVATE_KEY, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.WEB_PUSH_CONTACT || 'https://mccluster.org/' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.WEB_PUSH_VAPID_PUBLIC_KEY}`;
}

export async function sendWebPush(env, sub, message) {
  const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, { method: 'POST', body, headers: {
    authorization: await vapidAuthorization(env, sub.endpoint), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal'
  } });
  return res.status;
}

/* Where a tap on the alert goes: the same places the bell's own buttons go. */
export function alertUrl(n) {
  const meta = n?.metadata || {}, id = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
  if (n?.type === 'comment' && id(meta.post_id)) return `/mnet.html?view=feed&post=${meta.post_id}&comments=1`;
  if (n?.type === 'news_comment' && id(meta.article_id)) return `/mnet.html?view=feed&news=${meta.article_id}&comments=1`;
  if (n?.type === 'reply' && id(meta.parent_post_id)) return `/mnet.html?view=feed&post=${meta.parent_post_id}`;
  if ((n?.type === 'action_proof_review' || n?.type === 'collaboration_published') && id(meta.mission_id)) return `/mnet.html?mission=${meta.mission_id}`;
  return '/mnet.html?view=notifications';
}

/* The cron: everything unpushed from the last 30 minutes, at most one push per person per 15 minutes. Rows are
   claimed first (pushed_at set only where it is still empty), so two runs never push the same alert, and every row
   claimed counts as pushed, sent or not, so nothing is ever pushed twice or late. */
export async function runPushCycle(env, service, { now = Date.now(), limit = 200 } = {}) {
  if (!pushEnabled(env)) return { enabled: false };
  const since = new Date(now - 30 * 60e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const waiting = await service(env, `network_notifications?pushed_at=is.null&created_at=gte.${since}&order=created_at.asc&limit=${limit}&select=id`) || [];
  if (!waiting.length) return { enabled: true, read: 0, sent: 0 };
  const rows = (await service(env, `network_notifications?id=in.(${waiting.map((r) => r.id).join(',')})&pushed_at=is.null&select=id,recipient_m_uid,actor_m_uid,type,body,metadata,created_at`, {
    method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ pushed_at: new Date(now).toISOString() })
  }) || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!rows.length) return { enabled: true, read: 0, sent: 0 };
  const people = [...new Set(rows.map((r) => r.recipient_m_uid))];
  const actors = [...new Set(rows.map((r) => r.actor_m_uid).filter(Boolean))];
  const [subs, profiles] = await Promise.all([
    service(env, `network_push_subscriptions?m_uid=in.(${people.join(',')})&select=id,m_uid,endpoint,p256dh,auth,last_sent_at,failures`),
    actors.length ? service(env, `network_profiles?m_uid=in.(${actors.join(',')})&select=m_uid,display_name`) : []
  ]);
  const names = Object.fromEntries((profiles || []).map((p) => [p.m_uid, p.display_name]));
  const quietSince = now - 15 * 60e3;
  let sent = 0;
  for (const person of people) {
    const mine = rows.filter((r) => r.recipient_m_uid === person), devices = (subs || []).filter((s) => s.m_uid === person);
    if (!devices.length || devices.some((d) => d.last_sent_at && Date.parse(d.last_sent_at) > quietSince)) continue;
    const last = mine[mine.length - 1], who = names[last.actor_m_uid] || 'Someone';
    const message = mine.length === 1
      ? { title: who, body: String(last.body || 'has something for you').slice(0, 140), url: alertUrl(last), tag: 'mcc-alerts' }
      : { title: `${mine.length} new alerts`, body: `${who} ${String(last.body || '').slice(0, 120)}`.trim(), url: '/mnet.html?view=notifications', tag: 'mcc-alerts' };
    for (const d of devices) {
      let status = 0;
      try { status = await sendWebPush(env, d, message); } catch { status = 0; }
      if (status === 404 || status === 410) await service(env, `network_push_subscriptions?id=eq.${d.id}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      else if (status >= 200 && status < 300) { sent++; await service(env, `network_push_subscriptions?id=eq.${d.id}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ last_sent_at: new Date(now).toISOString(), failures: 0 }) }); }
      // a device that has failed ten times in a row is let go
      else if ((Number(d.failures) || 0) + 1 >= 10) await service(env, `network_push_subscriptions?id=eq.${d.id}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      else await service(env, `network_push_subscriptions?id=eq.${d.id}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ failures: (Number(d.failures) || 0) + 1 }) });
    }
  }
  return { enabled: true, read: rows.length, sent };
}
