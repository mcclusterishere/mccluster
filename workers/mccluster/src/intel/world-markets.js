/* World markets for the owner's Halo globe (owner, 2026-11-02: "live financial markets on the globe ... click a country,
 * GDP, the stock market, the listed companies ... and news tied to that"). Owner-only: served from intel/router.js
 * behind the canonical house-owner gate, never a public route. No fetch on import. Not a new backend or store.
 *
 * Four honest kinds of number, never blurred:
 *  - GDP is published annual statistics (World Bank WDI actuals, IMF WEO current-year estimates). is_live is always false.
 *  - Exchanges are checked-in reference data (data/markets/exchanges.json); open/closed is the REGULAR SCHEDULE computed
 *    for now, not an exchange status feed (holidays, auctions and half days are not modeled).
 *  - Listings and quotes come from the configured market-data provider. With no key the answer is `needs_key`, with no
 *    entitlement it is `needs_paid_feed`; a price is never invented, interpolated or carried across exchanges.
 *  - Market news is stored GDELT headline metadata matched by finance keywords (not article text, not verified), plus the
 *    provider's own headlines when a key exists.
 *
 * Provider swap (owner, 2026-11-02: "start free, upgrade later"): MARKETS_PROVIDER selects an adapter below (default
 * finnhub, free tier). A paid global feed is `MARKETS_PROVIDER=eodhd` plus the EODHD_API_KEY secret: config, not a rebuild.
 * Keys travel only in the provider request (header for Finnhub, query for EODHD as that API requires); they never enter a
 * cache key, an error, a log line or a response.
 */
import EXCHANGE_DATA from '../../../../data/markets/exchanges.json' with { type: 'json' };
import { ContextReadError, contextJson } from './bounded-json.js';
import { ISO_TO_FIPS, isCountry } from './news-country-codes.js';
import { normalizeContextNews } from './news-context.js';

export const MARKETS_SCHEMA = 'world-markets/v1';
const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const SMALL = 524_288;            // quotes, profiles, news
const IMF_MAX = 1_048_576;        // one IMF indicator for every economy is ~120-180 KB
const SYMBOLS_MAX = 16_777_216;   // the whole US symbol list is several MB
const PAGE_MAX = 50, QUOTES_PER_PAGE = 8, PROVIDER_CALLS_PER_MINUTE = 50;

export class MarketsError extends Error {
  constructor(code, status = 400, message = code) { super(message); this.name = 'MarketsError'; this.code = code; this.status = status; }
}
const bad = (code, message) => new MarketsError(code, 400, message || code);

