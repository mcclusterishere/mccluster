/* IDENTITY CAPTURE: the rules the verification page follows, kept free of
   the DOM so node --test can check them (scripts/test/identity-verification-levels.test.mjs).
   docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md

   LIVE ONLY. A video must come from the camera, now: getUserMedia, recorded
   with MediaRecorder on this page while the server's challenge phrase is on
   screen. There is no file picker and no path that reads a file from disk;
   a stream without a live video track is refused before recording starts.
   The challenge is issued by the database (identity_start_submission) and
   expires in ten minutes, so a clip recorded earlier cannot carry it. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCC_IDENTITY_CAPTURE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LEVELS = {
    v1_live_intro: { key: "v1_live_intro", label: "Live introduction", maxSeconds: 60 },
    v2_halo_full: { key: "v2_halo_full", label: "Full Hitman's Halo access", maxSeconds: 120 },
    /* asking to change a locked profile detail (js/profile-edit-gate.js) */
    profile_edit: { key: "profile_edit", label: "Profile change request", maxSeconds: 120 }
  };
  var MIN_SECONDS = 3;
  var MAX_BYTES = 52428800;
  /* Chrome, Firefox and Android record webm; Safari and iOS record mp4. */
  var MIME_PREFERENCE = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];

  function baseMime(m) { return String(m || "").split(";")[0].trim().toLowerCase(); }

  function pickMimeType(isTypeSupported) {
    for (var i = 0; i < MIME_PREFERENCE.length; i++) {
      try { if (isTypeSupported(MIME_PREFERENCE[i])) return MIME_PREFERENCE[i]; } catch (e) { /* keep looking */ }
    }
    return null;
  }

  /* The stream must be a live camera stream: at least one video track whose
     readyState is "live" and which is enabled. Anything else (no stream, an
     ended track, an audio-only stream) is refused. */
  function assertLiveStream(stream) {
    if (!stream || typeof stream.getVideoTracks !== "function") throw new Error("No live camera stream. Allow the camera and try again.");
    var tracks = stream.getVideoTracks();
    var live = tracks.filter(function (t) { return t && t.readyState === "live" && t.enabled !== false; });
    if (!live.length) throw new Error("The camera is not live. Allow the camera and try again.");
    return live[0];
  }

  function firstLast(name) {
    var n = String(name || "").trim().replace(/\s+/g, " ");
    return n.length >= 2 && n.indexOf(" ") > 0 ? n : null;
  }

  /* What the person says on camera, line by line. */
  function scriptLines(level, name, phrase, accessRequest) {
    var lines = ["My name is " + (firstLast(name) || "[your first and last name]") + ".", "My code is: " + phrase + ".",
      "I promise that this is who I am."];
    if (level === "v2_halo_full") lines.push("I want access to " + (String(accessRequest || "").trim() || "[what you want access to]") + ", and here is why…");
    return lines;
  }

  /* The consent text as paragraphs, with the owner's N filled in. */
  function consentParagraphs(body, retentionDays) {
    var n = Number(retentionDays);
    var text = String(body || "").replace(/\[N\]/g, Number.isInteger(n) && n > 0 ? String(n) : "[N]");
    return text.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  /* Can we ask the server for a challenge? Mirrors identity_start_submission. */
  function validateStart(input) {
    var i = input || {};
    if (!LEVELS[i.level]) return { ok: false, error: "Unknown verification level." };
    if (!i.consentVersion || !i.consentAccepted) return { ok: false, error: "Read the consent and tick the box to agree before recording." };
    if (!firstLast(i.name)) return { ok: false, error: "Type your first and last name." };
    if (i.level === "v1_live_intro" && !i.locationConsent) return { ok: false, error: "Agree to share your broad region (never an exact location)." };
    if (i.level === "v2_halo_full" && String(i.accessRequest || "").trim().length < 3) return { ok: false, error: "Say what you want access to." };
    return { ok: true };
  }

  /* Is a finished recording acceptable to send? Mirrors identity_finish_submission. */
  function validateRecording(rec) {
    var r = rec || {};
    var level = LEVELS[r.level];
    if (!level) return { ok: false, error: "Unknown verification level." };
    if (r.source !== "getUserMedia") return { ok: false, error: "Only a live camera recording can be sent." };
    if (!(r.size > 0)) return { ok: false, error: "The recording is empty. Record again." };
    if (r.size > MAX_BYTES) return { ok: false, error: "The recording is too large. Record a shorter video." };
    if (["video/webm", "video/mp4"].indexOf(baseMime(r.mime)) < 0) return { ok: false, error: "This browser recorded an unsupported video type." };
    if (!(r.durationMs >= MIN_SECONDS * 1000)) return { ok: false, error: "Record for at least " + MIN_SECONDS + " seconds." };
    if (r.durationMs > level.maxSeconds * 1000 + 2000) return { ok: false, error: "Keep it under " + level.maxSeconds + " seconds." };
    if (r.challengeExpiresAt && Date.parse(r.challengeExpiresAt) < (r.now || Date.now())) return { ok: false, error: "Your code expired. Start again for a new one." };
    return { ok: true };
  }

  function captureMeta(track, recorderMime, facing) {
    return { source: "getUserMedia", track_state: track && track.readyState === "live" ? "live" : "ended",
      challenge_shown: true, recorder_mime: String(recorderMime || "").slice(0, 80), facing: facing || "user" };
  }

  function ageLabel(hours) {
    var h = Number(hours) || 0;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + " min";
    if (h < 48) return Math.round(h) + " h";
    return Math.round(h / 24) + " days";
  }

  return { LEVELS: LEVELS, MIN_SECONDS: MIN_SECONDS, MAX_BYTES: MAX_BYTES, MIME_PREFERENCE: MIME_PREFERENCE,
    baseMime: baseMime, pickMimeType: pickMimeType, assertLiveStream: assertLiveStream, scriptLines: scriptLines,
    consentParagraphs: consentParagraphs, validateStart: validateStart, validateRecording: validateRecording,
    captureMeta: captureMeta, firstLast: firstLast, ageLabel: ageLabel };
});
