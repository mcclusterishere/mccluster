/* MCC AUTH — one McCluster account, every McCluster-powered site.
   ============================================================
   CANONICAL SOURCE: mcclusterishere/mccluster → js/mcc-auth.js

   Supabase auth.users is the authentication record. public.m_people is the
   canonical M identity above it, so verified credentials that use different
   provider emails can be explicitly linked without pretending a shared
   device proves two people are the same person.

   Google, Apple, Facebook, X, password and magic-link auth are doors into
   the M layer. A random first-party installation id is only a continuity
   signal. It is never browser/hardware fingerprinting and never authenticates
   or automatically merges a user.

   No secret belongs in this file. The publishable key is public by design;
   Row Level Security and authenticated RPCs are the security boundary.
   ============================================================ */
(function (root) {
  'use strict';

  var URL_ = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
  var KEY = 'sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
  var SESSION = 'mccdb_session';
  var KEEP = 'mcc_sess_keep';
  var VERIFIER = 'mcc.pkce';
  var OAUTH_PROVIDER = 'mcc.oauth_provider';
  var DEVICE = 'mcc.device_id';
  var SOCIAL = { google: true, apple: true, facebook: true, x: true };

  function get(store, key) { try { return root[store].getItem(key); } catch (e) { return null; } }
  function set(store, key, value) { try { root[store].setItem(key, value); } catch (e) { /* storage may be blocked */ } }
  function del(store, key) { try { root[store].removeItem(key); } catch (e) { /* storage may be blocked */ } }

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

  function authApi(path, init) {
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
    return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
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
    if (id && id.length >= 20) return id;
    id = uuid();
    set('localStorage', DEVICE, id);
    return id;
  }

  function providerEnabled(settings, provider) {
    var ext = (settings && settings.external) || {};
    if (provider === 'x') return Boolean(ext.x || ext.twitter);
    return Boolean(ext[provider]);
  }

  function inferAppContext() {
    if (root.MCC_APP_KEY) return { app: String(root.MCC_APP_KEY), org: String(root.MCC_ORG_SLUG || 'mccluster') };
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

  function beginSocial(provider, redirectTo) {
    provider = String(provider || '').toLowerCase();
    if (!SOCIAL[provider]) return Promise.reject(new Error('Unsupported sign-in provider'));
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
  }

  var MCC = {
    user: function () {
      var s = readSession();
      if (!s || !s.access_token) return Promise.resolve(null);
      var fresh = s.expires_at && s.expires_at > (Date.now() / 1000) + 60;
      var chain = fresh ? Promise.resolve(s) : MCC.refresh();
      return chain.then(function (session) {
        if (!session) return null;
        return authApi('user', { token: session.access_token });
      }).catch(function () { return null; });
    },

    session: readSession,
    deviceId: deviceId,

    refresh: function () {
      var s = readSession();
      if (!s || !s.refresh_token) return Promise.resolve(null);
      return authApi('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })
        .then(writeSession)
        .catch(function () { writeSession(null); return null; });
    },

    refreshIfNeeded: function () {
      var s = readSession();
      if (!s) return Promise.resolve(null);
      if (s.expires_at && s.expires_at > (Date.now() / 1000) + 60) return Promise.resolve(s);
      return MCC.refresh();
    },

    mUid: function () {
      return MCC.refreshIfNeeded().then(function (session) {
        if (!session || !session.access_token) return null;
        return rpc('m_my_uid', {}, session.access_token);
      });
    },

    signInWithProvider: beginSocial,
    signInWithGoogle: function (redirectTo) { return beginSocial('google', redirectTo); },
    signInWithApple: function (redirectTo) { return beginSocial('apple', redirectTo); },
    signInWithFacebook: function (redirectTo) { return beginSocial('facebook', redirectTo); },
    signInWithX: function (redirectTo) { return beginSocial('x', redirectTo); },

    providerSettings: function () {
      return fetch(URL_ + '/auth/v1/settings', { headers: { apikey: KEY } }).then(parseResponse);
    },

    providers: function () {
      return MCC.providerSettings().then(function (settings) {
        return {
          google: providerEnabled(settings, 'google'),
          apple: providerEnabled(settings, 'apple'),
          facebook: providerEnabled(settings, 'facebook'),
          x: providerEnabled(settings, 'x')
        };
      });
    },

    enabledProviders: function () {
      return MCC.providers().then(function (enabled) {
        return Object.keys(SOCIAL).filter(function (provider) { return enabled[provider]; });
      });
    },

    signInWithEmail: function (email, redirectTo) {
      return authApi('otp', {
        method: 'POST',
        body: {
          email: email,
          create_user: true,
          options: { email_redirect_to: redirectTo || root.location.origin + '/auth/' }
        }
      });
    },

    complete: function () {
      var params = new URLSearchParams(root.location.search);
      var code = params.get('code');
      var error = params.get('error_description') || params.get('error');
      if (error) return Promise.reject(new Error(error));
      if (!code) return Promise.resolve(null);

      var verifier = get('sessionStorage', VERIFIER);
      if (!verifier) return Promise.reject(new Error('This sign-in link was started in a different browser or tab.'));

      return authApi('token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: verifier } })
        .then(function (session) {
          del('sessionStorage', VERIFIER);
          del('sessionStorage', OAUTH_PROVIDER);
          writeSession(session);
          root.history.replaceState({}, '', root.location.pathname);
          return MCC.autoTouch().then(function () {
            return session && session.user ? session.user : MCC.user();
          });
        });
    },

    touch: function (appKey, orgSlug, meta) {
      return MCC.refreshIfNeeded().then(function (session) {
        if (!session || !session.access_token) return null;
        return rpc('m_touch_app', {
          p_app_key: appKey,
          p_device_key: deviceId(),
          p_org_slug: orgSlug || 'mccluster',
          p_meta: meta || {}
        }, session.access_token);
      });
    },

    autoTouch: function () {
      var ctx = inferAppContext();
      if (!ctx) return Promise.resolve(null);
      return MCC.touch(ctx.app, ctx.org, {
        origin: root.location.origin,
        locale: (root.navigator && root.navigator.language) || ''
      }).catch(function () { return null; });
    },

    identities: function () {
      return MCC.refreshIfNeeded().then(function (session) {
        if (!session || !session.access_token) return [];
        return rpc('m_my_identities', {}, session.access_token);
      });
    },

    signOut: function () {
      var s = readSession();
      writeSession(null);
      if (!s || !s.access_token) return Promise.resolve();
      return authApi('logout', { method: 'POST', token: s.access_token }).catch(function () { /* local sign-out already done */ });
    },

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
    }
  };

  function mountAccountSocial() {
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

    var m = root.document.getElementById('acM');
    if (m) m.addEventListener('click', function () {
      var make = root.document.getElementById('acMake');
      var signin = root.document.getElementById('acIn');
      if (make) make.hidden = true;
      if (signin) signin.hidden = false;
      var email = root.document.getElementById('acInEmail');
      if (email) email.focus();
    });

    MCC.providers().then(function (enabled) {
      var specs = [
        ['google', 'acGoogle'], ['apple', 'acApple'],
        ['facebook', 'acFacebook'], ['x', 'acX']
      ];
      var any = false;
      specs.forEach(function (spec) {
        var provider = spec[0], button = root.document.getElementById(spec[1]);
        if (!button || !enabled[provider]) return;
        button.hidden = false;
        any = true;
        button.addEventListener('click', function () {
          button.disabled = true;
          MCC.signInWithProvider(provider, root.location.origin + '/auth/?next=/account.html')
            .catch(function (e) {
              button.disabled = false;
              var msg = root.document.getElementById('acMsg');
              if (msg) msg.textContent = e.message || ('Could not start ' + provider + ' sign-in.');
            });
        });
      });
      var social = root.document.getElementById('acSocial');
      if (social) social.hidden = !any;
    }).catch(function () { /* native M/email auth stays available */ });
  }

  root.MCC = MCC;

  if (root.document) {
    var boot = function () {
      mountAccountSocial();
      MCC.autoTouch();
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(window);
