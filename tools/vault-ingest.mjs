/* THE VAULT INGEST — a directory of captures goes in, a catalog comes out.
   Runs on the GitHub runner (vault-ingest.yml downloads the batch first):

     node tools/vault-ingest.mjs <dir> <batch-id> <event-id>

   For every file it:
     1. fingerprints (sha256) — a file the vault has seen bounces as a dupe
     2. reads what the camera wrote (exiftool: time, body, lens, GPS, all)
     3. builds web derivatives (1800px preview, 400px thumb) via ffmpeg
     4. stamps the derivatives with IPTC/XMP — creator, copyright, credit,
        catalog id, event — so every copy that leaves carries its papers
     5. asks Gemini what it sees (people are GUESSES until the owner
        confirms them on vault.html — never facts)
     6. uploads derivatives to Supabase Storage, writes the catalog row

   Secrets (GitHub → Settings → Secrets → Actions):
     SUPABASE_SERVICE_ROLE_KEY   required to write
     GEMINI_API_KEY              optional — no key, no analysis, rest works
   Without the service key it dry-runs: prints the whole plan, writes nothing.
*/
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";

const SB_URL = process.env.SUPABASE_URL || "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const AI_KEY = process.env.GEMINI_API_KEY || "";
const AI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DRY = !SB_KEY;

const [, , DIR, BATCH = "manual", EVENT = ""] = process.argv;
if (!DIR || !existsSync(DIR)) {
  console.error("usage: node tools/vault-ingest.mjs <dir> <batch-id> <event-id>");
  process.exit(1);
}

const OWNER = {
  artist: "Matthew McCluster",
  copyright: `© ${new Date().getFullYear()} Matthew McCluster / McCluster Corp. All rights reserved.`,
  credit: "Matthew McCluster / McCluster Corp",
  isni_person: "0000000529563111",
  isni_corp: "0000000528727276",
  plus_id: process.env.PLUS_ID || "",     // set once PLUS supporting membership lands
  web: "https://matthew.mccluster.org/",
};

const PHOTO = /\.(jpe?g|png|webp|tiff?)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const AUDIO = /\.(wav|mp3|m4a|flac)$/i;

const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 64 * 1024 * 1024 });
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": opts.body instanceof Uint8Array ? (opts.type || "application/octet-stream") : "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok && r.status !== 409) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r;
}

function exif(p) {
  try {
    const j = JSON.parse(sh("exiftool", ["-json", "-n", "-fast2", p]).toString())[0] || {};
    return j;
  } catch { return {}; }
}
/* C2PA / Content Credentials. The signature is applied BY THE CAMERA at
   capture (Sony's Camera Authenticity Solution on the A7R V and friends),
   so it is either in the original or it never will be — nothing downstream
   can add a genuine capture claim. All we do is read whether it is there.
   exiftool surfaces the JUMBF block; c2patool would give the full parse. */
function readC2PA(p, x) {
  const has = !!(x.JUMBF || x.JUMBFVersion || x["C2PA"] ||
    Object.keys(x).some((k) => /^C2PA|Jumd|ClaimGenerator/i.test(k)));
  if (!has) return { signed: false, manifest: null };
  const keep = {};
  Object.keys(x).forEach((k) => { if (/JUMBF|C2PA|ClaimGenerator/i.test(k)) keep[k] = x[k]; });
  return { signed: true, manifest: keep };
}

const isoShot = (x) => {
  const s = x.SubSecDateTimeOriginal || x.DateTimeOriginal || x.CreateDate || x.MediaCreateDate;
  if (!s) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(String(s));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : null;
};

/* MCC-20260611-CANDLER-0001 — date of capture, event token, sequence.
   The prefix is ours the way QT6KV is ours for recordings: no registry
   issues photo ids, so the catalog id + embedded IPTC + the copyright
   deposit ARE the identification. */
function catToken(ev) { return (ev || "loose").replace(/[^a-z0-9]+/gi, "").toUpperCase().slice(0, 12) || "LOOSE"; }

