// Public, read-only GDELT DOC 2.0 gateway. No user tokens or service-role secrets.
const allow = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type","Cache-Control":"public, max-age=180"};
const topics = {world:"(global OR international OR world)",climate:"(climate OR flood OR wildfire)",policy:"(legislation OR parliament OR congress)",health:"(public health OR healthcare)",technology:"(technology OR artificial intelligence)"};
Deno.serve(async (req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:allow});
 if(req.method!=="GET")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:{...allow,"Content-Type":"application/json"}});
 const url=new URL(req.url),topic=url.searchParams.get("topic")||"world";
 if(!Object.prototype.hasOwnProperty.call(topics,topic))return new Response(JSON.stringify({error:"invalid_topic"}),{status:400,headers:{...allow,"Content-Type":"application/json"}});
 const gdelt=new URL("https://api.gdeltproject.org/api/v2/doc/doc");
 gdelt.searchParams.set("query",topics[topic as keyof typeof topics]);
 gdelt.searchParams.set("mode","artlist");gdelt.searchParams.set("format","json");gdelt.searchParams.set("maxrecords","40");gdelt.searchParams.set("timespan","24h");gdelt.searchParams.set("sort","datedesc");
 try{
 const upstream=await fetch(gdelt.toString(),{headers:{"Accept":"application/json","User-Agent":"EquityUpriseNews/1.0"} ,signal:AbortSignal.timeout(12000)});
 if(!upstream.ok)throw Error("upstream_"+upstream.status);
 const raw=await upstream.json(),seen=new Set<string>();
 const articles=(Array.isArray(raw.articles)?raw.articles:[]).flatMap((a:Record<string,unknown>)=>{
 const href=String(a.url||"");let parsed:URL;try{parsed=new URL(href)}catch{return []}
 if(parsed.protocol!=="https:"&&parsed.protocol!=="http:")return [];
 const canonical=parsed.origin+parsed.pathname;if(seen.has(canonical))return [];seen.add(canonical);
 const date=String(a.seendate||"");const published=/^\\d{14}$/.test(date)?date.replace(/^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})$/,"$1-$2-$3T$4:$5:$6Z"):null;
 return [{title:String(a.title||"Untitled").slice(0,250),url:href,domain:String(a.domain||parsed.hostname).slice(0,150),source_country:String(a.sourcecountry||"").slice(0,80),language:String(a.language||"").slice(0,40),published_at:published,topic}];
 });
 return new Response(JSON.stringify({provider:"GDELT DOC 2.0",topic,articles,fetched_at:new Date().toISOString(),geolocation:"not_provided_by_doc_api",source_country_meaning:"publisher location, not event location"}),{headers:{...allow,"Content-Type":"application/json"}});
 }catch(e){return new Response(JSON.stringify({error:"news_temporarily_unavailable",articles:[],detail:String(e).slice(0,120)}),{status:503,headers:{...allow,"Content-Type":"application/json","Cache-Control":"no-store"}})}
});
