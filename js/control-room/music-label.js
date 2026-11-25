/* Native Control · Sell · Music · Artists: the label's "Acting as" switcher.
   =====================================================================
   Owner, 2026-11-02: "PRIM3 needs their own artist page as that is its own
   artist. Separate entity from Matthew McCluster. But controlled by Matthew
   McCluster's account until it gets its own login." And: "as an admin, I
   want to test multiple, or like being a label account type shit where I
   can have multiple artists on my account."

   One account, several artists. The switcher lists the signed-in account's
   own artist and every artist it manages, and remembers which one the
   desk is acting as (window.CR.musicActingAs, and on this device only).

   WHERE THE LIST COMES FROM
     - public.music_my_artists() (supabase/pending/music_label_artists_v1.sql)
       once that file is applied: the account's own identity, then each
       artist it manages, with its role and whether it has a login yet.
     - Until then (the call answers 404 / "function not found"), the public
       catalog: the house artist plus the acts data/albums.json bills that
       the pending file puts on the house owner's label (PRIM3, Equity
       Uprise). The view says plainly that the managed-artist backend is
       pending, and changes nothing anywhere.
   Either way each artist's albums come from data/albums.json (an album's
   "artist", or the house artist when it names none).

   This file writes nothing to the database and grants nothing: acting for
   an artist is decided by the database (music_can_act_for), never here.
   ===================================================================== */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var HOUSE = "Matthew McCluster";
  /* the acts supabase/pending/music_label_artists_v1.sql seeds onto the
     house owner's label, as the public catalog names them */
  var LABEL_ACTS = {
    "PRIM3": { handle: "prim3", page: "prim3-artist.html" },
    "Equity Uprise": { handle: "equity-uprise", page: "album.html?album=equity-uprise" }
  };
  var KEY = "mcc_music_acting_as";
  var L = { node: null, loading: false, loaded: false, source: "", artists: [], albums: [], acting: "", error: "" };

  function e(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function remember(v) { try { localStorage.setItem(KEY, v); } catch (_) {} }
  function recalled() { try { return localStorage.getItem(KEY) || ""; } catch (_) { return ""; } }

  function albumsFor(name, isSelf) {
    return L.albums.filter(function (a) {
      var billed = a.artist || HOUSE;
      return isSelf ? billed === HOUSE : billed === name;
    });
  }

  /* the public catalog, read before the backend exists */
  function staticArtists() {
    var out = [{ key: "self", name: HOUSE, handle: "", relation: "self", role: "owner", hasLogin: true, page: "matthew-mccluster.html" }];
    var seen = {};
    L.albums.forEach(function (a) {
      var act = a.artist && LABEL_ACTS[a.artist];
      if (!act || seen[a.artist]) return;
      seen[a.artist] = true;
      out.push({ key: act.handle, name: a.artist, handle: act.handle, relation: "managed", role: "label_admin", hasLogin: false, page: act.page });
    });
    return out;
  }

  function rpc(name) {
    var S = window.MCC_SUPA;
    if (!S || !S.url || typeof S.token !== "function") return Promise.reject(Object.assign(new Error("signed out"), { pending: false }));
    return S.token().then(function (t) {
      if (!t) throw new Error("signed out");
      return fetch(S.url + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: { apikey: S.key, authorization: "Bearer " + t, "content-type": "application/json" },
        body: "{}"
      });
    }).then(function (r) {
      return r.text().then(function (raw) {
        var j = null; try { j = raw ? JSON.parse(raw) : null; } catch (_) {}
        /* PostgREST: an RPC that is not deployed answers 404 / PGRST202 */
        if (r.status === 404 || (j && j.code === "PGRST202")) throw Object.assign(new Error("not deployed"), { pending: true });
        if (!r.ok) throw new Error((j && (j.message || j.error)) || ("Artists " + r.status));
        return j || [];
      });
    });
  }

  function fromBackend(rows) {
    return (rows || []).map(function (r) {
      var self = r.relation === "self";
      var name = r.artist_name || (self ? HOUSE : "@" + (r.handle || "artist"));
      var act = LABEL_ACTS[name];
      return { key: self ? "self" : (r.handle || r.m_uid), name: name, handle: r.handle || "", relation: r.relation, role: r.role,
        hasLogin: !!r.has_login, page: self ? "matthew-mccluster.html" : (act ? act.page : (r.handle ? "music-creator.html?handle=" + encodeURIComponent(r.handle) : "")) };
    });
  }

  function load() {
    if (L.loading) return;
    L.loading = true; L.error = "";
    fetch("data/albums.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : { albums: [] }; })
      .catch(function () { return { albums: [] }; })
      .then(function (d) {
        L.albums = d.albums || [];
        return rpc("music_my_artists").then(function (rows) { L.source = "backend"; L.artists = fromBackend(rows); },
          function (err) { L.source = err && err.pending ? "pending" : "static"; if (!(err && err.pending) && err && err.message !== "signed out") L.error = err.message; L.artists = staticArtists(); });
      })
      .then(function () {
        var want = L.acting || recalled();
        L.acting = L.artists.some(function (a) { return a.key === want; }) ? want : (L.artists[0] ? L.artists[0].key : "");
        window.CR.musicActingAs = current();
        L.loading = false; L.loaded = true; paint();
      });
  }

  function current() {
    for (var i = 0; i < L.artists.length; i++) if (L.artists[i].key === L.acting) return L.artists[i];
    return null;
  }

  function roleLine(a) {
    if (a.relation === "self") return "You · your own artist";
    var role = a.role === "label_admin" ? "label admin" : "manager";
    return "Managed by this account (" + role + ") · " + (a.hasLogin ? "has its own login" : "no login of its own yet");
  }

  function body() {
    if (!L.loaded) return '<p class="cro-meta">Loading your artists…</p>';
    var a = current();
    var banner = L.source === "backend" ? "" :
      '<div class="cro-note" data-crla-pending role="note"><b>The managed-artist backend is pending.</b> ' +
      "supabase/pending/music_label_artists_v1.sql is not applied, so this list is read from the public catalog (data/albums.json), " +
      "not from your account. Switching here changes nothing yet; once the file is applied, your account will act for these artists for real." +
      (L.error ? " (" + e(L.error) + ")" : "") + "</div>";
    var opts = L.artists.map(function (x) {
      return '<option value="' + e(x.key) + '"' + (x.key === L.acting ? " selected" : "") + ">" + e(x.name) + (x.relation === "self" ? " (you)" : "") + "</option>";
    }).join("");
    var albums = a ? albumsFor(a.name, a.relation === "self") : [];
    var list = albums.length ? '<div class="cro-list">' + albums.map(function (al) {
      var n = (al.tracks || []).length;
      return '<div class="cro-item"><div class="cro-item__head"><div><strong>' + e(al.name) + '</strong><div class="cro-meta">' +
        e(n + (n === 1 ? " track" : " tracks")) + " · album slug " + e(al.slug) + '</div></div>' +
        '<a class="cr-btn" style="white-space:nowrap" href="album.html?album=' + encodeURIComponent(al.slug) + '">Open</a></div></div>';
    }).join("") + "</div>" : '<p class="cro-meta">No albums on the shelf for this artist yet.</p>';
    return banner +
      '<div class="cro-form" style="margin-top:10px"><label>Acting as<select data-crla-switch aria-label="Acting as">' + opts + "</select></label></div>" +
      (a ? '<div class="cro-item" style="margin-top:10px" data-crla-current="' + e(a.key) + '"><div class="cro-item__head"><div><strong>' + e(a.name) + "</strong>" +
        '<div class="cro-meta">' + e(roleLine(a)) + "</div></div>" +
        (a.page ? '<a class="cr-btn" style="white-space:nowrap" href="' + e(a.page) + '">Artist page</a>' : "") + "</div>" + list + "</div>" : "");
  }

  function paint() {
    if (!L.node) return;
    L.node.innerHTML = '<section class="cro-card" data-crla><h2>Artists</h2>' +
      '<p class="cro-meta">One account, several artists. Each artist is its own identity and owns its own releases; ' +
      "your account acts for the ones it manages until they have a login of their own. Giving an artist its own login moves none of its music.</p>" +
      body() + "</section>";
    var sel = L.node.querySelector("[data-crla-switch]");
    if (sel) sel.onchange = function () {
      L.acting = sel.value; remember(L.acting);
      window.CR.musicActingAs = current();
      paint();
    };
  }

  window.CR.musicLabel = {
    render: function () { return "<div data-crla-host></div>"; },
    bind: function (root) {
      var host = root && root.querySelector("[data-crla-host]");
      if (!host) return;
      if (!L.node) { L.node = document.createElement("div"); paint(); }
      host.appendChild(L.node);
      if (!L.loaded) load();
    },
    state: L,
    _test: { staticArtists: staticArtists, fromBackend: fromBackend, albumsFor: albumsFor, LABEL_ACTS: LABEL_ACTS }
  };
})();