/* ---------- exchanges: static reference data, validated once at import (pure) ---------- */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
function validTimeZone(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
export function validateExchanges(doc) {
  if (!doc || doc.schema !== 'world-markets-exchanges/v1' || !Array.isArray(doc.exchanges) || !doc.exchanges.length) throw new MarketsError('invalid_exchange_dataset', 500);
  const seen = new Set();
  return Object.freeze(doc.exchanges.map(x => {
    const ok = x && /^[A-Z0-9]{4}$/.test(x.mic) && !seen.has(x.mic) && typeof x.name === 'string' && x.name && typeof x.city === 'string' &&
      isCountry(x.country) && Number.isFinite(x.lat) && Math.abs(x.lat) <= 90 && Number.isFinite(x.lon) && Math.abs(x.lon) <= 180 &&
      !(x.lat === 0 && x.lon === 0) && validTimeZone(x.timezone) && Array.isArray(x.days) && x.days.length && x.days.every(d => Number.isInteger(d) && d >= 1 && d <= 7) &&
      Array.isArray(x.sessions) && x.sessions.length && x.sessions.every(s => Array.isArray(s) && s.length === 2 && HHMM.test(s[0]) && HHMM.test(s[1]) && minutesOf(s[0]) < minutesOf(s[1])) &&
      x.sessions.every((s, i) => i === 0 || minutesOf(x.sessions[i - 1][1]) <= minutesOf(s[0])) && x.provider_codes && typeof x.provider_codes === 'object';
    if (!ok) throw new MarketsError('invalid_exchange_dataset', 500, 'Invalid exchange ' + (x && x.mic));
    seen.add(x.mic);
    return Object.freeze({ mic: x.mic, name: x.name, short: x.short || x.name, city: x.city, country: x.country, lat: x.lat, lon: x.lon,
      timezone: x.timezone, days: Object.freeze([...x.days]), sessions: Object.freeze(x.sessions.map(s => Object.freeze([...s]))),
      provider_codes: Object.freeze({ ...x.provider_codes }), provider_mic_filter: typeof x.provider_mic_filter === 'string' ? x.provider_mic_filter : null });
  }));
}
export const EXCHANGES = validateExchanges(EXCHANGE_DATA);
export const EXCHANGE_NOTES = Object.freeze({ coordinates: EXCHANGE_DATA.coordinates, hours: EXCHANGE_DATA.hours, version: EXCHANGE_DATA.version });
const EXCHANGE_BY_MIC = new Map(EXCHANGES.map(x => [x.mic, x]));
export const exchangesIn = iso2 => EXCHANGES.filter(x => x.country === iso2);

const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
export function localClock(timeZone, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(parts.hour) % 24, minute = Number(parts.minute);
  return { weekday: WEEKDAY[parts.weekday], minutes: hour * 60 + minute, time: String(hour).padStart(2, '0') + ':' + parts.minute, date: parts.year + '-' + parts.month + '-' + parts.day };
}
/* open/closed from the regular schedule only */
export function sessionState(exchange, now = new Date()) {
  const clock = localClock(exchange.timezone, now), tradingDay = exchange.days.includes(clock.weekday);
  const s = exchange.sessions.map(([a, b]) => [minutesOf(a), minutesOf(b)]);
  const open = tradingDay && s.some(([a, b]) => clock.minutes >= a && clock.minutes < b);
  const reason = open ? 'regular_session' : !tradingDay ? 'non_trading_day'
    : clock.minutes < s[0][0] ? 'before_open' : clock.minutes >= s[s.length - 1][1] ? 'after_close' : 'midday_break';
  return { state: open ? 'open' : 'closed', reason, local_time: clock.time, local_date: clock.date, basis: 'regular_schedule', holidays_modeled: false };
}
export function exchangeView(exchange, provider, now = new Date()) {
  const code = provider ? exchange.provider_codes[provider.id] || null : null;
  return { mic: exchange.mic, name: exchange.name, short: exchange.short, city: exchange.city, country: exchange.country,
    lat: exchange.lat, lon: exchange.lon, timezone: exchange.timezone, sessions: exchange.sessions, days: exchange.days,
    session: sessionState(exchange, now),
    listings: { provider: provider ? provider.id : null, covered: !!code,
      quotes: !code ? 'not_covered' : provider.quoteCoverage(exchange) } };
}

/* ---------- providers ---------- */
const COMMON = new Set(['Common Stock', 'common stock', 'Equity', 'EQS']);
function cleanText(v, max = 200) {
  return typeof v === 'string' ? v.slice(0, max * 2).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function httpsLink(v) {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
const unixIso = t => (Number.isFinite(t) && t > 0 && t < 1e11 ? new Date(t * 1000).toISOString() : null);

const FINNHUB = Object.freeze({
  id: 'finnhub', label: 'Finnhub', secret: 'FINNHUB_API_KEY', tier: 'free', site: 'https://finnhub.io/', terms: 'https://finnhub.io/terms-of-service',
  coverage_note: 'Free tier: every listed security per exchange; quotes for US listings only. Non-US prices need a paid feed.',
  request(path, params, key) {
    const url = new URL('https://finnhub.io/api/v1' + path); url.search = new URLSearchParams(params).toString();
    return { url: url.href, headers: { accept: 'application/json', 'x-finnhub-token': key } };
  },
  quoteCoverage: ex => (ex.provider_codes.finnhub === 'US' ? 'available' : 'needs_paid_feed'),
  symbols(code, key) { return this.request('/stock/symbol', { exchange: code }, key); },
  normalizeSymbols(rows) {
    if (!Array.isArray(rows)) throw new ContextReadError('invalid_provider_response');
    return rows.flatMap(r => {
      const symbol = typeof r?.symbol === 'string' ? r.symbol.trim() : '';
      if (!SYMBOL_RE.test(symbol)) return [];
      return [[symbol, cleanText(r.displaySymbol, 32) || symbol, cleanText(r.description, 140), cleanText(r.type, 40), cleanText(r.mic, 8), cleanText(r.currency, 8)]];
    });
  },
  quote(symbol, key) { return this.request('/quote', { symbol }, key); },
  normalizeQuote(q) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new ContextReadError('invalid_provider_response');
    const price = num(q.c), at = unixIso(q.t);
    // Finnhub answers an unknown or unentitled symbol with zeros, not an error.
    if (!price || !at) return null;
    return { price, change: num(q.d), change_pct: num(q.dp), previous_close: num(q.pc), open: num(q.o), high: num(q.h), low: num(q.l), as_of: at };
  },
  profile(symbol, key) { return this.request('/stock/profile2', { symbol }, key); },
  normalizeProfile(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ContextReadError('invalid_provider_response');
    if (!p.name && !p.ticker) return null;
    const cap = num(p.marketCapitalization);
    return { name: cleanText(p.name, 140) || null, ticker: cleanText(p.ticker, 32) || null, industry: cleanText(p.finnhubIndustry, 80) || null,
      country: /^[A-Z]{2}$/.test(p.country || '') ? p.country : null, currency: cleanText(p.currency, 8) || null,
      exchange: cleanText(p.exchange, 120) || null, ipo: /^\d{4}-\d{2}-\d{2}$/.test(p.ipo || '') ? p.ipo : null,
      market_cap: cap === null ? null : { value: cap * 1e6, unit: p.currency ? cleanText(p.currency, 8) : null, basis: 'provider_reported' },
      shares_outstanding: num(p.shareOutstanding) === null ? null : p.shareOutstanding * 1e6, website: httpsLink(p.weburl) };
  },
  companyNews(symbol, from, to, key) { return this.request('/company-news', { symbol, from, to }, key); },
  generalNews(key) { return this.request('/news', { category: 'general' }, key); },
  normalizeNews(rows) {
    if (!Array.isArray(rows)) throw new ContextReadError('invalid_provider_response');
    return rows.slice(0, 50).flatMap(r => {
      const title = cleanText(r?.headline, 300), url = httpsLink(r?.url), at = unixIso(r?.datetime);
      return title && url && at ? [{ title, url, source: cleanText(r.source, 80) || new URL(url).hostname, published_at: at, content_scope: 'headline_metadata_only' }] : [];
    }).slice(0, 12);
  }
});

const EODHD = Object.freeze({
  id: 'eodhd', label: 'EODHD', secret: 'EODHD_API_KEY', tier: 'paid', site: 'https://eodhd.com/', terms: 'https://eodhd.com/financial-apis/terms-conditions',
  coverage_note: 'Paid global feed: listings and delayed quotes for every covered exchange. Exchange codes must be confirmed before switching.',
  request(path, params, key) {
    const url = new URL('https://eodhd.com/api' + path); url.search = new URLSearchParams({ ...params, api_token: key, fmt: 'json' }).toString();
    return { url: url.href, headers: { accept: 'application/json' } };
  },
  quoteCoverage: () => 'available',
  symbols(code, key) { return this.request('/exchange-symbol-list/' + encodeURIComponent(code), {}, key); },
  normalizeSymbols(rows, code) {
    if (!Array.isArray(rows)) throw new ContextReadError('invalid_provider_response');
    return rows.flatMap(r => {
      const base = typeof r?.Code === 'string' ? r.Code.trim() : '', symbol = base + '.' + code;
      if (!base || !SYMBOL_RE.test(symbol)) return [];
      return [[symbol, base, cleanText(r.Name, 140), cleanText(r.Type, 40), '', cleanText(r.Currency, 8)]];
    });
  },
  quote(symbol, key) { return this.request('/real-time/' + encodeURIComponent(symbol), {}, key); },
  normalizeQuote(q) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new ContextReadError('invalid_provider_response');
    const price = num(q.close), at = unixIso(q.timestamp);
    if (!price || !at) return null;
    return { price, change: num(q.change), change_pct: num(q.change_p), previous_close: num(q.previousClose), open: num(q.open), high: num(q.high), low: num(q.low), as_of: at };
  },
  profile(symbol, key) { return this.request('/fundamentals/' + encodeURIComponent(symbol), { filter: 'General' }, key); },
  normalizeProfile(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || (!p.Name && !p.Code)) return null;
    return { name: cleanText(p.Name, 140) || null, ticker: cleanText(p.Code, 32) || null, industry: cleanText(p.Industry || p.Sector, 80) || null,
      country: /^[A-Z]{2}$/.test(p.CountryISO || '') ? p.CountryISO : null, currency: cleanText(p.CurrencyCode, 8) || null,
      exchange: cleanText(p.Exchange, 120) || null, ipo: /^\d{4}-\d{2}-\d{2}$/.test(p.IPODate || '') ? p.IPODate : null,
      market_cap: null, shares_outstanding: null, website: httpsLink(p.WebURL) };
  },
  companyNews(symbol, from, to, key) { return this.request('/news', { s: symbol, from, to, limit: '12' }, key); },
  generalNews: () => null,
  normalizeNews(rows) {
    if (!Array.isArray(rows)) throw new ContextReadError('invalid_provider_response');
    return rows.slice(0, 50).flatMap(r => {
      const title = cleanText(r?.title, 300), url = httpsLink(r?.link), t = Date.parse(r?.date || '');
      return title && url && Number.isFinite(t) ? [{ title, url, source: new URL(url).hostname, published_at: new Date(t).toISOString(), content_scope: 'headline_metadata_only' }] : [];
    }).slice(0, 12);
  }
});
export const PROVIDERS = Object.freeze({ finnhub: FINNHUB, eodhd: EODHD });

