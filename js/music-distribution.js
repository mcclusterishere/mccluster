/* What a release needs before the stores (2026-11-23, owner: "its own distribution hub for real").
   One pure module, used by Creator Studio (js/music-creator-studio.js: the creator's form and checklist) and by
   the tests; no network, no DOM. The details live on creator_tracks.distribution
   (supabase/pending/20261123200000_music_creator_distribution_v1.sql).

     normalize(input)          -> the stored shape, trimmed and bounded (unknown keys dropped)
     problems(dist)            -> what is wrong with it, in words (empty when it can be saved)
     readiness(track, dist, o) -> the store checklist: each item ok | todo | mccluster | warn, with a hint
     isIsrc / isUpc            -> code checks (ISRC shape; UPC/EAN check digit)

   McCluster never mints a code here: an ISRC or UPC the creator already owns can be entered; otherwise the
   checklist says McCluster assigns them when it prepares the release for the stores. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCC_DISTRIBUTION = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var ROLES = ["Primary artist", "Featured artist", "Producer", "Composer", "Lyricist", "Songwriter", "Mixing engineer", "Mastering engineer", "Engineer"];
  var WRITERS = ["Composer", "Lyricist", "Songwriter"];
  var SPLIT_KINDS = ["master", "publishing"];
  var LANGS = /^[a-z]{2,3}$/;

  function str(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 200); }
  function isIsrc(v) { return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(String(v || "")); }
  function isUpc(v) {
    var s = String(v || "");
    if (!/^\d{12,13}$/.test(s)) return false;
    var d = s.split("").map(Number), check = d.pop(), sum = 0;
    for (var i = d.length - 1, k = 0; i >= 0; i--, k++) sum += d[i] * (k % 2 === 0 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === check;
  }
  function isDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return false;
    var t = new Date(v + "T00:00:00Z");
    return !isNaN(t) && t.toISOString().slice(0, 10) === v;
  }

  function normalize(input) {
    var d = input && typeof input === "object" ? input : {};
    var out = { v: 1 };
    out.release_date = isDate(d.release_date) ? d.release_date : "";
    out.explicit = d.explicit === true ? true : d.explicit === false ? false : null;
    out.language = LANGS.test(String(d.language || "")) ? String(d.language) : "en";
    out.p_line = str(d.p_line, 200);
    out.c_line = str(d.c_line, 200);
    out.master_owner = str(d.master_owner, 200);
    out.isrc = str(d.isrc, 20).toUpperCase().replace(/[\s-]/g, "");
    out.upc = str(d.upc, 20).replace(/[\s-]/g, "");
    out.credits = (Array.isArray(d.credits) ? d.credits : []).slice(0, 40)
      .map(function (c) { return { name: str(c && c.name, 120), role: ROLES.indexOf(c && c.role) >= 0 ? c.role : "" }; })
      .filter(function (c) { return c.name || c.role; });
    out.splits = (Array.isArray(d.splits) ? d.splits : []).slice(0, 40)
      .map(function (s) {
        var pct = Math.round(Number(s && s.share_pct) * 100) / 100;
        return { kind: SPLIT_KINDS.indexOf(s && s.kind) >= 0 ? s.kind : "master", name: str(s && s.name, 120), share_pct: isFinite(pct) ? pct : 0 };
      })
      .filter(function (s) { return s.name || s.share_pct; });
    return out;
  }

  function totals(dist) {
    var t = { master: 0, publishing: 0 }, n = { master: 0, publishing: 0 };
    (dist.splits || []).forEach(function (s) { t[s.kind] = Math.round((t[s.kind] + s.share_pct) * 100) / 100; n[s.kind]++; });
    return { sum: t, count: n };
  }

  function problems(dist) {
    var d = normalize(dist), out = [];
    if (d.isrc && !isIsrc(d.isrc)) out.push("The ISRC should look like CC-XXX-YY-NNNNN (12 letters and digits).");
    if (d.upc && !isUpc(d.upc)) out.push("The UPC should be 12 or 13 digits with a valid check digit.");
    d.credits.forEach(function (c, i) {
      if (!c.name) out.push("Credit " + (i + 1) + " needs a name.");
      if (!c.role) out.push("Credit " + (i + 1) + " needs a role.");
    });
    d.splits.forEach(function (s, i) {
      if (!s.name) out.push("Split " + (i + 1) + " needs a name.");
      if (!(s.share_pct > 0 && s.share_pct <= 100)) out.push("Split " + (i + 1) + " needs a share between 0 and 100%.");
    });
    var t = totals(d);
    SPLIT_KINDS.forEach(function (k) {
      if (t.count[k] && Math.abs(t.sum[k] - 100) > 0.001) out.push("The " + k + " splits add up to " + t.sum[k] + "%, not 100%.");
    });
    return out;
  }

  /* opts: { today: "YYYY-MM-DD", art: { w, h } (the artwork's measured size, when known) } */
  function readiness(track, dist, opts) {
    var t = track || {}, d = normalize(dist), o = opts || {}, items = [];
    function add(key, label, state, hint) { items.push({ key: key, label: label, state: state, hint: hint || "" }); }
    add("title", "Title and artist", t.title && t.artist ? "ok" : "todo", t.title && t.artist ? "" : "Set them on the release.");
    var art = o.art;
    if (!t.poster_url) add("artwork", "Cover art", "todo", "Add a square cover, 3000 × 3000 px.");
    else if (art && art.w && art.h && (art.w !== art.h || art.w < 3000)) add("artwork", "Cover art", "warn", "Stores want a square cover of at least 3000 × 3000 px; this one is " + art.w + " × " + art.h + ".");
    else add("artwork", "Cover art", "ok", art && art.w ? art.w + " × " + art.h + " px" : "");
    var lossless = /\.(wav|flac|aiff?)$/i.test(String(t.master_path || ""));
    add("master", "Lossless master", t.master_path ? (lossless ? "ok" : "warn") : "todo",
      t.master_path ? (lossless ? "" : "Stores take WAV or FLAC; upload a lossless master for delivery.") : "Upload the master.");
    var rights = t.rights_status === "attested" || t.rights_status === "cleared" || t.rights_status === "review";
    add("rights", "Rights", rights ? "ok" : "todo", rights ? "" : "Confirm you own or control the rights on the release.");
    add("review", "Approved by McCluster", t.status === "approved" || t.status === "published" ? "ok" : "todo",
      t.status === "approved" || t.status === "published" ? "" : "Submit the release; McCluster reviews it before the stores.");
    if (!d.release_date) add("release_date", "Release date", "todo", "Pick the day it goes out.");
    else if (o.today && d.release_date < addDays(o.today, 14)) add("release_date", "Release date", "warn", "Stores ask for two to four weeks' notice; " + d.release_date + " is sooner.");
    else add("release_date", "Release date", "ok", d.release_date);
    add("explicit", "Explicit content", d.explicit === null ? "todo" : "ok", d.explicit === null ? "Say whether it is explicit." : d.explicit ? "Explicit" : "Clean");
    var writers = d.credits.filter(function (c) { return c.name && WRITERS.indexOf(c.role) >= 0; }).length;
    add("credits", "Songwriter credits", writers ? "ok" : "todo", writers ? writers + " writer" + (writers > 1 ? "s" : "") : "Name who wrote it (composer, lyricist or songwriter).");
    var owner = d.master_owner || "";
    add("owner", "Master owner and ℗ line", owner && d.p_line ? "ok" : "todo", owner && d.p_line ? owner : "Who owns the recording, and its ℗ line (e.g. “2026 Your Name”).");
    var bad = problems(d), tt = totals(d);
    var splitBad = bad.filter(function (p) { return /split/i.test(p); });
    add("splits", "Splits", splitBad.length ? "todo" : "ok", splitBad.length ? splitBad[0] : tt.count.master || tt.count.publishing ? "Adds up to 100%" : "None set: 100% to the master owner.");
    add("isrc", "ISRC", d.isrc ? (isIsrc(d.isrc) ? "ok" : "todo") : "mccluster", d.isrc ? (isIsrc(d.isrc) ? d.isrc : "That is not an ISRC.") : "McCluster assigns one when it prepares the release.");
    add("upc", "UPC", d.upc ? (isUpc(d.upc) ? "ok" : "todo") : "mccluster", d.upc ? (isUpc(d.upc) ? d.upc : "That is not a valid UPC.") : "McCluster assigns one when it prepares the release.");
    var lyr = t.lyr_reviewed === "true" || t.lyr_reviewed === true;
    add("lyrics", "Lyrics approved", lyr ? "ok" : "warn", lyr ? "" : "Optional, but stores show approved, timed lyrics.");
    var blocking = items.filter(function (i) { return i.state === "todo"; }).length;
    return { items: items, ready: blocking === 0, blocking: blocking };
  }
  function addDays(day, n) { var t = new Date(day + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

  return { ROLES: ROLES, SPLIT_KINDS: SPLIT_KINDS, normalize: normalize, problems: problems, readiness: readiness, isIsrc: isIsrc, isUpc: isUpc, isDate: isDate };
});
