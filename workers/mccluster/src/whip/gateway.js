import app from './router.js';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
const DRIVER_TRANSITIONS=new Set(['DRIVER_EN_ROUTE','DRIVER_ARRIVED','VERIFIED','IN_PROGRESS','COMPLETED']);
function cors(env){return{'access-control-allow-origin':env.ALLOWED_ORIGIN||'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization,x-we-user-id,x-we-role','access-control-max-age':'86400'}}
function reply(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...cors(env)}})}
function fail(env,message,status=400){return reply(env,{error:message},status)}
function sbHeaders(env,extra={}){return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',...extra}}
async function sb(env,path,init={}){const res=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{...init,headers:sbHeaders(env,init.headers||{})});const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!res.ok)throw Object.assign(new Error(typeof data==='string'?data:JSON.stringify(data)),{status:res.status});return data}
async function user(req,env){const auth=req.headers.get('authorization')||'';if(!auth.toLowerCase().startsWith('bearer '))return null;const res=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth}});return res.ok?res.json():null}
async function requireUser(req,env){const u=await user(req,env);if(!u)throw Object.assign(new Error('Authentication required'),{status:401});return u}
async function driverForUser(req,env){const u=await requireUser(req,env);const rows=await sb(env,`drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=*`);return{user:u,driver:rows?.[0]||null}}
async function requireDriver(req,env){const x=await driverForUser(req,env);if(!x.driver)throw Object.assign(new Error('Driver profile required'),{status:409});return x}
async function ride(env,id){const rows=await sb(env,`rides?id=eq.${encodeURIComponent(id)}&select=*`);return rows?.[0]||null}
async function tenant(env,slug){const rows=await sb(env,`tenants?slug=eq.${encodeURIComponent(slug)}&select=*`);return rows?.[0]||null}

export default{async fetch(req,env,ctx){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(env)});
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  try{
    if(path==='/api/drivers/me'&&req.method==='GET'){
      const x=await driverForUser(req,env);return reply(env,{driver:x.driver,user:{id:x.user.id,email:x.user.email}})
    }
    if(path==='/api/drivers/me'&&req.method==='POST'){
      const u=await requireUser(req,env);const existing=await sb(env,`drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=*`);if(existing?.length)return reply(env,{driver:existing[0]});
      const body=await req.json(),t=await tenant(env,body.tenant_slug||'whip-equipped');if(!t)return fail(env,'Tenant not found',404);if(!body.display_name||!body.license_plate)return fail(env,'display_name and license_plate are required');
      const rows=await sb(env,'drivers?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({tenant_id:t.id,auth_user_id:u.id,display_name:String(body.display_name).trim(),phone:body.phone||null,rating:5,vehicle_make:body.vehicle_make||null,vehicle_model:body.vehicle_model||null,vehicle_color:body.vehicle_color||null,license_plate:String(body.license_plate).trim().toUpperCase(),seats:Number(body.seats||4),online:false})});return reply(env,{driver:rows[0]},201)
    }
    if(path==='/api/offers'&&req.method==='GET'){
      const {driver}=await requireDriver(req,env);if(!driver.online)return reply(env,{offers:[]});
      const rows=await sb(env,`rides?tenant_id=eq.${encodeURIComponent(driver.tenant_id)}&status=eq.REQUESTED&payment_status=in.(authorized,paid)&order=requested_at.asc&limit=20&select=*`);return reply(env,{offers:rows||[]})
    }
    const presence=path.match(/^\/api\/drivers\/([^/]+)\/presence$/);
    if(presence&&req.method==='PATCH'){
      const {driver}=await requireDriver(req,env);if(driver.id!==presence[1])return fail(env,'Cannot modify another driver',403);return app.fetch(req,env,ctx)
    }
    const active=path.match(/^\/api\/drivers\/([^/]+)\/active$/);
    if(active&&req.method==='GET'){
      const {driver}=await requireDriver(req,env);if(driver.id!==active[1])return fail(env,'Cannot view another driver',403);return app.fetch(req,env,ctx)
    }
    const accept=path.match(/^\/api\/rides\/([^/]+)\/accept$/);
    if(accept&&req.method==='POST'){
      const {driver}=await requireDriver(req,env),r=await ride(env,accept[1]);if(!r)return fail(env,'Ride not found',404);if(r.tenant_id!==driver.tenant_id)return fail(env,'Ride belongs to another operator',403);if(r.status!=='REQUESTED')return fail(env,'Ride is no longer available',409);if(!['authorized','paid'].includes(r.payment_status))return fail(env,'Ride payment is not authorized',402);
      const headers=new Headers(req.headers);headers.set('content-type','application/json');const forwarded=new Request(req.url,{method:'POST',headers,body:JSON.stringify({driver_id:driver.id})});return app.fetch(forwarded,env,ctx)
    }
    const rideStatus=path.match(/^\/api\/rides\/([^/]+)\/status$/);
    if(rideStatus&&req.method==='PATCH'){
      const copy=req.clone(),body=await copy.json(),next=String(body.status||'').toUpperCase(),r=await ride(env,rideStatus[1]);if(!r)return fail(env,'Ride not found',404);const u=await requireUser(req,env);
      if(DRIVER_TRANSITIONS.has(next)){
        const rows=await sb(env,`drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=*`),d=rows?.[0];if(!d||r.driver_id!==d.id)return fail(env,'This ride is not assigned to your driver account',403);
        const headers=new Headers(req.headers);headers.set('content-type','application/json');const forwarded=new Request(req.url,{method:'PATCH',headers,body:JSON.stringify({...body,driver_id:d.id})});return app.fetch(forwarded,env,ctx)
      }
      if(next==='CANCELED'){
        if(r.rider_id!==u.id){const rows=await sb(env,`drivers?auth_user_id=eq.${encodeURIComponent(u.id)}&select=id`);if(!rows?.[0]||rows[0].id!==r.driver_id)return fail(env,'You cannot cancel this ride',403)}
        return app.fetch(req,env,ctx)
      }
      return fail(env,'Unsupported ride transition',400)
    }
    return app.fetch(req,env,ctx)
  }catch(error){return fail(env,error.message||'Request failed',error.status||500)}
}};
