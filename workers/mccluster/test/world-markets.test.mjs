/* World markets for the owner's Halo globe: fixtures only, never the network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIntelRequest } from '../src/intel/router.js';
import { IntelError } from '../src/intel/store.js';
import { createIndicatorClient } from '../src/intel/world-indicators.js';
import {
  EXCHANGES, MarketsError, createMarketsClient, companyQuery, listingsQuery, marketNewsParams, marketsProvider,
  normalizeImf, normalizeMarketNews, providerInfo, sessionState, validateExchanges, exchangesIn, PROVIDERS
} from '../src/intel/world-markets.js';

const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' };
const KEY = 'fixture-finnhub-secret';
const keyed = { ...env, FINNHUB_API_KEY: KEY };
const NOW = new Date('2026-11-02T15:00:00Z'); // Monday: 10:00 New York, 15:00 London, Tuesday 00:00 Tokyo
const owner = { requireHouseOwner: async () => ({ id: 'owner' }) };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const US_SYMBOLS = [
  { symbol: 'MSFT', displaySymbol: 'MSFT', description: 'MICROSOFT CORP', type: 'Common Stock', mic: 'XNAS', currency: 'USD' },
  { symbol: 'AAPL', displaySymbol: 'AAPL', description: 'APPLE INC', type: 'Common Stock', mic: 'XNAS', currency: 'USD' },
  { symbol: 'IBM', displaySymbol: 'IBM', description: 'INTL BUSINESS MACHINES CORP', type: 'Common Stock', mic: 'XNYS', currency: 'USD' },
  { symbol: 'SPY', displaySymbol: 'SPY', description: 'SPDR S&P 500 ETF TRUST', type: 'ETP', mic: 'ARCX', currency: 'USD' },
  { symbol: 'KO', displaySymbol: 'KO', description: 'COCA-COLA CO <b>x</b>', type: 'Common Stock', mic: 'XNYS', currency: 'USD' },
  { symbol: 'BAD SYMBOL!', description: 'dropped', type: 'Common Stock', mic: 'XNYS' }
];
const WDI = [{ pages: 1, lastupdated: '2026-10-01' }, [
  { indicator: { id: 'NY.GDP.MKTP.CD' }, country: { id: 'US', value: 'United States' }, countryiso3code: 'USA', date: '2025', value: 30.1e12 },
  { indicator: { id: 'NY.GDP.PCAP.CD' }, country: { id: 'US', value: 'United States' }, countryiso3code: 'USA', date: '2025', value: 88000 },
  { indicator: { id: 'NY.GDP.MKTP.KD.ZG' }, country: { id: 'US', value: 'United States' }, countryiso3code: 'USA', date: '2025', value: 2.1 }
]];
const imf = id => ({ values: { [id]: { USA: { 2025: 30861.3, 2026: id === 'NGDP_RPCH' ? 2.3 : 32642.373 }, DEU: { 2026: 5471.3 } } }, api: { version: '1' } });
const NEWS_ROW = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Stocks rally as Nasdaq hits record', canonical_url: 'https://news.example/markets',
  published_at: '2026-11-02T12:00:00Z', imported_at: '2026-11-02T12:05:00Z', headline_location_label: 'New York', headline_latitude: 40.7,
  headline_longitude: -74, location_type: 3, location_country_fips: 'US', location_basis: 'gdelt', ingestion_provider: 'gdelt_gkg_v2'
};

/* one fake provider network, recording every request */
function network(overrides = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); seen.push({ url: u, init });
    assert.equal(init.redirect, 'manual');
    if (u.hostname === 'api.worldbank.org') return json(WDI);
    if (u.hostname === 'www.imf.org') return json(imf(u.pathname.split('/').pop()));
    if (u.hostname === 'db.test') return json(overrides.news || [NEWS_ROW]);
    if (u.hostname === 'finnhub.io') {
      assert.equal(init.headers['x-finnhub-token'], KEY);
      assert.equal(u.searchParams.has('token'), false, 'the key never rides in the URL');
      const route = u.pathname.replace('/api/v1', '');
      if (overrides[route]) return overrides[route](u);
      if (route === '/stock/symbol') return u.searchParams.get('exchange') === 'US' ? json(US_SYMBOLS) : json({ error: 'You don\'t have access to this resource.' }, 403);
      if (route === '/quote') return json({ c: 190.5, d: 1.5, dp: 0.79, h: 191, l: 188, o: 189, pc: 189, t: 1793622000 });
      if (route === '/stock/profile2') return json({ name: 'Apple Inc', ticker: 'AAPL', finnhubIndustry: 'Technology', country: 'US', currency: 'USD', exchange: 'NASDAQ NMS', ipo: '1980-12-12', marketCapitalization: 3000000, shareOutstanding: 15000, weburl: 'https://www.apple.com/', logo: 'https://static.example/logo.png' });
      if (route === '/company-news') return json([{ headline: 'Apple earnings beat', url: 'https://news.example/apple', source: 'Fixture Wire', datetime: 1793600000 }, { headline: '', url: 'https://x.example' }]);
      if (route === '/news') return json([{ headline: 'Global markets steady', url: 'https://news.example/global', source: 'Fixture', datetime: 1793600000 }]);
    }
    throw new Error('unexpected ' + url);
  };
  return { seen, fetchImpl };
}
function client(net, extra = {}) {
  const indicatorClient = createIndicatorClient({ fetchImpl: net.fetchImpl, now: () => NOW });
  return createMarketsClient({ fetchImpl: net.fetchImpl, now: () => NOW, clock: () => NOW.getTime(), cacheImpl: null, indicatorClient, ...extra });
}
const get = (path, e, options) => handleIntelRequest(new Request('https://api.mccluster.org' + path, { headers: { authorization: 'Bearer owner' } }), e, options);

