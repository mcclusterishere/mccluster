/* OVH Layer 1 — bounded source observations, not forecasts or trading.
 * Reuses public.ops_ingest_{connectors,runs,records}; no second ledger/database.
 * Existing GDELT and USGS collectors remain authoritative for their own feeds.
 */
import { pathToFileURL } from 'node:url';
import { rest, resolveHouseOrgId } from '../supabase.mjs';

const HOUR = 3_600_000, DAY = 24 * HOUR;
export const SOURCES = Object.freeze([
  { key: 'market.wdi', name: 'World Bank WDI macro indicators', cadence: DAY, provider: 'World Bank', terms: 'https://data.worldbank.org/summary-terms-of-use', retentionDays: 3650 },
  { key: 'market.bls', name: 'U.S. BLS economic observations', cadence: DAY, provider: 'Bureau of Labor Statistics', terms: 'https://www.bls.gov/developers/', retentionDays: 1825 },
  { key: 'market.sec', name: 'SEC EDGAR filing notices', cadence: HOUR, provider: 'U.S. Securities and Exchange Commission', terms: 'https://www.sec.gov/about/webmaster-frequently-asked-questions', retentionDays: 365 },
  { key: 'market.alpaca.iex', name: 'Alpaca IEX minute bars (limited coverage)', cadence: 15 * 60_000, provider: 'Alpaca', terms: 'https://docs.alpaca.markets/us/docs/about-market-data-api', retentionDays: 30 }
].map(x => Object.freeze(x)));

const WDI = Object.freeze({
  'NY.GDP.MKTP.CD': 'USD', 'NY.GDP.MKTP.KD.ZG': 'percent',
  'SP.POP.TOTL': 'people', 'FP.CPI.TOTL.ZG': 'percent',
  'SL.UEM.TOTL.ZS': 'percent', 'NE.TRD.GNFS.ZS': 'percent'
});
const BLS = Object.freeze({
  CUUR0000SA0: 'CPI-U all items, not seasonally adjusted',
  LNS14000000: 'Civilian unemployment rate, seasonally adjusted',
  CES0000000001: 'Total nonfarm employment, seasonally adjusted'
});
const SEC_FORMS = new Set(['8-K','8-K/A','10-K','10-K/A','10-Q','10-Q/A','20-F','6-K']);
const ALLOWED_HOSTS = new Set(['api.worldbank.org','api.bls.gov','data.sec.gov','data.alpaca.markets']);
const VALID_SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const VALID_CIK = /^\d{1,10}$/;

function fail(code) { return Object.assign(new Error(code), { code }); }
function commaList(value, fallback, max, check) {
  const raw = String(value || fallback).split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  const unique = [...new Set(raw)];
  if (!unique.length || unique.length > max || unique.some(x => !check.test(x))) throw fail('invalid_source_configuration');
  return unique;
}
export function sourceReadiness(source, env = process.env) {
  if (source === 'market.wdi' || source === 'market.bls') return 'ready';
  if (source === 'market.sec') {
    const ciks = String(env.MCCLUSTER_MARKET_SEC_CIKS || '').trim();
    if (!ciks || !env.MCCLUSTER_MARKET_SEC_USER_AGENT) return 'needs_sec_ciks_and_user_agent';
    if (!/^[\x20-\x7E]{12,180}$/.test(String(env.MCCLUSTER_MARKET_SEC_USER_AGENT)) ||
        !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(String(env.MCCLUSTER_MARKET_SEC_USER_AGENT))) return 'invalid_sec_user_agent';
    try { commaList(ciks, '', 8, VALID_CIK); } catch { return 'invalid_sec_ciks'; }
    return 'ready';
  }
  if (source === 'market.alpaca.iex') {
    if (env.MCCLUSTER_MARKET_ALPACA_STORAGE_APPROVED !== 'true') return 'needs_market_data_license_review';
    if (!env.APCA_API_KEY_ID || !env.APCA_API_SECRET_KEY) return 'needs_alpaca_credentials';
    try { commaList(env.MCCLUSTER_MARKET_SYMBOLS, 'SPY,QQQ,TLT,GLD,USO', 10, VALID_SYMBOL); }
    catch { return 'invalid_market_symbols'; }
    return 'ready';
  }
  return 'unknown_source';
}
function iso(d) { if (!Number.isFinite(Date.parse(d))) throw fail('invalid_observation_time'); return new Date(d).toISOString(); }
function cleanNumber(value, allowZero = true) {
  if (typeof value === 'string') value = value.replace(/,/g, '').trim();
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : null;
}
function observation(external_id, kind, observed_at, payload, url, provider, retrievedAt) {
  return { external_id, record_kind: kind, observed_at: iso(observed_at), payload,
    source_ref: { url, provider, retrieved_at: iso(retrievedAt), observed_time_kind: payload.observed_time_kind || 'period_end' } };
}

