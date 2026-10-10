import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const db=createClient('https://zmnhbrjyhxzhkxmhkexs.supabase.co','sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4',{auth:{persistSession:true,autoRefreshToken:true}});
const status=document.getElementById('accountStatus');
async function importLegacySession(){
 const {data:{session}}=await db.auth.getSession();
 if(session)return;
 for(const key of ['mccdb_session','mcc_sess_keep']){
  let legacy;
  try{legacy=JSON.parse(localStorage.getItem(key)||'null')}catch(_){continue}
  if(!legacy?.access_token||!legacy?.refresh_token)continue;
  const {error}=await db.auth.setSession({access_token:legacy.access_token,refresh_token:legacy.refresh_token});
  if(!error)break;
 }
}

async function refresh(){status.textContent='Checking account…';try{const {data,error}=await db.auth.getUser();if(error)throw error;status.textContent=data.user?'Signed in as '+(data.user.email||'McCluster member')+'. You can save your profile to your account.':'Not signed in. Sign in to your McCluster account to save your creator profile.'}catch(_){status.textContent='Could not verify account status. Try again or open the account page.'}}
document.getElementById('refreshAccount').addEventListener('click',refresh);
db.auth.onAuthStateChange(()=>{setTimeout(refresh,0)});
importLegacySession().catch(()=>{}).finally(refresh);

// Persist through the existing owner-checked Action Network RPC; never write directly to network_profiles.
const save=document.getElementById('saveAccount');
if(save)save.addEventListener('click',async()=>{
  save.disabled=true;
  try{
    const {data:{user},error:authError}=await db.auth.getUser();
    if(authError||!user)throw new Error('Sign in before saving to your account.');
    const name=document.getElementById('name').value.trim();
    const bio=document.getElementById('bio').value.trim();
    const website=document.getElementById('portfolio').value.trim();
    if(!name||name.length>120)throw new Error('Creator name must be 1–120 characters.');
    if(bio.length>2000)throw new Error('Bio is too long.');
    if(website){let url;try{url=new URL(website)}catch(_){throw new Error('Portfolio must be a valid HTTPS URL.')}if(url.protocol!=='https:')throw new Error('Portfolio must use HTTPS.');}
    const {error}=await db.rpc('mnet_complete_surface_profile',{
      p_app_key:'mnet-web',p_display_name:name,p_headline:document.getElementById('role').value,
      p_bio:bio,p_website_url:website
    });
    if(error)throw new Error(error.message);
    status.textContent='Account profile saved. Public publishing is a separate step.';
  }catch(e){status.textContent='Account save failed: '+(e.message||'Unknown error');}
  finally{save.disabled=false;}
});

const load=document.getElementById('loadAccount');
if(load)load.addEventListener('click',async()=>{
 load.disabled=true;
 try{
  const {data:{user},error:authError}=await db.auth.getUser();
  if(authError||!user)throw new Error('Sign in to load your profile.');
  const {data:id,error:idError}=await db.rpc('current_m_uid');
  if(idError||!id)throw new Error('Your McCluster member identity is not ready.');
  const {data:p,error}=await db.from('network_profiles').select('display_name,headline,bio,website_url,visibility').eq('m_uid',id).maybeSingle();
  if(error)throw new Error(error.message);
  if(!p)throw new Error('No readable profile exists for this account yet.');
  document.getElementById('name').value=p.display_name||'';
  document.getElementById('bio').value=p.bio||'';
  document.getElementById('portfolio').value=p.website_url||'';
  if(['private','network','public'].includes(p.visibility))document.getElementById('visibility').value=p.visibility;
  const role=document.getElementById('role');
  if([...role.options].some(o=>o.value===p.headline))role.value=p.headline;
  ['name','bio','portfolio','role'].forEach(id=>document.getElementById(id).dispatchEvent(new Event('input')));
  showLink(id,p.visibility);
  status.textContent='Account profile loaded. Unsaved local edits were replaced.';
 }catch(e){status.textContent='Account load failed: '+(e.message||'Unknown error');}
 finally{load.disabled=false;}
});

const publish=document.getElementById('publishProfile');
publish.addEventListener('click',async()=>{
 publish.disabled=true;
 try{
  const auth=await db.auth.getUser();
  if(auth.error||!auth.data.user)throw Error('Sign in first.');
  const identity=await db.rpc('current_m_uid');
  if(identity.error||!identity.data)throw Error('Member identity unavailable.');
  const visibility=document.getElementById('visibility').value;
  if(!['private','network','public'].includes(visibility))throw Error('Invalid visibility.');
  const result=await db.from('network_profiles').update({visibility,discoverable:visibility==='public'}).eq('m_uid',identity.data).select('visibility').single();
  if(result.error)throw result.error;
  showLink(identity.data,result.data.visibility);
  status.textContent='Profile visibility updated: '+result.data.visibility+'. Save profile text separately.';
 }catch(error){status.textContent='Visibility update failed: '+error.message;}
 finally{publish.disabled=false;}
});

function showLink(id,visibility){const area=document.getElementById('publicProfileLink');area.replaceChildren();if(visibility!=='public') {area.textContent='Your profile is not public.';return;}const a=document.createElement('a');a.href='mccluster-creator.html?id='+encodeURIComponent(id);a.textContent='View public creator profile';area.append(a)}


