/* Native Control · Work · Desk bot.

   The back office of the desk bot that answers the website, Instagram,
   Telegram and the other inbox channels: what it is allowed to say (the
   knowledge base), what it has cost today, every message a platform
   refused, which channels it speaks on, and the tools it may reach for.

   It used to be js/inbox-desk.js on inbox.html, which could never run:
   inbox.html is a compatibility URL that returns to Control before that
   script loads. This is the same room, inside Control.

   ONE DOOR. Every read and write is an action on the existing `inbox`
   edge function (supabase/functions/inbox/index.ts), sent with the
   operator's own session. The function re-checks who is asking: reading
   is staff, and changing what the bot may say, a credential or a tool is
   the org owner's (its OWNER_ONLY list). This file holds no privilege and
   no second store; a refusal from the function is shown, not guessed
   around. */
(function (root) {
  "use strict";
  root.CR = root.CR || {};

  var TABS = [["knowledge", "Knowledge"], ["spend", "Spend"], ["refusals", "Refusals"], ["channels", "Channels"], ["tools", "Tools"]];
  var REFUSAL_FILTERS = [["all", "All"], ["refused", "Refused"], ["queued", "Waiting"], ["sent", "Sent"]];

  /* ---------- pure helpers (scripts/test/control-desk-bot.test.mjs) ---------- */

  /** ai_calls and the budget are stored in micro-dollars. */
  function money(micros) {
    var d = (Number(micros) || 0) / 1e6;
    return "$" + (d < 0.01 ? d.toFixed(4) : d.toFixed(2));
  }

  /** What the router is doing at this level of spend. The thresholds are
   *  the function's own (supabase/functions/inbox/ai.ts): past the budget
   *  every reply hands off to a person, past three quarters it runs the
   *  cheapest model only. */
  function spendPosture(spent, budget) {
    spent = Number(spent) || 0; budget = Number(budget) || 0;
    var pct = budget ? Math.min(100, Math.round(100 * spent / budget)) : 0;
    if (budget && pct >= 100) return { pct: pct, level: "spent", text: "Spent. Every reply is handing off to you until midnight." };
    if (budget && pct >= 75) return { pct: pct, level: "degraded", text: "Past three quarters: the cheapest model only, at the lowest effort." };
    return { pct: pct, level: "ok", text: budget ? "Under budget. Full router." : "No budget is set for this workspace." };
  }

  /** "4 chunks · 3 unembedded": a chunk with no embedding is found by
   *  keyword only, which is the commonest reason an answer goes missing. */
  function docMeta(d) {
    d = d || {};
    var chunks = Number(d.chunks) || 0, embedded = Number(d.embedded) || 0;
    var out = chunks + " chunk" + (chunks === 1 ? "" : "s");
    if (embedded < chunks) out += " · " + (chunks - embedded) + " unembedded";
    return out;
  }

  /** A queued message's state, as a tone and the refusal-queue bucket. */
  function outboundBucket(o) {
    var s = String(o && o.state || "");
    if (s === "sent") return "sent";
    if (s === "refused" || s === "failed" || (o && o.refusal)) return "refused";
    return "queued";
  }

  /** The kb_put body, or the reason there is none. Kind is kept when a
   *  document is being replaced: the function matches the existing row on
   *  org + kind + (url, else title), and a different kind is a new row. */
  function kbPutBody(form) {
    form = form || {};
    var title = String(form.title || "").trim(), body = String(form.body || "").trim(), url = String(form.url || "").trim();
    if (!title || !body) return { error: "A title and a body, at least." };
    if (body.length > 200000) return { error: "That page is over 200,000 characters; split it." };
    return { body: { title: title, body: body, url: url || null, kind: String(form.kind || "page") } };
  }

  /** Which org to speak for. The function refuses to guess for somebody in
   *  several orgs and answers 403 with the list; the Control workspace is
   *  the first choice when it is on that list. */
  function pickOrg(orgs, preferred) {
    orgs = Array.isArray(orgs) ? orgs : [];
    for (var i = 0; i < orgs.length; i++) if (orgs[i] && (orgs[i].slug === preferred || orgs[i].id === preferred)) return orgs[i];
    return orgs[0] || null;
  }

  var helpers = Object.freeze({ money: money, spendPosture: spendPosture, docMeta: docMeta, outboundBucket: outboundBucket, kbPutBody: kbPutBody, pickOrg: pickOrg, TABS: TABS });

  /* ---------- the view ---------- */

  var D = {
    rerender: null, workspace: null, ready: null,
    tab: "knowledge", org: null, orgs: [], seenWorkspace: undefined,
    data: {}, loading: {}, errors: {}, note: null, busy: {},
    form: { title: "", url: "", body: "", kind: "page" }, replacing: null, confirmDrop: null,
    tryQ: "", tryHits: null, refusalFilter: "all"
  };

  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function note(t, bad) { return '<div class="cro-note' + (bad ? " cro-note--bad" : "") + '" role="status">' + e(t) + "</div>"; }
  function redraw() { if (D.rerender) D.rerender(); }
  function say(t, bad) { D.note = t ? { text: t, bad: !!bad } : null; redraw(); }
  function ago(v) {
    if (!v) return "—";
    var s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
    if (!Number.isFinite(s)) return "—";
    if (s < 90) return Math.round(s) + "s ago";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 172800) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  function workspaceSlug() { var w = D.workspace ? D.workspace() : null; return w && w.slug || null; }

  /** The one door: POST {action, org, …} to the inbox function with the
   *  operator's own bearer token, exactly as the visitor desk does. */
  function fn(action, extra, retried) {
    var S = root.MCC_SUPA;
    if (!S || !S.url) return Promise.reject(new Error("No backend is configured on this build."));
    var body = { action: action };
    var org = D.org || workspaceSlug();
    if (org) body.org = org;
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    return S.token().then(function (tok) {
      if (!tok) throw new Error("signed out");
      return fetch(S.url + "/functions/v1/inbox", {
        method: "POST",
        headers: { "content-type": "application/json", apikey: S.key, authorization: "Bearer " + tok },
        body: JSON.stringify(body)
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        /* "name which org this is for" (or a workspace slug this operator
           is not on the desk for) arrives WITH the list of orgs: that list is
           the picker, and the call is made again once for the chosen one. */
        if (r.status === 403 && Array.isArray(j.orgs) && j.orgs.length && !retried) {
          D.orgs = j.orgs;
          var chosen = pickOrg(j.orgs, D.org || workspaceSlug());
          if (chosen && chosen.slug !== body.org) { D.org = chosen.slug; return fn(action, extra, true); }
        }
        var err = new Error(j.error || j.detail || ("HTTP " + r.status));
        err.status = r.status;
        throw err;
      });
    });
  }

  function load(tab, force) {
    tab = tab || D.tab;
    if (D.loading[tab] || (D.data[tab] && !force)) return Promise.resolve();
    D.loading[tab] = true; D.errors[tab] = null; redraw();
    var job = tab === "knowledge" ? fn("kb_list").then(function (r) { return r.documents || []; })
      : tab === "spend" ? fn("ai_spend")
      : tab === "refusals" ? fn("outbound").then(function (r) { return r.outbound || []; })
      : tab === "channels" ? fn("channels").then(function (r) {
          if (r.org && !D.orgs.length) D.orgs = [r.org];
          if (r.org && !D.org) D.org = r.org.slug;
          return r.channels || [];
        })
      : Promise.all([fn("tools"), fn("approvals")]).then(function (r) { return { servers: r[0].servers || [], tools: r[0].tools || [], approvals: r[1].approvals || [] }; });
    return job.then(function (data) { D.data[tab] = data; })
      .catch(function (err) { D.errors[tab] = err; })
      .then(function () { D.loading[tab] = false; redraw(); });
  }

  function act(key, promise, ok, reloadTab) {
    D.busy[key] = true; redraw();
    return promise.then(function (r) {
      D.busy[key] = false;
      say(typeof ok === "function" ? ok(r) : ok || "");
      if (reloadTab) return load(reloadTab, true);
    }).catch(function (err) { D.busy[key] = false; say(err.message || String(err), true); });
  }

  /* ---------- tabs ---------- */

  function knowledge() {
    var docs = D.data.knowledge || [];
    var list = docs.length ? '<div class="cro-list">' + docs.map(function (d) {
      var confirming = D.confirmDrop === d.id;
      return '<div class="cro-item" data-crd-doc="' + e(d.id) + '"><div class="cro-item__head"><div><strong>' + e(d.title) + '</strong>' +
        '<div class="cro-meta"><span class="cro-pill">' + e(d.kind || "page") + "</span> " + e(docMeta(d)) + " · " + e(ago(d.updated_at)) +
        (d.enabled === false ? ' · <span class="cro-pill">off</span>' : "") + "</div>" +
        (d.url ? '<div class="cro-meta crd-url">' + e(d.url) + "</div>" : "") + "</div></div>" +
        '<div class="cro-actions"><button class="cr-btn" type="button" data-crd-replace="' + e(d.id) + '">Replace</button>' +
        '<button class="cr-btn' + (confirming ? " cr-btn--danger" : "") + '" type="button" data-crd-drop="' + e(d.id) + '"' + (D.busy["drop:" + d.id] ? " disabled" : "") + ">" +
        (D.busy["drop:" + d.id] ? "Removing…" : confirming ? "Confirm remove" : "Remove") + "</button>" +
        (confirming ? '<button class="cr-btn cr-btn--ghost" type="button" data-crd-drop-cancel>Keep it</button>' : "") + "</div></div>";
    }).join("") + "</div>"
      : (D.data.knowledge ? note("Nothing yet. Until something is in here the bot only says what a flow rule tells it to, which is safe and not very useful. scripts/kb-build.mjs fills it from the offer ledger.") : "");

    var hits = D.tryHits;
    var tryOut = hits == null ? "" : hits.length ? '<div class="cro-list" style="margin-top:8px">' + hits.map(function (h) {
      return '<div class="cro-item"><div class="cro-meta"><span class="cro-pill">' + (h.fts_rank ? "keyword #" + e(h.fts_rank) : "no keyword match") + '</span> <span class="cro-pill">' +
        (h.vec_rank ? "meaning #" + e(h.vec_rank) : "no vector") + "</span> " + e(h.title) + "</div><div>" + e(h.body) + "</div></div>";
    }).join("") + "</div>" : note("Nothing matched. The bot would hand this one to you.", true);

    var f = D.form, r = D.replacing;
    return '<section class="cro-card"><h2>What it may say</h2><p>Anything not in here, the bot does not say: putting a page here is the act of authorising it.</p>' + list + "</section>" +
      '<section class="cro-card"><h2>Ask what it would find</h2><form class="cro-form" data-crd-try-form><label>Question<input id="crdTryQ" type="search" value="' + e(D.tryQ) + '" placeholder="how much for a website"></label>' +
      '<div class="cro-actions"><button class="cr-btn cr-btn--primary" type="submit"' + (D.busy.tryq ? " disabled" : "") + ">" + (D.busy.tryq ? "Searching…" : "Search") + "</button></div></form>" + tryOut + "</section>" +
      '<section class="cro-card" id="crdTeach"><h2>' + (r ? "Replace “" + e(r.title) + "”" : "Teach it a page") + "</h2>" +
      "<p>" + (r ? "Paste the new text. The same " + (r.url ? "URL" : "title") + " replaces the stored document and its chunks; an unchanged page re-embeds nothing." : "Headings help: each chunk is stored under “Title — Heading”, which is what makes an answer findable. The same title (or URL) replaces what is there.") + "</p>" +
      '<form class="cro-form cro-form--2" data-crd-put-form><label>Title<input id="crdKbTitle" value="' + e(f.title) + '" autocomplete="off"></label>' +
      '<label>URL (optional)<input id="crdKbUrl" type="url" value="' + e(f.url) + '" placeholder="https://…" autocomplete="off"></label>' +
      '<label class="cro-span-2">Page<textarea id="crdKbBody">' + e(f.body) + "</textarea></label>" +
      '<div class="cro-actions cro-span-2"><button class="cr-btn cr-btn--primary" type="submit"' + (D.busy.put ? " disabled" : "") + ">" + (D.busy.put ? "Indexing…" : r ? "Replace it" : "Add it") + "</button>" +
      (r ? '<button class="cr-btn cr-btn--ghost" type="button" data-crd-replace-cancel>Cancel</button>' : "") + "</div></form></section>" +
      '<section class="cro-card"><h2>True right now</h2><p>Quoted verbatim into every answer: hours, “closed until the 8th”. A blank value removes the key.</p>' +
      '<form class="cro-form cro-form--2" data-crd-shared-form><label>Key<input id="crdShKey" placeholder="hours" autocomplete="off"></label><label>Value<input id="crdShVal" placeholder="Closed until the 8th" autocomplete="off"></label>' +
      '<div class="cro-actions cro-span-2"><button class="cr-btn cr-btn--primary" type="submit"' + (D.busy.shared ? " disabled" : "") + ">Set</button></div></form></section>";
  }

  function spend() {
    var s = D.data.spend;
    if (!s) return "";
    var p = spendPosture(s.spent_micros, s.budget_micros), day = s.day || {};
    var rows = (s.recent || []).map(function (r) {
      return '<div class="cro-row"><div class="cro-row__top"><b>' + e(r.purpose) + ' <span class="cro-meta">' + e(r.model) + "</span></b>" +
        (r.ok ? "" : '<span class="cro-pill crd-bad">failed</span>') + "</div>" +
        '<div class="cro-meta">' + e(money(r.cost_micros)) + " · " + e(r.latency_ms || 0) + "ms · " + e(ago(r.at)) + "</div>" +
        (r.error ? '<div class="cro-meta crd-bad">' + e(String(r.error).slice(0, 160)) + "</div>" : "") + "</div>";
    }).join("");
    return '<div class="cro-statgrid"><div class="cro-stat"><b>' + e(money(s.spent_micros)) + "</b><span>spent today</span></div>" +
      '<div class="cro-stat"><b>' + e(money(s.budget_micros)) + "</b><span>daily budget</span></div>" +
      '<div class="cro-stat"><b>' + e(day.calls || 0) + "</b><span>calls · 24h</span></div>" +
      '<div class="cro-stat"><b>' + e(day.failures || 0) + "</b><span>failed · 24h</span></div></div>" +
      '<div class="cro-progress" role="img" aria-label="' + e(p.pct) + '% of the daily budget"><i style="--pct:' + e(p.pct) + '%"></i></div>' +
      note(p.text, p.level !== "ok") +
      '<section class="cro-card"><h2>Every call</h2>' + (rows || '<p>Nothing has been asked of a model yet.</p>') + "</section>";
  }

  function refusals() {
    var all = D.data.refusals || [];
    var counts = { all: all.length, refused: 0, queued: 0, sent: 0 };
    all.forEach(function (o) { counts[outboundBucket(o)]++; });
    var shown = all.filter(function (o) { return D.refusalFilter === "all" || outboundBucket(o) === D.refusalFilter; });
    var chips = '<div class="cro-chips">' + REFUSAL_FILTERS.map(function (f) {
      return '<button class="cro-chip' + (D.refusalFilter === f[0] ? " is-on" : "") + '" type="button" data-crd-rfilter="' + f[0] + '" aria-pressed="' + (D.refusalFilter === f[0]) + '">' + e(f[1]) + " · " + counts[f[0]] + "</button>";
    }).join("") + "</div>";
    var list = shown.length ? '<div class="cro-list">' + shown.map(function (o) {
      var b = outboundBucket(o);
      return '<div class="cro-item"><div class="cro-meta"><span class="cro-pill">' + e(o.channel) + '</span> <span class="cro-pill' + (b === "refused" ? " crd-bad" : b === "sent" ? " crd-ok" : " crd-warn") + '">' + e(o.state) + "</span> " +
        (o.costs_money ? '<span class="cro-pill crd-warn">costs money</span> ' : "") + e(ago(o.created_at)) + "</div>" +
        "<div>" + e(String(o.body || "").slice(0, 240)) + "</div>" +
        (o.refusal ? '<div class="cro-meta crd-bad">' + e(o.refusal) + "</div>" : "") +
        (o.last_error ? '<div class="cro-meta crd-bad">' + e(String(o.last_error).slice(0, 200)) + "</div>" : "") + "</div>";
    }).join("") + "</div>"
      : note(all.length ? "Nothing in this bucket." : "Nothing has been queued. A refusal would show here too: that is the point of the list.");
    return chips + '<p class="cro-meta">A message a platform would not take is listed with its reason, because “why did nobody get thanked” is the question this list answers.</p>' + list;
  }

  function channels() {
    var rows = D.data.channels || [];
    if (!rows.length) return note("No channels are in the catalogue.");
    return '<div class="cro-list">' + rows.map(function (c) {
      var cred = c.credential || {}, can = [];
      if (c.can_reply_comments) can.push("comments");
      if (c.can_send_dm) can.push(c.dm_window_hours ? "DMs (" + c.dm_window_hours + "h window)" : "DMs");
      if (!can.length) can.push("nothing yet");
      var key = "chan:" + c.key;
      return '<div class="cro-item"><div class="cro-item__head"><div><strong>' + e(c.label || c.key) + "</strong>" +
        '<div class="cro-meta"><span class="cro-pill' + (c.enabled ? " crd-ok" : "") + '">' + (c.enabled ? "on" : "off") + "</span> " +
        (cred.token_env ? '<span class="cro-pill ' + (c.token_present ? "crd-ok" : "crd-bad") + '">' + e(cred.token_env) + (c.token_present ? "" : " missing") + "</span> "
          : '<span class="cro-pill crd-bad">no credential</span> ') + e(can.join(" · ")) + "</div>" +
        (cred.last_error ? '<div class="cro-meta crd-bad">' + e(String(cred.last_error).slice(0, 180)) + "</div>" : "") +
        (c.note ? '<div class="cro-meta">' + e(c.note) + "</div>" : "") + "</div></div>" +
        '<div class="cro-actions"><button class="cr-btn' + (c.enabled ? "" : " cr-btn--primary") + '" type="button" data-crd-chan="' + e(c.key) + '" data-to="' + (c.enabled ? "0" : "1") + '"' + (D.busy[key] ? " disabled" : "") + ">" + (c.enabled ? "Turn off" : "Turn on") + "</button>" +
        (c.key === "bluesky" ? '<button class="cr-btn" type="button" data-crd-poll="bluesky"' + (D.busy.poll ? " disabled" : "") + ">Check Bluesky now</button>" : "") + "</div></div>";
    }).join("") + "</div>";
  }

  /* One tool. The risk word is the whole story; `auto` is only offered on a
     read tool, because the database refuses it on anything else. */
  function toolRow(t) {
    if (t.rejected) return '<div class="cro-row"><div class="cro-meta"><span class="cro-pill crd-bad">unusable</span> ' + e(t.name) + '</div><div class="cro-meta crd-bad">' + e(t.rejected) + "</div></div>";
    var risk = { read: "reads only", write: "changes something", act: "changes the world" }[t.risk] || t.risk;
    var tone = t.risk === "read" ? "" : t.risk === "write" ? " crd-warn" : " crd-bad";
    return '<div class="cro-row"><div class="cro-meta"><span class="cro-pill' + (t.enabled ? " crd-ok" : "") + '">' + (t.enabled ? "on" : "off") + '</span> <span class="cro-pill' + tone + '">' + e(risk) + "</span> " +
      (t.auto ? '<span class="cro-pill crd-warn">runs unattended</span> ' : "") + "<b>" + e(t.name) + "</b></div>" +
      (t.description ? '<div class="cro-meta">' + e(t.description) + "</div>" : "") +
      '<div class="cro-actions"><button class="cr-btn" type="button" data-crd-tool="' + e(t.id) + '" data-field="enabled" data-to="' + (t.enabled ? "0" : "1") + '">' + (t.enabled ? "Off" : "On") + "</button>" +
      (t.risk === "read" ? '<button class="cr-btn" type="button" data-crd-tool="' + e(t.id) + '" data-field="auto" data-to="' + (t.auto ? "0" : "1") + '">' + (t.auto ? "Ask first" : "Let it run") + "</button>" : "") + "</div></div>";
  }

  function tools() {
    var d = D.data.tools || { servers: [], tools: [], approvals: [] };
    var out = "";
    if (d.approvals.length) {
      out += '<section class="cro-card crd-waiting"><h2>Waiting on you</h2><div class="cro-list">' + d.approvals.map(function (a) {
        return '<div class="cro-item"><strong>' + e(a.tool) + '</strong><div class="cro-meta">' + e(a.reason || "no reason given") + "</div>" +
          '<div class="cro-code">' + e(JSON.stringify(a.arguments || {})) + "</div>" +
          '<div class="cro-meta">asked ' + e(ago(a.created_at)) + " · lapses " + e(a.expires_at ? new Date(a.expires_at).toLocaleString() : "—") + "</div>" +
          '<div class="cro-actions"><button class="cr-btn cr-btn--primary" type="button" data-crd-decide="' + e(a.id) + '" data-yes="1">Do it</button><button class="cr-btn" type="button" data-crd-decide="' + e(a.id) + '" data-yes="0">No</button></div></div>';
      }).join("") + "</div></section>";
    }
    out += '<section class="cro-card"><h2>Machines</h2>' + (d.servers.length ? '<div class="cro-list">' + d.servers.map(function (sv) {
      var mine = d.tools.filter(function (t) { return t.server_id === sv.id; });
      return '<div class="cro-item"><div class="cro-item__head"><div><strong>' + e(sv.name) + '</strong><div class="cro-meta"><span class="cro-pill' + (sv.enabled ? " crd-ok" : "") + '">' + (sv.enabled ? "on" : "off") + '</span> <span class="cro-pill ' + (sv.token_present || sv.auth_kind === "none" ? "crd-ok" : "crd-bad") + '">' +
        (sv.auth_kind === "none" ? "no auth" : sv.token_present ? "credential set" : "credential missing") + '</span> <span class="crd-url">' + e(sv.url) + "</span></div>" +
        (sv.last_error ? '<div class="cro-meta crd-bad">' + e(String(sv.last_error).slice(0, 200)) + "</div>" : "") +
        '<div class="cro-meta">' + e(mine.length + " tool" + (mine.length === 1 ? "" : "s")) + (sv.tools_refreshed_at ? " · looked " + e(ago(sv.tools_refreshed_at)) : " · never looked") + "</div></div></div>" +
        '<div class="cro-actions"><button class="cr-btn" type="button" data-crd-refresh="' + e(sv.id) + '">Look again</button><button class="cr-btn' + (sv.enabled ? "" : " cr-btn--primary") + '" type="button" data-crd-server="' + e(sv.id) + '" data-to="' + (sv.enabled ? "0" : "1") + '">' + (sv.enabled ? "Turn off" : "Turn on") + "</button></div>" +
        mine.map(toolRow).join("") + "</div>";
    }).join("") + "</div>" : "<p>No machines connected. A building, a booking system, anything that speaks MCP: add it below and the bot can reach it. Until then it only knows what you have written down.</p>") + "</section>" +
      '<section class="cro-card"><h2>Connect a machine</h2><form class="cro-form cro-form--2" data-crd-server-form><label>Name<input id="crdSvName" placeholder="the church building" autocomplete="off"></label><label>MCP URL<input id="crdSvUrl" type="url" placeholder="https://…/mcp" autocomplete="off"></label>' +
      '<label class="cro-span-2">Secret name (optional)<input id="crdSvEnv" placeholder="Name of the env var holding its token" autocomplete="off"></label>' +
      '<p class="cro-meta cro-span-2">Never paste the token itself. Name the secret; the row holds the name.</p><div class="cro-actions cro-span-2"><button class="cr-btn cr-btn--primary" type="submit">Connect</button></div></form></section>';
    return out;
  }

  function render() {
    /* Control names its workspace once its first load lands; asking the
       desk before then would ask for the wrong org (or none). */
    if (D.ready && !D.ready()) return '<div class="cro crd" data-crd>' + note("Reading the desk…") + "</div>";
    /* A workspace switch in Control is a different org: start over. */
    var ws = workspaceSlug();
    if (D.seenWorkspace !== ws) { D.seenWorkspace = ws; D.org = null; D.orgs = []; D.data = {}; D.errors = {}; D.tryHits = null; D.note = null; D.replacing = null; D.confirmDrop = null; }
    if (!D.data[D.tab] && !D.loading[D.tab] && !D.errors[D.tab]) load(D.tab);
    var picker = D.orgs.length > 1 ? '<div class="cro-chips" aria-label="Desk organisation">' + D.orgs.map(function (o) {
      return '<button class="cro-chip' + (o.slug === D.org ? " is-on" : "") + '" type="button" data-crd-org="' + e(o.slug) + '" aria-pressed="' + (o.slug === D.org) + '">' + e(o.name || o.slug) + (o.role ? " · " + e(o.role) : "") + "</button>";
    }).join("") + "</div>" : "";
    var tabs = '<div class="cro-tabs" role="tablist" aria-label="Desk bot">' + TABS.map(function (t) {
      return '<button class="cro-tab' + (D.tab === t[0] ? " is-on" : "") + '" type="button" role="tab" aria-selected="' + (D.tab === t[0]) + '" data-crd-tab="' + t[0] + '">' + e(t[1]) + "</button>";
    }).join("") + '<button class="cro-tab" type="button" data-crd-reload>Reload</button></div>';
    var err = D.errors[D.tab];
    var head = D.loading[D.tab] && !D.data[D.tab] ? note("Reading the desk…")
      : err ? note((err.status === 403 ? "The desk refused: " : "The desk did not answer: ") + (err.message || err) + (/staff/i.test(err.message || "") ? " (this account is not on the desk's staff list for any org)." : ""), true) : "";
    var body = err && !D.data[D.tab] ? "" : D.tab === "knowledge" ? knowledge() : D.tab === "spend" ? spend() : D.tab === "refusals" ? refusals() : D.tab === "channels" ? channels() : tools();
    return '<div class="cro crd" data-crd>' + picker + tabs + (D.note ? note(D.note.text, D.note.bad) : "") + head + body +
      '<p class="cro-meta">Every action here goes to the <code>inbox</code> edge function with your session. Reading is staff; changing what the bot may say, a channel or a tool is the org owner\'s, and the function says so when it refuses.</p></div>';
  }

  function val(rootEl, id) { var el = rootEl.querySelector("#" + id); return el ? el.value : ""; }

  function bind(rootEl) {
    if (!rootEl || !rootEl.querySelector("[data-crd]")) return;
    function each(sel, f) { rootEl.querySelectorAll(sel).forEach(f); }
    each("[data-crd-tab]", function (b) { b.onclick = function () { D.tab = b.getAttribute("data-crd-tab"); D.note = null; redraw(); }; });
    each("[data-crd-reload]", function (b) { b.onclick = function () { D.note = null; D.errors[D.tab] = null; load(D.tab, true); }; });
    each("[data-crd-org]", function (b) { b.onclick = function () { D.org = b.getAttribute("data-crd-org"); D.data = {}; D.errors = {}; D.tryHits = null; D.note = null; redraw(); }; });
    each("[data-crd-rfilter]", function (b) { b.onclick = function () { D.refusalFilter = b.getAttribute("data-crd-rfilter"); redraw(); }; });

    /* knowledge */
    var keep = function () { D.form.title = val(rootEl, "crdKbTitle"); D.form.url = val(rootEl, "crdKbUrl"); D.form.body = val(rootEl, "crdKbBody"); };
    each("[data-crd-replace]", function (b) {
      b.onclick = function () {
        var d = (D.data.knowledge || []).find(function (x) { return String(x.id) === b.getAttribute("data-crd-replace"); });
        if (!d) return;
        D.replacing = d; D.form = { title: d.title || "", url: d.url || "", body: "", kind: d.kind || "page" }; D.note = null; redraw();
        var t = (root.document || document).getElementById("crdKbBody");
        if (t) { if (t.scrollIntoView) t.scrollIntoView({ block: "center" }); t.focus(); }
      };
    });
    each("[data-crd-replace-cancel]", function (b) { b.onclick = function () { D.replacing = null; D.form = { title: "", url: "", body: "", kind: "page" }; redraw(); }; });
    each("[data-crd-drop]", function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-crd-drop");
        if (D.confirmDrop !== id) { D.confirmDrop = id; redraw(); return; }
        D.confirmDrop = null;
        act("drop:" + id, fn("kb_drop", { id: id }), "Removed. The bot no longer says what that page said.", "knowledge");
      };
    });
    each("[data-crd-drop-cancel]", function (b) { b.onclick = function () { D.confirmDrop = null; redraw(); }; });
    each("[data-crd-put-form]", function (f) {
      f.onsubmit = function (ev) {
        ev.preventDefault(); keep();
        var built = kbPutBody(D.form);
        if (built.error) { say(built.error, true); return; }
        act("put", fn("kb_put", built.body), function (r) {
          D.replacing = null; D.form = { title: "", url: "", body: "", kind: "page" };
          return r.indexed ? (r.chunks + " chunk" + (r.chunks === 1 ? "" : "s") + (r.embedded ? ", embedded." : ", keyword-only: no embedding key on the function."))
            : "Unchanged, so nothing was re-embedded.";
        }, "knowledge");
      };
    });
    each("[data-crd-try-form]", function (f) {
      f.onsubmit = function (ev) {
        ev.preventDefault(); keep();
        D.tryQ = val(rootEl, "crdTryQ").trim();
        if (!D.tryQ) return;
        D.busy.tryq = true; redraw();
        fn("kb_try", { q: D.tryQ }).then(function (r) { D.tryHits = r.hits || []; })
          .catch(function (err) { say(err.message || String(err), true); })
          .then(function () { D.busy.tryq = false; redraw(); });
      };
    });
    each("[data-crd-shared-form]", function (f) {
      f.onsubmit = function (ev) {
        ev.preventDefault(); keep();
        var k = val(rootEl, "crdShKey").trim(), v = val(rootEl, "crdShVal").trim();
        if (!k) { say("A key, at least.", true); return; }
        act("shared", fn("shared_put", { key: k, value: v }), function (r) { return r.removed ? "Removed " + r.removed + "." : "Set " + (r.key || k) + "."; });
      };
    });

    /* channels */
    each("[data-crd-chan]", function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-crd-chan");
        act("chan:" + k, fn("set_channel", { channel: k, enabled: b.getAttribute("data-to") === "1" }), "", "channels");
      };
    });
    each("[data-crd-poll]", function (b) {
      b.onclick = function () {
        act("poll", fn("poll", { channel: b.getAttribute("data-crd-poll") }), function (r) { return r.error ? r.error : "Looked. " + (r.found || 0) + " new."; });
      };
    });

    /* tools */
    each("[data-crd-decide]", function (b) {
      b.onclick = function () {
        b.disabled = true;
        act("decide", fn("decide", { id: b.getAttribute("data-crd-decide"), approve: b.getAttribute("data-yes") === "1" }), function (r) { return r.result || ("Marked " + (r.state || "done") + "."); }, "tools");
      };
    });
    each("[data-crd-tool]", function (b) {
      b.onclick = function () {
        b.disabled = true;
        var body = { id: b.getAttribute("data-crd-tool") };
        body[b.getAttribute("data-field")] = b.getAttribute("data-to") === "1";
        act("tool", fn("set_tool", body), "", "tools");
      };
    });
    each("[data-crd-server]", function (b) {
      b.onclick = function () {
        b.disabled = true;
        act("server", fn("set_server", { id: b.getAttribute("data-crd-server"), enabled: b.getAttribute("data-to") === "1" }), "", "tools");
      };
    });
    each("[data-crd-refresh]", function (b) {
      b.onclick = function () {
        b.disabled = true;
        act("refresh", fn("refresh_tools", { server_id: b.getAttribute("data-crd-refresh") }), function (r) {
          return r.error ? r.error : (r.usable || 0) + " usable" + (r.rejected ? ", " + r.rejected + " it could not read" : "");
        }, "tools");
      };
    });
    each("[data-crd-server-form]", function (f) {
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var n = val(rootEl, "crdSvName").trim(), u = val(rootEl, "crdSvUrl").trim(), env = val(rootEl, "crdSvEnv").trim();
        if (!n || !u) { say("A name and a URL.", true); return; }
        act("server", fn("set_server", { name: n, url: u, token_env: env || null, auth_kind: env ? "bearer" : "none" }), "Connected. Look at it to see what it can do.", "tools");
      };
    });
  }

  root.CR.deskBot = {
    init: function (opts) { D.rerender = opts.render; D.workspace = opts.workspace; D.ready = opts.ready || null; },
    render: render, bind: bind, load: load, helpers: helpers, state: D
  };
})(typeof window === "undefined" ? globalThis : window);
