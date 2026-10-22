/* Control's three-page presentation contract. Routes remain the existing Control
   routes; this file creates no permissions, data stores, or mutations. */
(function (root) {
  'use strict';
  const pages = Object.freeze(['intelligence', 'operations', 'studio']);
  const work = ['inbox','pipeline','people','companies','relationships','clients','tasks','bookings','orders','projects','deliverables','payments','renewals','outreach','operations'];
  const create = ['projects','front-page','library','schedule','channels','instagram','music','clipping','action-network','funding','song-test','build'];
  const system = ['command','overview','workload','observability','resources'];
  const titles = {home:'Overview',ai:'McCluster conversation',apps:'Applications',analytics:'Platform intelligence',inbox:'Inbox',pipeline:'Pipeline',people:'People',companies:'Organizations',relationships:'Relationships',clients:'Clients',tasks:'Tasks',bookings:'Bookings',orders:'Orders',projects:'Projects',deliverables:'Deliverables',payments:'Payments',renewals:'Renewals',outreach:'Outreach',operations:'Administration',library:'Media library',schedule:'Publishing',channels:'Channels',instagram:'Instagram',music:'Music',clipping:'Clipping', 'action-network':'Missions', funding:'Funding intelligence','song-test':'Song testing',build:'Build · Code','front-page':'Front page',command:'System command',overview:'System overview',workload:'Workload',observability:'Observability',resources:'Resources'};
  const routes = [
    {hash:'#analytics',page:'intelligence',label:'Platform intelligence',group:'Intelligence'},
    {hash:'#home',page:'operations',label:'Overview',group:'Operate'},
    ...work.map(view => ({hash:'#work:'+view,page:'operations',label:titles[view],group:'Work'})),
    ...system.map(view => ({hash:'#system:'+view,page:'operations',label:titles[view],group:'System'})),
    {hash:'#apps',page:'operations',label:'Applications',group:'System'},
    {hash:'#ai',page:'operations',label:'McCluster conversation',group:'Assistant'},
    ...create.map(view => ({hash:'#create:'+view,page:'studio',label:titles[view],group:'Create'}))
  ].map(Object.freeze);
  const defaults = Object.freeze({intelligence:'#analytics',operations:'#home',studio:'#create:projects'});
  function resolve(hash) {
    const value = typeof hash === 'string' ? hash.toLowerCase() : '';
    const aliases = {'#intelligence':'#analytics','#operations':'#home','#studio':'#create:projects','#work':'#work:inbox','#create':'#create:projects','#system':'#system:overview'};
    const normalized = aliases[value] || value;
    return routes.find(item => item.hash === normalized) || routes[1];
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
