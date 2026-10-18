/* Whip operator RBAC and atomic paid-trip acceptance contract.
   Pure synthetic Supabase fixtures. No real Stripe, drivers, or rider data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../src/whip/router.js';
import worker from '../src/whip/worker.js';

const USER = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const RIDE = '33333333-3333-4333-8333-333333333333';
const DRIVER_A = '44444444-4444-4444-8444-444444444444';
const DRIVER_B = '55555555-5555-4555-8555-555555555555';
const env = {SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',ALLOWED_ORIGIN:'https://matthew.mccluster.org'};
const json = (payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
const req = (path,method='GET',body=null)=>new Request('https://api.mccluster.org'+path,
  {method,headers:{authorization:'Bearer fixture-session','content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});
const fixture = async (role,fn)=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch = async (resource,options={})=>{
    const u=new URL(String(resource)),path=u.pathname,method=options.method||'GET';
    calls.push({path,query:u.search,method,body:options.body?JSON.parse(options.body):null});
    if(path==='/auth/v1/user')return json({id:USER,email:'operator@example.invalid'});
    if(path==='/rest/v1/operator_members')return json(role==='none'?[]:[{tenant_id:TENANT,auth_user_id:USER,role}]);
    if(path==='/rest/v1/tenants')return json([{id:TENANT,name:'Whip Fixture',slug:'whip-equipped'}]);
    if(path==='/rest/v1/rental_vehicles')return json([{id:'fixture-car',tenant_id:TENANT}]);
    if(path==='/rest/v1/sales_leads')return json([{id:'fixture-lead'}],201);
    throw Error('Unexpected fixture request: '+method+' '+u.href);
  };
  try{return await fn(calls)}finally{globalThis.fetch=original}
};

test('viewer cannot edit operator branding, vehicle prices or create private leads',{concurrency:false},async()=>{
  await fixture('viewer',async calls=>{
    const brand=await router.fetch(req('/api/operators/'+TENANT+'/brand','PATCH',{name:'Stolen brand'}),env);
    assert.equal(brand.status,403);
    const add=await router.fetch(req('/api/operators/'+TENANT+'/vehicles','POST',{name:'Fake car',daily_rate_cents:1}),env);
    assert.equal(add.status,403);
    const edit=await router.fetch(req('/api/operators/'+TENANT+'/vehicles/fixture-car','PATCH',{daily_rate_cents:1}),env);
    assert.equal(edit.status,403);
    const list=await router.fetch(req('/api/operators/'+TENANT+'/vehicles','GET'),env);
    assert.equal(list.status,200,'read-only viewer may see their own fleet list');
    const lead=await router.fetch(req('/api/sales/leads','POST',{company_name:'Private victim'}),env);
    assert.equal(lead.status,403,'a viewer is not allowed to create internal sales work');
    assert.equal(calls.filter(x=>['PATCH','POST'].includes(x.method)).length,0);
  });
  await fixture('none',async calls=>{
    const lead=await router.fetch(req('/api/sales/leads','POST',{company_name:'Unrelated third party'}),env);
    assert.equal(lead.status,403);
    assert.equal(calls.filter(x=>x.path==='/rest/v1/sales_leads').length,0);
  });
});

test('owner can update branding while identity is server-validated and tenant scoped',{concurrency:false},async()=>{
  await fixture('owner',async calls=>{
    const response=await router.fetch(req('/api/operators/'+TENANT+'/brand','PATCH',{name:'Whip Fixture II'}),env);
    assert.equal(response.status,200);
    assert.equal(calls.filter(x=>x.path==='/rest/v1/tenants'&&x.method==='PATCH').length,1);
  });
});

test('unsigned browser fare never creates a paid trip, even when operator requests it',{concurrency:false},async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(resource)=>{
      const u=new URL(String(resource));
      if(u.pathname==='/auth/v1/user')return json({id:USER});
      throw Error('Database must not be written for unsigned ride: '+u.pathname);
    };
    const response=await worker.fetch(req('/api/rides','POST',{
      tenant_slug:'whip-equipped',fare_cents:1,miles:5,dropoff_label:'Made-up destination'}),env);
    assert.equal(response.status,428);
  }finally{globalThis.fetch=original}
});

test('two different available drivers cannot both accept the same authorized ride',{concurrency:false},async()=>{
  const original=globalThis.fetch,calls=[];
  const current={id:RIDE,tenant_id:TENANT,status:'REQUESTED',payment_status:'authorized',driver_id:null};
  globalThis.fetch=async(resource,options={})=>{
    const u=new URL(String(resource)),path=u.pathname,method=options.method||'GET';
    calls.push({path,query:u.search,method});
    if(path==='/rest/v1/rides'&&method==='GET')return json([current]);
    if(path==='/rest/v1/drivers'){
      const id=u.searchParams.get('id')?.replace('eq.','');
      return json([{id,tenant_id:TENANT,online:true,display_name:'Approved synthetic driver',rating:5}]);
    }
    if(path==='/rest/v1/rides'&&method==='PATCH'){
      assert.ok(u.searchParams.get('status')==='eq.REQUESTED');
      assert.ok(u.searchParams.get('driver_id')==='is.null');
      assert.ok(u.searchParams.get('payment_status')==='in.(authorized,paid)');
      assert.ok(u.searchParams.get('tenant_id')==='eq.'+TENANT);
      if(current.status!=='REQUESTED'||current.driver_id)return json([]);
      Object.assign(current,JSON.parse(options.body));
      return json([current]);
    }
    throw Error('Unexpected fixture request: '+method+' '+u.href);
  };
  try{
    const a=await worker.fetch(req('/api/rides/'+RIDE+'/accept','POST',{driver_id:DRIVER_A}),env);
    assert.equal(a.status,200);
    const b=await worker.fetch(req('/api/rides/'+RIDE+'/accept','POST',{driver_id:DRIVER_B}),env);
    assert.equal(b.status,409);
    assert.equal(current.driver_id,DRIVER_A);
    assert.equal(calls.filter(x=>x.path==='/rest/v1/rides'&&x.method==='PATCH').length,1);
  }finally{globalThis.fetch=original}
});
