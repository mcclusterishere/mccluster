import { createClient } from "../vendor/supabase-js-2.57.0.mjs";

const SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
const KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
const supabase = createClient(SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const $ = (id) => document.getElementById(id);
const PAGE = window.MCC_CREATOR_PAGE;
let session = null;
let mUid = null;
let profile = null;
let tracksCache = [];
let editingAlbum = null;
let editingService = null;

function status(id, message, tone = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = message || "";
  el.className = "creator-status" + (tone ? " " + tone : "");
}
function slugify(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 90) || "track";
}
function fileName(file) {
  return String(file?.name || "upload").replace(/[^a-zA-Z0-9._-]+/g, "-");
}
/* NEVER THE BOOT TOKEN (music slice M4, 2026-11-19; accounts lane ACC-3). This page used to take the session once,
   when it opened, and send that token with every save and upload after it: an hour into an album upload every call
   answered "JWT expired" while the bar still said signed in. Every call now takes the shared auth's token for that
   call (renewed when it is near its end, asked again once after a 401: js/mcc-auth.js authFetch), and only for the
   account this studio opened for: if the site is now signed in as someone else, or signed out, the call is refused
   here and the studio closes and opens again for whoever is signed in now (boot, below). */
let account = null;
function studioFetch(url, init) {
  /* "-" matches nobody: while the studio is closed between two accounts, every call is refused */
  return window.MCC.authFetch(url, init, { account: account || "-" });
}
/* A save or an upload that is running when the account changes is let fail (its next call is refused) and the
   studio opens again for the new account once it has: nothing it started is ever sent as someone else. */
let running = 0;
let reopenWhenDone = false;
function guarded(handler) {
  return async function (...args) {
    running++;
    try { return await handler.apply(this, args); }
    finally {
      running--;
      if (!running && reopenWhenDone) { reopenWhenDone = false; closeStudio(); boot(); }
    }
  };
}
async function authed() {
  session = await window.MCC.refreshIfNeeded().catch(() => null);
  /* another tab (or the bar) may have won the refresh: what is stored now is the session */
  if (!session?.access_token) session = window.MCC.session();
  if (!session?.access_token) return false;
  account = window.MCC.account();
  mUid = await window.MCC.mUid();
  return Boolean(mUid);
}
/* An answer that comes back after the studio closed for its account (a sign-out or another sign-in, here or in
   another tab) is never painted or acted on: the studio has opened again for whoever is signed in now. */
const ACCOUNT_CHANGED = "You signed in as someone else, or signed out, in another tab. Creator Studio has reopened for the account signed in now.";
async function rest(path, init = {}) {
  const asked = account;
  const headers = {
    apikey: KEY,
    "content-type": "application/json",
    ...(init.headers || {})
  };
  const res = await studioFetch(SB + "/rest/v1/" + path, { ...init, headers });
  const text = await res.text();
  if (account !== asked) throw new Error(ACCOUNT_CHANGED);
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.hint || ("Request failed " + res.status);
    throw new Error(msg);
  }
  return data;
}
async function fn(action, body = {}) {
  const asked = account;
  const res = await studioFetch(SB + "/functions/v1/music-access", {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ action, ...body })
  });
  const data = await res.json().catch(() => ({}));
  if (account !== asked) throw new Error(ACCOUNT_CHANGED);
  if (!res.ok) throw new Error(data.error || ("Music service " + res.status));
  return data;
}
/* The ceilings Supabase will actually enforce, from the bucket definitions in
   20260920041011_music_creator_platform_v1.sql. Checked here because the
   server only rejects AFTER the bytes have been sent: pick a 600MB master on
   a phone and you watch an upload bar crawl for minutes to earn a failure. */
const BUCKET_MAX_BYTES = {
  "creator-masters": 524288000,
  "creator-previews": 52428800,
  "creator-artwork": 20971520
};
/* `up` rounds away from the limit. Without it a file one byte over 500MB
   reports as "500MB", and the refusal reads as though it were arguing with
   itself: "That file is 500MB. The limit here is 500MB." */
function describeSize(bytes, up) {
  if (bytes < 1048576) return Math.max(1, Math[up ? "ceil" : "round"](bytes / 1024)) + "KB";
  const mb = bytes / 1048576;
  const rounded = up ? Math.ceil(mb * 10) / 10 : mb;
  return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + "MB";
}
/* THE LYRIC SHEET. Optional words for the lyric machine: McCluster Core times
   them to the master (line and word), or writes them from the audio when there
   is no sheet. The sheet rides on its own column after the release row exists,
   and a refusal never sinks the release.
   NEVER LOST SILENTLY (owner, 2026-11-23). Until the lyrics_sheet column is live
   (supabase/pending/20261031180000_lyrics_machine_v1.sql) the PATCH is refused,
   and the sheet used to vanish into the console. Now the words are kept on the
   release itself as untimed lyrics (creator_tracks.lyrics {source:"sheet",
   plain}): listeners see the words, the machine replaces them with timed ones
   (an untimed, unreviewed file is always replaceable, lyrics-align.mjs
   mayReplace), and the creator is told which of the two happened.
   Returns "sheet" | "words" | "lost" | "" (no sheet). */
async function attachLyricSheet(trackId, words) {
  const sheet = String(words || "").trim();
  if (!sheet) return "";
  const where = "creator_tracks?id=eq." + encodeURIComponent(trackId);
  try {
    await rest(where, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ lyrics_sheet: sheet.slice(0, 40000) }) });
    return "sheet";
  } catch (err) {
    console.warn("lyric sheet column unavailable; keeping the words on the release", err);
  }
  try {
    await rest(where, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      lyrics: { source: "sheet", reviewed: false, plain: sheet.slice(0, 40000), sheet_saved_at: new Date().toISOString() }
    }) });
    return "words";
  } catch (err) {
    console.warn("lyric sheet not attached", err);
    return "lost";
  }
}
function lyricSheetNote(outcome) {
  if (outcome === "sheet") return " Your lyric sheet is saved; McCluster times it to the song.";
  if (outcome === "words") return " Your lyrics are saved with the release; timing them to the song comes once the lyric machine is switched on.";
  if (outcome === "lost") return " Your lyric sheet could not be saved: paste it again when you edit this release.";
  return "";
}
function wireLyricSheet() {
  const file = $("trackLyricSheetFile"), box = $("trackLyricSheet"), help = $("trackLyricSheetHelp");
  if (!file || !box || !window.MCC_LYRIC_SHEET) return;
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    if (!f) return;
    window.MCC_LYRIC_SHEET.read(f).then((r) => { box.value = r.text.trim(); if (help) help.textContent = "Read " + f.name + " (" + r.kind + "). Check the words, then upload."; })
      .catch((e) => { if (help) help.textContent = e.message || "Could not read that file."; });
  });
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireLyricSheet); else wireLyricSheet();
}

