const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function handleCreatorSiteView(request,env){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/v1/creator-sites/view/'))return null;
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405});
 const slug=path.slice('/v1/creator-sites/view/'.length);
 if(!/^site-[a-f0-9]{32}$/.test(slug))return new Response('Not found',{status:404});
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return new Response('Unavailable',{status:503});
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
 const query=new URL(env.SUPABASE_URL+'/rest/v1/creator_published_sites');
 query.searchParams.set('slug','eq.'+slug);
 query.searchParams.set('select','org_id,title,tagline,bio');
 query.searchParams.set('limit','1');
 const result=await fetch(query,{headers});
 if(!result.ok)return new Response('Unavailable',{status:503});
 const site=(await result.json())?.[0];
 if(!site)return new Response('Not found',{status:404});
 const subs=new URL(env.SUPABASE_URL+'/rest/v1/creator_billing_subscriptions');
 subs.searchParams.set('org_id','eq.'+site.org_id);
 subs.searchParams.set('status','eq.active');
 subs.searchParams.set('current_period_end','gt.'+new Date().toISOString());
 subs.searchParams.set('select','org_id');
 subs.searchParams.set('limit','1');
 const access=await fetch(subs,{headers});
 if(!access.ok)return new Response('Unavailable',{status:503});
 const paid=Boolean((await access.json())?.length);
 if(!paid){
  const grants=new URL(env.SUPABASE_URL+'/rest/v1/creator_site_cohort_grants');
  grants.searchParams.set('org_id','eq.'+site.org_id);
  grants.searchParams.set('revoked_at','is.null');
  grants.searchParams.set('select','org_id');
  grants.searchParams.set('limit','1');
  const cohort=await fetch(grants,{headers});
  if(!cohort.ok)return new Response('Unavailable',{status:503});
  if(!(await cohort.json())?.length)return new Response('Site unavailable',{status:404});
 }
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
 escapeHtml(site.title)+'</title><style>body{font:18px/1.6 system-ui;background:#111;color:#fafafa;margin:auto;padding:8vw 6vw;max-width:780px}h1{font-size:clamp(2.5rem,7vw,5rem);line-height:1.1}p{white-space:pre-wrap}</style></head><body><main><h1>'+
 escapeHtml(site.title)+'</h1><h2>'+escapeHtml(site.tagline)+'</h2><p>'+escapeHtml(site.bio)+'</p></main></body></html>';
 return new Response(request.method==='HEAD'?null:html,{headers:{
  'content-type':'text/html; charset=utf-8','cache-control':'no-store',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options':'nosniff'
 }});
}
