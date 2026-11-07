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
  async function refresh() {
    const data = await api('status');
    $('connect').disabled = !data.configured;
    $('disconnect').hidden = !data.connection;
    $('connect').textContent = data.connection ? 'Reconnect Instagram' : 'Connect Instagram';
    $('connection').textContent = data.connection ? `${data.connection.handle || 'Instagram'} · ${data.connection.status}` : 'Not connected';
    $('publish-button').disabled = !data.configured || data.connection?.status !== 'connected';
    if (!data.configured) notice(data.blockers.join(' '));
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
