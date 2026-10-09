/* McCluster Music: a creator's albums.

   An album is a creator's own grouping of their own tracks: a title, a
   cover, a release date, a description and an ordered list of track ids.
   Albums live in music_creator_profiles.settings.albums, which the creator
   may edit (their profile row, their RLS policy) and the public may read
   for an active profile. The tracks stay canonical creator_tracks rows:
   publication is still the operator's review, so a public page shows an
   album's PUBLISHED tracks only, and an album with none is not shown.

   Everything here is creator-written data read back by strangers, so every
   field is bounded and every image must be one the platform stores
   (creator-artwork in this project's Supabase Storage), never an arbitrary
   URL. Shared by Creator Studio (js/music-creator-studio.js) and the public
   artist page (js/music-creator-profile.js); Node tests require it too. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MCC_CREATOR_ALBUMS = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var ARTWORK = SB + "/storage/v1/object/public/creator-artwork/";
  var MAX_ALBUMS = 24;
  var MAX_TRACKS = 60;
  var KINDS = { album: "Album", ep: "EP", mixtape: "Mixtape", single: "Single" };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ALBUM_ID = /^alb_[a-z0-9]{6,24}$/;
  var DATE = /^\d{4}-\d{2}-\d{2}$/;
  var HEX = /^#[0-9a-f]{6}$/i;

  function text(value, max) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function longText(value, max) {
    return String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, max);
  }

  /* An image the platform stores, or nothing. */
  function safeArtwork(url) {
    var u = String(url || "");
    if (u.indexOf(ARTWORK) !== 0 || u.length > 600) return "";
    var rest = u.slice(ARTWORK.length);
    return /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(rest) ? u : "";
  }

  /* A link a listener may follow: https only, no credentials. */
  function safeLink(url) {
    var u = String(url || "").trim();
    if (!/^https:\/\//i.test(u) || u.length > 500) return "";
    try {
      var parsed = new URL(u);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
      return parsed.href;
    } catch (_) { return ""; }
  }

  function validDate(value) {
    var d = String(value || "");
    if (!DATE.test(d)) return "";
    var t = Date.parse(d + "T00:00:00Z");
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : "";
  }

  function newAlbumId() {
    var s = "";
    while (s.length < 10) s += Math.random().toString(36).slice(2);
    return "alb_" + s.slice(0, 10);
  }

  /* One album, bounded. Unknown fields are dropped. */
  function normalizeAlbum(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = ALBUM_ID.test(String(raw.id || "")) ? String(raw.id) : "";
    var title = text(raw.title, 160);
    if (!id || !title) return null;
    var seen = {};
    var tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map(function (t) { return String(t || "").toLowerCase(); })
      .filter(function (t) { if (!UUID.test(t) || seen[t]) return false; seen[t] = true; return true; })
      .slice(0, MAX_TRACKS);
    return {
      id: id,
      title: title,
      kind: KINDS[raw.kind] ? raw.kind : "album",
      release_date: validDate(raw.release_date),
      description: longText(raw.description, 2000),
      cover_url: safeArtwork(raw.cover_url),
      tracks: tracks
    };
  }

  /* The albums a profile's settings hold, bounded and de-duplicated. */
  function normalizeAlbums(settings) {
    var list = settings && Array.isArray(settings.albums) ? settings.albums : [];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_ALBUMS; i++) {
      var a = normalizeAlbum(list[i]);
      if (!a || seen[a.id]) continue;
      seen[a.id] = true;
      out.push(a);
    }
    return out;
  }

  function featuredId(settings, albums) {
    var id = settings && String(settings.featured_album || "");
    return albums.some(function (a) { return a.id === id; }) ? id : (albums[0] ? albums[0].id : "");
  }

  /* The public page: each album with only its published tracks, in the
     creator's order; empty albums hidden; everything published that no
     album claims listed as singles. tracks: published creator_tracks rows. */
  function publicCatalogue(settings, tracks) {
    var byId = {};
    (tracks || []).forEach(function (t) { if (t && t.id) byId[String(t.id).toLowerCase()] = t; });
    var claimed = {};
    var albums = normalizeAlbums(settings).map(function (a) {
      var rows = a.tracks.map(function (id) { return byId[id]; }).filter(Boolean);
      rows.forEach(function (t) { claimed[String(t.id).toLowerCase()] = true; });
      return Object.assign({}, a, { rows: rows });
    }).filter(function (a) { return a.rows.length > 0; });
    var singles = (tracks || []).filter(function (t) { return t && t.id && !claimed[String(t.id).toLowerCase()]; });
    var featured = featuredId(settings, albums);
    return { albums: albums, singles: singles, featured: featured };
  }

  /* The artist-wide colours a creator chose in Creator Studio, if valid. */
  function theme(settings) {
    var t = settings && settings.experience_theme || {};
    var out = {};
    ["accent", "background", "foreground", "surface"].forEach(function (k) { if (HEX.test(String(t[k] || ""))) out[k] = String(t[k]); });
    return out;
  }

  function kindLabel(kind) { return KINDS[kind] || KINDS.album; }

  return {
    SB: SB,
    ARTWORK: ARTWORK,
    MAX_ALBUMS: MAX_ALBUMS,
    MAX_TRACKS: MAX_TRACKS,
    KINDS: KINDS,
    safeArtwork: safeArtwork,
    safeLink: safeLink,
    validDate: validDate,
    newAlbumId: newAlbumId,
    normalizeAlbum: normalizeAlbum,
    normalizeAlbums: normalizeAlbums,
    featuredId: featuredId,
    publicCatalogue: publicCatalogue,
    theme: theme,
    kindLabel: kindLabel
  };
});
