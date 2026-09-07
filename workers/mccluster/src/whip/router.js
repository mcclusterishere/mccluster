import core from './worker.js';
import { fourDigitPin } from '../lib/http.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
function cors(env){return{'access-control-allow-origin':env.ALLOWED_ORIGIN||'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization,x-we-user-id,x-we-role','access-control-max-age':'86400'}}
function reply(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...cors(env)}})}
function fail(env,message,status=400,detail){return reply(env,{error:message,detail},status)}
function sbHeaders(env,extra={}){return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',...extra}}
async function sb(env,path,init={}){const res=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{...init,headers:sbHeaders(env,init.headers||{})});const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!res.ok)throw Object.assign(new Error(typeof data==='string'?data:JSON.stringify(data)),{status:res.status});return data}
async function supabaseAuth(env,path,body,authorization){
  const headers={'content-type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY};
  if(authorization)headers.authorization=authorization;
  const res=await fetch(`${env.SUPABASE_URL}/auth/v1/${path}`,{method:'POST',headers,body:JSON.stringify(body||{})});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw Object.assign(new Error(data.msg||data.message||data.error_description||data.error||'Authentication failed'),{status:res.status});return data;
}
async function userFromRequest(req,env){
  const auth=req.headers.get('authorization')||'';if(!auth.toLowerCase().startsWith('bearer '))return null;
  const res=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth}});if(!res.ok)return null;return res.json();
}
async function requireUser(req,env){const user=await userFromRequest(req,env);if(!user)throw Object.assign(new Error('Authentication required'),{status:401});if(!(user.email_confirmed_at||user.phone_confirmed_at||user.confirmed_at))throw Object.assign(new Error('Confirmed account required'),{status:403});return user}
async function requireOperator(req,env,tenantId){
  const user=await requireUser(req,env);
  const rows=await sb(env,`operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(user.id)}&select=*`);
  if(!rows?.length)throw Object.assign(new Error('Operator access required'),{status:403});return {user,membership:rows[0]};
}
function cleanSlug(value){return String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)}
function vehicleId(tenantId,name){return `${tenantId.slice(0,8)}-${cleanSlug(name)}-${crypto.randomUUID().slice(0,8)}`}

