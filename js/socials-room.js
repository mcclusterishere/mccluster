/* ============================================================
   THE SOCIALS ROOM — one composer, every destination.

   WHAT THIS REPLACES. A six-frame 3D carousel of marketing stills that
   linked to hire.html and press.html. It was filed in the backend registry
   as "Instagram and the other platforms, on the wall" and had no
   connection to Instagram, to any other platform, or to any table in this
   database. The whole social stack already existed — inbox_channels,
   org_channels, inbox_outbound, and a `social` edge function that can
   list channels, queue a post, dispatch the queue and report stats — and
   nothing in the product was wired to it.

   WHAT IT IS NOW. Write once, choose where it goes, send. Mnet is a
   destination like any other, because it is the one we own and it should
   not be a separate errand.

   THE SERVER DECIDES, AND IT EXPLAINS ITSELF. channels() returns per
   channel: postable, and if not, the blockers in words — "no credential
   configured", "switched off for this org", "last error: ...". This page
   renders those verbatim rather than greying a button out and leaving you
   to guess. The same goes for a refused queue: the reason comes back per
   channel and is shown against that channel.

   NOTHING HERE PRETENDS. A destination that cannot publish today says so
   in its own words and is not selectable. Telegram is the one platform
   whose API the dispatcher can actually drive right now; the rest queue
   honestly and wait on their credentials.
   ============================================================ */
