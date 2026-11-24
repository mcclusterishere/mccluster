/* THE CARRY, THE PLATFORM'S SIDE (SPEC-PLATFORM 2.6 and 2.7). js/tabbar.js loads this file on a platform page with no
   usable session once the record's stage has the carry on (window.MCC_SITE.switches.carry, js/shell-boot.js: from P1);
   never on Matthew's host, which is the one asked, and never in a frame whose parent is this same origin.

   A platform page with no usable session, and no mark that it asked before, frames the tenant's carry page hidden
   (window.MCC_SITE.profile: its own origin and carry_path; carry.html) and asks it once for the sign-in this browser
   holds there, waiting up to four seconds. Only the access token crosses, by postMessage between the two exact origins,
   and only the frame's own answer to this page's own request id is read. The token is exchanged at the API's
   POST /v1/auth/handoff, which checks it with Supabase and answers this origin, on its CORS list, with a one-time token
   hash (no e-mail is sent); Supabase verifies that into a session of the platform's own, stored with the same paired
   write js/tabbar.js uses, and only if nothing signed this page in or out meanwhile. No token is ever in a URL, no
   refresh token ever crosses, and the session on the old host is left as it is. The mark mcc_carry_v1 records the
   result, so the frame is asked once per browser; where nothing could be carried, line() is the one clear sentence the
   account chip and the sign-in page show for 30 days, and paint() says it there.

   The same answer brings what SPEC-PLATFORM 2.7 carries: the analytics device id (only where the privacy notice was
   agreed on both hosts, and only if this origin has none, so one listener stays one device), the song pocket, mute and
   theme (each only where unset here), and the paths of the songs kept at the old address. offer() says keptLine(), "You
   kept 12 songs at the old address. Keep them here too?", once, in the bar's own peek card on a top-level platform page
   that shows the account chip (js/tabbar.js also loads this file for a member the carry already signed in while that
   offer waits); its tap is keepHere(), which re-keeps the same files at the same paths from this origin into this
   origin's vault (the old copies stay where they are), and Not now lets them be. Songs are counted as songs: the lyrics,
   posters and covers the album kept beside them ride along uncounted (review VP1-1, 2026-11-24).

   window.MCC_CARRY: { started, run, line, paint, keptLine, keepHere, offer, MARK, REQUEST, ANSWER, WAIT_MS }. */
