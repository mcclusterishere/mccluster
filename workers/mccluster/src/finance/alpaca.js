/* Read-only Alpaca Paper metadata + IEX market data. No account/order endpoints.
 * Account-wide quota reservations use the existing canonical SQL RPC boundary. */
import { rpc, IntelError } from '../intel/store.js';
export class FinanceDataError extends IntelError {
  constructor(code, status = 503) { super(code, status, code); }
}
const symbolRE = /^[A-Z][A-Z0-9.\-]{0,14}$/;
export function securitySymbol(value) {
  if (!symbolRE.test(value || '')) throw new FinanceDataError('invalid_symbol', 400);
  return value;
}
const MIC = { NYSE: 'XNYS', NASDAQ: 'XNAS', ARCA: 'ARCX', AMEX: 'XASE', BATS: 'BATS' };
export function createAlpacaClient({ fetchImpl = fetch, now = Date.now, reserve = rpc } = {}) {
  const cache = new Map(), pending = new Map();
  let identity = '', blockedUntil = 0, denied = false, failures = 0;
  const config = env => {
    if (!env.APCA_API_KEY_ID || !env.APCA_API_SECRET_KEY) throw new FinanceDataError('needs_key');
    if (env.FINANCE_ALPACA_ENABLED !== 'true') throw new FinanceDataError('provider_disabled');
    // Isolate caches/breakers across key rotation. Never return or log the identity.
    const next = env.APCA_API_KEY_ID + '\0' + env.APCA_API_SECRET_KEY;
    if (identity !== next) { identity = next; cache.clear(); pending.clear(); denied = false; blockedUntil = 0; failures = 0; }
  };
  async function request(env, origin, path, params = {}, ttl = 0, fresh = false) {
    config(env);
    const generation = identity;
    const key = origin + path + '?' + new URLSearchParams(params), t = now();
    if (denied) throw new FinanceDataError('key_rejected');
    const saved = cache.get(key);
    if (!fresh && saved && t - saved.at < ttl) return saved.value;
    if (t < blockedUntil) throw new FinanceDataError('provider_backoff', 429);
    if (!fresh && pending.has(key)) return pending.get(key);
    const task = (async () => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.APCA_API_KEY_ID));
      const account = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      // SQL enforces 180 requests/minute shared across all isolates, not 180 each.
      const budget = await reserve(env, 'finance_quote_budget', { p_account: account });
      if (budget !== true) throw new FinanceDataError('quota_exhausted', 429);
      let response;
      try {
        response = await fetchImpl(key, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000),
          headers: { 'APCA-API-KEY-ID': env.APCA_API_KEY_ID, 'APCA-API-SECRET-KEY': env.APCA_API_SECRET_KEY, accept: 'application/json' } });
      } catch { failures++; if (failures >= 5) blockedUntil = now() + 60000; throw new FinanceDataError('provider_unavailable'); }
      if ([401,403].includes(response.status)) { denied = true; cache.clear(); throw new FinanceDataError('key_rejected'); }
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const wait = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - now();
        blockedUntil = Math.max(now() + 60000, Number.isFinite(wait) ? now() + wait : 0, Number.isFinite(reset) ? reset : 0);
        throw new FinanceDataError('rate_limited',429);
      }
      if (!response.ok) { failures++; if (failures >= 5) blockedUntil = now() + 60000; throw new FinanceDataError(response.status === 404 ? 'security_unavailable' : 'provider_unavailable'); }
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      try { while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length;
        if (size > 12000000) { await reader.cancel(); throw new FinanceDataError('provider_response_too_large'); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const c of chunks) { bytes.set(c,offset); offset += c.length; }
      let value; try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new FinanceDataError('provider_invalid'); }
      failures = 0;
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      if (generation !== identity) throw new FinanceDataError('connection_changed');
      if (ttl) cache.set(key,{at:now(),value});
      return value;
    })();
    if (!fresh) pending.set(key,task);
    try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
  }
  async function assets(env) {
    const rows = await request(env,'https://paper-api.alpaca.markets','/v2/assets',{status:'active',asset_class:'us_equity'},3600000);
    if (!Array.isArray(rows)) throw new FinanceDataError('provider_invalid');
    return rows.filter(a => a.status === 'active' && a.class === 'us_equity' && symbolRE.test(a.symbol) && MIC[a.exchange] && typeof a.id === 'string')
      .map(a => ({id:a.id,symbol:a.symbol,name:String(a.name || a.symbol),mic:MIC[a.exchange],exchange:a.exchange,country:'US',currency:'USD',tradable:a.tradable===true}));
  }
  async function asset(env,symbol) { securitySymbol(symbol); const a = (await assets(env)).find(a=>a.symbol===symbol); if (!a) throw new FinanceDataError('security_unavailable',404); return a; }
  async function quote(env,symbol,{fresh=false}={}) {
    const instrument = await asset(env,symbol);
    const [data,clock] = await Promise.all([
      request(env,'https://data.alpaca.markets','/v2/stocks/quotes/latest',{symbols:symbol,feed:'iex'},5000,fresh),
      request(env,'https://paper-api.alpaca.markets','/v2/clock',{},10000,fresh)
    ]);
    const q = data?.quotes?.[symbol], at = Date.parse(q?.t), received = now(), age = received-at;
    const clockAge = received-Date.parse(clock?.timestamp);
    const valid = q && Number.isFinite(at) && age >= -1000 && Number.isFinite(q.bp) && q.bp > 0 && Number.isFinite(q.ap) && q.ap >= q.bp;
    const session = Number.isFinite(clockAge) && clockAge >= -1000 && clockAge <= 15000 ? (clock.is_open === true ? 'open' : 'closed') : 'unknown';
    const status = !valid ? 'unverified' : age > 30000 ? 'stale' : 'real_time';
    return {instrument,provider:'alpaca',feed:'iex',venue_scope:'IEX only; not consolidated NBBO',currency:'USD',
      kind:'bid_ask',as_of:valid?q.t:null,received_at:new Date(received).toISOString(),bid:valid?q.bp:null,ask:valid?q.ap:null,
      status,session,is_live:status==='real_time' && session==='open',eligible:status==='real_time' && session==='open' && instrument.tradable};
  }
  async function history(env,symbol,period='1Y') {
    const instrument = await asset(env,symbol);
    const days = {'1M':31,'1Y':366,'5Y':1827}[period];
    if (!days) throw new FinanceDataError('invalid_period',400);
    const end = new Date(now()-16*60000), start = new Date(end.getTime()-days*86400000);
    const args = {symbols:symbol,feed:'iex',timeframe:period==='5Y'?'1Week':'1Day',adjustment:'all',start:start.toISOString(),end:end.toISOString(),limit:'1000',sort:'asc'};
    const data = await request(env,'https://data.alpaca.markets','/v2/stocks/bars',args,60000);
    const rows = data?.bars?.[symbol];
    if (rows !== undefined && !Array.isArray(rows)) throw new FinanceDataError('provider_invalid');
    const bars = (rows || []).filter(b=>Number.isFinite(Date.parse(b.t)) && Date.parse(b.t)<=end.getTime() && Date.parse(b.t)>=start.getTime() && Number.isFinite(b.c) && b.c>0)
      .map(b=>({at:b.t,close:b.c})).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
    return {instrument,provider:'alpaca',feed:'iex',period,interval:args.timeframe,adjustment:'all',bars,
      truncated:!!data.next_page_token,status:bars.length?'historical':'unavailable',is_live:false,end:end.toISOString(),
      note:'IEX historical bars; split/dividend/spin-off adjusted. Ends at least 16 minutes ago; not execution prices.'};
  }
  return {asset,quote,history,async search(env,q='') { if (q.length>40) throw new FinanceDataError('invalid_query',400); const term=q.toUpperCase(); return {provider:'alpaca',feed:'asset_directory',items:(await assets(env)).filter(a=>(a.symbol+' '+a.name).toUpperCase().includes(term)).slice(0,30)}; }};
}
