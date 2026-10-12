import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Level 3 refunds are owner-gated and use Stripe remaining refundable balance',async()=>{
 const s=await readFile('supabase/functions/l3-refund/index.ts','utf8');
 assert.match(s,/role=eq\.owner/);
 assert.match(s,/paymentIntents\.retrieve/);
 assert.match(s,/charge\.amount_refunded/);
 assert.match(s,/amount > remaining/);
 assert.match(s,/Number\.isSafeInteger\(amount\)/);
 assert.match(s,/refund_request_id_required/);
 assert.match(s,/idempotencyKey/);
 assert.match(s,/stripe\.charges\.retrieve/);
 assert.match(s,/fully_refunded: complete/);
 assert.match(s,/if \(complete\).*l3_entitlements/s);
 assert.doesNotMatch(s,/Math\.min\(Number\(b\.amount_cents\),o\.amount_cents\)/);
});
test('refund errors do not disclose raw Stripe or database errors',async()=>{
 const s=await readFile('supabase/functions/l3-refund/index.ts','utf8');
 assert.match(s,/refund_operation_failed/);
 assert.doesNotMatch(s,/return json\(\{ error: error\.message/);
});