export function marketsProvider(env = {}) {
  const id = String(env.MARKETS_PROVIDER || 'finnhub').trim().toLowerCase();
  const spec = PROVIDERS[id];
  if (!spec) return { id, label: id, state: 'unknown_provider', key: '', quoteCoverage: () => 'not_covered', spec: null };
  const key = String(env[spec.secret] || '').trim();
  return { id: spec.id, label: spec.label, state: key ? 'ready' : 'needs_key', key, quoteCoverage: ex => spec.quoteCoverage(ex), spec };
}
/* what a response may say about the provider: never the key */
export function providerInfo(p) {
  const s = p.spec;
  return { id: p.id, label: p.label, state: p.state, tier: s ? s.tier : null, secret_name: s ? s.secret : null,
    site: s ? s.site : null, terms_url: s ? s.terms : null, coverage: s ? s.coverage_note : 'MARKETS_PROVIDER names no adapter.',
    switch: 'Set MARKETS_PROVIDER and that provider\'s secret on Worker mccluster; no code change.' };
}

/* ---------- validation ---------- */
export const SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9.\-:^=_/]{0,31}$/;
function onlyParams(params, allowed) {
  for (const k of params.keys()) if (!allowed.includes(k) || params.getAll(k).length !== 1) throw bad('invalid_parameter', 'Unsupported or repeated parameter');
}
export function countryCode(value) {
  const code = String(value || '');
  if (!/^[A-Z]{2}$/.test(code) || !isCountry(code)) throw bad('invalid_country', 'Use a supported two-letter country code');
  return code;
}
export function listingsQuery(iso2, params) {
  onlyParams(params, ['mic', 'q', 'offset', 'limit', 'type', 'quotes']);
  const country = countryCode(iso2), here = exchangesIn(country);
  const mic = params.get('mic');
  if (mic !== null && !here.some(x => x.mic === mic)) throw bad('invalid_mic', 'mic must be an exchange in this country');
  const q = (params.get('q') || '').trim();
  if (q.length > 40 || /[\u0000-\u001f]/.test(q)) throw bad('invalid_query', 'q must be at most 40 characters');
  const offsetText = params.get('offset') ?? '0', limitText = params.get('limit') ?? '25';
  if (!/^\d{1,6}$/.test(offsetText)) throw bad('invalid_offset', 'offset must be a whole number');
  if (!/^\d{1,2}$/.test(limitText) || +limitText < 1 || +limitText > PAGE_MAX) throw bad('invalid_limit', 'limit must be 1 to ' + PAGE_MAX);
  const type = params.get('type') ?? 'common';
  if (!['common', 'all'].includes(type)) throw bad('invalid_type', 'type must be common or all');
  const quotes = params.get('quotes') ?? '1';
  if (!['0', '1'].includes(quotes)) throw bad('invalid_quotes', 'quotes must be 0 or 1');
  return { country, mic, q, offset: +offsetText, limit: +limitText, type, quotes: quotes === '1', exchanges: mic ? here.filter(x => x.mic === mic) : here };
}
export function companyQuery(symbol, params) {
  onlyParams(params, ['mic']);
  const s = String(symbol || '');
  if (!SYMBOL_RE.test(s)) throw bad('invalid_symbol', 'Unsupported symbol');
  const ex = EXCHANGE_BY_MIC.get(params.get('mic') || '');
  if (!ex) throw bad('invalid_mic', 'mic must name a known exchange');
  return { symbol: s, exchange: ex };
}

