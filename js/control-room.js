/* McCluster Control Room
   One responsive operator surface over the canonical McCluster control plane.
   Backend authority stays with api.mccluster.org + the existing Supabase session.
   This file owns spatial composition and navigation only; it does not create a
   second auth, data, job, CRM, messaging, media, or infrastructure backend. */
(function () {
  "use strict";

  var API = "https://api.mccluster.org";
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    surface: "home",
    workView: "inbox",
    createView: "campaigns",
    systemView: "overview",
    health: null,
    status: null,
    apps: [],
    inspector: null,
    loading: false,
    error: null
  };

  var SURFACES = ["home", "work", "create", "system", "apps"];
  var WORK_VIEWS = ["inbox", "pipeline", "people", "companies", "clients", "tasks", "orders", "bookings"];
  var CREATE_VIEWS = ["campaigns", "canvas", "assets", "calendar", "published"];
  var SYSTEM_VIEWS = ["overview", "agents", "runs", "infrastructure", "deployments", "api", "integrations", "usage", "logs"];

  var bridge = {
    desk: { title: "Live conversations", href: "chat.html", subtitle: "Current desk and live conversation surface" },
    crm: { title: "CRM", href: "crm.html", subtitle: "Current people, leads, and opportunity surface" },
    backOffice: { title: "Back Office", href: "admin.html", subtitle: "Current requests, orders, bookings, rights, and shop operations" },
    sites: { title: "Sites & clients", href: "sites.html", subtitle: "Current operator site and client work" },
    studio: { title: "Studio", href: "studio.html", subtitle: "Current image, video, 3D, modify, extend, and reframe tools" },
    assets: { title: "Asset Lab", href: "asset-lab.html", subtitle: "Current asset workspace" },
    management: { title: "Management", href: "management.html", subtitle: "Current management and operations workspace" },
    whip: { title: "Whip", href: "whip.html", subtitle: "Mobility product surface" },
    prim3: { title: "PRIM3", href: "prim3.html", subtitle: "PRIM3 product surface" },
    halo: { title: "Hitman Halo", href: "prayer-closet.html", subtitle: "Specialized Halo workspace" },
    manufacture: { title: "WE Manufacture", href: "we-manufacture.html", subtitle: "Manufacturing workspace" },
    spatial: { title: "Spatial Intelligence", href: API + "/internal/seek-first", subtitle: "Protected Seek First spatial console", external: true }
  };

  function esc(value) {
    var d = document.createElement("i");
    d.textContent = value == null ? "" : String(value);
    return d.innerHTML;
  }

  function text(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback == null ? "—" : fallback;
    return String(value);
  }

  function num(value) {
    return value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : String(value);
  }

  function count(value) {
    return value === null || value === undefined || Number.isNaN(Number(value)) ? 0 : Number(value);
  }

  function plural(n, singular, pluralWord) {
    return n + " " + (n === 1 ? singular : (pluralWord || singular + "s"));
  }

  function token() {
    return (window.MCC_SUPA && window.MCC_SUPA.token) ? window.MCC_SUPA.token() : Promise.resolve(null);
  }

  function note(message, isError) {
    var n = $("cpNote");
    if (!n) return;
    n.textContent = message || "";
    n.className = "cr-note" + (isError ? " is-err" : "");
  }

  function stamp() {
    var l = document.querySelector('link[href*="style.css?v="]');
    var m = l && l.getAttribute("href").match(/v=([^&\"]+)/);
    var v = m && m[1];
    return (!v || v === "__STAMP__") ? null : v;
  }

  function formatTime(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
    } catch (e) { return String(iso); }
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
    } catch (e) { return String(iso); }
  }

  function titleCase(value) {
    return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function currentView() {
    if (state.surface === "work") return state.workView;
    if (state.surface === "create") return state.createView;
    if (state.surface === "system") return state.systemView;
    return state.surface;
  }

  function routeHash() {
    if (state.surface === "work") return "#work:" + state.workView;
    if (state.surface === "create") return "#create:" + state.createView;
    if (state.surface === "system") return "#system:" + state.systemView;
    return "#" + state.surface;
  }

  function readHash() {
    var raw = (location.hash || "#home").slice(1).toLowerCase();
    var parts = raw.split(":");
    var surface = SURFACES.indexOf(parts[0]) >= 0 ? parts[0] : "home";
    state.surface = surface;
    if (surface === "work" && WORK_VIEWS.indexOf(parts[1]) >= 0) state.workView = parts[1];
    if (surface === "create" && CREATE_VIEWS.indexOf(parts[1]) >= 0) state.createView = parts[1];
    if (surface === "system" && SYSTEM_VIEWS.indexOf(parts[1]) >= 0) state.systemView = parts[1];
  }

  function setHash(replace) {
    var next = routeHash();
    if (location.hash === next) return;
    if (replace && history.replaceState) history.replaceState(null, "", next);
    else location.hash = next;
  }

  function setSurface(surface, view, replace) {
    if (SURFACES.indexOf(surface) < 0) return;
    state.surface = surface;
    if (surface === "work" && WORK_VIEWS.indexOf(view) >= 0) state.workView = view;
    if (surface === "create" && CREATE_VIEWS.indexOf(view) >= 0) state.createView = view;
    if (surface === "system" && SYSTEM_VIEWS.indexOf(view) >= 0) state.systemView = view;
    closeInspector();
    setHash(replace);
    render();
    try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); }
  }

  function stateClass(kind) {
    return "cr-state cr-state--" + (kind || "info");
  }

  function row(title, subtitle, value, kind, action, extra) {
    var attrs = action ? ' data-action="' + esc(action) + '"' : "";
    if (extra && extra.href) attrs += ' data-href="' + esc(extra.href) + '"';
    if (extra && extra.key) attrs += ' data-key="' + esc(extra.key) + '"';
    return '<button class="cr-row" type="button"' + attrs + '>' +
      '<span class="cr-row__main"><span class="cr-row__title">' +
      (kind ? '<span class="' + stateClass(kind) + '">' + esc(extra && extra.badge ? extra.badge : titleCase(kind)) + '</span>' : "") +
      '<span>' + esc(title) + '</span></span>' +
      (subtitle ? '<span class="cr-row__sub">' + esc(subtitle) + '</span>' : "") +
      '</span><span class="cr-row__value">' + esc(value || "›") + '</span></button>';
  }

  function panel(title, meta, body, span) {
    return '<section class="cr-panel ' + (span || "cr-span-6") + '">' +
      '<header class="cr-panel__head"><h2>' + esc(title) + '</h2>' + (meta ? '<span class="cr-panel__meta">' + esc(meta) + '</span>' : "") + '</header>' +
      body + '</section>';
  }

  function empty(title, body, actionLabel, action) {
    return '<div class="cr-canvas__empty"><div><strong>' + esc(title) + '</strong><div>' + esc(body || "") + '</div>' +
      (actionLabel && action ? '<button class="cr-btn cr-btn--primary" type="button" data-action="' + esc(action) + '" style="margin-top:14px">' + esc(actionLabel) + '</button>' : "") +
      '</div></div>';
  }

  function viewOptions(values, selected) {
    return values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === selected ? " selected" : "") + '>' + esc(titleCase(v)) + '</option>'; }).join("");
  }

  function renderHeader(title, subtitle, selector) {
    var controls = "";
    if (selector) {
      controls += '<select id="crViewSelect" class="cr-select" aria-label="Change view">' + viewOptions(selector.values, selector.selected) + '</select>';
    }
    controls += '<button class="cr-btn cr-btn--ghost" type="button" data-action="refresh">Refresh</button>';
    return '<header class="cr-surface__head"><div><h1 class="cr-surface__title">' + esc(title) + '</h1>' +
      (subtitle ? '<p class="cr-surface__subtitle">' + esc(subtitle) + '</p>' : "") +
      '</div><div class="cr-surface__tools">' + controls + '</div></header>';
  }

  function renderNav() {
    document.querySelectorAll("[data-surface]").forEach(function (el) {
      var active = el.getAttribute("data-surface") === state.surface;
      el.classList.toggle("is-active", active);
      if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    var title = $("crTopTitle");
    if (title) title.textContent = titleCase(state.surface);
  }

  function renderTopStatus() {
    var dot = $("crHealthDot");
    if (dot) {
      dot.className = "cr-health-dot" + (state.health && state.health.ok ? " is-up" : (state.error ? " is-down" : ""));
      dot.title = state.health && state.health.ok ? "API healthy" : "API status unavailable";
    }
    var user = state.status && state.status.operator && state.status.operator.email;
    var initial = user ? String(user).charAt(0).toUpperCase() : "M";
    var av = $("crAccount");
    if (av) av.textContent = initial;
    var email = $("crAccountEmail");
    if (email) email.textContent = user || "signed in";
  }

  function attentionItems() {
    var items = [];
    if (!state.health || !state.health.ok) items.push({ title: "API health unavailable", sub: "api.mccluster.org did not report healthy on the last refresh.", kind: "bad", action: "system-infrastructure" });
    if (state.status && state.status.database && !state.status.database.reachable) items.push({ title: "Database unavailable", sub: "The Control Room could not confirm canonical Supabase reachability.", kind: "bad", action: "system-infrastructure" });
    if (state.status && state.status.harness && state.status.harness.ok === false) items.push({ title: "AI harness needs attention", sub: "The canonical ai_context harness did not report healthy.", kind: "warn", action: "system-agents" });
    return items;
  }

  function renderHome() {
    var c = state.status && state.status.counts || {};
    var inbox = count(c.inbox_messages_in);
    var convos = count(c.conversations);
    var requests = count(c.site_requests);
    var apps = count(c.apps_enabled);
    var at = state.status && state.status.checked_at;
    var attention = attentionItems();
    var attentionRows = attention.length ? attention.map(function (it) {
      return row(it.title, it.sub, "Inspect", it.kind, it.action, { badge: it.kind === "bad" ? "Issue" : "Review" });
    }).join("") : '<div class="cr-panel__body"><span class="' + stateClass("ok") + '">All clear</span><p style="margin:10px 0 0;color:var(--cr-dim);font-size:12px;line-height:1.5">No failure is currently reported by the Control Room health instruments.</p></div>';

    var systemRows = row("API Worker", state.health && state.health.ok ? "api.mccluster.org · mccluster" : "Health response unavailable", state.health && state.health.ok ? "Healthy" : "Check", state.health && state.health.ok ? "ok" : "bad", "system-infrastructure") +
      row("Database", state.status && state.status.database && state.status.database.reachable ? "Canonical Supabase reachable" : "Reachability unavailable", state.status && state.status.database && state.status.database.reachable ? "Healthy" : "Check", state.status && state.status.database && state.status.database.reachable ? "ok" : "warn", "system-infrastructure") +
      row("AI harness", state.status && state.status.harness && state.status.harness.ok ? "Canonical context plane reporting healthy" : "Open System for details", state.status && state.status.harness && state.status.harness.ok ? "Healthy" : "Inspect", state.status && state.status.harness && state.status.harness.ok ? "ai" : "warn", "system-agents");

    return renderHeader("Home", "The operating surface: exceptions first, then the current pulse.") +
      '<section class="cr-command-hero"><h1>What do you want to work on?</h1><div class="cr-command-hero__box">' +
      '<input id="crHeroInput" autocomplete="off" placeholder="Search or navigate McCluster…" aria-label="Search or navigate McCluster">' +
      '<button class="cr-btn cr-btn--primary" type="button" data-action="hero-command">Go</button></div>' +
      '<div class="cr-quick">' +
      '<button class="cr-chip" data-action="work-pipeline" type="button">Open pipeline</button>' +
      '<button class="cr-chip" data-action="work-inbox" type="button">Open inbox</button>' +
      '<button class="cr-chip" data-action="create-canvas" type="button">Create</button>' +
      '<button class="cr-chip" data-action="system-overview" type="button">System health</button>' +
      '<button class="cr-chip" data-action="apps" type="button">Apps</button>' +
      '</div></section>' +
      '<div class="cr-kpis" style="margin-bottom:12px">' +
      '<div class="cr-kpi"><div class="cr-kpi__label">Inbound messages</div><div class="cr-kpi__value">' + esc(num(c.inbox_messages_in)) + '</div><div class="cr-kpi__sub">instrumented total</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpi__label">Conversations</div><div class="cr-kpi__value">' + esc(num(c.conversations)) + '</div><div class="cr-kpi__sub">on the desk</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpi__label">Site requests</div><div class="cr-kpi__value">' + esc(num(c.site_requests)) + '</div><div class="cr-kpi__sub">filed</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpi__label">Apps enabled</div><div class="cr-kpi__value">' + esc(num(c.apps_enabled)) + '</div><div class="cr-kpi__sub">registered</div></div>' +
      '</div>' +
      '<div class="cr-grid">' +
      panel("Needs attention", attention.length ? plural(attention.length, "item") : "instrumented checks", '<div class="cr-list">' + attentionRows + '</div>', "cr-span-7") +
      panel("Platform pulse", at ? "checked " + formatTime(at) : "not checked", '<div class="cr-list">' +
        row("Messages", plural(inbox, "inbound message"), "Work", "info", "work-inbox") +
        row("Conversations", plural(convos, "conversation"), "Work", "info", "work-inbox") +
        row("Requests", plural(requests, "site request"), "Work", "info", "work-inbox") +
        row("Applications", plural(apps, "enabled app"), "Apps", "info", "apps") +
      '</div>', "cr-span-5") +
      panel("Signals", "live foundation", '<div class="cr-panel__body"><div class="cr-signal-map"><div class="cr-signal-map__legend"><span>Web / app events</span><span>Communications</span><span>Platform activity</span><span>Research layer next</span></div></div><p style="margin:10px 0 0;color:var(--cr-dim);font-size:11px;line-height:1.5">The visualization is intentionally lightweight for this first shell. It is the reserved home for canonical ingestion signals, not a second intelligence backend.</p></div>', "cr-span-7") +
      panel("System", state.health && state.health.ok ? "healthy" : "check", '<div class="cr-list">' + systemRows + '</div>', "cr-span-5") +
      '</div>';
  }

  function workBridgeFor(view) {
    if (view === "inbox") return bridge.desk;
    if (view === "pipeline" || view === "people" || view === "companies") return bridge.crm;
    if (view === "clients") return bridge.sites;
    if (view === "tasks") return bridge.management;
    if (view === "orders" || view === "bookings") return bridge.backOffice;
    return bridge.management;
  }

  function renderWorkInbox() {
    var c = state.status && state.status.counts || {};
    return '<div class="cr-canvas"><div class="cr-list">' +
      row("Conversations", "Canonical desk · inbound and live conversation work", num(c.conversations), "info", "inspect-bridge", { key: "desk", badge: "Messages" }) +
      row("Inbound messages", "Instrumented total reported by the current Control Plane status endpoint", num(c.inbox_messages_in), "info", "inspect-bridge", { key: "desk", badge: "Inbox" }) +
      row("Site requests", "Filed requests currently counted by the canonical Control Plane", num(c.site_requests), "warn", "inspect-bridge", { key: "backOffice", badge: "Request" }) +
      '</div></div>';
  }

  function renderWorkView(view) {
    if (view === "inbox") return renderWorkInbox();
    var b = workBridgeFor(view);
    var descriptions = {
      pipeline: "Sales and opportunity state belongs here. The current CRM stays live while its records are migrated into this shared workspace.",
      people: "Canonical people will be rendered as a shared table with one inspector. The current CRM remains the live record surface during migration.",
      companies: "Organizations and their related people and opportunities will share the same object graph and inspector.",
      clients: "Client, site, request, and commercial context will converge here rather than living in a separate Control Room.",
      tasks: "Tasks and next actions will be one Work view, linked to the same people, companies, opportunities, conversations, and system objectives.",
      orders: "Orders belong inside Work with customer and payment context, not in a separate Back Office room.",
      bookings: "Bookings belong inside Work with customer and activity context, not in a separate Back Office room."
    };
    return '<div class="cr-canvas">' + empty(titleCase(view) + " view", descriptions[view], "Open current live tool", "open-bridge:" + Object.keys(bridge).find(function (key) { return bridge[key] === b; })) + '</div>';
  }

  function renderWork() {
    return renderHeader("Work", "One business graph. Change the representation, not the application.", { values: WORK_VIEWS, selected: state.workView }) +
      '<div class="cr-workbar">' +
      '<input class="cr-workbar__search" id="crWorkSearch" type="search" placeholder="Search current Work view…" aria-label="Search current Work view">' +
      '<button class="cr-btn" data-action="filters" type="button">Filters</button>' +
      '<button class="cr-btn cr-btn--primary" data-action="new-work" type="button">+ New</button>' +
      '</div>' + renderWorkView(state.workView);
  }

  function createBridgeFor(view) {
    if (view === "assets") return bridge.assets;
    return bridge.studio;
  }

  function renderCreate() {
    var b = createBridgeFor(state.createView);
    var descriptions = {
      campaigns: "Campaigns will unify brief, research, generations, assets, variants, publishing, and performance around one campaign object.",
      canvas: "The production canvas becomes the connected visual workspace for research → concepts → assets → variants → posts.",
      assets: "Assets become first-class objects attached to campaigns and generations, with one consistent inspector.",
      calendar: "The publishing calendar remains part of Create, using the same campaign and post objects instead of becoming a separate scheduler room.",
      published: "Published work and its performance stay attached to the source campaign and assets."
    };
    var body = '<div class="cr-canvas">' + empty(titleCase(state.createView), descriptions[state.createView], state.createView === "assets" ? "Open Asset Lab" : "Open Studio", "open-bridge:" + (b === bridge.assets ? "assets" : "studio")) + '</div>';
    return renderHeader("Create", "Campaigns, media, assets, publishing, and performance in one production surface.", { values: CREATE_VIEWS, selected: state.createView }) + body;
  }

  function systemRows() {
    var s = state.status || {};
    var c = s.counts || {};
    var channelCount = Array.isArray(s.channels) ? s.channels.length : 0;
    var enabledChannels = Array.isArray(s.channels) ? s.channels.filter(function (ch) { return ch.enabled; }).length : 0;
    return [
      { title: "API Worker", sub: state.health && state.health.ok ? "api.mccluster.org · " + text(state.health.service, "mccluster") : "Health response unavailable", value: state.health && state.health.ok ? "Healthy" : "Check", kind: state.health && state.health.ok ? "ok" : "bad" },
      { title: "Database", sub: s.database && s.database.reachable ? "Canonical Supabase reachable" : "Reachability unavailable", value: s.database && s.database.reachable ? "Healthy" : "Check", kind: s.database && s.database.reachable ? "ok" : "warn" },
      { title: "Durable Object", sub: s.worker && s.worker.durable_object_bound ? "HereTenantAgent binding present" : "Binding not reported", value: s.worker && s.worker.durable_object_bound ? "Bound" : "Inspect", kind: s.worker && s.worker.durable_object_bound ? "ok" : "warn" },
      { title: "AI harness", sub: s.harness && s.harness.ok ? "ai_context harness healthy" : "Harness not healthy", value: s.harness && s.harness.ok ? "Healthy" : "Inspect", kind: s.harness && s.harness.ok ? "ai" : "warn" },
      { title: "Registered apps", sub: plural(count(c.apps_enabled), "enabled application"), value: num(c.apps_enabled), kind: "info" },
      { title: "Inbox channels", sub: channelCount ? enabledChannels + " of " + channelCount + " enabled" : "No channel list returned", value: channelCount ? enabledChannels + "/" + channelCount : "—", kind: "info" }
    ];
  }

  function renderSystemOverview() {
    var rows = systemRows();
    var s = state.status || {};
    return '<div class="cr-kpis" style="margin-bottom:12px">' +
      '<div class="cr-kpi"><div class="cr-kpi__label">API</div><div class="cr-kpi__value">' + (state.health && state.health.ok ? "UP" : "—") + '</div><div class="cr-kpi__sub">api.mccluster.org</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpi__label">Database</div><div class="cr-kpi__value">' + (s.database && s.database.reachable ? "UP" : "—") + '</div><div class="cr-kpi__sub">canonical truth</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpi__label">Harness</div><div class="cr-kpi__value">' + (s.harness && s.harness.ok ? "UP" : "—") + '</div><div class="cr-kpi__sub">ai_context</div></div>' +
      '<div class="cr-kpi"><div class="cr-kpi__label">Build</div><div class="cr-kpi__value" style="font-size:17px">' + esc(stamp() ? stamp().slice(0, 7) : "local") + '</div><div class="cr-kpi__sub">site stamp</div></div>' +
      '</div><div class="cr-canvas"><div class="cr-list">' + rows.map(function (it) { return row(it.title, it.sub, it.value, it.kind, "inspect-system", { key: it.title, badge: titleCase(it.kind) }); }).join("") + '</div></div>';
  }

  function renderSystemView(view) {
    if (view === "overview" || view === "infrastructure") return renderSystemOverview();
    var descriptions = {
      agents: "Agent roles, permissions, assignments, heartbeat, runtime, and spend will live here while Core remains the intelligence layer under every surface.",
      runs: "Autonomous and explicit executions will be represented as a dense run list with trace detail in the same inspector.",
      deployments: "Deployments stay technical and drillable here; Home only surfaces failures or attention-worthy changes.",
      api: "Platform consumers, keys, scopes, rate limits, and metering belong in the technical System surface.",
      integrations: "External connectors and channel health converge here for full-system inspection.",
      usage: "Operating cost, metering, model/media usage, and infrastructure consumption will be analyzed here without duplicating billing backends.",
      logs: "Logs and audit events become a technical view with filters and inspectors, not a separate Control Room."
    };
    return '<div class="cr-canvas">' + empty(titleCase(view), descriptions[view], "Open System overview", "system-overview") + '</div>';
  }

  function renderSystem() {
    return renderHeader("System", "The machine underneath McCluster. Dense when needed, quiet when healthy.", { values: SYSTEM_VIEWS, selected: state.systemView }) + renderSystemView(state.systemView);
  }

  function appCard(title, subtitle, href, meta, external) {
    var attr = href ? ' href="' + esc(href) + '"' : "";
    var target = external ? ' target="_blank" rel="noopener"' : "";
    return '<a class="cr-app-card"' + attr + target + '><strong>' + esc(title) + '</strong><small>' + esc(subtitle || "") + '</small><span class="cr-app-card__foot"><span>' + esc(meta || "Specialized app") + '</span><span>Open ↗</span></span></a>';
  }

  function renderApps() {
    var registered = state.apps || [];
    var reg = registered.length ? registered.map(function (a) {
      return appCard(a.name || a.app_key, [a.product_family, a.kind].filter(Boolean).join(" · ") || "Registered application", a.public_url || "", a.app_key || "registered app", true);
    }).join("") : '<div class="cr-panel__body" style="grid-column:1/-1;color:var(--cr-dim)">No registered apps were returned.</div>';
    var specialty = [bridge.whip, bridge.spatial, bridge.prim3, bridge.halo, bridge.manufacture].map(function (a) {
      return appCard(a.title, a.subtitle, a.href, "Specialized workspace", a.external);
    }).join("");
    return renderHeader("Apps", "Specialized products get dedicated interfaces without becoming permanent Control Room navigation.") +
      '<section style="margin-bottom:24px"><div class="cr-panel__head" style="padding-left:0;padding-right:0;border:0"><h2>Registered applications</h2><span class="cr-panel__meta">' + esc(num(registered.length)) + '</span></div><div class="cr-app-grid">' + reg + '</div></section>' +
      '<section><div class="cr-panel__head" style="padding-left:0;padding-right:0;border:0"><h2>Specialized workspaces</h2><span class="cr-panel__meta">launcher</span></div><div class="cr-app-grid">' + specialty + '</div></section>';
  }

  function renderLoading() {
    return renderHeader(titleCase(state.surface), "Loading canonical Control Room state…") + '<div class="cr-canvas">' + empty("Loading", "Reading the existing McCluster health, operator status, and app registry.") + '</div>';
  }

  function render() {
    renderNav();
    renderTopStatus();
    var root = $("crSurface");
    if (!root) return;
    if (state.loading && !state.status && !state.health) root.innerHTML = renderLoading();
    else if (state.surface === "home") root.innerHTML = renderHome();
    else if (state.surface === "work") root.innerHTML = renderWork();
    else if (state.surface === "create") root.innerHTML = renderCreate();
    else if (state.surface === "system") root.innerHTML = renderSystem();
    else root.innerHTML = renderApps();
    bindSurfaceControls();
  }

  function renderInspectorTabs(active) {
    var tabs = ["overview", "activity", "related", "ai"];
    var el = $("crInspectorTabs");
    if (!el) return;
    el.innerHTML = tabs.map(function (tab) {
      return '<button type="button" data-inspector-tab="' + tab + '" class="' + (tab === active ? "is-active" : "") + '">' + esc(titleCase(tab)) + '</button>';
    }).join("");
  }

  function inspectorSection(title, html) {
    return '<section class="cr-inspector__section"><h3>' + esc(title) + '</h3>' + html + '</section>';
  }

  function props(rows) {
    return '<div class="cr-props">' + rows.map(function (r) { return '<div class="cr-prop"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join("") + '</div>';
  }

  function openInspector(data) {
    state.inspector = data || { title: "Details" };
    if (!state.inspector.tab) state.inspector.tab = "overview";
    var panel = $("crInspector");
    var main = $("crMain");
    if (!panel) return;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    if (main) main.classList.add("has-inspector");
    renderInspector();
  }

  function closeInspector() {
    state.inspector = null;
    var panel = $("crInspector");
    var main = $("crMain");
    if (panel) { panel.classList.remove("is-open"); panel.setAttribute("aria-hidden", "true"); }
    if (main) main.classList.remove("has-inspector");
  }

  function renderInspector() {
    var data = state.inspector;
    if (!data) return;
    $("crInspectorTitle").textContent = data.title || "Details";
    $("crInspectorSub").textContent = data.subtitle || "McCluster Control Room";
    renderInspectorTabs(data.tab || "overview");
    var body = $("crInspectorBody");
    var html = "";
    if (data.tab === "overview") {
      if (data.props && data.props.length) html += inspectorSection("Overview", props(data.props));
      if (data.description) html += inspectorSection("Context", '<p style="margin:0;color:var(--cr-dim);font-size:12px;line-height:1.6">' + esc(data.description) + '</p>');
      if (data.href) html += '<div class="cr-inspector__actions"><button class="cr-btn cr-btn--primary" type="button" data-open-href="' + esc(data.href) + '">Open live tool</button></div>';
    } else if (data.tab === "activity") {
      html = inspectorSection("Activity", '<p style="margin:0;color:var(--cr-dim);font-size:12px;line-height:1.6">Activity for this object will use the same canonical events rather than keeping a second Control Room history.</p>');
    } else if (data.tab === "related") {
      html = inspectorSection("Related", '<p style="margin:0;color:var(--cr-dim);font-size:12px;line-height:1.6">Relationships will resolve through shared McCluster identities and object links. No duplicate business graph is created by this UI.</p>');
    } else {
      html = inspectorSection("AI", '<p style="margin:0;color:var(--cr-dim);font-size:12px;line-height:1.6">Contextual AI actions will route through canonical Core. This shell deliberately does not create a second model, memory, or job service.</p>');
      if (data.href) html += '<div class="cr-inspector__actions"><button class="cr-btn" type="button" data-open-href="' + esc(data.href) + '">Open current surface</button></div>';
    }
    body.innerHTML = html || '<p style="color:var(--cr-dim)">No details available.</p>';
    body.querySelectorAll("[data-open-href]").forEach(function (btn) {
      btn.addEventListener("click", function () { location.href = btn.getAttribute("data-open-href"); });
    });
  }

  function inspectBridge(key) {
    var b = bridge[key];
    if (!b) return;
    openInspector({
      title: b.title,
      subtitle: "Migration bridge",
      description: b.subtitle + ". This existing surface remains functional while its operator workflow is absorbed into the unified Control Room.",
      href: b.href,
      props: [["Destination", b.href], ["Authority", "Existing McCluster backend"], ["Migration", "No backend fork"]]
    });
  }

  function inspectSystem(key) {
    var status = state.status || {};
    var health = state.health || {};
    var data = { title: key || "System", subtitle: "Canonical McCluster platform", description: "Technical detail is shown here without forcing a page transition. The underlying infrastructure remains unchanged." };
    if (key === "API Worker") data.props = [["Service", text(health.service, "mccluster")], ["Healthy", health.ok ? "yes" : "not reported"], ["Endpoint", API]];
    else if (key === "Database") data.props = [["Reachable", status.database && status.database.reachable ? "yes" : "not reported"], ["Authority", "Supabase zmnhbrjyhxzhkxmhkexs"]];
    else if (key === "Durable Object") data.props = [["HereTenantAgent", status.worker && status.worker.durable_object_bound ? "bound" : "not reported"], ["Allowed origins", status.worker ? num(status.worker.allowed_origins) : "—"]];
    else if (key === "AI harness") data.props = [["Healthy", status.harness && status.harness.ok ? "yes" : "no"], ["Schema", text(status.harness && status.harness.schema, "ai_context")]];
    else data.props = [["Checked", formatDateTime(status.checked_at)], ["Build", stamp() ? stamp().slice(0, 7) : "local"]];
    openInspector(data);
  }

  function handleCommand(query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) { openPalette(); return; }
    var patterns = [
      { re: /\b(home|attention|today)\b/, fn: function () { setSurface("home"); } },
      { re: /\b(inbox|message|messages|conversation|conversations|desk)\b/, fn: function () { setSurface("work", "inbox"); } },
      { re: /\b(pipeline|lead|leads|deal|deals|opportunit)/, fn: function () { setSurface("work", "pipeline"); } },
      { re: /\b(people|person|contact|contacts)\b/, fn: function () { setSurface("work", "people"); } },
      { re: /\b(company|companies|organization|organizations)\b/, fn: function () { setSurface("work", "companies"); } },
      { re: /\b(client|clients|site|sites)\b/, fn: function () { setSurface("work", "clients"); } },
      { re: /\b(task|tasks|todo|to do)\b/, fn: function () { setSurface("work", "tasks"); } },
      { re: /\b(order|orders)\b/, fn: function () { setSurface("work", "orders"); } },
      { re: /\b(booking|bookings|appointment|appointments)\b/, fn: function () { setSurface("work", "bookings"); } },
      { re: /\b(asset|assets|library)\b/, fn: function () { setSurface("create", "assets"); } },
      { re: /\b(calendar|schedule|publishing)\b/, fn: function () { setSurface("create", "calendar"); } },
      { re: /\b(create|studio|media|campaign|campaigns|canvas|video|image)\b/, fn: function () { setSurface("create", "canvas"); } },
      { re: /\b(agent|agents|core|harness)\b/, fn: function () { setSurface("system", "agents"); } },
      { re: /\b(run|runs|job|jobs|trace|traces)\b/, fn: function () { setSurface("system", "runs"); } },
      { re: /\b(system|health|ovh|cloudflare|supabase|gpu|infrastructure)\b/, fn: function () { setSurface("system", "infrastructure"); } },
      { re: /\b(app|apps|whip|prim3|halo|spatial|seek first|manufacture)\b/, fn: function () { setSurface("apps"); } }
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      if (patterns[i].re.test(q)) { closePalette(); patterns[i].fn(); return; }
    }
    closePalette();
    openInspector({
      title: "Command routing",
      subtitle: "Canonical Core only",
      description: "This first UI slice can navigate the consolidated Control Room, but it will not fake free-form execution. The next command-runtime pass will route arbitrary actions through canonical McCluster Core rather than introducing a browser-side agent.",
      props: [["Requested", query], ["Result", "No safe UI route matched"], ["Backend", "Unchanged"]]
    });
  }

  function paletteCommands() {
    return [
      { label: "Home", hint: "Attention, pulse, signals", action: "home" },
      { label: "Work · Inbox", hint: "Conversations and incoming work", action: "work-inbox" },
      { label: "Work · Pipeline", hint: "Leads and opportunities", action: "work-pipeline" },
      { label: "Work · People", hint: "Canonical people", action: "work-people" },
      { label: "Work · Clients", hint: "Sites and client work", action: "work-clients" },
      { label: "Create · Canvas", hint: "Creative production", action: "create-canvas" },
      { label: "Create · Assets", hint: "Asset library", action: "create-assets" },
      { label: "System · Overview", hint: "Health and infrastructure", action: "system-overview" },
      { label: "System · Agents", hint: "Core workers", action: "system-agents" },
      { label: "System · Runs", hint: "Execution and traces", action: "system-runs" },
      { label: "Apps", hint: "Specialized products", action: "apps" }
    ];
  }

  function renderPalette(filter) {
    var q = String(filter || "").trim().toLowerCase();
    var list = paletteCommands().filter(function (item) { return !q || (item.label + " " + item.hint).toLowerCase().indexOf(q) >= 0; });
    var root = $("crPaletteResults");
    if (!root) return;
    root.innerHTML = list.length ? list.map(function (item, i) {
      return '<button class="cr-palette__item' + (i === 0 ? " is-active" : "") + '" type="button" data-action="' + esc(item.action) + '"><span>' + esc(item.label) + '</span><small>' + esc(item.hint) + '</small></button>';
    }).join("") : '<button class="cr-palette__item" type="button" data-command-query="' + esc(filter) + '"><span>Route “' + esc(filter) + '”</span><small>Use safe navigation / canonical Core boundary</small></button>';
    bindActions(root);
    root.querySelectorAll("[data-command-query]").forEach(function (btn) {
      btn.addEventListener("click", function () { handleCommand(btn.getAttribute("data-command-query")); });
    });
  }

  function openPalette() {
    var p = $("crPalette");
    if (!p) return;
    p.classList.add("is-open");
    p.setAttribute("aria-hidden", "false");
    var input = $("crPaletteInput");
    if (input) { input.value = ""; renderPalette(""); setTimeout(function () { input.focus(); }, 0); }
  }

  function closePalette() {
    var p = $("crPalette");
    if (p) { p.classList.remove("is-open"); p.setAttribute("aria-hidden", "true"); }
  }

  function openHref(href, external) {
    if (!href) return;
    if (external) window.open(href, "_blank", "noopener"); else location.href = href;
  }

  function runAction(action, el) {
    if (!action) return;
    if (action.indexOf("open-bridge:") === 0) { inspectBridge(action.split(":")[1]); return; }
    if (action === "inspect-bridge") { inspectBridge(el && el.getAttribute("data-key")); return; }
    if (action === "inspect-system") { inspectSystem(el && el.getAttribute("data-key")); return; }
    if (action === "home") setSurface("home");
    else if (action === "work-inbox") setSurface("work", "inbox");
    else if (action === "work-pipeline") setSurface("work", "pipeline");
    else if (action === "work-people") setSurface("work", "people");
    else if (action === "work-clients") setSurface("work", "clients");
    else if (action === "create-canvas") setSurface("create", "canvas");
    else if (action === "create-assets") setSurface("create", "assets");
    else if (action === "system-overview") setSurface("system", "overview");
    else if (action === "system-infrastructure") setSurface("system", "infrastructure");
    else if (action === "system-agents") setSurface("system", "agents");
    else if (action === "system-runs") setSurface("system", "runs");
    else if (action === "apps") setSurface("apps");
    else if (action === "refresh") load(true);
    else if (action === "filters") openInspector({ title: "Filters", subtitle: titleCase(currentView()), description: "Filter UI will remain view-specific while sharing one inspector/sheet primitive across desktop and mobile.", props: [["View", titleCase(currentView())], ["Layout", window.innerWidth <= 760 ? "full-screen sheet" : "inspector"]] });
    else if (action === "new-work") openInspector({ title: "Create Work object", subtitle: titleCase(state.workView), description: "Creation will use the canonical object endpoint for the selected Work view. This shell does not manufacture a parallel browser-only record.", props: [["View", titleCase(state.workView)], ["State", "UI foundation ready"]] });
    else if (action === "hero-command") { var input = $("crHeroInput"); handleCommand(input && input.value); }
  }

  function bindActions(root) {
    (root || document).querySelectorAll("[data-action]").forEach(function (el) {
      if (el.getAttribute("data-bound-action") === "1") return;
      el.setAttribute("data-bound-action", "1");
      el.addEventListener("click", function () { runAction(el.getAttribute("data-action"), el); });
    });
  }

  function bindSurfaceControls() {
    bindActions($("crSurface"));
    var select = $("crViewSelect");
    if (select) select.addEventListener("change", function () {
      if (state.surface === "work") setSurface("work", select.value);
      else if (state.surface === "create") setSurface("create", select.value);
      else if (state.surface === "system") setSurface("system", select.value);
    });
    var hero = $("crHeroInput");
    if (hero) hero.addEventListener("keydown", function (e) { if (e.key === "Enter") handleCommand(hero.value); });
  }

  function load(force) {
    if (state.loading && !force) return Promise.resolve();
    state.loading = true;
    state.error = null;
    render();
    var health = fetch(API + "/health", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var authed = token().then(function (t) {
      if (!t) return { status: null, apps: [] };
      var h = { authorization: "Bearer " + t };
      return Promise.all([
        fetch(API + "/v1/status", { headers: h, cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch(API + "/v1/apps", { headers: h, cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      ]).then(function (both) { return { status: both[0], apps: both[1] && Array.isArray(both[1].apps) ? both[1].apps : [] }; });
    });
    return Promise.all([health, authed]).then(function (r) {
      state.health = r[0];
      state.status = r[1].status;
      state.apps = r[1].apps;
      if (!state.status) state.error = "Operator status unavailable";
    }).catch(function () {
      state.error = "Control Room state unavailable";
    }).then(function () {
      state.loading = false;
      render();
    });
  }

  function boot() {
    $("cpGate").hidden = true;
    $("crApp").hidden = false;
    readHash();
    setHash(true);
    render();
    load();
  }

  function bindAuth() {
    $("cpIn").addEventListener("click", function () {
      var em = $("cpEmail").value.trim();
      var pw = $("cpPass").value;
      if (!em) { note("Email first.", true); return; }
      if (!pw) { note("No password? Use the sign-in link below.", true); return; }
      var b = $("cpIn");
      b.disabled = true;
      b.textContent = "Opening…";
      window.MCC_AUTH.signInPassword(em, pw).then(boot).catch(function (e) {
        b.disabled = false;
        b.textContent = "Open Control Room";
        note(String(e && e.message || e), true);
      });
    });
    $("cpPass").addEventListener("keydown", function (e) { if (e.key === "Enter") $("cpIn").click(); });
    $("cpLink").addEventListener("click", function () {
      var em = $("cpEmail").value.trim();
      if (!em) { note("Email first.", true); return; }
      var b = $("cpLink");
      b.disabled = true;
      b.textContent = "Sending…";
      window.MCC_AUTH.signIn(em).then(function () {
        b.textContent = "Link sent";
        note("Check " + em + ". The link opens this page signed in.");
      }).catch(function (e) {
        b.disabled = false;
        b.textContent = "Email me a sign-in link";
        note(String(e && e.message || e), true);
      });
    });
  }

  function bindShell() {
    document.querySelectorAll("[data-surface]").forEach(function (el) {
      el.addEventListener("click", function () { setSurface(el.getAttribute("data-surface")); });
    });
    $("crCommandOpen").addEventListener("click", openPalette);
    $("crInspectorClose").addEventListener("click", closeInspector);
    $("crInspectorTabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-inspector-tab]");
      if (!b || !state.inspector) return;
      state.inspector.tab = b.getAttribute("data-inspector-tab");
      renderInspector();
    });
    $("crPalette").addEventListener("click", function (e) { if (e.target === $("crPalette")) closePalette(); });
    $("crPaletteInput").addEventListener("input", function () { renderPalette($("crPaletteInput").value); });
    $("crPaletteInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = $("crPaletteResults").querySelector(".cr-palette__item");
        if (first) first.click(); else handleCommand($("crPaletteInput").value);
      }
    });
    $("crAccount").addEventListener("click", function () { $("crAccountMenu").classList.toggle("is-open"); });
    $("crRefresh").addEventListener("click", function () { $("crAccountMenu").classList.remove("is-open"); load(true); });
    $("crOut").addEventListener("click", function () { window.MCC_AUTH.signOut().then(function () { location.reload(); }); });
    document.addEventListener("click", function (e) {
      if (!$("crAccountMenu").contains(e.target) && !$("crAccount").contains(e.target)) $("crAccountMenu").classList.remove("is-open");
    });
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
      if (e.key === "Escape") { if ($("crPalette").classList.contains("is-open")) closePalette(); else closeInspector(); }
    });
    window.addEventListener("hashchange", function () { readHash(); closeInspector(); render(); });
  }

  function tryResume() {
    token().then(function (t) { if (t && $("crApp").hidden) boot(); });
  }

  function init() {
    bindAuth();
    bindShell();
    bindActions(document);
    tryResume();
    setTimeout(tryResume, 900);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
