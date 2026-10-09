import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const db=createClient('https://zmnhbrjyhxzhkxmhkexs.supabase.co','sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4',{auth:{persistSession:true,autoRefreshToken:true}});
const status=document.getElementById('accountStatus');
async function refresh(){status.textContent='Checking account…';try{const {data,error}=await db.auth.getUser();if(error)throw error;status.textContent=data.user?'Signed in as '+(data.user.email||'McCluster member')+'. Profile drafts are still stored on this device only.':'Not signed in. Sign in to your McCluster account to prepare for account-linked publishing.'}catch(_){status.textContent='Could not verify account status. Try again or open the account page.'}}
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
    if(website&&new URL(website).protocol!=='https:')throw new Error('Portfolio must use HTTPS.');
    const {error}=await db.rpc('mnet_complete_surface_profile',{
      p_app_key:'mnet',p_display_name:name,p_headline:document.getElementById('role').value,
      p_bio:bio,p_website_url:website
    });
    if(error)throw new Error(error.message);
    status.textContent='Account profile saved. Public publishing is a separate step.';
  }catch(e){status.textContent='Account save failed: '+(e.message||'Unknown error');}
  finally{save.disabled=false;}
});
