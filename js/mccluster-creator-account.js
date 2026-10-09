import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const db=createClient('https://zmnhbrjyhxzhkxmhkexs.supabase.co','sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4',{auth:{persistSession:true,autoRefreshToken:true}});
const status=document.getElementById('accountStatus');
async function refresh(){status.textContent='Checking account…';try{const {data,error}=await db.auth.getUser();if(error)throw error;status.textContent=data.user?'Signed in as '+(data.user.email||'McCluster member')+'. Profile drafts are still stored on this device only.':'Not signed in. Sign in to your McCluster account to prepare for account-linked publishing.'}catch(_){status.textContent='Could not verify account status. Try again or open the account page.'}}
document.getElementById('refreshAccount').addEventListener('click',refresh);
db.auth.onAuthStateChange(()=>{refresh()});refresh();
