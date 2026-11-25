import { hostname } from '../creator-domains.js';
/* Registrar transport only; deliberately not wired to a public purchase endpoint.
   Official contract: https://www.namesilo.com/api-reference (registerDomain, renewDomain, getPrices).
   Never log the request URL: NameSilo puts its API key in query parameters. */
export function nameSiloAdapter({ apiKey, fetchImpl, allowLive = false }) {
  if (!apiKey) throw new Error('Registrar credentials are not configured');
  if (!fetchImpl && !allowLive) throw new Error('Provide a fixture transport; live registrar access is disabled');
  fetchImpl ||= fetch;
  async function call(operation, params = {}) {
    const url = new URL(`https://www.namesilo.com/api/${operation}`);
    // Real provider sandbox access/endpoint must be confirmed with NameSilo. Tests inject transport.
    url.search = new URLSearchParams({ version: '1', type: 'json', key: apiKey, ...params });
    const r = await fetchImpl(url.toString());
    const body = await r.json();
    if (!r.ok || !body.reply) throw new Error('Registrar response could not be confirmed');
    return body.reply;
  }
  return {
    async quote(domain, action = 'register') {
      domain = hostname(domain);
      if (!['register', 'renew'].includes(action)) throw new Error('Invalid registrar action');
      const tld = domain.slice(domain.lastIndexOf('.') + 1);
      if (!['com','net','org'].includes(tld)) throw new Error('This domain extension is not offered');
      const prices = await call('getPrices');
      if (String(prices.code) !== '300') throw new Error('Registrar pricing is unavailable');
      // This is the registrar base cost, not a payable retail quote or proof of availability.
      const cost = String(prices[tld]?.[action === 'renew' ? 'renew' : 'registration'] || '');
      if (!/^\d+\.\d{2}$/.test(cost)) throw new Error('Registrar pricing could not be confirmed');
      return { domain, action, currency: 'USD', registrar_cost: cost, purchasable: false };
    },
    register({ domain, years, contactId, paymentId }) {
      domain = hostname(domain);
      if (!Number.isInteger(years) || years < 1 || years > 10) throw new Error('Invalid registration term');
      if (!contactId) throw new Error('Verified registrant contact is required');
      return call('registerDomain', { domain, years: String(years), contact_id: contactId, ...(paymentId ? {payment_id:paymentId} : {}), private: '1', auto_renew: '0' });
    },
    renew({ domain, years, paymentId }) {
      domain = hostname(domain);
      if (!Number.isInteger(years) || years < 1 || years > 10) throw new Error('Invalid renewal term');
      return call('renewDomain', { domain, years: String(years), ...(paymentId ? {payment_id:paymentId} : {}) });
    }
  };
}
/* store.claim atomically changes funded -> executing and returns order, or null. It MUST
   persist before provider I/O. No timeout/ambiguous response can retry a financial mutation.
   Implementations must accept only server-verified webhook funding, never browser flags. */
export async function fulfillDomainOrder(id, { store, registrar, enabled = false, now = Date.now() }) {
  if (!enabled) throw new Error('Registrar fulfillment is not enabled');
  const order = await store.claim(id);
  if (!order) return { status: 'not_claimed' };
  if (!order.funded_event_id || !order.registrant_contact_id || !order.consent_at || !Number.isFinite(order.quote_expires_at) || order.quote_expires_at <= now || order.currency !== 'USD' || !Number.isSafeInteger(order.total_cents) || order.total_cents <= 0 || order.paid_cents !== order.total_cents || !['register','renew'].includes(order.action) || !Number.isInteger(order.years) || order.years < 1 || order.years > 10) {
    await store.finish(id, { status: 'blocked', reason: 'Funding, valid quote, registrant contact and consent are required' });
    return { status: 'blocked' };
  }
  try { hostname(order.hostname); } catch { await store.finish(id, { status: 'blocked', reason: 'Invalid domain' }); return { status: 'blocked' }; }
  let outcome;
  try {
    const result = await registrar[order.action]({ domain: order.hostname, years: order.years, contactId: order.registrant_contact_id, paymentId: order.payment_id });
    // 301/302 can mean purchased using fallback nameservers/contact. Never retry or call these complete.
    // A malformed/sub-cent charge must not be rounded into an expected amount.
    const amount = String(result.order_amount ?? '');
    const cents = /^\d+\.\d{2}$/.test(amount) ? Number(amount.replace('.', '')) : NaN;
    const confirmed = String(result.code) === '300' && result.domain === order.hostname && (order.registrar_cents === undefined || (Number.isSafeInteger(cents) && cents === order.registrar_cents));
    outcome = confirmed ? { status: 'fulfilled', registrar_amount: result.order_amount } : { status: 'reconciliation_required', registrar_code: String(result.code || ''), reason: 'Confirm ownership, registrant and charge at registrar before further action' };
  } catch (e) { outcome = e.noCharge ? { status: 'refund_required', reason: e.message } : { status: 'reconciliation_required', reason: 'Registrar outcome unknown; do not repeat purchase or renewal' }; }
  const persisted = await store.finish(id, outcome);
  return persisted?.status ? persisted : outcome;
}
