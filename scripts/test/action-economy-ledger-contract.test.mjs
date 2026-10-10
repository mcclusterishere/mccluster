import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/pending/20261009223000_action_economy_risk_ledger.sql',import.meta.url),'utf8');
test('posting requires service role and locks idempotency key',()=>{
 assert.match(sql,/current_setting\('request\.jwt\.claim\.role',true\) is distinct from 'service_role'/);
 assert.match(sql,/pg_advisory_xact_lock/);
});
test('same key with different payload fails rather than silently succeeding',()=>{
 assert.match(sql,/request_hash/);
 assert.match(sql,/Idempotency key payload mismatch/);
});
test('account locks are deterministic and duplicate lines rejected',()=>{
 assert.match(sql,/order by a\.id for update of a/);
 assert.match(sql,/Duplicate ledger account/);
});
test('each currency balances and platform accounts cannot duplicate',()=>{
 assert.match(sql,/v_sum_a<>0 or v_sum_usd<>0/);
 assert.match(sql,/action_economy_platform_account_unique/);
 assert.match(sql,/action_economy_account_currency/);
});
test('no user-facing ledger grants',()=>{
 assert.match(sql,/revoke all on function public\.action_economy_post/);
 assert.match(sql,/grant execute on function public\.action_economy_post.*to service_role/);
});
