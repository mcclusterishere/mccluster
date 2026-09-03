import app from './security.js';
import { createIdentitySession, retrieveIdentitySession } from './identity.js';
import { verifyStripeWebhook } from './stripe.js';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8'};
function cors(env){return{'access-control-allow-origin':env.ALLOWED_ORIGIN||'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization,x-we-user-id,x-we-role','access-control-max-age':'86400'}}
function reply(env,data,status=200){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...cors(env)}})}
function fail(env,message,status=400){return reply(env,{error:message},status)}
function sbHeaders(env,extra={}){return{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json',...extra}}
async function sb(env,path,init={}){const res=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{...init,headers:sbHeaders(env,init.headers||{})});const text=await res.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!res.ok)throw Object.assign(new Error('Identity persistence failed'),{status:500});return data}
async function user(req,env){const auth=req.headers.get('authorization')||'';if(!auth.toLowerCase().startsWith('bearer '))return null;const res=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth}});return res.ok?res.json():null}
async function requireUser(req,env){const u=await user(req,env);if(!u)throw Object.assign(new Error('Authentication required'),{status:401});return u}
async function latest(env,userId,purpose){const rows=await sb(env,`identity_verifications?user_id=eq.${encodeURIComponent(userId)}&purpose=eq.${encodeURIComponent(purpose)}&order=created_at.desc&limit=1&select=*`);return rows?.[0]||null}
async function verified(env,userId,purpose){const record=await latest(env,userId,purpose);return Boolean(record?.status==='verified')}
async function rental(env,id){const rows=await sb(env,`rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`);return rows?.[0]||null}
async function driver(env,id){const rows=await sb(env,`drivers?id=eq.${encodeURIComponent(id)}&select=*`);return rows?.[0]||null}
async function persistEvent(env,object,status){
  const userId=object.metadata?.we_user_id,purpose=object.metadata?.purpose||'renter';if(!userId)return;
  const patch={status,updated_at:new Date().toISOString(),last_error_code:object.last_error?.code||null};if(status==='verified')patch.verified_at=new Date().toISOString();
  const rows=await sb(env,`identity_verifications?stripe_verification_session_id=eq.${encodeURIComponent(object.id)}&select=*`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
  if(!rows?.length)await sb(env,'identity_verifications',{method:'POST',body:JSON.stringify({user_id:userId,purpose,stripe_verification_session_id:object.id,...patch})});
  if(purpose==='driver')await sb(env,`drivers?auth_user_id=eq.${encodeURIComponent(userId)}`,{method:'PATCH',body:JSON.stringify({identity_verified:status==='verified',identity_verification_session_id:object.id})})
}

export default{async fetch(req,env,ctx){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(env)});
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  try{
    if(path==='/api/stripe/webhook'&&req.method==='POST'){
      const clone=req.clone(),raw=await clone.text(),event=await verifyStripeWebhook(raw,req.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET);
      if(event.type==='identity.verification_session.verified'){await persistEvent(env,event.data.object,'verified');return reply(env,{received:true,identity:true})}
      if(event.type==='identity.verification_session.requires_input'||event.type==='identity.verification_session.canceled'){await persistEvent(env,event.data.object,event.data.object.status||'requires_input');return reply(env,{received:true,identity:true})}
      return app.fetch(req,env,ctx)
    }

    if(path==='/api/identity/session'&&req.method==='POST'){
      const u=await requireUser(req,env),body=await req.json(),purpose=['renter','driver'].includes(body.purpose)?body.purpose:'renter';const prior=await latest(env,u.id,purpose);
      if(prior?.status==='verified')return reply(env,{verification:prior,already_verified:true});
      const session=await createIdentitySession(env,{userId:u.id,email:u.email,purpose});
      await sb(env,'identity_verifications',{method:'POST',body:JSON.stringify({user_id:u.id,purpose,stripe_verification_session_id:session.id,status:session.status||'requires_input'})});
      return reply(env,{id:session.id,client_secret:session.client_secret,status:session.status,purpose})
    }

    if(path==='/api/identity/status'&&req.method==='GET'){
      const u=await requireUser(req,env),purpose=['renter','driver'].includes(url.searchParams.get('purpose'))?url.searchParams.get('purpose'):'renter';let record=await latest(env,u.id,purpose);if(!record)return reply(env,{verification:null,verified:false});
      if(record.status!=='verified'){
        const stripe=await retrieveIdentitySession(env,record.stripe_verification_session_id);if(stripe.status!==record.status){await persistEvent(env,{...stripe,metadata:{...(stripe.metadata||{}),we_user_id:u.id,purpose}},stripe.status);record=await latest(env,u.id,purpose)}
      }
      return reply(env,{verification:record,verified:record?.status==='verified'})
    }

    // A renter cannot self-assert license verification. The server substitutes the Stripe Identity truth.
    const rentalCheckin=path.match(/^\/api\/rentals\/bookings\/([^/]+)\/checkin$/);
    if(rentalCheckin&&req.method==='PATCH'){
      const u=await requireUser(req,env),booking=await rental(env,rentalCheckin[1]);if(!booking)return fail(env,'Rental booking not found',404);if(booking.renter_id!==u.id)return fail(env,'Only the renter can complete identity check-in',403);
      const body=await req.clone().json();
      if(body.license_verified===true){
        if(!(await verified(env,u.id,'renter')))return fail(env,'Complete Stripe Identity driver-license verification first',409);
        body.license_verified=true;
        body.identity_verified=true;
      }
      const headers=new Headers(req.headers);headers.set('content-type','application/json');
      return app.fetch(new Request(req.url,{method:'PATCH',headers,body:JSON.stringify(body)}),env,ctx)
    }

    const rentalStatus=path.match(/^\/api\/rentals\/bookings\/([^/]+)\/status$/);
    if(rentalStatus&&req.method==='PATCH'){
      const u=await requireUser(req,env),body=await req.clone().json();
      if(String(body.status||'').toUpperCase()==='ACTIVE'&&!(await verified(env,u.id,'renter')))return fail(env,'Verified renter identity is required before vehicle pickup',409)
    }

    // Drivers cannot advertise availability or consume paid dispatch unless verified.
    const driverPresence=path.match(/^\/api\/drivers\/([^/]+)\/presence$/);
    if(driverPresence&&req.method==='PATCH'){
      const u=await requireUser(req,env),d=await driver(env,driverPresence[1]);if(!d||d.auth_user_id!==u.id)return fail(env,'Driver access denied',403);const body=await req.clone().json();if(body.online===true&&!(await verified(env,u.id,'driver')))return fail(env,'Complete driver identity verification before going online',409)
    }
    if(path==='/api/offers'&&req.method==='GET'){
      const u=await requireUser(req,env);if(!(await verified(env,u.id,'driver')))return fail(env,'Complete driver identity verification before receiving offers',409)
    }

    return app.fetch(req,env,ctx)
  }catch(error){return fail(env,error.message||'Request failed',error.status||500)}
}};
