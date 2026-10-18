/* Private, on-demand comparison over the existing GDELT metadata store and
 * Intel authority. No article scraping, inference API, scheduler, new tables,
 * claims, decisions or public projections. Headlines are untrusted data.
 */
import { ContextReadError, contextJson } from './bounded-json.js';
import { IntelError } from './store.js';
import { COUNTRY_CODE_SOURCE, ISO_TO_FIPS, isCountry, isoFromGdelt } from './news-country-codes.js';
import { compareIndicator, createContextIndicatorClient } from './news-context-indicators.js';

const indicatorClient = createContextIndicatorClient();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
const MAX_SPATIAL = 150;
const MAX_DISTANCE_KM = 300;
const MAX_TIME_HOURS = 24;
const TOPICS = [
  ['economy', 'Economic activity', /\b(econom(?:y|ic|ies)|gdp|recession|growth)\b/gi],
  ['prices', 'Prices and inflation', /\b(inflation|deflation|prices?|cost of living)\b/gi],
  ['jobs', 'Jobs and employment', /\b(jobs?|unemployment|employment|layoffs?|workers?|wages?)\b/gi],
  ['trade', 'Trade', /\b(trade|tariffs?|exports?|imports?|supply chains?)\b/gi],
  ['people', 'Population', /\b(population|demograph(?:y|ics)|migration|migrants?)\b/gi],
  ['housing', 'Housing and urbanization', /\b(housing|homes?|rent|urban|cities|city)\b/gi],
  ['infrastructure', 'Digital infrastructure', /\b(internet|broadband|telecoms?|connectivity|digital)\b/gi],
  ['energy', 'Electricity access', /\b(electricity|energy|power grid|blackouts?|outages?)\b/gi],
  ['water', 'Water and sanitation', /\b(water|sanitation|sewage|drought)\b/gi],
  ['health', 'Health', /\b(health|hospitals?|disease|medical|life expectancy)\b/gi],
  ['food', 'Food and agriculture', /\b(food|agriculture|crops?|harvest|cereal|farm(?:s|ers|ing)?|hunger)\b/gi],
  ['hazards', 'Earthquakes and hazards', /\b(earthquakes?|seismic|tsunami|disaster|tremors?)\b/gi]
];
const NEWS_COLUMNS = 'id,title,canonical_url,published_at,imported_at,headline_location_label,headline_latitude,headline_longitude,location_type,location_country_fips,location_basis,ingestion_provider';
const SPATIAL_COLUMNS = 'id,org_id,title,source_url,observed_at,retrieved_at,review_status,lat,lon,geo_source,retention_until,magnitude:measures->magnitude,magnitude_type:measures->>magnitude_type,snapshot:ops_ingest_records!inner(external_id,source_ref,connector:ops_ingest_connectors!inner(connector_key))';

