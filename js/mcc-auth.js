/* MCC AUTH — one McCluster account, every McCluster-powered site.
   ============================================================
   CANONICAL SOURCE: mcclusterishere/mccluster → js/mcc-auth.js
   Satellites vendor this file. Fix it here, then copy it out.

   The identity is the Supabase project, not the page. Every McCluster
   property authenticates against project zmnhbrjyhxzhkxmhkexs, so a person
   who signs in on matthew.mccluster.org and later signs in on a client's
   site is the SAME auth user, with the same id, on both. Social providers
   are doors into that M Account, not separate customer records.

   A session is per-origin by design. Signing in on a client's site is one
   tap; it is not a second account.

   No vendored SDK: this is the GoTrue/PostgREST HTTP API directly, matching
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
  var OAUTH_PROVIDER = 'mcc.oauth_provider';
  var DEVICE = 'mcc_device_id';
  var PROVIDERS = { google: true, apple: true, facebook: true, x: true };

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

  function parseResponse(res) {
    return res.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        var msg = data && (data.message || data.error_description || data.msg || data.error);
        throw Object.assign(new Error(msg || 'Request failed'), { status: res.status, data: data });
      }
      return data;
    });
  }

  function api(path, init) {
    init = init || {};
    var headers = { apikey: KEY, 'content-type': 'application/json' };
    if (init.token) headers.authorization = 'Bearer ' + init.token;
    return fetch(URL_ + '/auth/v1/' + path, {
      method: init.method || 'GET',
      headers: headers,
      body: init.body ? JSON.stringify(init.body) : undefined
    }).then(parseResponse);
  }

  function rpc(name, body, token) {
    return fetch(URL_ + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        apikey: KEY,
        authorization: 'Bearer ' + token,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body || {})
    }).then(parseResponse);
  }

  /* ---------- PKCE ---------- */
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

  /* A random first-party installation id, not a browser/hardware fingerprint.
     It lets the M layer recognize the same installation after a provider or
     email changes without pretending a shared device means a shared person. */
  function deviceId() {
    var id = get('localStorage', DEVICE);
    if (id && id.length >= 20) return id;
    id = 'm_' + random(32);
    set('localStorage', DEVICE, id);
    return id;
  }

  function providerEnabled(settings, provider) {
    var external = settings && settings.external || {};
    if (provider === 'x') return Boolean(external.x || external.twitter);
    return Boolean(external[provider]);
  }

  function inferAppContext() {
    var host = (root.location.hostname || '').toLowerCase();
    var path = root.location.pathname || '/';
    if (/esmermusic\.com$/.test(host)) return { app: 'esmer-web', org: 'esmer' };
    if (/mccluster\.org$/.test(host)) {
      if (/^\/whip\/driver(?:\/|$)/.test(path)) return { app: 'whip-driver-web', org: 'mccluster' };
      if (/^\/whip\/rentals(?:\/|$)/.test(path)) return { app: 'whip-rentals-web', org: 'mccluster' };
      if (/^\/whip\/rider(?:\/|$)/.test(path)) return { app: 'whip-rider-web', org: 'mccluster' };
      return { app: 'mccluster-web', org: 'mccluster' };
    }
    return null;
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
    deviceId: deviceId,

    refresh: function () {
      var s = readSession();
      if (!s || !s.refresh_token) return Promise.resolve(null);
      return api('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })
        .then(writeSession)
        .catch(function () { writeSession(null); return null; });
    },

    /* Every external identity is only an authentication door. The resulting
       Supabase auth.users UUID is the canonical M UID. X uses Supabase's
       current OAuth 2.0 provider name `x`, not legacy Twitter OAuth 1.0a. */
    signInWithProvider: function (provider, redirectTo) {
      provider = String(provider || '').toLowerCase();
      if (!PROVIDERS[provider]) return Promise.reject(new Error('Unsupported sign-in provider'));
      var verifier = random(48);
      set('sessionStorage', VERIFIER, verifier);
      set('sessionStorage', OAUTH_PROVIDER, provider);
      return challenge(verifier).then(function (c) {
        var q = new URLSearchParams({
          provider: provider,
          redirect_to: redirectTo || root.location.origin + '/auth/',
          code_challenge: c,
          code_challenge_method: 's256'
        });
        root.location.assign(URL_ + '/auth/v1/authorize?' + q.toString());
      });
    },

    signInWithGoogle: function (redirectTo) { return MCC.signInWithProvider('google', redirectTo); },
    signInWithApple: function (redirectTo) { return MCC.signInWithProvider('apple', redirectTo); },
    signInWithFacebook: function (redirectTo) { return MCC.signInWithProvider('facebook', redirectTo); },
    signInWithX: function (redirectTo) { return MCC.signInWithProvider('x', redirectTo); },

    providerSettings: function () {
      return fetch(URL_ + '/auth/v1/settings', { headers: { apikey: KEY } }).then(parseResponse);
    },

    enabledProviders: function () {
      return MCC.providerSettings().then(function (settings) {
        return Object.keys(PROVIDERS).filter(function (provider) { return providerEnabled(settings, provider); });
      });
    },

    /* Passwordless email is the native M door. OAuth identities with the same
       verified email are linked by Supabase; different emails can later be
       explicitly linked while the user is authenticated. */
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

    /* Completes any supported OAuth redirect. */
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
          del('sessionStorage', OAUTH_PROVIDER);
          writeSession(session);
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

    refreshIfNeeded: function () {
      var s = readSession();
      if (!s) return Promise.resolve(null);
      if (s.expires_at && s.expires_at > (Date.now() / 1000) + 60) return Promise.resolve(s);
      return MCC.refresh();
    },

    /* Record app membership + first-party installation continuity in the M
       layer. Authorization is still the signed Supabase token; device_key is
       a continuity signal only and never authenticates anybody. */
    touch: function (appKey, orgSlug, meta) {
      return MCC.refreshIfNeeded().then(function (session) {
        if (!session || !session.access_token) throw Object.assign(new Error('Not signed in'), { status: 401 });
        return rpc('m_touch_app', {
          p_app_key: appKey,
          p_device_key: deviceId(),
          p_org_slug: orgSlug || 'mccluster',
          p_meta: meta || {}
        }, session.access_token);
      });
    },

    identities: function () {
      return MCC.refreshIfNeeded().then(function (session) {
        if (!session || !session.access_token) throw Object.assign(new Error('Not signed in'), { status: 401 });
        return rpc('m_my_identities', {}, session.access_token);
      });
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

    autoTouch: function () {
      var ctx = inferAppContext();
      if (!ctx) return Promise.resolve(null);
      return MCC.touch(ctx.app, ctx.org, {
        origin: root.location.origin,
        locale: (root.navigator && root.navigator.language) || ''
      }).catch(function () { return null; });
    }
  };

  root.MCC = MCC;

  /* Account-page progressive enhancement. The page's email/password path is
     the native M credential; provider buttons only appear when that provider
     is actually enabled in Supabase, so unfinished credentials never create
     dead buttons. */
  function enhanceAccountDoor() {
    var wrap = root.document && root.document.getElementById('acOauth');
    if (!wrap || wrap.getAttribute('data-mcc-enhanced') === '1') return;
    wrap.setAttribute('data-mcc-enhanced', '1');
    wrap.innerHTML =
      '<button class="ac__btn" id="acM" type="button" style="display:flex;align-items:center;justify-content:center;gap:.65rem">' +
        '<img src="assets/img/m-mark.png" alt="" width="22" height="22">Sign in with M</button>' +
      '<div id="acSocial" hidden style="margin-top:.75rem">' +
        '<button class="ac__ghost" id="acGoogle" type="button" hidden style="width:100%;cursor:pointer">Continue with Google</button>' +
        '<button class="ac__ghost" id="acApple" type="button" hidden style="width:100%;cursor:pointer">Continue with Apple</button>' +
        '<button class="ac__ghost" id="acFacebook" type="button" hidden style="width:100%;cursor:pointer">Continue with Facebook</button>' +
        '<button class="ac__ghost" id="acX" type="button" hidden style="width:100%;cursor:pointer">Continue with X</button>' +
      '</div>' +
      '<p class="ac__sub" style="margin:.8rem 0 1.2rem">One M Account across McCluster. Social sign-ins attach to the same identity.</p>';
    wrap.hidden = false;

    var nativeButton = root.document.getElementById('acM');
    if (nativeButton) nativeButton.addEventListener('click', function () {
      var make = root.document.getElementById('acMake');
      var signin = root.document.getElementById('acIn');
      if (make) make.hidden = true;
      if (signin) signin.hidden = false;
      var email = root.document.getElementById('acInEmail');
      if (email) email.focus();
    });

    MCC.providerSettings().then(function (settings) {
      var social = root.document.getElementById('acSocial');
      var specs = [
        ['google', 'acGoogle'],
        ['apple', 'acApple'],
        ['facebook', 'acFacebook'],
        ['x', 'acX']
      ];
      var any = false;
      specs.forEach(function (spec) {
        var provider = spec[0], id = spec[1], button = root.document.getElementById(id);
        if (!button || !providerEnabled(settings, provider)) return;
        button.hidden = false;
        any = true;
        /* account.html already owns Google's existing handler; bind the other
           providers here so old pages can gain them without a markup fork. */
        if (provider !== 'google') {
          button.addEventListener('click', function () {
            button.disabled = true;
            MCC.signInWithProvider(provider, root.location.origin + '/auth/?next=/account.html')
              .catch(function (e) {
                button.disabled = false;
                var msg = root.document.getElementById('acMsg');
                if (msg) msg.textContent = e.message || 'Could not start sign-in.';
              });
          });
        }
      });
      if (social) social.hidden = !any;
    }).catch(function () { /* native M auth remains available */ });
  }

  function markAccount() {
    var ctx = inferAppContext();
    if (!ctx) return;
    MCC.autoTouch().then(function (record) {
      if (!record || !root.document) return;
      var meta = root.document.getElementById('acMeta');
      if (meta && !root.document.getElementById('acMuid')) {
        var li = root.document.createElement('li');
        li.id = 'acMuid';
        li.innerHTML = 'M ID · <b>' + String(record.m_uid || '').slice(0, 8) + '…</b>';
        meta.appendChild(li);
      }
    });
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', function () { enhanceAccountDoor(); markAccount(); });
    } else {
      enhanceAccountDoor();
      markAccount();
    }
    root.addEventListener('mcc:auth', markAccount);
  }
})(window);
