import {test} from 'node:test';import assert from 'node:assert/strict';
import {handleCreatorStore} from '../../workers/mccluster/src/creator-store.js';
const alice='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',bob='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',product='cccccccc-cccc-cccc-cccc-cccccccccccc',order='dddddddd-dddd-dddd-dddd-dddddddddddd';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'sk_test_fixture',CREATOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',CREATOR_STORE_ENABLED:'true'};
const request=(path,owner,body)=>new Request('https://api.mccluster.org/v1/creator-store/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('seller order and product mutations enforce tenant authority; public checkout uses immutable server price',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(input,options={})=>{const url=new URL(input);calls.push({url,options});if(url.pathname==='/auth/v1/user')return Response.json({id:options.headers.authorization.slice(7)});if(url.pathname.endsWith('/orgs'))return Response.json([{id:alice,slug:'alice'}]);if(url.pathname.endsWith('/org_members'))return Response.json(url.searchParams.get('profile_id')==='eq.'+alice?[{role:'owner'}]:[]);if(url.pathname.endsWith('/reserve_creator_store_order'))return Response.json({id:order,product_id:product,org_id:alice,title:'Commission',kind:'service',amount_cents:1500,currency:'usd',stripe_account_id:'acct_alice',status:'pending'});if(url.pathname.endsWith('/accounts/acct_alice'))return Response.json({charges_enabled:true,payouts_enabled:true,details_submitted:true});if(url.pathname.endsWith('/checkout/sessions'))return Response.json({id:'cs_fixture',url:'https://checkout.stripe.com/fixture'});return Response.json([])};
 try{for(const path of ['products','fulfill'])assert.equal((await handleCreatorStore(request(path,bob,{org:'alice',order_id:order,note:'Sent'}),env)).status,403);
 assert.equal(calls.some(c=>c.options.method==='PATCH'||c.url.hostname==='api.stripe.com'),false);
 assert.equal((await handleCreatorStore(request('fulfill',alice,{org:'alice',order_id:order,note:'Sent with tracking'}),env)).status,409);
 const patch=calls.find(c=>c.options.method==='PATCH');assert.equal(patch.url.searchParams.get('org_id'),'eq.'+alice);assert.equal(patch.url.searchParams.get('status'),'eq.paid');
 assert.equal((await handleCreatorStore(request('checkout',null,{product_id:product,request_id:order,access_token:alice,amount_cents:1}),env)).status,200);
 const checkout=calls.find(c=>c.url.pathname.endsWith('/checkout/sessions'));assert.match(checkout.options.body,/unit_amount%5D=1500/);assert.equal(checkout.options.headers['Stripe-Account'],'acct_alice');assert.equal(checkout.options.headers['Idempotency-Key'],'creator-store-'+order);
 }finally{globalThis.fetch=original}
});
