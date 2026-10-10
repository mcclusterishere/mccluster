import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('Stripe webhook verifies signature and retrieves provider subscription',async()=>{
 const src=await read('workers/mccluster/src/creator-billing-webhook.js');
 assert.match(src,/verifyStripeWebhook\(await request\.text\(\)/);
 assert.match(src,/stripeRequest\(env,'subscriptions\//);
 assert.match(src,/allowedPriceIds\(env\)\.has\(price\)/);
 assert.match(src,/creator_billing_apply_stripe_event/);
 assert.doesNotMatch(src,/request\.json\(/);
});
test('billing event ledger is private and provision requires active subscription',async()=>{
 const sql=await read('supabase/migrations/pending/20261009170000_creator_billing_subscriptions.sql');
 assert.match(sql,/enable row level security/g);
 assert.match(sql,/current_user <> 'service_role'/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/v_status='active'/);
 assert.match(sql,/on conflict\(stripe_event_id\)|where stripe_event_id=p_event_id/);
 assert.match(sql,/grant execute on function public\.creator_billing_apply_stripe_event/);
});
test('webhook is routed ahead of generic rate limiting',async()=>{
 const src=await read('workers/mccluster/src/entry-platform.js');
 assert.ok(src.indexOf('handleCreatorBillingWebhook(request, env)')<src.indexOf('enforceApiRateLimit(request, env)'));
});