export default {async fetch(req,env,ctx){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(env)});
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  try{
    // Account creation is invite/admin controlled. Never let a public request mint
    // an Auth user or choose user_metadata through the service-role-backed proxy.
    if(path==='/api/auth/signup'&&req.method==='POST')return fail(env,'Account creation is invite-only',403)
    if(path==='/api/auth/login'&&req.method==='POST'){
      const body=await req.json();const data=await supabaseAuth(env,'token?grant_type=password',{email:String(body.email||'').trim().toLowerCase(),password:body.password});return reply(env,data)
    }
    if(path==='/api/auth/refresh'&&req.method==='POST'){
      const body=await req.json();const data=await supabaseAuth(env,'token?grant_type=refresh_token',{refresh_token:body.refresh_token});return reply(env,data)
    }
    if(path==='/api/auth/logout'&&req.method==='POST'){
      await supabaseAuth(env,'logout',{},req.headers.get('authorization'));return reply(env,{ok:true})
    }
    if(path==='/api/auth/me'&&req.method==='GET'){
      const user=await requireUser(req,env);return reply(env,{user})
    }

    // Discover tenants only through the authenticated UUID. Email is contact data,
    // never an authorization key.
    if(path==='/api/operators/mine'&&req.method==='GET'){
      const user=await requireUser(req,env);
      const memberships=await sb(env,`operator_members?auth_user_id=eq.${encodeURIComponent(user.id)}&select=tenant_id,role,email`);
      const ids=[...new Set((memberships||[]).map(x=>x.tenant_id))];
      const tenants=[];for(const id of ids){const rows=await sb(env,`tenants?id=eq.${encodeURIComponent(id)}&select=*`);if(rows?.[0])tenants.push({...rows[0],role:memberships.find(m=>m.tenant_id===id)?.role||'viewer'})}
      return reply(env,{tenants})
    }

    const brandMatch=path.match(/^\/api\/operators\/([^/]+)\/brand$/);
    if(brandMatch&&req.method==='PATCH'){
      const tenantId=brandMatch[1];await requireOperator(req,env,tenantId);const body=await req.json();const patch={updated_at:new Date().toISOString()};
      if(body.name)patch.name=String(body.name).trim().slice(0,80);if(body.logo_url!==undefined)patch.logo_url=body.logo_url||null;if(/^#[0-9a-f]{6}$/i.test(body.primary_color||''))patch.primary_color=body.primary_color;if(/^#[0-9a-f]{6}$/i.test(body.secondary_color||''))patch.secondary_color=body.secondary_color;if(body.tagline)patch.tagline=String(body.tagline).trim().slice(0,100);
      const rows=await sb(env,`tenants?id=eq.${encodeURIComponent(tenantId)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});return reply(env,{tenant:rows?.[0]||null})
    }

    const vehiclesMatch=path.match(/^\/api\/operators\/([^/]+)\/vehicles$/);
    if(vehiclesMatch&&req.method==='GET'){
      const tenantId=vehiclesMatch[1];await requireOperator(req,env,tenantId);const rows=await sb(env,`rental_vehicles?tenant_id=eq.${encodeURIComponent(tenantId)}&order=created_at.desc&select=*`);return reply(env,{vehicles:rows||[]})
    }
    if(vehiclesMatch&&req.method==='POST'){
      const tenantId=vehiclesMatch[1];await requireOperator(req,env,tenantId);const body=await req.json();if(!body.name||!body.daily_rate_cents)return fail(env,'Vehicle name and daily_rate_cents are required');
      const tenantRows=await sb(env,`tenants?id=eq.${encodeURIComponent(tenantId)}&select=name`);if(!tenantRows?.length)return fail(env,'Tenant not found',404);
      const row={id:vehicleId(tenantId,body.name),tenant_id:tenantId,name:String(body.name).trim(),category:body.category||'economy',operator_name:tenantRows[0].name,location_label:body.location_label||'Operator location',daily_rate_cents:Math.max(1,Math.round(Number(body.daily_rate_cents))),rating:5,rental_count:0,seats:Math.max(1,Number(body.seats||5)),transmission:body.transmission||'Automatic',fuel_type:body.fuel_type||'Gas',color_hex:/^#[0-9a-f]{6}$/i.test(body.color_hex||'')?body.color_hex:'#222222',mileage_per_day:Math.max(1,Number(body.mileage_per_day||200)),available:body.available!==false};
      const rows=await sb(env,'rental_vehicles?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});return reply(env,{vehicle:rows[0]},201)
    }
    const vehicleMatch=path.match(/^\/api\/operators\/([^/]+)\/vehicles\/([^/]+)$/);
    if(vehicleMatch&&req.method==='PATCH'){
      const [_,tenantId,id]=vehicleMatch;await requireOperator(req,env,tenantId);const body=await req.json();const allowed=['name','category','location_label','daily_rate_cents','seats','transmission','fuel_type','color_hex','mileage_per_day','available'];const patch={updated_at:new Date().toISOString()};for(const key of allowed)if(key in body)patch[key]=body[key];
      const rows=await sb(env,`rental_vehicles?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});if(!rows?.length)return fail(env,'Vehicle not found',404);return reply(env,{vehicle:rows[0]})
    }

    // Create rides here rather than in the legacy core so the security boundary
    // owns rider identity and the pickup PIN is generated with Web Crypto.
    if(path==='/api/rides'&&req.method==='POST'){
      const user=await requireUser(req,env),body=await req.json();
      const tenants=await sb(env,`tenants?slug=eq.${encodeURIComponent(body.tenant_slug||'whip-equipped')}&select=*`),t=tenants?.[0];if(!t)return fail(env,'Tenant not found',404);
      const fare=Math.max(0,Number(body.fare_cents||0));if(!body.dropoff_label||!fare)return fail(env,'dropoff_label and fare_cents are required');
      const platformFee=t.white_label_enabled?0:Math.round(fare*Number(t.platform_fee_percent||0.03));
      const ride={tenant_id:t.id,rider_id:user.id,rider_name:body.rider_name||user.user_metadata?.full_name||'Rider',status:'REQUESTED',pickup_label:body.pickup_label||'Current location',pickup_lat:body.pickup_lat??null,pickup_lng:body.pickup_lng??null,dropoff_label:body.dropoff_label,dropoff_lat:body.dropoff_lat??null,dropoff_lng:body.dropoff_lng??null,miles:body.miles??null,minutes:body.minutes??null,ride_tier:body.ride_tier||'WE Standard',fare_cents:fare,platform_fee_cents:platformFee,pickup_pin:fourDigitPin(),payment_status:'unpaid'};
      const rows=await sb(env,'rides?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(ride)});return reply(env,{ride:rows[0]},201)
    }

    // Add a lead from an authenticated operator/admin workflow without exposing the table directly.
    if(path==='/api/sales/leads'&&req.method==='POST'){
      await requireUser(req,env);const body=await req.json();if(!body.company_name)return fail(env,'company_name is required');const rows=await sb(env,'sales_leads?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({company_name:body.company_name,market:body.market||null,website:body.website||null,email:body.email||null,phone:body.phone||null,fleet_note:body.fleet_note||null,app_gap_note:body.app_gap_note||null,source_url:body.source_url||null,status:body.status||'prospect'})});return reply(env,{lead:rows[0]},201)
    }

    // Any presented session must be confirmed before the older core can act on it.
    if((req.headers.get('authorization')||'').toLowerCase().startsWith('bearer '))await requireUser(req,env);

    // Core handles Stripe Connect, payments, dispatch, rental lifecycle and partner referrals.
    const response=await core.fetch(req,env,ctx);
    const headers=new Headers(response.headers);Object.entries(cors(env)).forEach(([k,v])=>headers.set(k,v));
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }catch(error){return fail(env,error.message||'Request failed',error.status||500)}
}};
