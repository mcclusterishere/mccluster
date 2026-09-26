/* MCC AUTH — one McCluster account, every McCluster-powered site.
   ============================================================
   CANONICAL SOURCE: mcclusterishere/mccluster → js/mcc-auth.js

   Supabase auth.users is the authentication record. public.m_people is the
   canonical M identity above it, so verified credentials that use different
   provider emails can be explicitly linked without pretending a shared
   device proves two people are the same person.

   Google, Apple, Facebook, X, and email/password auth are doors into the
   M layer. Passwordless magic-link sign-in is deliberately not offered by
   the product UI. A random first-party installation id is only a continuity
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
    try {
      var raw = get('localStorage', SESSION);
      /* backend.js has always kept a second copy specifically so a transient
         write/clear cannot make an active member look anonymous. mcc-auth.js
         must honor the same contract because Mnet loads this module directly. */
      if (!raw) {
        raw = get('localStorage', KEEP);
        if (raw) set('localStorage', SESSION, raw);
      }
      return JSON.parse(raw || 'null');
    } catch (e) { return null; }
  }

  function writeSession(s) {
    if (!s) { del('localStorage', SESSION); del('localStorage', KEEP); return null; }
    s.expires_at = s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600));
    var raw = JSON.stringify(s);
    set('localStorage', SESSION, raw);
    set('localStorage', KEEP, raw);
    return s;
  }

  /* THE MAIL QUOTA, AND WHY IT GETS ITS OWN BRANCH.

     Supabase answers 429 with error_code over_email_send_rate_limit when
     the project's mail allowance for the hour is spent. That is not the
     visitor doing anything wrong and it is not their password: it is our
     sender being full. Passing the raw string through meant somebody
     trying to make an account read "email rate limit exceeded", assumed
     the site was broken, and hammered "Resend verification email" — and
     every one of those taps asks for another message from the same empty
     bucket, which is how one blocked person becomes an hour of blocked
     people. The auth log for this project shows exactly that: four 429s
     in forty-three seconds from one signup at 23:47.

     So the error is named here, carries how long to wait, and the
     callers below use it to hold the button shut instead of offering it
     again immediately. */
  var MAIL_QUOTA = /over_email_send_rate_limit|email rate limit|rate limit exceeded/i;

  /* How long to hold the button. All three branches are fallbacks for
     each other, and the last one does most of the work in practice:

     Retry-After is NOT a CORS-safelisted response header, and the auth
     host does not expose it, so res.headers.get('retry-after') reads
     null from a browser on our origin. It is tried anyway because it
     costs nothing and same-origin callers (and tests) can see it.

     Some auth errors phrase the wait in the message, but the mail-quota
     one does not — its bucket refills on the hour, not on a countdown.

     So 60s is the honest floor rather than a promise: the button comes
     back, and if the bucket is still empty the next tap says so again
     and holds it for another minute. That is a retry cadence, not a
     claim about when the mail will flow. */
  function retryAfterSeconds(res, data) {
    var h = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    if (h > 0) return h;
    var m = /after (\d+) seconds?/i.exec((data && (data.message || data.msg)) || '');
    if (m) return Number(m[1]);
    return 60;
  }

  function parseResponse(res) {
    return res.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        var msg = data && (data.message || data.error_description || data.msg || data.error);
        var code = (data && data.error_code) || '';
        if (res.status === 429 && (MAIL_QUOTA.test(code) || MAIL_QUOTA.test(msg || ''))) {
          var wait = retryAfterSeconds(res, data);
          throw Object.assign(
            new Error('Our email sender is at its limit for the moment — this is on us, not you. '
                    + 'Try again in about ' + (wait >= 60 ? Math.ceil(wait / 60) + ' minute'
                        + (Math.ceil(wait / 60) === 1 ? '' : 's') : wait + ' seconds') + '.'),
            { status: 429, data: data, mailQuota: true, retryAfter: wait });
        }
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

    signInWithPassword: function (email, password) {
      email = String(email || '').trim().toLowerCase();
      password = String(password || '');
      if (!email || !password) return Promise.reject(new Error('Email and password are required.'));
      return authApi('token?grant_type=password', {
        method: 'POST',
        body: { email: email, password: password }
      }).then(function (session) {
        if (!session || !session.access_token) throw new Error('Sign-in failed.');
        writeSession(session);
        root.dispatchEvent(new CustomEvent('mcc:auth-changed', { detail: { signed_in: true } }));
        return session.user || MCC.user();
      });
    },

    signUpWithPassword: function (email, password, data) {
      email = String(email || '').trim().toLowerCase();
      password = String(password || '');
      if (!email || !password) return Promise.reject(new Error('Email and password are required.'));
      if (password.length < 8) return Promise.reject(new Error('Use at least 8 characters for your password.'));
      var profileData = Object.assign({}, data || {});
      var attributionRead = Promise.resolve(null);
      try {
        if (root.MCC_ANALYTICS_CONTEXT && root.MCC_ANALYTICS_CONTEXT.prepareSignupAttribution) {
          attributionRead = root.MCC_ANALYTICS_CONTEXT.prepareSignupAttribution();
        } else if (root.MCC_ANALYTICS_CONTEXT && root.MCC_ANALYTICS_CONTEXT.signupAttribution) {
          attributionRead = Promise.resolve(root.MCC_ANALYTICS_CONTEXT.signupAttribution());
        }
      } catch (_) {}
      return Promise.resolve(attributionRead).then(function (analyticsAttribution) {
        return authApi('signup', {
          method: 'POST',
          body: { email: email, password: password, data: profileData }
        }).then(function (session) {
          return { response:session, attribution:analyticsAttribution };
        });
      }).then(function (bundle) {
        var session=bundle.response, attribution=bundle.attribution, result;
        if (session && session.access_token) {
          writeSession(session);
          root.dispatchEvent(new CustomEvent('mcc:auth-changed', { detail: { signed_in: true } }));
          result={ session: true, user: session.user || null, confirm: false, existing: false };
        } else {
          var identities = session && session.user && session.user.identities;
          var existing = Array.isArray(identities) && identities.length === 0;
          result={ session: false, user: session && session.user || null, confirm: !existing, existing: existing };
        }
        if (result.existing || !root.MCC_ANALYTICS_CONTEXT || !root.MCC_ANALYTICS_CONTEXT.recordAccountCreated) {
          return result;
        }
        return Promise.resolve(root.MCC_ANALYTICS_CONTEXT.recordAccountCreated(attribution))
          .catch(function () { return null; }).then(function () { return result; });
      });
    },

    requestPasswordReset: function (email, redirectTo) {
      email = String(email || '').trim().toLowerCase();
      if (!email) return Promise.reject(new Error('Enter your email address.'));
      return authApi('recover', {
        method: 'POST',
        body: {
          email: email,
          redirect_to: redirectTo || (root.location.origin + '/reset-password.html')
        }
      });
    },

    /* Holds a button shut for `seconds`, counting down in its own label.
       Used after a mail-quota 429: offering "Resend verification email"
       again straight away invites the tap that spends the next message
       we do not have. Returns nothing; the button restores itself. */
    holdButton: function (btn, seconds, label) {
      if (!btn) return;
      var left = Math.max(1, Math.ceil(seconds || 60));
      btn.disabled = true;
      var tick = function () {
        btn.textContent = 'Try again in ' + left + 's';
        if (left-- <= 0) {
          clearInterval(t);
          btn.disabled = false;
          btn.textContent = label;
        }
      };
      tick();
      var t = setInterval(tick, 1000);
    },

    resendSignupVerification: function (email) {
      email = String(email || '').trim().toLowerCase();
      if (!email) return Promise.reject(new Error('Enter your email address.'));
      return authApi('resend', {
        method: 'POST',
        body: { type: 'signup', email: email }
      });
    },

    acceptRecoveryFromUrl: function () {
      var raw = String(root.location.hash || '').replace(/^#/, '');
      if (!raw) return Promise.resolve(null);
      var params = new URLSearchParams(raw);
      var type = params.get('type') || '';
      var access = params.get('access_token') || '';
      if (type !== 'recovery' || !access) return Promise.resolve(null);
      var session = {
        access_token: access,
        refresh_token: params.get('refresh_token') || '',
        expires_in: Number(params.get('expires_in') || 3600),
        token_type: params.get('token_type') || 'bearer'
      };
      writeSession(session);
      root.history.replaceState({}, '', root.location.pathname + root.location.search);
      root.dispatchEvent(new CustomEvent('mcc:auth-changed', { detail: { signed_in: true } }));
      return Promise.resolve(session);
    },

    updatePassword: function (password) {
      password = String(password || '');
      if (password.length < 8) return Promise.reject(new Error('Use at least 8 characters for your password.'));
      return MCC.refreshIfNeeded().then(function (session) {
        if (!session || !session.access_token) throw new Error('Your session expired. Sign in again, or request a new password-reset link if you cannot sign in.');
        return authApi('user', {
          method: 'PUT',
          token: session.access_token,
          body: { password: password }
        });
      });
    },

    /* Passwordless email login was removed from the product UI after real
       users were stranded by one-time links. Keep this method as an explicit
       hard stop so an old page cannot silently revive that flow. */
    signInWithEmail: function () {
      return Promise.reject(new Error('Passwordless email sign-in is disabled. Use your email and password.'));
    },
    signInPassword: function (email, password) { return MCC.signInWithPassword(email, password); },
    signUpPassword: function (email, password, data) { return MCC.signUpWithPassword(email, password, data); },

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
      root.dispatchEvent(new CustomEvent('mcc:auth-changed', { detail: { signed_in: false } }));
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
