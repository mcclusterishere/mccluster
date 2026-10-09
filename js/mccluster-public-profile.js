import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const db=createClient('https://zmnhbrjyhxzhkxmhkexs.supabase.co','sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4');
const id=new URLSearchParams(location.search).get('id');
const state=document.getElementById('state');
async function load(){
 if(!id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){state.textContent='Invalid creator profile link.';return}
 const {data,error}=await db.from('network_profiles').select('display_name,headline,bio,website_url,visibility').eq('m_uid',id).eq('visibility','public').maybeSingle();
 if(error||!data){state.textContent='This creator profile is unavailable or not public.';return}
 document.getElementById('name').textContent=data.display_name||'Creator';
 document.getElementById('role').textContent=data.headline||'';
 document.getElementById('bio').textContent=data.bio||'';
 const link=document.getElementById('portfolio');
 try{const url=new URL(data.website_url);if(url.protocol==='https:'){link.href=url.href;link.hidden=false}}catch(_){}
 document.getElementById('profile').hidden=false;state.hidden=true;
}
load();
