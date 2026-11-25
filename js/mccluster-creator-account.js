import {createClient} from '../vendor/supabase-js-2.57.0.mjs';
/* ONE SESSION, THE SITE'S (music slice M4, 2026-11-19; accounts lane ACC-6). This studio used to run a second
   supabase-js session with its own copy of the refresh token, seeded once from the site's. A member signed in on the
   site was asked to sign in here three times; after a switch of accounts the studio still read and saved as the
   previous one; after a sign-out it still loaded that account's profile; and when it renewed its copy it spent the
   shared refresh token, so the site's next renewal was refused and the member was signed out of every page. Now
   supabase-js keeps no session at all: every call carries the token the shared auth (js/mcc-auth.js, the site's one
   session) holds for that call, renewed there when it is near its end and asked again once after a 401; nothing here
   refreshes or rotates anything; and the page follows the account signed in on the site, in this tab or another.
   Each thing the page does is done as one account, the one signed in when it began: its calls are refused, never
   sent, once the site is signed in as someone else or nobody, and what it read is not painted for the next account. */
const SB='https://zmnhbrjyhxzhkxmhkexs.supabase.co',KEY='sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4';
const clients=new Map();
function dbAs(account){
 const key=account||'';
 if(!clients.has(key))clients.set(key,createClient(SB,KEY,{
  accessToken:()=>window.MCC?window.MCC.freshToken():Promise.resolve(null),
  global:{fetch:(url,init)=>window.MCC?window.MCC.authFetch(url,init,account?{account}:undefined):fetch(url,init)}
 }));
 return clients.get(key);
}
function who(){try{return window.MCC?window.MCC.account():null}catch(_){return null}}
const status=document.getElementById('accountStatus');
const signInLink=document.getElementById('accountSignIn');
function stored(){try{const s=window.MCC&&window.MCC.session();return s&&s.access_token?s:null}catch(_){return null}}
/* the account as the auth server knows it now, or null: signed out, or a session it no longer accepts. A lookup
   that loses its renewal to another tab finds a new token stored and asks once more with it. */
async function siteUser(){
 for(let tries=0;tries<2;tries++){
  const before=stored();
  if(!before)return null;
  let user=null;try{user=await window.MCC.user()}catch(_){}
  if(user)return user;
  const after=stored();
  if(!after||after.access_token===before.access_token)return null;
 }
 return null;
}
async function refresh(){
 status.textContent='Checking account…';
 if(!window.MCC){status.textContent='Could not verify account status. Try again or open the account page.';return null}
 const user=await siteUser();
 if(user){status.textContent='Signed in as '+(user.email||'McCluster member')+'. You can save your profile to your account.';if(signInLink)signInLink.hidden=true;return user}
 if(stored()){status.textContent='Could not verify account status. Try again or open the account page.';if(signInLink)signInLink.hidden=true;return null}
 status.textContent='Not signed in. Sign in to your McCluster account to save your creator profile.';if(signInLink)signInLink.hidden=false;
 return null;
}
document.getElementById('refreshAccount').addEventListener('click',refresh);

// Persist through the existing owner-checked Equity Uprise RPC; never write directly to network_profiles.
const save=document.getElementById('saveAccount');
if(save)save.addEventListener('click',async()=>{
  save.disabled=true;
  try{
    const user=await siteUser();
    if(!user)throw new Error('Sign in before saving to your account.');
    const db=dbAs(who());
    const name=document.getElementById('name').value.trim();
    const bio=document.getElementById('bio').value.trim();
    const website=document.getElementById('portfolio').value.trim();
    if(!name||name.length>120)throw new Error('Creator name must be 1–120 characters.');
    if(bio.length>2000)throw new Error('Bio is too long.');
    if(website){let url;try{url=new URL(website)}catch(_){throw new Error('Portfolio must be a valid HTTPS URL.')}if(url.protocol!=='https:')throw new Error('Portfolio must use HTTPS.');}
    /* A SAVE CHANGES WHAT THIS EDITOR SHOWS (owner, 2026-10-20). The RPC writes every column it is given and ''
       for the rest, so this save used to wipe the member's picture and banner, and it wrote the creator role over
       their headline. The picture, the banner and the headline they already have ride along unchanged; the role
       stays this editor's (it titles the paid website, below). */
    const {data:me,error:meError}=await db.rpc('current_m_uid');
    if(meError||!me)throw new Error('Your McCluster member identity is not ready.');
    const {data:kept,error:keptError}=await db.from('network_profiles').select('headline,avatar_url,banner_url').eq('m_uid',me).maybeSingle();
    if(keptError)throw new Error(keptError.message);
    const {error}=await db.rpc('mnet_complete_surface_profile',{
      p_app_key:'mnet-web',p_display_name:name,p_headline:kept?.headline||'',
      p_bio:bio,p_avatar_url:kept?.avatar_url||'',p_banner_url:kept?.banner_url||'',p_website_url:website
    });
    if(error)throw new Error(error.message);
    status.textContent='Account profile saved. Public publishing is a separate step.';
  }catch(e){status.textContent='Account save failed: '+(e.message||'Unknown error');}
  finally{save.disabled=false;}
});

