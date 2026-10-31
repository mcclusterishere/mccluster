/* THE ONE CONTROL ROOM NAVIGATION DEFINITION.

   Owner, 2026-10-30, after the consolidation mockup: "get that control room
   under wraps". Control used to carry seven surfaces and thirty-three views,
   described in five drifting places (the rail in control.html, the .cr-bottom
   bar, SURFACES / WORK_VIEWS / CREATE_VIEWS / SYSTEM_VIEWS in
   control-room-v2.js, the ⌘K list, js/control-registry.js and the route list
   in js/control-room/workspace-core.js). Every one of those now reads NAV.

   Shape: six sections → items (the section's tabs) → optional views (a
   segmented control inside the item). Each entry carries:
     id        stable id, unique inside its parent
     label     what the operator reads
     route     the canonical hash ("#people:inbox", "#sell:store:marketplace")
     renderer  the view function in control-room-v2.js that draws it
     was       the old routes ("#work:inbox") and old names ("Desk bot") that
               fold into it. Old hashes redirect through `was`, and the palette
               finds an entry by any of its old names.
     module    (optional) a window.CR module the view needs. A view whose
               module is not loaded renders "not available yet", so a later
               PR only has to register its renderer (marketplace, direct
               sales, lyrics and stems).
   `phone: true` puts a section on the phone bottom bar; the others live
   behind More on a phone and in the sidebar on a desktop.

   This file creates no data, permission or backend. It is presentation. */
