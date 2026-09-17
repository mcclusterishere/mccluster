/* McCluster Control Room v2
   Locked operator architecture: Home / Work / Create / System / Apps.
   This browser client composes existing canonical APIs and Supabase records.
   It does not introduce a second backend, auth stack, job queue, CRM, or media store. */
(function () {
  "use strict";

  var API = "https://api.mccluster.org";
  var $ = function (id) { return document.getElementById(id); };
  var SURFACES = ["home", "work", "create", "system", "apps"];
  var WORK_VIEWS = ["inbox", "pipeline", "people", "companies", "clients", "tasks", "orders", "bookings"];
  var CREATE_VIEWS = ["projects", "library", "schedule"];
  var SYSTEM_VIEWS = ["overview", "workload", "observability", "resources"];

  var state = {
    surface: "home",
    workView: "inbox",
    createView: "projects",
    systemView: "overview",
    health: null,
    status: null,
    apps: [],
    ai: null,
    aiHealth: null,
    org: null,
    threads: [],
    leads: [],
    siteRequests: [],
    jobs: [],
    mediaAssets: [],
    mediaJobs: [],
    campaigns: [],
    variants: [],
    publishJobs: [],
    posts: [],
    selectedProjectId: null,
    inspector: null,
    loading: false,
    error: null,
    refreshedAt: null
  };

  var bridge = {
    desk: { title: "The Desk", href: "chat.html", subtitle: "Current public conversation surface" },
    crm: { title: "CRM", href: "crm.html", subtitle: "Legacy lead surface retained during migration" },
    backOffice: { title: "Back Office", href: "admin.html", subtitle: "Legacy order and booking surface retained during migration" },
    studio: { title: "Studio", href: "studio.html", subtitle: "Existing media generation tools" },
    assetLab: { title: "Asset Lab", href: "asset-lab.html", subtitle: "Existing asset tool" },
    whip: { title: "Whip", href: "whip.html", subtitle: "Mobility product" },
    prim3: { title: "PRIM3", href: "prim3.html", subtitle: "Learning product" },
    halo: { title: "Hitman Halo", href: "prayer-closet.html", subtitle: "Specialized intelligence workspace" },
    manufacture: { title: "WE Manufacture", href: "we-manufacture.html", subtitle: "Manufacturing workspace" },
    spatial: { title: "Spatial Intelligence", href: API + "/internal/seek-first", subtitle: "Protected Seek First console", external: true }
  };

  function esc(value) {
    var d = document.createElement("i");
    d.textContent = value == null ? "" : String(value);
    return d.innerHTML;
  }
  function text(value, fallback) { return value === null || value === undefined || value === "" ? (fallback == null ? "—" : fallback) : String(value); }
  function count(value) { var n = Number(value); return Number.isFinite(n) ? n : 0; }
  function titleCase(value) { return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function ago(value) {
    if (!value) return "—";
    var t = new Date(value).getTime();
    if (!Number.isFinite(t)) return text(value);
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }
  function moneyCents(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n / 100);
  }
  function formatDate(value) {
    if (!value) return "—";
    try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
    catch (e) { return String(value); }
  }
  function token() { return window.MCC_SUPA && window.MCC_SUPA.token ? window.MCC_SUPA.token() : Promise.resolve(null); }
  function sbBase() { return window.MCC_SUPA && window.MCC_SUPA.url; }
  function sbKey() { return window.MCC_SUPA && window.MCC_SUPA.key; }

  function request(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t) throw new Error("signed out");
      var headers = { authorization: "Bearer " + t };
      if (opts.body !== undefined) headers["content-type"] = "application/json";
      return fetch(API + path, {
        method: opts.method || "GET",
        headers: headers,
        cache: "no-store",
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }).then(function (r) {
        return r.text().then(function (body) {
          var data = null;
          try { data = body ? JSON.parse(body) : null; } catch (e) { data = { raw: body }; }
          if (!r.ok) {
            var err = new Error(data && (data.error || data.message) || ("HTTP " + r.status));
            err.status = r.status; err.detail = data; throw err;
          }
          return data;
        });
      });
    });
  }

  function supa(path, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (!t || !sbBase() || !sbKey()) throw new Error("signed out");
      var headers = { apikey: sbKey(), Authorization: "Bearer " + t };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.prefer) headers.Prefer = opts.prefer;
      return fetch(sbBase() + "/rest/v1/" + path, {
        method: opts.method || "GET",
        headers: headers,
        cache: "no-store",
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }).then(function (r) {
        if (!r.ok) throw new Error("Supabase " + r.status);
        if (r.status === 204) return null;
        return r.json().catch(function () { return null; });
      });
    });
  }

  function settle(promise, fallback) { return promise.catch(function () { return fallback; }); }
  function stateClass(kind) { return "cr-state cr-state--" + (kind || "info"); }
  function note(message, bad) { var n = $("cpNote"); if (!n) return; n.textContent = message || ""; n.className = "cr-note" + (bad ? " is-err" : ""); }

  function normalizeCreateView(v) {
    if (CREATE_VIEWS.indexOf(v) >= 0) return v;
    if (["campaigns", "canvas"].indexOf(v) >= 0) return "projects";
    if (v === "assets") return "library";
    if (["calendar", "published"].indexOf(v) >= 0) return "schedule";
    return "projects";
  }
  function normalizeSystemView(v) {
    if (SYSTEM_VIEWS.indexOf(v) >= 0) return v;
    if (["agents", "runs"].indexOf(v) >= 0) return "workload";
    if (["infrastructure", "deployments"].indexOf(v) >= 0) return "overview";
    if (v === "logs") return "observability";
    if (["api", "integrations", "usage"].indexOf(v) >= 0) return "resources";
    return "overview";
  }
  function readHash() {
    var raw = (location.hash || "#home").slice(1).toLowerCase().split(":");
    state.surface = SURFACES.indexOf(raw[0]) >= 0 ? raw[0] : "home";
    if (state.surface === "work") state.workView = WORK_VIEWS.indexOf(raw[1]) >= 0 ? raw[1] : state.workView;
    if (state.surface === "create") state.createView = normalizeCreateView(raw[1]);
    if (state.surface === "system") state.systemView = normalizeSystemView(raw[1]);
  }
  function routeHash() {
    if (state.surface === "work") return "#work:" + state.workView;
    if (state.surface === "create") return "#create:" + state.createView;
    if (state.surface === "system") return "#system:" + state.systemView;
    return "#" + state.surface;
  }
  function setHash(replace) {
    var next = routeHash();
    if (location.hash === next) return;
    if (replace && history.replaceState) history.replaceState(null, "", next); else location.hash = next;
  }
  function setSurface(surface, view, replace) {
    if (SURFACES.indexOf(surface) < 0) return;
    state.surface = surface;
    if (surface === "work" && WORK_VIEWS.indexOf(view) >= 0) state.workView = view;
    if (surface === "create") state.createView = normalizeCreateView(view);
    if (surface === "system") state.systemView = normalizeSystemView(view);
    state.selectedProjectId = null;
    closeInspector();
    setHash(replace);
    render();
    try { window.scrollTo({ top: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, 0); }
  }
  function currentView() {
    if (state.surface === "work") return state.workView;
    if (state.surface === "create") return state.createView;
    if (state.surface === "system") return state.systemView;
    return state.surface;
  }

  function row(title, subtitle, value, kind, action, extra) {
    extra = extra || {};
    var attrs = action ? ' data-action="' + esc(action) + '"' : "";
    if (extra.key) attrs += ' data-key="' + esc(extra.key) + '"';
    if (extra.id) attrs += ' data-id="' + esc(extra.id) + '"';
    return '<button class="cr-row" type="button"' + attrs + '>' +
      '<span class="cr-row__main"><span class="cr-row__title">' +
      (kind ? '<span class="' + stateClass(kind) + '">' + esc(extra.badge || titleCase(kind)) + '</span>' : "") +
      '<span>' + esc(title) + '</span></span>' +
      (subtitle ? '<span class="cr-row__sub">' + esc(subtitle) + '</span>' : "") +
      '</span><span class="cr-row__value">' + esc(value || "›") + '</span></button>';
  }
  function panel(title, meta, body, span) {
    return '<section class="cr-panel ' + (span || "cr-span-6") + '"><header class="cr-panel__head"><h2>' + esc(title) + '</h2>' +
      (meta ? '<span class="cr-panel__meta">' + esc(meta) + '</span>' : "") + '</header>' + body + '</section>';
  }
  function empty(title, body, label, action) {
    return '<div class="cr-canvas__empty"><div><strong>' + esc(title) + '</strong><div>' + esc(body || "") + '</div>' +
      (label && action ? '<button class="cr-btn cr-btn--primary" type="button" data-action="' + esc(action) + '" style="margin-top:14px">' + esc(label) + '</button>' : "") + '</div></div>';
  }
  function viewOptions(values, selected) {
    return values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === selected ? " selected" : "") + '>' + esc(titleCase(v)) + '</option>'; }).join("");
  }
  function renderHeader(title, subtitle, selector) {
    return '<header class="cr-surface__head"><div><h1 class="cr-surface__title">' + esc(title) + '</h1>' +
      (subtitle ? '<p class="cr-surface__subtitle">' + esc(subtitle) + '</p>' : "") + '</div><div class="cr-surface__tools">' +
      (selector ? '<select id="crViewSelect" class="cr-select" aria-label="Change view">' + viewOptions(selector.values, selector.selected) + '</select>' : "") +
      '<button class="cr-btn cr-btn--ghost" type="button" data-action="refresh">Refresh</button></div></header>';
  }
  function kpi(label, value, sub) { return '<div class="cr-kpi"><div class="cr-kpi__label">' + esc(label) + '</div><div class="cr-kpi__value">' + esc(value) + '</div><div class="cr-kpi__sub">' + esc(sub || "") + '</div></div>'; }

  function renderNav() {
    document.querySelectorAll("[data-surface]").forEach(function (el) {
      var active = el.getAttribute("data-surface") === state.surface;
      el.classList.toggle("is-active", active);
      if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    });
    if ($("crTopTitle")) $("crTopTitle").textContent = titleCase(state.surface);
  }
  function renderTopStatus() {
    var healthy = Boolean(state.health && state.health.ok);
    var dot = $("crHealthDot");
    if (dot) { dot.className = "cr-health-dot" + (healthy ? " is-up" : (state.error ? " is-down" : "")); dot.title = healthy ? "API healthy" : "API status unavailable"; }
    var email = state.status && state.status.operator && state.status.operator.email;
    if ($("crAccount")) $("crAccount").textContent = email ? email.charAt(0).toUpperCase() : "M";
    if ($("crAccountEmail")) $("crAccountEmail").textContent = email || "signed in";
  }

  function leadLane(r) {
    var c = String(r && r.campaign || "").toLowerCase();
    if (c === "print-shop") return "orders";
    if (c === "merch-shop") return "orders";
    if (c === "gallery-waitlist") return "waitlist";
    if (c === "tap-card") return "cards";
    return "bookings";
  }
  function contactFromThread(t) {
    var c = t && t.comms_contacts;
    if (Array.isArray(c)) c = c[0];
    return c || {};
  }
  function threadLabel(t) {
    var c = contactFromThread(t);
    return c.display_name || c.address || t.relay_address || "Conversation";
  }

  function attentionItems() {
    var items = [];
    if (!state.health || !state.health.ok) items.push({ title: "API health unavailable", sub: "api.mccluster.org did not report healthy.", kind: "bad", action: "system-overview" });
    if (state.status && state.status.database && !state.status.database.reachable) items.push({ title: "Database unavailable", sub: "Canonical Supabase reachability failed.", kind: "bad", action: "system-overview" });
    if (state.aiHealth && state.aiHealth.stale) items.push({ title: "Host health is stale", sub: "Core has not recorded a fresh host health result.", kind: "warn", action: "system-workload" });
    var failed = state.jobs.filter(function (j) { return j.status === "failed"; });
    if (failed.length) items.push({ title: failed.length + " failed workload" + (failed.length === 1 ? "" : "s"), sub: "Inspect the execution queue and failure output.", kind: "bad", action: "system-workload" });
    var human = state.threads.filter(function (t) { return t.mode === "human"; });
    if (human.length) items.push({ title: human.length + " conversation" + (human.length === 1 ? "" : "s") + " in human control", sub: "Automation is paused on these threads.", kind: "warn", action: "work-inbox" });
    return items;
  }

  function renderHome() {
    var c = state.status && state.status.counts || {};
    var attention = attentionItems();
    var activeJobs = state.jobs.filter(function (j) { return ["queued", "running"].indexOf(j.status) >= 0; });
    var inboxRows = attention.length ? attention.map(function (it) { return row(it.title, it.sub, "Open", it.kind, it.action, { badge: it.kind === "bad" ? "Issue" : "Review" }); }).join("") :
      '<div class="cr-panel__body"><span class="' + stateClass("ok") + '">All clear</span><p class="cr-muted">No instrumented exception currently needs you.</p></div>';
    var workRows = activeJobs.slice(0, 6).map(function (j) {
      return row(titleCase(j.job_type), text(j.target_id, j.target_type), titleCase(j.status), j.status === "running" ? "ai" : "info", "inspect-job", { id: j.id, badge: j.status });
    }).join("") || '<div class="cr-panel__body cr-muted">No queued or running canonical jobs.</div>';

    return renderHeader("Home", "Exceptions first. Everything else stays quiet until it matters.") +
      '<section class="cr-command-hero"><h1>What do you want done?</h1><div class="cr-command-hero__box"><input id="crHeroInput" autocomplete="off" placeholder="Search, navigate, or give McCluster an objective…" aria-label="Search or command McCluster"><button class="cr-btn cr-btn--primary" type="button" data-action="hero-command">Go</button></div>' +
      '<div class="cr-quick"><button class="cr-chip" data-action="work-inbox">Inbox</button><button class="cr-chip" data-action="work-pipeline">Pipeline</button><button class="cr-chip" data-action="create-projects">Create</button><button class="cr-chip" data-action="system-workload">Workload</button><button class="cr-chip" data-action="apps">Apps</button></div></section>' +
      '<div class="cr-kpis">' +
      kpi("Conversations", String(state.threads.length || count(c.conversations)), "live work") +
      kpi("Open leads", String(state.leads.filter(function (x) { return x.status !== "closed"; }).length), "business") +
      kpi("Active jobs", String(activeJobs.length), "canonical workload") +
      kpi("Projects", String(state.campaigns.length), "creative") + '</div>' +
      '<div class="cr-grid cr-home-grid">' +
      panel("Needs you", attention.length ? attention.length + " item" + (attention.length === 1 ? "" : "s") : "clear", '<div class="cr-list">' + inboxRows + '</div>', "cr-span-7") +
      panel("Working now", activeJobs.length + " active", '<div class="cr-list">' + workRows + '</div>', "cr-span-5") +
      panel("Signals", "ingestion surface", '<div class="cr-panel__body"><div class="cr-signal-map cr-signal-map--v2"><span class="cr-signal-node n1"></span><span class="cr-signal-node n2"></span><span class="cr-signal-node n3"></span><span class="cr-signal-node n4"></span><span class="cr-signal-line l1"></span><span class="cr-signal-line l2"></span><span class="cr-signal-line l3"></span><div class="cr-signal-map__legend"><span>Communications</span><span>GitHub / Core</span><span>Creative</span><span>Applications</span></div></div><p class="cr-muted">Reserved for canonical ingestion signals. Hitman Halo can deepen this visualization without creating another top-level control plane.</p></div>', "cr-span-7") +
      panel("System pulse", state.health && state.health.ok ? "operational" : "check", '<div class="cr-list">' +
        row("API Worker", "api.mccluster.org", state.health && state.health.ok ? "Healthy" : "Check", state.health && state.health.ok ? "ok" : "bad", "system-overview") +
        row("Database", "Canonical Supabase", state.status && state.status.database && state.status.database.reachable ? "Healthy" : "Check", state.status && state.status.database && state.status.database.reachable ? "ok" : "warn", "system-overview") +
        row("Core", "ai_context-v4", state.ai && state.ai.ok ? "Healthy" : "Inspect", state.ai && state.ai.ok ? "ai" : "warn", "system-workload") +
      '</div>', "cr-span-5") + '</div>';
  }

  function unifiedInbox() {
    var items = [];
    state.threads.forEach(function (t) {
      items.push({ type: "Message", title: threadLabel(t), sub: t.mode === "human" ? "Human control" : "AI handling", when: t.updated_at || t.last_inbound_at, kind: t.mode === "human" ? "warn" : "ai", action: "inspect-thread", id: t.id });
    });
    state.leads.slice(0, 100).forEach(function (l) {
      items.push({ type: "Lead", title: l.name || l.email || "Lead", sub: l.want || l.note || l.campaign || "New business", when: l.at || l.created_at, kind: l.status === "new" ? "info" : "ok", action: "inspect-lead", id: l.id });
    });
    state.siteRequests.forEach(function (r) {
      items.push({ type: "Request", title: r.title || r.request_type || r.kind || "Site request", sub: r.status || r.page || "Client request", when: r.created_at || r.at, kind: "warn", action: "inspect-request", id: r.id });
    });
    return items.sort(function (a, b) { return new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime(); });
  }

  function renderWorkInbox() {
    var items = unifiedInbox();
    if (!items.length) return '<div class="cr-canvas">' + empty("Inbox is clear", "No conversations, leads, or requests were returned by the canonical sources.") + '</div>';
    return '<div class="cr-canvas"><div class="cr-feed">' + items.slice(0, 120).map(function (it) {
      return row(it.title, it.sub, ago(it.when), it.kind, it.action, { id: it.id, badge: it.type });
    }).join("") + '</div></div>';
  }

  function renderPipeline() {
    var stages = ["new", "replied", "booked", "closed"];
    var labels = { "new": "New", replied: "Contacted", booked: "Booked", closed: "Closed" };
    return '<div class="cr-board">' + stages.map(function (stage) {
      var rows = state.leads.filter(function (l) { return (l.status || "new") === stage; });
      return '<section class="cr-board__col"><header><span>' + esc(labels[stage]) + '</span><b>' + rows.length + '</b></header><div class="cr-board__stack">' +
        (rows.length ? rows.map(function (l) {
          return '<button type="button" class="cr-card" data-action="inspect-lead" data-id="' + esc(l.id) + '"><strong>' + esc(l.name || l.email || "Lead") + '</strong><span>' + esc(l.want || l.campaign || "Inquiry") + '</span><small>' + esc(ago(l.at || l.created_at)) + '</small></button>';
        }).join("") : '<div class="cr-board__empty">No records</div>') + '</div></section>';
    }).join("") + '</div>';
  }

  function personRows() {
    var map = {};
    state.leads.forEach(function (l) {
      var key = String(l.email || l.name || l.id || "").toLowerCase(); if (!key) return;
      map[key] = map[key] || { id: l.id, name: l.name || l.email, contact: l.email || "", last: l.at || l.created_at, source: l.source || l.campaign || "lead", lead: l };
      if (new Date(l.at || l.created_at || 0) > new Date(map[key].last || 0)) map[key].last = l.at || l.created_at;
    });
    state.threads.forEach(function (t) {
      var c = contactFromThread(t); var key = String(c.address || c.display_name || t.id).toLowerCase();
      if (!map[key]) map[key] = { id: t.id, name: c.display_name || c.address || "Contact", contact: c.address || "", last: t.updated_at, source: "communications", thread: t };
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return new Date(b.last || 0) - new Date(a.last || 0); });
  }

  function renderTable(columns, rows, emptyText) {
    if (!rows.length) return '<div class="cr-canvas">' + empty(emptyText || "No records", "Nothing was returned by the canonical source for this view.") + '</div>';
    return '<div class="cr-table-wrap"><table class="cr-data-table"><thead><tr>' + columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr' + (r.action ? ' data-action="' + esc(r.action) + '" data-id="' + esc(r.id) + '" tabindex="0"' : "") + '>' + columns.map(function (c) { return '<td>' + (c.html ? c.html(r) : esc(text(r[c.key], ""))) + '</td>'; }).join("") + '</tr>'; }).join("") + '</tbody></table></div>';
  }

  function renderPeople() {
    var people = personRows();
    return renderTable([
      { label: "Person", key: "name" }, { label: "Contact", key: "contact" }, { label: "Relationship", key: "source" },
      { label: "Last activity", html: function (r) { return esc(ago(r.last)); } }
    ], people.map(function (p) { p.action = p.thread ? "inspect-thread" : "inspect-lead"; return p; }), "No people yet");
  }

  function renderCompanies() {
    var companyMap = {};
    state.leads.forEach(function (l) {
      var name = l.company || l.organization || l.org_name || "";
      if (!name) return;
      var k = name.toLowerCase(); companyMap[k] = companyMap[k] || { name: name, people: 0, last: l.at || l.created_at, id: l.id };
      companyMap[k].people += 1;
    });
    var companies = Object.keys(companyMap).map(function (k) { return companyMap[k]; });
    return renderTable([{ label: "Company", key: "name" }, { label: "People", key: "people" }, { label: "Last activity", html: function (r) { return esc(ago(r.last)); } }], companies, "No company records yet");
  }

  function renderClients() {
    var rows = state.leads.filter(function (l) { return l.status === "booked" || l.status === "closed"; }).map(function (l) { return { id: l.id, action: "inspect-lead", name: l.name || l.email, service: l.want || l.campaign || "Client work", status: l.status, last: l.at || l.created_at }; });
    return renderTable([{ label: "Client", key: "name" }, { label: "Work", key: "service" }, { label: "State", key: "status" }, { label: "Last activity", html: function (r) { return esc(ago(r.last)); } }], rows, "No client records yet");
  }

  function renderTasks() {
    var tasks = [];
    state.leads.filter(function (l) { return l.status !== "closed"; }).forEach(function (l) {
      tasks.push({ id: l.id, action: "inspect-lead", task: l.status === "new" ? "Reply to " + (l.name || l.email || "lead") : (l.status === "replied" ? "Advance " + (l.name || "lead") : "Confirm next step with " + (l.name || "client")), related: l.want || l.campaign || "Lead", due: l.at || l.created_at });
    });
    return renderTable([{ label: "Next action", key: "task" }, { label: "Related", key: "related" }, { label: "Since", html: function (r) { return esc(ago(r.due)); } }], tasks, "No open next actions");
  }

  function renderOrdersBookings(view) {
    var lane = view === "orders" ? "orders" : "bookings";
    var rows = state.leads.filter(function (l) { return leadLane(l) === lane; }).map(function (l) { return { id: l.id, action: "inspect-lead", name: l.name || l.email, item: l.want || l.note || l.campaign || titleCase(lane), status: l.status || "new", last: l.at || l.created_at }; });
    return renderTable([{ label: view === "orders" ? "Customer" : "Contact", key: "name" }, { label: view === "orders" ? "Order" : "Booking", key: "item" }, { label: "State", key: "status" }, { label: "Received", html: function (r) { return esc(ago(r.last)); } }], rows, "No " + view + " yet");
  }

  function renderWorkView(view) {
    if (view === "inbox") return renderWorkInbox();
    if (view === "pipeline") return renderPipeline();
    if (view === "people") return renderPeople();
    if (view === "companies") return renderCompanies();
    if (view === "clients") return renderClients();
    if (view === "tasks") return renderTasks();
    return renderOrdersBookings(view);
  }
  function renderWork() {
    return renderHeader("Work", "One business graph. Inbox, pipeline, people, clients, tasks, orders, and bookings are views—not rooms.", { values: WORK_VIEWS, selected: state.workView }) +
      '<div class="cr-workbar"><input class="cr-workbar__search" id="crWorkSearch" type="search" placeholder="Filter this view…" aria-label="Filter Work"><button class="cr-btn" data-action="filters">Filters</button><button class="cr-btn cr-btn--primary" data-action="new-work">+ New</button></div>' + renderWorkView(state.workView);
  }

  function projectById(id) { return state.campaigns.find(function (c) { return String(c.id) === String(id); }); }
  function projectStats(id) {
    return {
      variants: state.variants.filter(function (x) { return String(x.campaign_id) === String(id); }).length,
      scheduled: state.publishJobs.filter(function (x) { return String(x.campaign_id) === String(id); }).length,
      posts: state.posts.filter(function (x) { return String(x.campaign_id) === String(id); }).length
    };
  }
  function renderProjectWorkspace(project) {
    var st = projectStats(project.id);
    var variants = state.variants.filter(function (x) { return String(x.campaign_id) === String(project.id); });
    var posts = state.posts.filter(function (x) { return String(x.campaign_id) === String(project.id); });
    return '<div class="cr-project-head"><button class="cr-btn cr-btn--ghost" data-action="close-project">← Projects</button><div><h2>' + esc(project.name || "Project") + '</h2><p>' + esc(project.objective || "Creative project") + '</p></div><span class="' + stateClass(project.status === "active" ? "ok" : "info") + '">' + esc(project.status || "draft") + '</span></div>' +
      '<div class="cr-kpis">' + kpi("Variants", String(st.variants), "generated") + kpi("Scheduled", String(st.scheduled), "distribution") + kpi("Published", String(st.posts), "live") + kpi("Source asset", project.source_asset_id ? "Linked" : "—", "context") + '</div>' +
      '<div class="cr-creative-canvas"><div class="cr-node cr-node--brief"><small>Brief</small><strong>' + esc(project.objective || project.name || "Project brief") + '</strong></div>' +
      '<div class="cr-node-link">→</div><div class="cr-node"><small>Variants</small><strong>' + st.variants + ' creative output' + (st.variants === 1 ? "" : "s") + '</strong></div>' +
      '<div class="cr-node-link">→</div><div class="cr-node"><small>Distribution</small><strong>' + (st.scheduled + st.posts) + ' post object' + ((st.scheduled + st.posts) === 1 ? "" : "s") + '</strong></div></div>' +
      '<div class="cr-grid">' + panel("Variants", variants.length + " total", '<div class="cr-list">' + (variants.slice(0, 8).map(function (v) { return row(v.variant_key || "Variant", v.hook || v.hypothesis || "Generated creative", v.score == null ? titleCase(v.status || "") : "Score " + v.score, v.status === "ready" ? "ok" : "ai", "inspect-variant", { id: v.id, badge: v.status || "variant" }); }).join("") || '<div class="cr-panel__body cr-muted">No variants yet.</div>') + '</div>', "cr-span-6") +
      panel("Published / queued", (st.scheduled + st.posts) + " items", '<div class="cr-list">' + (posts.slice(0, 8).map(function (p) { return row(p.caption || "Published post", p.publish_mode || "post", ago(p.published_at), "ok", "inspect-post", { id: p.id, badge: "Published" }); }).join("") || '<div class="cr-panel__body cr-muted">Nothing published yet.</div>') + '</div>', "cr-span-6") + '</div>';
  }

  function renderProjects() {
    if (state.selectedProjectId) {
      var project = projectById(state.selectedProjectId);
      if (project) return renderProjectWorkspace(project);
      state.selectedProjectId = null;
    }
    if (!state.campaigns.length) return '<div class="cr-canvas">' + empty("No creative projects yet", "Create remains wired to the canonical media and social backends. Existing Studio stays available while projects begin accumulating here.", "Open Studio", "open-bridge:studio") + '</div>';
    return '<div class="cr-project-grid">' + state.campaigns.map(function (c) {
      var st = projectStats(c.id);
      return '<button type="button" class="cr-project-card" data-action="open-project" data-id="' + esc(c.id) + '"><span class="' + stateClass(c.status === "active" ? "ok" : "info") + '">' + esc(c.status || "draft") + '</span><strong>' + esc(c.name || "Campaign") + '</strong><p>' + esc(c.objective || "Creative project") + '</p><footer><span>' + st.variants + ' variants</span><span>' + st.posts + ' published</span></footer></button>';
    }).join("") + '</div>';
  }

  function assetName(a) { return a.name || a.filename || a.file_name || a.kind || a.type || ("Asset " + String(a.id || "").slice(0, 8)); }
  function renderLibrary() {
    if (!state.mediaAssets.length) return '<div class="cr-canvas">' + empty("Library is empty", "No media_assets records were visible to this operator session.", "Open Asset Lab", "open-bridge:assetLab") + '</div>';
    return '<div class="cr-asset-grid">' + state.mediaAssets.slice(0, 120).map(function (a) {
      var url = a.url || a.public_url || a.storage_url || a.signed_url || "";
      var kind = a.media_type || a.type || a.kind || "asset";
      return '<button class="cr-asset-card" type="button" data-action="inspect-asset" data-id="' + esc(a.id) + '">' +
        (url && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) ? '<img src="' + esc(url) + '" alt="">' : '<div class="cr-asset-card__placeholder">' + esc(titleCase(kind)) + '</div>') +
        '<strong>' + esc(assetName(a)) + '</strong><span>' + esc(titleCase(kind)) + '</span></button>';
    }).join("") + '</div>';
  }

  function renderSchedule() {
    var items = [];
    state.publishJobs.forEach(function (p) { items.push({ id: p.id, action: "inspect-publish", state: p.state || "queued", title: (p.payload && p.payload.caption) || "Scheduled post", when: p.scheduled_at, kind: p.state === "failed" ? "bad" : "info" }); });
    state.posts.forEach(function (p) { items.push({ id: p.id, action: "inspect-post", state: "published", title: p.caption || "Published post", when: p.published_at, kind: "ok" }); });
    items.sort(function (a, b) { return new Date(a.when || 0) - new Date(b.when || 0); });
    if (!items.length) return '<div class="cr-canvas">' + empty("Nothing scheduled", "Publishing objects will appear here as drafts, queued work, scheduled posts, failures, and published output.") + '</div>';
    return '<div class="cr-schedule"><div class="cr-list">' + items.map(function (it) { return row(it.title, formatDate(it.when), titleCase(it.state), it.kind, it.action, { id: it.id, badge: it.state }); }).join("") + '</div></div>';
  }
  function renderCreate() {
    var body = state.createView === "projects" ? renderProjects() : (state.createView === "library" ? renderLibrary() : renderSchedule());
    return renderHeader("Create", "Projects own the creative objective. Library owns canonical assets. Schedule owns distribution.", { values: CREATE_VIEWS, selected: state.createView }) + body;
  }

  function serviceRows() {
    var s = state.status || {};
    return [
      { key: "api", title: "Cloudflare / API", sub: "api.mccluster.org", value: state.health && state.health.ok ? "Healthy" : "Check", kind: state.health && state.health.ok ? "ok" : "bad" },
      { key: "db", title: "Supabase", sub: "Canonical data plane", value: s.database && s.database.reachable ? "Healthy" : "Check", kind: s.database && s.database.reachable ? "ok" : "warn" },
      { key: "core", title: "Core / AI", sub: "ai_context-v4 · ops_agent_jobs", value: state.ai && state.ai.ok ? "Healthy" : "Inspect", kind: state.ai && state.ai.ok ? "ai" : "warn" },
      { key: "host", title: "OVH host", sub: state.aiHealth && state.aiHealth.checked_at ? "Checked " + ago(state.aiHealth.checked_at) + " ago" : "No fresh host health", value: state.aiHealth && !state.aiHealth.stale ? titleCase(state.aiHealth.overall || "Healthy") : "Refresh", kind: state.aiHealth && !state.aiHealth.stale ? "ok" : "warn" },
      { key: "comms", title: "Communications", sub: state.threads.length + " thread" + (state.threads.length === 1 ? "" : "s"), value: "Live", kind: "info" },
      { key: "creative", title: "Creative", sub: state.mediaJobs.length + " media job" + (state.mediaJobs.length === 1 ? "" : "s"), value: state.mediaJobs.some(function (x) { return x.status === "failed"; }) ? "Check" : "Ready", kind: state.mediaJobs.some(function (x) { return x.status === "failed"; }) ? "warn" : "ok" }
    ];
  }
  function renderTopology() {
    return '<div class="cr-topology"><button class="cr-topology__node root" data-action="inspect-service" data-key="api"><b>Cloudflare</b><span>edge + worker</span></button>' +
      '<span class="cr-topology__edge e1"></span><button class="cr-topology__node db" data-action="inspect-service" data-key="db"><b>Supabase</b><span>data + auth</span></button>' +
      '<span class="cr-topology__edge e2"></span><button class="cr-topology__node core" data-action="inspect-service" data-key="core"><b>Core</b><span>objectives + jobs</span></button>' +
      '<span class="cr-topology__edge e3"></span><button class="cr-topology__node host" data-action="inspect-service" data-key="host"><b>OVH</b><span>runtime</span></button>' +
      '<span class="cr-topology__edge e4"></span><button class="cr-topology__node creative" data-action="inspect-service" data-key="creative"><b>Media / GPU</b><span>creative compute</span></button></div>';
  }
  function renderSystemOverview() {
    var services = serviceRows();
    return '<div class="cr-kpis">' + kpi("API", state.health && state.health.ok ? "UP" : "—", "edge") + kpi("Database", state.status && state.status.database && state.status.database.reachable ? "UP" : "—", "truth") + kpi("Jobs", String(state.jobs.filter(function (x) { return ["queued", "running"].indexOf(x.status) >= 0; }).length), "active") + kpi("Failures", String(state.jobs.filter(function (x) { return x.status === "failed"; }).length), "workload") + '</div>' +
      '<div class="cr-grid">' + panel("Live topology", "click a resource", '<div class="cr-panel__body">' + renderTopology() + '</div>', "cr-span-7") +
      panel("Services", "canonical status", '<div class="cr-list">' + services.map(function (s) { return row(s.title, s.sub, s.value, s.kind, "inspect-service", { key: s.key, badge: s.kind === "ai" ? "AI" : s.kind }); }).join("") + '</div>', "cr-span-5") + '</div>';
  }
  function renderWorkload() {
    if (!state.jobs.length) return '<div class="cr-canvas">' + empty("No workload visible", "No ops_agent_jobs records were visible to this operator session.") + '</div>';
    var rows = state.jobs.slice(0, 150).map(function (j) { return { id: j.id, action: "inspect-job", state: j.status, work: titleCase(j.job_type), target: text(j.target_id, j.target_type), age: ago(j.created_at), attempts: String(count(j.attempts)) + "/" + String(count(j.max_attempts) || 1) }; });
    return '<div class="cr-workbar cr-workbar--system"><div class="cr-filterchips"><button class="cr-chip" data-job-filter="all">All</button><button class="cr-chip" data-job-filter="running">Running</button><button class="cr-chip" data-job-filter="queued">Queued</button><button class="cr-chip" data-job-filter="failed">Failed</button></div></div>' +
      renderTable([{ label: "State", html: function (r) { var k = r.state === "failed" ? "bad" : (r.state === "running" ? "ai" : (r.state === "done" ? "ok" : "info")); return '<span class="' + stateClass(k) + '">' + esc(r.state) + '</span>'; } }, { label: "Work", key: "work" }, { label: "Target", key: "target" }, { label: "Started", key: "age" }, { label: "Attempts", key: "attempts" }], rows, "No jobs");
  }
  function renderObservability() {
    var events = [];
    state.jobs.filter(function (j) { return j.status === "failed"; }).forEach(function (j) { events.push({ id: j.id, action: "inspect-job", severity: "ERROR", source: "Core", message: titleCase(j.job_type) + ": " + text(j.last_error, "job failed"), time: j.updated_at || j.created_at, kind: "bad" }); });
    if (state.aiHealth && state.aiHealth.stale) events.push({ id: "host", action: "inspect-service", severity: "WARN", source: "OVH", message: "Host health result is stale", time: state.aiHealth.checked_at, kind: "warn" });
    if (!events.length) events.push({ id: "health", action: "inspect-service", severity: "INFO", source: "System", message: "No instrumented failures in the current snapshot", time: state.refreshedAt, kind: "ok" });
    return '<div class="cr-observe-head"><div><strong>Events</strong><span class="cr-live-dot">Live snapshot</span></div><div class="cr-filterchips"><button class="cr-chip">All services</button><button class="cr-chip">Severity</button><button class="cr-chip">Time</button></div></div>' +
      renderTable([{ label: "Time", html: function (r) { return esc(ago(r.time)); } }, { label: "Severity", html: function (r) { return '<span class="' + stateClass(r.kind) + '">' + esc(r.severity) + '</span>'; } }, { label: "Source", key: "source" }, { label: "Message", key: "message" }], events, "No events");
  }
  function renderResources() {
    var providers = [
      { name: "OpenAI / model providers", state: state.ai && state.ai.ok ? "Available through Core" : "Inspect Core", kind: state.ai && state.ai.ok ? "ai" : "warn" },
      { name: "Supabase", state: state.status && state.status.database && state.status.database.reachable ? "Connected" : "Check", kind: state.status && state.status.database && state.status.database.reachable ? "ok" : "warn" },
      { name: "Cloudflare", state: state.health && state.health.ok ? "Connected" : "Check", kind: state.health && state.health.ok ? "ok" : "warn" },
      { name: "Social channels", state: state.status && Array.isArray(state.status.channels) ? state.status.channels.filter(function (x) { return x.enabled; }).length + " enabled" : "—", kind: "info" }
    ];
    return '<div class="cr-grid">' + panel("Connections", "provider state", '<div class="cr-list">' + providers.map(function (p) { return row(p.name, "Canonical connection", p.state, p.kind, "inspect-resource", { key: p.name, badge: p.kind }); }).join("") + '</div>', "cr-span-7") +
      panel("Usage & spend", "traceable, not guessed", '<div class="cr-panel__body"><p class="cr-muted">The Control Room will show cost only where a canonical metering source exists. This UI does not invent spend. Current visible workload: <b>' + esc(String(state.jobs.length)) + '</b> Core jobs and <b>' + esc(String(state.mediaJobs.length)) + '</b> media jobs.</p><button class="cr-btn" data-action="open-platform">Open platform details</button></div>', "cr-span-5") + '</div>';
  }
  function renderSystem() {
    var body = state.systemView === "overview" ? renderSystemOverview() : (state.systemView === "workload" ? renderWorkload() : (state.systemView === "observability" ? renderObservability() : renderResources()));
    return renderHeader("System", "Operate the machine through Overview, Workload, Observability, and Resources.", { values: SYSTEM_VIEWS, selected: state.systemView }) + body;
  }

  function appCard(title, subtitle, href, meta, external) {
    return '<a class="cr-app-card" href="' + esc(href || "#") + '"' + (external ? ' target="_blank" rel="noopener"' : "") + '><strong>' + esc(title) + '</strong><small>' + esc(subtitle || "") + '</small><span class="cr-app-card__foot"><span>' + esc(meta || "Specialized app") + '</span><span>Open ↗</span></span></a>';
  }
  function renderApps() {
    var registered = state.apps.map(function (a) { return appCard(a.name || a.app_key, [a.product_family, a.kind].filter(Boolean).join(" · ") || "Registered application", a.public_url || "#", a.app_key || "registered", true); }).join("") || '<div class="cr-panel__body cr-muted">No registered applications were returned.</div>';
    var specialty = [bridge.whip, bridge.spatial, bridge.prim3, bridge.halo, bridge.manufacture].map(function (a) { return appCard(a.title, a.subtitle, a.href, "Specialized workspace", a.external); }).join("");
    return renderHeader("Apps", "Specialized products stay one launch away without becoming permanent Control Room navigation.") + '<section class="cr-app-section"><div class="cr-panel__head"><h2>Registered applications</h2><span class="cr-panel__meta">' + state.apps.length + '</span></div><div class="cr-app-grid">' + registered + '</div></section><section class="cr-app-section"><div class="cr-panel__head"><h2>Specialized workspaces</h2></div><div class="cr-app-grid">' + specialty + '</div></section>';
  }

  function renderLoading() { return renderHeader(titleCase(state.surface), "Loading canonical McCluster state…") + '<div class="cr-canvas">' + empty("Loading", "Reading existing APIs and operator-visible records.") + '</div>'; }
  function render() {
    renderNav(); renderTopStatus();
    var root = $("crSurface"); if (!root) return;
    if (state.loading && !state.status && !state.health) root.innerHTML = renderLoading();
    else if (state.surface === "home") root.innerHTML = renderHome();
    else if (state.surface === "work") root.innerHTML = renderWork();
    else if (state.surface === "create") root.innerHTML = renderCreate();
    else if (state.surface === "system") root.innerHTML = renderSystem();
    else root.innerHTML = renderApps();
    bindSurfaceControls();
  }

  function inspectorSection(title, html) { return '<section class="cr-inspector__section"><h3>' + esc(title) + '</h3>' + html + '</section>'; }
  function props(rows) { return '<div class="cr-props">' + rows.map(function (r) { return '<div class="cr-prop"><span>' + esc(r[0]) + '</span><b>' + esc(text(r[1])) + '</b></div>'; }).join("") + '</div>'; }
  function renderInspectorTabs(active, tabs) {
    tabs = tabs || ["overview", "activity", "related", "ai"];
    $("crInspectorTabs").innerHTML = tabs.map(function (tab) { return '<button type="button" data-inspector-tab="' + tab + '" class="' + (tab === active ? "is-active" : "") + '">' + esc(titleCase(tab)) + '</button>'; }).join("");
  }
  function openInspector(data) {
    state.inspector = data || { title: "Details" };
    if (!state.inspector.tab) state.inspector.tab = "overview";
    var p = $("crInspector"); if (!p) return;
    p.classList.add("is-open"); p.setAttribute("aria-hidden", "false");
    if ($("crMain")) $("crMain").classList.add("has-inspector");
    renderInspector();
  }
  function closeInspector() {
    state.inspector = null;
    if ($("crInspector")) { $("crInspector").classList.remove("is-open"); $("crInspector").setAttribute("aria-hidden", "true"); }
    if ($("crMain")) $("crMain").classList.remove("has-inspector");
  }
  function aiComposer(context) {
    return '<div class="cr-ai-box"><textarea id="crAiContextInput" rows="4" placeholder="Ask McCluster about this…"></textarea><button class="cr-btn cr-btn--primary" type="button" data-action="ai-context" data-context="' + esc(context || "") + '">Send to Core</button></div>';
  }
  function renderInspector() {
    var d = state.inspector; if (!d) return;
    $("crInspectorTitle").textContent = d.title || "Details";
    $("crInspectorSub").textContent = d.subtitle || "McCluster Control Room";
    var tabs = d.tabs || ["overview", "activity", "related", "ai"];
    if (tabs.indexOf(d.tab) < 0) d.tab = tabs[0];
    renderInspectorTabs(d.tab, tabs);
    var html = "";
    if (d.tab === "overview") {
      if (d.props && d.props.length) html += inspectorSection("Overview", props(d.props));
      if (d.description) html += inspectorSection("Context", '<p class="cr-muted">' + esc(d.description) + '</p>');
      if (d.custom) html += d.custom;
      if (d.actions) html += '<div class="cr-inspector__actions">' + d.actions + '</div>';
    } else if (d.tab === "activity") {
      html = inspectorSection("Activity", d.activity || '<p class="cr-muted">Canonical events will appear here when available.</p>');
    } else if (d.tab === "related") {
      html = inspectorSection("Related", d.related || '<p class="cr-muted">Related records resolve through the existing McCluster object graph.</p>');
    } else if (d.tab === "raw") {
      html = inspectorSection("Raw", '<pre class="cr-raw">' + esc(JSON.stringify(d.raw || {}, null, 2)) + '</pre>');
    } else {
      html = inspectorSection("AI", '<p class="cr-muted">This sends context to canonical Core and creates a durable objective/reflection job.</p>' + aiComposer((d.title || "object") + ": " + (d.description || "")));
    }
    $("crInspectorBody").innerHTML = html || '<p class="cr-muted">No details available.</p>';
    bindActions($("crInspectorBody"));
  }

  function findById(rows, id) { return rows.find(function (r) { return String(r.id) === String(id); }); }
  function inspectLead(id) {
    var l = findById(state.leads, id); if (!l) return;
    var buttons = ["new", "replied", "booked", "closed"].map(function (st) { return '<button class="cr-btn' + (l.status === st ? ' cr-btn--primary' : '') + '" type="button" data-action="lead-status" data-id="' + esc(l.id) + '" data-status="' + st + '">' + esc(titleCase(st)) + '</button>'; }).join("");
    openInspector({ title: l.name || l.email || "Lead", subtitle: "Work · " + titleCase(l.status || "new"), description: l.note || l.want || "Business relationship", props: [["Email", l.email], ["Status", l.status || "new"], ["Source", l.source || l.campaign || "direct"], ["Received", formatDate(l.at || l.created_at)]], actions: buttons, raw: l });
  }
  function inspectThread(id) {
    var t = findById(state.threads, id); if (!t) return;
    var c = contactFromThread(t); var human = t.mode === "human";
    var controls = '<button class="cr-btn cr-btn--primary" type="button" data-action="thread-mode" data-id="' + esc(t.id) + '" data-mode="' + (human ? "release" : "takeover") + '">' + (human ? "Return to AI" : "Take over") + '</button>' +
      '<button class="cr-btn" type="button" data-action="thread-compose" data-id="' + esc(t.id) + '">Send message</button>';
    openInspector({ title: c.display_name || c.address || "Conversation", subtitle: human ? "Human control" : "AI handling", description: human ? "Automation is paused for this thread." : "The assistant may continue handling this thread under the existing communications policy.", props: [["Channel", t.channel || "sms"], ["Address", c.address || "—"], ["Mode", t.mode || "assistant"], ["Updated", formatDate(t.updated_at)]], actions: controls, raw: t });
  }
  function inspectJob(id) {
    var j = findById(state.jobs, id); if (!j) return;
    var activity = '<div class="cr-trace"><div class="is-done">Created <span>' + esc(formatDate(j.created_at)) + '</span></div><div class="' + (j.status === "running" ? "is-live" : "") + '">Execution <span>' + esc(titleCase(j.status || "unknown")) + '</span></div>' + (j.last_error ? '<div class="is-bad">Error <span>' + esc(j.last_error) + '</span></div>' : "") + '</div>';
    openInspector({ title: titleCase(j.job_type), subtitle: "Workload · " + titleCase(j.status), description: "Durable job in ops_agent_jobs.", props: [["Target", j.target_id || j.target_type], ["Priority", j.priority], ["Attempts", count(j.attempts) + "/" + count(j.max_attempts)], ["Updated", formatDate(j.updated_at)]], activity: activity, raw: j, tabs: ["overview", "activity", "raw", "ai"] });
  }
  function inspectService(key) {
    var s = serviceRows().find(function (x) { return x.key === key; }) || { title: "System", sub: "McCluster", value: "Inspect" };
    var extra = [];
    if (key === "core" && state.ai) extra = [["Total jobs", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.total], ["Queued", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.queued], ["Running", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.running], ["Failed", state.ai.execution && state.ai.execution.jobs && state.ai.execution.jobs.failed]];
    if (key === "host" && state.aiHealth) extra = [["Overall", state.aiHealth.overall], ["Checked", formatDate(state.aiHealth.checked_at)], ["Stale", state.aiHealth.stale ? "yes" : "no"]];
    openInspector({ title: s.title, subtitle: "System resource", description: s.sub, props: [["State", s.value]].concat(extra), raw: key === "core" ? state.ai : (key === "host" ? state.aiHealth : state.status), tabs: ["overview", "activity", "raw", "ai"] });
  }
  function inspectAsset(id) { var a = findById(state.mediaAssets, id); if (!a) return; openInspector({ title: assetName(a), subtitle: "Create · Library", description: "Canonical media asset.", props: [["Type", a.media_type || a.type || a.kind], ["Created", formatDate(a.created_at)], ["Job", a.job_id || a.media_job_id || "—"], ["Provider", a.provider || a.model_id || "—"]], raw: a, tabs: ["overview", "related", "raw", "ai"] }); }
  function inspectVariant(id) { var v = findById(state.variants, id); if (!v) return; openInspector({ title: v.variant_key || "Variant", subtitle: "Create · Project", description: v.hypothesis || v.hook || "Creative variant", props: [["Status", v.status], ["Score", v.score], ["Media job", v.media_job_id], ["Created", formatDate(v.created_at)]], raw: v, tabs: ["overview", "related", "raw", "ai"] }); }
  function inspectPost(id) { var p = findById(state.posts, id); if (!p) return; openInspector({ title: "Published post", subtitle: "Create · Schedule", description: p.caption || "Published content", props: [["Mode", p.publish_mode], ["Published", formatDate(p.published_at)], ["Permalink", p.permalink || "—"]], raw: p, tabs: ["overview", "activity", "raw", "ai"] }); }
  function inspectPublish(id) { var p = findById(state.publishJobs, id); if (!p) return; openInspector({ title: "Publishing job", subtitle: "Create · Schedule", description: p.payload && p.payload.caption || "Scheduled distribution", props: [["State", p.state], ["Scheduled", formatDate(p.scheduled_at)], ["Mode", p.publish_mode || "—"]], raw: p, tabs: ["overview", "activity", "raw", "ai"] }); }
  function inspectRequest(id) { var r = findById(state.siteRequests, id); if (!r) return; openInspector({ title: r.title || r.request_type || "Site request", subtitle: "Work · Request", description: r.note || r.description || "Client/site request", props: [["Status", r.status], ["Created", formatDate(r.created_at || r.at)]], raw: r }); }

  function openBridge(key) {
    var b = bridge[key]; if (!b) return;
    openInspector({ title: b.title, subtitle: "Existing specialized surface", description: b.subtitle, props: [["Authority", "Existing McCluster backend"], ["Migration", "No backend fork"]], actions: '<button class="cr-btn cr-btn--primary" data-open-href="' + esc(b.href) + '">Open</button>' });
  }

  function submitCoreTask(task, context) {
    var value = String(task || "").trim(); if (!value) return Promise.resolve();
    return request("/v1/ai/task", { method: "POST", body: { task: context ? (context + "\n\n" + value) : value, conversation_origin: "control-room" } }).then(function (r) {
      if (r && r.job) { state.jobs.unshift(r.job); openInspector({ title: "Objective queued", subtitle: "Canonical Core", description: value, props: [["Job", r.job.id], ["Type", r.job.job_type], ["Status", r.job.status], ["Target", r.job.target_id]], raw: r.job, tabs: ["overview", "raw", "ai"] }); }
      return r;
    }).catch(function (e) { openInspector({ title: "Core could not queue that", subtitle: "Command failed", description: e.message || String(e), props: [["Requested", value], ["Backend", "Canonical /v1/ai/task"]] }); });
  }

  function handleCommand(query) {
    var q = String(query || "").trim(); var lower = q.toLowerCase(); if (!q) { openPalette(); return; }
    var routes = [
      [/^(home|attention|today)$/i, function () { setSurface("home"); }],
      [/\b(inbox|messages?|conversations?|desk)\b/i, function () { setSurface("work", "inbox"); }],
      [/\b(pipeline|leads?|deals?|opportunit)/i, function () { setSurface("work", "pipeline"); }],
      [/\b(people|person|contacts?)\b/i, function () { setSurface("work", "people"); }],
      [/\b(companies|company|organizations?)\b/i, function () { setSurface("work", "companies"); }],
      [/\b(clients?)\b/i, function () { setSurface("work", "clients"); }],
      [/\b(tasks?|todo)\b/i, function () { setSurface("work", "tasks"); }],
      [/\b(orders?)\b/i, function () { setSurface("work", "orders"); }],
      [/\b(bookings?|appointments?)\b/i, function () { setSurface("work", "bookings"); }],
      [/\b(library|assets?)\b/i, function () { setSurface("create", "library"); }],
      [/\b(schedule|calendar|published|publishing)\b/i, function () { setSurface("create", "schedule"); }],
      [/\b(projects?|create|studio|media|campaigns?|canvas)\b/i, function () { setSurface("create", "projects"); }],
      [/\b(workload|agents?|runs?|jobs?|core)\b/i, function () { setSurface("system", "workload"); }],
      [/\b(observability|logs?|traces?|incidents?)\b/i, function () { setSurface("system", "observability"); }],
      [/\b(resources?|usage|spend|providers?|integrations?|api keys?)\b/i, function () { setSurface("system", "resources"); }],
      [/\b(system|health|ovh|cloudflare|supabase|gpu|infrastructure)\b/i, function () { setSurface("system", "overview"); }],
      [/\b(apps?|whip|prim3|halo|spatial|manufacture)\b/i, function () { setSurface("apps"); }]
    ];
    for (var i = 0; i < routes.length; i += 1) { if (routes[i][0].test(lower)) { closePalette(); routes[i][1](); return; } }
    closePalette(); submitCoreTask(q);
  }

  function paletteCommands() {
    return [
      ["Home", "Attention, signals, current work", "home"], ["Work · Inbox", "Unified incoming work", "work-inbox"], ["Work · Pipeline", "Leads and opportunities", "work-pipeline"], ["Work · People", "Canonical people", "work-people"],
      ["Create · Projects", "Creative objectives and canvas", "create-projects"], ["Create · Library", "Canonical assets", "create-library"], ["Create · Schedule", "Distribution and publishing", "create-schedule"],
      ["System · Overview", "Topology and service health", "system-overview"], ["System · Workload", "Agents, jobs, queues", "system-workload"], ["System · Observability", "Events, traces, incidents", "system-observability"], ["System · Resources", "Providers, usage, API access", "system-resources"], ["Apps", "Specialized products", "apps"]
    ];
  }
  function renderPalette(filter) {
    var q = String(filter || "").trim().toLowerCase(); var cmds = paletteCommands().filter(function (x) { return !q || (x[0] + " " + x[1]).toLowerCase().indexOf(q) >= 0; });
    $("crPaletteResults").innerHTML = cmds.length ? cmds.map(function (x, i) { return '<button class="cr-palette__item' + (i === 0 ? " is-active" : "") + '" type="button" data-action="' + x[2] + '"><span>' + esc(x[0]) + '</span><small>' + esc(x[1]) + '</small></button>'; }).join("") : '<button class="cr-palette__item" type="button" data-command-query="' + esc(filter) + '"><span>Give Core this objective</span><small>' + esc(filter) + '</small></button>';
    bindActions($("crPaletteResults"));
    $("crPaletteResults").querySelectorAll("[data-command-query]").forEach(function (b) { b.addEventListener("click", function () { handleCommand(b.getAttribute("data-command-query")); }); });
  }
  function openPalette() { var p = $("crPalette"); p.classList.add("is-open"); p.setAttribute("aria-hidden", "false"); var input = $("crPaletteInput"); input.value = ""; renderPalette(""); setTimeout(function () { input.focus(); }, 0); }
  function closePalette() { var p = $("crPalette"); p.classList.remove("is-open"); p.setAttribute("aria-hidden", "true"); }

  function runAction(action, el) {
    if (!action) return;
    if (action.indexOf("open-bridge:") === 0) { openBridge(action.split(":")[1]); return; }
    if (action === "home") setSurface("home");
    else if (action === "work-inbox") setSurface("work", "inbox");
    else if (action === "work-pipeline") setSurface("work", "pipeline");
    else if (action === "work-people") setSurface("work", "people");
    else if (action === "create-projects") setSurface("create", "projects");
    else if (action === "create-library") setSurface("create", "library");
    else if (action === "create-schedule") setSurface("create", "schedule");
    else if (action === "system-overview") setSurface("system", "overview");
    else if (action === "system-workload") setSurface("system", "workload");
    else if (action === "system-observability") setSurface("system", "observability");
    else if (action === "system-resources") setSurface("system", "resources");
    else if (action === "apps") setSurface("apps");
    else if (action === "refresh") load(true);
    else if (action === "hero-command") handleCommand($("crHeroInput") && $("crHeroInput").value);
    else if (action === "inspect-lead") inspectLead(el.getAttribute("data-id"));
    else if (action === "inspect-thread") inspectThread(el.getAttribute("data-id"));
    else if (action === "inspect-job") inspectJob(el.getAttribute("data-id"));
    else if (action === "inspect-service") inspectService(el.getAttribute("data-key"));
    else if (action === "inspect-asset") inspectAsset(el.getAttribute("data-id"));
    else if (action === "inspect-variant") inspectVariant(el.getAttribute("data-id"));
    else if (action === "inspect-post") inspectPost(el.getAttribute("data-id"));
    else if (action === "inspect-publish") inspectPublish(el.getAttribute("data-id"));
    else if (action === "inspect-request") inspectRequest(el.getAttribute("data-id"));
    else if (action === "open-project") { state.selectedProjectId = el.getAttribute("data-id"); render(); }
    else if (action === "close-project") { state.selectedProjectId = null; render(); }
    else if (action === "filters") openInspector({ title: "Filters", subtitle: titleCase(currentView()), description: "Filters are contextual to this view and use the same full-screen sheet on mobile.", props: [["View", titleCase(currentView())], ["Records", state.surface === "work" ? state.leads.length + state.threads.length : "contextual"]], tabs: ["overview", "ai"] });
    else if (action === "new-work") openInspector({ title: "Create", subtitle: "Work · " + titleCase(state.workView), description: "Creation remains routed to canonical record sources; no browser-only shadow record is created.", actions: '<button class="cr-btn" data-open-href="crm.html">Open current CRM creator</button>', tabs: ["overview", "ai"] });
    else if (action === "lead-status") {
      var lid = el.getAttribute("data-id"), st = el.getAttribute("data-status");
      supa("leads?id=eq." + encodeURIComponent(lid), { method: "PATCH", body: { status: st }, prefer: "return=minimal" }).then(function () { var lead = findById(state.leads, lid); if (lead) lead.status = st; inspectLead(lid); render(); });
    } else if (action === "thread-mode") {
      var tid = el.getAttribute("data-id"), mode = el.getAttribute("data-mode");
      request("/v1/comms/threads/" + encodeURIComponent(tid) + "/" + mode, { method: "POST", body: {} }).then(function () { return load(true); }).then(function () { inspectThread(tid); });
    } else if (action === "thread-compose") {
      var threadId = el.getAttribute("data-id");
      openInspector({ title: "Send message", subtitle: "Human control", description: "This queues through the existing communications outbox and Android SIM relay.", custom: inspectorSection("Message", '<textarea id="crThreadMessage" class="cr-textarea" rows="6" placeholder="Write message…"></textarea>'), actions: '<button class="cr-btn cr-btn--primary" type="button" data-action="thread-send" data-id="' + esc(threadId) + '">Queue message</button>', tabs: ["overview"] });
    } else if (action === "thread-send") {
      var sendId = el.getAttribute("data-id"), body = $("crThreadMessage") && $("crThreadMessage").value.trim(); if (!body) return;
      request("/v1/comms/threads/" + encodeURIComponent(sendId) + "/send", { method: "POST", body: { body: body } }).then(function () { closeInspector(); return load(true); });
    } else if (action === "ai-context") {
      var q = $("crAiContextInput") && $("crAiContextInput").value.trim(); submitCoreTask(q, el.getAttribute("data-context"));
    } else if (action === "open-platform") {
      inspectService("api");
    }
  }

  function bindActions(root) {
    (root || document).querySelectorAll("[data-action]").forEach(function (el) {
      if (el.getAttribute("data-bound-action") === "1") return;
      el.setAttribute("data-bound-action", "1");
      el.addEventListener("click", function () { runAction(el.getAttribute("data-action"), el); });
    });
    (root || document).querySelectorAll("[data-open-href]").forEach(function (el) {
      if (el.getAttribute("data-bound-href") === "1") return;
      el.setAttribute("data-bound-href", "1");
      el.addEventListener("click", function () { location.href = el.getAttribute("data-open-href"); });
    });
    (root || document).querySelectorAll("tr[data-action]").forEach(function (tr) {
      if (tr.getAttribute("data-bound-key") === "1") return;
      tr.setAttribute("data-bound-key", "1");
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); runAction(tr.getAttribute("data-action"), tr); } });
    });
  }

  function filterCurrentView(query) {
    var q = String(query || "").trim().toLowerCase();
    document.querySelectorAll(".cr-canvas .cr-row, .cr-data-table tbody tr, .cr-board .cr-card").forEach(function (el) {
      el.style.display = !q || el.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none";
    });
  }
  function bindSurfaceControls() {
    bindActions($("crSurface"));
    var select = $("crViewSelect");
    if (select) select.addEventListener("change", function () { if (state.surface === "work") setSurface("work", select.value); else if (state.surface === "create") setSurface("create", select.value); else if (state.surface === "system") setSurface("system", select.value); });
    var search = $("crWorkSearch"); if (search) search.addEventListener("input", function () { filterCurrentView(search.value); });
    var hero = $("crHeroInput"); if (hero) hero.addEventListener("keydown", function (e) { if (e.key === "Enter") handleCommand(hero.value); });
  }

  function discoverOrg() { return settle(supa("orgs?slug=eq.mccluster&select=id,slug,name&limit=1"), []).then(function (rows) { return rows && rows[0] || null; }); }
  function loadCreative(org) {
    var orgId = org && org.id;
    var direct = [
      settle(supa("media_assets?select=*&order=created_at.desc&limit=150"), []),
      settle(supa("media_jobs?select=*&order=created_at.desc&limit=120"), []),
      settle(supa("social_campaigns?select=*&order=created_at.desc&limit=100" + (orgId ? "&org_id=eq." + encodeURIComponent(orgId) : "")), []),
      settle(supa("social_variants?select=*&order=created_at.desc&limit=200" + (orgId ? "&org_id=eq." + encodeURIComponent(orgId) : "")), []),
      settle(supa("social_publish_jobs?select=*&order=scheduled_at.desc&limit=200" + (orgId ? "&org_id=eq." + encodeURIComponent(orgId) : "")), []),
      settle(supa("social_posts?select=*&order=published_at.desc&limit=200" + (orgId ? "&org_id=eq." + encodeURIComponent(orgId) : "")), [])
    ];
    return Promise.all(direct).then(function (r) { return { mediaAssets: r[0] || [], mediaJobs: r[1] || [], campaigns: r[2] || [], variants: r[3] || [], publishJobs: r[4] || [], posts: r[5] || [] }; });
  }

  function load(force) {
    if (state.loading && !force) return Promise.resolve();
    state.loading = true; state.error = null; render();
    var health = settle(fetch(API + "/health", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }), null);
    var authed = token().then(function (t) {
      if (!t) return {};
      return discoverOrg().then(function (org) {
        var base = [
          settle(request("/v1/status"), null), settle(request("/v1/apps"), { apps: [] }), settle(request("/v1/ai/status"), null), settle(request("/v1/ai/system-health"), null),
          settle(request("/v1/comms/threads?limit=100"), { threads: [] }), settle(supa("leads?select=*&order=at.desc&limit=400"), []), settle(supa("site_requests?select=*&order=created_at.desc&limit=100"), []),
          settle(supa("ops_agent_jobs?select=*&order=created_at.desc&limit=200"), []), loadCreative(org)
        ];
        return Promise.all(base).then(function (r) { return { org: org, status: r[0], apps: r[1] && r[1].apps || [], ai: r[2], aiHealth: r[3], threads: r[4] && r[4].threads || [], leads: r[5] || [], siteRequests: r[6] || [], jobs: r[7] || [], creative: r[8] || {} }; });
      });
    });
    return Promise.all([health, authed]).then(function (r) {
      var a = r[1] || {}; state.health = r[0]; state.org = a.org || null; state.status = a.status || null; state.apps = a.apps || []; state.ai = a.ai || null; state.aiHealth = a.aiHealth || null; state.threads = a.threads || []; state.leads = a.leads || []; state.siteRequests = a.siteRequests || []; state.jobs = a.jobs || [];
      state.mediaAssets = a.creative && a.creative.mediaAssets || []; state.mediaJobs = a.creative && a.creative.mediaJobs || []; state.campaigns = a.creative && a.creative.campaigns || []; state.variants = a.creative && a.creative.variants || []; state.publishJobs = a.creative && a.creative.publishJobs || []; state.posts = a.creative && a.creative.posts || [];
      state.refreshedAt = new Date().toISOString(); if (!state.status) state.error = "Operator status unavailable";
    }).catch(function (e) { state.error = e.message || "Control Room state unavailable"; }).then(function () { state.loading = false; render(); });
  }

  function boot() { $("cpGate").hidden = true; $("crApp").hidden = false; readHash(); setHash(true); render(); load(); }
  function bindAuth() {
    $("cpIn").addEventListener("click", function () { var em = $("cpEmail").value.trim(), pw = $("cpPass").value; if (!em) { note("Email first.", true); return; } if (!pw) { note("No password? Use the sign-in link below.", true); return; } var b = $("cpIn"); b.disabled = true; b.textContent = "Opening…"; window.MCC_AUTH.signInPassword(em, pw).then(boot).catch(function (e) { b.disabled = false; b.textContent = "Open Control Room"; note(String(e && e.message || e), true); }); });
    $("cpPass").addEventListener("keydown", function (e) { if (e.key === "Enter") $("cpIn").click(); });
    $("cpLink").addEventListener("click", function () { var em = $("cpEmail").value.trim(); if (!em) { note("Email first.", true); return; } var b = $("cpLink"); b.disabled = true; b.textContent = "Sending…"; window.MCC_AUTH.signIn(em).then(function () { b.textContent = "Link sent"; note("Check " + em + ". The link opens this page signed in."); }).catch(function (e) { b.disabled = false; b.textContent = "Email me a sign-in link"; note(String(e && e.message || e), true); }); });
  }
  function bindShell() {
    document.querySelectorAll("[data-surface]").forEach(function (el) { el.addEventListener("click", function () { setSurface(el.getAttribute("data-surface")); }); });
    $("crCommandOpen").addEventListener("click", openPalette);
    $("crInspectorClose").addEventListener("click", closeInspector);
    $("crInspectorTabs").addEventListener("click", function (e) { var b = e.target.closest("[data-inspector-tab]"); if (!b || !state.inspector) return; state.inspector.tab = b.getAttribute("data-inspector-tab"); renderInspector(); });
    $("crPalette").addEventListener("click", function (e) { if (e.target === $("crPalette")) closePalette(); });
    $("crPaletteInput").addEventListener("input", function () { renderPalette($("crPaletteInput").value); });
    $("crPaletteInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { var first = $("crPaletteResults").querySelector(".cr-palette__item"); if (first) first.click(); else handleCommand($("crPaletteInput").value); } });
    $("crAccount").addEventListener("click", function () { $("crAccountMenu").classList.toggle("is-open"); });
    $("crRefresh").addEventListener("click", function () { $("crAccountMenu").classList.remove("is-open"); load(true); });
    $("crOut").addEventListener("click", function () { window.MCC_AUTH.signOut().then(function () { location.reload(); }); });
    document.addEventListener("click", function (e) { if (!$("crAccountMenu").contains(e.target) && !$("crAccount").contains(e.target)) $("crAccountMenu").classList.remove("is-open"); });
    document.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); } if (e.key === "Escape") { if ($("crPalette").classList.contains("is-open")) closePalette(); else closeInspector(); } });
    window.addEventListener("hashchange", function () { readHash(); state.selectedProjectId = null; closeInspector(); render(); });
  }
  function tryResume() { token().then(function (t) { if (t && $("crApp").hidden) boot(); }); }
  function init() { bindAuth(); bindShell(); bindActions(document); tryResume(); setTimeout(tryResume, 700); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