const load=document.getElementById('loadAccount');
/* NEVER RETYPE WHAT THE PROFILE HAS (owner, 2026-10-20): a signed-in member with no draft on this device opens the
   editor already filled from their profile; a draft they saved here is theirs and is not replaced. The account the
   editor was filled from is remembered, so a sign-out or another account never leaves that profile on screen to be
   saved as somebody else's. */
let filledFrom=null;
async function fillFromProfile(){
 let draft=null;try{draft=localStorage.getItem('mccluster.creatorStudio.draft.v1')}catch(_){}
 if(draft||!load)return;
 await loadIntoEditor(true);
}
function clearEditor(){
 const set=(id,v)=>{const el=document.getElementById(id);if(!el)return;if(el.tagName==='SELECT')el.selectedIndex=0;else el.value=v;el.dispatchEvent(new Event('input'))};
 set('name','Your creator name');set('role','');set('bio','');set('portfolio','');set('social','');set('accent','');set('visibility','');
 const area=document.getElementById('publicProfileLink');if(area)area.replaceChildren();
}
/* auto: the editor filled for a signed-in member on opening (above). The account line then keeps naming the account,
   and a profile that cannot be read leaves it as it was: only a tap on Load reports what went wrong. */
async function loadIntoEditor(auto){
 load.disabled=true;
 try{
  const user=await siteUser();
  if(!user){if(auto)return;throw new Error('Sign in to load your profile.')}
  const as=who(),db=dbAs(as);
  const {data:id,error:idError}=await db.rpc('current_m_uid');
  if(idError||!id)throw new Error('Your McCluster member identity is not ready.');
  const {data:p,error}=await db.from('network_profiles').select('display_name,headline,bio,website_url,visibility').eq('m_uid',id).maybeSingle();
  if(error)throw new Error(error.message);
  if(!p)throw new Error('No readable profile exists for this account yet.');
  if(who()!==as)return;
  document.getElementById('name').value=p.display_name||'';
  document.getElementById('bio').value=p.bio||'';
  document.getElementById('portfolio').value=p.website_url||'';
  if(['private','network','public'].includes(p.visibility))document.getElementById('visibility').value=p.visibility;
  const role=document.getElementById('role');
  if([...role.options].some(o=>o.value===p.headline))role.value=p.headline;
  ['name','bio','portfolio','role'].forEach(id=>document.getElementById(id).dispatchEvent(new Event('input')));
  showLink(id,p.visibility);
  filledFrom=as;
  status.textContent=auto?'Signed in as '+(user.email||'McCluster member')+'. Your saved profile is in the editor.':'Account profile loaded. Unsaved local edits were replaced.';
 }catch(e){if(!auto)status.textContent='Account load failed: '+(e.message||'Unknown error');}
 finally{load.disabled=false;}
}
if(load)load.addEventListener('click',()=>loadIntoEditor(false));