test('the exchange dataset is valid, placed and keyed by MIC', () => {
  assert.ok(EXCHANGES.length >= 40);
  for (const x of EXCHANGES) assert.ok(Number.isFinite(x.lat) && Number.isFinite(x.lon) && !(x.lat === 0 && x.lon === 0), x.mic);
  assert.deepEqual(exchangesIn('US').map(x => x.mic), ['XNYS', 'XNAS']);
  assert.throws(() => validateExchanges({ schema: 'world-markets-exchanges/v1', exchanges: [{ ...EXCHANGES[0], timezone: 'Mars/Base' }] }), MarketsError);
  assert.throws(() => validateExchanges({ schema: 'world-markets-exchanges/v1', exchanges: [{ ...EXCHANGES[0], sessions: [['16:00', '09:30']] }] }), MarketsError);
});

test('open and closed come from the regular schedule in each exchange\'s own time zone', () => {
  const by = mic => EXCHANGES.find(x => x.mic === mic);
  assert.equal(sessionState(by('XNYS'), NOW).state, 'open');
  assert.equal(sessionState(by('XNYS'), NOW).local_time, '10:00');
  assert.equal(sessionState(by('XLON'), NOW).state, 'open');
  assert.equal(sessionState(by('XTKS'), NOW).reason, 'before_open');
  assert.equal(sessionState(by('XTKS'), new Date('2026-11-02T03:00:00Z')).reason, 'midday_break');
  assert.equal(sessionState(by('XNYS'), new Date('2026-11-01T15:00:00Z')).reason, 'non_trading_day');
  assert.equal(sessionState(by('XSAU'), new Date('2026-11-01T08:00:00Z')).state, 'open', 'Tadawul trades on Sunday');
  assert.equal(sessionState(by('XNYS'), NOW).holidays_modeled, false);
});

test('the provider is config: free Finnhub by default, a paid feed by env var and secret, the key never reported', () => {
  assert.equal(marketsProvider({}).state, 'needs_key');
  assert.equal(marketsProvider({ FINNHUB_API_KEY: KEY }).state, 'ready');
  const paid = marketsProvider({ MARKETS_PROVIDER: 'eodhd', EODHD_API_KEY: 'paid-secret' });
  assert.equal(paid.id, 'eodhd'); assert.equal(paid.state, 'ready');
  assert.equal(marketsProvider({ MARKETS_PROVIDER: 'madeup' }).state, 'unknown_provider');
  assert.doesNotMatch(JSON.stringify(providerInfo(marketsProvider({ FINNHUB_API_KEY: KEY }))), new RegExp(KEY));
  const q = PROVIDERS.eodhd.normalizeQuote({ code: 'AAPL.US', timestamp: 1793622000, close: 190.5, change: 1.5, change_p: 0.79, previousClose: 189 });
  assert.equal(q.price, 190.5); assert.equal(q.previous_close, 189);
  assert.deepEqual(PROVIDERS.eodhd.normalizeSymbols([{ Code: 'VOD', Name: 'Vodafone', Type: 'Common Stock', Currency: 'GBX' }], 'LSE')[0].slice(0, 3), ['VOD.LSE', 'VOD', 'Vodafone']);
  assert.equal(PROVIDERS.finnhub.normalizeQuote({ c: 0, d: null, t: 0 }), null, 'zeros are no quote, not a price of zero');
});

