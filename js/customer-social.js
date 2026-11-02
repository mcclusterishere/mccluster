/* Customer-owned Instagram connections; never receives provider credentials. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let org = params.get('org_id');
  let selection = null;
  let requestKey = null;
  let uploaded = null;
  const code = params.get('code'), state = params.get('state'), denied = params.get('error');
  // OAuth codes never reach a third-party script, link referrer, or persistent storage.
  history.replaceState(null, '', location.pathname + (org ? '?org_id=' + encodeURIComponent(org) : ''));
  if (state) {
    const saved = sessionStorage.getItem('customer-social-return');
    sessionStorage.removeItem('customer-social-return');
    try { const pending = JSON.parse(saved); if (pending?.state === state) org = pending.org; } catch { /* fail below */ }
  }
  const notice = message => { $('notice').textContent = message; };
  async function api(path, body) {
    const response = await window.MCC.api('/v1/customer-social/' + path + (body ? '' : '?org_id=' + encodeURIComponent(org)), body ? { method: 'POST', body: { ...body, org_id: org } } : undefined);
    const data = await response.json();
    if (response.status === 401) throw new Error('Sign in again to manage this site\'s social connection.');
    if (response.status === 403) throw new Error('This workspace is not yours to manage.'); /* generic: never another tenant's status */
    if (!response.ok) throw new Error(data.error || 'Could not complete that action. Try again.');
    return data;
  }
  const run = fn => async event => {
    event?.preventDefault();
    const button = event?.submitter || event?.currentTarget;
    if (button?.tagName === 'BUTTON') button.disabled = true;
    try { await fn(); } catch (e) { notice(e.message); }
    finally { if (button?.tagName === 'BUTTON') button.disabled = false; }
  };
  async function jobs() {
    const data = await api('jobs');
    $('jobs').replaceChildren();
    for (const job of data.jobs) {
      const li = document.createElement('li');
      const text = document.createElement('p');
      text.textContent = `${job.state} — ${job.caption || 'Reel'}${job.recovery ? '. ' + job.recovery : ''}`;
      li.append(text);
      for (const action of job.state === 'failed' ? ['retry'] : ['draft','queued'].includes(job.state) ? ['cancel'] : []) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = action === 'retry' ? 'Retry' : 'Cancel';
        b.addEventListener('click', run(async () => { await api(`jobs/${job.id}/${action}`, {}); await jobs(); })); li.append(b);
      }
      $('jobs').append(li);
    }
    if (!data.jobs.length) $('jobs').textContent = 'No Instagram posts submitted from this site yet.';
  }
  /* The server's words for WHY (docs/productization/20261102-social-consumer/REMAINING-GATES.md → status reason contract).
     entitlement_reason is about the entitlement; capability.reason is what blocks publishing right now (it equals the
     entitlement reason when unentitled, otherwise provider/connection readiness, otherwise null). The two are shown
     separately: an expired or cancelled included month is never described as a missing paid workspace. */
  const ENTITLEMENT = {
    included_trial: 'Covered by the included platform month.', mapped_paid_subscription: 'Covered by a paid subscription mapped to this module.', legacy_paid: 'Covered by this workspace\'s active paid plan.',
    expired: 'The included platform month has ended. Your site, drafts, connection and past posts are kept; publishing needs a paid module or a new included month.',
    cancelled: 'The included platform month was cancelled. Your site, drafts, connection and past posts are kept; publishing needs a paid module.',
    safety_disabled: 'Publishing through this module is paused by McCluster for safety. Your connection and posts are kept; status and disconnect still work.',
    module_disabled: 'This module is switched off in the catalogue.', trial_disabled: 'Included platform months are not switched on by McCluster yet.',
    registration_blocked: 'The domain order behind the included month is not fulfilled (refund or reconciliation pending), so the month is paused.',
    not_granted: 'No included platform month or paid module covers this workspace.', pending: 'The included platform month has not started yet.',
    unentitled: 'Not included: this is a separately purchasable module.', legacy_paid_required: 'This workspace uses the paid-plan rule: an active paid plan is required to publish.',
    module_not_included: 'The included month does not include this module.', module_capability_unavailable: 'The paid mapping for this workspace does not include this capability.',
    module_authorization_unavailable: 'Module authorization could not be read; nothing was assumed.', active_owned_workspace_required: 'An active paid workspace you own is required to publish.'
  };
  const READINESS = { provider_unavailable: 'The provider or its configuration is not available right now; entitlement is unaffected.', owned_connection_required: 'Connect an Instagram account you own to publish.' };
  function entitlementLine(c, data) {
    if (!c) return 'Entitlement status unavailable; nothing was assumed.';
    const mode = data.module_consumer ? (data.module_consumer.mode === 'module' ? 'module entitlement (atomic consumer)' : 'paid-plan rule (legacy)') : 'paid-plan rule (legacy)';
    const ent = ENTITLEMENT[c.entitlement_reason] || String(c.entitlement_reason || '').replace(/_/g, ' ');
    const ready = c.eligible ? (c.reason === null ? 'Ready to publish.' : (READINESS[c.reason] || String(c.reason).replace(/_/g, ' '))) : '';
    return `Authority: ${mode}. ${ent}${ready ? ' ' + ready : ''}`;
  }
  async function refresh() {
    const data = await api('status');
    const c = data.capability || null;
    $('connect').disabled = !data.configured;
    $('disconnect').hidden = !data.connection;
    $('connect').textContent = data.connection ? 'Reconnect Instagram' : 'Connect Instagram';
    $('connection').textContent = data.connection ? `${data.connection.handle || 'Instagram'} · ${data.connection.status}` : 'Not connected';
    if ($('entitlement')) { $('entitlement').textContent = entitlementLine(c, data); $('entitlement').className = c && c.eligible ? 'is-eligible' : 'is-denied'; }
    /* publish only when the server says it can; recovery controls (refresh, disconnect, job status/cancel/retry) stay available regardless */
    $('publish-button').disabled = !(c ? c.can_publish === true : (data.configured && data.connection?.status === 'connected'));
    if (!data.configured) notice((data.blockers || []).join(' ') || 'Social publishing is not configured for this site.');
    else { notice('Connection status updated.'); await jobs(); }
  }
  $('connect').addEventListener('click', run(async () => {
    const data = await api('connect', {});
    const redirect = new URL(data.authorization_url);
    if (redirect.origin !== 'https://www.facebook.com') throw new Error('Invalid authorization destination.');
    sessionStorage.setItem('customer-social-return', JSON.stringify({ org, state: redirect.searchParams.get('state') }));
    location.assign(redirect.href);
  }));
  $('select').addEventListener('click', run(async () => {
    await api('select', { selection, page_id: $('accounts').value });
    selection = null; $('selection').hidden = true; await refresh();
  }));
  $('disconnect').addEventListener('click', run(async () => { await api('disconnect', {}); await refresh(); notice('This site is disconnected. Facebook permissions remain until you revoke them in Business Integrations.'); }));
  $('refresh').addEventListener('click', run(refresh));
  $('video').addEventListener('change', () => { uploaded = null; requestKey = null; });
  $('caption').addEventListener('input', () => { requestKey = null; });
  $('publish').addEventListener('submit', run(async () => {
    const file = $('video').files[0];
    if (!file || !['video/mp4','video/quicktime'].includes(file.type) || file.size > 524288000 || !file.size) throw new Error('Choose an MP4 or MOV video up to 500 MB.');
    if (!uploaded) {
      notice('Uploading video…');
      const upload = await api('uploads', { mime_type: file.type, byte_size: file.size });
      const response = await fetch(upload.upload_url, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
      if (!response.ok) throw new Error('Video upload failed. Try again.');
      uploaded = upload.storage_path;
    }
    requestKey ||= crypto.randomUUID();
    const result = await api('publish', { storage_path: uploaded, caption: $('caption').value, idempotency_key: requestKey });
    notice(`Instagram delivery: ${result.publish_job.state}.`);
    await jobs();
  }));
  let completedReturn = false;
  async function boot() {
    if (!org) throw new Error('Open Social connections from Your site after signing in.');
    $('site-link').href = 'customer-site.html?org_id=' + encodeURIComponent(org);
    history.replaceState(null, '', location.pathname + '?org_id=' + encodeURIComponent(org));
    await refresh();
    if (denied) { notice('Instagram authorization was cancelled. You can connect again.'); return; }
    if (code && state && !completedReturn) {
      const data = await api('complete', { code, state });
      completedReturn = true;
      selection = data.selection;
      $('accounts').replaceChildren();
      for (const account of data.accounts) { const option = document.createElement('option'); option.value = account.page_id; option.textContent = `${account.handle || account.name} (${account.name})`; $('accounts').append(option); }
      $('selection').hidden = false; notice('Choose the Instagram account for this site.');
    }
  }
  window.addEventListener('mcc:auth-changed', () => { boot().catch(e => notice(e.message)); });
  boot().catch(e => notice(e.message));
})();
