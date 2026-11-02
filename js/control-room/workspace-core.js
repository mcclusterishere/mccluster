/* Control's three-page presentation contract over the one NAV definition.
   This file creates no permissions, data stores, or mutations. */
(function (root) {
  'use strict';
  const pages = Object.freeze(['intelligence', 'operations', 'studio']);
  /* The route inventory is NAV (js/control-room/nav.js), not a second list.
     Insights is the intelligence page, Create the studio, the rest operations. */
  const NAVI = root.CR && root.CR.nav;
  if (!NAVI) throw new Error('js/control-room/nav.js must load before workspace-core.js');
  const pageOf = section => section === 'insights' ? 'intelligence' : section === 'create' ? 'studio' : 'operations';
  const routes = NAVI.leaves().map(l => ({
    hash: l.leaf.route,
    page: pageOf(l.section.id),
    label: l.view && l.view.label !== l.item.label ? l.item.label + ' · ' + l.view.label : l.item.label,
    group: l.section.label,
    section: l.section.id
  })).map(Object.freeze);
  const defaults = Object.freeze({intelligence:'#insights:overview',operations:'#home:today',studio:'#create:projects:projects'});
  /* Any hash, new or old (#work:inbox, #analytics, #ai…), resolves through
     NAV; anything that is not a route lands on Home. */
  function resolve(hash) {
    const value = typeof hash === 'string' ? hash.toLowerCase() : '';
    const aliases = {'#intelligence':defaults.intelligence,'#operations':defaults.operations,'#studio':defaults.studio};
    const normalized = aliases[value] || value;
    if (!/^#[a-z0-9:-]*$/.test(normalized)) return routes[0];
    const leaf = NAVI.resolve(normalized).entry;
    return routes.find(item => item.hash === leaf.leaf.route) || routes[0];
  }
  function selectedWorkspace(payload, wanted) {
    const list = payload && Array.isArray(payload.workspaces) ? payload.workspaces : [];
    const enabled = list.filter(w => w && typeof w.org_id === 'string' && w.enabled === true);
    return enabled.find(w => w.org_id === wanted) || enabled.find(w => w.org_id === payload.default_org_id) || enabled[0] || null;
  }
  function isOwnerWorkspace(payload, wanted) {
    const row = selectedWorkspace(payload, wanted);
    return !!row && row.slug === 'mccluster' && row.kind === 'studio' && row.role === 'owner';
  }
  /* Hitman's Halo is one page, the four screens on the globe (owner, 2026-10-22). Control no longer frames the separate
     Halo app on its own subdomain, so no owner session is handed to another site from here. */
  const HALO_PAGE = 'action-globe.html?explore=1&halo=1';
  // An allowlisted presentation context, NOT a bag of private analytics rows.
  function context(analytics) {
    const geo = analytics && analytics.geo || {};
    const country = /^[A-Z]{2}$/.test(geo.region || '') ? geo.region : null;
    const state = country && typeof geo.state === 'string' && geo.state.startsWith(country+'-') && /^[A-Z]{2}-[A-Z0-9-]{1,12}$/.test(geo.state) ? geo.state : null;
    return Object.freeze({country,state,period: typeof analytics?.rangeId === 'string' ? analytics.rangeId.slice(0,20) : '24h'});
  }
  root.CR = root.CR || {};
  root.CR.workspaceCore = Object.freeze({pages,routes:Object.freeze(routes),defaults,resolve,selectedWorkspace,isOwnerWorkspace,HALO_PAGE,context});
})(typeof window === 'undefined' ? globalThis : window);
