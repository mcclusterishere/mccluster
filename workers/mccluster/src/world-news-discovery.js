/* THE WORLD'S NEWS, FROM GDELT, SERVED BY US.

   Owner, 2026-10-15: "GDELT news as the feed ... And our shit is sprinkled
   into that ... we gotta ingest it so it's still from us", then "I want you
   to ingest the GDELT immediately."

   WHOSE STORE. This fills the raw-discovery namespace ChatGPT built in #432
   (20261014023548: media_news_articles, media_news_sources,
   media_ingestion_runs, the headline-country trigger), which has never held
   a row: its DOC 2.0 path (public-gdelt-news, media_gdelt_state) has had no
   authenticated scheduler since 75937783, and the DOC API answers 429 by
   source IP. This path writes rows marked ingestion_provider 'gdelt_gkg_v2'
   beside #432's 'gdelt_doc_v2' and changes nothing of #432's.

   INGEST (the five-minute cron, ingestGdeltNews; off until
   WORLD_NEWS_INGEST_ENABLED is "true"; its SQL is
   supabase/migrations/20261016151123_world_gdelt_gkg_news_v1.sql). GDELT publishes a
   Global Knowledge Graph file every 15 minutes: about 1,000-1,700 English web
   articles, each with its page title and the places it mentions, with
   coordinates. Each tick reads lastupdate.txt, then takes at most two files
   it has not read yet (the newest, then the hour before it, so a gap fills
   itself), claiming each in media_gdelt_files so a file is read once. A file
   comes from data.gdeltproject.org, or from GDELT's own Google Cloud Storage
   mirror when the first answers 404 (it does, for the newest files, for up to
   an hour); a redirect is followed only between those two hosts
   (lib/safe-fetch.js). It is inflated as a stream, so memory stays small, and
   each record is screened: web articles only, a title, English, no
   press-release wires or stock-ticker mills, no graphic violence (GDELT's own
   themes plus the title's words), at most 72 hours old, one copy of a
   syndicated story, at most three per publisher. About 100 per file are
   kept, each with ONE place: the place the article mentions most, narrowed
   to the city it mentions most inside that country or state. That is where
   the article MENTIONS a place, never a verified event location; its country
   code is GDELT's FIPS 10-4 (UK, GM, AS), not ISO 3166. They go to Supabase
   through media_ingest_gdelt_gkg (service role). A week is kept
   (media_news_prune, hourly).

   SERVE. GET /v1/world/news is the World's news stream, newest first, 20 at a
   time, with an opaque cursor (a whole file shares one time, so the cursor is
   time and id). It reads only our database, is kept a minute per data
   centre, and answers 200 with nothing when the database cannot, never an
   error the feed would have to explain. GDELT's terms ask for a citation and
   a link on every use; the answer carries it, and the page shows it.
   Headlines link out to the publisher; no article text, and no publisher
   image, is shown. The globe's News layer is not here: it joins the other
   layers in world-layers.js once the World's layer access (#442) lands. */
import { reply, fail } from './lib/http.js';
import { fetchNoCrossHostRedirect } from './lib/safe-fetch.js';
import { isoFromGdelt, gdeltCodesFor } from './intel/news-country-codes.js';
import { placeScopeEnabled } from './world-region-feed.js';