async function uploadGrant(bucket, file) {
  if (navigator.onLine === false) throw new Error("You are offline. Reconnect before uploading this release.");
  const max = BUCKET_MAX_BYTES[bucket];
  if (max && file.size > max) {
    throw new Error(
      `That file is ${describeSize(file.size, true)}. The limit here is ${describeSize(max)} — ` +
      "pick a smaller export and try again."
    );
  }
  const grant = await fn("creator-upload-url", { bucket, file_name: fileName(file) });
  const { error } = await supabase.storage.from(bucket)
    .uploadToSignedUrl(grant.path, grant.token, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return grant.path;
}
/* Deleting an object needs its owner: the storage policy only lets an
   authenticated creator remove files under their own folder. The module
   client above is anonymous (uploads go through signed URLs and need no
   session), so a delete through it was refused and every rollback left its
   files behind. Each removal uses a client carrying the creator's token: the
   shared auth's, for that call (accessToken), never one kept from boot. */
function ownerStorage() {
  return createClient(SB, KEY, {
    accessToken: () => window.MCC.freshToken(),
    global: { fetch: studioFetch }
  });
}
async function removeUpload(bucket, path) {
  if (!bucket || !path) return;
  const supabase = ownerStorage();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}
/* Is any of this creator's releases still pointing at these uploads? A write
   can commit even when its response never arrives, and a release already
   moved to pending_review cannot be deleted by its creator (a zero-row
   DELETE is not an error). Files are removed only when this says no; when it
   cannot tell, it answers yes, because a stray file costs less than a release
   whose audio was deleted from under it. */
async function uploadsInUse(trackId, uploads) {
  const paths = uploads.filter((u) => u.bucket !== "creator-artwork").map((u) => '"' + u.path + '"').join(",");
  const clauses = [];
  if (trackId) clauses.push("id.eq." + trackId);
  if (paths) clauses.push("master_path.in.(" + paths + ")", "preview_path.in.(" + paths + ")");
  if (!clauses.length) return false;
  try {
    const rows = await rest("creator_tracks?m_uid=eq." + encodeURIComponent(mUid) +
      "&or=" + encodeURIComponent("(" + clauses.join(",") + ")") + "&select=id&limit=1");
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) {
    return true;
  }
}
async function rollbackRelease(trackId, uploads) {
  const failures = [];
  if (trackId) {
    try { await rest("creator_tracks?id=eq." + encodeURIComponent(trackId), { method: "DELETE", headers: { Prefer: "return=minimal" } }); }
    catch (err) { failures.push("release record: " + (err.message || err)); }
  }
  if (await uploadsInUse(trackId, uploads)) {
    failures.push("files kept: a saved release still uses them");
    if (window.MCC_TRACK) window.MCC_TRACK("creator_release_cleanup_failed", { failures });
    return failures;
  }
  for (const item of uploads.slice().reverse()) {
    try { await removeUpload(item.bucket, item.path); }
    catch (err) { failures.push(item.bucket + ": " + (err.message || err)); }
  }
  if (failures.length && window.MCC_TRACK) window.MCC_TRACK("creator_release_cleanup_failed", { failures });
  return failures;
}
function publicUrl(bucket, path) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
function durationMs(file) {
  return new Promise((resolve) => {
    const a = document.createElement("audio");
    const u = URL.createObjectURL(file);
    let settled = false;
    let timer;
    const finish = (ms) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      a.onloadedmetadata = null;
      a.onerror = null;
      a.removeAttribute("src");
      a.load();
      URL.revokeObjectURL(u);
      resolve(ms);
    };
    /* A malformed or unsupported file can emit neither metadata nor error.
       Release its local file handle and let the creator choose another file. */
    timer = setTimeout(() => finish(null), 15000);
    a.preload = "metadata";
    a.onloadedmetadata = () => finish(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : null);
    a.onerror = () => finish(null);
    a.src = u;
  });
}
async function loadProfile() {
  const rows = await rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(mUid) +
    "&select=m_uid,handle,artist_name,bio,website_url,avatar_url,banner_url,status,verification_state,payout_state,settings&limit=1");
  profile = rows?.[0] || null;
  renderAlbums();
  renderServices();
  if (!profile) return;
  $("creatorAvatarNow").textContent = profile.avatar_url ? "Photo set. Choose a file to replace it." : "Square works best. Shown on your page and beside your tracks.";
  $("creatorBannerNow").textContent = profile.banner_url ? "Front-page photo set. Choose a file to replace it." : "Wide and dark works best. It sits behind your name at the top of your page.";
  $("creatorHandle").value = profile.handle || "";
  $("creatorName").value = profile.artist_name || "";
  $("creatorBio").value = profile.bio || "";
  $("creatorWebsite").value = profile.website_url || "";
  var artistTheme = profile.settings && profile.settings.experience_theme || {};
  $("creatorAccent").value = artistTheme.accent || "#e5383b";
  $("creatorBackground").value = artistTheme.background || "#090706";
  $("creatorForeground").value = artistTheme.foreground || "#f4efe6";
  $("creatorSurface").value = artistTheme.surface || "#17110f";
  ["Accent","Background","Foreground","Surface"].forEach(function(k){
    var el=$("track"+k); if(el) el.value=$("creator"+k).value;
  });
  $("creatorTerms").checked = true;
  const pub = $("publicProfile");
  pub.href = "music-creator.html?handle=" + encodeURIComponent(profile.handle);
  pub.hidden = false;
}
function pillClass(track) {
  if (track.status === "published") return "creator-pill live";
  if (track.status === "pending_review" || track.status === "approved") return "creator-pill review";
  return "creator-pill";
}
async function loadTracks() {
  const rows = await rest("creator_tracks?m_uid=eq." + encodeURIComponent(mUid) +
    "&select=id,title,artist,status,rights_status,access_mode,genre,poster_url,duration_ms,music_video_url,lyrics_url,experience,moderation_note,created_at,published_at,master_path," +
    "lyr_source:lyrics->>source,lyr_reviewed:lyrics->>reviewed,lyr_timed:lyrics->timed->line->0->>begin&order=created_at.desc");
  tracksCache = rows || [];
  renderAlbums();
  paintLyricsCard();
  const list = $("creatorTracks");
  if (!rows?.length) {
    list.innerHTML = '<div class="creator-status">No releases yet.</div>';
    return;
  }
  list.innerHTML = rows.map((t) =>
    '<div class="creator-item"><div><b>' + escapeHtml(t.title) + '</b><small>' +
    escapeHtml([t.artist, t.genre, t.access_mode].filter(Boolean).join(" · ")) +
    (t.moderation_note ? '<br>' + escapeHtml(t.moderation_note) : '') +
    '</small>' + lyricsChip(t) + '</div><span class="' + pillClass(t) + '">' +
    escapeHtml(t.status.replace(/_/g, " ")) + ' · ' + escapeHtml(t.rights_status) + '</span></div>'
  ).join("");
}

/* ---------- lyrics (2026-11-23, owner: "Creator Studio ... control the lyrics") ----------
   The creator edits their release's lyrics with the same editor Control uses (js/control-room/lyrics-review.js):
   words, line and word times, tap along, split/merge/add/delete, LRC/TTML export, and "These lyrics are right".
   It reads and writes creator_tracks.lyrics under the creator's own row rights (music_creator_tracks_update), no
   new backend; the audio is the owner's own stream (music-access "stream"). A release that is approved or live
   goes back to review when its lyrics change: the database guard (music_track_guard (b)) does that for every
   role, so the creator is asked first. Ticking "These lyrics are right" keeps the lyric machine from overwriting
   them (core/src/executors/lyrics-align.mjs mayReplace). */