async function nextSeq(prefix) {
  if (DRY) return 1;
  const r = await sb(`/rest/v1/vault_assets?select=catalog_id&catalog_id=like.${encodeURIComponent(prefix + "*")}&order=catalog_id.desc&limit=1`);
  const rows = await r.json();
  if (!rows.length) return 1;
  return (parseInt(rows[0].catalog_id.slice(-4), 10) || 0) + 1;
}

async function gemini(thumbPath, roster) {
  if (!AI_KEY) return null;
  const b64 = readFileSync(thumbPath).toString("base64");
  const prompt =
`You are cataloging a professional photographer's frame. Reply ONLY with JSON:
{"caption": one editorial sentence, "scene": 2-4 words, "setting": indoor/outdoor + place type,
 "people_count": int, "people": [{"description": short, "guess": name-from-roster-or-null}],
 "text_visible": any readable signage/text or null, "quality": {"sharp": bool, "exposure": "under|good|over"}}
Roster of people this studio knows (guess ONLY if confident, else null):
${roster.map((p) => `- ${p.name}${p.role ? ` (${p.role}${p.org ? ", " + p.org : ""})` : ""}`).join("\n") || "- (none on file)"}`;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: b64 } }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.1 },
        }) });
    if (!r.ok) { console.log(`   gemini ${r.status} — skipped`); return null; }
    const j = await r.json();
    const txt = j.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return JSON.parse(txt);
  } catch (e) { console.log("   gemini failed —", e.message.slice(0, 80)); return null; }
}

/* ---------- main ---------- */
const files = readdirSync(DIR, { recursive: true })
  .map((f) => join(DIR, String(f)))
  .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
  .filter((p) => PHOTO.test(p) || VIDEO.test(p) || AUDIO.test(p))
  .sort();
console.log(`${files.length} files in ${DIR} · batch=${BATCH} · event=${EVENT || "(none)"} · ${DRY ? "DRY RUN — no service key, writing nothing" : "live"}`);

const roster = DRY ? [] : await (await sb("/rest/v1/vault_people?select=name,role,org&limit=200")).json();
const prefix = `MCC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${catToken(EVENT)}-`;
let seq = await nextSeq(prefix);
let ok = 0, dupes = 0, failed = 0;

