/* A bounded history view of the existing World Bank WDI integration. One
 * country, fourteen series, six completed years; no arbitrary URLs or codes.
 * API contract: https://datahelpdesk.worldbank.org/knowledgebase/articles/898581
 */
import { ContextReadError, contextJson } from './bounded-json.js';
import { isCountry } from './news-country-codes.js';
export const CONTEXT_INDICATORS = Object.freeze([
  ['NY.GDP.MKTP.KD.ZG', 'Real GDP growth', '%', 'economy', null, null],
  ['NY.GDP.PCAP.CD', 'GDP per capita, current US dollars', 'USD/person', 'economy', 0, null],
  ['FP.CPI.TOTL.ZG', 'Consumer price inflation', '%', 'prices', null, null],
  ['SL.UEM.TOTL.ZS', 'Unemployment, modeled ILO estimate', '% of labor force', 'jobs', 0, 100],
  ['NE.TRD.GNFS.ZS', 'Trade as a share of GDP', '% of GDP', 'trade', 0, null],
  ['SP.POP.TOTL', 'Population', 'people', 'people', 0, null],
  ['SP.URB.TOTL.IN.ZS', 'Urban population share', '%', 'housing', 0, 100],
  ['IT.NET.USER.ZS', 'Individuals using the Internet', '%', 'infrastructure', 0, 100],
  ['EG.ELC.ACCS.ZS', 'Access to electricity', '%', 'energy', 0, 100],
  ['SH.H2O.BASW.ZS', 'Basic drinking water access', '%', 'water', 0, 100],
  ['SH.STA.BASS.ZS', 'Basic sanitation access', '%', 'water', 0, 100],
  ['SP.DYN.LE00.IN', 'Life expectancy at birth', 'years', 'health', 0, null],
  ['AG.LND.ARBL.ZS', 'Arable land share', '% of land area', 'food', 0, 100],
  ['AG.YLD.CREL.KG', 'Cereal yield', 'kg/hectare', 'food', 0, null]
].map(([id, label, unit, topic, min, max]) => Object.freeze({ id, label, unit, topic, min, max,
  delta_unit: unit.startsWith('%') ? 'percentage points' : unit,
  source_url: 'https://data.worldbank.org/indicator/' + id })));
const BY_ID = new Map(CONTEXT_INDICATORS.map(spec => [spec.id, spec]));
export const WDI_TERMS = 'https://data.worldbank.org/summary-terms-of-use';
export function contextIndicatorQuery(economy, now = new Date()) {
  if (!isCountry(economy)) throw new ContextReadError('invalid_economy');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ContextReadError('invalid_time');
  const end = now.getUTCFullYear() - 1, start = end - 5;
  const url = new URL('https://api.worldbank.org/v2/country/' + economy + '/indicator/' + CONTEXT_INDICATORS.map(s => s.id).join(';'));
  url.search = new URLSearchParams({ source: '2', format: 'json', date: start + ':' + end, per_page: '100', page: '1' }).toString();
  return { economy, start, end, url: url.href };
}
export function normalizeContextIndicators(payload, query, retrievedAt) {
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new ContextReadError('invalid_time');
  if (!Array.isArray(payload) || payload.length !== 2 || !payload[0] || Number(payload[0].pages) !== 1 ||
      !Array.isArray(payload[1]) || payload[1].length > 100) throw new ContextReadError('invalid_indicator_response');
  const found = new Map(); let countryName = query.economy;
  for (const row of payload[1]) {
    const spec = BY_ID.get(row?.indicator?.id);
    if (!spec) throw new ContextReadError('unexpected_indicator');
    if (row.country?.id !== query.economy || row.countryiso3code === 'WLD') throw new ContextReadError('unexpected_geography');
    const year = Number(row.date);
    if (!/^\d{4}$/.test(String(row.date)) || year < query.start || year > query.end) throw new ContextReadError('unexpected_period');
    if (row.value === null) continue;
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) ||
        (spec.min !== null && row.value < spec.min) || (spec.max !== null && row.value > spec.max)) throw new ContextReadError('invalid_indicator_value');
    const key = spec.id + ':' + year;
    if (found.has(key) && found.get(key).value !== row.value) throw new ContextReadError('conflicting_observation');
    found.set(key, { period: String(year), value: row.value });
    if (typeof row.country.value === 'string') countryName = row.country.value.slice(0, 100);
  }
  return { schema: 'news-context-indicators/v1', economy: query.economy, country_name: countryName,
    period_start: String(query.start), period_end: String(query.end), retrieved_at: retrievedAt,
    provider_updated_at: /^\d{4}-\d{2}-\d{2}$/.test(payload[0].lastupdated || '') ? payload[0].lastupdated : null,
    source: 'World Bank, World Development Indicators', fetch_url: query.url, terms_url: WDI_TERMS,
    vintage: 'Current published revision; availability at the original headline time is not established.',
    series: CONTEXT_INDICATORS.map(spec => ({ id: spec.id, label: spec.label, unit: spec.unit, delta_unit: spec.delta_unit,
      topic: spec.topic, source_url: spec.source_url, frequency: 'annual', is_live: false,
      observations: [...found.entries()].filter(([key]) => key.startsWith(spec.id + ':')).map(([,value]) => value).sort((a,b) => Number(b.period) - Number(a.period)) })) };
}
export function compareIndicator(series, seenAt, now = new Date()) {
  if (typeof seenAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(seenAt) ||
      !Number.isFinite(Date.parse(seenAt)) || !Number.isFinite(now.getTime()) || Date.parse(seenAt) > now.getTime()) {
    throw new ContextReadError('invalid_news_time');
  }
  const newsYear = new Date(seenAt).getUTCFullYear();
  const observations = series.observations.filter(x => Number(x.period) < newsYear);
  const [latest = null, previous = null] = observations;
  const lag = latest ? newsYear - Number(latest.period) : null;
  return { ...series, latest, previous, observations, observation_age_years: lag,
    freshness: latest ? (lag > 2 ? 'older_annual_context' : 'annual_context') : 'no_observation',
    change: latest && previous ? { value: Number((latest.value - previous.value).toPrecision(12)), unit: series.delta_unit,
      from_period: previous.period, to_period: latest.period, period_gap_years: Number(latest.period) - Number(previous.period),
      basis: Number(latest.period) - Number(previous.period) === 1 ? 'year_over_year' : 'between_available_observations' } : null };
}
export function createContextIndicatorClient(options = {}) {
  const cache = new Map(), pending = new Map();
  const clock = options.clock || Date.now, now = options.now || (() => new Date());
  return async economy => {
    const query = contextIndicatorQuery(economy, now()), old = cache.get(query.url);
    if (old && clock() < old.expires) {
      if (old.error) throw new ContextReadError(old.error);
      return structuredClone(old.data);
    }
    if (pending.has(query.url)) return structuredClone(await pending.get(query.url));
    if (pending.size >= 4) throw new ContextReadError('too_many_context_requests');
    const task = (async () => {
      try {
        const payload = await contextJson(query.url, { accept: 'application/json' }, options);
        const data = normalizeContextIndicators(payload, query, now().toISOString());
        cache.set(query.url, { data, expires: clock() + 86400000 }); return data;
      } catch (error) {
        cache.set(query.url, { error: error instanceof ContextReadError ? error.code : 'upstream_unavailable', expires: clock() + 60000 });
        throw error;
      } finally {
        pending.delete(query.url);
        if (cache.size > 32) cache.delete(cache.keys().next().value);
      }
    })();
    pending.set(query.url, task); return structuredClone(await task);
  };
}