const publish=document.getElementById('publishProfile');
publish.addEventListener('click',async()=>{
 publish.disabled=true;
 try{
  if(!await siteUser())throw Error('Sign in first.');
  const db=dbAs(who());
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
/* the workspaces listed belong to the account that asked; publishing to one is asked as that account only */
let websiteFrom=null;
async function creatorApi(path,method='GET',body,account){
 if(!stored())throw new Error('Sign in before managing a paid website.');
 const response=await window.MCC.authFetch(apiOrigin+path,{
  method,headers:body?{'content-type':'application/json'}:{},
  ...(body?{body:JSON.stringify(body)}:{})
 },account?{account}:undefined);
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'Website service unavailable ('+response.status+').');
 return data;
}
function resetWebsite(){
 websiteFrom=null;
 websiteSelect.replaceChildren();
 const option=document.createElement('option');option.value='';option.textContent='Check access to load workspaces';websiteSelect.append(option);
 websitePublish.disabled=true;
 websiteStatus.textContent='No paid workspace selected.';
 document.getElementById('websiteLink').replaceChildren();
}
async function checkWebsiteAccess(){
 websiteStatus.textContent='Checking subscription and workspace access…';
 websitePublish.disabled=true;
 websiteSelect.replaceChildren();
 const option=document.createElement('option');option.value='';option.textContent='Choose a workspace';websiteSelect.append(option);
 const as=who();
 try{
  const data=await creatorApi('/v1/creator-billing/entitlement','GET',undefined,as);
  if(who()!==as)return;
  websiteFrom=as;
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
  if(!org_id||!websiteFrom)throw new Error('Select your workspace.');
  const title=document.getElementById('name').value.trim();
  const tagline=document.getElementById('role').value.trim();
  const bio=document.getElementById('bio').value.trim();
  if(!title||title.length>120||tagline.length>300||bio.length>4000)throw new Error('Check your website title and biography.');
  const data=await creatorApi('/v1/creator-sites/publish','POST',{org_id,title,tagline,bio},websiteFrom);
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
/* the service form, once filled from an account's offer, leaves the screen with that account */
let serviceFrom=null;
function clearService(){
 serviceFrom=null;
 ['serviceTitle','serviceDescription','serviceUrl'].forEach((id)=>{const el=document.getElementById(id);if(el)el.value='';});
 const price=document.getElementById('servicePrice');if(price)price.value='0';
 serviceStatus.textContent='';serviceLaunchStatus.textContent='';
}
async function refreshServiceReadiness(){
 try{
  const user=await siteUser();
  if(!user){serviceLaunchStatus.textContent='Sign in to set up your first service.';serviceStatus.textContent='Sign in to publish a service.';return}
  if(/^Sign in/.test(serviceStatus.textContent))serviceStatus.textContent='';
  const as=who(),db=dbAs(as);
  const identity=await db.rpc('current_m_uid');
  if(identity.error||!identity.data)throw Error('Member identity unavailable');
  const result=await db.from('creator_service_offers').select('title,description,price_cents,action_url,status').eq('m_uid',identity.data).eq('status','published').order('created_at',{ascending:true}).limit(1);
  if(result.error)throw result.error;
  if(who()!==as)return;
  const offer=result.data?.[0];
  serviceLaunchStatus.textContent=offer?'Service-ready: '+offer.title+'. Your free profile can link clients to this offer.':'Not service-ready yet. Publish at least one actionable service.';
  if(offer){serviceFrom=as;document.getElementById('serviceTitle').value=offer.title;document.getElementById('serviceDescription').value=offer.description||'';document.getElementById('servicePrice').value=(offer.price_cents/100).toFixed(2);document.getElementById('serviceUrl').value=offer.action_url;}
 }catch(e){serviceLaunchStatus.textContent='Service readiness unavailable: '+(e.message||'Unknown error')}
}
document.getElementById('saveService')?.addEventListener('click',async()=>{
 const button=document.getElementById('saveService');button.disabled=true;
 try{
  if(!await siteUser())throw Error('Sign in first');
  const db=dbAs(who());
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

/* Who is looking decides everything above, and it is asked once the page knows: first the account line, then the
   service line and the editor. A sign-in or sign-out on the site, here or in another tab, asks again; what was filled
   from an account (the editor, the service form, the workspaces) leaves the screen with it. */
function lookAgain(){
 return refresh().then(()=>{refreshServiceReadiness();return fillFromProfile()}).catch(()=>{});
}
lookAgain();
if(window.MCC&&window.MCC.onAccountChange)window.MCC.onAccountChange(()=>{
 const now=who();
 if(filledFrom&&filledFrom!==now){filledFrom=null;clearEditor();}
 if(serviceFrom&&serviceFrom!==now)clearService();
 if(websiteFrom!==now)resetWebsite();
 lookAgain();
});
