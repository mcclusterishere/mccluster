import {reply,fail} from './lib/http.js';

// Fail-closed boundary for the unlisted At Night adult monetization area.
// Never trust client age flags, invitation codes, or uploaded ID images.
const ROUTES=new Set(['status','enter','host','viewer','purchase','gift','withdraw','transfer']);
export async function handleAtNight(request,env){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/v1/at-night/'))return null;
 const operation=path.slice('/v1/at-night/'.length);
 if(!ROUTES.has(operation))return fail(request,env,'Not found',404);
 if(request.method!==(operation==='status'?'GET':'POST'))return fail(request,env,'Method not allowed',405);
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(request,env,'Verification unavailable',503);
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))return fail(request,env,'Authentication required',401);
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer}});
 if(!auth.ok)return fail(request,env,'Invalid session',401);
 const user=await auth.json();
 if(!/^[0-9a-f-]{36}$/i.test(user?.id||''))return fail(request,env,'Invalid session',401);
 // Verification must be a trusted provider callback persisted server-side.
 // User metadata, birthday input, ID uploads, and client assertions are never sufficient.
 const query=new URL(env.SUPABASE_URL+'/rest/v1/at_night_verifications');
 query.searchParams.set('user_id','eq.'+user.id);
 query.searchParams.set('select','status,adult_verified,expires_at,revoked_at,host_approved');
 query.searchParams.set('limit','1');
 const result=await fetch(query,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
 if(!result.ok)return fail(request,env,'Verification unavailable',503);
 const rows=await result.json();
 const record=Array.isArray(rows)?rows[0]:null;
 const verified=record?.status==='verified'&&record.adult_verified===true&&!record.revoked_at&&
  typeof record.expires_at==='string'&&Date.parse(record.expires_at)>Date.now();
 if(!verified)return fail(request,env,'Government ID adult verification required',403,{code:'ADULT_VERIFICATION_REQUIRED'});
 if(operation==='status'){
  const response=reply(request,env,{eligible:true,host_approved:record.host_approved===true});
  response.headers.set('cache-control','no-store');return response;
 }
 if(operation==='host'&&record.host_approved!==true)return fail(request,env,'Host approval required',403);
 // The financial economy is intentionally OFF until legal and provider sign-off.
 if(['purchase','gift','withdraw','transfer'].includes(operation))
  return fail(request,env,'Real-money economy is not enabled',503,{code:'ECONOMY_DISABLED'});
 return fail(request,env,'At Night experience is not yet enabled',503,{code:'EXPERIENCE_DISABLED'});
}