const LIVE_STATES = ["approved", "published"];
function lyricsStateOf(t) {
  if (!t.lyr_source && !t.lyr_timed) return { label: "No lyrics", tone: "" };
  if (t.lyr_reviewed === "true") return { label: "Lyrics approved", tone: "live" };
  if (t.lyr_timed == null) return { label: "Lyrics: timing pending", tone: "review" };
  return { label: "Lyrics timed: check them", tone: "review" };
}
function lyricsChip(t) {
  const st = lyricsStateOf(t);
  return '<span class="creator-lyr"><span class="creator-pill' + (st.tone ? " " + st.tone : "") + '">' + escapeHtml(st.label) + '</span>' +
    (st.label === "No lyrics" ? "" : '<button class="creator-lyr__open" type="button" data-lyrics-open="' + escapeHtml(t.id) + '">Edit lyrics</button>') +
    '<button class="creator-lyr__open" type="button" data-dist-open="' + escapeHtml(t.id) + '">Distribution</button></span>';
}
const lyricsSource = {
  editor: "creator",
  list: async () => tracksCache.filter((t) => t.lyr_source || t.lyr_timed).map((t) => ({
    key: "mine:" + t.id, kind: "mine", id: t.id, title: t.title || "Untitled", album: String(t.status || "").replace(/_/g, " ")
  })),
  get: async (t) => {
    const [rows, stream] = await Promise.all([
      rest("creator_tracks?id=eq." + encodeURIComponent(t.id) + "&m_uid=eq." + encodeURIComponent(mUid) + "&select=lyrics&limit=1"),
      fn("stream", { track_id: t.id }).catch(() => null)
    ]);
    if (!rows?.length) throw new Error("Release not found");
    return { doc: rows[0].lyrics || null, src: stream?.url || "" };
  },
  save: async (t, doc, reviewed) => {
    doc.reviewed_by = reviewed ? "creator" : null;
    if (!reviewed) doc.reviewed_at = null;
    const before = (tracksCache.find((x) => x.id === t.id) || {}).status;
    const rows = await rest("creator_tracks?id=eq." + encodeURIComponent(t.id) + "&m_uid=eq." + encodeURIComponent(mUid) + "&select=id,status", {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ lyrics: doc })
    });
    if (!rows?.length) throw new Error("Release not found");
    const back = LIVE_STATES.includes(before) && rows[0].status === "pending_review";
    return { status: rows[0].status, note: back ? "The release is back in review and returns once it is approved." : "" };
  },
  saved: () => { loadTracks().catch(() => {}); },
  confirm: (t) => LIVE_STATES.includes((tracksCache.find((x) => x.id === t.id) || {}).status)
    ? "This release is approved or live. Changing its lyrics sends it back to review, and it is off the shelf until it is approved again. Save anyway?"
    : "",
  note: () => "Tick “These lyrics are right” when they are: the lyric machine never overwrites lyrics you approved.",
  untimed: "Your lyric sheet is on the release. McCluster times it to the music; check back once it has run.",
  empty: "No lyrics on this release yet."
};
let lyricsBound = false;
function paintLyricsCard() {
  const card = $("creatorLyrics"), ed = window.CR && window.CR.lyricsReview;
  if (!card || !ed) return;
  const any = tracksCache.some((t) => t.lyr_source || t.lyr_timed);
  card.hidden = !any;
  if (!any) return;
  if (!lyricsBound) { ed.configure(lyricsSource); ed.bind(card); lyricsBound = true; }
  else ed.reload();
}
function openLyrics(id) {
  const card = $("creatorLyrics"), ed = window.CR && window.CR.lyricsReview;
  if (!card || !ed) return;
  paintLyricsCard();
  ed.open("mine:" + id);
  card.scrollIntoView({ block: "start", behavior: "smooth" });
}
$("creatorTracks").addEventListener("click", (e) => {
  const b = e.target.closest("[data-lyrics-open]");
  if (b) openLyrics(b.getAttribute("data-lyrics-open"));
  const d = e.target.closest("[data-dist-open]");
  if (d) openDistribution(d.getAttribute("data-dist-open")).catch((err) => { $("distStatus").textContent = err.message || "Could not open the details"; });
});

/* ---------- distribution (2026-11-23, owner: "its own distribution hub for real") ----------
   The store details for one release: a checklist (js/music-distribution.js readiness) and the form for what the
   release does not already say (release date, explicit, ℗/©, master owner, credits, splits, a code the creator
   already owns). Saved on creator_tracks.distribution under the creator's row rights
   (supabase/pending/20261123200000_music_creator_distribution_v1.sql); it is not release content, so a live
   release stays live. Until that SQL is applied the card says so and writes nothing. McCluster mints no code here
   and nothing is delivered from here: Control stages the release for the stores. */
const DIST = window.MCC_DISTRIBUTION;
let distOpen = null; /* { id, gen } */
let distGen = 0;
const DIST_STATE = { ok: "Done", todo: "To do", mccluster: "McCluster", warn: "Check" };
function distRow(kind, v) {
  const row = document.createElement("div");
  row.className = "creator-dist__row";
  if (kind === "credit") {
    row.innerHTML = '<input aria-label="Name" maxlength="120" data-k="name" autocomplete="off" placeholder="Name"><select aria-label="Role" data-k="role"><option value="">Role…</option>' +
      DIST.ROLES.map((r) => '<option>' + escapeHtml(r) + '</option>').join("") + '</select>';
  } else {
    row.innerHTML = '<select aria-label="Kind" data-k="kind"><option value="master">Master</option><option value="publishing">Publishing</option></select>' +
      '<input aria-label="Name" maxlength="120" data-k="name" autocomplete="off" placeholder="Name"><input aria-label="Share %" data-k="share_pct" inputmode="decimal" placeholder="%">';
  }
  row.insertAdjacentHTML("beforeend", '<button class="creator-dist__del" type="button" aria-label="Remove">×</button>');
  row.querySelectorAll("[data-k]").forEach((el) => { const k = el.getAttribute("data-k"); if (v && v[k] != null) el.value = String(v[k]); });
  row.querySelector(".creator-dist__del").onclick = () => { row.remove(); paintDistCheck(); };
  return row;
}
function distFromForm() {
  const rows = (id) => Array.from($(id).querySelectorAll(".creator-dist__row")).map((r) => {
    const o = {}; r.querySelectorAll("[data-k]").forEach((el) => { o[el.getAttribute("data-k")] = el.value; }); return o;
  });
  const ex = $("distExplicit").value;
  return DIST.normalize({
    release_date: $("distDate").value, explicit: ex === "true" ? true : ex === "false" ? false : null, language: $("distLang").value.trim().toLowerCase(),
    master_owner: $("distOwner").value, p_line: $("distP").value, c_line: $("distC").value, isrc: $("distIsrc").value, upc: $("distUpc").value,
    credits: rows("distCredits"), splits: rows("distSplits").map((x) => ({ ...x, share_pct: x.share_pct === "" ? 0 : Number(String(x.share_pct).replace(",", ".")) }))
  });
}
let distArt = null;
function paintDistCheck() {
  if (!distOpen) return;
  const t = tracksCache.find((x) => x.id === distOpen.id) || {};
  const r = DIST.readiness(t, distFromForm(), { today: new Date().toISOString().slice(0, 10), art: distArt });
  $("distCheck").innerHTML = r.items.map((i) => '<li class="creator-dist__item is-' + i.state + '"><span class="creator-dist__state">' + DIST_STATE[i.state] + '</span><b>' +
    escapeHtml(i.label) + '</b>' + (i.hint ? '<small>' + escapeHtml(i.hint) + '</small>' : '') + '</li>').join("");
}
async function openDistribution(id) {
  const t = tracksCache.find((x) => x.id === id);
  if (!t || !DIST) return;
  const gen = ++distGen;
  distOpen = { id, gen };
  const card = $("creatorDist");
  card.hidden = false;
  $("distTitle").textContent = "Distribution: " + (t.title || "Untitled");
  $("distForm").reset();
  $("distCredits").replaceChildren(); $("distSplits").replaceChildren();
  $("distStatus").textContent = "Loading…";
  $("distSave").disabled = true;
  distArt = null;
  if (t.poster_url) {
    const img = new Image();
    img.onload = () => { if (distOpen && distOpen.gen === gen) { distArt = { w: img.naturalWidth, h: img.naturalHeight }; paintDistCheck(); } };
    img.src = t.poster_url;
  }
  card.scrollIntoView({ block: "start", behavior: "smooth" });
  let stored = null, missing = false;
  try {
    const rows = await rest("creator_tracks?id=eq." + encodeURIComponent(id) + "&m_uid=eq." + encodeURIComponent(mUid) + "&select=distribution&limit=1");
    stored = rows?.[0]?.distribution || null;
  } catch (err) {
    if (!/distribution/.test(err.message || "")) throw err;
    missing = true;
  }
  if (!distOpen || distOpen.gen !== gen) return;
  const d = DIST.normalize(stored || { master_owner: t.artist || (profile && profile.artist_name) || "", p_line: new Date().getFullYear() + " " + (t.artist || "") , c_line: new Date().getFullYear() + " " + (t.artist || "") });
  $("distDate").value = d.release_date; $("distExplicit").value = d.explicit === null ? "" : String(d.explicit); $("distLang").value = d.language;
  $("distOwner").value = d.master_owner; $("distP").value = d.p_line; $("distC").value = d.c_line; $("distIsrc").value = d.isrc; $("distUpc").value = d.upc;
  (d.credits.length ? d.credits : [{ name: t.artist || "", role: "Primary artist" }]).forEach((c) => $("distCredits").appendChild(distRow("credit", c)));
  d.splits.forEach((x) => $("distSplits").appendChild(distRow("split", x)));
  $("distSave").disabled = missing;
  $("distStatus").textContent = missing ? "Distribution details open once McCluster switches them on. Nothing is saved yet." : "";
  paintDistCheck();
}
if (DIST) {
  $("distForm").addEventListener("input", paintDistCheck);
  $("distForm").addEventListener("change", paintDistCheck);
  $("distAddCredit").onclick = () => { $("distCredits").appendChild(distRow("credit")); paintDistCheck(); };
  $("distAddSplit").onclick = () => { $("distSplits").appendChild(distRow("split")); paintDistCheck(); };
  $("distClose").onclick = () => { distOpen = null; $("creatorDist").hidden = true; };
  $("distForm").addEventListener("submit", guarded(async (e) => {
    e.preventDefault();
    if (!distOpen) return;
    const { id, gen } = distOpen, d = distFromForm(), bad = DIST.problems(d);
    if (bad.length) { $("distStatus").textContent = bad[0]; return; }
    $("distSave").disabled = true;
    try {
      const rows = await rest("creator_tracks?id=eq." + encodeURIComponent(id) + "&m_uid=eq." + encodeURIComponent(mUid) + "&select=id", {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ distribution: d })
      });
      if (!rows?.length) throw new Error("Release not found");
      if (distOpen && distOpen.gen === gen) $("distStatus").textContent = "Saved. McCluster uses these details when it prepares the release for the stores.";
    } catch (err) {
      if (distOpen && distOpen.gen === gen) $("distStatus").textContent = /distribution/.test(err.message || "") ? "Distribution details open once McCluster switches them on. Nothing was saved." : (err.message || "Save failed");
    } finally { if (distOpen && distOpen.gen === gen) $("distSave").disabled = false; }
  }));
}
function escapeHtml(value) {
  const d = document.createElement("i");
  d.textContent = value == null ? "" : String(value);
  return d.innerHTML;
}

