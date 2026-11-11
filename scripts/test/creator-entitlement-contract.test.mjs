import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasActiveSitePlan} from '../../workers/mccluster/src/creator-entitlement.js';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const alice='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',bob='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
test('plan ownership and expiration fail closed for two non-admin tenants',async()=>{
 const fetchImpl=async url=>{const owner=new URL(url).searchParams.get('owner_user_id');return Response.json(owner==='eq.'+alice?[{org_id:'owned',status:'active',current_period_end:'2099-01-01'}]:[])};
 assert.equal(await hasActiveSitePlan(alice,env,fetchImpl),true);
 assert.equal(await hasActiveSitePlan(bob,env,fetchImpl),false);
 for(const row of [{status:'past_due',current_period_end:'2099-01-01'},{status:'active',current_period_end:'2000-01-01'}])assert.equal(await hasActiveSitePlan(alice,env,async()=>Response.json([{org_id:'owned',...row}])),false);
 assert.equal(await hasActiveSitePlan(alice,env,async()=>{throw Error('offline')}),false);
 assert.equal(await hasActiveSitePlan('invalid',env,fetchImpl),false);
});