(function (w, d) {
  "use strict";
  var MARK = "mcc_carry_v1", KEPT = "mcc_carry_kept_v1";
  var REQUEST = "mcc:carry-request", ANSWER = "mcc:carry-answer";
  var WAIT_MS = 4000, EXCHANGE_MS = 15000, LINE_DAYS = 30, KEPT_MAX = 500;
  /* the API and the auth server, as js/tabbar.js names them for the hand-off it replaces (neither is a site host) */
  var API_ORIGIN = "https://api.mccluster.org";
  var SB_URL = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var VAULT = "mcc-vault-v1";
  var NOTHING = ["none", "timeout", "refused", "failed"];
  var site = w.MCC_SITE || null;
  var flight = null;

  function read(key) { try { return w.localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { w.localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function drop(key) { try { w.localStorage.removeItem(key); } catch (e) { /* storage blocked */ } }
  function json(raw) { try { return JSON.parse(raw || "null"); } catch (e) { return null; } }
  function emit(type, detail) { try { w.dispatchEvent(new CustomEvent(type, { detail: detail })); } catch (e) { /* no listeners */ } }
  function slots() { return { main: read("mccdb_session"), keep: read("mcc_sess_keep") }; }
  /* as js/tabbar.js reads a stored session: one that can still be used or renewed stays */
  function usable(s) {
    if (!s || !s.access_token) return false;
    var exp = Number(s.expires_at);
    if (!exp) return true;
    if (exp > Math.floor(Date.now() / 1000)) return true;
    return !!s.refresh_token;
  }
  function signedIn() { var s = slots(); return usable(json(s.main)) || usable(json(s.keep)); }
  function requestId() {
    var bytes = new Uint8Array(24), out = "";
    try { w.crypto.getRandomValues(bytes); } catch (e) { for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < bytes.length; j += 1) out += (bytes[j] < 16 ? "0" : "") + bytes[j].toString(16);
    return out;
  }
  /* paths of this site only: one leading slash, no scheme, no host, no climbing */
  function keptPaths(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (p) {
      if (typeof p !== "string" || p.length > 512 || p.charAt(0) !== "/" || p.charAt(1) === "/" || p.indexOf("\\") !== -1) return;
      if (p.split("?")[0].split("/").indexOf("..") !== -1 || out.length >= KEPT_MAX || out.indexOf(p) !== -1) return;
      out.push(p);
    });
    return out;
  }
  /* the songs among kept paths (the vault keeps each song's lyrics, poster and cover beside it) */
  var SONG = /\.(?:mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
  function songsIn(paths) { return paths.filter(function (p) { return SONG.test(p.split("?")[0]); }); }
  function agreedHere() {
    try { return !!(w.MCC_PRIVACY && typeof w.MCC_PRIVACY.accepted === "function" && w.MCC_PRIVACY.accepted()); } catch (e) { return false; }
  }
  /* SPEC-PLATFORM 2.7: each adopted only where this origin has none */
  function adopt(c) {
    if (!c || typeof c !== "object") return;
    if (agreedHere() && typeof c.device === "string" && /^[A-Za-z0-9-]{8,64}$/.test(c.device) && read("mcc_device") === null) write("mcc_device", c.device);
    if (typeof c.pocket === "string" && c.pocket.length <= 4096 && json(c.pocket) && read("mcc-pocket") === null) write("mcc-pocket", c.pocket);
    if (typeof c.mute === "string" && /^[a-z0-9_-]{1,16}$/i.test(c.mute) && read("mcc_music_mute") === null) write("mcc_music_mute", c.mute);
    if (typeof c.theme === "string" && /^[a-z0-9_-]{1,16}$/i.test(c.theme) && read("mcc_theme") === null) write("mcc_theme", c.theme);
  }

  /* one deadline over the request and its body, as js/tabbar.js bounds the hand-off */
  function bounded(url, init) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error("timeout")); } }, EXCHANGE_MS);
      Promise.resolve().then(function () { return fetch(url, init); })
        .then(function (r) { return r && r.ok ? r.json() : Promise.reject(Object.assign(new Error("refused"), { refused: true })); })
        .then(function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
          function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    });
  }
  /* both canonical slots change together or not at all */
  function writeSlots(session, before) {
    if (!write("mccdb_session", session)) return false;
    if (!write("mcc_sess_keep", session)) {
      if (before.main === null) drop("mccdb_session"); else write("mccdb_session", before.main);
      return false;
    }
    return true;
  }
  function exchange(token) {
    var before = slots();
    return bounded(API_ORIGIN + "/v1/auth/handoff", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: "{}" })
      .then(function (j) {
        if (!j || !j.token_hash) throw Object.assign(new Error("refused"), { refused: true });
        return bounded(SB_URL + "/auth/v1/verify", { method: "POST", headers: { apikey: SB_KEY, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: j.token_hash }) });
      })
      .then(function (s) {
        if (!s || !s.access_token) return "refused";
        /* a sign-in or sign-out on this page while the two requests were in flight wins */
        var now = slots();
        if (now.main !== before.main || now.keep !== before.keep) return "account_changed";
        /* its expiry on this device's clock, as js/mcc-auth.js stamps it; the server's own kept beside it */
        var life = Number(s.expires_in) > 0 ? Number(s.expires_in) : 0, issued = Number(s.expires_at) > 0 ? Number(s.expires_at) : 0;
        var arrived = { access_token: s.access_token, refresh_token: s.refresh_token || "",
          expires_at: life ? Math.floor(Date.now() / 1000) + life : issued || Math.floor(Date.now() / 1000) + 3600 };
        if (life && issued) arrived.server_expires_at = issued;
        return writeSlots(JSON.stringify(arrived), before) ? "carried" : "blocked";
      })
      .catch(function (e) { return e && e.refused ? "refused" : "failed"; });
  }

  /* the frame, asked once; resolves with its answer or with no answer after WAIT_MS */
  function ask(tenant) {
    return new Promise(function (resolve) {
      var id = requestId(), origin = tenant.origin, done = false;
      var frame = d.createElement("iframe");
      frame.setAttribute("src", origin + tenant.carry_path);
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("title", "Sign-in carry");
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
      function settle(answer) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        w.removeEventListener("message", onMessage);
        try { frame.remove(); } catch (e) { /* already gone */ }
        resolve(answer);
      }
      function onMessage(e) {
        if (done || e.source !== frame.contentWindow || e.origin !== origin) return;
        var a = e.data;
        if (!a || a.type !== ANSWER || a.v !== 1 || a.id !== id) return;
        settle(a);
      }
      var timer = setTimeout(function () { settle(null); }, WAIT_MS);
      w.addEventListener("message", onMessage);
      frame.addEventListener("load", function () {
        if (done) return;
        try { frame.contentWindow.postMessage({ type: REQUEST, v: 1, id: id }, origin); } catch (e) { /* the frame went */ }
      });
      (d.body || d.documentElement).appendChild(frame);
    });
  }

  /* a frame whose parent is this same origin (the globe inside the World) asks nothing: its parent does. The World
     framed over Music on Matthew's host has a parent of another origin, and asks for itself. */
  function sameOriginParent() {
    if (w.parent === w) return false;
    try { return w.parent.location.origin === w.location.origin; } catch (e) { return false; }
  }
  function run() {
    if (flight) return flight;
    if (!site || !site.switches || typeof site.hostRole !== "function") return Promise.resolve({ result: "no_table" });
    if (site.switches.carry !== true) return Promise.resolve({ result: "off" });
    if (sameOriginParent()) return Promise.resolve({ result: "framed" });
    var role = site.hostRole(w.location.hostname);
    if (!role || role.role !== "platform") return Promise.resolve({ result: "not_platform" });
    if (signedIn()) return Promise.resolve({ result: "signed_in" });
    if (read(MARK) !== null) return Promise.resolve({ result: "done_before" });
    var tenant = site.profile;
    if (!tenant || !tenant.origin || !tenant.carry_path) return Promise.resolve({ result: "no_tenant" });
    if (!write(MARK + ":probe", "1")) return Promise.resolve({ result: "blocked" });
    drop(MARK + ":probe");
    flight = ask(tenant).then(function (answer) {
      if (!answer) return { result: "timeout", kept: 0 };
      adopt(answer.carry);
      var kept = keptPaths(answer.carry && answer.carry.kept);
      if (kept.length) write(KEPT, JSON.stringify(kept));
      if (typeof answer.access_token !== "string" || !answer.access_token) return { result: "none", kept: kept.length };
      return exchange(answer.access_token).then(function (result) { return { result: result, kept: kept.length }; });
    }).then(function (outcome) {
      write(MARK, JSON.stringify({ v: 1, result: outcome.result, at: new Date().toISOString() }));
      emit("mcc:carry", { result: outcome.result });
      if (outcome.result === "carried") emit("mcc:auth-changed", { signed_in: true, carried: true });
      return outcome;
    });
    return flight;
  }

  /* SPEC-PLATFORM 2.6.5: one line for 30 days where nothing could be carried, naming the platform from the table */
  function line() {
    var m = json(read(MARK));
    if (!m || !site || NOTHING.indexOf(m.result) === -1 || signedIn()) return "";
    var at = Date.parse(m.at);
    if (!(at > 0) || Date.now() - at > LINE_DAYS * 864e5) return "";
    return "McCluster now lives at " + site.platform.host + ". If you were signed in before, you still are; if not, sign in once here.";
  }
  /* the line where it is said: on the sign-in page (account.html's sign-in pane) and on the account chip (js/tabbar.js
     draws the chip), whose title and screen-reader description it is. A phone never shows a title, so a note under the
     chip says it too (SPEC-PLATFORM 2.6.5, review VP1-2): in the chip's own Account landmark and its own colours, never
     on the sign-in page (its pane says it there), never where the chip itself is not shown, never on the World (its
     door is its sign-in), and closed for good on this device by its close. Said again whenever the bar repaints the chip, the chip's box
     changes or the sign-in changes; gone once signed in or after 30 days. */
  var LINE_ID = "mccCarryLine", NOTE_ID = "mccCarryNote", NOTE_TEXT_ID = "mccCarryNoteText", NOTE_CLOSED = "mcc_carry_note_closed_v1";
  var STYLE_ID = "mccCarryStyle", OFFER_ID = "mccKeptOffer";
  var styled = false, watched = null;
  /* mobile first: one column at phone width, nothing wider than the screen less its gutters, a 44 px close at 16 px or
     more; no breakpoint, the note has no more to show on a wider screen */
  var STYLE = ".mcc-carry-note{position:fixed;z-index:999;right:max(12px,env(safe-area-inset-right));top:calc(max(12px,env(safe-area-inset-top)) + 52px);" +
      "box-sizing:border-box;width:18rem;max-width:calc(100% - 24px);display:grid;grid-template-columns:minmax(0,1fr) 44px;align-items:start;gap:2px;margin:0;" +
      "padding:6px 0 6px 14px;border:1px solid rgba(244,239,230,.18);border-radius:16px;background:#161619;color:#f4efe6;font:500 13px/1.45 var(--ui,system-ui);" +
      "box-shadow:0 8px 24px rgba(0,0,0,.2)}" +
    ".mcc-carry-note[hidden]{display:none}" +
    ".mcc-carry-note__text{min-width:0;padding:6px 0;overflow-wrap:anywhere}" +
    ".mcc-carry-note__close{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:50%;" +
      "background:none;color:inherit;font:400 max(16px,1.25rem)/1 var(--ui,system-ui);cursor:pointer}" +
    ".mcc-carry-note__close:focus-visible{outline:2px solid #f4efe6;outline-offset:-4px}" +
    "#mccKeptOffer .dk-peek__go,#mccKeptOffer .dk-peek__alt{min-height:44px;font-size:max(16px,1em)}";
  function style() {
    if (styled || d.getElementById(STYLE_ID)) return;
    styled = true;
    var s = d.createElement("style");
    s.id = STYLE_ID;
    s.textContent = STYLE;
    (d.head || d.documentElement).appendChild(s);
  }
  /* the World (the platform's root and mnet.html) has its own sign-in, the door, over everything it shows: the note
     and the offer wait for a page with the bar's chip (the chip still carries the line as its title there) */
  function onWorld() { return /^\/(?:mnet\.html)?$/.test(String((w.location && w.location.pathname) || "")); }
  /* is this element laid out (not display:none, nor inside something that is) */
  function shownBox(n) {
    if (!n || typeof n.getClientRects !== "function") return !!n;
    try { return n.getClientRects().length > 0; } catch (e) { return true; }
  }
  /* the chip's box changes when a page hides or shows it (the World's sign-in): say it again then */
  function watch(chip) {
    if (watched === chip || typeof w.ResizeObserver !== "function") return;
    watched = chip;
    try { new w.ResizeObserver(function () { paint(); }).observe(chip); } catch (e) { /* no observer: the next repaint */ }
  }
  function drawNote(chip) {
    style();
    var note = d.createElement("div");
    note.id = NOTE_ID;
    note.className = "mcc-carry-note";
    note.hidden = true;
    var said = d.createElement("span");
    said.id = NOTE_TEXT_ID;
    said.className = "mcc-carry-note__text";
    var close = d.createElement("button");
    close.setAttribute("type", "button");
    close.className = "mcc-carry-note__close";
    close.setAttribute("aria-label", "Close this note");
    close.textContent = "×";
    close.addEventListener("click", function () {
      write(NOTE_CLOSED, new Date().toISOString());
      note.hidden = true;
      var c = d.getElementById("mccAuthChip");
      if (c && typeof c.focus === "function") { try { c.focus(); } catch (e) { /* nothing to focus */ } }
    });
    note.appendChild(said);
    note.appendChild(close);
    (chip.parentNode || d.body).appendChild(note);
    return note;
  }
  function paint() {
    if (typeof d.getElementById !== "function") return;
    var text = line();
    var pane = d.getElementById("acSignInPane"), shown = d.getElementById(LINE_ID);
    if (text && pane) {
      if (!shown) {
        shown = d.createElement("p");
        shown.id = LINE_ID;
        shown.className = "ac__sub";
        pane.insertBefore(shown, pane.firstChild);
      }
      shown.textContent = text;
    } else if (shown) shown.remove();
    var chip = d.getElementById("mccAuthChip"), note = d.getElementById(NOTE_ID);
    if (chip) watch(chip);
    if (chip && text) {
      if (!note) note = drawNote(chip);
      var said = d.getElementById(NOTE_TEXT_ID);
      if (said) said.textContent = text;
      chip.setAttribute("title", text);
      chip.setAttribute("aria-describedby", NOTE_TEXT_ID);
      note.hidden = onWorld() || (!!pane && shownBox(pane)) || read(NOTE_CLOSED) !== null || !shownBox(chip);
    } else {
      var by = chip && chip.getAttribute("aria-describedby");
      if (by === NOTE_TEXT_ID || by === NOTE_ID) { chip.removeAttribute("title"); chip.removeAttribute("aria-describedby"); }
      if (note) note.remove();
    }
    offer();
  }
  /* SPEC-PLATFORM 2.7: the offer to keep here what was kept at the old address */
  function keptLine() {
    var n = songsIn(keptPaths(json(read(KEPT)))).length;
    if (!n) return "";
    return "You kept " + n + (n === 1 ? " song" : " songs") + " at the old address. Keep " + (n === 1 ? "it" : "them") + " here too?";
  }
  /* the same files at the same paths, fetched from this origin into this origin's vault; asked once */
  function keepHere() {
    var paths = keptPaths(json(read(KEPT)));
    drop(KEPT);
    if (!paths.length || !w.caches || typeof w.caches.open !== "function") return Promise.resolve({ kept: 0, missed: paths.length, songs: 0 });
    var kept = 0, missed = 0, songs = 0;
    return w.caches.open(VAULT).then(function (cache) {
      return paths.reduce(function (chain, p) {
        var url = w.location.origin + p, song = SONG.test(p.split("?")[0]);
        return chain.then(function () {
          return Promise.resolve(cache.match(url)).then(function (hit) {
            if (hit) { kept += 1; if (song) songs += 1; return null; }
            return fetch(url).then(function (res) {
              if (!res || !res.ok) throw new Error("not kept");
              return cache.put(url, res);
            }).then(function () { kept += 1; if (song) songs += 1; }, function () { missed += 1; });
          });
        });
      }, Promise.resolve());
    }).then(function () { return { kept: kept, missed: missed, songs: songs }; }, function () { return { kept: kept, missed: paths.length - kept, songs: songs }; });
  }
  /* the offer, once, in the bar's own peek card (css/style.css .dk-peek, the card the bar's move notice uses) on a
     top-level page that shows the account chip: never in a frame, never on the World (its door is over everything),
     and only where the page has the bar's card (a page without css/style.css leaves it for the next page). Nothing that
     is a song, or no Cache Storage to keep into: nothing is offered and nothing waits. */
  var noCard = false;
  function offer() {
    if (typeof d.getElementById !== "function" || w.parent !== w || read(KEPT) === null || d.getElementById(OFFER_ID)) return;
    var text = keptLine(), n = songsIn(keptPaths(json(read(KEPT)))).length;
    if (!text || !w.caches || typeof w.caches.open !== "function") { drop(KEPT); return; }
    var chip = d.getElementById("mccAuthChip");
    if (noCard || onWorld() || !d.body || !chip || !shownBox(chip)) return;
    style();
    var card = d.createElement("section");
    card.id = OFFER_ID;
    card.className = "dk-peek";
    card.setAttribute("aria-label", "Your kept songs");
    var inner = d.createElement("div");
    inner.className = "dk-peek__card";
    var top = d.createElement("div");
    top.className = "dk-peek__top";
    var words = d.createElement("span");
    var title = d.createElement("b");
    title.textContent = "Your kept songs";
    var said = d.createElement("small");
    said.setAttribute("role", "status");
    said.textContent = text;
    words.appendChild(title);
    words.appendChild(said);
    top.appendChild(words);
    var acts = d.createElement("div");
    acts.className = "dk-peek__acts";
    var go = d.createElement("button");
    go.setAttribute("type", "button");
    go.className = "dk-peek__go";
    go.textContent = n === 1 ? "Keep it here" : "Keep them here";
    var not = d.createElement("button");
    not.setAttribute("type", "button");
    not.className = "dk-peek__alt";
    not.textContent = "Not now";
    acts.appendChild(go);
    acts.appendChild(not);
    inner.appendChild(top);
    inner.appendChild(acts);
    card.appendChild(inner);
    var busy = false;
    go.addEventListener("click", function () {
      if (busy) return;
      busy = true;
      go.disabled = not.disabled = true;
      card.setAttribute("aria-busy", "true");
      said.textContent = "Keeping " + (n === 1 ? "it" : "them") + " here…";
      keepHere().then(function (r) {
        var k = r.songs;
        said.textContent = k >= n ? "Kept " + n + (n === 1 ? " song" : " songs") + " here too."
          : k === 0 ? (n === 1 ? "The song" : "The songs") + " did not download here."
          : "Kept " + k + " of " + n + " songs here; the rest did not download.";
        card.removeAttribute("aria-busy");
        go.hidden = true;
        not.disabled = false;
        not.textContent = "Done";
        try { not.focus(); } catch (e) { /* nothing to focus */ }
      });
    });
    not.addEventListener("click", function () {
      if (not.disabled) return;
      drop(KEPT);
      card.remove();
    });
    d.body.appendChild(card);
    /* the bar's card is css/style.css's; where a page has no such card, the offer waits for the next page */
    if (typeof w.getComputedStyle === "function") {
      var position = "";
      try { position = w.getComputedStyle(card).position; } catch (e) { position = ""; }
      if (position && position !== "fixed") { noCard = true; card.remove(); }
    }
  }

  var api = { MARK: MARK, REQUEST: REQUEST, ANSWER: ANSWER, WAIT_MS: WAIT_MS, run: run, line: line, paint: paint, keptLine: keptLine, keepHere: keepHere, offer: offer };
  api.started = run();
  w.MCC_CARRY = Object.freeze(api);
  api.started.then(paint, paint);
  w.addEventListener("mcc:auth-state", paint);
  w.addEventListener("mcc:auth-changed", paint);
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", paint);
  else paint();
})(window, document);
