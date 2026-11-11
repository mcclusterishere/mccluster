/* THE FRONT PAGE'S SETTINGS, CHECKED ON THE SERVER.

   One JSON shape drives every front page: the house's (index.html, the site_content row "@front") and every account's
   (front.html?u=<handle>, public.member_fronts). The page checks it again as it reads it (frontConfig in js/main.js,
   which keeps the shipped value for anything missing or wrong); this is the Worker's check before anything is stored,
   with the same bounds, plus the one rule a page cannot know: an account's media must be its own, in its own folder of
   the front-media bucket.

   Owner, 2026-10-21: "all the accounts need to be able to recreate with their own media this exact same experience ...
   my front page with a VR, with the scroll dependent video, all this." */

export const FRONT_SCHEMA = 'mccluster-front/v1';
export const FRONT_MAX_BYTES = 48 * 1024;
export const FILMS = Object.freeze(['hero', 'scene1', 'scene2', 'night']);
export const WORD_LIMITS = Object.freeze({
  eyebrow: 60, title1: 14, title2: 14, sub: 60,
  gateKicker: 40, gateTitle: 40, gateLede: 180, cabinTag: 60,
  nightKicker: 60, nightTitle1: 12, nightTitle2: 12
});
const SCENES = ['doors', 'vaunt', 'night', 'world'];
/* index.html (owner, 2026-10-29): where the page opens, its one song, and whether the public sees it at all.
   The same lists as FRONT_DEFAULT / FRONT_SONGS in js/main.js. */