/* ---------- albums (music_creator_profiles.settings.albums) ---------- */

/* Change the profile's settings without undoing anyone else's change.
   Read the settings with their updated_at (music_creator_guard sets it on
   every write), apply the change, and write back only if updated_at is still
   the one read. If another tab or the profile form wrote in between, nothing
   is written: read again and reapply, a few times at most. */
async function saveSettings(change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(mUid) + "&select=settings,updated_at&limit=1");
    if (!rows?.[0]) throw new Error("Save your creator profile first.");
    const settings = Object.assign({}, rows[0].settings || {});
    change(settings);
    settings.albums = PAGE.normalizeAlbums(settings);
    settings.services = PAGE.normalizeServices(settings);
    if (settings.featured_album && !settings.albums.some((a) => a.id === settings.featured_album)) delete settings.featured_album;
    const written = await rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(mUid) +
      "&updated_at=eq." + encodeURIComponent(rows[0].updated_at), {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ settings })
    });
    if (Array.isArray(written) && written.length) {
      profile = Object.assign({}, profile, { settings: written[0].settings || settings });
      renderAlbums();
      renderServices();
      return;
    }
  }
  throw new Error("Your profile changed in another window while saving. Reload and try again.");
}
function albumsNow() { return PAGE.normalizeAlbums(profile && profile.settings); }
function trackById(id) { return tracksCache.find((t) => String(t.id).toLowerCase() === id) || null; }
function trackLabel(t) {
  return t ? t.title + (t.status === "published" ? "" : " · " + t.status.replace(/_/g, " ")) : "Removed track";
}
function renderAlbums() {
  const list = $("creatorAlbums");
  const select = $("trackAlbum");
  if (!list || !PAGE) return;
  const albums = albumsNow();
  const featured = PAGE.featuredId(profile && profile.settings, albums);
  if (!profile) {
    list.innerHTML = '<div class="creator-status">Save your creator profile first.</div>';
  } else if (!albums.length) {
    list.innerHTML = '<div class="creator-status">No albums yet.</div>';
  } else {
    list.innerHTML = albums.map((a) => {
      const published = a.tracks.filter((id) => trackById(id)?.status === "published").length;
      return '<div class="creator-item"><div><b>' + escapeHtml(a.title) + '</b><small>' +
        escapeHtml([PAGE.kindLabel(a.kind), a.release_date, a.tracks.length + " track" + (a.tracks.length === 1 ? "" : "s"),
          published + " published", a.id === featured ? "featured" : ""].filter(Boolean).join(" · ")) +
        '</small></div><button class="creator-btn quiet" type="button" data-edit-album="' + escapeHtml(a.id) + '">Edit</button></div>';
    }).join("");
  }
  if (select) {
    const keep = select.value;
    select.innerHTML = '<option value="">No album (single)</option>' +
      albums.map((a) => '<option value="' + escapeHtml(a.id) + '">' + escapeHtml(a.title) + '</option>').join("");
    if (albums.some((a) => a.id === keep)) select.value = keep;
  }
}
function renderAlbumTracks() {
  if (!editingAlbum) return;
  const chosen = editingAlbum.tracks;
  $("albumTracks").innerHTML = chosen.length ? chosen.map((id, i) =>
    '<li><span>' + escapeHtml(trackLabel(trackById(id))) + '</span>' +
    '<button type="button" class="creator-mini" data-album-move="' + i + ':-1" aria-label="Move up"' + (i ? '' : ' disabled') + '>↑</button>' +
    '<button type="button" class="creator-mini" data-album-move="' + i + ':1" aria-label="Move down"' + (i < chosen.length - 1 ? '' : ' disabled') + '>↓</button>' +
    '<button type="button" class="creator-mini" data-album-remove="' + i + '" aria-label="Remove from album">✕</button></li>'
  ).join("") : '<li class="creator-status">No tracks yet. Add them below.</li>';
  const pool = tracksCache.filter((t) => !chosen.includes(String(t.id).toLowerCase()) && t.status !== "rejected" && t.status !== "archived");
  $("albumPool").innerHTML = pool.length ? pool.map((t) =>
    '<li><span>' + escapeHtml(trackLabel(t)) + '</span><button type="button" class="creator-mini" data-album-add="' +
    escapeHtml(String(t.id).toLowerCase()) + '">+ Add</button></li>'
  ).join("") : '<li class="creator-status">' + (tracksCache.length ? "Every track is already on this album." : "Upload a track below, then add it here.") + '</li>';
}
function openAlbum(album) {
  if (!profile) { status("albumStatus", "Save your creator profile first.", "bad"); return; }
  editingAlbum = album ? JSON.parse(JSON.stringify(album)) : { id: PAGE.newAlbumId(), title: "", kind: "album", release_date: "", description: "", cover_url: "", tracks: [] };
  const isNew = !album;
  $("albumForm").hidden = false;
  $("albumTitle").value = editingAlbum.title;
  $("albumKind").value = editingAlbum.kind;
  $("albumDate").value = editingAlbum.release_date;
  $("albumDescription").value = editingAlbum.description;
  $("albumCover").value = "";
  $("albumCoverNow").textContent = editingAlbum.cover_url ? "Cover set. Choose a file to replace it." : "Square, at least 1000×1000.";
  $("albumFeatured").checked = !isNew && PAGE.featuredId(profile.settings, albumsNow()) === editingAlbum.id;
  $("deleteAlbum").hidden = isNew;
  status("albumStatus", "");
  renderAlbumTracks();
  $("albumTitle").focus();
}
function closeAlbum() { editingAlbum = null; $("albumForm").hidden = true; status("albumStatus", ""); }