const websiteStatus=document.getElementById('websiteStatus');
const websiteSelect=document.getElementById('websiteWorkspace');
const websitePublish=document.getElementById('publishWebsite');
const apiOrigin='https://api.mccluster.org';
async function creatorApi(path,method='GET',body){
 const {data:{session},error}=await db.auth.getSession();
 if(error||!session?.access_token)throw new Error('Sign in before managing a paid website.');
 const response=await fetch(apiOrigin+path,{
  method,headers:{authorization:'Bearer '+session.access_token,...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Website service unavailable ('+response.status+').');
 return data;
}
async function checkWebsiteAccess(){
 websiteStatus.textContent='Checking subscription and workspace access…';
 websitePublish.disabled=true;
 websiteSelect.replaceChildren();
 const option=document.createElement('option');option.value='';option.textContent='Choose a workspace';websiteSelect.append(option);
 try{
  const data=await creatorApi('/v1/creator-billing/entitlement');
  for(const workspace of data.workspaces||[]){
   if(!workspace.org_id)continue;
   const item=document.createElement('option');
   item.value=workspace.org_id;
   item.textContent='Creator workspace '+workspace.org_id.slice(0,8);
   websiteSelect.append(item);
  }
  websiteStatus.textContent=data.paid?'Active paid access verified. Select your workspace.':'No active paid creator subscription. Your free profile remains available.';
 }catch(error){websiteStatus.textContent='Access check failed: '+error.message;}
}
document.getElementById('checkWebsiteAccess')?.addEventListener('click',checkWebsiteAccess);
websiteSelect?.addEventListener('change',()=>{websitePublish.disabled=!websiteSelect.value;});
websitePublish?.addEventListener('click',async()=>{
 websitePublish.disabled=true;
 websiteStatus.textContent='Checking payment and publishing…';
 try{
  const org_id=websiteSelect.value;
  if(!org_id)throw new Error('Select your workspace.');
  const title=document.getElementById('name').value.trim();
  const tagline=document.getElementById('role').value.trim();
  const bio=document.getElementById('bio').value.trim();
  if(!title||title.length>120||tagline.length>300||bio.length>4000)throw new Error('Check your website title and biography.');
  const data=await creatorApi('/v1/creator-sites/publish','POST',{org_id,title,tagline,bio});
  const url=new URL(data.url);
  if(url.origin!==apiOrigin||!url.pathname.startsWith('/v1/creator-sites/view/'))throw new Error('Unexpected published URL.');
  const link=document.getElementById('websiteLink');link.replaceChildren();
  const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open published website';link.append(a);
  websiteStatus.textContent='Website published successfully.';
 }catch(error){websiteStatus.textContent='Website publishing failed: '+error.message;}
 finally{websitePublish.disabled=!websiteSelect.value;}
});


// Free service offers are tied to the signed-in member identity, not paid creator workspaces.
const serviceStatus=document.getElementById('serviceStatus');
const serviceLaunchStatus=document.getElementById('serviceLaunchStatus');
async function refreshServiceReadiness(){
 try{
  const {data:{user}}=await db.auth.getUser();
  if(!user){serviceLaunchStatus.textContent='Sign in to set up your first service.';return}
  const identity=await db.rpc('current_m_uid');
  if(identity.error||!identity.data)throw Error('Member identity unavailable');
  const result=await db.from('creator_service_offers').select('title,description,price_cents,action_url,status').eq('m_uid',identity.data).eq('status','published').order('created_at',{ascending:true}).limit(1);
  if(result.error)throw result.error;
  const offer=result.data?.[0];
  serviceLaunchStatus.textContent=offer?'Service-ready: '+offer.title+'. Your free profile can link clients to this offer.':'Not service-ready yet. Publish at least one actionable service.';
  if(offer){document.getElementById('serviceTitle').value=offer.title;document.getElementById('serviceDescription').value=offer.description||'';document.getElementById('servicePrice').value=(offer.price_cents/100).toFixed(2);document.getElementById('serviceUrl').value=offer.action_url;}
 }catch(e){serviceLaunchStatus.textContent='Service readiness unavailable: '+(e.message||'Unknown error')}
}
document.getElementById('saveService')?.addEventListener('click',async()=>{
 const button=document.getElementById('saveService');button.disabled=true;
 try{
  const {data:{user},error}=await db.auth.getUser();
  if(error||!user)throw Error('Sign in first');
  const identity=await db.rpc('current_m_uid');
  if(identity.error||!identity.data)throw Error('Member identity unavailable');
  const title=document.getElementById('serviceTitle').value.trim();
  const description=document.getElementById('serviceDescription').value.trim();
  const price=Number(document.getElementById('servicePrice').value);
  const actionUrl=document.getElementById('serviceUrl').value.trim();
  const url=new URL(actionUrl);
  if(url.protocol!=='https:'||url.username||url.password||!url.hostname||actionUrl.length>2000)throw Error('Provide a valid HTTPS booking URL');
  if(title.length<3||title.length>120||description.length>1200||!Number.isFinite(price)||price<0||price>1000000||Math.abs(Math.round(price*100)-price*100)>0.000001)throw Error('Check the service title, description and price');
  const offer={m_uid:identity.data,title,description,price_cents:Math.round(price*100),action_url:url.href,status:'published'};
  const existing=await db.from('creator_service_offers').select('id').eq('m_uid',identity.data).order('created_at',{ascending:true}).limit(1);
  if(existing.error)throw existing.error;
  const saved=existing.data?.[0]?await db.from('creator_service_offers').update(offer).eq('id',existing.data[0].id):await db.from('creator_service_offers').insert(offer);
  if(saved.error)throw saved.error;
  serviceStatus.textContent='Service published to your free creator profile.';
  await refreshServiceReadiness();
 }catch(e){serviceStatus.textContent='Could not publish service: '+(e.message||'Unknown error')}
 finally{button.disabled=false}
});
refreshServiceReadiness();
