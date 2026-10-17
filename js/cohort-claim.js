/* Private invitation handling deliberately loads without analytics. The token
 * stays in a fragment/sessionStorage, never a query string or public page data. */
(function () {
  'use strict';
  var storageKey = 'mcc.cohort.invitation';
  var token = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (!token) token = new URLSearchParams(location.hash.slice(1)).get('token');
  var stored;
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ token: token, saved_at: Date.now() })); } catch (_) {}
    history.replaceState(null, '', location.pathname);
  } else {
    token = null;
    try { stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch (_) {}
    if (stored && Date.now() - stored.saved_at < 3 * 60 * 60 * 1000 && /^[a-f0-9]{64}$/.test(stored.token)) token = stored.token;
  }

  var invitation = null;
  var busy = false;
  var status = document.getElementById('claimStatus');
  var button = document.getElementById('claimConfirm');
  var accountState = document.getElementById('accountState');
  var signIn = document.getElementById('claimSignIn');
  async function parse(result) {
    var data = await result.json().catch(function () { return {}; });
    if (!result.ok) throw Object.assign(new Error(data.error || 'The cohort service could not complete this request.'), { code: data.code });
    return data;
  }
  async function refreshAccount() {
    if (!window.MCC) { accountState.textContent = 'Account sign-in could not load. Reload this page.'; return; }
    var user = await MCC.user();
    var authenticated = Boolean(user && user.id);
    signIn.hidden = authenticated;
    document.getElementById('accountLinks').hidden = authenticated;
    document.getElementById('returnNote').hidden = authenticated;
    document.getElementById('claimSwitch').hidden = !authenticated;
    document.getElementById('claimSwitch').disabled = busy;
    accountState.textContent = authenticated ? 'Signed in as ' + (user.email || 'an M Account member') + '.' : 'Sign in with the M Account you want to connect.';
    button.disabled = !authenticated || !invitation || busy;
  }

  signIn.addEventListener('submit', async function (event) {
    event.preventDefault();
    var submit = signIn.querySelector('button');
    submit.disabled = true;
    accountState.textContent = 'Signing in…';
    try {
      await MCC.signInWithPassword(document.getElementById('claimEmail').value, document.getElementById('claimPassword').value);
      document.getElementById('claimPassword').value = '';
      await refreshAccount();
    } catch (error) { accountState.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  document.getElementById('claimRefresh').addEventListener('click', refreshAccount);
  document.getElementById('claimSwitch').addEventListener('click', async function () {
    if (busy) return;
    await MCC.signOut();
    document.getElementById('claimSetup').hidden = true;
    await refreshAccount();
  });
  window.addEventListener('mcc:auth-changed', refreshAccount);
  window.addEventListener('focus', function () { if (invitation && !busy) refreshAccount(); });

  button.addEventListener('click', async function () {
    if (busy || !invitation || !token) return;
    busy = true;
    button.disabled = true;
    status.textContent = 'Connecting your profile…';
    try {
      var result = await MCC.api('/v1/action-archive/claim', { method: 'POST', body: { token: token } });
      var data = await parse(result);
      if (!data || data.project_slug !== invitation.project_slug || data.participant_slug !== invitation.participant_slug ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.m_uid || '')) {
        throw new Error('The service did not confirm your profile connection. Please try again.');
      }
      try { sessionStorage.removeItem(storageKey); } catch (_) {}
      token = null;
      invitation = null;
      document.getElementById('claimProvider').href = 'docket-516r-cohort.html?person=' + encodeURIComponent(data.participant_slug);
      document.getElementById('claimProfile').href = 'cohort-profile.html?project=' + encodeURIComponent(data.project_slug) + '&person=' + encodeURIComponent(data.participant_slug);
      document.getElementById('claimAccount').hidden = true;
      document.getElementById('claimDone').hidden = false;
      status.textContent = 'Your completed cohort work and webpage are connected to your M Account.';
    } catch (error) {
      status.textContent = error.message;
      document.getElementById('claimSetup').hidden = error.code !== 'M_ACCOUNT_PROFILE_REQUIRED';
    }
    finally { busy = false; if (invitation) await refreshAccount(); }
  });

  async function start() {
    if (!token) { status.textContent = 'A private invitation link is needed to claim a profile.'; return; }
    try {
      invitation = await parse(await fetch('https://api.mccluster.org/v1/action-archive/invitation', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token }), referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000)
      }));
      document.getElementById('claimTitle').textContent = invitation.display_name + ', this is your profile.';
      document.getElementById('claimIntro').textContent = 'Connect your ' + invitation.project_title + ' cohort profile and provider webpage to your M Account.';
      status.textContent = 'This invitation is for ' + invitation.display_name + '.';
      document.getElementById('claimAccount').hidden = false;
      await refreshAccount();
    } catch (error) { status.textContent = error.message; }
  }
  // The existing M Account script follows this one in the deferred script queue.
  if (document.readyState === 'complete') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
