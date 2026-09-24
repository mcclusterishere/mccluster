import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
const KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
const supabase = createClient(SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const $ = (id) => document.getElementById(id);
let session = null;
let mUid = null;
let profile = null;

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
    "&select=m_uid,handle,artist_name,bio,website_url,status,verification_state,payout_state&limit=1");
  profile = rows?.[0] || null;
  if (!profile) return;
  $("creatorHandle").value = profile.handle || "";
  $("creatorName").value = profile.artist_name || "";
  $("creatorBio").value = profile.bio || "";
  $("creatorWebsite").value = profile.website_url || "";
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
    "&select=id,title,artist,status,rights_status,access_mode,genre,moderation_note,created_at,published_at&order=created_at.desc");
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
    if (profile) {
      await rest("music_creator_profiles?m_uid=eq." + encodeURIComponent(mUid), {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body)
      });
    } else {
      await rest("music_creator_profiles", {
        method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body)
      });
    }
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

    status("trackStatus", "Uploading listener audio…");
    const previewPath = await uploadGrant("creator-previews", preview);
    const previewUrl = publicUrl("creator-previews", previewPath);

    let posterUrl = "";
    if (art) {
      status("trackStatus", "Uploading artwork…");
      const artPath = await uploadGrant("creator-artwork", art);
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
        rights_status: "incomplete",
        rights_declaration: rights
      })
    });
    const track = inserted?.[0];
    if (!track?.id) throw new Error("Release record was not returned.");

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

    const price = Math.round(Number($("licensePrice").value || 0) * 100);
    const licenseTerms = $("licenseTerms").value.trim();
    if (price > 0 && licenseTerms) {
      await rest("music_license_offers", {
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
      });
    }

    $("trackForm").reset();
    $("trackAccess").value = "account";
    $("derivativeField").hidden = true;
    status("trackStatus", derivative
      ? "Uploaded. Held for manual derivative/parody rights review."
      : "Uploaded. Submitted for rights and publication review.", "good");
    await loadTracks();
    if (window.MCC_TRACK) window.MCC_TRACK("creator_track_submitted", { track_id: track.id, access_mode: access, derivative });
  } catch (err) {
    status("trackStatus", err.message || "Upload failed.", "bad");
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