(function (w, d) {
  "use strict";

  var FN = "https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/social";
  var MNET_APP = "mccluster-web";
  var MNET_MAX = 5000;

  var el = function (id) { return d.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var state = { channels: [], picked: {}, busy: false, mnetReady: false };

  function token() {
    var S = w.MCC_SUPA;
    return S && S.token ? S.token() : Promise.resolve(null);
  }

  function callSocial(payload) {
    return token().then(function (t) {
      if (!t) throw new Error("Sign in to use the Socials Room.");
      return fetch(FN, {
        method: "POST",
        headers: { authorization: "Bearer " + t, "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    }).then(function (r) {
      return r.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { /* not json */ }
        if (!r.ok) {
          throw Object.assign(new Error((body && body.error) || ("The social service returned " + r.status + ".")),
            { status: r.status });
        }
        return body || {};
      });
    });
  }

  /* ---------- destinations ----------
     Mnet first, because it is ours and it is the one that always works. */
  function mnetDest() {
    return {
      key: "__mnet__",
      label: "Mnet",
      account: "your McCluster profile",
      postable: state.mnetReady,
      blockers: state.mnetReady ? [] : ["sign in to post to Mnet"],
      house: true
    };
  }
  function destinations() { return [mnetDest()].concat(state.channels); }

  function renderDests() {
    var host = el("srDests");
    var list = destinations();
    host.innerHTML = list.map(function (c) {
      var on = !!state.picked[c.key] && c.postable;
      return '<button type="button" class="sr-dest' + (on ? " sr-on" : "") +
        (c.postable ? "" : " sr-dest--off") + '" data-key="' + esc(c.key) + '"' +
        (c.postable ? ' aria-pressed="' + (on ? "true" : "false") + '"' : ' disabled') + '>' +
        '<span class="sr-dest__tick" aria-hidden="true">' + (on ? "&#10003;" : "") + "</span>" +
        '<span class="sr-dest__l">' + esc(c.label) + (c.house ? ' <em class="sr-house">ours</em>' : "") + "</span>" +
        '<span class="sr-dest__s">' +
          (c.postable ? esc(c.account || "ready")
                      : esc(c.blockers[0] || "not available")) + "</span></button>";
    }).join("");
    var n = list.filter(function (c) { return state.picked[c.key] && c.postable; }).length;
    el("srSend").disabled = state.busy || !n || !el("srBody").value.trim();
    el("srSend").textContent = state.busy ? "Sending…"
      : n ? "Post to " + n + " destination" + (n === 1 ? "" : "s") : "Choose a destination";
  }

  function renderCount() {
    var len = el("srBody").value.length;
    var c = el("srCount");
    c.textContent = len.toLocaleString() + " / " + MNET_MAX.toLocaleString();
    c.className = "sr-count" + (len > MNET_MAX ? " sr-over" : "");
    renderDests();
  }

  /* ---------- the send ----------
     Each destination is reported on its own. A partial success is the
     normal case here — Telegram goes out, X waits on a credential — and a
     composer that says only "posted" or only "failed" is lying about one
     of them. */
  function report(rows) {
    el("srResult").hidden = false;
    el("srResult").innerHTML = '<h2 class="sr-h">What happened</h2>' +
      '<ul class="sr-rep">' + rows.map(function (r) {
        return '<li class="sr-rep__row sr-rep--' + r.state + '">' +
          '<span class="sr-rep__k">' + esc(r.label) + "</span>" +
          '<span class="sr-rep__v">' + esc(r.detail) + "</span></li>";
      }).join("") + "</ul>";
  }

  function send() {
    var body = el("srBody").value.trim();
    if (!body || state.busy) return;
    if (body.length > MNET_MAX) return;

    var list = destinations().filter(function (c) { return state.picked[c.key] && c.postable; });
    if (!list.length) return;

    state.busy = true; renderDests();
    var wantMnet = list.some(function (c) { return c.key === "__mnet__"; });
    var keys = list.filter(function (c) { return c.key !== "__mnet__"; })
                   .map(function (c) { return c.key; });

    var jobs = [];
    /* Mnet goes through the same Worker route the Mnet composer uses, so a
       post made here is indistinguishable from one made there. */
    jobs.push(wantMnet
      ? w.MCC.api("/v1/mnet/posts?app_key=" + encodeURIComponent(MNET_APP),
          { method: "POST", body: { body: body } })
      : Promise.resolve(null));
    /* One queue call carries every other channel; the service answers per
       channel, which is what lets the report below be honest. */
    jobs.push(keys.length ? callSocial({ action: "queue", channels: keys, body: body, kind: "post" })
                          : Promise.resolve(null));

    Promise.allSettled(jobs).then(function (out) {
      var rows = [];

      if (wantMnet) {
        rows.push(out[0].status === "fulfilled"
          ? { label: "Mnet", state: "ok", detail: "Posted to your profile." }
          : { label: "Mnet", state: "bad",
              detail: (out[0].reason && out[0].reason.message) || "Could not post." });
      }

      if (keys.length) {
        if (out[1].status !== "fulfilled") {
          keys.forEach(function (k) {
            rows.push({ label: labelFor(k), state: "bad",
              detail: (out[1].reason && out[1].reason.message) || "The queue refused this." });
          });
        } else {
          var res = out[1].value || {};
          (res.queued || []).forEach(function (k) {
            rows.push({ label: labelFor(k), state: "ok",
              detail: res.approved_by ? "Queued and approved. It goes out on the next dispatch."
                                      : "Queued. It needs an approver before it can go out." });
          });
          (res.refused || []).forEach(function (r) {
            rows.push({ label: labelFor(r.channel), state: "bad", detail: r.why || "refused" });
          });
        }
      }

      report(rows);
      if (rows.some(function (r) { return r.state === "ok"; })) {
        el("srBody").value = "";
        renderCount();
      }
      state.busy = false;
      loadChannels();          // a send can change a channel's last_error
    });
  }

  function labelFor(key) {
    var hit = state.channels.filter(function (c) { return c.key === key; })[0];
    return hit ? hit.label : key;
  }

  /* ---------- panels ---------- */
  function renderChannelTable() {
    var host = el("srChannels");
    if (!state.channels.length) {
      host.innerHTML = '<p class="sr-none">The social service answered and listed no channels at all. ' +
        "That is a platform-side configuration, not a connection you can make from here.</p>";
      return;
    }
    host.innerHTML = '<ul class="sr-chan">' + state.channels.map(function (c) {
      return '<li class="sr-chan__row">' +
        '<span class="sr-chan__top"><b>' + esc(c.label) + "</b>" +
          '<span class="sr-pill sr-pill--' + (c.postable ? "on" : "off") + '">' +
            (c.postable ? "connected" : "not connected") + "</span></span>" +
        '<span class="sr-chan__sub">' + esc(c.account || "no account on file") + "</span>" +
        (c.blockers && c.blockers.length
          ? '<ul class="sr-why">' + c.blockers.map(function (b) {
              return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>"
          : "") +
        "</li>";
    }).join("") + "</ul>";
  }

  function renderStats(data, err) {
    var host = el("srStats");
    if (err) {
      host.innerHTML = '<p class="sr-none sr-none--stop"><b>Could not read the numbers.</b> ' +
        esc(err.message || "") + "</p>";
      return;
    }
    var by = (data && data.by_channel) || {};
    var keys = Object.keys(by);
    if (!keys.length) {
      host.innerHTML = '<p class="sr-none">Nothing sent or received in this window yet. ' +
        "That is a real zero — the service answered and had no rows.</p>";
      return;
    }
    host.innerHTML = '<ul class="sr-rank">' + keys.map(function (k) {
      var counts = by[k];
      var total = Object.keys(counts).reduce(function (n, c) { return n + counts[c]; }, 0);
      var parts = Object.keys(counts).sort().map(function (c) {
        return esc(c.replace(/_/g, " ")) + " " + counts[c];
      }).join(" · ");
      return '<li class="sr-rank__row"><span class="sr-rank__k">' + esc(labelFor(k)) + "</span>" +
        '<span class="sr-rank__n">' + parts + "</span>" +
        '<span class="sr-rank__v">' + total + "</span></li>";
    }).join("") + "</ul>";
  }

  /* ---------- load ----------
     Panels load and fail on their own: a stats read that is refused must
     not take the composer down with it. */
  function loadChannels() {
    return callSocial({ action: "channels" }).then(function (out) {
      state.channels = (out.channels || []).map(function (c) {
        return { key: c.key, label: c.label || c.key, account: c.account,
                 postable: !!c.postable, blockers: c.blockers || [] };
      });
      renderChannelTable(); renderDests();
    });
  }

  function boot() {
    /* Mnet readiness is a different question to the social service's, and
       either can be true without the other. */
    state.mnetReady = !!(w.MCC && w.MCC.api && w.MCC_SUPA);

    el("srBody").addEventListener("input", renderCount);
    el("srDests").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-key]");
      if (!b || b.disabled) return;
      var k = b.getAttribute("data-key");
      state.picked[k] = !state.picked[k];
      renderDests();
    });
    el("srSend").addEventListener("click", send);
    renderCount();

    Promise.allSettled([
      loadChannels(),
      callSocial({ action: "stats", days: 30 })
    ]).then(function (out) {
      if (out[0].status === "rejected") {
        var e = out[0].reason || {};
        el("srChannels").innerHTML = '<p class="sr-none sr-none--stop"><b>' +
          (e.status === 401 || e.status === 403
            ? "This account cannot publish under the house name."
            : "The channel list did not load.") + "</b> " + esc(e.message || "") + "</p>";
        el("srDests").innerHTML = "";
        renderDests();
      }
      renderStats(out[1].status === "fulfilled" ? out[1].value : null,
                  out[1].status === "rejected" ? out[1].reason : null);
    });
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window, document);
