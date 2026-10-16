/* THE WORLD'S NEWS FROM GDELT (owner, 2026-10-15: "GDELT news as the feed ... we gotta ingest it so it's still from
   us", then "ingest the GDELT immediately"): GDELT's 15-minute GKG file is read once, screened, and ~100 articles with
   one place each go to our tables; the World reads them only from us, with GDELT credited. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { workersFetch } from './support/workers-fetch-semantics.mjs';
import {
  parseRecord, bestPlace, selectArticles, cleanTitle, storyKey, decodeEntities, parseGkgFile, inflateZipText, gkgRecords,
  parseLastUpdate, earlierSlots, downloadGkg, ingestGdeltNews, handleWorldNews, toPayload, GDELT_HOSTS, NEWS_ATTRIBUTION
} from '../src/world-news.js';

const KEY = 'service-role-SECRET';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: KEY, ALLOWED_ORIGINS: 'https://matthew.mccluster.org', WORLD_NEWS_INGEST_ENABLED: 'true' };

/* a GKG 2.1 record: 27 tab-separated columns */
function gkg({ id = '20261015220000-1', date = '20261015220000', coll = '1', domain = 'standardmedia.co.ke', url = 'https://www.standardmedia.co.ke/a1', themes = 'GENERAL_HEALTH;MEDICAL', locs = '4#Nairobi, Nairobi Area, Kenya#KE#KE05##-1.28333#36.8167#-2231054#120', tone = '1.43,3,1.5,4.5,20,0,600', image = 'https://img.example/a.jpg', translation = '', title = 'Why the milk crisis solution fell flat in Kenya', pub = '20261015180000' } = {}) {
  const c = new Array(27).fill('');
  c[0] = id; c[1] = date; c[2] = coll; c[3] = domain; c[4] = url; c[7] = themes; c[10] = locs; c[15] = tone; c[18] = image; c[25] = translation;
  c[17] = 'wc:600,c1.1:2,' + 'x'.repeat(3000); /* GCAM runs long in real files */
  c[26] = `<PAGE_LINKS>https://a.example;https://b.example</PAGE_LINKS><PAGE_TITLE>${title}</PAGE_TITLE>${pub ? `<PAGE_PRECISEPUBTIMESTAMP>${pub}</PAGE_PRECISEPUBTIMESTAMP>` : ''}`;
  return c.join('\t');
}
/* a single-entry zip as GDELT ships it (deflate, sizes in the local header); dd=true moves the sizes to the central directory */
function zip(text, { dd = false } = {}) {
  const data = deflateRawSync(Buffer.from(text, 'utf8'));
  const name = Buffer.from('20261015220000.gkg.csv');
  const extra = Buffer.alloc(28);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(dd ? 0x8 : 0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(dd ? 0 : data.length, 18); local.writeUInt32LE(dd ? 0 : Buffer.byteLength(text), 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
  const cdOffset = local.length + name.length + extra.length + data.length;
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(Buffer.byteLength(text), 24); cd.writeUInt16LE(name.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return new Uint8Array(Buffer.concat([local, name, extra, data, cd, name, eocd]));
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function memoryCache() { const m = new Map(); return { async match(k) { const v = m.get(k.url); return v ? new Response(v) : undefined; }, async put(k, r) { m.set(k.url, await r.text()); }, raw: m }; }

test('a record becomes one candidate: title cleaned, one place, seen time from the file, tone', () => {
  const { rec } = parseRecord(gkg({ title: 'Lady Gaga &amp; Fianc&#xE9; <em>wed</em> in Nairobi | Standard Media' }));
  assert.equal(rec.title, 'Lady Gaga & Fiancé wed in Nairobi');
  assert.equal(rec.domain, 'standardmedia.co.ke');
  assert.equal(rec.seen_at, '2026-10-15T22:00:00.000Z');
  assert.deepEqual(rec.place, { place: 'Nairobi, Nairobi Area, Kenya', lat: -1.28333, lon: 36.8167, type: 4, country_fips: 'KE' });
  assert.equal(rec.tone, 1.43);
  assert.equal('themes' in rec, false, 'a kept record carries a flag, not its themes');
  assert.equal(rec.hard, false);
});

test('the screens: web only, untranslated, no wires or ticker mills, English, not graphic, not stale', () => {
  const skip = (o) => parseRecord(gkg(o)).skip;
  assert.equal(skip({ coll: '2' }), 'not_web');
  assert.equal(skip({ id: '20261015220000-T7' }), 'translated');
  assert.equal(skip({ translation: 'srclc:spa;eng:GT-SPA 1.0' }), 'translated');
  assert.equal(skip({ domain: 'prnewswire.com', url: 'https://www.prnewswire.com/x' }), 'domain');
  assert.equal(skip({ domain: 'news.tickerreport.com', url: 'https://news.tickerreport.com/x' }), 'domain');
  assert.equal(skip({ domain: 'homelandsecuritynewswire.com', url: 'https://homelandsecuritynewswire.com/x' }), 'domain');
  assert.equal(skip({ title: 'ARM (NASDAQ:ARM) Shares Climb 2.8% - Time to Buy?' }), 'ticker');
  assert.equal(skip({ title: '台北市長選舉 最新 民調 結果 公布 今天' }), 'language');
  assert.equal(skip({ themes: 'RAPE;GENERAL_GOVERNMENT', title: 'Court hears case against former coach' }), 'graphic');
  assert.equal(skip({ themes: 'KILL;CRISISLEX_T03_DEAD', title: 'Three killed as gunman opens fire at market' }), 'graphic');
  assert.ok(parseRecord(gkg({ themes: 'KILL;CRISISLEX_T03_DEAD', title: 'City council debates new road safety plan' })).rec, 'a hard theme alone does not drop a story');
  assert.equal(skip({ pub: '20261012180000' }), 'old', 'published more than 72 hours before GDELT saw it');
  assert.ok(parseRecord(gkg({ pub: '20261015000000' })).rec, 'a placeholder midnight within the window is fine');
  assert.equal(skip({ title: 'Too short' }), 'title');
  assert.equal(parseRecord('a\tb').skip, 'shape');
});

test('a hard theme keeps the story but never its image', () => {
  const { rec } = parseRecord(gkg({ themes: 'KILL;ELECTION', title: 'Voters head to the polls after a tense campaign' }));
  assert.equal(rec.hard, true);
  assert.equal(toPayload(rec).image, null);
  assert.equal(toPayload(parseRecord(gkg()).rec).image, 'https://img.example/a.jpg');
});

test('one place: the most mentioned, narrowed to the city it mentions most inside it; a country keeps no label', () => {
  const kenya = '1#Kenya#KE###-1#38#KE#10;1#Kenya#KE###-1#38#KE#40;1#Kenyan#KE###-1#38#KE#90;4#Nairobi, Nairobi Area, Kenya#KE#KE05##-1.28333#36.8167#-2231054#200';
  assert.equal(bestPlace(kenya).place, 'Nairobi, Nairobi Area, Kenya', 'country mentioned most, narrowed to its city');
  const oregon = '2#Oregon, United States#US#USOR##44.5672#-122.127#OR#46;2#Oregon, United States#US#USOR##44.5672#-122.127#OR#90;3#Portland, Oregon, United States#US#USOR##45.5235#-122.676#1136645#120;3#Seattle, Washington, United States#US#USWA##47.6062#-122.332#1512650#300';
  assert.equal(bestPlace(oregon).place, 'Portland, Oregon, United States', 'a state narrows only to a city inside it');
  const only = bestPlace('1#Australian#AS###-25#135#AS#12');
  assert.equal(only.place, null); assert.equal(only.type, 1); assert.equal(only.lat, -25);
  assert.equal(bestPlace('4#Null Island#XX###0#0#1#5'), null, '0,0 is no place');
  assert.equal(bestPlace('4#Bad#XX###95#10#1#5'), null);
  assert.equal(bestPlace(''), null);
});

test('about 100 a file: one copy of a syndicated story, three per publisher, cities first', () => {
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push({ ...parseRecord(gkg({ domain: 'iheart.com', url: `https://kiss${i}.iheart.com/s`, title: `Same syndicated story about the storm - KISS ${i}` })).rec });
  for (let i = 0; i < 5; i++) recs.push({ ...parseRecord(gkg({ domain: 'news4jax.com', url: `https://www.news4jax.com/${i}`, title: `Jacksonville story number ${i} for the evening news` })).rec });
  recs.push({ ...parseRecord(gkg({ domain: 'country.example', url: 'https://country.example/1', title: 'A country level story about Australia today', locs: '1#Australia#AS###-25#135#AS#12' })).rec });
  const out = selectArticles(recs);
  assert.equal(out.filter((r) => r.domain === 'iheart.com').length, 1, 'syndicated copies collapse to one');
  assert.equal(out.filter((r) => r.domain === 'news4jax.com').length, 3, 'three per publisher');
  assert.equal(out[out.length - 1].domain, 'country.example', 'a country-only story ranks after cities');
  assert.equal(storyKey('Storm hits coast | WSB'), storyKey('Storm hits coast - KISS 95'));
  const many = Array.from({ length: 300 }, (_, i) => ({ ...parseRecord(gkg({ domain: `d${i}.com`, url: `https://d${i}.com/x`, title: `Distinct headline number ${i} about the day` })).rec }));
  assert.equal(selectArticles(many).length, 100);
});

test('titles: entities, tags and a site tail; storyKey ignores punctuation and tails', () => {
  assert.equal(decodeEntities('Fianc&#xE9; &#x2013; &#8212; &nbsp;&amp;'), 'Fiancé – —  &');
  assert.equal(decodeEntities('&#xD800; &bogus;'), '&#xD800; &bogus;');
  assert.equal(cleanTitle('Canaletto <em>Capriccio </em> sells | The Art Newspaper'), 'Canaletto Capriccio sells');
  assert.equal(cleanTitle('Policy A | B | C'), 'Policy A | B');
  assert.equal(cleanTitle('KFOR | Oklahoma City council approves a new park budget'), 'KFOR | Oklahoma City council approves a new park budget', 'a leading site name keeps the headline');
  const astral = 'a'.repeat(249) + '\u{1F4F0}' + 'tail';
  const cut = toPayload({ ...parseRecord(gkg()).rec, title: astral }).title;
  assert.equal(Array.from(cut).length, 250);
  assert.doesNotThrow(() => encodeURIComponent(cut), 'never a lone surrogate, which jsonb would refuse for the whole file');
});

test('a hard crime theme with a graphic headline is out', () => {
  assert.equal(parseRecord(gkg({ themes: 'SOC_GENERALCRIME;TAX_FNCACT_KILLER', title: 'Man killed in late-night shooting downtown, police say' })).skip, 'graphic');
  assert.ok(parseRecord(gkg({ themes: 'SOC_GENERALCRIME', title: 'Council votes to fund more crossing guards near schools' })).rec);
});

test('the file: a GDELT zip inflates as a stream, records with a raw newline are joined, and ~100 survive', async () => {
  const lines = [gkg(), gkg({ id: '20261015220000-2', url: 'https://www.standardmedia.co.ke/a2', title: 'Second headline with a\nbroken line inside it', domain: 'standardmedia.co.ke' }), gkg({ id: '20261015220000-3', coll: '2' })];
  const text = lines.join('\n') + '\n';
  for (const dd of [false, true]) {
    const { articles, stats } = await parseGkgFile(zip(text, { dd }));
    assert.equal(stats.rows, 3);
    assert.equal(stats.skipped.not_web, 1);
    assert.equal(articles.length, 2);
    assert.equal(articles[1].title, 'Second headline with a broken line inside it');
    assert.deepEqual(Object.keys(articles[0]).sort(), ['country_fips', 'domain', 'image', 'lat', 'location_type', 'lon', 'place', 'seen_at', 'story_key', 'title', 'tone', 'url']);
    assert.equal(articles[0].story_key, storyKey(articles[0].title), 'the database dedupes syndicated copies across files on this key');
  }
  let n = 0;
  for await (const r of gkgRecords(inflateZipText(zip(text)))) { n++; assert.match(r, /^20261015220000-\d\t/); }
  assert.equal(n, 3);
  assert.throws(() => inflateZipText(new Uint8Array([1, 2, 3])), /not a zip/);
});

test('lastupdate.txt names the GKG file; the slots before it cross hours and days', () => {
  const t = '4950 aa http://data.gdeltproject.org/gdeltv2/20261015220000.export.CSV.zip\n9000 bb http://data.gdeltproject.org/gdeltv2/20261015220000.mentions.CSV.zip\n5635182 cc http://data.gdeltproject.org/gdeltv2/20261015220000.gkg.csv.zip\n';
  assert.deepEqual(parseLastUpdate(t), { name: '20261015220000.gkg.csv.zip', size: 5635182 });
  assert.equal(parseLastUpdate('nothing here'), null);
  assert.deepEqual(earlierSlots('20261016001500.gkg.csv.zip', 3), ['20261016000000.gkg.csv.zip', '20261015234500.gkg.csv.zip', '20261015233000.gkg.csv.zip']);
});

test("a file GDELT's own host answers 404 for comes from its Cloud Storage mirror; a short file is refused", async () => {
  const z = zip(gkg() + '\n');
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return url.startsWith(GDELT_HOSTS[0]) ? new Response('', { status: 404 }) : new Response(z); };
  const got = await downloadGkg('20261015220000.gkg.csv.zip', z.byteLength, fetchImpl);
  assert.equal(got.byteLength, z.byteLength);
  assert.deepEqual(calls, [GDELT_HOSTS[0] + '20261015220000.gkg.csv.zip', GDELT_HOSTS[1] + '20261015220000.gkg.csv.zip']);
  await assert.rejects(() => downloadGkg('20261015220000.gkg.csv.zip', z.byteLength + 5, async () => new Response(z)), /size/);
  await assert.rejects(() => downloadGkg('20261015220000.gkg.csv.zip', null, async () => new Response('', { status: 404 })), /404/);
});

/* ---------- the cron ---------- */
function world({ claim = () => true, provisioned = true, gdeltDown = false, ingestFails = false } = {}) {
  const z = zip([gkg(), gkg({ id: '20261015220000-2', url: 'https://www.news4jax.com/a2', domain: 'news4jax.com', title: 'Jacksonville council approves new park budget', locs: '3#Jacksonville, Florida, United States#US#USFL##30.3322#-81.6556#295001#50' })].join('\n') + '\n');
  const rpc = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt') return gdeltDown ? new Response('', { status: 503 }) : new Response(`${z.byteLength} cc http://data.gdeltproject.org/gdeltv2/20261015220000.gkg.csv.zip\n`);
    if (u.endsWith('.gkg.csv.zip')) return new Response(z);
    const m = u.match(/^https:\/\/sb\.test\/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      const args = JSON.parse(init.body);
      rpc.push({ name: m[1], args, auth: init.headers.authorization });
      if (!provisioned) return json({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      if (m[1] === 'media_gdelt_file_claim') return json(claim(args.p_file));
      if (m[1] === 'media_ingest_gdelt_gkg') return ingestFails ? json({ message: 'boom' }, 500) : json({ file: args.p_file, received: args.p_articles.length, saved: args.p_articles.length });
      if (m[1] === 'media_news_prune') return json(3);
      if (m[1] === 'media_gdelt_file_release') return json(null);
    }
    throw new Error('unexpected ' + u);
  };
  return { fetchImpl, rpc };
}

test('the cron reads the newest file and one before it, claims each, and sends the articles as the service role', async () => {
  const w = world();
  const report = await ingestGdeltNews(ENV, { fetchImpl: w.fetchImpl, scheduledTime: Date.UTC(2026, 9, 15, 22, 10) });
  assert.equal(report.pruned, null, 'prune runs only in the first five minutes of an hour');
  assert.equal(report.files.filter((f) => f.ingested).length, 2);
  const claims = w.rpc.filter((r) => r.name === 'media_gdelt_file_claim').map((r) => r.args.p_file);
  assert.deepEqual(claims, ['20261015220000.gkg.csv.zip', '20261015214500.gkg.csv.zip']);
  const ingest = w.rpc.find((r) => r.name === 'media_ingest_gdelt_gkg');
  assert.equal(ingest.auth, `Bearer ${KEY}`);
  assert.equal(ingest.args.p_rows_seen, 2);
  assert.equal(ingest.args.p_articles.length, 2);
  assert.deepEqual(ingest.args.p_articles.map((a) => a.place), ['Nairobi, Nairobi Area, Kenya', 'Jacksonville, Florida, United States']);
});

test('a file already read is skipped; the hour before fills in; the hourly tick prunes a week', async () => {
  const w = world({ claim: (f) => f !== '20261015220000.gkg.csv.zip' });
  const report = await ingestGdeltNews(ENV, { fetchImpl: w.fetchImpl, scheduledTime: Date.UTC(2026, 9, 15, 23, 2) });
  assert.equal(report.pruned, 3);
  assert.deepEqual(w.rpc.find((r) => r.name === 'media_news_prune').args, { p_keep_days: 7 });
  assert.deepEqual(report.files.map((f) => f.name), ['20261015214500.gkg.csv.zip', '20261015213000.gkg.csv.zip']);
});

test('a failed ingest releases its claim; a GDELT outage or a missing migration costs nothing', async () => {
  const failing = world({ ingestFails: true });
  const r1 = await ingestGdeltNews(ENV, { fetchImpl: failing.fetchImpl, scheduledTime: Date.UTC(2026, 9, 15, 22, 10) });
  assert.equal(r1.files.every((f) => !f.ingested), true);
  assert.equal(failing.rpc.filter((r) => r.name === 'media_gdelt_file_release').length, 3, 'three tries at most a tick');
  const down = world({ gdeltDown: true });
  const r2 = await ingestGdeltNews(ENV, { fetchImpl: down.fetchImpl, scheduledTime: Date.UTC(2026, 9, 15, 22, 10) });
  assert.match(r2.error, /lastupdate 503/);
  assert.equal(down.rpc.length, 0);
  const bare = world({ provisioned: false });
  assert.deepEqual(await ingestGdeltNews(ENV, { fetchImpl: bare.fetchImpl, scheduledTime: Date.UTC(2026, 9, 15, 23, 1) }), { skipped: 'not provisioned' });
  assert.equal((await ingestGdeltNews(ENV, { fetchImpl: bare.fetchImpl, scheduledTime: Date.UTC(2026, 9, 15, 22, 10) })).skipped, 'not provisioned');
  assert.deepEqual(await ingestGdeltNews({ WORLD_NEWS_INGEST_ENABLED: 'true' }, {}), { skipped: 'not configured' });
});

test('the ingest is off until WORLD_NEWS_INGEST_ENABLED is "true": no GDELT request, no Supabase call', async () => {
  for (const flag of [undefined, 'false', '', 'yes', 'TRUE ']) {
    const w = world();
    const calls = [];
    const env = { ...ENV, WORLD_NEWS_INGEST_ENABLED: flag };
    const report = await ingestGdeltNews(env, { fetchImpl: async (u, i) => { calls.push(u); return w.fetchImpl(u, i); }, scheduledTime: Date.UTC(2026, 9, 15, 23, 1) });
    if (flag === 'TRUE ') { assert.equal(report.files.length > 0, true, 'any case, surrounding spaces ignored'); continue; }
    assert.deepEqual(report, { skipped: 'disabled' }, `flag ${JSON.stringify(flag)}`);
    assert.equal(calls.length, 0);
  }
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^WORLD_NEWS_INGEST_ENABLED = "true"$/m, 'deployed on: the SQL is applied in production (20261016151123)');
});

test("every fetch is one workerd accepts, and a redirect is followed only between GDELT's two hosts", async () => {
  const z = zip(gkg() + '\n');
  const w = world();
  const report = await ingestGdeltNews(ENV, { fetchImpl: workersFetch(w.fetchImpl), scheduledTime: Date.UTC(2026, 9, 15, 23, 1) });
  assert.equal(report.files.filter((f) => f.ingested).length, 2, 'the whole tick runs under workerd fetch rules');
  const moved = async (url) => (String(url).startsWith(GDELT_HOSTS[0]) ? new Response('', { status: 302, headers: { location: GDELT_HOSTS[1] + '20261015220000.gkg.csv.zip' } }) : new Response(z));
  assert.equal((await downloadGkg('20261015220000.gkg.csv.zip', z.byteLength, workersFetch(moved))).byteLength, z.byteLength, 'GDELT to its mirror is followed');
  const away = async (url) => new Response('', { status: 302, headers: { location: 'https://evil.example/x.zip' } });
  await assert.rejects(() => downloadGkg('20261015220000.gkg.csv.zip', null, workersFetch(away)), /upstream_redirect/, 'anywhere else is refused');
});

/* ---------- the routes ---------- */
const ROWS = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Why the milk crisis solution fell flat', url: 'https://www.standardmedia.co.ke/a1', domain: 'standardmedia.co.ke', seen_at: '2026-10-15T22:00:00+00:00', place: 'Nairobi, Nairobi Area, Kenya', lat: -1.28333, lon: 36.8167 },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Jacksonville council approves new park budget', url: 'https://www.news4jax.com/a2', domain: 'news4jax.com', seen_at: '2026-10-15T22:00:00+00:00', place: null, lat: null, lon: null }
];
function db({ fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const name = String(url).split('/rpc/')[1];
    calls.push({ name, args: JSON.parse(init.body), auth: init.headers.authorization });
    if (fail) return json({ message: 'down' }, 500);
    if (name === 'media_world_news') return json(ROWS.slice(0, JSON.parse(init.body).p_limit));
    if (name === 'media_world_news_places') return json([{ place: 'Nairobi, Nairobi Area, Kenya', lat: -1.28, lon: 36.82, count: '7', title: 'Latest there', url: 'https://x.example/1', seen_at: '2026-10-15T22:00:00+00:00' }, { place: 'Nowhere', lat: null, lon: 1, count: 2, title: 't', url: 'javascript:alert(1)' }]);
    throw new Error('unexpected ' + name);
  };
  return { fetchImpl, calls };
}
const get = (path) => new Request(`https://api.mccluster.org${path}`, { headers: { origin: 'https://matthew.mccluster.org' } });

test('GET /v1/world/news: newest first from our tables, an opaque cursor, GDELT credited, the service key never shown', async () => {
  const d = db();
  const res = await handleWorldNews(get('/v1/world/news?limit=2'), ENV, { fetchImpl: d.fetchImpl, cacheImpl: memoryCache() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org');
  const body = await res.json();
  assert.deepEqual(body.attribution, NEWS_ATTRIBUTION);
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.items[0], { id: ROWS[0].id, title: ROWS[0].title, url: ROWS[0].url, domain: ROWS[0].domain, seen_at: '2026-10-15T22:00:00.000Z', place: ROWS[0].place, lat: -1.28333, lon: 36.8167 });
  assert.equal(body.next_before, `2026-10-15T22:00:00.000Z~${ROWS[1].id}`);
  assert.deepEqual(d.calls[0].args, { p_before_at: null, p_before_id: null, p_limit: 2 });
  assert.equal(JSON.stringify(body).includes(KEY), false);
  const next = await handleWorldNews(get(`/v1/world/news?limit=20&before=${encodeURIComponent(body.next_before)}`), ENV, { fetchImpl: d.fetchImpl, cacheImpl: memoryCache() });
  assert.deepEqual(d.calls[1].args, { p_before_at: '2026-10-15T22:00:00.000Z', p_before_id: ROWS[1].id, p_limit: 20 });
  assert.equal((await next.json()).next_before, null, 'a short page is the last');
});

test('GET /v1/world/news: limits and cursors are checked; a database problem is an empty, honest 200', async () => {
  const d = db();
  for (const q of ['limit=0', 'limit=51', 'limit=abc', 'before=2026-10-15', 'before=nope~x', 'before=2026-13-45T99:00:00Z~11111111-1111-4111-8111-111111111111', 'before=2026-02-30T00:00:00Z~11111111-1111-4111-8111-111111111111', 'before=0000-01-01T00:00:00Z~11111111-1111-4111-8111-111111111111']) {
    assert.equal((await handleWorldNews(get(`/v1/world/news?${q}`), ENV, { fetchImpl: d.fetchImpl, cacheImpl: memoryCache() })).status, 400, q);
  }
  assert.equal(d.calls.length, 0);
  const down = await (await handleWorldNews(get('/v1/world/news'), ENV, { fetchImpl: db({ fail: true }).fetchImpl, cacheImpl: memoryCache() })).json();
  assert.deepEqual({ items: down.items, next_before: down.next_before, unavailable: down.unavailable }, { items: [], next_before: null, unavailable: true });
  const bare = await (await handleWorldNews(get('/v1/world/news'), { ALLOWED_ORIGINS: ENV.ALLOWED_ORIGINS }, { cacheImpl: memoryCache() })).json();
  assert.equal(bare.unavailable, true);
  assert.equal((await handleWorldNews(new Request('https://api.mccluster.org/v1/world/news', { method: 'POST' }), ENV)).status, 405);
  assert.equal(await handleWorldNews(get('/v1/world/newsy'), ENV), null);
});

test('a minute of the same page is served from the data centre; a failure is never kept', async () => {
  const d = db(), cache = memoryCache();
  await handleWorldNews(get('/v1/world/news'), ENV, { fetchImpl: d.fetchImpl, cacheImpl: cache });
  await handleWorldNews(get('/v1/world/news'), ENV, { fetchImpl: d.fetchImpl, cacheImpl: cache });
  assert.equal(d.calls.length, 1);
  const f = db({ fail: true }), c2 = memoryCache();
  await handleWorldNews(get('/v1/world/news'), ENV, { fetchImpl: f.fetchImpl, cacheImpl: c2 });
  await handleWorldNews(get('/v1/world/news'), ENV, { fetchImpl: f.fetchImpl, cacheImpl: c2 });
  assert.equal(f.calls.length, 2);
});

test('the globe layer is not answered here: it joins world-layers.js with the World\'s layer access', async () => {
  assert.equal(await handleWorldNews(get('/v1/world/layers/news'), ENV, { fetchImpl: db().fetchImpl, cacheImpl: memoryCache() }), null);
});

test('the dispatch and the cron hook are wired', async () => {
  const index = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const at = index.indexOf('if (path === NEWS_PATH) {');
  assert.ok(at > 0 && at < index.indexOf("path.startsWith('/v1/world/layers/')"), 'the news route sits above the layers block');
  assert.ok(at < index.indexOf('if (!configured(env))'));
  const entry = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  assert.match(entry, /ctx\.waitUntil\(observeScheduled\(env, ctx, 'world\.news_ingest', \(\) => ingestGdeltNews\(env, \{ scheduledTime: controller\?\.scheduledTime \}\)\)/);
  const src = await readFile(new URL('../src/world-news.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /redirect:\s*'(error|follow)'/, "redirects go through lib/safe-fetch.js");
  assert.match(src, /fetchNoCrossHostRedirect\(/);
});