(function (root) {
  "use strict";

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11.5h4.5V15h4v5.5h4.5V9"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
    sell: '<path d="M5 8h14l-1.2 12.5H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    create: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 8.5v7M8.5 12h7"/>',
    insights: '<path d="M4 20h16"/><path d="M7 16.5v-5M12 16.5v-10M17 16.5v-7"/>',
    system: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    spark: '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    bag: '<path d="M5 8h14l-1.2 12.5H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
    store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5h16v1a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 13.5a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 10.5z"/><path d="M5.5 13v7h13v-7"/>',
    card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>',
    frame: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.4" cy="9.8" r="1.7"/><path d="M3.6 17l4.9-4.4 3.9 3.4 3-2.5 5.1 4.2"/>',
    shirt: '<path d="M8 3.5 3.5 6.5l2 4 2-1V20.5h9V9.5l2 1 2-4L16 3.5c-.7 1.6-2.2 2.5-4 2.5S8.7 5.1 8 3.5z"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    note: '<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.2"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>'
  };

  function v(id, label, renderer, was, extra) {
    var out = { id: id, label: label, renderer: renderer, was: was || [] };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  var NAV = [
    { id: "home", label: "Home", icon: "home", phone: true, blurb: "Today: what needs you, what is running, and McCluster.", items: [
      v("today", "Today", "home.today", ["#home", "Home", "Control Room", "Needs you", "Recent activity", "Public record", "attention", "dashboard"]),
      v("ask", "Ask McCluster", "home.ask", ["#ai", "AI", "McCluster AI", "chat", "voice", "qwen", "resident model"])
    ] },
    { id: "people", label: "People", icon: "people", phone: true, blurb: "One inbox and one CRM list.", items: [
      v("inbox", "Inbox", null, [], { views: [
        v("conversations", "Conversations", "work.inbox", ["#work:inbox", "Work · Inbox", "messages", "conversations", "reply", "inbox.html"]),
        v("ai-reply", "AI reply", "work.desk-bot", ["#work:desk-bot", "Desk bot", "knowledge base", "kb", "refusals", "bot spend", "channels", "tools", "approvals", "desk.html"])
      ] }),
      v("contacts", "Contacts", "work.people", ["#work:people", "Work · People", "people", "person", "customers", "members"]),
      v("companies", "Companies", "work.companies", ["#work:companies", "Work · Companies", "organizations", "out_companies"]),
      v("deals", "Deals", null, [], { views: [
        v("pipeline", "Pipeline", "work.pipeline", ["#work:pipeline", "Work · Pipeline", "leads", "crm", "front desk", "opportunities", "crm.html"]),
        v("tasks", "Next actions", "work.tasks", ["#work:tasks", "Work · Tasks", "tasks", "todo"])
      ] }),
      v("clients", "Clients", null, [], { views: [
        v("clients", "Clients", "work.clients", ["#work:clients", "Work · Clients", "client console", "business console", "site requests", "console.html"]),
        v("relationships", "Relationships", "work.relationships", ["#work:relationships", "Work · Relationships", "partners", "sponsors", "vendors"]),
        v("projects", "Client projects", "work.projects", ["#work:projects", "Work · Projects", "service projects", "scope"]),
        v("deliverables", "Deliverables", "work.deliverables", ["#work:deliverables", "Work · Deliverables", "handoff", "approval"])
      ] }),
      v("outreach", "Outreach", "work.outreach", ["#work:outreach", "Work · Outreach", "outreach desk", "email campaign", "follow-up", "templates", "unsubscribe"])
    ] },
    { id: "sell", label: "Sell", icon: "sell", phone: true, blurb: "Orders, payments, the store and music.", items: [
      v("orders", "Orders", null, [], { views: [
        v("all", "All orders", "sell.orders", ["Orders & bookings", "print orders", "merch orders", "marketplace orders", "music orders"]),
        v("order-records", "Order records", "work.orders", ["#work:orders", "Work · Orders", "orders"]),
        v("booking-records", "Bookings", "work.bookings", ["#work:bookings", "Work · Bookings", "bookings", "appointments"])
      ] }),
      v("payments", "Payments & renewals", null, [], { views: [
        v("payments", "Payments", "work.payments", ["#work:payments", "Work · Payments", "invoices", "billing", "revenue"]),
        v("renewals", "Renewals", "work.renewals", ["#work:renewals", "Work · Renewals", "recurring", "hosting", "retainer", "subscription"])
      ] }),
      v("store", "Store", null, [], { views: [
        v("operations", "Shop & operations", "work.operations", ["#work:operations", "Work · Operations", "back office", "prints", "merch", "walls", "rights", "shop", "admin.html"]),
        v("marketplace", "Marketplace", "slot", ["Marketplace sellers", "seller applications", "listings"], { module: "marketplace" }),
        v("direct", "Direct sales", "slot", ["Direct music sales", "direct checkout", "music downloads", "on sale"], { module: "musicDirect" })
      ] }),
      v("music", "Music", null, [], { views: [
        v("catalog", "Review & catalog", "create.music", ["#create:music", "Create · Music", "music review", "catalogue", "isrc", "distribution", "rights", "vault", "lanes", "music-admin.html", "vault.html", "lanes.html"]),
        v("lyrics", "Lyrics & stems", "slot", ["Lyrics review", "stems"], { module: "lyrics" })
      ] })
    ] },
    { id: "create", label: "Create", icon: "create", phone: true, blurb: "Make it, then publish it.", items: [
      v("projects", "Projects & library", null, [], { views: [
        v("projects", "Projects", "create.projects", ["#create:projects", "Create · Projects", "studio", "generate", "media", "campaigns", "canvas", "studio.html"]),
        v("library", "Library", "create.library", ["#create:library", "Create · Library", "assets", "files"])
      ] }),
      v("publish", "Publish", null, [], { views: [
        v("channels", "Channels", "create.channels", ["#create:channels", "Create · Channels", "socials", "composer", "social accounts", "management.html"]),
        v("instagram", "Instagram", "create.instagram", ["#create:instagram", "Create · Instagram", "ig", "reels", "social agent"]),
        v("schedule", "Schedule", "create.schedule", ["#create:schedule", "Create · Schedule", "calendar", "published", "publishing queue"])
      ] }),
      v("front-page", "Front page", "create.front-page", ["#create:front-page", "Create · Front page", "homepage", "site"]),
      v("clipping", "Clipping", "create.clipping", ["#create:clipping", "Create · Clipping", "clips"]),
      v("song-test", "Song test", "create.song-test", ["#create:song-test", "Create · Song test", "song testing", "listening test"])
    ] },
    { id: "insights", label: "Insights", icon: "insights", phone: false, blurb: "The analytics deck and the Halo globe.", items: [
      v("overview", "Overview", "analytics.overview", ["#analytics", "Analytics", "insights.html", "analytics.html", "traffic", "visitors", "sessions", "page views"]),
      v("audience", "Audience", "analytics.audience", ["reach", "return visits", "referrers"]),
      v("journeys", "Journeys", "analytics.identity", ["identity", "funnel", "attribution"]),
      v("content", "Content", "analytics.content", ["music attention", "engagement"]),
      v("business", "Action & business", "analytics.action", ["sales analytics", "commerce", "participation"]),
      v("intelligence", "World intelligence", "analytics.intelligence", ["news context", "connections", "sources"]),
      v("cameras", "Cameras", "analytics.cameras", ["camera coverage"]),
      v("adaptive", "Adaptive", "analytics.adaptive", ["experiments", "decisions"]),
      v("health", "Site health", "analytics.forensics", ["forensics", "errors", "interrupted journeys", "telemetry"]),
      v("data", "Data explorer", "analytics.inventory", ["data coverage", "dataset health", "inventory"]),
      v("halo", "Halo globe", "insights.halo", ["Hitman's Halo", "halo", "globe", "action globe"])
    ] },
    { id: "system", label: "System", icon: "system", phone: false, blurb: "Platform, jobs, apps, build and Equity Uprise operations.", items: [
      v("overview", "Overview", "system.overview", ["#system:overview", "System · Overview", "health", "topology", "ovh", "cloudflare", "supabase", "infrastructure", "deployments"]),
      v("command", "Command", "system.command", ["#system:command", "System · Command", "capability bus", "objective", "approvals"]),
      v("workload", "Workload", "system.workload", ["#system:workload", "System · Workload", "jobs", "agents", "runs", "queues", "failures", "core"]),
      v("observability", "Observability", "system.observability", ["#system:observability", "System · Observability", "logs", "traces", "incidents"]),
      v("resources", "Resources", "system.resources", ["#system:resources", "System · Resources", "providers", "usage", "spend", "api", "integrations", "ai costs"]),
      v("apps", "Apps", "apps", ["#apps", "Apps", "whip", "prim3", "manufacture", "specialized workspaces"]),
      v("build", "Build", "create.build", ["#create:build", "Create · Build", "build code", "code", "draft pull request"]),
      v("uprise", "Equity Uprise ops", null, [], { views: [
        v("missions", "Missions & fellows", "create.action-network", ["#create:action-network", "Create · Action network", "missions", "fellows", "identity review", "memos", "uprise", "mobilize"]),
        v("funding", "Funding", "create.funding", ["#create:funding", "Create · Funding", "grants", "opportunity intelligence", "bounties"])
      ] })
    ] }
  ];

  /* Routes. A leaf is an item without views, or one view of an item. */
  NAV.forEach(function (s) {
    s.route = "#" + s.id;
    s.items.forEach(function (it) {
      it.route = "#" + s.id + ":" + it.id;
      (it.views || []).forEach(function (vw) { vw.route = it.route + ":" + vw.id; });
    });
  });

  function leaves() {
    var out = [];
    NAV.forEach(function (s) {
      s.items.forEach(function (it) {
        if (it.views && it.views.length) it.views.forEach(function (vw) { out.push({ section: s, item: it, view: vw, leaf: vw }); });
        else out.push({ section: s, item: it, view: null, leaf: it });
      });
    });
    return out;
  }
  var LEAVES = leaves();

  /* The old router's aliases (normalizeWorkView / normalizeCreateView /
     normalizeSystemView) and the bare surfaces, kept so every old link lands. */
  var LEGACY_ALIASES = {
    work: { crm: "pipeline", "front-desk": "pipeline", desk: "outreach", "outreach-desk": "outreach", admin: "operations", "back-office": "operations", "client-console": "clients", console: "clients" },
    create: { campaigns: "projects", canvas: "projects", studio: "projects", assets: "library", calendar: "schedule", published: "schedule", management: "channels", socials: "channels", "socials-room": "channels", "social-agent": "instagram", ig: "instagram", reels: "instagram", "music-review": "music", vault: "music", lanes: "music", "review-desk": "music", action: "action-network", uprise: "action-network", mobilize: "action-network", grants: "funding", "opportunity-intelligence": "funding", "bounties-funding": "funding", "build-code": "build", code: "build", front: "front-page", site: "front-page", homepage: "front-page", "home-page": "front-page", index: "front-page" },
    system: { agents: "workload", runs: "workload", infrastructure: "overview", deployments: "overview", logs: "observability", api: "resources", integrations: "resources", usage: "resources" }
  };
  var LEGACY_DEFAULT = { work: "#work:inbox", create: "#create:projects", system: "#system:overview" };

  function byOldRoute(hash) {
    for (var i = 0; i < LEAVES.length; i += 1) if (LEAVES[i].leaf.was.indexOf(hash) >= 0) return LEAVES[i];
    return null;
  }
  function byRoute(hash) {
    for (var i = 0; i < LEAVES.length; i += 1) if (LEAVES[i].leaf.route === hash) return LEAVES[i];
    return null;
  }
  function firstLeaf(section, item) {
    for (var i = 0; i < LEAVES.length; i += 1) {
      var l = LEAVES[i];
      if (l.section.id === section && (!item || l.item.id === item)) return l;
    }
    return null;
  }

  /* Resolve any hash, new or old, to a leaf. `legacy` says the hash was an
     old route that the caller should replace in the address bar. */
  function resolve(hash) {
    var raw = String(hash || "").replace(/^#/, "").toLowerCase().trim();
    if (!raw) return { entry: LEAVES[0], legacy: false };
    var parts = raw.split(":");
    var exact = byRoute("#" + raw);
    if (exact) return { entry: exact, legacy: false };
    var section = NAV.filter(function (s) { return s.id === parts[0]; })[0];
    /* "create" and "system" are both a new section and an old surface. A
       second segment that names one of the section's items or views is new;
       anything else is an old view name and goes through the legacy table. */
    if (section) {
      var item = parts[1] ? section.items.filter(function (it) { return it.id === parts[1]; })[0] : null;
      if (!parts[1]) {
        var oldBare = byOldRoute("#" + parts[0]);
        if (oldBare && oldBare.section.id !== section.id) return { entry: oldBare, legacy: true };
        return { entry: firstLeaf(section.id), legacy: false };
      }
      if (item) {
        if (parts[2] && item.views) {
          var view = item.views.filter(function (x) { return x.id === parts[2]; })[0];
          if (view) return { entry: byRoute(view.route), legacy: false };
        }
        return { entry: firstLeaf(section.id, item.id), legacy: false };
      }
    }
    var surface = parts[0];
    if (LEGACY_ALIASES[surface] || surface === "work") {
      var viewName = parts[1] || "";
      viewName = (LEGACY_ALIASES[surface] && LEGACY_ALIASES[surface][viewName]) || viewName;
      var old = byOldRoute("#" + surface + ":" + viewName) || byOldRoute(LEGACY_DEFAULT[surface]);
      return { entry: old, legacy: true };
    }
    var bare = byOldRoute("#" + surface);
    if (bare) return { entry: bare, legacy: true };
    return { entry: LEAVES[0], legacy: true };
  }

  function section(id) { return NAV.filter(function (s) { return s.id === id; })[0] || null; }

  /* Palette / registry entries: one per leaf, searchable by its old names. */
  function entries() {
    return LEAVES.map(function (l) {
      var label = l.section.label + " · " + l.item.label + (l.view && l.view.label !== l.item.label ? " · " + l.view.label : "");
      var olds = l.leaf.was.filter(function (w) { return w.charAt(0) !== "#"; });
      return {
        id: l.leaf.route.slice(1).replace(/:/g, "-"),
        route: l.leaf.route,
        href: "control.html" + l.leaf.route,
        label: label,
        leafLabel: l.leaf.label,
        group: l.section.label,
        section: l.section.id,
        blurb: olds.length ? "Was: " + olds.slice(0, 4).join(", ") : l.section.blurb,
        keywords: [l.section.label, l.item.label, l.view ? l.view.label : "", l.leaf.was.join(" ")].join(" ").toLowerCase(),
        module: l.leaf.module || null,
        state: "live"
      };
    });
  }

  function words(value) { return " " + String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " "; }
  function search(q) {
    var all = entries();
    q = String(q || "").trim().toLowerCase();
    if (!q) return all;
    var STOP = /^(a|an|the|my|me|i|is|are|was|to|of|in|on|for|and|or|do|did|does|show|see|get|go|who|what|where|how|can|all)$/;
    var terms = q.split(/\s+/).filter(function (t) { return t.length >= 2 && !STOP.test(t); });
    if (!terms.length) return all;
    return all.map(function (e) {
      var label = e.label.toLowerCase(), hay = words(e.label + " " + e.keywords), score = 0;
      terms.forEach(function (t) {
        if (words(e.leafLabel).indexOf(" " + t + " ") >= 0) score += 150;
        else if (words(label).indexOf(" " + t + " ") >= 0) score += 100;
        else if (label.indexOf(t) >= 0) score += 50;
        else if (hay.indexOf(" " + t + " ") >= 0) score += 20;
        else if (hay.indexOf(t) >= 0) score += 5;
      });
      return { e: e, score: score };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.e.label.length - b.e.label.length; })
      .map(function (x) { return x.e; });
  }

  function icon(name, attrs) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"' + (attrs || "") + '>' + (ICONS[name] || "") + '</svg>';
  }

  root.CR = root.CR || {};
  root.CR.nav = {
    NAV: NAV,
    ICONS: ICONS,
    icon: icon,
    leaves: function () { return LEAVES.slice(); },
    section: section,
    resolve: resolve,
    entries: entries,
    search: search,
    legacyAliases: LEGACY_ALIASES,
    phoneSections: function () { return NAV.filter(function (s) { return s.phone; }); },
    moreSections: function () { return NAV.filter(function (s) { return !s.phone; }); }
  };
})(typeof window === "undefined" ? globalThis : window);
