/* Optional email-link door into the existing M Account. Supabase remains the
   sole token issuer and owner-only.mjs remains the authorization gate. */
const AUTH = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/auth/v1/';
const KEY = 'sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
export const PENDING = 'mcc.email-link.pending';
export const COOLDOWN = 'mcc.email-link.retry-after';
const SESSION = 'mccdb_session', KEEP = 'mcc_sess_keep';
export const MAX_AGE = 10 * 60 * 1000;
export const NOTICE = 'If this email can sign in, a link will arrive. Open it in this browser within 10 minutes. Check spam. Delivery may be unavailable; password sign-in is still available.';

export function safeReturn(raw, origin) {
  if (typeof raw !== 'string' || raw.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(raw) || !raw.startsWith('/') || raw.startsWith('//')) return '/account.html?stay=1';
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin || !/^https?:$/.test(u.protocol) || /\/auth(?:\/|$)/.test(u.pathname)) return '/account.html?stay=1';
    return u.pathname + u.search + u.hash;
  } catch { return '/account.html?stay=1'; }
}

export function createEmailSignIn({storage, origin, fetchImpl = fetch, cryptoImpl = crypto, now = Date.now, timeoutMs = 12000, onSignedIn = () => {}}) {
  let busy = false;
  const random = () => Array.from(cryptoImpl.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  const sha = async text => {
    const bytes = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const snapshot = () => JSON.stringify([storage.getItem(SESSION), storage.getItem(KEEP)]);
  async function request(path, body, token) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(new Error('The request timed out. Request a new link or use password sign-in.'));
    }, timeoutMs); });
    try {
      return await Promise.race([timeout, (async () => {
        const r = await fetchImpl(AUTH + path, {
          method: body ? 'POST' : 'GET', signal: controller.signal, redirect: 'error', cache: 'no-store',
          headers: {apikey: KEY, 'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})},
          ...(body ? {body: JSON.stringify(body)} : {})
        });
        // Never surface provider response text: it can disclose account existence.
        if (!r.ok) throw Object.assign(new Error('This link could not be used. Request a new link or use password sign-in.'), {status: r.status});
        try { return await r.json(); }
        catch { throw new Error('The sign-in service returned an unreadable response. Request a new link.'); }
      })()]);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return {
    async send(email, next) {
      if (busy) throw new Error('A sign-in request is already in progress.');
      email = String(email || '').trim();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter your email address.');
      if (Number(storage.getItem(COOLDOWN)) > now()) throw new Error('Wait at least a minute before requesting another link.');
      busy = true;
      try {
        const record = {id: random(), verifier: random(), created: now(), next: safeReturn(next, origin)};
        const challenge = await sha(record.verifier);
        // Storage must work before sending: a lost verifier strands the link.
        storage.setItem(PENDING, JSON.stringify(record));
        storage.setItem(COOLDOWN, String(now() + 60000));
        const callback = origin + '/auth/email.html?state=' + record.id;
        try {
          await request('otp?redirect_to=' + encodeURIComponent(callback), {
            email, create_user: false, code_challenge: challenge, code_challenge_method: 's256'
          });
        } catch (error) {
          if (error.status === 429) throw new Error('Email requests are limited right now. Wait at least a minute or use password sign-in.');
          if (!error.status || error.status >= 500) throw new Error('Email sign-in is unavailable right now. A request may still have reached the server. Wait before retrying or use password sign-in.');
          // Same visible result for unknown/social-only/disabled accounts.
        }
        return NOTICE;
      } finally { busy = false; }
    },
    async complete(code, state) {
      if (busy) throw new Error('A sign-in request is already in progress.');
      busy = true;
      try {
        let pending;
        try { pending = JSON.parse(storage.getItem(PENDING)); } catch {}
        if (!pending || !/^[a-f0-9]{64}$/.test(pending.verifier) || pending.id !== state ||
            !Number.isFinite(pending.created) || now() - pending.created > MAX_AGE || now() < pending.created ||
            typeof code !== 'string' || !code || code.length > 2048) {
          throw new Error('This link expired or belongs to another browser. Request a new link here.');
        }
        const before = snapshot();
        // Consume locally before exchange; provider also enforces one-time use.
        storage.removeItem(PENDING);
        const session = await request('token?grant_type=pkce', {auth_code: code, code_verifier: pending.verifier});
        if (!session || typeof session.access_token !== 'string' || !session.access_token || typeof session.refresh_token !== 'string' || !session.refresh_token || !Number.isFinite(session.expires_in) || session.expires_in <= 0) throw new Error('The sign-in response was incomplete. Request a new link.');
        const user = await request('user', null, session.access_token);
        if (!user?.id || (session.user?.id && session.user.id !== user.id)) throw new Error('The sign-in could not be verified.');
        if (snapshot() !== before) throw new Error('Your account changed during sign-in. Return to your account before trying again.');
        const saved = JSON.stringify({...session, user, expires_at: Math.floor(now() / 1000) + session.expires_in});
        // Same contract as mcc-auth.js; no privilege data is invented here.
        try {
          storage.setItem(SESSION, saved);
          storage.setItem(KEEP, saved);
        } catch {
          // Restore both original slots if quota/storage failure interrupts the pair.
          const previous = JSON.parse(before);
          for (const [i, key] of [SESSION, KEEP].entries()) {
            try { previous[i] === null ? storage.removeItem(key) : storage.setItem(key, previous[i]); } catch {}
          }
          throw new Error('The browser could not save sign-in. Enable storage and request a new link.');
        }
        onSignedIn();
        return safeReturn(pending.next, origin);
      } finally { busy = false; }
    }
  };
}
