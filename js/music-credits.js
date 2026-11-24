/* WHO IS ON A RECORD: one reading of data/albums.json for every page and generator.

   Until 2026-11-24 a track carried only a free-text line ("ft. Ocho, McCluster & Old Jay"), so nothing on the site
   knew who a person was: an artist could not be opened, a feature could not be found, and the same name was typed
   again wherever it was shown. Owner, 2026-11-24: every artist credited on any track, featured artists included,
   gets an entry, and opening one shows everything they appear on.

   THE STRUCTURE (data/albums.json):
     artists[]            the registry: { slug, name, kind: "person" | "act", page?, handle?, id? }
                          page   an existing same-site page that is already theirs (the house, prim3-artist.html)
                          handle their creator handle, when they have one
                          id     the @id an existing graph already gives them; never a new identity
     track.credits        { primary: [slug], lead?: [slug], featured?: [slug], producers?: [slug],
                            produced_as?: "produced" | "scored" | "co" | "prod",
                            roles?: [{ role, artist: slug, as? }], note?, after? }
                          primary  who the record is by
                          lead     the named lead performers on a record that is an act's ("McCluster ft. ..." on an
                                   Equity Uprise record)
                          roles    any other stated fact ("guitar by", "beat by"); `as` is the name as it was written

   THE LINE is written from that structure by line() and by nothing else. tools/build-music-credits.mjs stores it
   beside the structure as track.credit (as track.sub under a title, and the billed names as track.artist where
   the album does not say whose record it is), and scripts/test/music-credits.test.mjs fails when the stored words
   and this function disagree, so the two cannot drift.

   A classic script with no import or export: the pages load it with a script tag, the generators import it for its
   side effect. Both read the same global. */