export const GDELT_LASTUPDATE = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
export const GDELT_HOSTS = Object.freeze(['https://data.gdeltproject.org/gdeltv2/', 'https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/']);
export const NEWS_ATTRIBUTION = Object.freeze({ name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' });
export const NEWS_PATH = '/v1/world/news';
export const NEWS_HEAT_PATH = '/v1/world/news-heat';
const GDELT_ALLOWED_HOSTS = Object.freeze(['data.gdeltproject.org', 'storage.googleapis.com']);

const PER_FILE = 1000;
const PER_DOMAIN = 3;
const BACKFILL_SLOTS = 4;
const FILES_PER_TICK = 2;
const FETCH_TIMEOUT_MS = 25000;
const MAX_ZIP_BYTES = 24 * 1024 * 1024;
const MAX_AGE_HOURS = 72;
const KEEP_DAYS = 30;
const FILE_RE = /^[0-9]{14}\.gkg\.csv\.zip$/;
const NCOLS = 27;
const COL = Object.freeze({ ID: 0, DATE: 1, COLLECTION: 2, DOMAIN: 3, URL: 4, THEMES: 7, LOCATIONS: 10, TONE: 15, IMAGE: 18, TRANSLATION: 25, EXTRAS: 26 });
const RECORD_START = /^[0-9]{14}-T?[0-9]+\t/;

/* ---------- the screens ---------- */
/* press-release wires, wire-copy mirrors, automated stock-ticker mills and digests, seen in GDELT's own files; and our own hosts */
export const BLOCKED_DOMAINS = Object.freeze(new Set([
  'prnewswire.com', 'globenewswire.com', 'businesswire.com', 'einpresswire.com', 'accessnewswire.com', 'accesswire.com',
  'newswiretoday.com', 'massachusettsnewswire.com', 'standardnewswire.com', 'newsfilecorp.com', 'openpr.com', 'prweb.com',
  'prlog.org', 'odwyerpr.com', 'finanznachrichten.de', 'tickerreport.com', 'themarketsdaily.com', 'dailypolitical.com',
  'marketbeat.com', 'americanbankingnews.com', 'etfdailynews.com', 'miragenews.com', 'homelandsecuritynewswire.com', 'naslovi.net',
  /* our own hosts: an article from the newsroom (company-site/news.js) is already a post in the World, never outside news */
  'mccluster.org', 'humanuprise.com'
]));
const TICKER_TITLE = [/\((NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|NYSEMKT|OTCMKTS|OTC|TSE|TSX|TSXV|LON|LSE|ASX|NSE|BOM|ETR|FRA|CVE):[A-Z0-9.\-]+\)/, /\$[A-Z]{1,5} Stock/, /Shares (Sold|Bought|Acquired) by/i, /Stock Position (Raised|Lowered|Increased|Decreased)/i];
/* always out, whatever the title says */
export const ALWAYS_DROP_THEMES = Object.freeze(new Set(['RAPE', 'SEXUAL_ASSAULT', 'CHILD_ABUSE', 'TORTURE', 'SELF_IDENTIFIED_ATROCITY', 'GENOCIDE', 'SOC_SUICIDE', 'SUICIDE_ATTACK', 'MASS_MURDER', 'WB_2443_RAPE_AND_SEXUAL_VIOLENCE', 'WB_2512_TORTURE', 'WB_2509_GENOCIDE', 'TAX_WEAPONS_SUICIDE_BOMB']));
/* out only when the title itself is graphic too */
const HARD_THEMES = new Set(['KILL', 'CRISISLEX_T03_DEAD', 'CRISISLEX_T02_INJURED', 'WOUND', 'TERROR', 'KIDNAP', 'ARMEDCONFLICT', 'TAX_FNCACT_KILLER', 'SOC_GENERALCRIME', 'GENDER_VIOLENCE', 'WB_2441_DOMESTIC_VIOLENCE', 'UNGP_CRIME_VIOLENCE']);
const GRAPHIC_TITLE = /\b(kill(ed|ing|ings|s)?|murder(ed|s|er|ers)?|massacre[ds]?|behead(ed|ing)?|decapitat\w*|stab(bed|bing|bings)?|shot dead|gunned down|corpses?|dismember\w*|rap(e|ed|es|ist)|tortur\w*|mutilat\w*|slaughter\w*|bloodbath|lynch\w*|bod(y|ies) found|execut(ed|ion)s?)\b/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

/* the headline as a reader should see it: entities decoded, stray tags gone, a "| Site Name" tail dropped */
export function cleanTitle(raw) {
  let t = decodeEntities(raw).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  /* a "| Site Name" tail goes only when it is the shorter side: "Site | The actual headline" keeps the headline */
  const m = /^(.+?)\s+\|\s+([^|]{1,60})$/.exec(t);
  if (m && m[1].length >= m[2].length) t = m[1].trim();
  return t;
}

/* the same story syndicated across a network's stations: compare titles without their site tails or punctuation */
export function storyKey(title) {
  return String(title || '').toLowerCase().replace(/\s+[|\-–—]\s+[^|\-–—]{1,40}$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function blockedDomain(domain) {
  const d = String(domain || '').toLowerCase();
  for (const b of BLOCKED_DOMAINS) if (d === b || d.endsWith('.' + b)) return true;
  return false;
}

/* more than 30% of the letters outside the Latin script: not for an English feed */
function mostlyNonLatin(title) {
  const letters = title.match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  const latin = title.match(/\p{Script=Latin}/gu) || [];
  return (letters.length - latin.length) / letters.length > 0.3;
}

export function screenReason(rec) {
  if (blockedDomain(rec.domain)) return 'domain';
  if (TICKER_TITLE.some((re) => re.test(rec.title))) return 'ticker';
  if (rec.title.length < 15 || rec.title.length > 300) return 'title';
  if (mostlyNonLatin(rec.title)) return 'language';
  const themes = rec.themes || [];
  if (themes.some((t) => ALWAYS_DROP_THEMES.has(t))) return 'graphic';
  if (themes.some((t) => HARD_THEMES.has(t)) && GRAPHIC_TITLE.test(rec.title)) return 'graphic';
  return null;
}

/* ---------- one place per article ----------
   V2EnhancedLocations: Type#FullName#CountryCode#ADM1#ADM2#Lat#Lon#FeatureID#CharOffset;... one entry per mention.
   Types: 1 country, 2 US state, 3 US city, 4 world city, 5 world state. The place mentioned most wins; a country or state
   gives way to the city it mentions most inside it. A country's name is often an adjective here ("Australian"), so a
   country keeps its centroid but no label. */
export function bestPlace(v2loc) {
  if (!v2loc) return null;
  const byKey = new Map();
  for (const block of String(v2loc).split(';')) {
    if (!block) continue;
    const f = block.split('#');
    if (f.length < 9) continue;
    const type = Number(f[0]), lat = Number(f[5]), lon = Number(f[6]);
    if (!(type >= 1 && type <= 5) || f[5] === '' || f[6] === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const key = type + ':' + (f[7] || f[1]);
    const off = Number(f[8]);
    const cur = byKey.get(key);
    if (cur) { cur.mentions++; if (Number.isFinite(off) && off < cur.first) cur.first = off; continue; }
    byKey.set(key, { type, name: f[1], country: f[2], adm1: f[3], lat, lon, mentions: 1, first: Number.isFinite(off) ? off : Infinity });
  }
  const all = [...byKey.values()];
  if (!all.length) return null;
  const rank = (a, b) => b.mentions - a.mentions || specificity(b.type) - specificity(a.type) || a.first - b.first;
  all.sort(rank);
  let pick = all[0];
  if (pick.type === 1 || pick.type === 2 || pick.type === 5) {
    const inside = all.filter((c) => (c.type === 3 || c.type === 4) && c.country === pick.country && (pick.type === 1 || c.adm1 === pick.adm1));
    if (inside.length) pick = inside.sort(rank)[0];
  }
  return {
    place: pick.type === 1 ? null : Array.from(String(pick.name)).slice(0, 200).join(''),
    lat: Math.round(pick.lat * 1e5) / 1e5,
    lon: Math.round(pick.lon * 1e5) / 1e5,
    type: pick.type,
    country_fips: String(pick.country || '').slice(0, 8) || null
  };
}
function specificity(type) { return type === 3 || type === 4 ? 3 : type === 2 || type === 5 ? 2 : 1; }

function extraTag(xml, tag) {
  const open = `<${tag}>`;
  const i = xml.indexOf(open);
  if (i < 0) return null;
  const j = xml.indexOf(`</${tag}>`, i);
  return xml.slice(i + open.length, j < 0 ? undefined : j);
}
function gdeltTime(s) {
  const m = /^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})$/.exec(String(s || ''));
  if (!m || m[1] === '0000') return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(t) ? t : null;
}

/* one GKG record to one candidate, or a reason it is not one */
export function parseRecord(line) {
  const c = line.split('\t');
  if (c.length !== NCOLS) return { skip: 'shape' };
  if (c[COL.COLLECTION] !== '1') return { skip: 'not_web' };
  if (/-T/.test(c[COL.ID]) || c[COL.TRANSLATION]) return { skip: 'translated' };
  const url = c[COL.URL];
  if (!/^https?:\/\//.test(url) || url.length > 2000) return { skip: 'url' };
  const rawTitle = extraTag(c[COL.EXTRAS] || '', 'PAGE_TITLE');
  if (!rawTitle) return { skip: 'title' };
  const title = cleanTitle(rawTitle);
  const seen = gdeltTime(c[COL.DATE]);
  if (seen === null) return { skip: 'date' };
  const published = gdeltTime(extraTag(c[COL.EXTRAS] || '', 'PAGE_PRECISEPUBTIMESTAMP'));
  if (published !== null && seen - published > MAX_AGE_HOURS * 3600e3) return { skip: 'old' };
  const domain = String(c[COL.DOMAIN] || '').toLowerCase().trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { skip: 'domain' };
  const themes = c[COL.THEMES] ? c[COL.THEMES].split(';').filter(Boolean) : [];
  const tone = Number(String(c[COL.TONE] || '').split(',')[0]);
  const image = /^https:\/\//.test(c[COL.IMAGE] || '') && c[COL.IMAGE].length <= 2000 ? c[COL.IMAGE] : null;
  const rec = { url, title, domain, seen_at: new Date(seen).toISOString(), themes, tone: Number.isFinite(tone) ? Math.round(tone * 100) / 100 : null, image, place: bestPlace(c[COL.LOCATIONS]) };
  const why = screenReason(rec);
  if (why) return { skip: why };
  /* a kept record carries one flag, not its few hundred themes: a file's candidates stay small */
  rec.hard = themes.some((t) => HARD_THEMES.has(t));
  delete rec.themes;
  /* the fields are slices of a record that runs to tens of kilobytes; V8 keeps the whole record alive behind a slice,
     so a kept record is copied into fresh strings and the line can go */
  return { rec: JSON.parse(JSON.stringify(rec)) };
}

/* ~100 a file: one copy of a story, three per publisher, a city before a state before a country before nowhere */
export function selectArticles(recs, cap = PER_FILE) {
  const seenStory = new Set();
  const unique = [];
  for (const r of recs) {
    const k = storyKey(r.title);
    if (!k || seenStory.has(k)) continue;
    seenStory.add(k);
    unique.push(r);
  }
  const score = (r) => (r.place ? specificity(r.place.type) : 0);
  const ordered = unique.map((r, i) => ({ r, i })).sort((a, b) => score(b.r) - score(a.r) || a.i - b.i).map((x) => x.r);
  const perDomain = new Map();
  const out = [];
  for (const r of ordered) {
    const n = perDomain.get(r.domain) || 0;
    if (n >= PER_DOMAIN) continue;
    perDomain.set(r.domain, n + 1);
    out.push(r);
    if (out.length >= cap) break;
  }
  return out;
}

export function toPayload(r) {
  const hard = r.hard === true || (Array.isArray(r.themes) && r.themes.some((t) => HARD_THEMES.has(t)));
  return {
    url: r.url, title: Array.from(r.title).slice(0, 250).join(''), domain: r.domain, seen_at: r.seen_at, story_key: storyKey(r.title).slice(0, 300),
    place: r.place ? r.place.place : null, lat: r.place ? r.place.lat : null, lon: r.place ? r.place.lon : null,
    location_type: r.place ? r.place.type : null, country_fips: r.place ? r.place.country_fips : null,
    tone: r.tone, image: hard ? null : r.image
  };
}

/* ---------- the file ---------- */
/* a single-entry zip: deflate from the local header's data offset, as a stream of text */
export function inflateZipText(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 30 || dv.getUint32(0, true) !== 0x04034b50) throw new Error('not a zip');
  const flags = dv.getUint16(6, true), method = dv.getUint16(8, true);
  let size = dv.getUint32(18, true);
  const start = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  if (flags & 0x8 || !size) {
    let eocd = -1;
    for (let i = u8.byteLength - 22; i >= Math.max(0, u8.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('zip without a directory');
    size = dv.getUint32(dv.getUint32(eocd + 16, true) + 20, true);
  }
  const data = u8.subarray(start, start + size);
  let stream = new Response(data).body;
  if (method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  else if (method !== 0) throw new Error(`zip method ${method}`);
  return stream.pipeThrough(new TextDecoderStream());
}

/* whole records out of a text stream; a record that carries a raw newline is joined back together */
export async function* gkgRecords(textStream) {
  let carry = '', cur = null;
  const take = function* (line) {
    if (RECORD_START.test(line)) { if (cur !== null) yield cur; cur = line; }
    else if (cur !== null) cur += '\n' + line;
  };
  for await (const chunk of textStream) {
    const buf = carry + chunk;
    let pos = 0, nl;
    while ((nl = buf.indexOf('\n', pos)) >= 0) {
      yield* take(buf.slice(pos, nl).replace(/\r$/, ''));
      pos = nl + 1;
    }
    carry = buf.slice(pos);
  }
  if (carry) yield* take(carry.replace(/\r$/, ''));
  if (cur !== null) yield cur;
}

export async function parseGkgFile(u8) {
  const stats = { rows: 0, kept: 0, skipped: {} };
  const recs = [];
  for await (const line of gkgRecords(inflateZipText(u8))) {
    stats.rows++;
    const r = parseRecord(line);
    if (r.rec) recs.push(r.rec);
    else stats.skipped[r.skip] = (stats.skipped[r.skip] || 0) + 1;
  }
  const articles = selectArticles(recs).map(toPayload);
  stats.kept = articles.length;
  return { articles, stats };
}

/* ---------- fetching, with a deadline ---------- */
/* the deadline covers the body too: a host that sends headers and then stalls is cut off like one that never answers.
   Redirects follow lib/safe-fetch.js: GDELT's files only between GDELT's two hosts, Supabase only to itself. */
async function timed(fetchImpl, url, init = {}, read = (r) => r.text(), allowedHosts = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchNoCrossHostRedirect(url, { ...init, signal: controller.signal, headers: { 'user-agent': 'McCluster-World/1.0 (https://mccluster.org)', ...(init.headers || {}) } }, { fetchImpl, allowedHosts });
    return { res, body: await read(res) };
  } finally {
    clearTimeout(timer);
  }
}

export function parseLastUpdate(text) {
  for (const line of String(text || '').split('\n')) {
    const [size, , url] = line.trim().split(/\s+/);
    const name = url ? url.slice(url.lastIndexOf('/') + 1) : '';
    if (FILE_RE.test(name)) return { name, size: Number(size) || null };
  }
  return null;
}

/* the 15-minute names before this one, newest first */
export function earlierSlots(name, n) {
  const t = gdeltTime(name.slice(0, 14));
  if (t === null) return [];
  const out = [];
  for (let k = 1; k <= n; k++) {
    const d = new Date(t - k * 15 * 60e3);
    const p = (v) => String(v).padStart(2, '0');
    out.push(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00.gkg.csv.zip`);
  }
  return out;
}

export async function downloadGkg(name, size, fetchImpl = fetch) {
  let last = 'no host answered';
  for (const host of GDELT_HOSTS) {
    let res, buf;
    try {
      ({ res, body: buf } = await timed(fetchImpl, host + name, {}, async (r) => {
        if (!r.ok) return null;
        const declared = Number(r.headers.get('content-length'));
        if (declared > MAX_ZIP_BYTES) throw Object.assign(new Error(`file too large (${declared})`), { tooLarge: true });
        return new Uint8Array(await r.arrayBuffer());
      }, GDELT_ALLOWED_HOSTS));
    } catch (e) {
      if (e && e.tooLarge) throw e;
      last = `${new URL(host).host} ${e && e.name === 'AbortError' ? 'timeout' : (e && e.code) || 'unreachable'}`;
      continue;
    }
    if (!res.ok) { last = `${new URL(host).host} ${res.status}`; continue; }
    if (buf.byteLength > MAX_ZIP_BYTES) throw new Error(`file too large (${buf.byteLength})`);
    if (size && buf.byteLength !== size) { last = `${new URL(host).host} size ${buf.byteLength} != ${size}`; continue; }
    return buf;
  }
  throw new Error(last);
}

/* ---------- Supabase, as the service role ---------- */
export async function serviceRpc(env, name, args, fetchImpl = fetch) {
  const { res, body: text } = await timed(fetchImpl, `${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args || {})
  });
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error((data && data.message) || `${name} ${res.status}`), { status: res.status, code: data && data.code });
  return data;
}
/* Each story's country, as ISO 3166-1, from GDELT's FIPS code (media_world_news predates the column, so this is the same
   service read the country feed makes). The page names the country on the story's chip and matches it when a country is
   picked; FIPS never leaves the Worker ("RS" is Russia in FIPS and Serbia in ISO). A failure leaves the stories without it. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function storyCountries(env, ids, fetchImpl) {
  const want = ids.filter((id) => UUID_RE.test(id));
  if (!want.length) return new Map();
  try {
    const { res, body } = await timed(fetchImpl, `${env.SUPABASE_URL}/rest/v1/media_news_articles?select=id,location_country_fips&id=in.(${want.join(',')})`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }
    });
    const rows = res.ok ? JSON.parse(body || '[]') : [];
    return new Map((Array.isArray(rows) ? rows : []).map((r) => [String(r.id), isoFromGdelt(r.location_country_fips)]));
  } catch { return new Map(); }
}
const notProvisioned = (e) => e && (e.status === 404 || e.code === 'PGRST202' || e.code === '42883');

/* ---------- the cron ---------- */
export async function ingestGdeltNews(env, { fetchImpl = fetch, scheduledTime = Date.now() } = {}) {
  /* off until the owner turns it on with the SQL applied: no GDELT request, no Supabase call */
  if (String((env && env.WORLD_NEWS_INGEST_ENABLED) || '').trim().toLowerCase() !== 'true') return { skipped: 'disabled' };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: 'not configured' };
  const report = { files: [], pruned: null };
  try {
    if (new Date(scheduledTime).getUTCMinutes() < 5) report.pruned = await serviceRpc(env, 'media_news_prune', { p_keep_days: KEEP_DAYS }, fetchImpl);
  } catch (e) {
    if (notProvisioned(e)) return { skipped: 'not provisioned' };
    report.prune_error = String(e.message || e).slice(0, 200);
  }
  let latest;
  try {
    const { res, body } = await timed(fetchImpl, GDELT_LASTUPDATE, {}, (r) => r.text(), GDELT_ALLOWED_HOSTS);
    if (!res.ok) throw new Error(`lastupdate ${res.status}`);
    latest = parseLastUpdate(body);
  } catch (e) {
    return { ...report, error: String(e.message || e).slice(0, 200) };
  }
  if (!latest) return { ...report, error: 'lastupdate has no GKG file' };
  const slots = [latest, ...earlierSlots(latest.name, BACKFILL_SLOTS).map((name) => ({ name, size: null }))];
  let attempts = 0;
  for (const slot of slots) {
    /* two files read a tick, three tried at most, so a GDELT outage costs a few requests, not a storm */
    if (report.files.filter((f) => f.ingested).length >= FILES_PER_TICK || attempts >= FILES_PER_TICK + 1) break;
    let claimed;
    try { claimed = await serviceRpc(env, 'media_gdelt_file_claim', { p_file: slot.name }, fetchImpl); }
    catch (e) { if (notProvisioned(e)) return { ...report, skipped: 'not provisioned' }; throw e; }
    if (claimed !== true) continue;
    attempts++;
    try {
      const zip = await downloadGkg(slot.name, slot.size, fetchImpl);
      const { articles, stats } = await parseGkgFile(zip);
      /* an empty file still finishes its claim, so it is not read again */
      const saved = await serviceRpc(env, 'media_ingest_gdelt_gkg', { p_file: slot.name, p_rows_seen: stats.rows, p_articles: articles }, fetchImpl);
      report.files.push({ name: slot.name, ingested: true, rows: stats.rows, kept: stats.kept, saved: saved && saved.saved, skipped: stats.skipped });
    } catch (e) {
      const why = String(e && e.message || e).slice(0, 300);
      report.files.push({ name: slot.name, ingested: false, error: why });
      await serviceRpc(env, 'media_gdelt_file_release', { p_file: slot.name, p_error: why }, fetchImpl).catch(() => {});
    }
  }
  return report;
}

/* ---------- the routes ---------- */
const CURSOR_RE = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z)~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null)));

