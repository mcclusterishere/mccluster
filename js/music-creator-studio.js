import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
async function authed() {
  session = await window.MCC.refreshIfNeeded();
  if (!session?.access_token) return false;
  mUid = await window.MCC.mUid();
  return Boolean(mUid);
}
async function rest(path, init = {}) {
  const headers = {
    apikey: KEY,
    authorization: "Bearer " + session.access_token,
    "content-type": "application/json",
    ...(init.headers || {})
  };
  const res = await fetch(SB + "/rest/v1/" + path, { ...init, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.hint || ("Request failed " + res.status);
    throw new Error(msg);
  }
  return data;
}
async function fn(action, body = {}) {
  const res = await fetch(SB + "/functions/v1/music-access", {
    method: "POST",
    headers: {
      apikey: KEY,
      authorization: "Bearer " + session.access_token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ action, ...body })
  });
  const data = await res.json().catch(() => ({}));
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
   files behind. Each removal uses a client carrying the creator's token. */
function ownerStorage() {
  return createClient(SB, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + session.access_token } }
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
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      const ms = Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : null;
      URL.revokeObjectURL(u); resolve(ms);
    };
    a.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
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
    "&select=id,title,artist,status,rights_status,access_mode,genre,poster_url,duration_ms,music_video_url,lyrics_url,experience,moderation_note,created_at,published_at&order=created_at.desc");
  tracksCache = rows || [];
  renderAlbums();
  const list = $("creatorTracks");
  if (!rows?.length) {
    list.innerHTML = '<div class="creator-status">No releases yet.</div>';
    return;
  }
  list.innerHTML = rows.map((t) =>
    '<div class="creator-item"><div><b>' + escapeHtml(t.title) + '</b><small>' +
    escapeHtml([t.artist, t.genre, t.access_mode].filter(Boolean).join(" · ")) +
    (t.moderation_note ? '<br>' + escapeHtml(t.moderation_note) : '') +
    '</small></div><span class="' + pillClass(t) + '">' +
    escapeHtml(t.status.replace(/_/g, " ")) + ' · ' + escapeHtml(t.rights_status) + '</span></div>'
  ).join("");
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
$("deleteAlbum").addEventListener("click", async () => {
  if (!editingAlbum || !confirm("Delete this album? Its tracks stay in your releases.")) return;
  const id = editingAlbum.id;
  try {
    await saveSettings((s) => { s.albums = (s.albums || []).filter((a) => a && a.id !== id); });
    closeAlbum();
    if (window.MCC_TRACK) window.MCC_TRACK("creator_album_deleted", {});
  } catch (err) { status("albumStatus", err.message || "Could not delete the album.", "bad"); }
});
$("albumForm").addEventListener("submit", async (e) => {
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
});

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
$("creatorServices").addEventListener("click", async (e) => {
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
});
$("deleteService").addEventListener("click", async () => {
  if (!editingService || !confirm("Delete this rate from your page?")) return;
  const id = editingService.id;
  try {
    await saveSettings((s) => { s.services = (s.services || []).filter((x) => x && x.id !== id); });
    closeService();
    status("serviceStatus", "Rate deleted.", "good");
  } catch (err) { status("serviceStatus", err.message || "Could not delete the rate.", "bad"); }
});
$("serviceForm").addEventListener("submit", async (e) => {
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
});

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

$("profileForm").addEventListener("submit", async (e) => {
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
});

$("isDerivative").addEventListener("change", () => {
  $("derivativeField").hidden = !$("isDerivative").checked;
});
$("trackAccess").addEventListener("change", () => {
  $("previewHelp").textContent = $("trackAccess").value === "public"
    ? "Optional. If omitted, the master is also published as the public audio."
    : "Required for account-only and licensable tracks.";
});

$("trackForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = $("submitTrack");
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

    submit.disabled = true;
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

    const title = $("trackTitle").value.trim();
    const artist = $("trackArtist").value.trim() || profile.artist_name;
    const dur = await durationMs(master);
    const slug = slugify(title) + "-" + Math.random().toString(36).slice(2, 7);
    const rights = {
      owns_master: $("ownsMaster").checked,
      controls_composition: $("controlsComposition").checked,
      samples_cleared: $("samplesCleared").checked,
      collaborators_cleared: $("collaboratorsCleared").checked,
      parody_or_derivative: derivative,
      derivative_permissions: $("derivativePermissions").value.trim()
    };

    status("trackStatus", "Writing release record…");
    const inserted = await rest("creator_tracks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        title,
        artist,
        slug,
        description: $("trackDescription").value.trim(),
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
        genre: $("trackGenre").value.trim(),
        music_video_url: $("trackMusicVideo").value.trim(),
        lyrics_url: $("trackLyricsUrl").value.trim(),
        experience: experienceFromForm(),
        rights_status: "incomplete",
        rights_declaration: rights
      })
    });
    const track = inserted?.[0];
    if (!track?.id) throw new Error("Release record was not returned.");
    createdTrackId = track.id;

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
        notes: $("trackDescription").value.trim()
      })
    });

    await rest("creator_tracks?id=eq." + encodeURIComponent(track.id), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "pending_review", rights_status: "attested", rights_declaration: rights })
    });

    committed = true;
    const price = Math.round(Number($("licensePrice").value || 0) * 100);
    const licenseTerms = $("licenseTerms").value.trim();
    let licenseWarning = "";
    if (price > 0 && licenseTerms) {
      try { await rest("music_license_offers", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          track_id: track.id,
          slug: "commercial-" + Math.random().toString(36).slice(2, 7),
          title: $("licenseTitle").value.trim() || "Commercial license",
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

    const albumId = $("trackAlbum").value;
    let albumWarning = "";
    if (albumId) {
      try {
        await saveSettings((s) => {
          const a = (s.albums || []).find((x) => x && x.id === albumId);
          if (a && Array.isArray(a.tracks) && a.tracks.length < PAGE.MAX_TRACKS) a.tracks.push(String(track.id).toLowerCase());
        });
      } catch (albumErr) {
        albumWarning = " It was not added to the album: add it from Your albums.";
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
      : "Uploaded. Submitted for rights and publication review.") + licenseWarning, licenseWarning ? "bad" : "good");
    await loadTracks();
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
    submit.disabled = false;
  }
});

(async function boot() {
  try {
    const ok = await authed();
    if (!ok) return;
    $("creatorGate").hidden = true;
    $("creatorApp").hidden = false;
    await loadProfile();
    await loadTracks();
  } catch (err) {
    $("creatorGate").hidden = false;
    $("creatorGate").querySelector("p").textContent = err.message || "Could not open Creator Studio.";
  }
})();