(function (root) {
  "use strict";

  var HOUSE = "mccluster";
  var PRODUCED = { produced: "Produced by ", scored: "Scored and produced by ", co: "Co-produced by ", prod: "prod. " };
  /* a stated role that is a production credit: it is listed with what the artist produced */
  var PRODUCTION_ROLES = { beat: true, score: true };

  function arr(v) { return Array.isArray(v) ? v : []; }
  function index(doc) {
    var m = {};
    arr(doc && doc.artists).forEach(function (a) { if (a && a.slug) m[a.slug] = a; });
    return m;
  }
  function nameOf(idx, slug) { return (idx[slug] && idx[slug].name) || String(slug || ""); }
  /* "A", "A & B", "A, B & C" */
  function list(names) {
    if (names.length < 3) return names.join(" & ");
    return names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  }

  function pieces(doc, track) {
    var c = track && track.credits;
    if (!c) return null;
    var idx = index(doc);
    var names = function (slugs) { return arr(slugs).map(function (s) { return nameOf(idx, s); }); };
    var lead = arr(c.lead), featured = arr(c.featured), primary = arr(c.primary);
    var heads = names(lead.length ? lead : primary);
    var note = String(c.note || "");
    var houseAlone = !lead.length && primary.length === 1 && primary[0] === HOUSE;
    /* the note already names them ("The PRIM3 blue-team anthem"): the name is not said twice */
    var named = !!note && heads.length > 0 && heads.every(function (n) { return note.indexOf(n) > -1; });
    var billing = "";
    if (featured.length) billing = heads.join(" × ") + " ft. " + list(names(featured));
    else if (!houseAlone && !named) billing = heads.join(" × ");
    var roles = arr(c.roles).map(function (r) { return r.role + " by " + (r.as || nameOf(idx, r.artist)); });
    var producers = names(c.producers);
    var produced = producers.length ? (PRODUCED[c.produced_as] || PRODUCED.produced) + list(producers) : "";
    return { billing: billing, note: note, roles: roles, produced: produced, after: String(c.after || "") };
  }

  /* the whole credit line, as the site shows it */
  function line(doc, track) {
    var p = pieces(doc, track);
    if (!p) return "";
    return [p.billing, p.note].concat(p.roles, [p.produced, p.after]).filter(Boolean).join(" · ");
  }

  /* the line under a title in a track list: who is on it and who produced it (the owner, 2026-11-24, keeps every
     credit a row showed: "prod. PAX" was in this line and stays in it). Only the trailing remark (`after`) is left
     to the full line. null when the record has nobody on it but its own artist, so a hand-written subtitle ("the
     title track") is left alone; rowLine() below still shows that record's producer. */
  function sub(doc, track) {
    var c = track && track.credits;
    if (!c) return null;
    if (!arr(c.lead).length && !arr(c.featured).length && arr(c.primary).length < 2) return null;
    var p = pieces(doc, track);
    return [p.billing, p.note].concat(p.roles, [p.produced]).filter(Boolean).join(" · ");
  }

  /* what a track row prints under the title, from the two stored strings: the subtitle and the credit line, each
     said once. A hand-written subtitle comes first ("the title track · Produced by ..."); a credit that already
     begins with the subtitle is printed alone. */
  function rowLine(track) {
    var s = String((track && track.sub) || ""), c = String((track && track.credit) || "");
    if (!c) return s;
    if (!s || c.indexOf(s) === 0) return c;
    return s + " · " + c;
  }

  /* WHOSE RECORD IT IS, where the album does not already say. A record the house is not a primary artist of is
     billed to its primary artists by name ("Hitman Benji × Raheem × Rahndrx"), never to the house by default.
     "" when the house is a primary artist, or the track has no structure: the caller keeps its own default. */
  function billedTo(doc, track) {
    var primary = arr(track && track.credits && track.credits.primary);
    if (!primary.length || primary.indexOf(HOUSE) > -1) return "";
    var idx = index(doc);
    return primary.map(function (s) { return nameOf(idx, s); }).join(" × ");
  }
  /* the same for a whole record with no `artist` of its own (the Singles shelf): null when the house is a primary
     artist on every track, else the artists every track shares, else "Various artists" */
  function albumBilling(doc, album) {
    var tracks = arr(album && album.tracks).filter(function (t) { return t && t.credits; });
    if (!tracks.length) return null;
    if (tracks.every(function (t) { return arr(t.credits.primary).indexOf(HOUSE) > -1; })) return null;
    var first = arr(tracks[0].credits.primary).join("|");
    if (!tracks.every(function (t) { return arr(t.credits.primary).join("|") === first; })) return { name: "Various artists", slugs: [] };
    return { name: billedTo(doc, tracks[0]), slugs: arr(tracks[0].credits.primary).slice() };
  }

  /* every artist on a track with what they did there, in the order the line says it */
  function credited(track) {
    var c = (track && track.credits) || {};
    var out = [];
    arr(c.primary).forEach(function (s) { out.push({ slug: s, group: "own", role: "artist" }); });
    arr(c.lead).forEach(function (s) { out.push({ slug: s, group: "featured", role: "lead" }); });
    arr(c.featured).forEach(function (s) { out.push({ slug: s, group: "featured", role: "featured" }); });
    arr(c.roles).forEach(function (r) {
      out.push({ slug: r.artist, group: PRODUCTION_ROLES[r.role] ? "produced" : "other", role: r.role, as: r.as || "" });
    });
    arr(c.producers).forEach(function (s) { out.push({ slug: s, group: "produced", role: "producer" }); });
    return out;
  }

  /* every name a search should find this track by */
  function names(doc, track) {
    var idx = index(doc), seen = {}, out = [];
    credited(track).forEach(function (x) {
      [nameOf(idx, x.slug), x.as].forEach(function (n) { if (n && !seen[n]) { seen[n] = true; out.push(n); } });
    });
    return out;
  }

  /* everything one artist appears on, grouped by what they did: their own records, the ones they are on, the ones
     they produced, and any other stated role. A track is listed once in a group. */
  function appearances(doc, slug) {
    var out = { own: [], featured: [], produced: [], other: [] };
    arr(doc && doc.albums).forEach(function (album) {
      arr(album.tracks).forEach(function (track, i) {
        var seen = {};
        credited(track).forEach(function (x) {
          if (x.slug !== slug || seen[x.group]) return;
          seen[x.group] = true;
          out[x.group].push({ album: album, track: track, no: i + 1, role: x.role });
        });
      });
    });
    return out;
  }

  /* how many tracks an artist is on, whatever they did there */
  function count(doc, slug) {
    var n = 0;
    arr(doc && doc.albums).forEach(function (album) {
      arr(album.tracks).forEach(function (track) {
        if (credited(track).some(function (x) { return x.slug === slug; })) n += 1;
      });
    });
    return n;
  }

  /* true when an artist's own page already lists everything they appear on: every track they are credited on is
     on a record that names that page as its artist page (data/albums.json album.artist_page). PRIM3's page is: all
     thirteen PRIM3 songs are on its one record. The house's is not: index.html does not list the Equity Uprise
     records McCluster features on. */
  function pageListsAll(doc, artist) {
    if (!artist || !/^[a-z0-9-]+\.html$/.test(artist.page || "")) return false;
    var on = 0, all = true;
    arr(doc && doc.albums).forEach(function (album) {
      arr(album.tracks).forEach(function (track) {
        if (!credited(track).some(function (x) { return x.slug === artist.slug; })) return;
        on += 1;
        if (album.artist_page !== artist.page) all = false;
      });
    });
    return on > 0 && all;
  }

  /* where an artist opens. Owner, 2026-11-24: opening an artist shows everything they appear on. That is the artist
     view (artist.html), which links on to a page of their own; an artist's own page is opened directly only when
     it already lists everything (pageListsAll). */
  function href(artist, doc) {
    if (pageListsAll(doc, artist)) return artist.page;
    return "artist.html?artist=" + encodeURIComponent((artist && artist.slug) || "");
  }

  /* the artists selector: the house first, then every registered artist who is on at least one track */
  function roster(doc) {
    var all = arr(doc && doc.artists).map(function (a) {
      return { slug: a.slug, name: a.name, kind: a.kind, page: a.page || "", handle: a.handle || "", href: href(a, doc), tracks: count(doc, a.slug) };
    }).filter(function (a) { return a.tracks > 0; });
    return all.filter(function (a) { return a.slug === HOUSE; }).concat(all.filter(function (a) { return a.slug !== HOUSE; }));
  }

  /* true when every one of these tracks is the house artist's own and nobody else's: the only records a line like
     "written & performed by Matthew McCluster" may stand under */
  function houseOnly(tracks) {
    var t = arr(tracks);
    return t.length > 0 && t.every(function (x) {
      var c = x && x.credits;
      return !!c && arr(c.primary).length === 1 && c.primary[0] === HOUSE && !arr(c.lead).length;
    });
  }

  root.MCC_CREDITS = {
    HOUSE: HOUSE, index: index, list: list, line: line, sub: sub, rowLine: rowLine, billedTo: billedTo, albumBilling: albumBilling, pageListsAll: pageListsAll, credited: credited, names: names,
    appearances: appearances, count: count, href: href, roster: roster, houseOnly: houseOnly
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