async function keptOrFetched(cacheImpl, key, ttlMs, load) {
  const store = cacheImpl || (globalThis.caches && globalThis.caches.default) || null;
  const req = new Request(key);
  if (store) {
    const hit = await store.match(req).catch(() => null);
    const body = hit ? await hit.json().catch(() => null) : null;
    if (body && Number.isFinite(body.at) && Date.now() - body.at < ttlMs) return body.data;
  }
  const data = await load();
  if (store && data && !data.unavailable) {
    await store.put(req, new Response(JSON.stringify({ at: Date.now(), data }), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.ceil(ttlMs / 1000)}` } })).catch(() => {});
  }
  return data;
}

function answer(request, env, body, maxAge) {
  const res = reply(request, env, body);
  res.headers.set('cache-control', `public, max-age=${maxAge}`);
  res.headers.set('vary', 'Origin');
  return res;
}

export async function handleWorldNews(request, env, { fetchImpl = fetch, cacheImpl = null } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== NEWS_PATH) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(request, env, 'Method not allowed', 405);
  const configured = env && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return fail(request, env, 'limit must be 1 to 50', 400);
  const before = url.searchParams.get('before');
  let cursor = null;
  if (before !== null && before !== '') {
    const m = CURSOR_RE.exec(before);
    const t = m ? Date.parse(m[1]) : NaN;
    /* a real date only: February 30 parses in some engines and fails in Postgres */
    if (!m || !Number.isFinite(t) || t < 0 || new Date(t).toISOString().slice(0, 19) !== m[1].slice(0, 19)) return fail(request, env, 'bad cursor', 400);
    cursor = { at: m[1], id: m[2] };
  }
  const key = `https://cache.mccluster.internal/world/news?limit=${limit}&before=${encodeURIComponent(before || '')}`;
  const data = await keptOrFetched(cacheImpl, key, 60e3, async () => {
    if (!configured) return { unavailable: true };
    try {
      const rows = await serviceRpc(env, 'media_world_news', { p_before_at: cursor ? cursor.at : null, p_before_id: cursor ? cursor.id : null, p_limit: limit }, fetchImpl);
      const list = Array.isArray(rows) ? rows : [];
      const countries = await storyCountries(env, list.map((r) => String(r.id)), fetchImpl);
      const items = list.map((r) => ({
        id: String(r.id), title: String(r.title || ''), url: String(r.url || ''), domain: String(r.domain || ''), seen_at: iso(r.seen_at),
        place: r.place ? String(r.place) : null, lat: num(r.lat), lon: num(r.lon), country: countries.get(String(r.id)) || null
      })).filter((n) => n.title && /^https?:\/\//.test(n.url) && n.seen_at);
      const last = items[items.length - 1];
      return { items, next_before: items.length === limit && last ? `${last.seen_at}~${last.id}` : null };
    } catch { return { unavailable: true }; }
  });
  return answer(request, env, { ok: true, items: data.items || [], next_before: data.next_before || null, attribution: NEWS_ATTRIBUTION, ...(data.unavailable ? { unavailable: true } : {}) }, 60);
}

/* ---------- the heat map ----------
   Owner, 2026-10-21: "instead of pins on the map ... aggregate each mention of a state or country with a heat map of how
   many articles or mentions it has". GET /v1/world/news-heat counts the stories of the last HEAT_HOURS by the country each
   one mentions (ISO 3166-1, from GDELT's FIPS, as the feed names it). With ?country=XX it gives that country's stories as
   places instead, counted on a HEAT_CELL grid, so the globe can count them by state with the state shapes it already has.
   Only counts and rounded places leave here: no title, link or id. It reads our own table, a page at a time up to
   HEAT_PAGES (capped says when there were more), is kept five minutes per data centre, and answers 200 with nothing when
   the database cannot.
   THE COUNTRY CARD (owner, 2026-10-21: "how many users are from there, and like how many news articles are from there right
   now ... how many posts from users are there"): the whole-world answer also carries posts, the public, top-level member posts
   their authors placed in each country (the place scope's opt-in, network_posts.country_code). That column exists only once
   the place scope is switched on (WORLD_PLACE_SCOPE_ENABLED); until then posts is null, never a made-up zero. Members are
   not counted here: the only consented count is action_globe_public_regions (five or more per region), which the globe
   already reads. */
const HEAT_HOURS = 24, HEAT_PAGE = 1000, HEAT_PAGES = 15, HEAT_CELL = 0.05, POST_PAGES = 5;
/* public, top-level, standing member posts placed in each country; null while the place scope is off or unreadable */
async function placedPosts(env, fetchImpl) {
  if (!placeScopeEnabled(env)) return null;
  try {
    const params = new URLSearchParams({ select: 'country_code', country_code: 'not.is.null', visibility: 'eq.public', deleted_at: 'is.null', removed_at: 'is.null', reply_to_id: 'is.null', group_id: 'is.null', order: 'id.asc', limit: String(HEAT_PAGE) });
    const out = {};
    for (let page = 0; page < POST_PAGES; page++) {
      params.set('offset', String(page * HEAT_PAGE));
      const { res, body } = await timed(fetchImpl, `${env.SUPABASE_URL}/rest/v1/network_posts?${params}`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }
      });
      if (!res.ok) return null;
      const got = JSON.parse(body || '[]');
      if (!Array.isArray(got)) return null;
      for (const r of got) { const c = r && typeof r.country_code === 'string' && /^[A-Z]{2}$/.test(r.country_code) ? r.country_code : null; if (c) out[c] = (out[c] || 0) + 1; }
      if (got.length < HEAT_PAGE) break;
    }
    return out;
  } catch { return null; }
}
export async function handleWorldNewsHeat(request, env, { fetchImpl = fetch, cacheImpl = null, now = () => Date.now() } = {}) {
  const url = new URL(request.url);
  if ((url.pathname.replace(/\/+$/, '') || '/') !== NEWS_HEAT_PATH) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(request, env, 'Method not allowed', 405);
  const raw = url.searchParams.get('country');
  if (raw !== null && !/^[A-Z]{2}$/.test(raw)) return fail(request, env, 'country must be an ISO 3166-1 alpha-2 code', 400);
  const country = raw, configured = env && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY;
  /* the window moves on with the cache: one key per five minutes */
  const slot = Math.floor(now() / 300e3);
  const key = `https://cache.mccluster.internal/world/news-heat?country=${country || ''}&slot=${slot}`;
  const data = await keptOrFetched(cacheImpl, key, 300e3, async () => {
    if (!configured) return { unavailable: true };
    try {
      const since = new Date(slot * 300e3 - HEAT_HOURS * 3600e3).toISOString();
      const fips = country ? gdeltCodesFor(country) : [];
      const params = new URLSearchParams({ select: country ? 'headline_latitude,headline_longitude' : 'location_country_fips', ingestion_provider: 'eq.gdelt_gkg_v2', published_at: 'gte.' + since, order: 'id.asc', limit: String(HEAT_PAGE) });
      if (country) params.set('location_country_fips', fips.length > 1 ? 'in.(' + fips.join(',') + ')' : 'eq.' + fips[0]);
      const rows = [];
      for (let page = 0; page < HEAT_PAGES; page++) {
        params.set('offset', String(page * HEAT_PAGE));
        const { res, body } = await timed(fetchImpl, `${env.SUPABASE_URL}/rest/v1/media_news_articles?${params}`, {
          headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' }
        });
        if (!res.ok) throw new Error('news heat ' + res.status);
        const got = JSON.parse(body || '[]');
        if (!Array.isArray(got)) throw new Error('news heat: not a list');
        rows.push(...got);
        if (got.length < HEAT_PAGE) break;
      }
      const capped = rows.length >= HEAT_PAGE * HEAT_PAGES;
      if (!country) {
        const countries = {};
        let total = 0;
        for (const r of rows) { const c = isoFromGdelt(r && r.location_country_fips); if (!c) continue; countries[c] = (countries[c] || 0) + 1; total++; }
        return { countries, total, capped, posts: await placedPosts(env, fetchImpl) };
      }
      const cells = new Map();
      let total = 0;
      for (const r of rows) {
        const lat = num(r && r.headline_latitude), lon = num(r && r.headline_longitude);
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
        const x = Math.round(lon / HEAT_CELL) * HEAT_CELL, y = Math.round(lat / HEAT_CELL) * HEAT_CELL, k = x.toFixed(2) + '|' + y.toFixed(2);
        cells.set(k, (cells.get(k) || 0) + 1); total++;
      }
      return { country, cells: [...cells].map(([k, n]) => { const [x, y] = k.split('|').map(Number); return [x, y, n]; }), total, capped };
    } catch { return { unavailable: true }; }
  });
  return answer(request, env, { ok: true, window_hours: HEAT_HOURS, cell_degrees: country ? HEAT_CELL : undefined, ...data, attribution: NEWS_ATTRIBUTION }, 300);
}
