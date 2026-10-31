/* Shared navigation presentation. The Worker still authorizes every operation.
   Control's route contract is reused here; no parallel route list or auth stack. */
(function () {
  'use strict';
  const bar = window.MCC_BAR;
  if (!bar || document.body.hasAttribute('data-no-appbar')) return;
  const {root, house, world, go} = bar.navigation;
  const dock = document.querySelector('.appbar');
  const get = id => document.getElementById(id);
  let coreReady, panel, profile, installed = false, group = 'All', opening = 0;
  // The six Control sections come from NAV (js/control-room/nav.js); Products are the product doors.
  const groups = ['All', 'Home', 'People', 'Sell', 'Create', 'Insights', 'System', 'Products'];
  function element(tag, className, text) {
    const el = document.createElement(tag); el.className = className;
    if (text) el.textContent = text; return el;
  }
  function core() {
    if (window.CR?.workspaceCore) return Promise.resolve(window.CR.workspaceCore);
    if (!coreReady) coreReady = new Promise((resolve, reject) => {
      const load = path => new Promise((done, fail) => {
        const s = document.createElement('script'); s.src = root + path + '?v=__STAMP__';
        s.onload = done; s.onerror = fail; document.head.appendChild(s);
      });
      (window.CR?.nav ? Promise.resolve() : load('js/control-room/nav.js'))
        .then(() => load('js/control-room/workspace-core.js'))
        .then(() => window.CR?.workspaceCore ? resolve(window.CR.workspaceCore) : reject(Error('Routes unavailable')), reject);
    }).catch(error => {coreReady = null; throw error;});
    return coreReady;
  }
  function controlHref(hash) {
    // Same-page changes keep the active organization and workspace presentation.
    const url = /\/control\.html$/.test(location.pathname) ? new URL(location.href) : new URL('control.html', house);
    url.hash = hash; return url.href;
  }
  function entries() {
    const C = window.CR.workspaceCore;
    const native = C.routes.map(route => ({
      href: controlHref(route.hash), hash: route.hash,
      label: route.label, group: route.group, context: route.group
    }));
    // Existing product doors; these are links, not newly granted entitlements.
    return native.concat([
      {label:'World', group:'Products', href:world, context:'Equity Uprise'},
      {label:'Your desk', group:'People', href:new URL('mnet.html?view=feed&desk', root).href, context:'Personal work'},
      /* ONE HALO (owner, 2026-10-22: "it takes you to multiple different places. Not everything is consolidated"): every
         Halo door opens the four screens on the globe (World, Missions, People, Intelligence), never the separate app */
      {label:'Hitman’s Halo', group:'Products', href:new URL('action-globe.html?explore=1&halo=1', house).href, context:'World · Missions · People · Intelligence'},
      {label:'PRIM3', group:'Products', href:new URL('prim3.html', house).href, context:'Learning'},
      {label:'Whip', group:'Products', href:new URL('whip.html', house).href, context:'Mobility'},
      {label:'WE Manufacture', group:'Products', href:new URL('we-manufacture.html', house).href, context:'Manufacturing'}
    ]);
  }
  function closePanel(focus = false) {
    ++opening;
    if (panel?.matches(':popover-open')) panel.hidePopover();
    const button = get('mccControlToggle');
    button?.setAttribute('aria-expanded', 'false');
    if (focus) button?.focus();
  }
  function render() {
    if (!panel) return;
    const query = get('mccDestinationSearch').value.trim().toLowerCase();
    const items = entries().filter(item => (group === 'All' || item.group === group) &&
      query.split(/\s+/).every(word => `${item.label} ${item.group} ${item.context} ${item.hash || ''}`.toLowerCase().includes(word)));
    const list = get('mccDestinationList'); list.replaceChildren();
    groups.slice(1).forEach(name => {
      const rows = items.filter(item => item.group === name); if (!rows.length) return;
      const section = element('section', 'mcc-destinations__group');
      section.appendChild(element('h3', '', name));
      const grid = element('div', 'mcc-destinations__grid');
      rows.forEach(item => {
        const link = element('a', 'mcc-destination'); link.href = item.href;
        if (item.hash) link.dataset.controlRoute = item.hash;
        const on = item.hash && /\/control\.html$/.test(location.pathname) && window.CR.workspaceCore.resolve(location.hash).hash === item.hash;
        if (on) link.setAttribute('aria-current', 'page');
        link.append(element('strong', '', item.label), element('small', '', on ? 'Current section' : item.context));
        grid.appendChild(link);
      });
      section.appendChild(grid); list.appendChild(section);
    });
    get('mccDestinationCount').textContent = items.length ? `${items.length} destinations` : 'No destinations match. Try another search.';
    panel.querySelectorAll('[data-destination-group]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.destinationGroup === group)));
  }
  function createPanel() {
    if (panel) return;
    panel = element('section', 'mcc-destinations'); panel.id = 'mccDestinations';
    panel.setAttribute('popover', 'auto'); panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Control destinations');
    panel.innerHTML = '<header><div><small>CONTROL ROOM</small><h2>Where do you want to go?</h2></div><button type="button" id="mccDestinationsClose" aria-label="Close destinations">×</button></header>' +
      '<label class="mcc-destinations__search">Find a destination<input id="mccDestinationSearch" type="search" placeholder="People, missions, publishing…" autocomplete="off"></label>' +
      '<div class="mcc-destinations__groups" role="group" aria-label="Destination groups"></div>' +
      '<nav id="mccDestinationList" aria-label="Admin destinations"></nav><p id="mccDestinationCount" role="status" aria-live="polite"></p>';
    groups.forEach(name => {
      const button = element('button', '', name); button.type = 'button'; button.dataset.destinationGroup = name;
      button.onclick = () => {group = name; render(); get('mccDestinationList').scrollTop = 0;};
      panel.querySelector('.mcc-destinations__groups').appendChild(button);
    });
    document.body.appendChild(panel);
    get('mccDestinationsClose').onclick = () => closePanel(true);
    get('mccDestinationSearch').oninput = render;
    panel.addEventListener('toggle', event => get('mccControlToggle')?.setAttribute('aria-expanded', String(event.newState === 'open')));
    panel.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      if (!bar.admin()) {closePanel(); return;}
      const destination = link.href; closePanel(); go(destination);
      if (/\/control\.html$/.test(location.pathname)) requestAnimationFrame(() => {
        const main = get('crMain'); if (main) {main.tabIndex = -1; main.focus({preventScroll:true});}
      });
    });
  }
  async function openPanel() {
    if (panel?.matches(':popover-open')) {closePanel(true); return;}
    const attempt = ++opening, button = get('mccControlToggle');
    if (!button) return;
    button.setAttribute('aria-busy', 'true');
    const allowed = await bar.verifyAdmin();
    button.removeAttribute('aria-busy');
    if (attempt !== opening || !allowed || !bar.admin()) return;
    createPanel(); group = 'All'; get('mccDestinationSearch').value = ''; render();
    // Keep the phone keyboard closed until the person chooses to search.
    panel.showPopover(); get('mccDestinationsClose').focus({preventScroll:true});
  }
  function ready() { if (document.body.dataset.siteNavigation === 'ready') window.dispatchEvent(new Event('mcc:navigation-ready')); }
  window.addEventListener('mcc:navigation-style-ready', () => { if (!bar.admin() || installed) ready(); });
  async function syncAdmin() {
    if (!bar.admin()) {
      closePanel(); panel?.remove(); panel = null; installed = false;
      delete document.body.dataset.adminNavigation; ready(); return;
    }
    try { await core(); } catch (_) { ready(); return; } // Original Home link and rails remain usable on load failure.
    if (!bar.admin()) return;
    const old = dock.querySelector('[data-appnav="admin-home"]');
    if (!old) return;
    if (!get('mccControlToggle')) {
      const button = element('button', old.className); button.type = 'button';
      button.id = 'mccControlToggle'; button.dataset.appnav = 'admin-home';
      button.innerHTML = old.innerHTML;
      button.querySelector('span').textContent = 'Control';
      button.setAttribute('aria-label', 'Open all Control destinations');
      button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'mccDestinations');
      button.setAttribute('aria-haspopup', 'dialog'); button.onclick = openPanel;
      old.replaceWith(button);
    }
    installed = true; document.body.dataset.adminNavigation = 'ready';
    markCurrent(); ready();
  }
  function markCurrent() {
    if (!installed) return;
    const button = get('mccControlToggle');
    const on = /\/control\.html$/.test(location.pathname) && window.CR.workspaceCore.resolve(location.hash).section !== 'insights';
    button?.classList.toggle('is-here', on);
    if (on) button?.setAttribute('aria-current', 'page'); else button?.removeAttribute('aria-current');
    // Analytics uses the same document, preserving org, draft editors and the globe instance.
    const analytics = dock.querySelector('[data-appnav="analytics"]');
    if (analytics) analytics.href = controlHref('#insights:overview');
    if (panel?.matches(':popover-open')) render();
  }
  function closeProfile(focus = false) {
    if (profile?.matches(':popover-open')) profile.hidePopover();
    get('mccAuthChip')?.setAttribute('aria-expanded', 'false');
    if (focus) get('mccAuthChip')?.focus();
  }
  function syncProfile() {
    const chip = get('mccAuthChip'); if (!chip) return;
    const signed = bar.auth().signed_in;
    document.body.toggleAttribute('data-native-profile', !!get('mnMe') && !get('mnMe').hidden && signed);
    chip.removeAttribute('aria-haspopup'); chip.removeAttribute('aria-controls'); chip.removeAttribute('aria-expanded');
    if (!signed) {closeProfile(); return;}
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-controls', get('crAccountMenu') ? 'crAccountMenu' : 'mccProfileMenu');
    chip.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', event => {
    const chip = event.target.closest('#mccAuthChip');
    if (!chip || !bar.auth().signed_in || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); event.stopPropagation(); closePanel();
    const native = get('crAccountMenu');
    if (native && !get('crApp')?.hidden && document.body.dataset.cwBlocked !== 'true') {
      const open = !native.classList.contains('is-open');
      native.classList.toggle('is-open', open); chip.setAttribute('aria-expanded', String(open));
      if (open) native.querySelector('a,button')?.focus(); return;
    }
    if (!profile) {
      profile = element('nav', 'mcc-profile-menu'); profile.id = 'mccProfileMenu';
      profile.setAttribute('popover', 'auto'); profile.setAttribute('role', 'dialog'); profile.setAttribute('aria-label', 'Profile and account');
      const view = element('a', '', 'View profile'); view.href = new URL(world).origin === location.origin ? new URL(world).href.replace('view=feed','view=profile') : new URL('mnet.html?view=profile', root).href;
      const account = element('a', '', 'Settings & account'); account.href = root + 'account.html?stay=1';
      const close = element('button', '', 'Close'); close.type = 'button'; close.onclick = () => closeProfile(true);
      profile.append(view, account, close); document.body.appendChild(profile);
      profile.addEventListener('toggle', event => get('mccAuthChip')?.setAttribute('aria-expanded', String(event.newState === 'open')));
    }
    if (profile.matches(':popover-open')) closeProfile(true);
    else {profile.showPopover(); profile.querySelector('a').focus();}
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (panel?.matches(':popover-open')) {event.preventDefault(); closePanel(true);}
    if (profile?.matches(':popover-open')) {event.preventDefault(); closeProfile(true);}
    if (get('crAccountMenu')?.classList.contains('is-open')) {get('crAccountMenu').classList.remove('is-open');get('mccAuthChip')?.setAttribute('aria-expanded','false');get('mccAuthChip')?.focus();}
  });
  document.addEventListener('focusin', event => {
    if (panel?.matches(':popover-open') && !panel.contains(event.target) && !dock.contains(event.target)) closePanel();
    if (profile?.matches(':popover-open') && !profile.contains(event.target) && event.target !== get('mccAuthChip')) closeProfile();
    const account = get('crAccountMenu');
    if (account?.classList.contains('is-open') && !account.contains(event.target) && event.target !== get('mccAuthChip')) account.classList.remove('is-open');
  });
  if (get('crAccountMenu')) new MutationObserver(() => {
    get('mccAuthChip')?.setAttribute('aria-expanded', String(get('crAccountMenu').classList.contains('is-open')));
  }).observe(get('crAccountMenu'), {attributes:true,attributeFilter:['class']});
  window.addEventListener('hashchange', markCurrent);
  window.addEventListener('mcc:appbar-admin', syncAdmin);
  window.addEventListener('mcc:auth-state', () => {syncProfile(); if (!bar.auth().signed_in) {closePanel();closeProfile();get('crAccountMenu')?.classList.remove('is-open');}});
  window.addEventListener('pagehide', () => {closePanel();closeProfile();});
  if (get('mnMe')) new MutationObserver(syncProfile).observe(get('mnMe'), {attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {closePanel();closeProfile();}
    else if (bar.auth().signed_in) bar.verifyAdmin();
  });
  syncProfile(); syncAdmin();
})();