/* ---------- the client: caches, a call budget, provider reads ---------- */
const providerError = e => (e instanceof ContextReadError ? e.code : 'provider_unavailable');
function priceStatusFor(code) {
  if (code === 'upstream_http_403') return 'needs_paid_feed';
  if (code === 'upstream_http_401') return 'key_rejected';
  if (code === 'upstream_http_429' || code === 'rate_limited') return 'rate_limited';
  return 'unavailable';
}
function utcDay(t) { return new Date(t).toISOString().slice(0, 10); }

const IMF_INDICATORS = Object.freeze([
  ['NGDPD', 'GDP, current prices', 'billion USD', 1e9],
  ['NGDPDPC', 'GDP per capita, current prices', 'USD/person', 1],
  ['NGDP_RPCH', 'Real GDP growth', '%', 1]
]);
export function normalizeImf(payload, indicator, iso3, year, retrievedAt) {
  const series = payload?.values?.[indicator];
  if (!payload || typeof payload !== 'object' || !series || typeof series !== 'object') throw new ContextReadError('invalid_imf_response');
  const row = series[iso3];
  const at = y => { const v = row && row[String(y)]; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
  const spec = IMF_INDICATORS.find(x => x[0] === indicator);
  const current = at(year), previous = at(year - 1);
  return { indicator, label: spec[1], unit: spec[2], value: current, value_usd: current !== null && spec[3] !== 1 ? current * spec[3] : null,
    period: current !== null ? String(year) : null, previous: previous !== null ? { period: String(year - 1), value: previous } : null,
    status: current !== null ? 'imf_estimate_or_projection' : 'no_observation', frequency: 'annual', is_live: false,
    retrieved_at: retrievedAt, source: 'IMF World Economic Outlook (DataMapper)',
    source_url: 'https://www.imf.org/external/datamapper/' + indicator + '@WEO/' + iso3,
    terms_url: 'https://www.imf.org/en/About/copyright-and-terms',
    qualifier: 'IMF WEO figure for the calendar year. The current year is an IMF estimate or projection until outturn data replace it; not a live counter.' };
}

/* stored GDELT headlines whose titles carry finance words; same canonical store read as news-context */
export const FINANCE_TERMS = Object.freeze(['stock', 'shares', 'market', 'exchange', 'index', 'ipo', 'earnings', 'profit', 'investor',
  'bank', 'interest rate', 'inflation', 'gdp', 'economy', 'economic', 'currency', 'bond', 'tariff', 'trade', 'recession', 'central bank', 'nasdaq', 'dow']);
const FINANCE_RE = new RegExp('\\b(' + FINANCE_TERMS.map(t => t.replace(/ /g, '\\s+')).join('|') + ')', 'i');
export function marketNewsParams(iso2, since, until, limit = 12) {
  const p = new URLSearchParams({ select: 'id,title,canonical_url,published_at,imported_at,headline_location_label,headline_latitude,headline_longitude,location_type,location_country_fips,location_basis,ingestion_provider',
    ingestion_provider: 'eq.gdelt_gkg_v2', location_country_fips: 'eq.' + ISO_TO_FIPS[iso2], published_at: 'gte.' + since,
    or: '(' + FINANCE_TERMS.map(t => 'title.ilike.*' + t.replace(/ /g, '*') + '*').join(',') + ')',
    order: 'published_at.desc,id.desc', limit: String(limit + 1) });
  p.append('published_at', 'lte.' + until);
  return p;
}
export function normalizeMarketNews(rows, iso2, since, until, limit = 12) {
  if (!Array.isArray(rows) || rows.length > limit + 1) throw new ContextReadError('invalid_news_response');
  const q = { economy: iso2, since, until };
  return rows.slice(0, limit).map(r => normalizeContextNews(r, q)).filter(s => s && FINANCE_RE.test(s.title)).map(s => ({
    id: s.id, title: s.title, url: s.url, publisher: s.publisher, seen_at: s.seen_at, place: s.geography.place,
    matched: [...new Set((s.title.match(new RegExp(FINANCE_RE.source, 'gi')) || []).map(x => x.toLowerCase().replace(/\s+/g, ' ')))].slice(0, 4),
    content_scope: 'headline_metadata_only', basis: 'finance_keyword_in_headline' }));
}
async function storeRead(env, table, params, options) {
  const root = new URL(env.SUPABASE_URL);
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash || (root.pathname !== '/' && root.pathname !== '')) throw new ContextReadError('database_configuration');
  const url = new URL('/rest/v1/' + table, root); url.search = params.toString();
  return contextJson(url.href, { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, accept: 'application/json' }, options);
}

