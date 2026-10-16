/* Key-free World Bank WDI adapter for the existing owner Intel service.
 * NOT a new backend or public route. No fetch occurs on import.
 * https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
 * https://datahelpdesk.worldbank.org/knowledgebase/articles/898581
 * Snapshot year is not fetch time; World Bank aggregates are never summed.
 */
export const INDICATORS = Object.freeze([
  ['SP.POP.TOTL', 'Population', 'people', 'people', 0, null],
  ['SP.URB.TOTL.IN.ZS', 'Urban population share', '%', 'people', 0, 100],
  ['NY.GDP.MKTP.CD', 'GDP, current US dollars', 'USD', 'economy', 0, null],
  ['NY.GDP.PCAP.CD', 'GDP per capita, current US dollars', 'USD/person', 'economy', 0, null],
  ['NY.GDP.MKTP.KD.ZG', 'Real GDP growth, annual', '%', 'economy', null, null],
  ['SP.DYN.LE00.IN', 'Life expectancy at birth', 'years', 'people', 0, null],
  ['IT.NET.USER.ZS', 'Individuals using the Internet', '%', 'infrastructure', 0, 100],
  ['EG.ELC.ACCS.ZS', 'Access to electricity', '%', 'infrastructure', 0, 100]
].map(([id, label, unit, category, min, max]) => Object.freeze({ id, label, unit, category, min, max,
  frequency: 'annual', public_display: 'review_indicator_terms',
  source_url: 'https://data.worldbank.org/indicator/' + id })));
const BY_ID = new Map(INDICATORS.map(x => [x.id, x]));
export const INDICATOR_TERMS = 'https://data.worldbank.org/summary-terms-of-use';
export class IndicatorError extends Error {
  constructor(code) { super(code); this.name = 'IndicatorError'; this.code = code; }
}
export function indicatorQuery({ economy = 'WLD', indicators = INDICATORS.map(x => x.id) } = {}) {
  if (typeof economy !== 'string' || !/^(?:[A-Z]{2}|WLD)$/.test(economy)) throw new IndicatorError('invalid_economy');
  if (!Array.isArray(indicators) || !indicators.length || indicators.length > INDICATORS.length || indicators.some(i => !BY_ID.has(i))) throw new IndicatorError('invalid_indicators');
  const ids = [...new Set(indicators)].sort();
  const url = new URL('https://api.worldbank.org/v2/country/' + economy + '/indicator/' + ids.join(';'));
  url.search = new URLSearchParams({ format: 'json', source: '2', mrnev: '1', per_page: '100', page: '1' }).toString();
  return { economy, indicators: ids, url: url.href };
}
export function normalizeIndicators(payload, query, retrievedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new IndicatorError('invalid_retrieval_time');
  if (!Array.isArray(payload) || payload.length !== 2 || !payload[0] ||
      !Array.isArray(payload[1]) || Number(payload[0].pages) !== 1 || payload[1].length > 100) throw new IndicatorError('invalid_provider_response');
  const selected = new Map(), maxYear = new Date(retrievedAt).getUTCFullYear();
  for (const r of payload[1]) {
    const id = r?.indicator?.id;
    if (!query.indicators.includes(id)) throw new IndicatorError('unexpected_indicator');
    const matches = query.economy === 'WLD' ? r.countryiso3code === 'WLD' : r.country?.id === query.economy;
    if (!matches) throw new IndicatorError('unexpected_geography');
    if (r.value === null) continue;
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) throw new IndicatorError('invalid_value');
    const spec = BY_ID.get(id), year = Number(r.date);
    if (!/^\d{4}$/.test(String(r.date)) || year < 1900 || year > maxYear) throw new IndicatorError('invalid_period');
    if ((spec.min !== null && r.value < spec.min) || (spec.max !== null && r.value > spec.max)) throw new IndicatorError('value_out_of_range');
    const previous = selected.get(id);
    if (previous && previous.year === year && previous.row.value !== r.value) throw new IndicatorError('conflicting_observation');
    if (!previous || previous.year < year) selected.set(id, { row: r, year });
  }
  const observations = query.indicators.map(id => {
    const spec = BY_ID.get(id), hit = selected.get(id), r = hit?.row;
    return { indicator: id, label: spec.label, unit: spec.unit,
      geography: { code: query.economy, provider_code: r?.countryiso3code || null,
        name: r?.country?.value || (query.economy === 'WLD' ? 'World' : query.economy),
        type: query.economy === 'WLD' ? 'world_aggregate' : 'world_bank_economy' },
      value: r ? r.value : null, period: hit ? String(hit.year) : null,
      status: hit ? 'latest_available' : 'no_observation', frequency: 'annual',
      is_live: false, observed_at: null, retrieved_at: retrievedAt,
      provider_updated_at: typeof payload[0].lastupdated === 'string' ? payload[0].lastupdated : null,
      source: 'World Bank, World Development Indicators', source_url: spec.source_url,
      terms_url: INDICATOR_TERMS, fetch_url: query.url,
      qualifier: 'Published estimate/observation; consult indicator methodology. Not a live counter.' };
  });
  const years = new Set(observations.filter(x => x.period !== null).map(x => x.period));
  return { schema: 'world-indicators/v1', observations, mixed_periods: years.size > 1,
    geographic_join: 'Match a reviewed economy-to-boundary mapping; never use a capital point as a population location.',
    aggregate_rule: 'Use WLD for global totals; do not sum country/all with overlapping aggregates.' };
}
async function boundedJson(response) {
  if (!response.ok) throw new IndicatorError('provider_http_' + response.status);
  if (Number(response.headers.get('content-length') || 0) > 524288 || !response.body) throw new IndicatorError('provider_response_too_large_or_empty');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 524288) { await reader.cancel(); throw new IndicatorError('provider_response_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new IndicatorError('provider_invalid_json'); }
}
export async function fetchIndicators(input = {}, { fetchImpl = fetch, now = () => new Date(), timeoutMs = 10000 } = {}) {
  const query = indicatorQuery(input), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(10000, Math.max(1, timeoutMs)));
  try {
    // Never forward the owner's token or any other credentials to the provider.
    const res = await fetchImpl(query.url, { method: 'GET', redirect: 'manual',
      signal: controller.signal, headers: { accept: 'application/json' } });
    if (res.status >= 300 && res.status < 400) throw new IndicatorError('provider_redirect');
    return normalizeIndicators(await boundedJson(res), query, now().toISOString());
  } catch (e) {
    if (e instanceof IndicatorError) throw e;
    throw new IndicatorError(controller.signal.aborted ? 'provider_timeout' : 'provider_unavailable');
  } finally { clearTimeout(timer); }
}
/* Per-isolate caching bounds owner exploration. Shared persisted caches may only
 * hold this public indicator output, never bank/session/first-party analytics.
 */
export function createIndicatorClient(options = {}) {
  const cache = new Map(), pending = new Map();
  const clock = options.clock || Date.now;
  return async input => {
    const query = indicatorQuery(input), key = query.url, prior = cache.get(key);
    if (prior && clock() - prior.at < 86400000) return structuredClone(prior.data);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    if (pending.size >= 4) throw new IndicatorError('too_many_indicator_requests');
    const task = fetchIndicators(input, options).then(data => {
      cache.delete(key);cache.set(key, { at: clock(), data });
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return data;
    }).finally(() => pending.delete(key));
    pending.set(key, task);return structuredClone(await task);
  };
}
