/* ONE PLAYER ACROSS MUSIC PAGES (music slice M5; docs/music/MUSIC-RELEASE-20261119.md, "M5").

   Matthew, 2026-11-19: "when I'm playing music and I leave the browser, it stops playing music" and "The music
   never plays fully through." One cause the music maps found was the site itself (C1 cause 2): every music link
   loaded a new document, and a new document cannot keep the old one's <audio> element or, on an iPhone, start
   sound without a tap.

   So the first music page a tab opens (Listen, an artist page; the album is contained in Release 2, see ROUTES)
   stays the one document that plays: the RETAINED document. It owns every element that can sound and the one
   js/now-playing.js that speaks to the device, the bar, the account chip, the installed app's dock and the history.
   The other music pages open over it as VIEWS, each in a fresh same-origin frame, one at a time: their own document,
   head, scripts and address, but no music element and no Now Playing of their own; a play button in a view calls the
   retained player in the same tap (js/music-engine.js, view mode). The address bar shows the view's own address
   (history.pushState), so a share, a bookmark or a refresh lands on that exact page, and Back and Forward move
   between views without reloading the retained document. This is the Music-to-World pattern
   (js/world-audio-continuity.js) generalised from one cross-origin World frame to same-origin music views.

   D-5 (one long-lived player across music pages) is Matthew's decision and is still unanswered: this is the music
   map's recommended default, built on the branch behind ROUTES below. Every route off is the behaviour before it.

   What it never does: start, pause or mute anything when a view opens, switches, is revealed or closes (the
   lifecycle guard in scripts/test/music-background.test.mjs); render a page it did not expect inside its frame
   (js/shell-boot.js stops it and this file routes it); show one page's identity under another's address (the live
   head follows the page shown and the retained page's own head comes back byte for byte); or make the front page
   a view (hard rule 3). What the web cannot do stays a page load: a refresh, a link out of music, a provider
   sign-in, a checkout. Proof: scripts/test/music-shell.test.mjs, scripts/e2e/music-shell.e2e.mjs (Chromium).
   Everything about an iPhone or iPad is Inferred until Matthew's devices run the rows in the record. */
