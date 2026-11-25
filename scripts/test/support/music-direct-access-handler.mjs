// supabase/functions/music-direct-access/index.ts as it is written, runnable under Node:
// types stripped, its imports replaced by what the caller passes (the database client,
// Stripe, the operator check). The shared decision code (../_shared/music-direct.ts) is
// the real module. Nothing is rewritten inside the handler, so what a test drives here is
// the source that would be deployed.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as shared from '../../../supabase/functions/_shared/music-direct.ts';

const SOURCE_URL = new URL('../../../supabase/functions/music-direct-access/index.ts', import.meta.url);
export const OPERATOR_TOKEN = 'local-operator';

/**
 * `admin` is the supabase-js client the function would create; `sessions` is a Map of the
 * Checkout Sessions Stripe would return by id. Returns the handler, a JSON `call`, and
 * everything the function logged with console.error.
 */
export async function loadAccessHandler({ admin, sessions = new Map(), isHouseOperator = async () => true }) {
  const source = await readFile(SOURCE_URL, 'utf8');
  const body = stripTypeScriptTypes(source, { mode: 'strip' }).replace(/^import\s[\s\S]*?;[ \t]*$/gm, '');
  if (/^\s*import\s/m.test(body)) throw new Error('an import of music-direct-access was not replaced');
  class Stripe {
    constructor() {
      this.checkout = { sessions: { retrieve: async (id) => {
        const s = sessions.get(id);
        if (!s) throw Object.assign(new Error('No such checkout.session'), { type: 'StripeInvalidRequestError' });
        return s;
      } } };
    }
  }
  let handler = null;
  const logged = [];
  vm.runInNewContext(body, {
    ...shared, Stripe, createClient: () => admin, isHouseOperator,
    Deno: { env: { get: () => 'local-fixture-only' }, serve: (f) => { handler = f; } },
    Response, crypto: globalThis.crypto, console: { error: (...a) => { logged.push(a); }, log() {} }
  }, { filename: 'supabase/functions/music-direct-access/index.ts' });
  if (typeof handler !== 'function') throw new Error('music-direct-access did not register a handler');
  /** POST a JSON body to the function, as the buyer's page (or the operator desk) does. */
  const call = async (payload, { operator = false } = {}) => {
    const response = await handler(new Request('https://local.invalid/functions/v1/music-direct-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: shared.SITE, ...(operator ? { authorization: 'Bearer ' + OPERATOR_TOKEN } : {}) },
      body: JSON.stringify(payload)
    }));
    return { status: response.status, data: await response.json(), response };
  };
  return { handler, call, logged };
}

/** The paid Checkout Session Stripe returns for an order music-direct-checkout recorded. */
export function paidSession({ sessionId, orderId, offerKey, amountCents, currency = 'usd', email = 'buyer@example.invalid' }) {
  return {
    id: sessionId, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: amountCents, currency,
    metadata: { kind: shared.MUSIC_DIRECT_KIND, music_direct_order_id: orderId, music_direct_offer_key: offerKey },
    payment_intent: { id: 'pi_' + sessionId.slice(3), latest_charge: { amount_refunded: 0 } }, customer_details: { email }
  };
}