// The upstream URL is always constructed locally, never passed by a caller or returned by a feed.
// Max response size is enforced while streaming, not just from Content-Length.
export async function boundedJson(url, { fetchImpl = fetch, method = 'GET', headers = {}, body, maxBytes = 512 * 1024, timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname) || target.username || target.password ||
      target.port || target.hash) throw fail('provider_url_not_allowed');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target.href, { method, redirect: 'manual', signal: abort.signal,
      headers: { accept: 'application/json', ...headers }, ...(body ? { body } : {}) });
    if (response.status >= 300 && response.status < 400) throw fail('provider_redirect_rejected');
    if (!response.ok) throw fail('provider_http_' + response.status);
    if (Number(response.headers?.get('content-length') || 0) > maxBytes || !response.body) throw fail('provider_body_invalid');
    const reader = response.body.getReader();
    let size = 0; const parts = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw fail('provider_body_too_large'); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const p of parts) { bytes.set(p, offset); offset += p.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw fail('provider_invalid_json'); }
  } catch (error) {
    if (abort.signal.aborted) throw fail('provider_timeout');
    if (error?.code) throw error;
    throw fail('provider_unavailable');
  } finally { clearTimeout(timer); }
}

export async function collectWdi({ fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  const economies = commaList(env.MCCLUSTER_MARKET_ECONOMIES, 'WLD,US,CN,IN,DE,JP,GB,BR', 12, /^(?:[A-Z]{2}|WLD)$/);
  const results = [], ids = Object.keys(WDI);
  const yearLimit = now.getUTCFullYear() - 1;
  for (const economy of economies) {
    const url = 'https://api.worldbank.org/v2/country/' + economy + '/indicator/' + ids.join(';') +
      '?format=json&source=2&mrnev=2&per_page=100&page=1';
    const data = await boundedJson(url, { fetchImpl });
    if (!Array.isArray(data) || data.length !== 2 || Number(data[0]?.pages) !== 1 || !Array.isArray(data[1]) ||
      data[1].length > 100) throw fail('wdi_response_invalid');
    for (const row of data[1]) {
      const code = row?.indicator?.id, year = Number(row?.date);
      if (!Object.hasOwn(WDI, code) || !/^\d{4}$/.test(String(row?.date)) || year < 1900 || year > yearLimit)
        continue;
      const geography = economy === 'WLD' ? row?.countryiso3code === 'WLD' : row?.country?.id === economy;
      if (!geography) throw fail('wdi_geography_mismatch');
      const value = row?.value;
      if (value === null || typeof value !== 'number' || !Number.isFinite(value)) continue;
      const observedAt = new Date(Date.UTC(year, 11, 31, 12)).toISOString();
      results.push(observation(economy + ':' + code + ':' + year, 'economic_indicator', observedAt, {
        economy, indicator: code, value, unit: WDI[code], period: String(year),
        frequency: 'annual', provider_updated_at: data[0]?.lastupdated || null,
        is_real_time: false, observed_time_kind: 'period_end',
        source_licence_note: 'Check indicator-level third-party rights before external redistribution.'
      }, 'https://data.worldbank.org/indicator/' + code + '?locations=' + economy, 'World Bank WDI', now.toISOString()));
    }
  }
  return results;
}

export async function collectBls({ fetchImpl = fetch, now = new Date() } = {}) {
  const endYear = now.getUTCFullYear();
  const request = JSON.stringify({ seriesid: Object.keys(BLS), startyear: String(endYear - 2), endyear: String(endYear) });
  const url = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
  const data = await boundedJson(url, { fetchImpl, method: 'POST',
    headers: { 'content-type': 'application/json' }, body: request, maxBytes: 1024 * 1024 });
  const series = data?.Results?.series;
  if (data?.status !== 'REQUEST_SUCCEEDED' || !Array.isArray(series)) throw fail('bls_response_invalid');
  const results = [];
  for (const s of series) {
    if (!Object.hasOwn(BLS, s.seriesID) || !Array.isArray(s.data)) throw fail('bls_series_invalid');
    for (const row of s.data.slice(0, 42)) {
      if (!/^\d{4}$/.test(String(row.year)) || !/^M(0[1-9]|1[0-2])$/.test(String(row.period))) continue;
      const n = Number(row.period.slice(1)), y = Number(row.year);
      const periodEnd = new Date(Date.UTC(y, n, 0, 12));
      if (periodEnd > now || y < endYear - 2) continue;
      const value = cleanNumber(row.value);
      if (value === null) continue;
      results.push(observation(s.seriesID + ':' + row.year + '-' + String(n).padStart(2,'0'), 'economic_indicator',
        periodEnd.toISOString(), {
          series_id: s.seriesID, label: BLS[s.seriesID], value,
          unit: s.seriesID === 'CUUR0000SA0' ? 'index' : s.seriesID === 'LNS14000000' ? 'percent' : 'thousand_persons',
          period: row.year + '-' + String(n).padStart(2,'0'),
          frequency: 'monthly', is_real_time: false, observed_time_kind: 'period_end',
          provisional: Array.isArray(row.footnotes) && row.footnotes.some(f => f?.code === 'P')
        }, 'https://data.bls.gov/timeseries/' + s.seriesID, 'BLS', now.toISOString()));
    }
  }
  return results;
}

export async function collectSec({ fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  const ciks = commaList(env.MCCLUSTER_MARKET_SEC_CIKS, '', 8, VALID_CIK), results = [];
  const userAgent = String(env.MCCLUSTER_MARKET_SEC_USER_AGENT);
  if (sourceReadiness('market.sec', env) !== 'ready') throw fail('sec_not_configured');
  for (const cik of ciks) {
    const padded = cik.padStart(10, '0'), url = 'https://data.sec.gov/submissions/CIK' + padded + '.json';
    const data = await boundedJson(url, { fetchImpl, headers: { 'user-agent': userAgent } });
    if (String(data?.cik) !== String(Number(cik)) || !data?.filings?.recent) throw fail('sec_cik_mismatch');
    const f = data.filings.recent;
    if (![f.accessionNumber,f.filingDate,f.form].every(Array.isArray)) throw fail('sec_response_invalid');
    for (let i=0; i<Math.min(30,f.form.length); i++) {
      const form=f.form[i], accession=f.accessionNumber[i], day=f.filingDate[i];
      if (!SEC_FORMS.has(form) || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const moment = new Date(day + 'T12:00:00Z');
      if (!Number.isFinite(moment.getTime()) || moment > now) continue;
      results.push(observation(padded + ':' + accession, 'sec_filing_notice', moment.toISOString(), {
        cik: padded, form, accession, filing_date: day,
        issuer_name: String(data.name || '').slice(0, 160), observed_time_kind: 'filing_date',
        note: 'Filing metadata only; not evidence about earnings surprises.'
      }, url, 'SEC EDGAR', now.toISOString()));
    }
  }
  return results;
}

export async function collectAlpaca({ fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  if (sourceReadiness('market.alpaca.iex', env) !== 'ready') throw fail('alpaca_not_configured');
  const symbols = commaList(env.MCCLUSTER_MARKET_SYMBOLS, 'SPY,QQQ,TLT,GLD,USO', 10, VALID_SYMBOL);
  const url = 'https://data.alpaca.markets/v2/stocks/bars/latest?symbols=' + symbols.join(',') + '&feed=iex';
  const data = await boundedJson(url, { fetchImpl, headers: {
    'APCA-API-KEY-ID': env.APCA_API_KEY_ID, 'APCA-API-SECRET-KEY': env.APCA_API_SECRET_KEY
  } });
  if (!data || typeof data.bars !== 'object' || Array.isArray(data.bars)) throw fail('alpaca_response_invalid');
  const results = [];
  for (const symbol of symbols) {
    const b = data.bars[symbol];
    if (!b) continue; // Out-of-hours/illiquid symbols can have no current bar.
    const t = Date.parse(b.t);
    if (!Number.isFinite(t) || t > now.getTime() + 60_000) throw fail('alpaca_time_invalid');
    const prices = [b.o,b.h,b.l,b.c].map(v => cleanNumber(v, false));
    const volume = cleanNumber(b.v);
    if (prices.some(x => x === null) || volume === null || prices[1] < prices[2] ||
        prices[1] < Math.max(prices[0], prices[3]) || prices[2] > Math.min(prices[0], prices[3])) throw fail('alpaca_bar_invalid');
    results.push(observation(symbol + ':' + new Date(t).toISOString(), 'market_minute_bar', new Date(t).toISOString(), {
      symbol, open: prices[0], high: prices[1], low: prices[2], close: prices[3], volume,
      currency: 'USD', frequency: '1min', feed: 'iex', coverage: 'partial_US_market_not_consolidated',
      observed_time_kind: 'market_bar_time', is_stale: now.getTime() - t > 20 * 60_000
    }, url, 'Alpaca IEX', now.toISOString()));
  }
  return results;
}

const COLLECT = { 'market.wdi': collectWdi, 'market.bls': collectBls, 'market.sec': collectSec, 'market.alpaca.iex': collectAlpaca };
export function createDb({ restImpl = rest, resolveOrg = resolveHouseOrgId } = {}) {
  return {
    org: resolveOrg,
    async rows(path) { return (await restImpl(path)).body; },
    async rpc(name, args) { return (await restImpl('rpc/' + name, { method:'POST', body:JSON.stringify(args) })).body; },
    async ensure(org, def) {
      // Insert missing connector without resetting an owner's disabled flag or overwriting its policies.
      await restImpl('ops_ingest_connectors?on_conflict=org_id,connector_key', {
        method:'POST', headers:{ Prefer:'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ org_id:org, connector_key:def.key, kind:'api',
          display_name:def.name, description:'OVH Layer 1; evidence-only observations, no trading',
          retention_policy:{ days:def.retentionDays },
          license_policy:{ provider:def.provider, terms_url:def.terms, distribution:'private_internal_only',
            review_before_redistribution:true } })
      });
    }
  };
}

export async function observeLayerOne({ db = createDb(), fetchImpl = fetch, env = process.env,
  now = new Date(), source = null, replay = false } = {}) {
  if (env.MCCLUSTER_MARKET_LAYER1_ENABLED !== 'true') return { status:'disabled', reason:'operator_flag_not_enabled' };
  if (source && !SOURCES.some(s => s.key === source)) throw fail('unknown_source');
  // A production migration fixes a legacy upsert that clears license/retention metadata.
  // Abort BEFORE registering/writing anything until the verified service-only contract exists.
  const policyReady = await db.rpc('market_layer1_policy_ready_service', {}).catch(() => false);
  if (policyReady !== true) return { status:'blocked', reason:'policy_migration_not_applied' };
  const org = await db.org(), results = [];
  const defs = SOURCES.filter(x => !source || x.key === source);
  for (const def of defs) {
    const readiness = sourceReadiness(def.key, env);
    if (readiness !== 'ready') { results.push({ source:def.key, status:'blocked', reason:readiness }); continue; }
    try {
      await db.ensure(org, def);
      const rows = await db.rows('ops_ingest_connectors?org_id=eq.' + org +
        '&connector_key=eq.' + def.key + '&select=enabled,last_sync_at&limit=1');
      const connector = rows?.[0];
      if (!connector?.enabled) { results.push({ source:def.key, status:'disabled_by_owner' }); continue; }
      if (!replay && connector.last_sync_at && now.getTime() - Date.parse(connector.last_sync_at) < def.cadence) {
        results.push({ source:def.key, status:'not_due' }); continue;
      }
      const run = await db.rpc('ops_ingest_begin_run_service',
        { p_org:org, p_connector_key:def.key, p_mode:replay?'replay':'incremental',
          p_metadata:{ executor:'ovh-market-layer1/v1', requested_at:now.toISOString() } });
      if (!run?.id) throw fail('ingest_run_not_created');
      let count = 0;
      try {
        const records = await COLLECT[def.key]({ fetchImpl, env, now });
        if (!records.length) throw fail('provider_has_no_observations');
        for (const record of records) {
          await db.rpc('ops_ingest_write_record_service', {
            p_org:org, p_run_id:run.id, p_external_id:record.external_id,
            p_record_kind:record.record_kind, p_observed_at:record.observed_at,
            p_payload:record.payload, p_source_ref:record.source_ref
          });
          count++;
        }
        await db.rpc('ops_ingest_finish_run_service',
          { p_org:org, p_run_id:run.id, p_status:'succeeded',
            p_cursor_after:{ last_observed_at:records.reduce((m,x)=>x.observed_at>m?x.observed_at:m,''),
              source_count:records.length } });
        results.push({ source:def.key, status:'succeeded', records_seen:count, run_id:run.id });
      } catch (e) {
        await db.rpc('ops_ingest_finish_run_service',
          { p_org:org, p_run_id:run.id, p_status:'failed', p_error:String(e?.code||'ingestion_failed').slice(0,120) });
        results.push({ source:def.key, status:'failed', records_seen:count, reason:e?.code||'ingestion_failed', run_id:run.id });
      }
    } catch (e) {
      results.push({ source:def.key, status:'failed', reason:e?.code||'database_unavailable' });
    }
  }
  return { status:results.some(x=>x.status==='failed')?'partial':'complete',
    generated_at:now.toISOString(), sources:results };
}

export async function layerOneStatus({ db = createDb(), env = process.env, now = new Date() } = {}) {
  const org=await db.org(), rows=await db.rows('ops_ingest_connectors?org_id=eq.'+org+
    '&select=connector_key,enabled,last_ok_at,last_sync_at,last_error,last_error_at&limit=200');
  const byKey=new Map((rows||[]).map(r=>[r.connector_key,r]));
  const sources=SOURCES.map(def=>{
    const row=byKey.get(def.key), readiness=sourceReadiness(def.key,env);
    const age=row?.last_ok_at?now.getTime()-Date.parse(row.last_ok_at):null;
    const state=readiness!=='ready'?'blocked':!row?'not_registered':!row.enabled?'disabled_by_owner':
      age===null?'never_succeeded':age>def.cadence*2?'stale':'healthy';
    return { source:def.key, status:state, reason:readiness!=='ready'?readiness:row?.last_error||null,
      last_ok_at:row?.last_ok_at||null, last_sync_at:row?.last_sync_at||null, cadence_minutes:def.cadence/60_000 };
  });
  // Read existing authorities without copying GDELT or USGS into a shadow ingestion store.
  const [news]=await Promise.all([db.rows('media_news_articles?select=imported_at&order=imported_at.desc&limit=1')
    .catch(()=>[])]);
  const quake=byKey.get('usgs.earthquakes');
  sources.push({source:'world.gdelt',status:news?.[0]?'existing_pipeline':'unverified',
    last_observed_at:news?.[0]?.imported_at||null, scope:'existing_worker_ingest'});
  sources.push({source:'usgs.earthquakes',status:quake?.last_ok_at?'existing_pipeline':'unverified',
    last_ok_at:quake?.last_ok_at||null, scope:'existing_intel_collector'});
  return {schema:'market-layer1-status/v1',generated_at:now.toISOString(),
    enabled:env.MCCLUSTER_MARKET_LAYER1_ENABLED==='true',sources};
}

async function main() {
  const env=process.env, args=process.argv.slice(2);
  if (args.some(a=>!['--status','--replay'].includes(a)&&!a.startsWith('--source='))) throw fail('invalid_argument');
  const source=args.find(a=>a.startsWith('--source='))?.slice(9)||null;
  const output=args.includes('--status') ? await layerOneStatus({env}) :
    await observeLayerOne({env, source, replay:args.includes('--replay')});
  console.log(JSON.stringify(output));
  if (output.status==='partial') process.exitCode=1;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{ console.error(JSON.stringify({status:'failed',error:e?.code||'layer_one_unavailable'}));process.exitCode=1; });
}
