/* BEGIN GENERATED SITE HOSTS: tools/build-site-hosts.mjs writes this block from data/seo/domain-architecture.json. Do not edit it by hand. */
/* window.MCC_SITE: where the platform and Matthew's profile are, which hosts serve the World, and where a path
   lives and is served at this stage (the helpers of workers/mccluster/src/platform/hosts.generated.js, the
   same table). Frozen. Read it, never write a host into a page script. */
(function (w) {
  'use strict';
  const SETS = ["platform","profile","profile_only"];
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const k of Object.keys(value)) deepFreeze(value[k]);
    }
    return value;
  }
  function makeSite(t) {
    const sets = {};
    for (const name of SETS) for (const p of t.pages[name]) sets[p] = name;
    function cleanPath(path) {
      let p = String(path == null ? '' : path);
      let cut = p.length;
      const q = p.indexOf('?');
      const h = p.indexOf('#');
      if (q !== -1 && q < cut) cut = q;
      if (h !== -1 && h < cut) cut = h;
      p = p.slice(0, cut);
      if (p.charAt(0) !== '/') p = '/' + p;
      if (p.slice(-11) === '/index.html') p = p.slice(0, -10);
      return p;
    }
    function underAny(p, prefixes) {
      return prefixes.some((x) => p.indexOf(x) === 0);
    }
    function inOwn(p, own) {
      return own.generated.indexOf(p) !== -1 || own.subtrees.some((r) => p === r || p.indexOf(r + '/') === 0);
    }
    function isPageLike(path) {
      const p = cleanPath(path);
      return p.slice(-1) === '/' || p.slice(-5) === '.html';
    }
    function pageSet(path) {
      const p = cleanPath(path);
      if (Object.prototype.hasOwnProperty.call(sets, p)) return sets[p];
      for (const d of t.promoted) if (p.indexOf(d.prefix) === 0) return d.set;
      return null;
    }
    function ownPathOrigin(path) {
      const p = cleanPath(path);
      if (inOwn(p, t.platform.own_paths)) return t.platform.origin;
      for (const x of t.tenants) if (inOwn(p, x.own_paths)) return x.origin;
      return null;
    }
    function isOwnPath(path) {
      return ownPathOrigin(path) !== null;
    }
    function isWorldRoom(path) {
      const p = cleanPath(path);
      return t.world.rooms.indexOf(p) !== -1 || underAny(p, t.world.room_prefixes);
    }
    function isBothHosts(path) {
      const p = cleanPath(path);
      return t.both_hosts.paths.indexOf(p) !== -1 || underAny(p, t.both_hosts.prefixes);
    }
    function homeOrigin(path) {
      const own = ownPathOrigin(path);
      if (own) return own;
      const set = pageSet(path);
      if (set === 'platform') return t.platform.origin;
      if (set === 'profile' || set === 'profile_only') return t.profile.origin;
      return null;
    }
    function servingOrigin(path) {
      const own = ownPathOrigin(path);
      if (own) return own;
      if (t.switches.platform_serves === 'everything') return pageSet(path) === 'profile_only' ? t.profile.origin : t.platform.origin;
      return isWorldRoom(path) ? t.platform.origin : t.profile.origin;
    }
    function siteUrl(path) {
      const raw = String(path == null ? '' : path);
      const rel = raw.charAt(0) === '/' ? raw : '/' + raw;
      return servingOrigin(rel) + rel;
    }
    function returnOrigin(origin) {
      const o = String(origin == null ? '' : origin);
      return t.return_origins.indexOf(o) !== -1 ? o : t.return_fallback_origin;
    }
    function isWorldHost(host) {
      return t.world_hosts.indexOf(String(host == null ? '' : host).toLowerCase()) !== -1;
    }
    function isSiteOrigin(origin) {
      return t.site_origins.indexOf(String(origin == null ? '' : origin)) !== -1;
    }
    function hostRole(host) {
      const h = String(host == null ? '' : host).toLowerCase();
      if (h === t.platform.host) return { role: 'platform', host: h, origin: t.platform.origin };
      for (const x of t.tenants) if (h === x.host) return { role: 'tenant', host: h, origin: x.origin, key: x.key };
      for (const d of t.doors) if (h === d.host) return { role: 'door', host: h, origin: d.origin, to: d.to, to_origin: d.to_origin, served_by: d.served_by };
      return null;
    }
    return Object.freeze(Object.assign({}, t, {
      cleanPath, isPageLike, pageSet, ownPathOrigin, isOwnPath, isWorldRoom, isBothHosts,
      homeOrigin, servingOrigin, siteUrl, returnOrigin, isWorldHost, isSiteOrigin, hostRole
    }));
  }
  w.MCC_SITE = makeSite(deepFreeze({
    "schema": "mccluster-site-hosts/v1",
    "record": "mccluster-domain-architecture/v2",
    "stage": "P1",
    "switches": {"platform_serves":"everything","profile_host_routed":false,"carry":true,"returns_fallback":"platform","metadata":"today"},
    "platform": {"origin":"https://mccluster.org","host":"mccluster.org","website_id":"https://mccluster.org/#website","site_name":"McCluster Corp","operator_id":"https://matthew.mccluster.org/#mccluster-corp","front_door_path":"/index.html","app_start_path":"/","world_url":"https://mccluster.org/","static_origin":"https://matthew.mccluster.org","own_paths":{"generated":["/company","/robots.txt","/sitemap.xml","/llms.txt"],"subtrees":["/news"]}},
    "profile": {"key":"matthew","host":"matthew.mccluster.org","origin":"https://matthew.mccluster.org","entity_id":"https://matthew.mccluster.org/#matthew-mccluster","website_id":"https://matthew.mccluster.org/#website","site_name":"Matthew McCluster","root_path":"/","carry_path":"/carry.html","sets":["profile","profile_only"],"own_paths":{"generated":[],"subtrees":[]}},
    "tenants": [{"key":"matthew","host":"matthew.mccluster.org","origin":"https://matthew.mccluster.org","entity_id":"https://matthew.mccluster.org/#matthew-mccluster","website_id":"https://matthew.mccluster.org/#website","site_name":"Matthew McCluster","root_path":"/","carry_path":"/carry.html","sets":["profile","profile_only"],"own_paths":{"generated":[],"subtrees":[]}}],
    "doors": [{"host":"www.mccluster.org","origin":"https://www.mccluster.org","to":"platform","to_origin":"https://mccluster.org","served_by":"worker:mccluster","state":"routed","api_cors":false},{"host":"humanuprise.com","origin":"https://humanuprise.com","to":"platform","to_origin":"https://mccluster.org","served_by":"worker:mccluster","state":"inert until the owner routes it","api_cors":true},{"host":"www.humanuprise.com","origin":"https://www.humanuprise.com","to":"platform","to_origin":"https://mccluster.org","served_by":"worker:mccluster","state":"inert until the owner routes it","api_cors":true},{"host":"here.mccluster.org","origin":"https://here.mccluster.org","to":"tenants.matthew","to_origin":"https://matthew.mccluster.org","served_by":"cloudflare-zone-redirect-rule","state":"routed","api_cors":false}],
    "world_hosts": ["mccluster.org","www.mccluster.org","humanuprise.com","www.humanuprise.com"],
    "world_origins": ["https://mccluster.org","https://www.mccluster.org","https://humanuprise.com","https://www.humanuprise.com"],
    "site_origins": ["https://matthew.mccluster.org","https://mccluster.org","https://www.mccluster.org","https://humanuprise.com","https://www.humanuprise.com"],
    "site_hosts": ["matthew.mccluster.org","mccluster.org","www.mccluster.org","humanuprise.com","www.humanuprise.com"],
    "frame_ancestors": ["'self'","https://matthew.mccluster.org","https://mccluster.org","https://www.mccluster.org","https://humanuprise.com","https://www.humanuprise.com"],
    "cors_origins": ["https://matthew.mccluster.org","https://mccluster.org","https://humanuprise.com","https://www.humanuprise.com"],
    "return_origins": ["https://mccluster.org","https://matthew.mccluster.org"],
    "return_fallback_origin": "https://mccluster.org",
    "cookie_domain": "mccluster.org",
    "ids": {"person":"https://matthew.mccluster.org/#matthew-mccluster","organization":"https://matthew.mccluster.org/#mccluster-corp","platform_website":"https://mccluster.org/#website","profile_website":"https://matthew.mccluster.org/#website"},
    "entity_urls": {"person":"https://matthew.mccluster.org/matthew-mccluster.html","organization":"https://mccluster.org/"},
    "world": {"document":"/mnet.html","root":"/","query_keys":["view","mission"],"rooms":["/action-globe.html","/action-policy.html","/world-news.html","/create.html","/give.html","/privacy.html","/account.html","/login.html","/forgot-password.html","/reset-password.html","/onboard.html","/sw.js"],"room_prefixes":["/action-network-","/action/","/auth/","/js/","/css/","/assets/","/data/","/vendor/"]},
    "both_hosts": {"paths":["/sw.js","/manifest.json","/embed.html","/carry.html"],"prefixes":["/js/","/css/","/assets/","/data/","/vendor/","/.well-known/"]},
    "pages": {"platform":["/404.html","/account.html","/action-globe.html","/action-network-artist.html","/action-network-audio-engineer.html","/action-network-clippers.html","/action-network-cohorts.html","/action-network-discovery.html","/action-network-hire.html","/action-network-influencers.html","/action-network-producer.html","/action-network-video-editor.html","/action-network-videographer.html","/action-policy.html","/action/","/action/league.html","/admin.html","/album.html","/analytics.html","/archive.html","/artist.html","/auth/","/auth/seek-first-handoff.html","/auth/seek-first-start.html","/brand.html","/brief.html","/catalogue.html","/chat.html","/city-arcade.html","/cohort-claim.html","/cohort-profile.html","/console.html","/control.html","/create.html","/creator-template-motion-preview.html","/creator.html","/crm.html","/dashboard.html","/data/front-projects/vaunt-original.html","/demo.html","/demos/prim3-courtyard/","/demos/shiloh/","/demos/shiloh/admin.html","/demos/shiloh/golive.html","/demos/shiloh/guide.html","/demos/shiloh/setup.html","/desk.html","/docket-516.html","/docket-516r-cohort.html","/ecosystem.html","/embed.html","/equity-uprise-cohort-2026.html","/equity-uprise-server-lab-3d.html","/equity-uprise.html","/feed.html","/fellow-onboarding.html","/fellowship.html","/fellowships.html","/fictional-city.html","/finance-dev.html","/forgot-password.html","/front-studio.html","/front.html","/game-hub.html","/give.html","/guest-globe.html","/heal-the-3rd-world.html","/help.html","/hire.html","/identity-verify.html","/inbox.html","/insights.html","/lanes.html","/lb-harness.html","/license.html","/listen.html","/live-mission.html","/login.html","/management.html","/mccluster-corp.html","/mccluster-creator-studio.html","/mccluster-creator.html","/mccluster-platform.html","/member-front.html","/mnet.html","/music-admin.html","/music-creator-terms.html","/music-creator.html","/music-videos.html","/oauth/consent/","/onboard.html","/pay.html","/prim3-artist.html","/prim3-city-tactics.html","/prim3-courtyard.html","/prim3-level-builder/","/prim3-mission.html","/prim3-range.html","/prim3-released-mission.html","/prim3-tactics-preview.html","/prim3-transit.html","/prim3-world.html","/prim3.html","/privacy.html","/profile.html","/purchase.html","/receipt.html","/research.html","/reset-password.html","/screens/building.html","/screens/departures.html","/screens/evidence.html","/screens/kiosk.html","/screens/noc.html","/screens/studio.html","/screens/terminal.html","/screens/vms.html","/screens/wall.html","/services.html","/sites-details.html","/sites.html","/sponsor.html","/studio.html","/topics.html","/tracks/antisocial.html","/tracks/here.html","/tracks/lightroom.html","/tracks/runway-walk.html","/tracks/who-did-the-shoot.html","/tracks/write-a-song.html","/uprise-admin.html","/uprise-fellowship.html","/vault.html","/verify.html","/weather-desk.html","/world-news.html"],"profile":["/","/card.html","/carry.html","/case-designer-kicks.html","/cut.html","/door.html","/engineering/","/engineering/data-center-networking.html","/engineering/field-technology-telematics.html","/engineering/ipc-infrastructure.html","/engineering/it-support-systems.html","/engineering/mccluster-platform.html","/engineering/recruiter-role-map.html","/films.html","/gallery.html","/matthew-mccluster.html","/newsroom.html","/policy-memo-dna.html","/policy.html","/portfolio.html","/portfolio/onyx-elite.html","/press.html","/prints.html","/production.html","/resume-digital-inclusion.html","/resume-it-support.html","/role.html","/shots.html","/walls.html","/walls/brunch-and-beats.html","/walls/candler-crossing.html","/walls/cover-art.html","/walls/dressed-for-success.html","/walls/eu-rally.html","/walls/vaunt-runway.html"],"profile_only":["/closet/commission.html","/closet/sent.html","/fbi.html","/inner-room.html","/merch.html","/prayer-closet.html","/we-manufacture.html","/whip.html","/whip/","/whip/driver/","/whip/rentals/","/whip/rider/","/whip/rider/operator.html"]},
    "promoted": [{"prefix":"/site0/","set":"platform"}]
  }));
})(typeof window !== 'undefined' ? window : this);
/* END GENERATED SITE HOSTS */
/* Before first paint: reserve navigation while the server verifies this session.
   This is only a visual loading state. It never grants an owner role. */
