// A creator's release, as the store pipeline needs it (2026-11-23, owner: "its own distribution hub for real").
// Pure: music-access (operator-distribution-stage) reads the release and writes what this returns into
// eu_recordings / eu_releases / eu_release_tracks / eu_rights_splits, where eu-music's preflight and the
// music.deliver approval take over (supabase/functions/eu-music, eu-ddex-worker). No code is minted here: an ISRC
// or UPC is used only when the creator entered one they own, otherwise it stays empty and preflight names the gap.
// The stored shape is js/music-distribution.js's normalize(); this re-checks it, since a row can be written by
// anyone holding the creator's rights, not only that form.

export type CreatorTrack = {
  id: string; m_uid?: string | null; title?: string | null; artist?: string | null; status?: string | null;
  rights_status?: string | null; duration_ms?: number | null; poster_url?: string | null;
  master_bucket?: string | null; master_path?: string | null; distribution?: unknown;
};

const ROLES = new Set(["Primary artist", "Featured artist", "Producer", "Composer", "Lyricist", "Songwriter", "Mixing engineer", "Mastering engineer", "Engineer"]);
const str = (v: unknown, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const isIsrc = (v: unknown) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(String(v ?? ""));
export function isUpc(v: unknown) {
  const s = String(v ?? "");
  if (!/^\d{12,13}$/.test(s)) return false;
  const d = s.split("").map(Number), check = d.pop()!;
  let sum = 0;
  for (let i = d.length - 1, k = 0; i >= 0; i--, k++) sum += d[i] * (k % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === check;
}
const isDate = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(s + "T00:00:00Z");
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
};

export type Staged = {
  refusal?: string;
  recording?: Record<string, unknown>;
  release?: Record<string, unknown>;
  splits?: Array<{ party_name: string; role: string; rights_type: string; share_bps: number }>;
  gaps?: string[];
};

/** What to write for one creator release, or why it cannot be staged. */
export function stageCreatorRelease(t: CreatorTrack, orgId: string): Staged {
  if (t.status !== "approved" && t.status !== "published") return { refusal: "approve the release before preparing it for the stores" };
  if (!t.distribution || typeof t.distribution !== "object" || Array.isArray(t.distribution)) return { refusal: "the creator has not entered distribution details yet" };
  const d = t.distribution as Record<string, unknown>;
  const title = str(t.title, 500), artist = str(t.artist, 300);
  const releaseDate = isDate(d.release_date) ? String(d.release_date) : null;
  const isrc = isIsrc(d.isrc) ? String(d.isrc) : "";
  const upc = isUpc(d.upc) ? String(d.upc) : "";
  const masterOwner = str(d.master_owner);
  const credits = (Array.isArray(d.credits) ? d.credits : []).slice(0, 40)
    .map((c: any) => ({ name: str(c?.name, 120), role: ROLES.has(c?.role) ? c.role : "" }))
    .filter((c) => c.name && c.role);
  const raw = (Array.isArray(d.splits) ? d.splits : []).slice(0, 40)
    .map((s: any) => ({ kind: s?.kind === "publishing" ? "publishing" : "master", name: str(s?.name, 120), bps: Math.round(Number(s?.share_pct) * 100) }))
    .filter((s) => s.name && Number.isFinite(s.bps) && s.bps > 0 && s.bps <= 10000);
  const gaps: string[] = [];
  for (const kind of ["master", "publishing"]) {
    const rows = raw.filter((s) => s.kind === kind);
    if (rows.length && rows.reduce((a, s) => a + s.bps, 0) !== 10000) gaps.push(`${kind} splits do not add up to 100%`);
  }
  /* none set: the whole master to its owner (the checklist says so to the creator) */
  const splits = (raw.length ? raw : masterOwner ? [{ kind: "master", name: masterOwner, bps: 10000 }] : [])
    .map((s) => ({ party_name: s.name, role: s.kind === "master" ? "master owner" : "publisher", rights_type: s.kind, share_bps: s.bps }));
  if (!title) gaps.push("title");
  if (!artist) gaps.push("artist");
  if (!releaseDate) gaps.push("release date");
  if (!masterOwner) gaps.push("master owner");
  if (!isrc) gaps.push("ISRC");
  if (!upc) gaps.push("UPC");
  if (!/\.(wav|flac|aiff?)$/i.test(String(t.master_path ?? ""))) gaps.push("lossless master (WAV or FLAC)");
  if (!t.poster_url) gaps.push("cover art");
  if (typeof d.explicit !== "boolean") gaps.push("explicit or clean");
  if (!credits.some((c) => ["Composer", "Lyricist", "Songwriter"].includes(c.role))) gaps.push("songwriter credit");
  const meta = { creator_track_id: t.id, creator_m_uid: t.m_uid ?? null, source: "creator_tracks" };
  return {
    recording: {
      org_id: orgId, title, artist, isrc, duration_ms: Number.isFinite(Number(t.duration_ms)) ? Number(t.duration_ms) : null,
      recording_year: releaseDate ? Number(releaseDate.slice(0, 4)) : null, master_owner: masterOwner,
      p_line: str(d.p_line), c_line: str(d.c_line), language: /^[a-z]{2,3}$/.test(String(d.language ?? "")) ? String(d.language) : "en",
      explicit: d.explicit === true, audio_ref: t.master_bucket && t.master_path ? { bucket: t.master_bucket, path: t.master_path } : {},
      metadata: { ...meta, credits }
    },
    release: {
      org_id: orgId, title, artist, upc, release_type: "single", release_date: releaseDate,
      /* the label is the creator's (their master owner), never McCluster Corp by default */
      label: masterOwner || artist, artwork_ref: t.poster_url ? { url: t.poster_url } : {}, status: "metadata-review", metadata: meta
    },
    splits, gaps
  };
}

/** A staged release past review is not restaged in place: delivered metadata changes need an update message. */
export const RESTAGEABLE = new Set(["draft", "metadata-review", "approved"]);