$("newAlbum").addEventListener("click", () => openAlbum(null));
$("cancelAlbum").addEventListener("click", closeAlbum);
$("creatorAlbums").addEventListener("click", (e) => {
  const b = e.target.closest("[data-edit-album]");
  if (!b) return;
  const album = albumsNow().find((a) => a.id === b.getAttribute("data-edit-album"));
  if (album) openAlbum(album);
});
$("albumForm").addEventListener("click", (e) => {
  if (!editingAlbum) return;
  const add = e.target.closest("[data-album-add]");
  const move = e.target.closest("[data-album-move]");
  const remove = e.target.closest("[data-album-remove]");
  const list = editingAlbum.tracks;
  if (add && list.length < PAGE.MAX_TRACKS) list.push(add.getAttribute("data-album-add"));
  if (move) {
    const [i, d] = move.getAttribute("data-album-move").split(":").map(Number);
    const j = i + d;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  }
  if (remove) list.splice(Number(remove.getAttribute("data-album-remove")), 1);
  if (add || move || remove) renderAlbumTracks();
});
$("deleteAlbum").addEventListener("click", guarded(async () => {
  if (!editingAlbum || !confirm("Delete this album? Its tracks stay in your releases.")) return;
  const id = editingAlbum.id;
  try {
    await saveSettings((s) => { s.albums = (s.albums || []).filter((a) => a && a.id !== id); });
    closeAlbum();
    if (window.MCC_TRACK) window.MCC_TRACK("creator_album_deleted", {});
  } catch (err) { status("albumStatus", err.message || "Could not delete the album.", "bad"); }
}));
$("albumForm").addEventListener("submit", guarded(async (e) => {
  e.preventDefault();
  if (!editingAlbum) return;
  const save = $("saveAlbum");
  let coverUpload = null;
  try {
    save.disabled = true;
    const cover = $("albumCover").files[0] || null;
    if (cover) {
      status("albumStatus", "Uploading cover…");
      const path = await uploadGrant("creator-artwork", cover);
      coverUpload = { bucket: "creator-artwork", path };
      editingAlbum.cover_url = publicUrl("creator-artwork", path);
    }
    const album = PAGE.normalizeAlbum(Object.assign({}, editingAlbum, {
      title: $("albumTitle").value,
      kind: $("albumKind").value,
      release_date: $("albumDate").value,
      description: $("albumDescription").value
    }));
    if (!album) throw new Error("Give the album a title.");
    status("albumStatus", "Saving album…");
    const feature = $("albumFeatured").checked;
    await saveSettings((s) => {
      const list = Array.isArray(s.albums) ? s.albums.slice() : [];
      const at = list.findIndex((a) => a && a.id === album.id);
      if (at >= 0) list[at] = album;
      else {
        if (PAGE.normalizeAlbums({ albums: list }).length >= PAGE.MAX_ALBUMS) throw new Error("You have the most albums a page can hold (" + PAGE.MAX_ALBUMS + ").");
        list.push(album);
      }
      s.albums = list;
      if (feature) s.featured_album = album.id;
      else if (s.featured_album === album.id) delete s.featured_album;
    });
    closeAlbum();
    status("albumStatus", "Album saved.", "good");
    if (window.MCC_TRACK) window.MCC_TRACK("creator_album_saved", { tracks: album.tracks.length, kind: album.kind });
  } catch (err) {
    /* Remove the new cover only when no saved album uses it: the save may
       have committed even though its response was lost. */
    if (coverUpload) {
      try {
        const rows = await rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(mUid) + "&select=settings&limit=1");
        const url = publicUrl(coverUpload.bucket, coverUpload.path);
        const inUse = PAGE.normalizeAlbums(rows?.[0]?.settings).some((a) => a.cover_url === url);
        if (!inUse) await removeUpload(coverUpload.bucket, coverUpload.path);
      } catch (_) { /* unsure: keep the file */ }
    }
    status("albumStatus", err.message || "Could not save the album.", "bad");
  } finally {
    save.disabled = false;
  }
}));

/* ---------- rate sheet (music_creator_profiles.settings.services) ---------- */

function servicesNow() { return PAGE.normalizeServices(profile && profile.settings); }
function renderServices() {
  const list = $("creatorServices");
  if (!list || !PAGE) return;
  const services = servicesNow();
  if (!profile) { list.innerHTML = '<div class="creator-status">Save your creator profile first.</div>'; return; }
  if (!services.length) { list.innerHTML = '<div class="creator-status">No rates yet.</div>'; return; }
  list.innerHTML = services.map((svc, i) =>
    '<div class="creator-item"><div><b>' + escapeHtml(svc.title) + '</b><small>' + escapeHtml(PAGE.servicePrice(svc)) + '</small></div>' +
    '<span class="creator-rowactions">' +
    '<button type="button" class="creator-mini" data-service-move="' + i + ':-1" aria-label="Move ' + escapeHtml(svc.title) + ' up"' + (i ? '' : ' disabled') + '>↑</button>' +
    '<button type="button" class="creator-mini" data-service-move="' + i + ':1" aria-label="Move ' + escapeHtml(svc.title) + ' down"' + (i < services.length - 1 ? '' : ' disabled') + '>↓</button>' +
    '<button class="creator-btn quiet" type="button" data-edit-service="' + escapeHtml(svc.id) + '">Edit</button></span></div>'
  ).join("");
}
function openService(svc) {
  if (!profile) { status("serviceStatus", "Save your creator profile first.", "bad"); return; }
  editingService = svc ? Object.assign({}, svc) : { id: PAGE.newServiceId() };
  $("serviceForm").hidden = false;
  $("serviceTitle").value = svc ? svc.title : "";
  $("servicePrice").value = svc ? String(svc.price_cents / 100) : "";
  $("serviceUnit").value = svc ? svc.unit : "song";
  $("serviceRoyalty").value = svc && svc.royalty_pct ? String(svc.royalty_pct) : "";
  $("serviceDescription").value = svc ? svc.description : "";
  $("deleteService").hidden = !svc;
  status("serviceStatus", "");
  $("serviceTitle").focus();
}
function closeService() { editingService = null; $("serviceForm").hidden = true; }

$("newService").addEventListener("click", () => openService(null));
$("cancelService").addEventListener("click", () => { closeService(); status("serviceStatus", ""); });
$("creatorServices").addEventListener("click", guarded(async (e) => {
  const edit = e.target.closest("[data-edit-service]");
  const move = e.target.closest("[data-service-move]");
  if (edit) {
    const svc = servicesNow().find((x) => x.id === edit.getAttribute("data-edit-service"));
    if (svc) openService(svc);
    return;
  }
  if (!move) return;
  const [i, d] = move.getAttribute("data-service-move").split(":").map(Number);
  const id = servicesNow()[i]?.id;
  try {
    await saveSettings((s) => {
      const list = PAGE.normalizeServices(s);
      const at = list.findIndex((x) => x.id === id);
      const to = at + d;
      if (at >= 0 && to >= 0 && to < list.length) [list[at], list[to]] = [list[to], list[at]];
      s.services = list;
    });
  } catch (err) { status("serviceStatus", err.message || "Could not reorder your rates.", "bad"); }
}));
$("deleteService").addEventListener("click", guarded(async () => {
  if (!editingService || !confirm("Delete this rate from your page?")) return;
  const id = editingService.id;
  try {
    await saveSettings((s) => { s.services = (s.services || []).filter((x) => x && x.id !== id); });
    closeService();
    status("serviceStatus", "Rate deleted.", "good");
  } catch (err) { status("serviceStatus", err.message || "Could not delete the rate.", "bad"); }
}));
$("serviceForm").addEventListener("submit", guarded(async (e) => {
  e.preventDefault();
  if (!editingService) return;
  const save = $("saveService");
  try {
    save.disabled = true;
    const svc = PAGE.normalizeService({
      id: editingService.id,
      title: $("serviceTitle").value,
      price_cents: Math.round(Number($("servicePrice").value) * 100),
      unit: $("serviceUnit").value,
      royalty_pct: Number($("serviceRoyalty").value || 0),
      description: $("serviceDescription").value
    });
    if (!svc) throw new Error("Give the rate a name and a price between $1 and $100,000.");
    status("serviceStatus", "Saving rate…");
    await saveSettings((s) => {
      const list = Array.isArray(s.services) ? s.services.slice() : [];
      const at = list.findIndex((x) => x && x.id === svc.id);
      if (at >= 0) list[at] = svc;
      else {
        if (PAGE.normalizeServices({ services: list }).length >= PAGE.MAX_SERVICES) throw new Error("A rate sheet holds up to " + PAGE.MAX_SERVICES + " rates.");
        list.push(svc);
      }
      s.services = list;
    });
    closeService();
    status("serviceStatus", "Rate saved: " + PAGE.servicePrice(svc) + ".", "good");
    if (window.MCC_TRACK) window.MCC_TRACK("creator_rate_saved", { unit: svc.unit, royalty: svc.royalty_pct > 0 });
  } catch (err) {
    status("serviceStatus", err.message || "Could not save the rate.", "bad");
  } finally {
    save.disabled = false;
  }
}));