(function (root) {
  "use strict";
  if (root.MCC_MUSIC_SHELL) return;
  var doc = root.document;
  var src = doc.currentScript && doc.currentScript.src;
  var ROOT = src ? src.replace(/js\/music-shell\.js.*$/, "") : "";

  /* THE ONE SWITCH. top: the page may be the retained document; view: it may open as a view over one.
     Stage 1, the first pair: Listen and the artist pages, each both. Stage 3: the account page as a sign-in view over
     them, on the password path. Every route off is the site at dc0185aa: every link a page load.
     THE ALBUM IS CONTAINED IN RELEASE 2 (SPEC-ENGINE 4.10, engine stage 0): never retained, never a view. M5's stage 2
     retained it with its own deck, and a song chosen in a view over it put the engine beside the deck: two players
     behind one bar, which Matthew ruled out (one engine, one player at all times; SPEC-ENGINE section 2). So the
     album is a page of its own, as at Release 1: its deck the one player on the page, a link to it a page load and
     every link on it its own.
     Stage 1 of the engine makes the album a page of the one engine and turns it back on as both (top and view); the
     stage-2 code below (guestEngine, ownerWatch) is left in place for it and never runs while the album is off. */
  var ROUTES = {
    listen: { top: true, view: true },
    artist: { top: true, view: true },
    album: { top: false, view: false },
    account: { top: false, view: true }
  };
  /* What stays on screen and reachable over a view: the shell itself, the one bar and its chip, menus and peeks, the
     engine's mini player and Now sheet, the album's deck bar, sheet, status line and toast, the World's frame and
     transport, the privacy notice, the held song's pop-up (js/gated-audio.js: the album reaching the held song tells
     whoever is looking, over a view too). Everything else in the retained page is hidden and inert while a view shows
     (scripts/test/music-shell.test.mjs holds this list against every stage page). */
  var ALLOW = ["#mccMusicView", ".appbar", ".mcc-auth-nav", "#mccProfileMenu", "#mccDestinations", ".cmdk-owner-nav", ".cmdk", ".mhd",
    ".pt-veil", ".dk-peek", "#musicMini", "#musicNow", "#deckbar", "#now", "#seekStatus", ".ltoast", ".intu",
    "#mccWorldAudioShell", "#mccWorldAudioControls", "#mccPrivacyNotice", "#mccHold"];
  var HANDLE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
  var WORLD_HOSTS = ["mccluster.org", "www.mccluster.org", "humanuprise.com", "www.humanuprise.com"];
  var OPEN_MS = 8000;

  /* ---------- the core: plain decisions, no document needed (scripts/test/music-shell.test.mjs) ---------- */
  function url(href, base) { try { return new URL(href, base || root.location.href); } catch (e) { return null; } }
  function kindOf(u) {
    if (!u) return null;
    var m = /^\/(listen|music-creator|album|account)\.html$/.exec(u.pathname);
    if (!m) return null;
    if (m[1] === "music-creator") return HANDLE.test(String(u.searchParams.get("handle") || "").trim().toLowerCase()) ? "artist" : null;
    return m[1];
  }
  /* which page an address is, for "is this the retained page": an artist by handle, the album by what it plays (its
     t= only names a row), Listen whatever its query */
  function identity(u, kind) {
    var q = u.searchParams;
    if (kind === "artist") return "artist:" + String(q.get("handle") || "").trim().toLowerCase();
    if (kind === "album") return "album:" + String(q.get("album") || "here").toLowerCase() + "|" + String(q.get("playlist") || "").toLowerCase() + "|" + String(q.get("track") || "");
    return kind;
  }
  function sameAddress(a, b) {
    var x = url(a), y = url(b);
    return !!(x && y && x.origin === y.origin && x.pathname === y.pathname && x.search === y.search);
  }
  function world(u) {
    if (WORLD_HOSTS.indexOf(u.hostname) !== -1) return /^\/(?:mnet\.html|index\.html)?$/.test(u.pathname);
    if (/\/mnet\.html$/.test(u.pathname)) return true;
    if (/\/action-globe\.html$/.test(u.pathname)) return !["explore", "halo", "games", "embedded"].some(function (k) { return u.searchParams.has(k); });
    return false;
  }
  function retains(kind, routes) { return !!(kind && (routes || ROUTES)[kind] && (routes || ROUTES)[kind].top); }
  /* where a link goes, seen from the page shown now (a view, or the retained page): native (the page's own, or not a
     web address), scroll (the page shown), reveal (the retained page; on the album with the row its t= names), view,
     world (the existing Music-to-World path) or load (a page load of the top document) */
  function decide(href, from, top, routes, shown) {
    routes = routes || ROUTES;
    var here = url(shown || root.location.href);
    var u = url(href, here && here.href);
    if (!u || !/^https?:$/.test(u.protocol)) return { action: "native" };
    if (world(u)) return { action: from === "account" ? "load" : "world", url: u.href };
    if (!here || u.origin !== here.origin) return { action: "load", url: u.href };
    if (u.pathname === here.pathname && u.search === here.search) return { action: u.hash ? "native" : "scroll", url: u.href };
    var kind = kindOf(u), topU = top ? url(top.url, here.href) : null;
    if (kind && topU && kind === top.kind && identity(u, kind) === identity(topU, kind))
      return { action: "reveal", url: topU.href, t: kind === "album" ? String(u.searchParams.get("t") || "") : "" };
    if (kind && routes[kind] && routes[kind].view) {
      /* a sign-in link without next, opened from a music page, comes back to that page (a default for Matthew to
         confirm; today the chip's sign-in lands on the World). Settings (stay=1) go nowhere after. */
      if (kind === "account" && !u.searchParams.has("next") && !u.searchParams.has("stay")) u.searchParams.set("next", here.pathname + here.search);
      return { action: "view", url: u.href, kind: kind };
    }
    return { action: "load", url: u.href };
  }
  function viewState(href, from, scroll) { return { mccMusicView: { href: String(href), from: String(from || ""), scroll: Number(scroll) || 0 } }; }
  /* Back or Forward: build the view an entry names, keep the one shown, or reveal the retained page */
  function popAction(state, shown) {
    var v = state && state.mccMusicView;
    if (v && v.href) return shown && sameAddress(v.href, shown) ? "stay" : "show";
    return shown ? "reveal" : "stay";
  }
  /* only the frame this shell made, at the address it asked for; or the view it shows, loading itself again */
  function acceptable(pending, current, el, href) {
    if (pending && el && el === pending.frame && sameAddress(href, pending.href)) return "pending";
    if (current && el && el === current.frame && sameAddress(href, current.href)) return "reload";
    return null;
  }
  /* THE LIVE HEAD, FOR PEOPLE (crawlers load every address directly and never see a view). While a view shows, the
     retained document's title, description and canonical follow the view's, and are gone when it has none; its own
     JSON-LD, og: and twitter: tags are held aside, so an artist page never shares as Listen or the album (hard rule
     15). On reveal the same nodes go back where they were: byte for byte. A title the retained page writes while
     covered (an artist page whose profile arrived late) is kept for its reveal; one the World writes is the World's. */
  var HELD = 'title,meta[name="description"],link[rel="canonical"],script[type="application/ld+json"],meta[property^="og:"],meta[name^="twitter:"]';
  function holdHead(d, foreignOk) {
    var head = d.head, held = [], own = { title: null, desc: null, canonical: null }, said = null;
    Array.prototype.slice.call(head.querySelectorAll(HELD)).forEach(function (n) {
      var mark = d.createComment("held by js/music-shell.js");
      n.parentNode.insertBefore(mark, n);
      n.parentNode.removeChild(n);
      held.push({ node: n, mark: mark });
    });
    var title = held.filter(function (h) { return String(h.node.tagName).toUpperCase() === "TITLE"; })[0];
    function put(n) {
      var at = held.length ? held[0].mark : null;
      if (at && at.parentNode) at.parentNode.insertBefore(n, at); else head.appendChild(n);
    }
    function absorb() {
      if (!own.title || said === null || own.title.textContent === said || !title) return;
      if (foreignOk && !foreignOk()) return;
      title.node.textContent = own.title.textContent;
    }
    function sync(key, tag, attrs, value) {
      if (value == null) { if (own[key] && own[key].parentNode) own[key].parentNode.removeChild(own[key]); own[key] = null; return; }
      if (!own[key]) { own[key] = d.createElement(tag); for (var a in attrs) own[key].setAttribute(a, attrs[a]); put(own[key]); }
    }
    return {
      mirror: function (vd) {
        absorb();
        if (!own.title) { own.title = d.createElement("title"); put(own.title); }
        said = String(vd.title || "");
        if (own.title.textContent !== said) own.title.textContent = said;
        var desc = vd.querySelector('meta[name="description"]'), dv = desc ? desc.getAttribute("content") : null;
        sync("desc", "meta", { name: "description" }, dv);
        if (own.desc && own.desc.getAttribute("content") !== dv) own.desc.setAttribute("content", dv);
        var can = vd.querySelector('link[rel="canonical"]'), cv = can ? can.getAttribute("href") : null;
        sync("canonical", "link", { rel: "canonical" }, cv);
        if (own.canonical && own.canonical.getAttribute("href") !== cv) own.canonical.setAttribute("href", cv);
      },
      restore: function () {
        absorb();
        ["title", "desc", "canonical"].forEach(function (k) { if (own[k] && own[k].parentNode) own[k].parentNode.removeChild(own[k]); own[k] = null; });
        held.forEach(function (h) { if (h.mark.parentNode) { h.mark.parentNode.insertBefore(h.node, h.mark); h.mark.parentNode.removeChild(h.mark); } });
        held = [];
      }
    };
  }
  var core = Object.freeze({ ROUTES: ROUTES, ALLOW: ALLOW, kindOf: kindOf, decide: decide, retains: retains, viewState: viewState,
    popAction: popAction, acceptable: acceptable, sameAddress: sameAddress, holdHead: holdHead });

  /* ---------- the retained document ---------- */
  var here = url(root.location.href);
  var marker = doc.documentElement && doc.documentElement.getAttribute("data-music-view");
  var TOP = null;
  if (root.parent === root && here && marker && marker === kindOf(here) && retains(marker)) {
    var own = url(here.href); own.searchParams.delete("world"); own.hash = "";
    TOP = { kind: marker, url: own.pathname + own.search, abs: own.href };
  }
  var layer = null, live = null, pending = null, current = null, held = null, hidden = new Map(), bodyWatch = null;
  var topScroll = 0, topOpener = null, owner = "", guest = null, failCard = null;

  function shownHref() { return current ? current.href : TOP ? TOP.abs : root.location.href; }
  function route(href, from) { return decide(href, from || "top", TOP, ROUTES, from && from !== "top" && current ? current.href : shownHref()); }
  function worldOpen() { var w = root.MCC_WORLD_AUDIO; return !!(w && w.active && w.active()); }
  function emit(name, detail) { try { root.dispatchEvent(new root.CustomEvent(name, { detail: detail || {} })); } catch (e) {} }
  function setState(st, href, push) {
    try {
      if (push) root.history.pushState(st, "", href); else root.history.replaceState(st, "", href);
      root.history.scrollRestoration = "manual";   /* the browser never restores the retained page's scroll over a view */
    } catch (e) {}
  }
  function merged(extra) { return Object.assign({}, root.history.state || {}, extra); }

  function ensureLayer() {
    if (layer) return layer;
    layer = doc.createElement("section");
    layer.id = "mccMusicView";
    layer.setAttribute("aria-label", "Music page");
    layer.setAttribute("data-view-state", "hidden");
    live = doc.createElement("p");
    live.className = "mcc-music-sr"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
    layer.appendChild(live);
    doc.body.appendChild(layer);
    return layer;
  }
  function style() {
    if (doc.getElementById("mccMusicShellStyle")) return;
    var l = doc.createElement("link");
    l.id = "mccMusicShellStyle"; l.rel = "stylesheet"; l.href = ROOT + "css/music-shell.css?v=__STAMP__";
    doc.head.appendChild(l);
  }

  /* where a link goes from the retained page and its chrome (the mini player, the sheets, the account chip). The bar's
     own tabs are left to the bar (js/tabbar.js): a hold opens a wing, a slot may show its card first, the Music tab
     goes to the shelf (its `home`, not always its href) or is the player's transport on its own page; when the bar
     does go somewhere it asks this shell first (sail() -> navigate below). */
  /* A PLAY BUTTON INSIDE A LINK IS THE PLAYER'S (engine stage 0, SPEC-ENGINE 10 rows A0.3 and A0.4): Listen's cards wrap
     their play button in the card's link (a song card in its album's, a creator's card in the artist page's), so the tap
     is tested from its own target up; asked from the link up, the button inside it was never found and the tap was
     routed as the link's. Here and in the view agent below it is left to js/music-engine.js. */
  function onTopClick(e) {
    if (!TOP || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.hasAttribute("data-mcc-shell-skip") || e.target.closest("[data-music-play]") || a.closest(".appbar")) return;
    var d = route(a.href, "top");
    if (d.action !== "view" && !((d.action === "reveal" || d.action === "scroll") && (current || pending))) return;
    e.preventDefault(); e.stopPropagation();
    go(d, { opener: current ? null : a });
  }
  /* the bar's own taps (js/tabbar.js sail(), after the World): true when the shell took it */
  function navigate(href) {
    if (!TOP) return false;
    var d = route(href, "top");
    if (d.action !== "view" && !((d.action === "reveal" || d.action === "scroll") && (current || pending))) return false;
    go(d, {});
    return true;
  }
  function go(d, opts) {
    opts = opts || {};
    if (d.action === "view") { openView(d.url, opts); return true; }
    if (d.action === "reveal") { reveal({ t: d.t, replace: opts.replace }); return true; }
    if (d.action === "scroll") { scrollShown(); return true; }
    if (d.action === "world" && root.MCC_WORLD_AUDIO && root.MCC_WORLD_AUDIO.navigate(d.url)) return true;
    if (d.action === "world" || d.action === "load") { pageLoad(d.url); return true; }
    return false;
  }
  /* a page load of the top document, carrying a member's sign-in to another of the houses as the bar does */
  function pageLoad(href) {
    var nav = root.MCC_BAR && root.MCC_BAR.navigation, leave = function (h) { root.location.href = h; };
    if (nav && nav.handoff) nav.handoff(href).then(leave, function () { leave(href); });
    else leave(href);
  }
  function scrollShown() {
    var w = current ? current.win : root;
    try { w.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { try { w.scrollTo(0, 0); } catch (x) {} }
  }
  /* the scroll of what is shown now, kept on its own history entry before another is written */
  function remember() {
    var st = root.history.state || {};
    if (current && st.mccMusicView) {
      var y = 0; try { y = current.win.scrollY || 0; } catch (e) {}
      setState(merged({ mccMusicView: Object.assign({}, st.mccMusicView, { scroll: y }) }), root.location.href, false);
    } else if (!current) {
      topScroll = root.scrollY || 0;
      setState(merged({ mccMusicShell: { top: true, scroll: topScroll } }), root.location.href, false);
    }
  }

  /* OPEN A VIEW: a fresh frame per view, its address set before it is inserted (no history entry of its own) and
     before the top's address changes (its referrer is the page it was opened from). What is shown stays on screen
     until the new view has painted; then the old frame goes. One view frame after every switch. */
  function openView(href, opts) {
    opts = opts || {};
    var abs = url(href).href, from = opts.from || shownHref();
    ensureLayer();
    if (TOP.kind === "album") guestEngine();
    if (pending) drop(pending);
    if (opts.history !== "none") remember();
    var f = doc.createElement("iframe");
    f.id = "mccMusicViewNext";   /* the id of the view shown is its own once it has painted (one element per id) */
    f.className = "mcc-music-frame";
    f.title = "Music page";
    f.setAttribute("data-mcc-ready", "0");
    f.src = abs;
    var v = pending = { frame: f, href: abs, kind: kindOf(url(abs)), from: from, scroll: Number(opts.scroll) || 0, opener: opts.opener || null, cleanup: [], timer: 0 };
    if (!current && opts.opener) topOpener = opts.opener;
    f.addEventListener("load", function () { loaded(v); });
    layer.appendChild(f);
    if (opts.history !== "none") setState(viewState(abs, from, 0), abs, !opts.replace);
    if (!current) layer.setAttribute("data-view-state", "opening");
    v.timer = root.setTimeout(function () { if (pending === v) fail(v); }, OPEN_MS);
    if (root.MCC_MUSIC && root.MCC_MUSIC.closeNow) root.MCC_MUSIC.closeNow();
  }
  /* the view has painted: it takes the screen; the retained page is covered the first time */
  function ready(v) {
    if (v !== pending) return;
    root.clearTimeout(v.timer);
    hideFail();
    var old = current;
    current = v; pending = null;
    v.frame.setAttribute("data-mcc-ready", "1");
    layer.setAttribute("data-view-state", "shown");
    if (old) teardown(old);
    else conceal();
    v.frame.id = "mccMusicViewFrame";
    if (!held) held = holdHead(doc, function () { return !worldOpen(); });
    mirror(v);
    clearance();
    try { if (v.scroll) v.win.scrollTo(0, v.scroll); } catch (e) {}
    focusView(v);
    try { v.frame.title = v.doc.title || "Music page"; live.textContent = v.doc.title || ""; } catch (e) {}
    emit("mcc:music-view", { open: true, href: v.href, kind: v.kind });
  }
  function drop(v) {
    if (v === pending) pending = null;
    teardown(v);
    if (!current && !pending && layer) layer.setAttribute("data-view-state", "hidden");
  }
  function teardown(v) {
    root.clearTimeout(v.timer);
    v.cleanup.splice(0).forEach(function (off) { try { off(); } catch (e) {} });
    if (v.frame && v.frame.parentNode) v.frame.parentNode.removeChild(v.frame);
  }
  /* REVEAL THE RETAINED PAGE: by a link (its own entry is pushed, or replaced after a sign-in, as account.html
     replaces itself today), or by Back (no entry written) */
  function reveal(opts) {
    opts = opts || {};
    if (pending) drop(pending);
    if (current) {
      if (opts.history !== "none") {
        var st = { mccMusicShell: { top: true, scroll: topScroll } };
        if (!opts.replace) remember();
        setState(st, TOP.abs, !opts.replace);
      }
      var v = current;
      current = null;
      teardown(v);
      if (held) { held.restore(); held = null; }
      uncover(opts.scroll != null ? opts.scroll : topScroll);
      layer.setAttribute("data-view-state", "hidden");
      hideFail();
      focusBack();
      emit("mcc:music-view", { open: false });
    }
    if (opts.t) ask(opts.t);
  }
  /* the album shown, asked for with another t=: that row comes into view and is marked; what plays does not change
     (the person taps the row) */
  function ask(title) {
    var want = String(title).toLowerCase(), hit = null;
    Array.prototype.forEach.call(doc.querySelectorAll("#tracks li"), function (li) {
      var mine = String(li.getAttribute("data-title") || "").toLowerCase() === want;
      li.classList.toggle("mcc-music-asked", mine);
      if (mine) hit = li;
    });
    if (hit) try { hit.scrollIntoView({ block: "center" }); } catch (e) { hit.scrollIntoView(); }
  }

  /* COVER AND UNCOVER the retained page: hidden and inert except the chrome that stays (ALLOW), its scroll kept */
  function allowed(node) { return ALLOW.some(function (sel) { try { return node.matches(sel); } catch (e) { return false; } }); }
  function hide(node) {
    if (!node || node.nodeType !== 1 || /^(SCRIPT|LINK|STYLE|TEMPLATE|NOSCRIPT)$/.test(node.tagName) || hidden.has(node) || allowed(node)) return;
    hidden.set(node, node.inert);
    node.inert = true;
    node.classList.add("mcc-music-concealed");
  }
  function conceal() {
    topScroll = root.scrollY || topScroll || 0;
    Array.prototype.forEach.call(doc.body.children, hide);
    bodyWatch = new MutationObserver(function (list) {
      list.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, hide); });
    });
    bodyWatch.observe(doc.body, { childList: true });
    doc.documentElement.classList.add("mcc-music-covered");
  }
  function uncover(y) {
    if (bodyWatch) { bodyWatch.disconnect(); bodyWatch = null; }
    hidden.forEach(function (was, node) { node.inert = was; node.classList.remove("mcc-music-concealed"); });
    hidden.clear();
    doc.documentElement.classList.remove("mcc-music-covered");
    try { root.scrollTo(0, y || 0); } catch (e) {}
  }
  function focusView(v) {
    try {
      v.frame.focus({ preventScroll: true });
      var h = v.doc.querySelector("main h1, h1");
      if (!h) { v.win.focus(); return; }
      /* a heading is not a control: it takes the focus a screen reader needs without the ring a control shows
         (js/shell-boot.js styles [data-mcc-view-heading]); the next Tab goes on from it as usual */
      var own = h.hasAttribute("tabindex");
      if (!own) h.setAttribute("tabindex", "-1");
      h.setAttribute("data-mcc-view-heading", "");
      h.addEventListener("blur", function () { h.removeAttribute("data-mcc-view-heading"); if (!own) h.removeAttribute("tabindex"); }, { once: true });
      h.focus({ preventScroll: true });
    } catch (e) {}
  }
  function focusBack() {
    var o = topOpener;
    topOpener = null;
    try {
      if (o && doc.contains(o) && !o.closest("[inert]")) { o.focus({ preventScroll: true }); return; }
      var h = doc.querySelector("main h1, h1");
      if (h) { if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    } catch (e) {}
  }
  /* the view's last thing never sits under the bar, the mini player or the deck bar: their measured height */
  function clearance() {
    var v = current || pending;
    if (!v || !v.doc) return;
    var h = root.innerHeight || 0, need = 0;
    ["#musicMini", "#deckbar", ".appbar"].forEach(function (sel) {
      var el = doc.querySelector(sel);
      if (!el || el.hidden) return;
      var r = el.getBoundingClientRect(), cs = root.getComputedStyle(el);
      if (!r.height || cs.display === "none" || cs.visibility === "hidden" || r.top >= h) return;
      need = Math.max(need, h - r.top);
    });
    try { v.doc.documentElement.style.setProperty("--mcc-view-clear", Math.ceil(need + 8) + "px"); } catch (e) {}
  }
  function mirror(v) {
    if (!held || v !== current || !v.doc || worldOpen()) return;
    try { held.mirror(v.doc); } catch (e) {}
  }

  /* A VIEW THAT DOES NOT OPEN: a card over the view area, the music untouched. Open the page (today's page load) or
     Back. Its words say the music is still playing only while it is. */
  function playingNow() {
    var e = root.MCC_MUSIC, d = doc.getElementById("deck");
    return !!((e && e.playing && e.playing()) || (d && !d.paused));
  }
  function fail(v) {
    if (v !== pending && v !== current) return;
    ensureLayer();
    hideFail();
    failCard = doc.createElement("div");
    failCard.className = "mcc-music-fail";
    failCard.setAttribute("role", "alert");
    var p = doc.createElement("p");
    p.textContent = "This page is taking long to open." + (playingNow() ? " Your music is still playing." : "");
    var acts = doc.createElement("div");
    acts.className = "mcc-music-fail__acts";
    var open = doc.createElement("a");
    open.href = v.href; open.textContent = "Open the page"; open.setAttribute("data-mcc-shell-skip", "");
    var back = doc.createElement("button");
    back.type = "button"; back.textContent = "Back";
    back.addEventListener("click", function () {
      hideFail();
      var st = root.history.state;
      if (st && st.mccMusicView && sameAddress(st.mccMusicView.href, v.href)) root.history.back();
      else if (v === pending) drop(v);
    });
    acts.appendChild(open); acts.appendChild(back);
    failCard.appendChild(p); failCard.appendChild(acts);
    layer.appendChild(failCard);
    if (!current) layer.setAttribute("data-view-state", "failed");
    back.focus({ preventScroll: true });
  }
  function hideFail() {
    if (failCard && failCard.parentNode) failCard.parentNode.removeChild(failCard);
    failCard = null;
    if (layer && !current && layer.getAttribute("data-view-state") === "failed") layer.setAttribute("data-view-state", pending ? "opening" : "hidden");
  }

  /* BACK AND FORWARD move between views without reloading this document */
  function onPop() {
    if (!TOP) return;
    var st = root.history.state, shown = current ? current.href : pending ? pending.href : null;
    var act = popAction(st, shown);
    if (act === "show") openView(st.mccMusicView.href, { history: "none", from: st.mccMusicView.from, scroll: st.mccMusicView.scroll });
    else if (act === "reveal") reveal({ history: "none", scroll: st && st.mccMusicShell ? st.mccMusicShell.scroll : topScroll });
  }

  /* ---------- the view agent: this realm, working on the view's window ---------- */
  function owns(el) { return !!(el && ((pending && el === pending.frame) || (current && el === current.frame))); }
  function adopt(win) {
    var el, href;
    try { el = win.frameElement; href = String(win.location.href); } catch (e) { return null; }
    var who = acceptable(pending, current, el, href);
    if (!who) return null;
    var v = who === "pending" ? pending : current;
    v.cleanup.splice(0).forEach(function (off) { try { off(); } catch (e) {} });
    v.win = win; v.doc = win.document; v.adopted = true; v.stopped = "";
    agent(v);
    var api = viewApi(v);
    whenPainted(win, function () {
      if (who === "pending") ready(v);
      else { mirror(v); clearance(); }
    });
    return api;
  }
  function viewApi(v) {
    var u = url(v.href), kind = v.kind;
    return Object.freeze({
      kind: kind,
      href: v.href,
      /* the page shown before this view opened: its referrer, also after Back or Forward rebuilt it */
      referrer: v.from || "",
      /* the page a song chosen here was chosen on (analytics: path and an artist's creator_handle) */
      page: Object.freeze({ path: u.pathname.replace(/^.*\//, ""), handle: kind === "artist" ? String(u.searchParams.get("handle") || "").trim().toLowerCase() : "" }),
      engine: function () { if (root.MCC_MUSIC) return root.MCC_MUSIC; guestEngine(); return null; },
      whenEngine: whenEngine,
      /* a script navigation the page cannot leave to the frame (another origin: a checkout) */
      navigate: function (href) { return go(decide(href, kind, TOP, ROUTES, v.href), { replace: kind === "account" }); },
      on: function (type, fn) { root.addEventListener(type, fn); var off = function () { root.removeEventListener(type, fn); }; v.cleanup.push(off); return off; },
      top: function () { return root; },
      bar: function () { return root.MCC_BAR || null; }
    });
  }
  function agent(v) {
    var win = v.win, vd = v.doc;
    var click = function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      /* a play button inside a link is the view's player's (js/music-engine.js view mode), from the tap's own target up */
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || e.target.closest("[data-music-play]")) return;
      var d = decide(a.href, v.kind, TOP, ROUTES, v.href);
      if (d.action === "native") return;
      e.preventDefault();
      if (d.action === "scroll") { try { win.scrollTo({ top: 0, behavior: "smooth" }); } catch (x) { win.scrollTo(0, 0); } return; }
      e.stopPropagation();
      go(d, { replace: v.kind === "account" && d.action !== "view" });
    };
    win.addEventListener("click", click, true);
    /* the artist page tells the bar whose perspective it is; the bar is the retained document's */
    win.addEventListener("mcc:perspective", function (e) {
      var d = null;
      try { d = e && e.detail ? JSON.parse(JSON.stringify(e.detail)) : null; } catch (x) {}
      emit("mcc:perspective", d);
    });
    /* McCluster's own page says the house is the perspective (owner, 2026-11-23: "McCluster is the artist") */
    win.addEventListener("mcc:perspective-house", function () { emit("mcc:perspective-house"); });
    /* an address change inside the view (an artist page's #album=) is the top's address */
    var follow = function () {
      if (v !== current && v !== pending) return;
      var now = "";
      try { now = String(win.location.href); } catch (e) { return; }
      if (now === v.href) return;
      var was = v.href;
      v.href = now;
      var st = root.history.state;
      if (st && st.mccMusicView && sameAddress(st.mccMusicView.href, was)) setState(merged({ mccMusicView: Object.assign({}, st.mccMusicView, { href: now }) }), now, false);
    };
    try {
      var h = win.history, push = h.pushState, rep = h.replaceState;
      h.pushState = function () { var r = push.apply(h, arguments); follow(); return r; };
      h.replaceState = function () { var r = rep.apply(h, arguments); follow(); return r; };
    } catch (e) {}
    win.addEventListener("hashchange", follow);
    /* the view's head, mirrored as it changes (an artist page sets its title once its profile arrives) */
    var queued = false, mo = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      root.setTimeout(function () { queued = false; mirror(v); }, 0);
    });
    if (vd.head) mo.observe(vd.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["content", "href"] });
    v.cleanup.push(function () { mo.disconnect(); });
    /* the owner's offers on a view read the retained bar's server answer (creator-onboarding.js) */
    var admin = function () {
      try {
        if (!vd.body) return;
        var on = doc.body.hasAttribute("data-appbar-admin");
        if (on === vd.body.hasAttribute("data-appbar-admin")) return;
        if (on) vd.body.setAttribute("data-appbar-admin", ""); else vd.body.removeAttribute("data-appbar-admin");
        win.dispatchEvent(new win.CustomEvent("mcc:appbar-admin", { detail: { admin: on } }));
      } catch (e) {}
    };
    vd.addEventListener("DOMContentLoaded", admin);
    root.addEventListener("mcc:appbar-admin", admin);
    v.cleanup.push(function () { root.removeEventListener("mcc:appbar-admin", admin); });
  }
  function whenPainted(win, cb) {
    var done = false, fire = function () { if (!done) { done = true; cb(); } };
    var after = function () {
      try { win.requestAnimationFrame(function () { win.requestAnimationFrame(fire); }); } catch (e) { fire(); }
      root.setTimeout(fire, 700);
    };
    if (win.document.readyState === "loading") win.document.addEventListener("DOMContentLoaded", after);
    else after();
  }
  /* A DOCUMENT THIS SHELL DID NOT EXPECT in its frame (a script navigation: account.html's way on after a sign-in,
     Listen's search Enter, the creator door; the service worker's offline fallback to index.html). js/shell-boot.js
     has stopped it before its body; this routes the address like a link, or shows the card when it is the address
     the view was asked for but the wrong document. Never rendered in the frame. */
  function unexpected(win) {
    var el, href;
    try { el = win.frameElement; href = String(win.location.href); } catch (e) { return; }
    var v = pending && pending.frame === el ? pending : current && current.frame === el ? current : null;
    if (!v || v.stopped === href) return;
    v.stopped = href;
    try { el.style.visibility = "hidden"; } catch (e) {}
    root.setTimeout(function () { stray(v, href); }, 0);
  }
  function stray(v, href) {
    if (v !== pending && v !== current) return;
    if (sameAddress(href, v.href)) { fail(v); return; }
    var d = decide(href, v.kind, TOP, ROUTES, v.href);
    if (d.action === "native" || d.action === "scroll") d = { action: "load", url: href };
    if (d.action === "view" && v === current) {
      /* the shown view navigated itself on: the new view takes its place in history the way the frame's own
         navigation would have */
      openView(d.url, { from: v.href, replace: v.kind === "account" });
      return;
    }
    if (v === pending && d.action !== "load") drop(v);
    go(d, { replace: v.kind === "account" });
  }
  /* a document without js/shell-boot.js that loaded in the frame anyway, or one this realm cannot read */
  function loaded(v) {
    if (v !== pending && v !== current) return;
    var d, href;
    try { d = v.frame.contentDocument; href = String(v.frame.contentWindow.location.href); } catch (e) { fail(v); return; }
    if (!d || href === "about:blank" || v.stopped) return;
    if (v.adopted && d === v.doc) return;
    unexpected(v.frame.contentWindow);
  }

  /* ---------- stage 2: the album as the retained document, through its own deck ---------- */
  /* A play chosen in a view over the album needs the engine: it is loaded into the album document the first time a
     view opens, as a guest (it never offers the album's own banked record). One owner of sound at a time, through
     each player's own Pause (ownerWatch, below), and one visible bar: html[data-music-owner]. */
  function guestEngine() {
    if (guest || root.MCC_MUSIC || !TOP || TOP.kind !== "album") return;
    guest = { waiting: [], ready: false };
    setOwner(owner || "deck");
    root.MCC_MUSIC_GUEST = { restore: false, owns: function () { return owner === "engine"; } };
    if (!doc.querySelector('link[href*="css/music-engine.css"]')) {
      var l = doc.createElement("link");
      l.rel = "stylesheet"; l.href = ROOT + "css/music-engine.css?v=__STAMP__";
      doc.head.appendChild(l);
    }
    var s = doc.createElement("script");
    s.src = ROOT + "js/music-engine.js?v=__STAMP__";
    s.async = false;
    s.onload = function () {
      guest.ready = true;
      guest.waiting.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
    };
    doc.head.appendChild(s);
  }
  function whenEngine(fn) {
    if (root.MCC_MUSIC) { fn(); return; }
    guestEngine();
    if (guest) guest.waiting.push(fn);
  }
  function setOwner(who) {
    owner = who;
    if (who) doc.documentElement.setAttribute("data-music-owner", who); else doc.documentElement.removeAttribute("data-music-owner");
    clearance();
  }
  function ownerWatch() {
    var deck = doc.getElementById("deck"), hooked = null;
    function engineTakes() {
      setOwner("engine");
      var d = root.MCC_DECK_DELIVERY ? root.MCC_DECK_DELIVERY() : null;
      /* the album's own Pause: the path every outside pause takes since music slice M3 (it ends the deck's tries) */
      if (deck && (!deck.paused || (d && d.playing))) { if (typeof root.MCC_NP_PAUSE === "function") root.MCC_NP_PAUSE(); else deck.pause(); }
    }
    function hook() {
      var e = root.MCC_MUSIC;
      if (!e || !e.audio || hooked === e.audio) return;
      hooked = e.audio;
      e.audio.addEventListener("play", engineTakes);
    }
    root.addEventListener("mcc:music-selected", function () { hook(); engineTakes(); });
    root.addEventListener("mcc:music-state", hook);
    if (deck) deck.addEventListener("play", function () {
      if (!guest) return;
      setOwner("deck");
      var e = root.MCC_MUSIC;
      if (e && e.playing && e.playing()) e.pause();
    });
  }

  root.MCC_MUSIC_SHELL = Object.freeze({
    core: core,
    active: function () { return !!TOP; },
    route: route,
    navigate: navigate,
    owns: owns,
    adopt: adopt,
    unexpected: unexpected,
    view: function () { return current ? current.href : null; },
    owner: function () { return owner; }
  });
  if (!TOP) return;

  style();
  /* a fresh load at a view's address (a refresh, a link opened directly) is that page as the retained document:
     its entry names no view any more, and nothing claims the old song carried over */
  try {
    var st0 = root.history.state;
    if (st0 && st0.mccMusicView) {
      var clean = Object.assign({}, st0); delete clean.mccMusicView;
      clean.mccMusicShell = { top: true, scroll: 0 };
      root.history.replaceState(clean, "");
    }
  } catch (e) {}
  doc.addEventListener("click", onTopClick, true);
  root.addEventListener("popstate", onPop);
  /* a page the browser kept in its back-forward cache: the view follows the entry; nothing starts sound (Inferred) */
  root.addEventListener("pageshow", function (e) { if (e && e.persisted) onPop(); });
  root.addEventListener("resize", clearance);
  ["mcc:music-state", "mcc:nowplaying", "mcc:installed-dock"].forEach(function (n) { root.addEventListener(n, clearance); });
  if (TOP.kind === "album") ownerWatch();
})(window);
