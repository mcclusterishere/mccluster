// Bounded PostgREST + Stripe stand-in. No fallback fetch is permitted.
export const alice='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',bob='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',operator='cccccccc-cccc-cccc-cccc-cccccccccccc';
export const billingEnv={SUPABASE_URL:'https://checkout-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'rk_test_fixture',CREATOR_STRIPE_WEBHOOK_SECRET:'whsec_fixture',CREATOR_STARTER_MONTHLY_PRICE_ID:'price_fixture',CREATOR_PLUS_MONTHLY_PRICE_ID:'price_plus'};
export function billingRequest(path,owner=alice,body){return new Request('https://api.mccluster.org/v1/creator-billing/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:body?JSON.stringify(body):undefined})}
export const firstBody={plan:'starter',period:'monthly',request_id:'fixture-request-0001'};
export function checkoutFixture({legacy=false}={}){
 const attempts=new Map(),reservations=new Map(),sessions=new Map(),cachedResponses=new Map(),subscriptions=[],audits=[],calls=[],providerCalls=[],events=new Set();
 let scenario='success',failBind=false,failMark=false;
 const key=(owner,request)=>owner+'|'+request;
 const result=data=>Response.json(data);
 const reserve=body=>{
  const {p_owner:owner,p_request:request,p_price:price,p_payload:payload}=body;
  if(subscriptions.some(s=>s.owner_user_id===owner&&['active','trialing','past_due','unpaid','incomplete','paused'].includes(s.status)))return {blocked:true,reason:'existing_subscription'};
  const current=reservations.get(owner),prior=attempts.get(key(owner,request));
  if(prior&&['rejected','expired'].includes(prior.state))return {blocked:true,reason:'request_retired'};
  if(current&&(current.request_id!==request||current.price_id!==price))return {blocked:true,reason:'checkout_pending'};
  if(prior){
   if(legacy){
    if(Date.parse(prior.expires_at)<=Date.now())return {blocked:true,reason:'checkout_reconciliation_required'};
    return {blocked:false,request_id:prior.request_id,expires_at:prior.expires_at};
   }
   const {expires_at,...original}=prior.provider_payload;
   if(prior.price_id!==price||payload&&JSON.stringify(payload)!==JSON.stringify(original))return {blocked:true,reason:'request_mismatch'};
   if(prior.state==='requires_owner'||!prior.checkout_session_id&&Date.parse(prior.retry_until)<=Date.now()||prior.checkout_session_id&&Date.parse(prior.expires_at)<=Date.now())return {blocked:true,reason:'checkout_reconciliation_required'};
   if(!prior.checkout_session_id)prior.dispatch_count++;
   return {blocked:false,...structuredClone(prior)};
  }
  if(!payload&&!legacy)throw new Error('New payload required');
  const created=new Date().toISOString(),expires=new Date(Date.now()+35*60000).toISOString();
  const attempt={owner_user_id:owner,request_id:request,price_id:price,provider_payload:legacy?null:{...structuredClone(payload),expires_at:Math.floor(Date.parse(expires)/1000)},idempotency_key:'creator-checkout-'+owner+'-'+request,expires_at:expires,retry_until:new Date(Date.now()+23*3600000).toISOString(),created_at:created,updated_at:created,state:'reserved',dispatch_count:1,had_uncertain:false,checkout_session_id:null};
  attempts.set(key(owner,request),attempt);reservations.set(owner,attempt);return {blocked:false,...structuredClone(attempt)};
 };
 const fetch=async(input,options={})=>{
  const url=new URL(input);calls.push({url:url.href,options});
  if(url.hostname==='checkout-fixture.invalid'){
   if(url.pathname==='/auth/v1/user')return result({id:options.headers.authorization.slice(7)});
   const route=url.pathname.replace('/rest/v1/','');
   if(route==='orgs')return result([{id:'house'}]);
   if(route==='org_members')return result(url.searchParams.get('profile_id')==='eq.'+operator?[{role:'owner'}]:[]);
   const owner=url.searchParams.get('owner_user_id')?.slice(3);
   if(route==='creator_billing_subscriptions')return result(subscriptions.filter(s=>s.owner_user_id===owner));
   if(route==='creator_checkout_reservations')return result(reservations.has(owner)?[{request_id:reservations.get(owner).request_id}]:[]);
   if(route==='creator_checkout_attempts')return result([...attempts.values()].filter(a=>(!owner||a.owner_user_id===owner)&&(!url.searchParams.has('request_id')||a.request_id===url.searchParams.get('request_id').slice(3))&&(!url.searchParams.has('state')||url.searchParams.get('state').slice(4,-1).split(',').includes(a.state))&&!['rejected','expired'].includes(a.state)).map(a=>structuredClone(a)));
   const body=JSON.parse(options.body||'{}'),attempt=attempts.get(key(body.p_owner,body.p_request));
   if(route==='rpc/reserve_creator_checkout')return result(reserve(body));
   if(route==='rpc/mark_creator_checkout_outcome'){
    if(failMark)return new Response('',{status:503});
    if(!attempt||['rejected','expired'].includes(attempt.state))return result({recorded:false,released:false});
    if(body.p_outcome==='rejected'&&attempt.dispatch_count===1&&!attempt.had_uncertain&&!attempt.checkout_session_id){attempt.state='rejected';reservations.delete(body.p_owner);return result({recorded:true,released:true,state:'rejected'})}
    if(body.p_outcome==='requires_owner'){attempt.state='requires_owner';attempt.had_uncertain=true;}else if(!attempt.checkout_session_id){attempt.state=attempt.state==='requires_owner'?'requires_owner':'uncertain';attempt.had_uncertain=true;}
    return result({recorded:true,released:false,state:attempt.state});
   }
   if(route==='rpc/bind_creator_checkout'){
    if(failBind)return new Response('',{status:503});
    if(!attempt||!reservations.has(body.p_owner)||attempt.checkout_session_id&&attempt.checkout_session_id!==body.p_session)return result(false);
    attempt.checkout_session_id=body.p_session;attempt.state='session_bound';return result(true);
   }
   if(route==='rpc/release_expired_creator_checkout'){
    const a=reservations.get(body.p_owner);if(!a||a.checkout_session_id!==body.p_session||Date.parse(a.expires_at)>Date.now())return result(false);
    a.state='expired';reservations.delete(body.p_owner);return result(true);
   }
   if(route==='rpc/audit_creator_checkout_recovery'){audits.push(body);return result(true)}
   if(route==='rpc/creator_billing_apply_stripe_event'){
    if(!events.has(body.p_event_id)){
     const sub=body.p_subscription;const row={owner_user_id:sub.owner,stripe_subscription_id:sub.id,stripe_customer_id:sub.customer,stripe_price_id:sub.price,status:sub.status,current_period_end:new Date(sub.current_period_end*1000).toISOString(),org_id:sub.status==='active'?'org_fixture':null};
     const i=subscriptions.findIndex(s=>s.stripe_subscription_id===sub.id);if(i<0)subscriptions.push(row);else subscriptions[i]=row;events.add(body.p_event_id);
    }return result(null);
   }
   throw new Error('Unexpected fixture database route '+url);
  }
  if(url.hostname==='api.stripe.com'){
   providerCalls.push({url:url.href,options});
   if(url.pathname.includes('/prices/'))return result({active:true,type:'recurring',unit_amount:1200,currency:'usd',recurring:{interval:'month'}});
   if(url.pathname.includes('/subscriptions/'))return result({id:'sub_fixture',customer:'cus_fixture',metadata:{mccluster_user_id:alice},status:'active',items:{data:[{price:{id:'price_fixture'},current_period_end:Math.floor(Date.now()/1000)+36000}]}});
   if(url.pathname.includes('/billing_portal/'))return result({url:'https://billing.stripe.com/fixture'});
   if(options.method==='GET'){
    const session=[...sessions.values()].find(s=>s.id===url.pathname.split('/').pop());return session?result(session):Response.json({error:{type:'invalid_request_error'}},{status:404});
   }
   const id=options.headers['Idempotency-Key'];
   if(cachedResponses.has(id))return result(cachedResponses.get(id));
   if(scenario==='timeout_before')throw new Error('Connection timed out before provider acceptance');
   if(scenario==='reject')return Response.json({error:{type:'invalid_request_error',code:'parameter_invalid_integer'}},{status:400,headers:{'request-id':'req_fixture'}});
   if(scenario==='unproven400')return Response.json({error:{type:'invalid_request_error'}},{status:400});
   if(scenario==='5xx')return Response.json({error:{type:'api_error'}},{status:500,headers:{'request-id':'req_fixture'}});
   const form=new URLSearchParams(options.body),metadata={};for(const [k,v]of form)if(/^metadata\[/.test(k))metadata[k.slice(9,-1)]=v;
   const session={id:'cs_fixture_'+(sessions.size+1),url:'https://checkout.stripe.com/c/fixture',mode:'subscription',livemode:false,status:'open',client_reference_id:form.get('client_reference_id'),metadata,line_items:{data:[{price:{id:form.get('line_items[0][price]')},quantity:1}]}};
   sessions.set(id,session);cachedResponses.set(id,structuredClone(session));
   if(scenario==='timeout_after')throw new Error('Connection lost after provider accepted');
   return result(session);
  }
  throw new Error('Unexpected network target '+url);
 };
 return {fetch,attempts,reservations,sessions,subscriptions,audits,providerCalls,calls,events,key,setScenario:v=>scenario=v,setFailBind:v=>failBind=v,setFailMark:v=>failMark=v};
}