/* Profile photo and front-page photo: uploaded to creator-artwork once the
   profile exists (an upload grant needs an active creator profile). */
async function uploadProfileImages() {
  const avatar = $("creatorAvatarFile").files[0] || null;
  const banner = $("creatorBannerFile").files[0] || null;
  if (!avatar && !banner) return;
  const patch = {};
  if (avatar) { status("profileStatus", "Uploading profile photo…"); patch.avatar_url = publicUrl("creator-artwork", await uploadGrant("creator-artwork", avatar)); }
  if (banner) { status("profileStatus", "Uploading front-page photo…"); patch.banner_url = publicUrl("creator-artwork", await uploadGrant("creator-artwork", banner)); }
  await rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(mUid), {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch)
  });
  $("creatorAvatarFile").value = "";
  $("creatorBannerFile").value = "";
}

function parseLyricCtas(raw) {
  return String(raw || "").split(/\r?\n/).map(function(line) {
    var parts=line.split("|").map(function(x){return x.trim();});
    if(parts.length<3 || !parts[0] || !parts[2]) return null;
    return { match: parts[0].slice(0,240), label:(parts[1]||"Open service").slice(0,100), href:parts.slice(2).join("|").trim().slice(0,2000) };
  }).filter(Boolean).slice(0,24);
}
function experienceFromForm() {
  var serviceUrl=$("trackServiceUrl").value.trim();
  return {
    theme:{
      accent:$("trackAccent").value,
      background:$("trackBackground").value,
      foreground:$("trackForeground").value,
      surface:$("trackSurface").value
    },
    commerce:serviceUrl ? { label:$("trackServiceLabel").value.trim() || "Take the next step", href:serviceUrl } : {},
    lyric_ctas:parseLyricCtas($("trackLyricCtas").value)
  };
}

$("profileForm").addEventListener("submit", guarded(async (e) => {
  e.preventDefault();
  try {
    status("profileStatus", "Saving…");
    const body = {
      m_uid: mUid,
      handle: $("creatorHandle").value.trim().toLowerCase(),
      artist_name: $("creatorName").value.trim(),
      bio: $("creatorBio").value.trim(),
      website_url: $("creatorWebsite").value.trim(),
      terms_version: "music-creator-v1",
      terms_accepted_at: new Date().toISOString()
    };
    const theme = {
      accent: $("creatorAccent").value,
      background: $("creatorBackground").value,
      foreground: $("creatorForeground").value,
      surface: $("creatorSurface").value
    };
    if (profile) {
      /* The profile fields, then the colours through saveSettings: this form
         never writes back its own (possibly old) copy of the albums and rates. */
      await rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(mUid), {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body)
      });
      await saveSettings((s) => { s.experience_theme = theme; });
    } else {
      await rest("music_creator_profiles", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify(Object.assign(body, { settings: { experience_theme: theme } }))
      });
    }
    await loadProfile();
    await uploadProfileImages();
    await loadProfile();
    status("profileStatus", "Creator profile saved.", "good");
    if (window.MCC_TRACK) window.MCC_TRACK("creator_profile_saved", {});
  } catch (err) {
    status("profileStatus", err.message || "Could not save profile.", "bad");
  }
}));

$("isDerivative").addEventListener("change", () => {
  $("derivativeField").hidden = !$("isDerivative").checked;
});
$("trackAccess").addEventListener("change", () => {
  $("previewHelp").textContent = $("trackAccess").value === "public"
    ? "Optional. If omitted, the master is also published as the public audio."
    : "Required for account-only and licensable tracks.";
});