function invalid(message, code = 'invalid_request', status = 400) { return new IntelError(message, status, code); }
function smallText(value, max = 300) {
  return typeof value === 'string' ? value.slice(0, max).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function safeLink(value, host = null) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (host && (url.protocol !== 'https:' || url.hostname !== host))) return null;
    return url.href;
  } catch { return null; }
}
function number(value, min, max) {
  // PostgREST numeric columns can be encoded as JSON numbers or decimal strings.
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function newsContextQuery(params, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw invalid('Invalid comparison time', 'invalid_time');
  const allowed = ['economy', 'article_id', 'hours', 'limit'];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw invalid('Unsupported or repeated parameter');
  const economy = params.get('economy') || null, articleId = params.get('article_id') || null;
  if (economy !== null && !isCountry(economy)) throw invalid('Use a supported two-letter country code', 'invalid_economy');
  if (articleId !== null && !UUID.test(articleId)) throw invalid('article_id must be a stored article UUID', 'invalid_article_id');
  if (!economy && !articleId) throw invalid('Choose a country or stored article', 'context_required');
  const hoursText = params.get('hours') ?? '72', limitText = params.get('limit') ?? '12';
  if (!/^\d{1,3}$/.test(hoursText) || Number(hoursText) < 1 || Number(hoursText) > 168) throw invalid('hours must be an integer from 1 to 168', 'invalid_hours');
  if (!/^\d{1,2}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 20) throw invalid('limit must be an integer from 1 to 20', 'invalid_limit');
  const hours = Number(hoursText);
  return { economy, article_id: articleId?.toLowerCase() || null, limit: Number(limitText), hours,
    since: new Date(now.getTime() - hours * 3600000).toISOString(), until: now.toISOString() };
}

export function classifyHeadline(title) {
  const text = smallText(title);
  return TOPICS.flatMap(([key, label, regex]) => {
    regex.lastIndex = 0;
    const terms = [...new Set((text.match(regex) || []).map(term => term.toLowerCase()))].slice(0, 6);
    return terms.length ? [{ key, label, terms, basis: 'headline_keyword_match' }] : [];
  });
}

export function normalizeContextNews(row, query) {
  const seen = timestamp(row?.published_at), imported = timestamp(row?.imported_at);
  const country = isoFromGdelt(row?.location_country_fips), link = safeLink(row?.canonical_url), title = smallText(row?.title);
  if (!UUID.test(row?.id || '') || row?.ingestion_provider !== 'gdelt_gkg_v2' || !seen ||
      seen < query.since || seen > query.until || !country || (query.economy && country !== query.economy) || !title || !link) return null;
  const lat = number(row.headline_latitude, -90, 90), lon = number(row.headline_longitude, -180, 180);
  const locationType = number(row.location_type, 1, 5);
  const located = lat !== null && lon !== null && !(lat === 0 && lon === 0) && Number.isInteger(locationType);
  return { id: row.id.toLowerCase(), title, url: link, publisher: new URL(link).hostname, seen_at: seen,
    imported_at: imported && imported <= query.until ? imported : null, content_scope: 'headline_metadata_only',
    news_time_basis: 'GDELT first seen; publication and event times are not verified.',
    geography: { country_iso: country, country_fips: row.location_country_fips,
      place: smallText(row.headline_location_label, 200) || null, lat: located ? lat : null, lon: located ? lon : null,
      location_type: locationType, basis: 'automated_place_mention', crosswalk: COUNTRY_CODE_SOURCE },
    topics: classifyHeadline(title), indicator_ids: [], comparisons: [], nearby_events: [],
    limitations: ['A place mentioned in a headline/article does not establish its event location or geographic scope.',
      'Headline keyword matches suggest indicators to inspect; they do not verify the headline.'] };
}

export function distanceKm(a, b) {
  const rad = Math.PI / 180, deltaLat = (b.lat - a.lat) * rad, deltaLon = (b.lon - a.lon) * rad;
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(deltaLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function matchSpatialEvidence(rows, story, orgId, until) {
  // A country/state centroid is not a local event coordinate. Only GDELT city
  // mentions (types 3/4) are eligible for a point-distance contextual match.
  if (![3, 4].includes(story.geography.location_type) || story.geography.lat === null || story.geography.lon === null) return [];
  const unique = new Map();
  for (const row of rows) {
    const snap = row?.snapshot, observed = timestamp(row?.observed_at), retrieved = timestamp(row?.retrieved_at);
    const lat = number(row?.lat, -90, 90), lon = number(row?.lon, -180, 180), url = safeLink(row?.source_url, 'earthquake.usgs.gov');
    if (row?.org_id !== orgId || !UUID.test(row?.id || '') || snap?.connector?.connector_key !== 'usgs.earthquakes' ||
        snap?.source_ref?.provider !== 'usgs' || typeof snap?.external_id !== 'string' || !snap.external_id ||
        !['accepted', 'unreviewed'].includes(row.review_status) || row.geo_source !== 'source_published' ||
        !observed || !retrieved || observed > until || retrieved > until || !url || lat === null || lon === null ||
        (lat === 0 && lon === 0) || (row.retention_until !== null && row.retention_until !== undefined &&
          (!timestamp(row.retention_until) || timestamp(row.retention_until) <= until))) continue;
    // Pick the latest retained revision before proximity filtering: an older
    // matching location must not override a newer correction outside the area.
    const event = { id: row.id, provider_event_id: smallText(snap.external_id, 100), title: smallText(row.title, 300), url,
      observed_at: observed, retrieved_at: retrieved, review_status: row.review_status,
      magnitude: number(row.magnitude, -5, 15), magnitude_type: smallText(row.magnitude_type, 20) || null,
      location: { lat, lon },
      basis: 'spatial_and_temporal_context', source: 'U.S. Geological Survey',
      qualifier: 'Within 300 km and 24 hours of the mentioned city and GDELT seen time; this does not link the event to the story.' };
    const prior = unique.get(event.provider_event_id);
    if (!prior || prior.retrieved_at < retrieved) unique.set(event.provider_event_id, event);
  }
  return [...unique.values()].flatMap(event => {
    const distance = distanceKm(story.geography, event.location);
    const offset = (Date.parse(event.observed_at) - Date.parse(story.seen_at)) / 3600000;
    if (distance > MAX_DISTANCE_KM || Math.abs(offset) > MAX_TIME_HOURS) return [];
    const { location, ...safe } = event;
    return [{ ...safe, distance_km: Math.round(distance * 10) / 10, time_offset_hours: Math.round(offset * 10) / 10 }];
  }).sort((a, b) => a.distance_km - b.distance_km || a.id.localeCompare(b.id)).slice(0, 5);
}

function exact(value) { return Number(value).toLocaleString('en-US', { maximumSignificantDigits: 12 }); }
export function summarizeContext(story) {
  const comparisons = story.comparisons.filter(item => item.latest !== null).slice(0, 3);
  let result = story.topics.length ? 'Headline topics: ' + story.topics.map(topic => topic.label.toLowerCase()).join(', ') + '. ' : 'No configured headline topic matched. Country indicators remain available below. ';
  result += comparisons.map(item => {
    let text = item.label + ' in ' + story.geography.country_iso + ': ' + exact(item.latest.value) + ' ' + item.unit + ' (' + item.latest.period + ')';
    if (item.previous && item.change) text += ', compared with ' + exact(item.previous.value) + ' ' + item.unit + ' (' + item.previous.period + '), a change of ' + (item.change.value > 0 ? '+' : '') + exact(item.change.value) + ' ' + item.change.unit;
    return text + '.';
  }).join(' ');
  if (story.nearby_events.length) result += ' ' + story.nearby_events.length + ' stored USGS event(s) fall within the displayed distance/time bounds.';
  return result.trim() + ' These comparisons provide context, not a causal explanation or verification of the headline.';
}

async function readStore(env, table, params, options) {
  // Uses the same canonical service-role Supabase authority as intel/store.js;
  // this read-only projection also bounds time and body size. No caller URL,
  // headers or token can reach an external provider.
  const root = new URL(env.SUPABASE_URL);
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash || (root.pathname !== '/' && root.pathname !== '')) throw new ContextReadError('database_configuration');
  const url = new URL('/rest/v1/' + table, root); url.search = params.toString();
  const rows = await contextJson(url.href, { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, accept: 'application/json' }, options);
  if (!Array.isArray(rows)) throw new ContextReadError('invalid_store_response');
  return rows;
}

function publicError(error) { return error instanceof ContextReadError ? error.code : 'context_unavailable'; }
export async function buildNewsContext(env, orgId, query, options = {}) {
  if (!UUID.test(orgId || '')) throw invalid('House organization unavailable', 'house_org_missing', 503);
  const now = new Date(query.until), read = options.readStore || ((table, params) => readStore(env, table, params, options));
  const newsParams = new URLSearchParams({ select: NEWS_COLUMNS, ingestion_provider: 'eq.gdelt_gkg_v2',
    published_at: 'gte.' + query.since, order: 'published_at.desc,id.desc', limit: query.article_id ? '1' : String(query.limit + 1) });
  newsParams.append('published_at', 'lte.' + query.until);
  if (query.article_id) newsParams.set('id', 'eq.' + query.article_id);
  else newsParams.set('location_country_fips', 'eq.' + ISO_TO_FIPS[query.economy]);
  let rawNews = [], newsError = null;
  try {
    rawNews = await read('media_news_articles', newsParams);
    if (!Array.isArray(rawNews) || rawNews.length > (query.article_id ? 1 : query.limit + 1)) throw new ContextReadError('invalid_news_response');
  } catch (error) { newsError = publicError(error); rawNews = []; }
  if (query.article_id && newsError) throw invalid('Stored news is unavailable', newsError, 502);
  if (query.article_id && !rawNews.length) throw invalid('Article not found in this time window', 'article_not_found', 404);
  if (query.article_id && (typeof rawNews[0]?.id !== 'string' || rawNews[0].id.toLowerCase() !== query.article_id)) throw invalid('Stored article did not match the requested ID', 'article_id_mismatch', 502);
  let economy = query.economy;
  if (query.article_id) {
    const mapped = isoFromGdelt(rawNews[0].location_country_fips);
    if (!mapped) throw invalid('This article has no supported country mapping', 'country_unmapped', 422);
    if (economy && economy !== mapped) throw invalid('Selected country does not match the article', 'article_country_mismatch');
    economy = mapped;
  }
  const resolvedQuery = { ...query, economy };
  const stories = rawNews.slice(0, query.limit).map(row => normalizeContextNews(row, resolvedQuery)).filter(Boolean);
  if (query.article_id && !stories.length) throw invalid('Stored article metadata is not usable', 'invalid_article_metadata', 422);
  const spatialParams = new URLSearchParams({ select: SPATIAL_COLUMNS, org_id: 'eq.' + orgId,
    kind: 'eq.source_record', geo_source: 'eq.source_published', review_status: 'in.(accepted,unreviewed)',
    'snapshot.connector.connector_key': 'eq.usgs.earthquakes', observed_at: 'gte.' + new Date(Date.parse(query.since) - DAY).toISOString(),
    order: 'observed_at.desc,retrieved_at.desc,id.desc', limit: String(MAX_SPATIAL + 1) });
  spatialParams.append('observed_at', 'lte.' + query.until);
  spatialParams.set('or', '(retention_until.is.null,retention_until.gt.' + query.until + ')');
  const hasCity = stories.some(story => [3, 4].includes(story.geography.location_type) && story.geography.lat !== null);
  const results = await Promise.allSettled([
    (options.indicatorClient || indicatorClient)(economy),
    hasCity ? read('intel_evidence', spatialParams) : Promise.resolve([])
  ]);
  const indicatorResult = results[0].status === 'fulfilled' ? results[0].value : null;
  const historyValid = indicatorResult?.schema === 'news-context-indicators/v1' && indicatorResult?.economy === economy && Array.isArray(indicatorResult.series);
  const spatialValid = results[1].status === 'fulfilled' && Array.isArray(results[1].value) && results[1].value.length <= MAX_SPATIAL + 1;
  const spatialRows = spatialValid ? results[1].value.slice(0, MAX_SPATIAL) : [];
  const spatialHasMore = spatialValid && results[1].value.length > MAX_SPATIAL;
  const indicators = historyValid ? indicatorResult.series.map(item => compareIndicator(item, query.until, now)) : [];
  for (const story of stories) {
    const topics = new Set(story.topics.map(topic => topic.key));
    story.comparisons = historyValid ? indicatorResult.series.filter(item => topics.has(item.topic)).map(item => compareIndicator(item, story.seen_at, now)) : [];
    story.indicator_ids = story.comparisons.map(item => item.id);
    story.nearby_events = matchSpatialEvidence(spatialRows, story, orgId, query.until);
    story.spatial_coverage = ![3, 4].includes(story.geography.location_type) || story.geography.lat === null ? 'city_location_required' : !spatialValid ? 'unavailable' : spatialHasMore ? 'bounded_sample' : 'stored_records_only';
    story.summary = summarizeContext(story);
  }
  return { ok: true, schema: 'news-context/v1', generated_at: query.until, economy,
    country_name: historyValid ? smallText(indicatorResult.country_name, 100) : economy,
    window: { since: query.since, until: query.until, hours: query.hours }, indicators, stories,
    coverage: { news_status: newsError ? 'unavailable' : stories.length ? 'available' : 'empty',
      news_returned: stories.length, news_sample_limit: query.limit, news_has_more: rawNews.length > query.limit,
      news_rejected: Math.min(rawNews.length, query.limit) - stories.length,
      indicator_status: historyValid ? 'available' : 'unavailable',
      spatial_status: !hasCity ? 'city_location_required' : !spatialValid ? 'unavailable' : spatialHasMore ? 'bounded_sample' : spatialRows.length ? 'stored_records_only' : 'empty_archive',
      spatial_sample_limit: MAX_SPATIAL, spatial_has_more: spatialHasMore },
    sources: [
      { key: 'gdelt', label: 'Stored GDELT headline metadata', status: newsError ? 'unavailable' : 'read',
        detail: newsError || 'Existing ingestion, language/publisher screening and retention determine coverage; this is not all world news.', url: 'https://www.gdeltproject.org/' },
      { key: 'world_bank', label: 'World Bank annual context', status: historyValid ? 'read' : 'unavailable',
        detail: historyValid ? indicatorResult.vintage : publicError(results[0].reason),
        retrieved_at: historyValid ? indicatorResult.retrieved_at : null, provider_updated_at: historyValid ? indicatorResult.provider_updated_at : null,
        url: historyValid ? indicatorResult.fetch_url : 'https://data.worldbank.org/', terms_url: 'https://data.worldbank.org/summary-terms-of-use' },
      { key: 'usgs', label: 'Stored USGS earthquake evidence', status: !hasCity ? 'not_requested' : spatialValid ? 'read' : 'unavailable',
        detail: !hasCity ? 'A city-level news location is required.' : spatialValid ? 'Existing retained evidence only; an empty archive does not establish that no earthquakes occurred. Unreviewed rows remain labeled.' : publicError(results[1].reason),
        url: 'https://earthquake.usgs.gov/' }
    ],
    limitations: [
      'On-demand metadata analysis: no full article text is read and headline claims are not fact-checked.',
      'Annual national observations are background context, not live city conditions, audience measures or revenue.',
      'Observation year, retrieval time and current revision are distinct. Historical availability at the news time is unknown.',
      'Keyword relevance and spatial/time proximity do not establish causation or an event match.',
      'USGS matching examines at most 150 recent stored records, within 300 km and 24 hours of a city mention; five nearest per story are shown.',
      'Other registered data sources remain available in World intelligence but are not automatically compared by this report.'
    ] };
}
