/* ============================================================
   THE SONG TEST — "Was this song racist? Why?"

   CIA Mind Control is a test as much as an album. One card per song:
     locked    the server has not counted a full listen yet (for the
               earned track: no play spent on it yet)
     open      Yes / No / Not sure, and a required "why"
     answered  what you said, and how everyone voted on that song

   The rules live in the database (song_test_state / song_test_answer):
   this file never decides who has heard what. The written reasons go to
   the owner only; listeners see the split, and only after answering.

     var t = MCC_SONGTEST.mount(el, "cia-mind-control", { signin: "/account.html" })
     t.refresh()          re-ask the server (a song just ended)
     t.focus("pull-up")   bring one song's card into view

   Both the album player and end-racism.html mount it. Nothing here
   throws or blocks playback; signed out, it says how to take part.
   ============================================================ */
(function (root, doc) {
  "use strict";
  if (root.MCC_SONGTEST) return;

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var VERDICTS = [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]];

  function stored() {
    try {
      var s = root.MCC && root.MCC.session && root.MCC.session();
      if (s && s.access_token) return s;
    } catch (e) {}
    try { var raw = JSON.parse(root.localStorage.getItem("mccdb_session") || "null"); return raw && raw.access_token ? raw : null; }
    catch (e) { return null; }
  }
  function session() {
    if (root.MCC && root.MCC.refreshIfNeeded) return root.MCC.refreshIfNeeded().catch(function () { return stored(); });
    return Promise.resolve(stored());
  }
  function rpc(fn, args) {
    return session().then(function (s) {
      if (!s || !s.access_token) throw Object.assign(new Error("Sign in first."), { status: 401 });
      return fetch(SB + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: KEY, authorization: "Bearer " + s.access_token, "content-type": "application/json" },
        body: JSON.stringify(args || {})
      });
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) throw Object.assign(new Error((d && d.message) || "The test did not answer."), { status: r.status });
        return d;
      });
    });
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function track(name, props) { try { if (root.MCC_TRACK) root.MCC_TRACK(name, props || {}); } catch (e) {} }
  function label(v) { var hit = VERDICTS.filter(function (x) { return x[0] === v; })[0]; return hit ? hit[1] : v; }

  function mount(box, album, opts) {
    opts = opts || {};
    var rows = [];
    var editing = {};      /* track → true while changing an answer */
    var drafts = {};       /* track → { verdict, why } not yet sent */
    var note = {};         /* track → message under the card */

    function paint() {
      box.textContent = "";
      box.classList.add("stq");
      if (!stored()) {
        var p = el("p", "stq-out");
        p.appendChild(doc.createTextNode("Sign in, hear each song all the way through, then answer. "));
        var a = el("a", null, "Sign in");
        a.href = opts.signin || "/account.html";
        p.appendChild(a);
        box.appendChild(p);
        return;
      }
      if (!rows.length) { box.appendChild(el("p", "stq-out", "Loading the test…")); return; }
      rows.forEach(function (r) { box.appendChild(card(r)); });
    }

    function card(r) {
      var c = el("article", "stq-card");
      c.setAttribute("data-stq", r.track);
      var head = el("header", "stq-head");
      head.appendChild(el("b", null, r.label));
      head.appendChild(el("span", "stq-state", r.answer ? "Answered" : r.heard ? "Open" : "Locked"));
      c.appendChild(head);
      c.appendChild(el("p", "stq-q", r.question));

      if (!r.heard) {
        c.classList.add("is-locked");
        c.appendChild(el("p", "stq-lock", r.gated
          ? "Unlocks after you spend your earned play on it in the album player."
          : "Unlocks after you hear the whole song. Skipping ahead doesn’t count."));
      } else if (r.answer && !editing[r.track]) {
        c.appendChild(result(r));
      } else {
        c.appendChild(form(r));
      }
      if (note[r.track]) c.appendChild(el("p", "stq-msg" + (note[r.track].bad ? " is-bad" : ""), note[r.track].text));
      return c;
    }

    function result(r) {
      var wrap = el("div", "stq-result");
      var you = el("p", "stq-you");
      you.appendChild(doc.createTextNode("You said "));
      you.appendChild(el("b", null, label(r.answer.verdict)));
      you.appendChild(doc.createTextNode(": “" + r.answer.why + "”"));
      wrap.appendChild(you);
      var s = r.split || { total: 0 };
      var total = Number(s.total || 0);
      VERDICTS.forEach(function (v) {
        var n = Number(s[v[0]] || 0), pct = total ? Math.round(n / total * 100) : 0;
        var row = el("div", "stq-bar" + (r.answer.verdict === v[0] ? " is-you" : ""));
        row.appendChild(el("span", "stq-bar__k", v[1]));
        var bar = el("span", "stq-bar__t");
        var fill = el("i");
        fill.style.width = pct + "%";
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el("span", "stq-bar__n", pct + "%"));
        wrap.appendChild(row);
      });
      wrap.appendChild(el("p", "stq-total", total === 1 ? "1 listener has answered." : total.toLocaleString("en-US") + " listeners have answered."));
      var again = el("button", "stq-link", "Change my answer");
      again.type = "button";
      again.addEventListener("click", function () {
        editing[r.track] = true;
        drafts[r.track] = { verdict: r.answer.verdict, why: r.answer.why };
        note[r.track] = null;
        paint();
      });
      wrap.appendChild(again);
      return wrap;
    }

    function form(r) {
      var d = drafts[r.track] || (drafts[r.track] = { verdict: "", why: "" });
      var f = el("div", "stq-form");
      var opts = el("div", "stq-opts");
      opts.setAttribute("role", "radiogroup");
      opts.setAttribute("aria-label", r.question);
      VERDICTS.forEach(function (v) {
        var b = el("button", "stq-opt", v[1]);
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", d.verdict === v[0] ? "true" : "false");
        b.addEventListener("click", function () {
          d.verdict = v[0];
          Array.prototype.forEach.call(opts.children, function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); });
        });
        opts.appendChild(b);
      });
      f.appendChild(opts);
      var lab = el("label", "stq-why");
      lab.appendChild(el("span", null, "Why?"));
      var ta = el("textarea");
      ta.maxLength = 1000;
      ta.rows = 3;
      ta.value = d.why || "";
      ta.placeholder = "Say what you heard and why you think so.";
      ta.addEventListener("input", function () { d.why = ta.value; });
      lab.appendChild(ta);
      f.appendChild(lab);
      var send = el("button", "stq-send", r.answer ? "Save my answer" : "Answer");
      send.type = "button";
      send.addEventListener("click", function () {
        if (!d.verdict) { note[r.track] = { text: "Pick Yes, No or Not sure.", bad: true }; paint(); return; }
        if ((d.why || "").trim().length < 3) { note[r.track] = { text: "Say why: that part matters most.", bad: true }; paint(); return; }
        send.disabled = true;
        rpc("song_test_answer", { p_track: r.track, p_verdict: d.verdict, p_why: d.why.trim() }).then(function (next) {
          rows = Array.isArray(next) ? next : rows;
          editing[r.track] = false;
          drafts[r.track] = null;
          note[r.track] = null;
          track("song_test_answer", { album: album, track: r.track, verdict: d.verdict });
          paint();
        }).catch(function (e) {
          note[r.track] = { text: e.message || "That did not save. Try again.", bad: true };
          paint();
        });
      });
      f.appendChild(send);
      return f;
    }

    function refresh() {
      if (!stored()) { rows = []; paint(); return Promise.resolve(); }
      return rpc("song_test_state", { p_album: album }).then(function (list) {
        rows = Array.isArray(list) ? list : [];
        if (opts.onLoad) try { opts.onLoad(rows); } catch (e) {}
        paint();
      }).catch(function (e) {
        rows = [];
        box.textContent = "";
        box.appendChild(el("p", "stq-out", e.status === 404 ? "The test opens soon." : "The test is unreachable right now."));
      });
    }

    function focus(key) {
      var c = box.querySelector('[data-stq="' + key + '"]');
      if (!c) return;
      c.classList.add("is-now");
      c.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { c.classList.remove("is-now"); }, 2400);
    }

    paint();
    refresh();
    /* a song the ledger just counted unlocks its card */
    if (root.MCC_LISTENS && root.MCC_LISTENS.onFinish) root.MCC_LISTENS.onFinish(function () { refresh(); });
    root.addEventListener("mcc:auth-changed", function () { refresh(); });
    return { refresh: refresh, focus: focus, rows: function () { return rows; } };
  }

  root.MCC_SONGTEST = { mount: mount };
})(window, document);
