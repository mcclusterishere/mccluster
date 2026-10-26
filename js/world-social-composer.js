(function (root) {
  'use strict';
  var controller, viewer = '', choices = [], discovery = 0, selected = null, preview = null;
  var $ = function (id) { return document.getElementById(id); };
  function message(text) { if ($('mnExternalNotice')) $('mnExternalNotice').textContent = text; }
  async function api(path, init) {
    var response = await root.MCC.api(path, init), data = await response.json();
    if (!response.ok) throw new Error(data.error || 'External publishing is unavailable.');
    return data;
  }
  function activeUser() { var value = root.MCC_AUTH_STATE; return value?.verified && value.signed_in ? value.user?.id || '' : viewer; }
  function render(records) {
    var host = $('mnExternalDeliveries'); if (!host) return;
    host.replaceChildren(); host.hidden = !records.length;
    records.forEach(function (r) {
      var item = document.createElement('article'), status = document.createElement('p');
      status.textContent = 'World: published. Instagram ' + (r.handle || '') + ': ' + r.state + (r.error ? '. ' + r.error : '.');
      status.setAttribute('role','status'); item.append(status);
      if (r.state === 'failed' || r.jobId && !['published','cancelled'].includes(r.state)) {
        var button = document.createElement('button'); button.type = 'button'; button.className = 'mn__attach';
        button.textContent = r.state === 'failed' ? 'Retry Instagram only' : 'Refresh Instagram status'; button.disabled = r.busy;
        button.onclick = function () {
          button.disabled = true;
          Promise.resolve(r.state === 'failed' ? controller.retry(r) : controller.refresh(r)).catch(function (e) { message(e.message); }).finally(function () { button.disabled = false; });
        }; item.append(button);
      }
      var link = document.createElement('a'); link.className = 'mn__attach';
      link.href = 'https://matthew.mccluster.org/customer-social.html?org_id=' + encodeURIComponent(r.org);
      link.textContent = 'Connection and delivery history'; item.append(link); host.append(item);
    });
  }
  function selectionChanged() {
    selected = choices.find(function (c) { return c.org === $('mnExternalSite').value; }) || null;
    $('mnExternalOptIn').checked = false;
    $('mnExternalOptIn').disabled = !selected;
    paintPreview();
  }
  function paintPreview() {
    if (!$('mnExternalPreview')) return;
    var file = preview?.media?.[0]?.file;
    $('mnExternalPreview').textContent = selected ? 'Instagram preview · @' + selected.handle + ' · Public Reel · ' +
      (file ? file.name : 'Choose one MP4 or MOV video') + '\nCaption: ' + (preview?.caption || '(no caption)') + '\nAttached music selections are World-only.' : '';
  }
  async function discover(user) {
    var mine = ++discovery;
    if (viewer !== user) { viewer = user; preview = null; controller?.reset(); }
    choices = []; selected = null;
    if (!$('mnExternalSite')) return;
    $('mnExternalSite').replaceChildren(); $('mnExternalOptIn').checked = false; $('mnExternalOptIn').disabled = true;
    $('mnExternalPreview').textContent = '';
    if (!user) { message('Sign in to choose your connected Instagram account. World remains the default destination.'); return; }
    message('Checking your connected sites…');
    try {
      var entitlement = await api('/v1/creator-billing/entitlement');
      var workspaces = entitlement.workspaces || [];
      var statuses = await Promise.all(workspaces.map(async function (w) {
        try { var status = await api('/v1/customer-social/status?org_id=' + encodeURIComponent(w.org_id));
          return status.configured && status.connection?.status === 'connected' ? { org: w.org_id, account: status.connection.account_id, handle: status.connection.handle || 'Instagram' } : null;
        } catch (_) { return null; }
      }));
      if (mine !== discovery || viewer !== user) return;
      choices = statuses.filter(Boolean);
      choices.forEach(function (c) { var option = document.createElement('option'); option.value = c.org; option.textContent = '@' + c.handle; $('mnExternalSite').append(option); });
      selectionChanged();
      message(choices.length ? 'World is selected. Instagram is opt-in for each post; check the preview before posting.' : 'No ready Instagram connection on your active sites. You can still post to World. Connect Instagram in Your site.');
    } catch (_) { if (mine === discovery) message('External destinations are unavailable. You can still post to World.'); }
  }
  function init() {
    if (!$('mnExternalOptIn') || !root.MCCWorldPublish) return;
    controller = root.MCCWorldPublish.create({ api: api, currentUser: function () { return viewer; }, randomKey: function () { return crypto.randomUUID(); }, onChange: render,
      uploadFile: async function (url, file) { var response = await fetch(url, { method: 'PUT', headers: { 'content-type': file.type }, body: file }); if (!response.ok) throw new Error('Instagram video upload failed. Retry Instagram only.'); } });
    $('mnExternalSite').onchange = selectionChanged;
    $('mnExternalRefresh').onclick = function () { discover(viewer); };
    root.MCC_WORLD_COMPOSER = {
      preview: function (input) { preview = input; paintPreview(); },
      capture: function (input) {
        if (!$('mnExternalOptIn').checked || !selected) return null;
        var preview = Object.assign({},input,{org:selected.org,account:selected.account,handle:selected.handle});
        return controller.snapshot(preview);
      },
      worldSucceeded: function (record, id) {
        if (!record) return;
        $('mnExternalOptIn').checked = false;
        // Isolated from World success/UI cleanup: external errors cannot turn it into a failed World post.
        Promise.resolve().then(function () { return controller.worldSucceeded(record, id); }).catch(function (e) { message('World published. ' + e.message); });
      },
      user: function (id) { if (id !== viewer) discover(id || ''); }
    };
    discover(activeUser());
    root.addEventListener('mcc:auth-state', function (event) {
      var state = event.detail || {};
      if (state.verified) discover(state.signed_in ? state.user?.id || '' : '');
    });
    root.addEventListener('mcc:auth-changed', function () { discovery++; viewer = ''; choices = []; selected = null; controller.reset(); preview = null; $('mnExternalSite').replaceChildren(); paintPreview(); $('mnExternalOptIn').checked = false; $('mnExternalOptIn').disabled = true; message('Refreshing your account connections…'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})(window);
