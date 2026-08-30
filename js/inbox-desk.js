/* ============================================================
   THE INBOX BACK OFFICE

   Every channel, every thread, what the bot knows and what it cost —
   in one room, because the alternative was a page of curl commands
   and nobody runs those twice.

   TWO DOORS, DELIBERATELY. Reads go straight to PostgREST with the
   staff member's own token, so the RLS is the wall and this file has
   no privileges of its own. Writes go through the `inbox` edge
   function, which re-checks who is asking. A browser can never send
   a message as the owner, because the browser is never the thing
   that holds a platform token.

   IT SHOWS REFUSALS. A queued message that a platform would not take
   is not hidden as an error; it is listed with the reason, because
   "why did nobody get thanked" is the question this page exists to
   answer.
   ============================================================ */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (x) { var d = document.createElement("i"); d.textContent = x == null ? "" : x; return d.innerHTML; };

  var ROOMS = ["threads", "channels", "tools", "knowledge", "spend", "queue"];
  var room = "threads";
  // `org` is the slug this desk is currently looking at. Somebody who
  // works for one customer never sees it; somebody who works for several
  // gets a picker, because guessing on their behalf is how a message goes
  // out from the wrong company.
  var state = { convs: [], channels: [], open: null, msgs: [], busy: false, note: "",
                org: null, orgs: [] };

  function supa() { return window.MCC_SUPA && window.MCC_SUPA.url ? window.MCC_SUPA : null; }

  /** The uuid behind the current slug, for the direct PostgREST reads.
   *  RLS already limits them to orgs you belong to; this narrows them to
   *  the one you are LOOKING at, which is a different thing. */
  function orgId() {
    for (var i = 0; i < state.orgs.length; i++) {
      if (state.orgs[i].slug === state.org) return state.orgs[i].id;
    }
    return null;
  }

  function orgPicker() {
    if (state.orgs.length < 2) return "";
    return '<div class="rooms" style="margin-bottom:.6rem">' + state.orgs.map(function (o) {
      return '<button type="button" data-org="' + esc(o.slug) + '"' +
        (state.org === o.slug ? ' class="on"' : "") + ">" + esc(o.name || o.slug) + "</button>";
    }).join("") + "</div>";
  }

  /* ---------- the two doors ---------- */

  /** read: the staff member's own token, against the RLS */
  function q(path) {
    var S = supa();
    var oid = orgId();
    if (oid) path += (path.indexOf("?") < 0 ? "?" : "&") + "org_id=eq." + encodeURIComponent(oid);
    return S.token().then(function (tok) {
      return fetch(S.url + "/rest/v1/" + path, {
        headers: { apikey: S.key, Authorization: "Bearer " + tok, "content-type": "application/json" },
      });
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  function patch(path, body) {
    var S = supa();
    return S.token().then(function (tok) {
      return fetch(S.url + "/rest/v1/" + path, {
        method: "PATCH",
        headers: { apikey: S.key, Authorization: "Bearer " + tok, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return null; });
  }

  /** write: through the function, which checks the caller again */
  function fn(action, extra) {
    var S = supa();
    var body = { action: action };
    if (state.org) body.org = state.org;
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    return S.token().then(function (tok) {
      return fetch(S.url + "/functions/v1/inbox", {
        method: "POST",
        headers: { "content-type": "application/json", apikey: S.key, Authorization: "Bearer " + tok },
        body: JSON.stringify(body),
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var err = new Error(j.error || j.detail || ("HTTP " + r.status));
          // "name which org this is for" arrives WITH the list of orgs, and
          // that list is the only place the desk learns them from
          if (j.orgs) err.orgs = j.orgs;
          throw err;
        }
        return j;
      });
    });
  }

  /* ---------- little pieces ---------- */

  var ago = function (iso) {
    if (!iso) return "";
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return Math.round(s) + "s ago";
    if (s < 5400) return Math.round(s / 60) + "m ago";
    if (s < 172800) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  };

  var money = function (micros) {
    var d = (Number(micros) || 0) / 1e6;
    return "$" + (d < 0.01 ? d.toFixed(4) : d.toFixed(2));
  };

  /** The external id of the most recent thing they said — which is the
   *  thing a public reply hangs under. */
  function lastInboundId() {
    for (var i = state.msgs.length - 1; i >= 0; i--) {
      if (state.msgs[i].direction === "in" && state.msgs[i].external_id) return state.msgs[i].external_id;
    }
    return null;
  }

  function say(text, bad) { state.note = text ? { text: text, bad: !!bad } : ""; draw(); }

  function note() {
    if (!state.note) return "";
    return '<p class="' + (state.note.bad ? "err" : "ok") + '">' + esc(state.note.text) + "</p>";
  }

  /* ---------- rooms ---------- */

  function threadsRoom() {
    if (state.open) return oneThread();
    if (!state.convs.length) {
      return '<div class="empty">Nothing waiting. Every thread is answered or closed —' +
             ' which is the goal, not an empty database.</div>';
    }
    return state.convs.map(function (c) {
      var who = (c.inbox_contacts && (c.inbox_contacts.display_name || c.inbox_contacts.handle)) || "someone";
      return '<div class="card"><div class="row"><div>' +
        '<h3>' + esc(who) + "</h3>" +
        '<p class="muted">' +
          '<span class="pill">' + esc(c.channel) + "</span>" +
          '<span class="pill">' + esc(c.kind) + "</span>" +
          (c.claimed_by ? '<span class="pill warn">yours</span>' : "") +
          esc(ago(c.last_at || c.started_at)) +
        "</p></div>" +
        '<button class="sm" data-open="' + esc(c.id) + '">Read</button>' +
      "</div></div>";
    }).join("");
  }

  function oneThread() {
    var c = state.open;
    var who = (c.inbox_contacts && (c.inbox_contacts.display_name || c.inbox_contacts.handle)) || "someone";
    var body = state.msgs.map(function (m) {
      if (m.body === "[handed to a person]") return '<div class="msg sys">handed to a person</div>';
      var cls = m.direction === "in" ? "in" : "out";
      var why = m.state === "failed" && m.error ? '<span class="when">refused: ' + esc(m.error) + "</span>" : "";
      var call = m.meta && m.meta.source === "ai" ? m.meta.call : null;
      // Rating is on the CALL, not the thread: a thread can hold three
      // answers and only one of them can be the wrong one.
      var src = (m.meta && m.meta.source === "ai")
        ? '<span class="when">answered by the model' +
            (call ? ' &middot; <a href="#" data-ev="1" data-call="' + esc(call) + '">good</a>' +
                    ' &middot; <a href="#" data-ev="-1" data-call="' + esc(call) + '">wrong</a>' : "") +
          "</span>"
        : "";
      return '<div class="msg ' + cls + '">' + esc(m.body) + why + src +
             '<span class="when">' + esc(ago(m.at)) + "</span></div>";
    }).join("");

    return '<button class="sm" data-back="1">&#8592; all threads</button>' +
      '<p class="k">' + esc(who) + " &middot; " + esc(c.channel) + "</p>" +
      (body || '<div class="empty">No messages.</div>') +
      '<div class="card" style="margin-top:.8rem">' +
        '<textarea id="rep" placeholder="Reply as yourself. The bot stops talking in a thread you have claimed."></textarea>' +
        '<div class="row" style="margin-top:.5rem">' +
          '<div><span class="muted">' +
            (c.claimed_by ? "You have this thread." : "Sending claims it, so the bot steps back.") +
          "</span></div>" +
          '<button class="sm go" id="repGo">Send</button>' +
        "</div>" +
      "</div>";
  }

  function channelsRoom() {
    return state.channels.map(function (c) {
      var cred = c.credential || {};
      var can = [];
      if (c.can_reply_comments) can.push("comments");
      if (c.can_send_dm) can.push(c.dm_window_hours ? "DMs (" + c.dm_window_hours + "h window)" : "DMs");
      if (!can.length) can.push("nothing yet");
      return '<div class="card"><div class="row"><div>' +
        "<h3>" + esc(c.label || c.key) + "</h3>" +
        '<p class="muted">' +
          '<span class="pill ' + (c.enabled ? "live" : "") + '">' + (c.enabled ? "on" : "off") + "</span>" +
          (cred.token_env
            ? '<span class="pill ' + (c.token_present ? "live" : "dead") + '">' +
                esc(cred.token_env) + (c.token_present ? "" : " missing") + "</span>"
            : '<span class="pill dead">no credential</span>') +
          esc(can.join(" &middot; ").replace(/&middot;/g, "·")) +
        "</p>" +
        (cred.last_error
          ? '<p class="err" style="margin-top:.4rem">' + esc(String(cred.last_error).slice(0, 180)) + "</p>"
          : "") +
        (c.note ? '<p class="muted" style="margin-top:.4rem">' + esc(c.note) + "</p>" : "") +
      "</div>" +
      '<button class="sm' + (c.enabled ? "" : " go") + '" data-chan="' + esc(c.key) + '" data-to="' +
        (c.enabled ? "0" : "1") + '">' + (c.enabled ? "Turn off" : "Turn on") + "</button>" +
      "</div>" +
      (c.key === "bluesky"
        ? '<div style="margin-top:.5rem"><button class="sm" id="pollBsky">Check Bluesky now</button>' +
          '<span class="muted"> &mdash; nothing pushes; it has to be asked.</span></div>'
        : "") +
      "</div>";
    }).join("");
  }

  /* THE TOOLS ROOM.
     Two lists that read very differently on purpose. Approvals are things
     waiting on a person RIGHT NOW and sit at the top; the tool list below
     is a standing decision about what the bot may ever reach for. */
  function toolsRoom() {
    var out = "";

    var pend = state.approvals || [];
    if (pend.length) {
      out += '<p class="k">Waiting on you</p>' + pend.map(function (a) {
        return '<div class="card"><div class="row"><div>' +
          "<h3>" + esc(a.tool) + "</h3>" +
          '<p class="muted">' + esc(a.reason || "no reason given") + "</p>" +
          '<p class="muted"><code>' + esc(JSON.stringify(a.arguments || {})) + "</code></p>" +
          '<p class="muted">' + esc(ago(a.created_at)) + " · lapses " + esc(ago(a.expires_at)) + "</p>" +
        "</div><div>" +
          '<button class="sm go" data-decide="' + esc(a.id) + '" data-yes="1">Do it</button> ' +
          '<button class="sm" data-decide="' + esc(a.id) + '" data-yes="0">No</button>' +
        "</div></div></div>";
      }).join("");
    }

    var servers = state.servers || [];
    var tools = state.mcpTools || [];
    out += '<p class="k">Machines</p>';
    out += servers.length ? servers.map(function (sv) {
      var mine = tools.filter(function (t) { return t.server_id === sv.id; });
      return '<div class="card"><div class="row"><div>' +
        "<h3>" + esc(sv.name) + "</h3>" +
        '<p class="muted">' +
          '<span class="pill ' + (sv.enabled ? "live" : "") + '">' + (sv.enabled ? "on" : "off") + "</span>" +
          '<span class="pill ' + (sv.token_present ? "live" : "dead") + '">' +
            (sv.auth_kind === "none" ? "no auth" : sv.token_present ? "credential set" : "credential missing") + "</span>" +
          esc(sv.url) + "</p>" +
        (sv.last_error ? '<p class="err">' + esc(String(sv.last_error).slice(0, 200)) + "</p>" : "") +
        '<p class="muted">' + esc(mine.length + " tool" + (mine.length === 1 ? "" : "s")) +
          (sv.tools_refreshed_at ? " · looked " + esc(ago(sv.tools_refreshed_at)) : " · never looked") + "</p>" +
      "</div><div>" +
        '<button class="sm" data-refresh="' + esc(sv.id) + '">Look again</button> ' +
        '<button class="sm' + (sv.enabled ? "" : " go") + '" data-server="' + esc(sv.id) + '" data-to="' +
          (sv.enabled ? "0" : "1") + '">' + (sv.enabled ? "Turn off" : "Turn on") + "</button>" +
      "</div></div>" + mine.map(toolRow).join("") + "</div>";
    }).join("")
      : '<div class="empty">No machines connected. A building, a booking system, anything that speaks MCP — ' +
        'add it below and the bot can reach it. Until then it only knows what you have written down.</div>';

    out += '<div class="card" style="margin-top:.6rem">' +
      '<div class="grid2"><input class="f" id="svN" placeholder="the church building">' +
      '<input class="f" id="svU" placeholder="https://…/mcp"></div>' +
      '<input class="f" id="svE" style="margin-top:.4rem" placeholder="Name of the env var holding its token (optional)">' +
      '<div class="row" style="margin-top:.5rem">' +
        '<div><span class="muted">Never paste the token itself. Name the secret; the row holds the name.</span></div>' +
        '<button class="sm go" id="svGo">Connect</button></div>' +
    "</div>";
    return out;
  }

  /* One tool. The risk word is the whole story, so it is the loudest thing
     in the row, and `auto` only appears at all on a read tool — the
     database would refuse the pair anyway, and offering a switch that
     cannot be flipped is worse than not offering it. */
  function toolRow(t) {
    if (t.rejected) {
      return '<div class="row" style="margin-top:.5rem"><div>' +
        '<p class="muted"><span class="pill dead">unusable</span>' + esc(t.name) + "</p>" +
        '<p class="err">' + esc(t.rejected) + "</p></div></div>";
    }
    var risk = { read: "reads only", write: "changes something", act: "changes the world" }[t.risk] || t.risk;
    var cls = t.risk === "read" ? "" : t.risk === "write" ? "warn" : "dead";
    return '<div class="row" style="margin-top:.5rem"><div>' +
      '<p class="muted"><span class="pill ' + (t.enabled ? "live" : "") + '">' +
        (t.enabled ? "on" : "off") + '</span><span class="pill ' + cls + '">' + esc(risk) + "</span>" +
        (t.auto ? '<span class="pill warn">runs unattended</span>' : "") +
        "<b>" + esc(t.name) + "</b></p>" +
      (t.description ? '<p class="muted">' + esc(t.description) + "</p>" : "") +
    "</div><div>" +
      '<button class="sm" data-tool="' + esc(t.id) + '" data-field="enabled" data-to="' +
        (t.enabled ? "0" : "1") + '">' + (t.enabled ? "Off" : "On") + "</button>" +
      (t.risk === "read"
        ? ' <button class="sm" data-tool="' + esc(t.id) + '" data-field="auto" data-to="' +
          (t.auto ? "0" : "1") + '">' + (t.auto ? "Ask first" : "Let it run") + "</button>"
        : "") +
    "</div></div>";
  }

  function knowledgeRoom() {
    var docs = (state.kb || []).map(function (d) {
      return '<div class="card"><div class="row"><div>' +
        "<h3>" + esc(d.title) + "</h3>" +
        '<p class="muted"><span class="pill">' + esc(d.kind) + "</span>" +
        esc(d.chunks + " chunk" + (d.chunks === 1 ? "" : "s")) +
        (d.embedded === d.chunks ? "" : " · " + (d.chunks - d.embedded) + " unembedded") +
        " · " + esc(ago(d.updated_at)) + "</p>" +
        (d.url ? '<p class="muted">' + esc(d.url) + "</p>" : "") +
      "</div>" +
      '<button class="sm" data-drop="' + esc(d.id) + '">Remove</button>' +
      "</div></div>";
    }).join("");

    return '<p class="k">What it may say</p>' +
      (docs || '<div class="empty">Nothing yet. Until something is in here the bot only says what a flow rule tells it to — ' +
               'which is safe, and not very useful.</div>') +
      '<p class="k">Ask what it would find</p>' +
      '<div class="card">' +
        '<input class="f" id="tryQ" placeholder="how much for a website">' +
        '<div class="row" style="margin-top:.5rem"><div></div>' +
          '<button class="sm go" id="tryGo">Search</button></div>' +
        '<div id="tryOut"></div>' +
      "</div>" +
      '<p class="k">Teach it a page</p>' +
      '<div class="card">' +
        '<div class="grid2"><input class="f" id="kbT" placeholder="Title">' +
        '<input class="f" id="kbU" placeholder="https://… (optional)"></div>' +
        '<textarea id="kbB" style="margin-top:.4rem" placeholder="Paste the page. Headings help: each chunk is stored under &quot;Title — Heading&quot;, which is what makes an answer findable."></textarea>' +
        '<div class="row" style="margin-top:.5rem"><div></div>' +
          '<button class="sm go" id="kbGo">Add it</button></div>' +
      "</div>" +
      '<p class="k">True right now</p>' +
      '<div class="card">' +
        '<div class="grid2"><input class="f" id="shK" placeholder="hours">' +
        '<input class="f" id="shV" placeholder="Closed until the 8th"></div>' +
        '<div class="row" style="margin-top:.5rem">' +
          '<div><span class="muted">Quoted verbatim into every answer. Blank value removes it.</span></div>' +
          '<button class="sm go" id="shGo">Set</button></div>' +
      "</div>";
  }

  function spendRoom() {
    var s = state.spend;
    if (!s) return '<div class="empty">Loading.</div>';
    var pct = s.budget_micros ? Math.min(100, Math.round(100 * s.spent_micros / s.budget_micros)) : 0;
    var rows = (s.recent || []).map(function (r) {
      return '<div class="card"><div class="row"><div>' +
        "<h3>" + esc(r.purpose) + '<span class="muted" style="font-weight:600"> · ' + esc(r.model) + "</span></h3>" +
        '<p class="muted">' + esc(money(r.cost_micros)) + " · " + esc(r.latency_ms || 0) + "ms · " + esc(ago(r.at)) +
        (r.ok ? "" : ' <span class="pill dead">failed</span>') + "</p>" +
        (r.error ? '<p class="err">' + esc(String(r.error).slice(0, 160)) + "</p>" : "") +
      "</div></div></div>";
    }).join("");

    return '<div class="card">' +
        '<p class="num">' + esc(money(s.spent_micros)) + "</p>" +
        '<p class="muted">of ' + esc(money(s.budget_micros)) + " today · " + esc((s.day && s.day.calls) || 0) + " calls" +
        ((s.day && s.day.failures) ? " · " + esc(s.day.failures) + " failed" : "") + "</p>" +
        '<p class="muted" style="margin-top:.4rem">' +
          (pct >= 100 ? "Spent. Every reply is handing off to you until midnight."
           : pct >= 75 ? "Past three quarters — the cheapest model only, at the lowest effort."
           : "Under budget. Full router.") +
        "</p>" +
      "</div>" +
      '<p class="k">Every call</p>' +
      (rows || '<div class="empty">Nothing has been asked of a model yet.</div>');
  }

  function queueRoom() {
    var rows = (state.outbound || []).map(function (o) {
      var cls = o.state === "sent" ? "live" : (o.state === "refused" || o.state === "failed") ? "dead" : "warn";
      return '<div class="card">' +
        '<p class="muted"><span class="pill">' + esc(o.channel) + "</span>" +
        '<span class="pill ' + cls + '">' + esc(o.state) + "</span>" +
        (o.costs_money ? '<span class="pill warn">costs money</span>' : "") +
        esc(ago(o.created_at)) + "</p>" +
        "<p>" + esc(String(o.body || "").slice(0, 240)) + "</p>" +
        (o.refusal ? '<p class="err" style="margin-top:.4rem">' + esc(o.refusal) + "</p>" : "") +
        (o.last_error ? '<p class="err" style="margin-top:.4rem">' + esc(String(o.last_error).slice(0, 200)) + "</p>" : "") +
      "</div>";
    }).join("");
    return rows || '<div class="empty">Nothing has been queued. A refusal would show here too — ' +
                   'that is the point of the list.</div>';
  }

  /* ---------- draw ---------- */

  function draw() {
    var body = room === "threads" ? threadsRoom()
             : room === "channels" ? channelsRoom()
             : room === "tools" ? toolsRoom()
             : room === "knowledge" ? knowledgeRoom()
             : room === "spend" ? spendRoom()
             : queueRoom();

    $("ib").innerHTML = orgPicker() +
      '<div class="rooms">' + ROOMS.map(function (r) {
        return '<button type="button" data-room="' + r + '"' + (room === r ? ' class="on"' : "") + ">" + r + "</button>";
      }).join("") + "</div>" + note() + body;
    wire();
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-org]"), function (b) {
      b.onclick = function () {
        state.org = b.getAttribute("data-org");
        state.open = null; state.note = "";
        load();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-room]"), function (b) {
      b.onclick = function () { room = b.getAttribute("data-room"); state.note = ""; state.open = null; load(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-open]"), function (b) {
      b.onclick = function () { openThread(b.getAttribute("data-open")); };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-back]"), function (b) {
      b.onclick = function () { state.open = null; state.note = ""; draw(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-chan]"), function (b) {
      b.onclick = function () {
        b.disabled = true;
        fn("set_channel", { channel: b.getAttribute("data-chan"), enabled: b.getAttribute("data-to") === "1" })
          .then(load).catch(function (e) { say(e.message, true); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-drop]"), function (b) {
      b.onclick = function () {
        b.disabled = true;
        fn("kb_drop", { id: b.getAttribute("data-drop") }).then(load).catch(function (e) { say(e.message, true); });
      };
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-ev]"), function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        fn("eval", { call_id: a.getAttribute("data-call"), verdict: Number(a.getAttribute("data-ev")),
                     dimension: "helpful" })
          .then(function () { say("Noted."); })
          .catch(function (err) { say(err.message, true); });
      };
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-decide]"), function (b) {
      b.onclick = function () {
        b.disabled = true;
        fn("decide", { id: b.getAttribute("data-decide"), approve: b.getAttribute("data-yes") === "1" })
          .then(function (r) { say(r.result || ("Marked " + (r.state || "done") + ".")); load(); })
          .catch(function (e) { say(e.message, true); load(); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-tool]"), function (b) {
      b.onclick = function () {
        b.disabled = true;
        var patch = { id: b.getAttribute("data-tool") };
        patch[b.getAttribute("data-field")] = b.getAttribute("data-to") === "1";
        fn("set_tool", patch).then(load).catch(function (e) { say(e.message, true); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-server]"), function (b) {
      b.onclick = function () {
        b.disabled = true;
        fn("set_server", { id: b.getAttribute("data-server"), enabled: b.getAttribute("data-to") === "1" })
          .then(load).catch(function (e) { say(e.message, true); });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-refresh]"), function (b) {
      b.onclick = function () {
        b.disabled = true;
        fn("refresh_tools", { server_id: b.getAttribute("data-refresh") }).then(function (r) {
          say(r.error ? r.error
            : r.usable + " usable" + (r.rejected ? ", " + r.rejected + " it could not read" : ""), !!r.error);
          load();
        }).catch(function (e) { say(e.message, true); });
      };
    });
    if ($("svGo")) $("svGo").onclick = function () {
      var n = ($("svN").value || "").trim(), u = ($("svU").value || "").trim();
      if (!n || !u) { say("A name and a URL.", true); return; }
      $("svGo").disabled = true;
      fn("set_server", { name: n, url: u, token_env: ($("svE").value || "").trim() || null,
                         auth_kind: ($("svE").value || "").trim() ? "bearer" : "none" })
        .then(function () { say("Connected. Look at it to see what it can do."); load(); })
        .catch(function (e) { say(e.message, true); });
    };

    if ($("pollBsky")) $("pollBsky").onclick = function () {
      $("pollBsky").disabled = true;
      fn("poll", { channel: "bluesky" }).then(function (r) {
        say(r.error ? r.error : "Looked. " + r.found + " new.", !!r.error);
      }).catch(function (e) { say(e.message, true); });
    };

    if ($("repGo")) $("repGo").onclick = function () {
      var text = ($("rep").value || "").trim();
      if (!text || state.busy) return;
      state.busy = true; $("repGo").disabled = true;
      var c = state.open;
      // A comment is answered under the comment it answers, not under the
      // post: subject_ref is the post, and replying there would put your
      // reply somewhere the person never looks. The last inbound message
      // carries the id of the thing actually being replied to.
      var target = c.kind === "comment"
        ? lastInboundId() || c.subject_ref
        : (c.inbox_contacts && c.inbox_contacts.external_id);
      if (!target) { state.busy = false; say("Nothing to reply to on this thread yet.", true); return; }

      // claiming first is what stops the bot answering over the top of you
      patch("inbox_conversations?id=eq." + encodeURIComponent(c.id), { claimed_by: window.MCC_SUPA.uid() })
      .then(function () {
        return fn("send", { channel: c.channel, conv_id: c.id,
                            as: c.kind === "comment" ? "comment_reply" : "dm",
                            target_id: target, text: text });
      }).then(function (r) {
        state.busy = false;
        if (r.state !== "sent") { say(r.detail || r.state, true); return; }
        openThread(c.id);
      }).catch(function (e) { state.busy = false; say(e.message, true); });
    };

    if ($("kbGo")) $("kbGo").onclick = function () {
      var t = ($("kbT").value || "").trim(), b = ($("kbB").value || "").trim();
      if (!t || !b) { say("A title and a body, at least.", true); return; }
      $("kbGo").disabled = true;
      fn("kb_put", { title: t, body: b, url: ($("kbU").value || "").trim() || null, kind: "page" })
        .then(function (r) {
          say(r.indexed ? (r.chunks + " chunks" + (r.embedded ? ", embedded" : ", keyword-only — no VOYAGE_API_KEY"))
                        : "Unchanged, so nothing was re-embedded.");
          load();
        }).catch(function (e) { say(e.message, true); });
    };

    if ($("tryGo")) $("tryGo").onclick = function () {
      var qq = ($("tryQ").value || "").trim();
      if (!qq) return;
      $("tryGo").disabled = true;
      fn("kb_try", { q: qq }).then(function (r) {
        $("tryGo").disabled = false;
        $("tryOut").innerHTML = (r.hits || []).length
          ? r.hits.map(function (h) {
              return '<div style="margin-top:.7rem"><p class="muted"><span class="pill">' +
                (h.fts_rank ? "keyword #" + h.fts_rank : "no keyword match") + "</span>" +
                '<span class="pill">' + (h.vec_rank ? "meaning #" + h.vec_rank : "no vector") + "</span>" +
                esc(h.title) + "</p><p>" + esc(h.body) + "</p></div>";
            }).join("")
          : '<p class="err" style="margin-top:.7rem">Nothing matched. The bot would hand this one to you.</p>';
      }).catch(function (e) { $("tryGo").disabled = false; say(e.message, true); });
    };

    if ($("shGo")) $("shGo").onclick = function () {
      $("shGo").disabled = true;
      fn("shared_put", { key: ($("shK").value || "").trim(), value: ($("shV").value || "").trim() })
        .then(function (r) { say(r.removed ? "Removed " + r.removed + "." : "Set " + r.key + "."); })
        .catch(function (e) { say(e.message, true); });
    };
  }

  /* ---------- loading ---------- */

  function openThread(id) {
    q("inbox_conversations?id=eq." + encodeURIComponent(id) +
      "&select=id,channel,kind,status,claimed_by,subject_ref,last_at,inbox_contacts(display_name,handle,external_id)")
      .then(function (rows) {
        state.open = rows && rows[0];
        if (!state.open) throw new Error("that thread is gone");
        return q("inbox_messages?conv_id=eq." + encodeURIComponent(id) +
                 "&select=direction,body,at,state,error,meta,external_id&order=at.asc&limit=200");
      })
      .then(function (m) { state.msgs = m || []; state.note = ""; draw(); })
      .catch(function (e) { say(e.message, true); });
  }

  function load() {
    if (room === "threads") {
      return q("inbox_conversations?status=eq.open&select=id,channel,kind,claimed_by,subject_ref,last_at,started_at," +
               "inbox_contacts(display_name,handle,external_id)&order=last_at.desc.nullslast&limit=60")
        .then(function (r) { state.convs = r || []; draw(); })
        .catch(function (e) { say(e.message, true); });
    }
    if (room === "channels") {
      return fn("channels").then(function (r) {
        state.channels = r.channels || [];
        if (r.org && state.orgs.length < 2) { state.orgs = [r.org]; state.org = r.org.slug; }
        draw();
      })
        .catch(function (e) { say(e.message, true); });
    }
    if (room === "tools") {
      return fn("tools").then(function (r) {
        state.servers = r.servers || [];
        state.mcpTools = r.tools || [];
        return fn("approvals");
      }).then(function (r) { state.approvals = r.approvals || []; draw(); })
        .catch(function (e) { say(e.message, true); });
    }
    if (room === "knowledge") {
      return fn("kb_list").then(function (r) { state.kb = r.documents || []; draw(); })
        .catch(function (e) { say(e.message, true); });
    }
    if (room === "spend") {
      return fn("ai_spend").then(function (r) { state.spend = r; draw(); })
        .catch(function (e) { say(e.message, true); });
    }
    return fn("outbound").then(function (r) { state.outbound = r.outbound || []; draw(); })
      .catch(function (e) { say(e.message, true); });
  }

  /* ---------- the gate ---------- */

  function gate(msg) {
    $("ib").innerHTML = '<div class="gate">' + (msg ? '<p class="err">' + esc(msg) + "</p>" : "") +
      '<input id="gE" type="email" placeholder="you@mccluster.org" autocomplete="username">' +
      '<input id="gP" type="password" placeholder="Password" autocomplete="current-password">' +
      '<button id="gGo" type="button">Open the inbox &#8594;</button></div>';
    $("gGo").onclick = function () {
      window.MCC_AUTH.signInPassword($("gE").value.trim(), $("gP").value).then(boot)
        .catch(function () { gate("That didn't open it."); });
    };
  }

  function boot() {
    var S = supa();
    if (!S) { $("ib").innerHTML = '<div class="empty">No backend configured on this build.</div>'; return; }
    S.token().then(function (t) {
      if (!t) return gate();
      // The staff check lives in the function, not here. This call is the
      // cheapest way to ask it, and a 403 means the gate — not a broken page.
      //
      // Somebody who works for several customers gets a 403 with the list
      // in it rather than an answer, because the function refuses to guess
      // which one they meant. That refusal IS the picker's data.
      return fn("channels").then(function (r) {
        state.orgs = [r.org];
        state.org = r.org.slug;
        state.channels = r.channels || [];
        load();
      }).catch(function (e) {
        if (e.orgs && e.orgs.length) {
          state.orgs = e.orgs;
          state.org = e.orgs[0].slug;
          return load();
        }
        gate(/staff/i.test(e.message) ? "That account is not on the staff list." : e.message);
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