test('IMF and market-news normalizers label periods, sources and limits honestly', () => {
  const g = normalizeImf(imf('NGDPD'), 'NGDPD', 'USA', 2026, NOW.toISOString());
  assert.equal(g.value, 32642.373); assert.equal(g.value_usd, 32642.373e9); assert.equal(g.period, '2026'); assert.equal(g.is_live, false);
  assert.equal(g.previous.period, '2025'); assert.equal(g.status, 'imf_estimate_or_projection');
  assert.equal(normalizeImf(imf('NGDPD'), 'NGDPD', 'FRA', 2026, NOW.toISOString()).status, 'no_observation');
  const p = marketNewsParams('US', '2026-10-30T15:00:00.000Z', NOW.toISOString());
  assert.equal(p.get('location_country_fips'), 'eq.US'); assert.match(p.get('or'), /title\.ilike\.\*stock\*/); assert.equal(p.getAll('published_at').length, 2);
  const rows = [NEWS_ROW, { ...NEWS_ROW, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Weather turns cold' }];
  const stories = normalizeMarketNews(rows, 'US', '2026-10-30T15:00:00.000Z', NOW.toISOString());
  assert.equal(stories.length, 1); assert.deepEqual(stories[0].matched.sort(), ['nasdaq', 'stock']); assert.equal(stories[0].content_scope, 'headline_metadata_only');
});

test('query validation rejects anything outside the bounds', () => {
  const p = s => new URLSearchParams(s);
  assert.equal(listingsQuery('US', p('q=apple&limit=10')).limit, 10);
  for (const [c, s] of [['us', ''], ['ZZ', ''], ['US', 'limit=51'], ['US', 'limit=0'], ['US', 'mic=XLON'], ['US', 'url=x'], ['US', 'q=a&q=b'], ['US', 'type=etf'], ['US', 'offset=-1']])
    assert.throws(() => listingsQuery(c, p(s)), MarketsError, c + '?' + s);
  assert.equal(companyQuery('AAPL', p('mic=XNAS')).exchange.mic, 'XNAS');
  for (const [s, q] of [['AAPL', ''], ['AAPL', 'mic=NOPE'], ['../x', 'mic=XNAS'], ['A'.repeat(40), 'mic=XNAS']]) assert.throws(() => companyQuery(s, p(q)), MarketsError);
});

test('owner gate first: a refused session reaches no provider, store or catalog', async () => {
  const net = network();
  for (const path of ['/v1/intel/markets/exchanges', '/v1/intel/markets/country/US', '/v1/intel/markets/country/US/listings', '/v1/intel/markets/company/AAPL?mic=XNAS']) {
    const r = await get(path, keyed, { requireHouseOwner: async () => { throw new IntelError('Forbidden', 403); }, marketsClient: client(net) });
    assert.equal(r.status, 403, path);
  }
  assert.equal(net.seen.length, 0);
});

test('without a key the country card is real macro, exchanges and news, and listings say needs_key, never fake rows', async () => {
  const net = network(), options = { ...owner, marketsClient: client(net) };
  const r = await get('/v1/intel/markets/country/US', env, options);
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const d = await r.json();
  assert.equal(d.country.name, 'United States'); assert.equal(d.country.iso3, 'USA');
  assert.equal(d.macro.is_live, false);
  assert.equal(d.macro.world_bank.observations.find(o => o.indicator === 'NY.GDP.MKTP.CD').period, '2025');
  assert.deepEqual(d.macro.imf.observations.map(o => [o.indicator, o.period]), [['NGDPD', '2026'], ['NGDPDPC', '2026'], ['NGDP_RPCH', '2026']]);
  assert.deepEqual(d.exchanges.map(x => [x.mic, x.session.state]), [['XNYS', 'open'], ['XNAS', 'open']]);
  assert.equal(d.provider.state, 'needs_key'); assert.equal(d.provider.secret_name, 'FINNHUB_API_KEY'); assert.equal(d.listings.state, 'needs_key');
  assert.equal(d.news.country.status, 'available'); assert.equal(d.news.country.stories[0].title, NEWS_ROW.title);
  assert.equal(d.news.provider.status, 'needs_key');
  const store = net.seen.find(s => s.url.hostname === 'db.test');
  assert.equal(store.init.headers.authorization, 'Bearer fixture-service'); assert.equal(store.url.pathname, '/rest/v1/media_news_articles');
  for (const s of net.seen.filter(s => s.url.hostname !== 'db.test')) assert.doesNotMatch(JSON.stringify(s.init.headers), /owner|fixture-service/, 'no credentials to a provider');
  assert.equal(net.seen.filter(s => s.url.hostname === 'finnhub.io').length, 0);
  const l = await (await get('/v1/intel/markets/country/US/listings', env, options)).json();
  assert.equal(l.state, 'needs_key'); assert.deepEqual(l.listings, []); assert.equal(l.total, null);
});

test('with a key: listings by exchange, US quotes on the page, non-US listings need a paid feed, cached', async () => {
  const net = network(), options = { ...owner, marketsClient: client(net) };
  const d = await (await get('/v1/intel/markets/country/US/listings?limit=2', keyed, options)).json();
  assert.equal(d.state, 'ok'); assert.equal(d.total, 4, 'common stock on NYSE + Nasdaq only, ETFs and bad symbols out');
  assert.deepEqual(d.listings.map(x => [x.symbol, x.mic]), [['AAPL', 'XNAS'], ['IBM', 'XNYS']]);
  assert.equal(d.listings[0].price, 190.5); assert.equal(d.listings[0].price_status, 'quote'); assert.equal(d.listings[0].as_of, new Date(1793622000 * 1000).toISOString());
  assert.deepEqual(d.exchanges, [{ mic: 'XNYS', state: 'ok', total: 2 }, { mic: 'XNAS', state: 'ok', total: 2 }]);
  const all = await (await get('/v1/intel/markets/country/US/listings?type=all&q=spdr&quotes=0', keyed, options)).json();
  assert.deepEqual(all.listings.map(x => x.symbol), [], 'ARCX is not one of the two placed US exchanges');
  const ko = await (await get('/v1/intel/markets/country/US/listings?q=coca&quotes=0', keyed, options)).json();
  assert.equal(ko.listings[0].name, 'COCA-COLA CO x', 'provider text is cleaned'); assert.equal(ko.listings[0].price_status, 'on_request');
  assert.equal(net.seen.filter(s => s.url.pathname.endsWith('/stock/symbol')).length, 1, 'one symbol-list read for both US exchanges');
  const gb = await (await get('/v1/intel/markets/country/GB/listings', keyed, options)).json();
  assert.equal(gb.state, 'needs_paid_feed'); assert.deepEqual(gb.exchanges, [{ mic: 'XLON', state: 'needs_paid_feed', total: null }]);
  const ng = await (await get('/v1/intel/markets/country/NG/listings', keyed, options)).json();
  assert.equal(ng.state, 'not_covered');
  const none = await (await get('/v1/intel/markets/country/IS/listings', keyed, options)).json();
  assert.equal(none.state, 'no_exchange_in_dataset');
  assert.doesNotMatch(JSON.stringify([d, gb, ng]), new RegExp(KEY));
});

test('non-US listings keep a null price with needs_paid_feed when the symbol list is entitled', async () => {
  const net = network({ '/stock/symbol': () => json([{ symbol: 'VOD.L', displaySymbol: 'VOD.L', description: 'VODAFONE GROUP', type: 'Common Stock', mic: 'XLON', currency: 'GBP' }]) });
  const d = await (await get('/v1/intel/markets/country/GB/listings', keyed, { ...owner, marketsClient: client(net) })).json();
  assert.equal(d.state, 'ok'); assert.equal(d.listings[0].price, null); assert.equal(d.listings[0].price_status, 'needs_paid_feed');
  assert.equal(net.seen.filter(s => s.url.pathname.endsWith('/quote')).length, 0, 'no quote call that the plan cannot answer');
});

test('company: profile, live US quote and its news; a denied quote is needs_paid_feed; rate limits are reported', async () => {
  const net = network(), options = { ...owner, marketsClient: client(net) };
  const d = await (await get('/v1/intel/markets/company/AAPL?mic=XNAS', keyed, options)).json();
  assert.equal(d.profile.name, 'Apple Inc'); assert.equal(d.profile.market_cap.value, 3e12); assert.equal('logo' in d.profile, false);
  assert.equal(d.quote.status, 'quote'); assert.equal(d.quote.price, 190.5);
  assert.equal(d.news.items.length, 1); assert.equal(d.news.items[0].source, 'Fixture Wire');
  const cn = net.seen.find(s => s.url.pathname.endsWith('/company-news'));
  assert.equal(cn.url.searchParams.get('from'), '2026-10-26'); assert.equal(cn.url.searchParams.get('to'), '2026-11-02');
  const denied = network({ '/quote': () => json({ error: 'no access' }, 403) });
  const dd = await (await get('/v1/intel/markets/company/AAPL?mic=XNAS', keyed, { ...owner, marketsClient: client(denied) })).json();
  assert.equal(dd.quote.status, 'needs_paid_feed');
  const limited = network({ '/quote': () => json({ error: 'limit' }, 429) });
  const ld = await (await get('/v1/intel/markets/company/AAPL?mic=XNAS', keyed, { ...owner, marketsClient: client(limited) })).json();
  assert.equal(ld.quote.status, 'rate_limited');
  const lse = await (await get('/v1/intel/markets/company/VOD.L?mic=XLON', keyed, { ...owner, marketsClient: client(network()) })).json();
  assert.equal(lse.quote.status, 'needs_paid_feed');
});

test('country card with a key adds provider headlines; provider failure stays a labeled state', async () => {
  const d = await (await get('/v1/intel/markets/country/US', keyed, { ...owner, marketsClient: client(network()) })).json();
  assert.equal(d.news.provider.status, 'available'); assert.equal(d.news.provider.items[0].title, 'Global markets steady');
  assert.equal(d.listings.state, 'ready');
  const down = network({ '/news': () => json({}, 500) });
  const dd = await (await get('/v1/intel/markets/country/US', keyed, { ...owner, marketsClient: client(down) })).json();
  assert.equal(dd.news.provider.status, 'unavailable'); assert.equal(dd.macro.is_live, false);
});

test('provider outages and oversized answers are typed, bounded and never thrown as 500s', async () => {
  const slow = { fetchImpl: async (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) };
  const c = createMarketsClient({ ...slow, now: () => NOW, clock: () => NOW.getTime(), cacheImpl: null, timeoutMs: 5, indicatorClient: async () => { throw new Error('down'); } });
  const r = await get('/v1/intel/markets/country/US', keyed, { ...owner, marketsClient: c });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.macro.world_bank.status, 'unavailable'); assert.equal(d.macro.imf.reason, 'iso3_unresolved');
  assert.equal(d.news.country.status, 'unavailable'); assert.equal(d.news.country.reason, 'upstream_timeout');
  const big = network({ '/stock/symbol': () => new Response('x', { headers: { 'content-length': String(64 * 1024 * 1024) } }) });
  const b = await (await get('/v1/intel/markets/country/US/listings', keyed, { ...owner, marketsClient: client(big) })).json();
  assert.equal(b.state, 'unavailable');
});

test('the shared Cache API keeps symbol lists under an internal key that carries no secret', async () => {
  const store = new Map();
  const cacheImpl = { match: async k => (store.has(k.url) ? new Response(store.get(k.url)) : undefined), put: async (k, res) => { store.set(k.url, await res.text()); } };
  const net = network();
  await (await get('/v1/intel/markets/country/US/listings?quotes=0', keyed, { ...owner, marketsClient: client(net, { cacheImpl }) })).json();
  assert.deepEqual([...store.keys()], ['https://cache.mccluster.internal/intel/markets/symbols/finnhub/US']);
  const net2 = network();
  const d = await (await get('/v1/intel/markets/country/US/listings?quotes=0', keyed, { ...owner, marketsClient: client(net2, { cacheImpl }) })).json();
  assert.equal(d.total, 4); assert.equal(net2.seen.length, 0, 'a second isolate reads the shared cache');
});

test('routes: only GET, bounded parameters, 404 for unknown markets paths', async () => {
  const options = { ...owner, marketsClient: client(network()) };
  const post = await handleIntelRequest(new Request('https://api.mccluster.org/v1/intel/markets/exchanges', { method: 'POST' }), env, options);
  assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET');
  for (const path of ['/v1/intel/markets/exchanges?x=1', '/v1/intel/markets/country/usa', '/v1/intel/markets/country/US?debug=1', '/v1/intel/markets/company/AAPL', '/v1/intel/markets/company/%E0%A4%A?mic=XNAS'])
    assert.equal((await get(path, env, options)).status, 400, path);
  assert.equal((await get('/v1/intel/markets/nope', env, options)).status, 404);
  const ex = await (await get('/v1/intel/markets/exchanges', env, options)).json();
  assert.equal(ex.exchanges.length, EXCHANGES.length); assert.equal(ex.provider.state, 'needs_key'); assert.match(ex.notes.hours, /holidays/);
});

test('under the paid EODHD feed both placed US exchanges keep their listings (venue carried as the MIC)', async () => {
  const PAID = 'fixture-eodhd-secret', seen = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); seen.push(u);
    assert.equal(u.hostname, 'eodhd.com');
    if (u.pathname === '/api/exchange-symbol-list/US') return json([
      { Code: 'AAPL', Name: 'Apple Inc', Country: 'USA', Exchange: 'NASDAQ', Currency: 'USD', Type: 'Common Stock' },
      { Code: 'IBM', Name: 'International Business Machines', Country: 'USA', Exchange: 'NYSE', Currency: 'USD', Type: 'Common Stock' },
      { Code: 'KO', Name: 'Coca-Cola Co', Country: 'USA', Exchange: 'NYSE', Currency: 'USD', Type: 'Common Stock' },
      { Code: 'SPY', Name: 'SPDR S&P 500', Country: 'USA', Exchange: 'NYSE ARCA', Currency: 'USD', Type: 'ETF' },
      { Code: 'XYZOTC', Name: 'Pink sheet co', Country: 'USA', Exchange: 'PINK', Currency: 'USD', Type: 'Common Stock' }]);
    if (u.pathname.startsWith('/api/real-time/')) return json({ code: u.pathname.split('/').pop(), timestamp: 1793622000, close: 101.25, change: -0.5, change_p: -0.49, previousClose: 101.75 });
    throw new Error('unexpected ' + url);
  };
  const c = createMarketsClient({ fetchImpl, now: () => NOW, clock: () => NOW.getTime(), cacheImpl: null });
  const e = { ...env, MARKETS_PROVIDER: 'eodhd', EODHD_API_KEY: PAID };
  const d = await (await get('/v1/intel/markets/country/US/listings', e, { ...owner, marketsClient: c })).json();
  assert.equal(d.state, 'ok'); assert.equal(d.provider.id, 'eodhd');
  assert.deepEqual(d.exchanges, [{ mic: 'XNYS', state: 'ok', total: 2 }, { mic: 'XNAS', state: 'ok', total: 1 }]);
  assert.deepEqual(d.listings.map(x => [x.symbol, x.mic, x.price_status, x.price]), [['AAPL.US', 'XNAS', 'quote', 101.25], ['IBM.US', 'XNYS', 'quote', 101.25], ['KO.US', 'XNYS', 'quote', 101.25]]);
  const nas = await (await get('/v1/intel/markets/country/US/listings?mic=XNAS&quotes=0', e, { ...owner, marketsClient: c })).json();
  assert.deepEqual(nas.listings.map(x => x.symbol), ['AAPL.US']);
  assert.equal(seen.filter(u => u.pathname.startsWith('/api/exchange-symbol-list/')).length, 1);
  assert.doesNotMatch(JSON.stringify([d, nas]), new RegExp(PAID));
});
