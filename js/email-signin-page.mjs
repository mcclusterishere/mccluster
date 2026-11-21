import {createEmailSignIn, safeReturn} from './email-signin.mjs';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let code = params.get('code'), state = params.get('state');
const failed = params.has('error') || params.has('error_description') || !!location.hash;
const next = safeReturn(params.get('next'), location.origin);
// Capture then remove codes/errors before any user action. No analytics or shell
// scripts run on this callback page, and no bearer URL fragments are accepted.
history.replaceState({}, '', location.pathname);
$('password').href = '/account.html?stay=1&next=' + encodeURIComponent(next);
let client;
try {
  client = createEmailSignIn({storage: localStorage, origin: location.origin,
    onSignedIn: () => window.dispatchEvent(new CustomEvent('mcc:auth-changed', {detail: {signed_in: true}}))});
} catch {
  $('status').textContent = 'Browser storage is unavailable. Enable storage or use password sign-in.';
  $('send').disabled = true;
}
if (failed) {
  code = null;
  $('status').textContent = 'This link could not be used. Request a new link or use password sign-in.';
} else if (code) {
  $('request').hidden = true;
  $('finish').hidden = false;
  $('status').textContent = 'Continue only if you requested this email link in this browser.';
}
$('request').addEventListener('submit', async event => {
  event.preventDefault();
  if (!client) return;
  $('send').disabled = true;
  $('status').textContent = 'Requesting a link…';
  try { $('status').textContent = await client.send($('email').value, next); }
  catch (error) { $('status').textContent = error.message; }
  finally { $('send').disabled = false; }
});
$('finish').addEventListener('click', async () => {
  if (!client) return;
  $('finish').disabled = true;
  $('status').textContent = 'Verifying sign-in…';
  try { location.replace(await client.complete(code, state)); }
  catch (error) {
    code = null; state = null;
    $('status').textContent = error.message;
    $('finish').hidden = true;
    $('request').hidden = false;
  }
});