(function () {
  'use strict';
  const h = document.documentElement;
  const topLevel = window.parent === window;
  const displayMode = window.matchMedia && window.matchMedia('(display-mode: standalone)');
  // Frames share the app's presentation, but only the outer document consumes
  // the device inset. This also runs before a retained World frame first paints.
  function appMode() {
    const installed = window.navigator.standalone === true || !!(displayMode && displayMode.matches);
    h.classList.toggle('mcc-installed-app', installed);
    h.classList.toggle('mcc-app-top', installed && topLevel);
  }
  appMode();
  if (displayMode && displayMode.addEventListener) displayMode.addEventListener('change', appMode);
  else if (displayMode && displayMode.addListener) displayMode.addListener(appMode);
  if (!topLevel) {
    /* A MUSIC VIEW (music slice M5, js/music-shell.js). Only the music shell's own frame is ever looked at: the
       World's (another origin), Control's front-page preview and any embed are left exactly as they were. A music
       page there carries <html data-music-view> and is adopted before any other script runs; its own bar and chip
       are hidden before first paint (the retained document's are the one bar). Any other document in that frame
       (a script navigation, the service worker's offline index.html) is stopped before its body and handed back to
       the shell to route, so the front page never renders in a frame. */
    try {
      const shell = window.parent.MCC_MUSIC_SHELL, frame = window.frameElement;
      if (shell && frame && typeof shell.owns === 'function' && shell.owns(frame)) {
        const view = h.hasAttribute('data-music-view') ? shell.adopt(window) : null;
        if (view) {
          window.MCC_MUSIC_VIEW = view;
          h.classList.add('mcc-music-view');
          const own = document.createElement('style');
          own.textContent = 'html.mcc-music-view .appbar,html.mcc-music-view .mcc-auth-nav,html.mcc-music-view #musicMini,html.mcc-music-view #musicNow,html.mcc-music-view .pocket,html.mcc-music-view #mccPrivacyNotice{display:none!important}html.mcc-music-view body{padding-bottom:var(--mcc-view-clear,0px)!important}html.mcc-music-view [data-mcc-view-heading]:focus{outline:none;box-shadow:none}';
          document.head.appendChild(own);
        } else {
          window.stop();
          shell.unexpected(window);
        }
      }
    } catch (e) { /* a parent on another origin: not the shell's frame */ }
    return;
  }
  h.classList.add('mcc-shell-pending');
  const style = document.createElement('style');
  style.textContent = 'html.mcc-shell-pending .appbar,html.mcc-shell-pending .cr-sections,html.mcc-shell-pending #cpGate{visibility:hidden!important}html.halo-loading #deck,html.halo-loading body>header,html.halo-loading .world-mode,html.halo-loading .world-tools,html.halo-loading .globe-controls,html.halo-loading .globe-data,html.halo-loading #worldFeed{visibility:hidden!important}html.halo-loading body::after{content:"Opening Halo…";position:fixed;top:24px;left:24px;color:#d8e4ef;font:14px system-ui;z-index:4}';
  document.head.appendChild(style);
  const halo = /action-globe\.html$/.test(location.pathname) && new URLSearchParams(location.search).has('halo');
  if (halo) h.classList.add('halo-loading');
  // A missing script must not strand the page without its ordinary navigation.
  let fallback = setTimeout(() => h.classList.remove('mcc-shell-pending','halo-loading'), 12000);
  window.MCC_SHELL = Object.freeze({
    navigationReady() { h.classList.remove('mcc-shell-pending'); },
    haloReady() { h.classList.remove('halo-loading'); },
    clear() { clearTimeout(fallback); h.classList.remove('mcc-shell-pending','halo-loading'); }
  });
})();
