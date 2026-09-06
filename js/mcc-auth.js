/* MCC AUTH — one McCluster account, every McCluster-powered site.
   ============================================================
   CANONICAL SOURCE: mcclusterishere/mccluster → js/mcc-auth.js
   Satellites vendor this file. Fix it here, then copy it out.

   The identity is the Supabase project, not the page. Every McCluster
   property authenticates against project zmnhbrjyhxzhkxmhkexs, so a person
   who signs in on matthew.mccluster.org and later signs in on a client's
   site is the SAME auth user, with the same id, on both.

   Google, Apple, Facebook, X and email are doors into one M Account. The
   permanent identity is auth.users.id (M_UID). Provider identities remain
   attached in auth.identities; a browser/device identifier is only a
   continuity signal and is NEVER sufficient to merge two accounts.

   A session is per-origin by design. Signing in on a client's site is one
   tap; it is not a second account.

   No vendored SDK: this is the GoTrue HTTP API directly, matching
   js/backend.js. It keeps satellites inside their performance budget and
   off a third-party CDN on the critical path.

   The publishable key below is public by design. Row Level Security is the
   wall. No secret belongs in this file, and none is used by it.
   ============================================================ */
(function (root) {
  'use strict';

  var URL_ = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
  var KEY = 'sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';

  /* The SAME keys js/backend.js already uses. This module is not a second
     session store: on matthew.mccluster.org backend.js and this file read
     and write one session. */
  var SESSION = 'mccdb_session';
  var KEEP = 'mcc_sess_keep';
  var VERIFIER = 'mcc.pkce';
  var DEVICE = 'mcc.device_id';

  /* Provider names are the current Supabase Auth provider identifiers.
     X is `x` (OAuth 2.0), not the legacy Twitter OAuth 1 provider. */
  var SOCIAL = { google: true, apple: true, facebook: true, x: true };

  /* Storage can throw outright, not merely return null — Safari in private
     mode, and any browser set to block site data. Auth must degrade to
     signed out, never to a thrown exception that takes the page with it. */
  function get(store, key) { try { return root[store].getItem(key); } catch (e) { return null; } }
  function set(store, key, value) { try { root[store].setItem(key, value); } catch (e) { /* not fatal */ } }
  function del(store, key) { try { root[store].removeItem(key); } catch (e) { /* not fatal */ } }

  function readSession() {
    try { return JSON.parse(get('localStorage', SESSION) || 'null'); } catch (e) { return null; }
  }
  function writeSession(s) {
    if (!s) { del('localStorage', SESSION); del('localStorage', KEEP); return null; }
    s.expires_at = s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600));
    var raw = JSON.stringify(s);
    set('localStorage', SESSION, raw);
    set('localStorage', KEEP, raw);
    return s;
  }

  function api(path, init) {
    init = init || {};
    var headers = { apikey: KEY, 'content-type': 'application/json' };
    if (init.token) headers.authorization = 'Bearer ' + init.token;
    return fetch(URL_ + '/auth/v1/' + path, {
      method: init.method || 'GET',
      headers: headers,
      body: init.body ? JSON.stringify(init.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!res.ok) throw Object.assign(new Error((data && (data.error_description || data.msg || data.error)) || 'Auth request failed'), { status: res.status });
        return data;
      });
    });
  }

  function random(bytes) {
    var a = new Uint8Array(bytes);
    root.crypto.getRandomValues(a);
    return b64url(a);
  }
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function challenge(verifier) {
    return root.crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(verifier))
      .then(function (buf) { return b64url(new Uint8Array(buf)); });
  }
  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    var a = new Uint8Array(16);
    root.crypto.getRandomValues(a);
    a[6] = (a[6] & 15) | 64;
    a[8] = (a[8] & 63) | 128;
    var h = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function deviceId() {
    var id = get('localStorage', DEVICE);
    if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
    id = uuid();
    set('localStorage', DEVICE, id);
    return id;
  }

  function beginSocial(provider, redirectTo) {
    provider = String(provider || '').toLowerCase();
    if (!SOCIAL[provider]) return Promise.reject(new Error('Unsupported sign-in provider'));
    var verifier = random(48);
    set('sessionStorage', VERIFIER, verifier);
    return challenge(verifier).then(function (c) {
      var q = new URLSearchParams({
        provider: provider,
        redirect_to: redirectTo || root.location.origin + '/auth/',
        code_challenge: c,
        code_challenge_method: 's256'
      });
      root.location.assign(URL_ + '/auth/v1/authorize?' + q.toString());
    });
  }

  var MCC = {
    /* Permanent M Account user, or null. The returned `id` is M_UID. */
    user: function () {
      var s = readSession();
      if (!s || !s.access_token) return Promise.resolve(null);
      var fresh = s.expires_at && s.expires_at > (Date.now() / 1000) + 60;
      var chain = fresh ? Promise.resolve(s) : MCC.refresh();
      return chain
        .then(function (session) {
          if (!session) return null;
          return api('user', { token: session.access_token });
        })
        .catch(function () { return null; });
    },

    session: readSession,
    deviceId: deviceId,

    mUid: function () {
      return MCC.user().then(function (u) { return u ? u.id : null; });
    },

    refresh: function () {
      var s = readSession();
      if (!s || !s.refresh_token) return Promise.resolve(null);
      return api('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })
        .then(writeSession)
        .catch(function () { writeSession(null); return null; });
    },

    signInWithProvider: beginSocial,
    signInWithGoogle: function (redirectTo) { return beginSocial('google', redirectTo); },
    signInWithApple: function (redirectTo) { return beginSocial('apple', redirectTo); },
    signInWithFacebook: function (redirectTo) { return beginSocial('facebook', redirectTo); },
    signInWithX: function (redirectTo) { return beginSocial('x', redirectTo); },

    /* Returns provider enablement from the Auth server. UI code should only
       show a social button after the matching provider is actually live. */
    providers: function () {
      return fetch(URL_ + '/auth/v1/settings', { headers: { apikey: KEY } })
        .then(function (r) { if (!r.ok) throw new Error('Could not load sign-in providers'); return r.json(); })
        .then(function (j) {
          var ext = (j && j.external) || {};
          return {
            google: !!ext.google,
            apple: !!ext.apple,
            facebook: !!ext.facebook,
            x: !!ext.x
          };
        });
    },

    /* Passwordless email. Supabase automatically links a verified OAuth
       identity to an existing user when the verified email matches. */
    signInWithEmail: function (email, redirectTo) {
      return api('otp', {
        method: 'POST',
        body: {
          email: email,
          create_user: true,
          options: { email_redirect_to: redirectTo || root.location.origin + '/auth/' }
        }
      });
    },

    /* Completes any social PKCE redirect. */
    complete: function () {
      var params = new URLSearchParams(root.location.search);
      var code = params.get('code');
      var error = params.get('error_description') || params.get('error');
      if (error) return Promise.reject(new Error(error));
      if (!code) return Promise.resolve(null);

      var verifier = get('sessionStorage', VERIFIER);
      if (!verifier) return Promise.reject(new Error('This sign-in link was started in a different browser or tab.'));

      return api('token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: verifier } })
        .then(function (session) {
          del('sessionStorage', VERIFIER);
          writeSession(session);
          root.history.replaceState({}, '', root.location.pathname);
          /* Device continuity is best-effort. Auth succeeds even if telemetry
             is unavailable. A shared device can belong to multiple M_UIDs. */
          MCC.touch(root.MCC_APP_KEY || null).catch(function () { /* not auth-critical */ });
          return session && session.user ? session.user : MCC.user();
        });
    },

    /* Associates this first-party random device with the signed-in M_UID.
       This is NOT browser fingerprinting and is never an identity merge key. */
    touch: function (appKey) {
      return Promise.all([MCC.refreshIfNeeded(), MCC.user()]).then(function (pair) {
        var session = pair[0], user = pair[1];
        if (!session || !user || !user.id) return null;
        var now = new Date().toISOString();
        var row = {
          user_id: user.id,
          device_id: deviceId(),
          first_app_key: appKey || null,
          last_app_key: appKey || null,
          last_seen_at: now,
          client_meta: {
            language: (root.navigator && root.navigator.language) || '',
            platform: (root.navigator && root.navigator.platform) || ''
          }
        };
        return fetch(URL_ + '/rest/v1/platform_user_devices?on_conflict=user_id,device_id', {
          method: 'POST',
          headers: {
            apikey: KEY,
            authorization: 'Bearer ' + session.access_token,
            'content-type': 'application/json',
            prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify([row])
        }).then(function (r) {
          if (!r.ok) throw new Error('Could not record M Account device continuity');
          return { user_id: user.id, device_id: row.device_id };
        });
      });
    },

    signOut: function () {
      var s = readSession();
      writeSession(null);
      if (!s || !s.access_token) return Promise.resolve();
      return api('logout', { method: 'POST', token: s.access_token }).catch(function () { /* local sign-out already done */ });
    },

    /* An authenticated call to the McCluster control plane. */
    api: function (path, init) {
      init = init || {};
      return MCC.refreshIfNeeded().then(function (session) {
        if (!session) throw Object.assign(new Error('Not signed in'), { status: 401 });
        return fetch('https://api.mccluster.org' + path, {
          method: init.method || 'GET',
          headers: Object.assign({ authorization: 'Bearer ' + session.access_token, 'content-type': 'application/json' }, init.headers || {}),
          body: init.body ? JSON.stringify(init.body) : undefined
        });
      });
    },

    refreshIfNeeded: function () {
      var s = readSession();
      if (!s) return Promise.resolve(null);
      if (s.expires_at && s.expires_at > (Date.now() / 1000) + 60) return Promise.resolve(s);
      return MCC.refresh();
    }
  };

  root.MCC = MCC;
})(window);
