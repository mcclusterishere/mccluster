import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const db=createClient('https://zmnhbrjyhxzhkxmhkexs.supabase.co','sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4',{auth:{persistSession:true,autoRefreshToken:true}});
const status=document.getElementById('accountStatus');
async function refresh(){status.textContent='Checking account…';try{const {data,error}=await db.auth.getUser();if(error)throw error;status.textContent=data.user?'Signed in as '+(data.user.email||'McCluster member')+'. You can save your profile to your account.':'Not signed in. Sign in to your McCluster account to save your creator profile.'}catch(_){status.textContent='Could not verify account status. Try again or open the account page.'}}
document.getElementById('refreshAccount').addEventListener('click',refresh);
db.auth.onAuthStateChange(()=>{refresh()});refresh();

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
