// Server-only ingestion helper. Requires LEGISCAN_API_KEY and SUPABASE_SERVICE_ROLE_KEY.
// Run from an authorized server environment; never bundle with browser assets.
const BASE='https://api.legiscan.com/';
const STATE=/^[A-Z]{2}$/;
export async function syncLegiscanSearch({state='CT',query='small business',limit=25,env=Deno.env}={}){
 if(!STATE.test(state))throw Error('Invalid state');
 const key=env.get('LEGISCAN_API_KEY'),service=env.get('SUPABASE_SERVICE_ROLE_KEY'),url=env.get('SUPABASE_URL');
 if(!key||!service||!url)throw Error('Missing server-only API credentials');
 const u=new URL(BASE);u.searchParams.set('key',key);u.searchParams.set('op','getSearch');u.searchParams.set('state',state);u.searchParams.set('query',query);u.searchParams.set('page','1');
 const response=await fetch(u);if(!response.ok)throw Error('LegiScan HTTP '+response.status);
 const payload=await response.json();if(payload.status!=='OK')throw Error('LegiScan API rejected search');
 const rows=Object.entries(payload.searchresult||{}).filter(([k,v])=>k!=='summary'&&v&&typeof v==='object').slice(0,limit);
 let updated=0;
 for(const [,b] of rows){if(!b.bill_id||!b.bill_number||!b.title)continue;
 const record={source:'legiscan',external_id:String(b.bill_id),jurisdiction:state,region_key:null,bill_number:String(b.bill_number),title:String(b.title),summary:b.description||null,status:'unknown',source_url:b.url||null,official_url:null,topic:'business_entrepreneurship',synced_at:new Date().toISOString()};
 const res=await fetch(url+'/rest/v1/action_policy_bills?on_conflict=source,external_id',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify(record)});if(!res.ok)throw Error('Supabase upsert failed '+res.status);updated++;
 }
 return {state,query,updated,search_matches:rows.length,warning:'Search results are candidate matches; reconcile official bill details and state jurisdiction mapping before publication.'};
}