$("trackForm").addEventListener("submit", guarded(async (e) => {
  e.preventDefault();
  const submit = $("submitTrack");
  /* Lock before the asynchronous duration probe, not after it: two quick
     submits used to upload and create the same release twice. Keep these
     fields stable while the upload runs, restoring their prior state later. */
  if (submit.disabled) return;
  submit.disabled = true;
  const form = $("trackForm");
  const fields = Array.from(form.elements).filter((el) => el !== submit);
  const disabledBefore = fields.map((el) => el.disabled);
  fields.forEach((el) => { el.disabled = true; });
  form.setAttribute("aria-busy", "true");
  const uploaded = [];
  let createdTrackId = null;
  let committed = false;
  try {
    if (!profile) throw new Error("Save your creator profile first.");
    const master = $("trackMaster").files[0];
    let preview = $("trackPreview").files[0] || null;
    const art = $("trackArt").files[0] || null;
    const access = $("trackAccess").value;
    if (!master) throw new Error("Choose the master audio.");
    if (access !== "public" && !preview) throw new Error("Account-only and licensable tracks need a public preview file.");
    if (access === "public" && !preview) preview = master;
    const derivative = $("isDerivative").checked;
    if (derivative && !$("derivativePermissions").value.trim()) {
      throw new Error("Describe the underlying work and your derivative/parody rights basis.");
    }

    // Validate metadata, rights and all file sizes before transferring any bytes.
    const title = $("trackTitle").value.trim();
    const artist = $("trackArtist").value.trim() || profile.artist_name;
    if (!title) throw new Error("Add a song title.");
    if (!artist) throw new Error("Add an artist name.");
    const description = $("trackDescription").value.trim();
    const albumId = $("trackAlbum").value;
    const lyricSheet = $("trackLyricSheet")?.value || "";
    const genre = $("trackGenre").value.trim();
    const musicVideo = $("trackMusicVideo").value.trim();
    const lyricsUrl = $("trackLyricsUrl").value.trim();
    const experience = experienceFromForm();
    const price = Math.round(Number($("licensePrice").value || 0) * 100);
    const licenseTerms = $("licenseTerms").value.trim();
    const licenseTitle = $("licenseTitle").value.trim() || "Commercial license";
    const rights = {
      owns_master: $("ownsMaster").checked,
      controls_composition: $("controlsComposition").checked,
      samples_cleared: $("samplesCleared").checked,
      collaborators_cleared: $("collaboratorsCleared").checked,
      parody_or_derivative: derivative,
      derivative_permissions: $("derivativePermissions").value.trim()
    };
    for (const [bucket, file] of [["creator-masters", master], ["creator-previews", preview], ["creator-artwork", art]]) {
      if (!file) continue;
      const limit = BUCKET_MAX_BYTES[bucket];
      if (limit && file.size > limit) {
        throw new Error(`${file.name} is ${describeSize(file.size, true)}. Maximum: ${describeSize(limit)}.`);
      }
      if (!file.size) throw new Error(`${file.name} is empty. Choose a valid file.`);
    }
    if (!rights.owns_master) throw new Error("Confirm your rights to the master recording.");
    if (!rights.controls_composition) throw new Error("Confirm your rights to distribute the composition.");
    if (!rights.samples_cleared) throw new Error("Confirm that samples are cleared, or none are used.");
    if (!rights.collaborators_cleared) throw new Error("Confirm collaborator permissions before submitting.");
    if (!$("releaseTerms").checked) throw new Error("Accept the release terms before submitting.");
    if (price > 0 && !licenseTerms) throw new Error("Add terms for the commercial license, or clear its price.");
    const dur = await durationMs(master);
    if (!Number.isFinite(dur) || dur <= 0) throw new Error("The master audio could not be read. Try a supported audio file.");

    status("trackStatus", "Uploading private master…");
    const masterPath = await uploadGrant("creator-masters", master);
    uploaded.push({ bucket: "creator-masters", path: masterPath });

    status("trackStatus", "Uploading listener audio…");
    const previewPath = await uploadGrant("creator-previews", preview);
    uploaded.push({ bucket: "creator-previews", path: previewPath });
    const previewUrl = publicUrl("creator-previews", previewPath);

    let posterUrl = "";
    if (art) {
      status("trackStatus", "Uploading artwork…");
      const artPath = await uploadGrant("creator-artwork", art);
      uploaded.push({ bucket: "creator-artwork", path: artPath });
      posterUrl = publicUrl("creator-artwork", artPath);
    }

    const slug = slugify(title) + "-" + Math.random().toString(36).slice(2, 7);

    status("trackStatus", "Writing release record…");
    const inserted = await rest("creator_tracks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        title,
        artist,
        slug,
        description,
        audio_url: previewUrl,
        poster_url: posterUrl,
        public: access === "public",
        status: "draft",
        access_mode: access,
        preview_bucket: "creator-previews",
        preview_path: previewPath,
        master_bucket: "creator-masters",
        master_path: masterPath,
        duration_ms: dur,
        genre,
        music_video_url: musicVideo,
        lyrics_url: lyricsUrl,
        experience,
        rights_status: "incomplete",
        rights_declaration: rights
      })
    });
    const track = inserted?.[0];
    if (!track?.id) throw new Error("Release record was not returned.");
    createdTrackId = track.id;
    const lyricOutcome = await attachLyricSheet(track.id, lyricSheet);

    await rest("music_rights_attestations", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        track_id: track.id,
        owns_master: rights.owns_master,
        controls_composition: rights.controls_composition,
        samples_cleared: rights.samples_cleared,
        collaborators_cleared: rights.collaborators_cleared,
        parody_or_derivative: rights.parody_or_derivative,
        derivative_permissions: rights.derivative_permissions,
        notes: description
      })
    });

    await rest("creator_tracks?id=eq." + encodeURIComponent(track.id), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "pending_review", rights_status: "attested", rights_declaration: rights })
    });

    committed = true;
    let licenseWarning = "";
    if (price > 0 && licenseTerms) {
      try { await rest("music_license_offers", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          track_id: track.id,
          slug: "commercial-" + Math.random().toString(36).slice(2, 7),
          title: licenseTitle,
          license_type: "commercial_basic",
          price_cents: price,
          currency: "usd",
          terms_text: licenseTerms,
          usage_terms: { source: "creator_studio_v1" },
          active: false,
          checkout_enabled: false
        })
      }); } catch (licenseErr) {
        licenseWarning = " Release submitted, but the license offer was not saved: " + (licenseErr.message || "try adding it again later.");
        if (window.MCC_TRACK) window.MCC_TRACK("creator_license_offer_failed", { track_id: track.id });
      }
    }

    let albumWarning = "";
    if (albumId) {
      try {
        await saveSettings((s) => {
          const a = (s.albums || []).find((x) => x && x.id === albumId);
          if (!a) throw new Error("That album was removed while the release uploaded.");
          if (!Array.isArray(a.tracks)) a.tracks = [];
          const id = String(track.id).toLowerCase();
          if (a.tracks.includes(id)) return;
          if (a.tracks.length >= PAGE.MAX_TRACKS) throw new Error("That album has reached its track limit.");
          a.tracks.push(id);
        });
      } catch (albumErr) {
        albumWarning = " It was not added to the album: " + (albumErr.message || "add it from Your albums.");
      }
    }
    licenseWarning += albumWarning;

    $("trackForm").reset();
    $("trackAccess").value = "account";
    if (profile) {
      var baseTheme = profile.settings && profile.settings.experience_theme || {};
      $("trackAccent").value = baseTheme.accent || "#e5383b";
      $("trackBackground").value = baseTheme.background || "#090706";
      $("trackForeground").value = baseTheme.foreground || "#f4efe6";
      $("trackSurface").value = baseTheme.surface || "#17110f";
    }
    $("derivativeField").hidden = true;
    status("trackStatus", (derivative
      ? "Uploaded. Held for manual derivative/parody rights review."
      : "Uploaded. Submitted for rights and publication review.") + licenseWarning + lyricSheetNote(lyricOutcome), licenseWarning || lyricOutcome === "lost" ? "bad" : "good");
    try { await loadTracks(); }
    catch (_) {
      status("trackStatus", "Release submitted." + licenseWarning + " Your releases could not refresh. Reload to see it before uploading again.", "bad");
    }
    if (window.MCC_TRACK) window.MCC_TRACK("creator_track_submitted", { track_id: track.id, access_mode: access, derivative });
  } catch (err) {
    if (!committed && (createdTrackId || uploaded.length)) {
      status("trackStatus", "That submission failed. Cleaning up the partial release…", "bad");
      const cleanupFailures = await rollbackRelease(createdTrackId, uploaded);
      const kept = cleanupFailures.some((f) => f.startsWith("files kept"));
      status("trackStatus", (err.message || "Upload failed.") + (kept
        ? " It may have been submitted after all: check Your releases before uploading it again."
        : cleanupFailures.length ? " Some cleanup also needs attention." : " Nothing partial was kept."), "bad");
      if (kept) { try { await loadTracks(); } catch (_) { /* the list refreshes on the next load */ } }
    } else {
      status("trackStatus", err.message || "Upload failed.", "bad");
    }
  } finally {
    fields.forEach((el, i) => { el.disabled = disabledBefore[i]; });
    form.removeAttribute("aria-busy");
    submit.disabled = false;
  }
}));

/* ---------- onboarding: one click, shown only until the server says creator ---------- */

const ONBOARD = window.MCC_CREATOR_ONBOARD;
let onboardState = null;

/* The two calls live in js/creator-onboarding.js (ONBOARD.client), shared with every
   "Become a creator" door on the site: the server functions, or while they are not
   applied the same answer built from the member's own rows, with the same two writes
   (the picture from the member's profile included). */
function onboardClient() {
  /* the token travels with each call (studioFetch), so the client is handed none of its own */
  return ONBOARD.client({ token: "", mUid, userId: session?.user?.id || "", fetch: studioFetch });
}
async function creatorState() {
  return onboardClient().state();
}
async function becomeCreator(input) {
  return onboardClient().become(input);
}