for (const p of files) {
  const name = basename(p);
  try {
    const hash = sha256(p);
    if (!DRY) {
      const dupe = await (await sb(`/rest/v1/vault_assets?select=catalog_id&sha256=eq.${hash}&limit=1`)).json();
      if (dupe.length) { console.log(`   dupe (${dupe[0].catalog_id}) — ${name}`); dupes++; continue; }
    }
    const x = exif(p);
    const c2pa = readC2PA(p, x);
    const kind = VIDEO.test(p) ? "video" : AUDIO.test(p) ? "audio" : "photo";
    const cat = `${prefix}${String(seq).padStart(4, "0")}`;

    // derivatives — a video gets a poster thumb, a photo gets both sizes
    const prev = `/tmp/${cat}.jpg`, thumb = `/tmp/${cat}-t.jpg`;
    if (kind === "video") {
      sh("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-i", p, "-vframes", "1", "-vf", "scale='min(1800,iw)':-2", "-q:v", "3", prev]);
    } else {
      sh("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-i", p, "-map_metadata", "-1", "-vf", "scale='min(1800,iw)':-2", "-q:v", "3", prev]);
    }
    sh("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-i", prev, "-vf", "scale='min(400,iw)':-2", "-q:v", "5", thumb]);

    // the derivative carries its papers — every copy that leaves is credited
    sh("exiftool", ["-overwrite_original", "-q",
      `-Artist=${OWNER.artist}`, `-Copyright=${OWNER.copyright}`,
      `-IPTC:By-line=${OWNER.artist}`, `-IPTC:CopyrightNotice=${OWNER.copyright}`,
      // IPTC caps Credit at 32 chars — short form here, full form in XMP
      "-IPTC:Credit=McCluster Corp", "-IPTC:Source=McCluster Corp",
      `-XMP-photoshop:Credit=${OWNER.credit}`,
      `-XMP-dc:Creator=${OWNER.artist}`, `-XMP-dc:Rights=${OWNER.copyright}`,
      `-XMP-xmpRights:WebStatement=${OWNER.web}`, `-XMP-xmpRights:Marked=true`,
      `-XMP-iptcExt:Event=${EVENT || BATCH}`, `-XMP:TransmissionReference=${cat}`,
      // PLUS block: who to ask for a licence. LicensorID carries the PLUS
      // Registry id once the supporting membership lands; until then the
      // name and URL still resolve to a real desk.
      "-XMP-plus:LicensorName=McCluster Corp",
      `-XMP-plus:LicensorURL=${OWNER.web}`,
      ...(OWNER.plus_id ? [`-XMP-plus:LicensorID=${OWNER.plus_id}`] : []),
      `-XMP-xmpRights:Owner=${OWNER.credit}`,
      // IPTC DigitalSourceType — the standard way to say "a camera made
      // this, not a model". As provenance becomes the whole argument,
      // this is the cheapest claim to stake and it costs nothing.
      "-XMP-iptcExt:DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
      prev]);

    const ai = kind === "photo" ? await gemini(thumb, roster) : null;

    const row = {
      catalog_id: cat, sha256: hash, kind, event_id: EVENT || null, batch_id: BATCH,
      master_name: name, bytes: statSync(p).size,
      width: x.ImageWidth || null, height: x.ImageHeight || null,
      duration_s: x.Duration || null,
      shot_at: isoShot(x), camera: x.Model || null, lens: x.LensModel || x.LensID || null,
      iso: x.ISO || null, aperture: x.FNumber ? `f/${x.FNumber}` : null,
      shutter: x.ExposureTime ? `${x.ExposureTime}s` : null,
      gps_lat: x.GPSLatitude ?? null, gps_lon: x.GPSLongitude ?? null,
      exif: x, ai, ai_model: ai ? AI_MODEL : null,
      caption: ai?.caption || null,
      plus_id: OWNER.plus_id || null,
      // C2PA: the camera signs at capture, so the claim is either already
      // in the original or it never will be. Read it, don't fake it.
      c2pa_signed: c2pa.signed,
      c2pa_manifest: c2pa.manifest,
    };

    if (DRY) {
      console.log(`   would file ${cat} · ${kind} · ${x.Model || "?"} · ${row.shot_at || "no time"} · ${name}`);
    } else {
      const pv = readFileSync(prev), th = readFileSync(thumb);
      await sb(`/storage/v1/object/vault/previews/${cat}.jpg`, { method: "POST", body: new Uint8Array(pv), type: "image/jpeg", headers: { "x-upsert": "true" } });
      await sb(`/storage/v1/object/vault/thumbs/${cat}.jpg`, { method: "POST", body: new Uint8Array(th), type: "image/jpeg", headers: { "x-upsert": "true" } });
      row.preview_url = `${SB_URL}/storage/v1/object/public/vault/previews/${cat}.jpg`;
      row.thumb_url = `${SB_URL}/storage/v1/object/public/vault/thumbs/${cat}.jpg`;
      await sb("/rest/v1/vault_assets", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=minimal" } });
      console.log(`   filed ${cat} · ${kind} · ${x.Model || "?"} · ${ai ? "ai ✓" : "ai —"} · ${name}`);
    }
    seq++; ok++;
  } catch (e) {
    failed++;
    console.log(`   FAILED ${name} — ${String(e.message || e).slice(0, 160)}`);
  }
}

console.log(`\n${ok} filed · ${dupes} dupes bounced · ${failed} failed${DRY ? " (dry run)" : ""}`);
if (failed) process.exit(1);
