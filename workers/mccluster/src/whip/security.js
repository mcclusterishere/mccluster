import app from './gateway.js';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
function cors(env){return{'access-control-allow-origin':env.ALLOWED_ORIGIN||'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization,x-we-user-id,x-we-role','access-control-max-age':'86400'}}
function reply(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...cors(env)}})}
function fail(env,message,status=400){return reply(env,{error:message},status)}
function sbHeaders(env){return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json'}}
async function sb(env,path){const res=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{headers:sbHeaders(env)});const data=await res.json().catch(()=>null);if(!res.ok)throw Object.assign(new Error('Database authorization check failed'),{status:500});return data}
async function user(req,env){const auth=req.headers.get('authorization')||'';if(!auth.toLowerCase().startsWith('bearer '))return null;const res=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth}});return res.ok?res.json():null}
async function requireUser(req,env){const u=await user(req,env);if(!u)throw Object.assign(new Error('Authentication required'),{status:401});return u}
async function operatorAccess(env,u,tenantId){let rows=await sb(env,`operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(u.id)}&select=id`);if(!rows?.length&&u.email)rows=await sb(env,`operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&email=eq.${encodeURIComponent(u.email)}&select=id`);return Boolean(rows?.length)}
async function driverAccess(env,u,driverId){if(!driverId)return false;const rows=await sb(env,`drivers?id=eq.${encodeURIComponent(driverId)}&auth_user_id=eq.${encodeURIComponent(u.id)}&select=id`);return Boolean(rows?.length)}
async function ride(env,id){const rows=await sb(env,`rides?id=eq.${encodeURIComponent(id)}&select=*`);return rows?.[0]||null}
async function rental(env,id){const rows=await sb(env,`rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`);return rows?.[0]||null}
async function canAccessRide(env,u,r){return r.rider_id===u.id||await driverAccess(env,u,r.driver_id)||await operatorAccess(env,u,r.tenant_id)}
async function canAccessRental(env,u,b){return b.renter_id===u.id||await operatorAccess(env,u,b.tenant_id)}

export default{async fetch(req,env,ctx){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(env)});
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  try{
    const rideGet=path.match(/^\/api\/rides\/([^/]+)$/);
    if(rideGet&&req.method==='GET'){
      const u=await requireUser(req,env),r=await ride(env,rideGet[1]);if(!r)return fail(env,'Ride not found',404);if(!(await canAccessRide(env,u,r)))return fail(env,'Ride access denied',403)
    }
    const ridePay=path.match(/^\/api\/rides\/([^/]+)\/payment-intent$/);
    if(ridePay&&req.method==='POST'){
      const u=await requireUser(req,env),r=await ride(env,ridePay[1]);if(!r)return fail(env,'Ride not found',404);if(r.rider_id!==u.id)return fail(env,'Only the rider can authorize this payment',403)
    }
    const riderActive=path.match(/^\/api\/riders\/([^/]+)\/active$/);
    if(riderActive&&req.method==='GET'){
      const u=await requireUser(req,env);if(riderActive[1]!==u.id)return fail(env,'Cannot read another rider account',403)
    }

    const rentalProtected=path.match(/^\/api\/rentals\/bookings\/([^/]+)(?:\/(checkout|checkin|status|return))?$/);
    if(rentalProtected&&['GET','POST','PATCH'].includes(req.method)){
      const u=await requireUser(req,env),b=await rental(env,rentalProtected[1]);if(!b)return fail(env,'Rental booking not found',404);if(!(await canAccessRental(env,u,b)))return fail(env,'Rental access denied',403);
      if(rentalProtected[2]==='checkout'&&b.renter_id!==u.id)return fail(env,'Only the renter can start checkout',403)
    }
    const renterHistory=path.match(/^\/api\/renters\/([^/]+)\/rentals$/);
    if(renterHistory&&req.method==='GET'){
      const u=await requireUser(req,env);if(renterHistory[1]!==u.id)return fail(env,'Cannot read another renter account',403)
    }
    return app.fetch(req,env,ctx)
  }catch(error){return fail(env,error.message||'Request failed',error.status||500)}
}};
