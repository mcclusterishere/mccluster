/* Owner-only Halo session bridge. Never respond to an unknown frame. */
(function () {
  'use strict';
  var allowedOrigin = 'https://halo.mccluster.org';
  // The owner-only iframe must be mounted by Control after successful sign-in.
  // A missing frame is a closed gate, not an invitation to trust other windows.
  var handler = async function (event) {
    if (event.origin !== allowedOrigin) return;
    var frame = document.querySelector('iframe[data-mccluster-owner-halo]');
    if (!frame || event.source !== frame.contentWindow) return;
    if (!event.data || event.data.type !== 'mccluster:owner-token:request') return;
    var port = event.ports && event.ports[0];
    var nonce = event.data.nonce;
    if (!port || typeof nonce !== 'string' || nonce.length > 100) return;
    var token = null;
    try {
      if (!window.MCC_SUPA || typeof window.MCC_SUPA.token !== 'function') throw new Error('No session');
      token = await window.MCC_SUPA.token();
      if (!token) throw new Error('Not signed in');
      var response = await fetch('https://api.mccluster.org/v1/analytics/geo?granularity=day', {
        headers: { authorization: 'Bearer ' + token },
        credentials: 'omit', cache: 'no-store'
      });
      if (!response.ok) token = null;
      // Never send a token after the control page has lost focus through logout.
      if (document.visibilityState === 'hidden') token = null;
    } catch (_) { token = null; }
    if (event.source !== frame.contentWindow) { port.close(); return; }
    port.postMessage({ type: 'mccluster:owner-token:response', nonce: nonce,
      ok: !!token, token: token });
    port.close();
  };
  window.addEventListener('message', handler);
})();
