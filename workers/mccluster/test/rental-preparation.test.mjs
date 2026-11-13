import test from 'node:test';
import assert from 'node:assert/strict';
import {createRentalPreparation} from '../src/whip/rental-preparation.js';
const tenant='22222222-2222-4222-8222-222222222222',user='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const req=(path,method='GET',body,auth=true)=>new Request('https://api.mccluster.org'+path,{method,headers:{...(auth?{authorization:'Bearer fixture'}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
const draft={name:'Synthetic vehicle',category:'sedan',location_label:'General town',daily_rate_cents:5000};
async function fixture(options,fn){
 const old=globalThis.fetch,calls=[];let row={id:'car',tenant_id:tenant,...draft,available:false,updated_at:options.revision||'2026-11-01T00:00:00Z'};
 globalThis.fetch=async(resource,init={})=>{
  const u=new URL(resource),method=init.method||'GET';calls.push({u,method,body:init.body&&JSON.parse(init.body)});
  if(u.pathname==='/auth/v1/user')return json({id:user});
  if(u.pathname.endsWith('/operator_members')){assert.equal(u.searchParams.get('auth_user_id'),'eq.'+user);return json(options.role==='none'?[]:[{role:options.role||'owner'}]);}
  if(options.fail)return json({message:'secret database detail'},500);
  if(u.pathname.endsWith('/tenants'))return json([{name:'Synthetic operator'}]);
  if(u.pathname.endsWith('/rental_bookings'))return json([]);
  if(u.pathname.endsWith('/rental_vehicles')){
   if(method==='POST'){row={...JSON.parse(init.body)};return json([row]);}
   if(method==='PATCH'){
    assert.equal(u.searchParams.get('tenant_id'),'eq.'+tenant);
    if(u.searchParams.get('updated_at')!=='eq.'+row.updated_at)return json([]);
    row={...row,...JSON.parse(init.body)};return json([row]);
   }
   return json(options.many?Array.from({length:51},(_,i)=>({...row,id:'car'+i})):[row]);
  }
  throw Error('Unexpected upstream '+u);
 };
 const next={fetch:async()=>json({next:true})},app=createRentalPreparation(next);
 try{await fn(app,calls)}finally{globalThis.fetch=old;}
}
test('public inventory and all rental writes stay closed, regardless of live flags',async()=>fixture({},async(app,calls)=>{
 for(const [path,method] of [['/api/rentals/bookings','POST'],['/api/rentals/bookings/x/checkout','POST'],['/api/rentals/bookings/x/checkin','PATCH'],['/api/rentals/bookings/x/status','PATCH'],['/api/rentals/bookings/x/return','PATCH']]){
  const r=await app.fetch(req(path,method,{status:'ACTIVE'}),{...env,WHIP_RENTALS_LIVE:'true',WHIP_LAUNCH_APPROVED:'true'});assert.equal(r.status,503);
 }
 const data=await(await app.fetch(req('/api/rentals/vehicles'),env)).json();assert.deepEqual(data.vehicles,[]);assert.equal(data.bookings_live,false);assert.equal(calls.length,0);
}));
test('unauthenticated and lower-privilege users cannot read private summary or mutate fleet',async()=>{
 for(const role of ['viewer','dispatcher','finance','none']) await fixture({role},async(app,calls)=>{
  for(const [path,method,body] of [['/rentals','GET'],['/vehicles','POST',draft],['/vehicles/car','PATCH',draft]]){
   const r=await app.fetch(req('/api/operators/'+tenant+path,method,body),env);assert.equal(r.status,403);
  }
  assert.equal(calls.filter(c=>c.method!=='GET'||c.u.pathname.endsWith('/rental_vehicles')).length,0);
 });
 await fixture({},async(app,calls)=>{assert.equal((await app.fetch(req('/api/operators/'+tenant+'/rentals','GET',undefined,false),env)).status,401);assert.equal(calls.length,0);});
});
test('stored summary is tenant-scoped, bounded, private and does not claim clearance',async()=>fixture({many:true},async(app,calls)=>{
 const r=await app.fetch(req('/api/operators/'+tenant+'/rentals'),env),body=await r.json();
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store, private');assert.equal(body.source,'stored_records');assert.equal(body.vehicles.length,50);assert.equal(body.next_offset,50);assert.equal(body.evidence_status,'unverified');
 for(const c of calls.filter(c=>/rental_/.test(c.u.pathname))){assert.equal(c.u.searchParams.get('tenant_id'),'eq.'+tenant);assert.ok(!c.u.searchParams.get('select').includes('*'));assert.ok(!c.u.searchParams.get('select').includes('renter_id'));}
}));
test('create writes only unpublished preparation fields and readback uses stored data',async()=>fixture({},async(app,calls)=>{
 const r=await app.fetch(req('/api/operators/'+tenant+'/vehicles','POST',draft),env),b=await r.json();assert.equal(r.status,201);assert.equal(b.vehicle.available,false);
 const write=calls.find(c=>c.method==='POST');assert.equal(write.body.tenant_id,tenant);assert.equal(write.body.rating,null);assert.equal(write.body.seats,null);
 const read=await(await app.fetch(req('/api/operators/'+tenant+'/rentals'),env)).json();assert.equal(read.vehicles[0].id,b.vehicle.id);
}));
test('edit uses compare-and-swap and rejects a stale second update',async()=>fixture({},async(app,calls)=>{
 const body={...draft,expected_updated_at:'2026-11-01T00:00:00Z'};
 assert.equal((await app.fetch(req('/api/operators/'+tenant+'/vehicles/car','PATCH',body),env)).status,200);
 assert.equal((await app.fetch(req('/api/operators/'+tenant+'/vehicles/car','PATCH',body),env)).status,409);
 assert.equal(calls.filter(c=>c.method==='PATCH').length,2);
}));
test('no self approval, reassignment, publication, private documents or invalid rates',async()=>fixture({},async(app,calls)=>{
 for(const body of [{...draft,available:true},{...draft,owner_id:user},{...draft,tenant_id:'other'},{...draft,title_document:'private'},{...draft,daily_rate_cents:1.5},{...draft,daily_rate_cents:-1},{...draft,name:'x'.repeat(101)},null])assert.equal((await app.fetch(req('/api/operators/'+tenant+'/vehicles','POST',body),env)).status,400);
 assert.equal(calls.filter(c=>c.method!=='GET').length,0);
}));
test('backend failure cannot look like an empty fleet or leak database errors',async()=>fixture({fail:true},async(app)=>{
 const r=await app.fetch(req('/api/operators/'+tenant+'/rentals'),env);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret database/);
}));
test('pass-through preserves cab demo/backend and rental read ownership chain',async()=>fixture({},async(app)=>{
 for(const path of ['/api/rides','/api/rentals/bookings/x','/api/operators/mine'])assert.deepEqual(await(await app.fetch(req(path),env)).json(),{next:true});
}));

test('revision advances when stored revision is ahead of worker clock',async()=>fixture({revision:'2099-01-01T00:00:00.000Z'},async(app)=>{
 const body={...draft,expected_updated_at:'2099-01-01T00:00:00.000Z'};
 const result=await app.fetch(req('/api/operators/'+tenant+'/vehicles/car','PATCH',body),env);
 assert.equal(result.status,200);
 assert.equal((await result.json()).vehicle.updated_at,'2099-01-01T00:00:00.001Z');
 assert.equal((await app.fetch(req('/api/operators/'+tenant+'/vehicles/car','PATCH',body),env)).status,409);
}));
