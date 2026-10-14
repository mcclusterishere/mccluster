// Cached public GDELT feed. Upstream requests are restricted to scheduled/internal sync.
const base=Deno.env.get("SUPABASE_URL")!, key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const topics={world:"(global OR international OR world)",climate:"(climate OR flood OR wildfire)",policy:"(legislation OR parliament OR congress)",health:"(public health OR healthcare)",technology:"(technology OR artificial intelligence)"};
const headers={"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"apikey,authorization,content-type","Cache-Control":"public,max-age=120"};
async function rpc(name:string,body:Record<string,unknown>,privileged=true){const token=privileged?key:Deno.env.get("SUPABASE_ANON_KEY")!;const r=await fetch(base+"/rest/v1/rpc/"+name,{method:"POST",headers:{"Content-Type":"application/json",apikey:token,Authorization:"Bearer "+token},body:JSON.stringify(body)});if(!r.ok)throw Error(name+"_"+r.status+":"+(await r.text()).slice(0,200));return r.json()}
async function cached(topic:string){return await rpc("media_public_cached_news",{p_topic:topic,p_limit:40})}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="GET")return response({error:"method_not_allowed"},405);
 const url=new URL(req.url),topic=url.searchParams.get("topic")||"world";
 if(!Object.hasOwn(topics,topic))return response({error:"invalid_topic"},400);
 // Only a server-side secret can start upstream ingestion; ordinary visitors always use cached DB records.
 const sync=url.searchParams.get("sync")==="1";
 if(!sync){try{const articles=await cached(topic);return response({provider:"GDELT DOC 2.0",topic,articles,cached:true,geolocation:"headline-country references are not event coordinates"})}catch(e){return response({error:"cache_unavailable",detail:String(e).slice(0,140),articles:[]},503)}}
 const bearer=req.headers.get("Authorization")||"";
 if(!key||bearer!=="Bearer "+key)return response({error:"unauthorized"},401);
 let claimed=false;
 try{claimed=await rpc("media_gdelt_claim",{p_topic:topic});if(!claimed)return response({skipped:"cooldown",topic})}catch(e){return response({error:"claim_failed",detail:String(e).slice(0,140)},503)}
 try{
  const gdelt=new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  gdelt.searchParams.set("query",topics[topic as keyof typeof topics]);gdelt.searchParams.set("mode","artlist");gdelt.searchParams.set("format","json");gdelt.searchParams.set("maxrecords","40");gdelt.searchParams.set("timespan","24h");gdelt.searchParams.set("sort","datedesc");
  const upstream=await fetch(gdelt,{headers:{Accept:"application/json","User-Agent":"EquityUpriseNews/1.0"},signal:AbortSignal.timeout(15000)});
  if(!upstream.ok){const retry=upstream.headers.get("retry-after");let seconds:number|null=null;if(retry){const n=Number(retry);seconds=Number.isFinite(n)?n:Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000));if(!Number.isFinite(seconds))seconds=null}await rpc("media_gdelt_finish",{p_topic:topic,p_success:false,p_error:"upstream_"+upstream.status,p_retry_seconds:seconds});return response({error:"upstream_unavailable",status:upstream.status,cached:true,articles:await cached(topic)},200)}
  const raw=await upstream.json(),seen=new Set<string>();
  const articles=(Array.isArray(raw.articles)?raw.articles:[]).flatMap((a:Record<string,unknown>)=>{const href=String(a.url||"");let u:URL;try{u=new URL(href)}catch{return []}if(!["https:","http:"].includes(u.protocol))return [];const canonical=u.origin+u.pathname;if(seen.has(canonical))return [];seen.add(canonical);const dt=String(a.seendate||"");const published=/^\d{14}$/.test(dt)?dt.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,"$1-$2-$3T$4:$5:$6Z"):null;return [{title:String(a.title||"Untitled").slice(0,250),url:href,domain:String(a.domain||u.hostname).slice(0,150),language:String(a.language||"").slice(0,40),published_at:published}]});
  if(articles.length)await rpc("media_ingest_gdelt_batch",{p_topic:topic,p_articles:articles});
  await rpc("media_gdelt_finish",{p_topic:topic,p_success:true});
  return response({topic,received:articles.length,stored:true,articles:await cached(topic)});
 }catch(e){await rpc("media_gdelt_finish",{p_topic:topic,p_success:false,p_error:String(e).slice(0,200)}).catch(()=>{});return response({error:"upstream_unavailable",topic,cached:true,articles:await cached(topic).catch(()=>[])})}
});