export const STARTS = Object.freeze(['cabin', 'plane']);
export const SONGS = Object.freeze(['antisocial', 'whodidtheshoot', 'vaunt', 'runway', 'here', 'environmental-injustice']);

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const text = (v, max) => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t && [...t].length <= max ? t : undefined;
};
/* a link stays on this site, or is an https link; never a script (the same rule as frontHref in js/main.js) */
export function frontHref(v) {
  const h = typeof v === 'string' ? v.trim() : '';
  if (!h || h.length > 300) return undefined;
  if (/^https:\/\/[^\s"'<>]+$/i.test(h)) return h;
  return /^(?![a-z][a-z0-9+.-]*:)(?!\/\/)[a-z0-9_./?#=&%-]+$/i.test(h) ? h : undefined;
}
/* media is the account's own: an https URL under its folder of the public front-media bucket */
function mediaUrl(v, prefix) {
  if (typeof v !== 'string' || !prefix) return undefined;
  const u = v.trim();
  return u.startsWith(prefix) && u.length <= 400 && /^[A-Za-z0-9._/:-]+$/.test(u.slice(prefix.length)) && !u.includes('..') ? u : undefined;
}
const clean = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

/* the media prefix for one account (its auth uid is its folder) */
export function mediaPrefix(supabaseUrl, authUserId) {
  return /^[0-9a-f-]{36}$/i.test(String(authUserId || '')) && supabaseUrl
    ? `${String(supabaseUrl).replace(/\/+$/, '')}/storage/v1/object/public/front-media/${String(authUserId).toLowerCase()}/`
    : '';
}

/* Returns { ok, config, dropped } : the settings as they will be stored (everything that passed), and the names of what
   did not, so the editor can say so. A setting that is missing is simply absent: the page keeps its shipped value. */
export function validateFront(raw, { mediaPrefix: prefix = '' } = {}) {
  const dropped = [];
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const note = (name, kept) => { if (kept === undefined) dropped.push(name); return kept; };
  const out = { schema: FRONT_SCHEMA };

  const sc = r.scenes && typeof r.scenes === 'object' ? r.scenes : null;
  if (sc) out.scenes = clean(Object.fromEntries(SCENES.map((k) => [k, k in sc ? note('scenes.' + k, bool(sc[k])) : undefined])));

  const sr = r.scroll && typeof r.scroll === 'object' ? r.scroll : null;
  if (sr) out.scroll = clean({
    duration: 'duration' in sr ? note('scroll.duration', num(sr.duration, 0.3, 1.8)) : undefined,
    touchLerp: 'touchLerp' in sr ? note('scroll.touchLerp', num(sr.touchLerp, 0.05, 0.4)) : undefined
  });

  const v = r.vr && typeof r.vr === 'object' ? r.vr : null;
  if (v) {
    let band;
    if ('band' in v) {
      const b = Array.isArray(v.band) && v.band.length === 2 ? [num(v.band[0], 0.15, 0.85), num(v.band[1], 0.15, 0.85)] : null;
      band = note('vr.band', b && b[0] !== undefined && b[1] !== undefined && b[1] - b[0] >= 0.04 ? b : undefined);
    }
    let spots;
    if ('spots' in v) {
      spots = (Array.isArray(v.spots) ? v.spots.slice(0, 5) : []).map((x, i) => {
        const label = text(x && x.label, 60), href = frontHref(x && x.href);
        if (!label || !href) { dropped.push('vr.spots.' + i); return null; }
        return clean({ yaw: num(x.yaw, -180, 180) ?? 0, pitch: num(x.pitch, -85, 85) ?? 0, label, href, urgent: x.urgent === true || undefined });
      }).filter(Boolean);
    }
    out.vr = clean({
      enabled: 'enabled' in v ? note('vr.enabled', bool(v.enabled)) : undefined,
      hold: 'hold' in v ? note('vr.hold', bool(v.hold)) : undefined,
      band,
      yaw: 'yaw' in v ? note('vr.yaw', num(v.yaw, -180, 180)) : undefined,
      pitch: 'pitch' in v ? note('vr.pitch', num(v.pitch, -85, 85)) : undefined,
      spots
    });
  }

  if ('start' in r) out.start = note('start', STARTS.includes(r.start) ? r.start : undefined);
  if ('song' in r) out.song = note('song', SONGS.includes(r.song) ? r.song : undefined);
  /* visible:false tucks the page away: a holding screen and noindex for visitors, the real page for the house owner.
     A static site still serves the files themselves, so this hides the page; it does not make it secret. */
  if ('visible' in r) out.visible = note('visible', bool(r.visible));
  if (out.start === undefined) delete out.start;
  if (out.song === undefined) delete out.song;
  if (out.visible === undefined) delete out.visible;

  const n = r.night && typeof r.night === 'object' ? r.night : null;
  if (n) out.night = clean({ arrive: 'arrive' in n ? note('night.arrive', num(n.arrive, 0.5, 0.86)) : undefined });

  const w = r.words && typeof r.words === 'object' ? r.words : null;
  if (w) {
    const words = {};
    for (const [k, max] of Object.entries(WORD_LIMITS)) if (k in w) words[k] = note('words.' + k, text(w[k], max));
    for (const d of ['door1', 'door2']) {
      if (!(d in w)) continue;
      const label = text(w[d] && w[d].label, 40), href = frontHref(w[d] && w[d].href);
      words[d] = label && href ? { label, href } : note('words.' + d, undefined);
    }
    out.words = clean(words);
  }

  if ('links' in r) {
    out.links = (Array.isArray(r.links) ? r.links.slice(0, 4) : []).map((x, i) => {
      const label = text(x && x.label, 40), href = frontHref(x && x.href);
      if (!label || !href) { dropped.push('links.' + i); return null; }
      return { label, href };
    }).filter(Boolean);
  }

  const m = r.media && typeof r.media === 'object' ? r.media : null;
  if (m) {
    const media = {};
    for (const f of FILMS) {
      if (!(f in m) || m[f] === null) continue;
      const x = m[f] || {}, base = mediaUrl(x.base, prefix);
      const ok = base && base.endsWith('/') && Number.isInteger(x.count) && x.count >= 8 && x.count <= 240 && (x.ext === 'webp' || x.ext === 'jpg');
      media[f] = ok ? clean({ base, count: x.count, ext: x.ext, sm: x.sm === true || undefined }) : note('media.' + f, undefined);
    }
    if ('cabin' in m && m.cabin !== null) {
      const c = m.cabin || {}, src = mediaUrl(c.src, prefix), poster = c.poster ? mediaUrl(c.poster, prefix) : undefined;
      media.cabin = src && (c.kind === 'video' || c.kind === 'image') && (!c.poster || poster) ? clean({ src, kind: c.kind, poster }) : note('media.cabin', undefined);
    }
    if ('sound' in m && m.sound !== null) {
      const src = mediaUrl(m.sound && m.sound.src, prefix);
      media.sound = src ? { src } : note('media.sound', undefined);
    }
    if ('still' in m && m.still !== null) {
      const src = mediaUrl(m.still && m.still.src, prefix);
      media.still = src ? { src } : note('media.still', undefined);
    }
    out.media = clean(media);
  }

  const size = new TextEncoder().encode(JSON.stringify(out)).length;
  if (size > FRONT_MAX_BYTES) return { ok: false, config: null, dropped, error: 'too_large', size };
  return { ok: true, config: out, dropped };
}