function paintAvatar(el, url, name) {
  el.replaceChildren();
  const safe = PAGE.safeArtwork(url);
  const initial = () => { el.textContent = (String(name || "").trim().charAt(0) || "♪").toUpperCase(); };
  if (safe) {
    const img = document.createElement("img");
    img.src = safe; img.alt = ""; img.decoding = "async";
    /* a picture that will not load (removed from storage) shows the initial, never a broken image */
    img.onerror = () => { if (img.parentNode === el) { el.replaceChildren(); initial(); } };
    el.append(img);
  } else {
    initial();
  }
}
function paintOnboard(state) {
  onboardState = state;
  const pre = state.prefill || {};
  const ask = ONBOARD.askFor(state);
  const name = pre.artist_name || "";
  const handle = pre.handle || "";
  /* the member's own picture, the one their artist page starts with */
  paintAvatar($("cobAvatar"), pre.avatar_url || "", name || handle);
  $("cobName").textContent = name || "Your artist page";
  $("cobHandle").textContent = handle ? "@" + handle : "";
  const nameField = $("cobNameField");
  nameField.hidden = ask.indexOf("artist_name") < 0;
  const handleField = $("cobHandleField");
  handleField.hidden = ask.indexOf("handle") < 0;
  if (!handleField.hidden) {
    const problem = state.problems && state.problems.handle;
    if (problem) handleField.dataset.problem = problem; else delete handleField.dataset.problem;
    if (!$("cobHandleInput").value || problem === "taken") $("cobHandleInput").value = pre.handle_suggestion || "";
    $("cobHandleHelp").textContent = ONBOARD.handleHelp(state);
    if (!handle && $("cobHandleInput").value) $("cobHandle").textContent = "@" + ONBOARD.normalizeHandle($("cobHandleInput").value);
  }
}
function paintSummary() {
  const box = $("creatorSummary");
  if (!profile) { box.hidden = true; return; }
  box.hidden = false;
  paintAvatar($("cmeAvatar"), profile.avatar_url, profile.artist_name);
  $("cmeName").textContent = profile.artist_name || "";
  $("cmeHandle").textContent = "@" + (profile.handle || "") + (profile.status && profile.status !== "active" ? " · " + profile.status : "");
  $("cmePage").href = "music-creator.html?handle=" + encodeURIComponent(profile.handle || "");
  $("cmeEdit").href = ONBOARD.EDIT_URL;
}
async function showStudio(editing) {
  $("creatorOnboard").hidden = true;
  $("creatorApp").hidden = false;
  /* the profile form is the EDIT screen now: shown only when asked for */
  $("creatorIdentity").hidden = !editing;
  await loadProfile();
  paintSummary();
  if (editing) {
    $("creatorSummary").hidden = true;
    $("creatorIdentity").scrollIntoView({ block: "start" });
  }
  await loadTracks();
}

$("cobForm").addEventListener("submit", guarded(async (e) => {
  e.preventDefault();
  const go = $("cobGo");
  const say = (msg, tone) => { $("cobStatus").textContent = msg || ""; if (tone) $("cobStatus").dataset.tone = tone; else delete $("cobStatus").dataset.tone; };
  const ask = ONBOARD.askFor(onboardState);
  const input = {};
  if (ask.indexOf("artist_name") >= 0) {
    input.artist_name = $("cobNameInput").value.trim();
    if (!input.artist_name) { say("Add your artist name.", "bad"); $("cobNameInput").focus(); return; }
  }
  if (ask.indexOf("handle") >= 0) {
    input.handle = ONBOARD.normalizeHandle($("cobHandleInput").value);
    if (!ONBOARD.validHandle(input.handle)) {
      $("cobHandleField").dataset.problem = "invalid";
      $("cobHandleHelp").textContent = ONBOARD.handleHelp({ problems: { handle: "invalid" } });
      $("cobHandleInput").focus(); return;
    }
  }
  go.disabled = true;
  say("Making your page…");
  try {
    const state = await becomeCreator(input);
    if (state && state.creator) {
      if (window.MCC_TRACK) window.MCC_TRACK("creator_onboarded", { created: !!state.created });
      say("");
      await showStudio(false);
      /* the analytics card asked before this member was a creator */
      if ($("selfMusicRefresh")) $("selfMusicRefresh").click();
      return;
    }
    paintOnboard(Object.assign({}, state, {
      prefill: Object.assign({}, onboardState.prefill, state.prefill, input.artist_name ? { artist_name: input.artist_name } : {})
    }));
    say(state && state.problems && state.problems.handle === "taken" ? "That handle is taken. Pick another." : "Add what's missing, then try again.", "bad");
  } catch (err) {
    say(err.message || "Could not make your page. Try again.", "bad");
  } finally {
    go.disabled = false;
  }
}));

/* the card is a live preview: what they type is what their page will say */
$("cobNameInput").addEventListener("input", () => {
  const v = $("cobNameInput").value.trim();
  $("cobName").textContent = v || onboardState?.prefill?.artist_name || "Your artist page";
  paintAvatar($("cobAvatar"), onboardState?.prefill?.avatar_url || "", v);
});
$("cobHandleInput").addEventListener("input", () => {
  /* the @ is drawn in the field; a typed one is dropped */
  if ($("cobHandleInput").value.charAt(0) === "@") $("cobHandleInput").value = $("cobHandleInput").value.replace(/^@+/, "");
  const v = ONBOARD.normalizeHandle($("cobHandleInput").value);
  $("cobHandle").textContent = v ? "@" + v : "";
  delete $("cobHandleField").dataset.problem;
  $("cobHandleHelp").textContent = ONBOARD.handleHelp({});
});

/* WHOEVER IS SIGNED IN NOW (music slice M4; accounts lane ACC-1). A sign-in or sign-out in another tab used to leave
   this page as it was: "Sign in to publish." to a member who had just signed in, the open studio to someone who had
   just signed out. The page now follows the account stored for this site: what the previous account loaded is taken
   off the screen, and the studio opens again for whoever is signed in now, or closes to "Sign in to publish.". */
const GATE_TEXT = $("creatorGate").querySelector("p").textContent;
let boots = 0;
function closeStudio() {
  session = null; mUid = null; account = null; profile = null; tracksCache = []; onboardState = null;
  /* the editor forgets the previous account's lyrics and audio */
  if (lyricsBound && window.CR && window.CR.lyricsReview) { const a = window.CR.lyricsReview.state.audio; if (a) a.pause(); window.CR.lyricsReview.configure(lyricsSource); }
  if ($("creatorLyrics")) $("creatorLyrics").hidden = true;
  distOpen = null; if ($("creatorDist")) { $("creatorDist").hidden = true; $("distForm").reset(); $("distStatus").textContent = ""; $("distCheck").replaceChildren(); $("distCredits").replaceChildren(); $("distSplits").replaceChildren(); }
  editingAlbum = null; editingService = null;
  $("creatorOnboard").hidden = true;
  $("creatorApp").hidden = true;
  $("creatorSummary").hidden = true;
  $("creatorIdentity").hidden = true;
  $("albumForm").hidden = true;
  $("serviceForm").hidden = true;
  ["profileForm", "trackForm", "albumForm", "serviceForm", "cobForm"].forEach((id) => { const f = $(id); if (f && f.reset) f.reset(); });
  ["creatorTracks", "creatorAlbums", "creatorServices"].forEach((id) => { const n = $(id); if (n) n.replaceChildren(); });
  ["profileStatus", "trackStatus", "albumStatus", "serviceStatus", "cobStatus"].forEach((id) => { const n = $(id); if (n) n.textContent = ""; });
  $("publicProfile").hidden = true;
  $("creatorGate").querySelector("p").textContent = GATE_TEXT;
  $("creatorGate").hidden = false;
}
async function boot() {
  const run = ++boots;
  try {
    const ok = await authed();
    const state = ok ? await creatorState() : null;
    if (run !== boots) return;
    const v = ONBOARD.view({ signedIn: ok, state, editing: ONBOARD.wantsEdit(location.search) });
    if (v === "signin") return;
    if (v === "onboard") {
      /* ONE SIGN-UP (owner, 2026-10-20): a profile that is not done goes through the three pages on the World,
         which come back here for the one tap; nothing is asked twice on this page */
      const done = await ONBOARD.profileDone({ token: "", fetch: studioFetch });
      if (run !== boots) return;
      if (done === false) { location.replace(ONBOARD.FINISH_URL); return; }
    }
    $("creatorGate").hidden = true;
    if (v === "onboard") {
      paintOnboard(state);
      $("creatorOnboard").hidden = false;
      return;
    }
    await showStudio(v === "edit");
  } catch (err) {
    if (run !== boots) return;
    $("creatorGate").hidden = false;
    $("creatorGate").querySelector("p").textContent = err.message || "Could not open Creator Studio.";
  }
}
boot();
if (window.MCC.onAccountChange) {
  window.MCC.onAccountChange(() => {
    account = null;
    if (running) { reopenWhenDone = true; return; }
    closeStudio();
    boot();
  });
}