export function createMarketsClient(options = {}) {
  const fetchImpl = options.fetchImpl || ((...a) => fetch(...a));
  const clock = options.clock || Date.now, now = options.now || (() => new Date(clock()));
  const cacheStore = () => (options.cacheImpl !== undefined ? options.cacheImpl : (globalThis.caches && globalThis.caches.default) || null);
  const memo = new Map(), pending = new Map(), calls = [];
  const read = (url, headers, maxBytes = SMALL) => contextJson(url, headers, { fetchImpl, timeoutMs: options.timeoutMs || 8000, maxBytes });

  function budget() {
    const t = clock();
    while (calls.length && t - calls[0] > MINUTE) calls.shift();
    if (calls.length >= PROVIDER_CALLS_PER_MINUTE) throw new ContextReadError('rate_limited');
    calls.push(t);
  }
  /* per-isolate memo with single-flight; failures are remembered briefly so a bad provider is not hammered */
  async function cached(key, ttl, task, failTtl = MINUTE) {
    const hit = memo.get(key);
    if (hit && clock() < hit.expires) { if (hit.error) throw new ContextReadError(hit.error); return hit.data; }
    if (pending.has(key)) return pending.get(key);
    const p = (async () => {
      try { const data = await task(); memo.delete(key); memo.set(key, { data, expires: clock() + ttl }); return data; }
      catch (e) { if (failTtl) memo.set(key, { error: providerError(e), expires: clock() + failTtl }); throw e; }
      finally { pending.delete(key); while (memo.size > 400) memo.delete(memo.keys().next().value); }
    })();
    pending.set(key, p);
    return p;
  }

  async function imf(indicator, iso3) {
    const fetchUrl = 'https://www.imf.org/external/datamapper/api/v1/' + indicator;
    const all = await cached('imf:' + indicator, 12 * HOUR, async () => {
      const payload = await read(fetchUrl, { accept: 'application/json' }, IMF_MAX);
      if (!payload?.values?.[indicator]) throw new ContextReadError('invalid_imf_response');
      return { payload, retrieved_at: now().toISOString() };
    });
    return { ...normalizeImf(all.payload, indicator, iso3, now().getUTCFullYear(), all.retrieved_at), fetch_url: fetchUrl };
  }

  /* the whole symbol list for one provider exchange code: Cache API (shared per location, 24 h) then the isolate */
  async function symbols(provider, code) {
    return cached('sym:' + provider.id + ':' + code, 6 * HOUR, async () => {
      const store = cacheStore(), key = new Request('https://cache.mccluster.internal/intel/markets/symbols/' + provider.id + '/' + encodeURIComponent(code));
      if (store) {
        const res = await store.match(key).catch(() => null), body = res ? await res.json().catch(() => null) : null;
        if (body && Array.isArray(body.rows) && clock() - Date.parse(body.retrieved_at) < DAY) return body;
      }
      budget();
      const req = provider.spec.symbols(code, provider.key);
      const rows = provider.spec.normalizeSymbols(await read(req.url, req.headers, SYMBOLS_MAX), code)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const body = { rows, retrieved_at: now().toISOString() };
      if (store) await store.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' } })).catch(() => {});
      return body;
    }, 5 * MINUTE);
  }

  async function quote(provider, symbol) {
    return cached('q:' + provider.id + ':' + symbol, MINUTE, async () => {
      budget();
      const req = provider.spec.quote(symbol, provider.key);
      return { quote: provider.spec.normalizeQuote(await read(req.url, req.headers)), retrieved_at: now().toISOString() };
    }, 30_000);
  }

  async function country(iso2, env) {
    const provider = marketsProvider(env), t = now(), until = t.toISOString(), since = new Date(t.getTime() - 72 * HOUR).toISOString();
    const here = exchangesIn(iso2);
    const wdiP = (options.indicatorClient ? options.indicatorClient({ economy: iso2, indicators: ['NY.GDP.MKTP.CD', 'NY.GDP.PCAP.CD', 'NY.GDP.MKTP.KD.ZG'] }) : Promise.reject(new ContextReadError('indicators_unconfigured')));
    const newsP = (options.readStore || ((table, params) => storeRead(env, table, params, { fetchImpl, timeoutMs: 8000 })))('media_news_articles', marketNewsParams(iso2, since, until));
    const globalP = provider.state === 'ready' && provider.spec.generalNews(provider.key)
      ? cached('news:' + provider.id, 5 * MINUTE, async () => { budget(); const req = provider.spec.generalNews(provider.key); return { items: provider.spec.normalizeNews(await read(req.url, req.headers)), retrieved_at: now().toISOString() }; })
      : Promise.resolve(null);
    const [wdiR, newsR, globalR] = await Promise.allSettled([wdiP, newsP, globalP]);
    const wdi = wdiR.status === 'fulfilled' ? wdiR.value : null;
    const iso3 = wdi?.observations?.map(o => o.geography?.provider_code).find(c => typeof c === 'string' && /^[A-Z]{3}$/.test(c)) || null;
    const imfR = iso3 ? await Promise.allSettled(IMF_INDICATORS.map(([id]) => imf(id, iso3))) : [];
    let stories = [], newsStatus = 'available', newsReason = null;
    if (newsR.status === 'fulfilled') {
      try { stories = normalizeMarketNews(newsR.value, iso2, since, until); newsStatus = stories.length ? 'available' : 'empty'; }
      catch (e) { newsStatus = 'unavailable'; newsReason = providerError(e); }
    } else { newsStatus = 'unavailable'; newsReason = providerError(newsR.reason); }
    const name = wdi?.observations?.find(o => o.geography?.name && o.geography.name !== iso2)?.geography.name || iso2;
    return {
      ok: true, schema: MARKETS_SCHEMA, generated_at: until,
      country: { iso2, iso3, name },
      macro: {
        is_live: false,
        note: 'GDP is published annual statistics, never live. Each figure carries its own period, source and retrieval time.',
        world_bank: wdi ? { status: 'available', observations: wdi.observations, mixed_periods: wdi.mixed_periods }
          : { status: 'unavailable', reason: wdiR.reason?.code || providerError(wdiR.reason), observations: [] },
        imf: !iso3 ? { status: 'unavailable', reason: 'iso3_unresolved', observations: [] }
          : { status: imfR.some(r => r.status === 'fulfilled') ? 'available' : 'unavailable',
            reason: imfR.find(r => r.status === 'rejected') ? providerError(imfR.find(r => r.status === 'rejected').reason) : null,
            observations: imfR.filter(r => r.status === 'fulfilled').map(r => r.value) }
      },
      exchanges: here.map(x => exchangeView(x, provider, t)),
      exchange_notes: EXCHANGE_NOTES,
      provider: providerInfo(provider),
      listings: here.length ? { route: '/v1/intel/markets/country/' + iso2 + '/listings', state: provider.state === 'ready' ? (here.some(x => x.provider_codes[provider.id]) ? 'ready' : 'not_covered') : provider.state }
        : { route: null, state: 'no_exchange_in_dataset' },
      news: {
        country: { status: newsStatus, reason: newsReason, stories, window: { since, until, hours: 72 },
          source: 'Stored GDELT headline metadata (existing World news ingest), finance keywords in the headline',
          limitations: 'Headlines only; a keyword match is not a topic classification and the headline is not verified.' },
        provider: provider.state !== 'ready' ? { status: provider.state, items: [] }
          : globalR.status === 'fulfilled' && globalR.value ? { status: 'available', scope: 'global_market_headlines', source: provider.label, retrieved_at: globalR.value.retrieved_at, items: globalR.value.items }
          : globalR.status === 'fulfilled' ? { status: 'not_supported', items: [] }
          : { status: priceStatusFor(providerError(globalR.reason)), items: [] }
      }
    };
  }

  async function listings(query, env) {
    const provider = marketsProvider(env), t = now();
    const base = { ok: true, schema: MARKETS_SCHEMA, generated_at: t.toISOString(), country: query.country, provider: providerInfo(provider),
      offset: query.offset, limit: query.limit, q: query.q, type: query.type };
    if (!query.exchanges.length) return { ...base, state: 'no_exchange_in_dataset', exchanges: [], total: 0, listings: [] };
    if (provider.state !== 'ready') return { ...base, state: provider.state, exchanges: query.exchanges.map(x => ({ mic: x.mic, state: provider.state, total: null })), total: null, listings: [] };
    const groups = new Map();
    for (const x of query.exchanges) {
      const code = x.provider_codes[provider.id];
      if (code) (groups.get(code) || groups.set(code, []).get(code)).push(x);
    }
    const lists = await Promise.allSettled([...groups.keys()].map(code => symbols(provider, code)));
    const exStatus = [], rows = [], term = query.q.toLowerCase();
    let retrieved = null;
    [...groups.entries()].forEach(([code, exs], i) => {
      const r = lists[i];
      if (r.status === 'rejected') { exs.forEach(x => exStatus.push({ mic: x.mic, state: priceStatusFor(providerError(r.reason)), total: null })); return; }
      retrieved = !retrieved || r.value.retrieved_at < retrieved ? r.value.retrieved_at : retrieved;
      for (const x of exs) {
        let n = 0;
        for (const row of r.value.rows) {
          if (x.provider_mic_filter && row[4] !== x.provider_mic_filter) continue;
          if (!x.provider_mic_filter && exs.length > 1 && row[4] && row[4] !== x.mic) continue;
          n++;
          if (query.type === 'common' && !COMMON.has(row[3])) continue;
          if (term && !row[0].toLowerCase().includes(term) && !row[2].toLowerCase().includes(term)) continue;
          rows.push([row, x]);
        }
        exStatus.push({ mic: x.mic, state: 'ok', total: n });
      }
    });
    query.exchanges.filter(x => !x.provider_codes[provider.id]).forEach(x => exStatus.push({ mic: x.mic, state: 'not_covered', total: null }));
    rows.sort((a, b) => (a[0][0] < b[0][0] ? -1 : a[0][0] > b[0][0] ? 1 : a[1].mic < b[1].mic ? -1 : 1));
    const page = rows.slice(query.offset, query.offset + query.limit);
    const out = page.map(([r, x]) => {
      const coverage = provider.quoteCoverage(x);
      return { symbol: r[0], display_symbol: r[1], name: r[2] || null, type: r[3] || null, mic: x.mic, exchange: x.short, currency: r[5] || null,
        price: null, change: null, change_pct: null, previous_close: null, as_of: null,
        price_status: coverage === 'available' ? 'on_request' : coverage, price_source: null };
    });
    if (query.quotes) {
      const want = out.filter(r => r.price_status === 'on_request').slice(0, QUOTES_PER_PAGE);
      for (let i = 0; i < want.length; i += 4) {
        await Promise.all(want.slice(i, i + 4).map(async r => {
          try {
            const q = (await quote(provider, r.symbol)).quote;
            if (!q) { r.price_status = 'no_quote'; return; }
            Object.assign(r, { price: q.price, change: q.change, change_pct: q.change_pct, previous_close: q.previous_close, as_of: q.as_of, price_status: 'quote', price_source: provider.label });
          } catch (e) { r.price_status = priceStatusFor(providerError(e)); }
        }));
      }
    }
    const allFailed = exStatus.length && exStatus.every(x => x.state !== 'ok');
    return { ...base, state: allFailed ? (exStatus.find(x => x.state !== 'not_covered')?.state || 'not_covered') : 'ok', exchanges: exStatus,
      total: rows.length, has_more: query.offset + query.limit < rows.length, listings: out, listings_retrieved_at: retrieved,
      quotes: { coverage: query.exchanges.map(x => ({ mic: x.mic, quotes: provider.quoteCoverage(x) })), per_page: QUOTES_PER_PAGE,
        note: 'Quotes are the provider\'s last trade with its own timestamp; outside the session they are the last close.' } };
  }

  async function company(query, env) {
    const provider = marketsProvider(env), t = now(), x = query.exchange;
    const base = { ok: true, schema: MARKETS_SCHEMA, generated_at: t.toISOString(), symbol: query.symbol, exchange: exchangeView(x, provider, t), provider: providerInfo(provider) };
    if (provider.state !== 'ready') return { ...base, state: provider.state, profile: null, quote: { status: provider.state }, news: { status: provider.state, items: [] } };
    const coverage = provider.quoteCoverage(x);
    const from = utcDay(t.getTime() - 7 * DAY), to = utcDay(t.getTime());
    const [p, q, n] = await Promise.allSettled([
      cached('p:' + provider.id + ':' + query.symbol, 6 * HOUR, async () => { budget(); const req = provider.spec.profile(query.symbol, provider.key); return provider.spec.normalizeProfile(await read(req.url, req.headers)); }),
      coverage === 'available' ? quote(provider, query.symbol) : Promise.resolve(null),
      cached('cn:' + provider.id + ':' + query.symbol + ':' + to, 10 * MINUTE, async () => { budget(); const req = provider.spec.companyNews(query.symbol, from, to, provider.key); return provider.spec.normalizeNews(await read(req.url, req.headers)); })
    ]);
    const quoteOut = coverage !== 'available' ? { status: coverage }
      : q.status === 'rejected' ? { status: priceStatusFor(providerError(q.reason)) }
      : !q.value.quote ? { status: 'no_quote' }
      : { status: 'quote', ...q.value.quote, retrieved_at: q.value.retrieved_at, source: provider.label };
    return { ...base, state: 'ok',
      profile: p.status === 'fulfilled' ? p.value : null, profile_status: p.status === 'fulfilled' ? (p.value ? 'available' : 'empty') : priceStatusFor(providerError(p.reason)),
      quote: quoteOut,
      news: n.status === 'fulfilled' ? { status: n.value.length ? 'available' : 'empty', window: { from, to }, source: provider.label, items: n.value }
        : { status: priceStatusFor(providerError(n.reason)), items: [] } };
  }

  function exchanges(env) {
    const provider = marketsProvider(env), t = now();
    return { ok: true, schema: MARKETS_SCHEMA, generated_at: t.toISOString(), provider: providerInfo(provider), notes: EXCHANGE_NOTES,
      exchanges: EXCHANGES.map(x => exchangeView(x, provider, t)) };
  }

  return { country, listings, company, exchanges };
}
