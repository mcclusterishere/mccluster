/* Synthetic USD whole-share, long-only cash scenario. No market fetches or storage.
 * Each order is submitted at step n and fills at the next fixture observation.
 * Replaying the same commands produces the same journal. Not a brokerage ledger. */
export class PaperError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new PaperError(code); };
const safe = n => Number.isSafeInteger(n) ? n : fail('amount_overflow');
export function executeCashOrder(state, order, quote) {
  if (!order || !['buy', 'sell'].includes(order.side) || !Number.isSafeInteger(order.quantity) || order.quantity < 1 || order.quantity > 10000) fail('invalid_order');
  if (!quote || quote.synthetic !== true || quote.symbol !== order.symbol || quote.currency !== 'USD' || quote.halted) fail('quote_unavailable');
  if (![quote.at, order.submitted_at, quote.received_at].every(Number.isSafeInteger) || quote.at <= order.submitted_at || quote.received_at < quote.at || quote.received_at - quote.at > 60000) fail('quote_not_eligible');
  if (!Number.isSafeInteger(quote.bid_cents) || quote.bid_cents <= 0 || !Number.isSafeInteger(quote.ask_cents) || quote.ask_cents < quote.bid_cents) fail('invalid_quote');
  if (!Number.isSafeInteger(state.cash_cents) || state.cash_cents < 0 || !Number.isSafeInteger(state.shares) || state.shares < 0) fail('invalid_state');
  const price = order.side === 'buy' ? quote.ask_cents : quote.bid_cents;
  const gross = safe(price * order.quantity), delta = order.side === 'buy' ? -gross : gross;
  if (order.side === 'buy' && gross > state.cash_cents) fail('insufficient_cash');
  if (order.side === 'sell' && order.quantity > state.shares) fail('insufficient_shares');
  return { cash_cents: safe(state.cash_cents + delta), shares: safe(state.shares + (order.side === 'buy' ? order.quantity : -order.quantity)),
    fill: { side: order.side, quantity: order.quantity, price_cents: price, at: quote.at, synthetic: true,
      journal: [{ account: 'cash', cents: delta }, { account: 'trade_clearing', cents: -delta }] } };
}
export function replayDemo(commands = []) {
  if (!Array.isArray(commands) || commands.length > 100) fail('too_many_orders');
  let state = { cash_cents: 1000000, shares: 0 }, step = 0;
  const seen = new Map(), fills = [];
  for (const command of commands) {
    if (!command || Object.keys(command).sort().join(',') !== 'id,quantity,side' || !/^[A-Za-z0-9-]{1,64}$/.test(command.id || '')) fail('invalid_order');
    const signature = JSON.stringify([command.side, command.quantity]);
    if (seen.has(command.id)) { if (seen.get(command.id) !== signature) fail('idempotency_conflict'); continue; }
    const submitted = Date.UTC(2026, 0, 5, 15) + step * 60000;
    const quote = { symbol: 'DEMO', currency: 'USD', synthetic: true, at: submitted + 60000, received_at: submitted + 60000,
      bid_cents: 9990 + (step % 4) * 20, ask_cents: 10010 + (step % 4) * 20 };
    const result = executeCashOrder(state, { ...command, symbol: 'DEMO', submitted_at: submitted }, quote);
    state = { cash_cents: result.cash_cents, shares: result.shares }; step++;
    seen.set(command.id, signature); fills.push({ id: command.id, ...result.fill });
  }
  const mark = 9990 + (Math.max(0, step - 1) % 4) * 20;
  return { schema: 'finance-paper-demo/v1', mode: 'synthetic', persisted: false, currency: 'USD', symbol: 'DEMO',
    initial_cash_cents: 1000000, ...state, mark_cents: mark, equity_cents: safe(state.cash_cents + state.shares * mark), fills,
    freshness: { state: 'fixture', is_live: false, as_of: new Date(Date.UTC(2026, 0, 5, 15) + step * 60000).toISOString() },
    limitations: ['Synthetic prices only', 'Whole shares; no fees or taxes', 'No dividends or corporate actions', 'Resets on reload; no saved portfolio'] };
}

export async function readDemoCommands(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail('json_required');
  const reader = request.body?.getReader();
  if (!reader) fail('invalid_body');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); fail('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('invalid_json'); }
  if (!data || Object.keys(data).join(',') !== 'orders') fail('invalid_body');
  return data.orders;
}
