/* MCC AUTH — one McCluster account, every McCluster-powered site.
   ============================================================
   CANONICAL SOURCE: mcclusterishere/mccluster → js/mcc-auth.js
   Satellites vendor this file. Fix it here, then copy it out.

   The identity is the Supabase project, not the page. Every McCluster
   property authenticates against project zmnhbrjyhxzhkxmhkexs, so a person
   who signs in on matthew.mccluster.org and later signs in on a client's
   site is the SAME auth user, with the same id, on both. That is what makes
   one account work everywhere — not a shared cookie, which no longer works
   across origins in any current browser.

   A session is per-origin by design. Signing in on a client's site is one
   tap (Google already knows them); it is not a second account.

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
     and write one session, and the OAuth consent page picks up that same
     session. Diverging here would sign a person in twice and out once. */
  var SESSION = 'mccdb_session';
  var KEEP = 'mcc_sess_keep';
  var VERIFIER = 'mcc.pkce';

  /* Storage can throw outright, not merely return null — Safari in private
     mode, and any browser set to block site data. Auth must degrade to
     "signed out", never to a thrown exception that takes the page with it. */
  function get(store, key) { try { return root[store].getItem(key); } catch (e) { return null; } }
  function set(store, key, value) { try { root[store].setItem(key, value); } catch (e) { /* not fatal */ } }
  function del(store, key) { try { root[store].removeItem(key); } catch (e) { /* not fatal */ } }

  function readSession() {
    try { return JSON.parse(get('localStorage', SESSION) || 'null'); } catch (e) { return null; }
  }
  function writeSession(s) {
    if (!s) { del('localStorage', SESSION); del('localStorage', KEEP); return null; }
    /* expires_at is recorded as absolute epoch seconds. GoTrue returns
       expires_in, which is only meaningful at the moment of issue. A session
       written by backend.js has neither, which reads as stale and simply
       refreshes once — the safe direction. */
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

  /* ---------- PKCE ----------
     A browser is a public client: it cannot keep a secret, so it proves it
     started the exchange by holding a verifier the redirect never carries.
     Without this, an authorization code intercepted from the URL is enough
     to mint a session. */
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

  var MCC = {
    /* The signed-in user, or null. Refreshes an expired session once before
       giving up, so a returning visitor is not signed out by a stale token. */
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

    refresh: function () {
      var s = readSession();
      if (!s || !s.refresh_token) return Promise.resolve(null);
      return api('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })
        .then(writeSession)
        .catch(function () { writeSession(null); return null; });
    },

    /* Sends the visitor to Google via Supabase. `redirectTo` must be listed
       in the project's Auth redirect allowlist or GoTrue refuses it — that
       allowlist, not this file, is what stops an open redirect. */
    signInWithGoogle: function (redirectTo) {
      var verifier = random(48);
      set('sessionStorage', VERIFIER, verifier);
      return challenge(verifier).then(function (c) {
        var q = new URLSearchParams({
          provider: 'google',
          redirect_to: redirectTo || root.location.origin + '/auth/',
          code_challenge: c,
          code_challenge_method: 's256'
        });
        root.location.assign(URL_ + '/auth/v1/authorize?' + q.toString());
      });
    },

    /* Passwordless email. Same account as Google if the address matches and
       the project links identities by email. */
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

    /* Completes a redirect back from Google. Call on the callback page.
       Returns the user, or null when there is no code to exchange. */
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
          /* The code is single-use and spent. Leaving it in the address bar
             puts it in history, in any shared link, and in the referrer. */
          root.history.replaceState({}, '', root.location.pathname);
          return session && session.user ? session.user : MCC.user();
        });
    },

    signOut: function () {
      var s = readSession();
      writeSession(null);
      if (!s || !s.access_token) return Promise.resolve();
      return api('logout', { method: 'POST', token: s.access_token }).catch(function () { /* local sign-out already done */ });
    },

    /* An authenticated call to the control plane, so a satellite never
       hand-rolls the bearer header or forgets to refresh first. */
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
