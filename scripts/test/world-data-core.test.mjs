import test from 'node:test';
import assert from 'node:assert/strict';
import { readerSourceDecision, readerArticleDecision, filterReaderArticles, APPROVED_READER_GRANTS } from '../../workers/mccluster/src/news-reader-policy.js';
import { handleWorldNews, ingestGdeltNews, cleanTitle } from '../../workers/mccluster/src/world-news.js';
import { INDICATORS, indicatorQuery, normalizeIndicators, fetchIndicators, createIndicatorClient } from '../../workers/mccluster/src/intel/world-indicators.js';
const now = Date.parse('2026-10-16T12:00:00Z');
const grant = { id: 'fixture-1', status: 'approved', reviewer: 'fixture-reviewer', reviewed_at: '2026-10-01T00:00:00Z', expires_at: '2026-11-01T00:00:00Z',
  terms_url: 'https://publisher.example/license', basis: 'licensed', native_layout: true, full_text_display: true,
  storage: true, automated_ingestion: true, attribution_required: true, adapter_ids: ['fixture'], scope: 'path', hostname: 'publisher.example', path_prefix: '/news/' };
const article = { canonical_url: 'https://publisher.example/news/one', title: 'An original title', publisher: 'Original Publisher', byline: 'Example Writer',
  attribution: 'Original Publisher / Example Writer', adapter_id: 'fixture', requirements_reviewed: true,
  body: { complete: true, format: 'text_blocks', blocks: [{ type: 'paragraph', text: 'This is original fixture prose, not a real news story.' }] } };
const pop = 'SP.POP.TOTL', gdp = 'NY.GDP.MKTP.CD';
const q = indicatorQuery({ economy: 'US', indicators: [pop, gdp] });
const row = (indicator=pop, value=10, date='2024', extra={}) => ({indicator:{id:indicator,value:'Provider label'}, country:{id:'US',value:'United States'},countryiso3code:'USA',date,value,...extra});
const payload = (...rows) => [{page:1,pages:1,total:rows.length,lastupdated:'2026-10-08'},rows];
const json = body => new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const clock = () => new Date(now);
const noNetwork = async () => { throw Error('unexpected network call'); };

test('no source is automatically licensed, even a complete article',()=>{
  assert.equal(APPROVED_READER_GRANTS.length,0);
  assert.equal(readerArticleDecision(article).allowed,false);
  assert.equal(readerSourceDecision(article.canonical_url,[],now).reason,'no_current_native_reader_grant');
});
test('reviewed grant plus complete attributed text passes; input is not rewritten',()=>{
  const before=JSON.stringify(article), out=readerArticleDecision(article,[grant],now);
  assert.equal(out.allowed,true);assert.equal(out.images_allowed,false);assert.equal(JSON.stringify(article),before);
});
for(const [name,change] of Object.entries({unreviewed:{status:'pending'},expired:{expires_at:'2026-10-01'},future:{reviewed_at:'2027-01-01'},noReviewer:{reviewer:''},noLicense:{terms_url:''},noNative:{native_layout:false},manualOnly:{automated_ingestion:false},noStorage:{storage:false},noText:{full_text_display:false},noAttribution:{attribution_required:false}})){
 test('reader rejects grant: '+name,()=>assert.equal(readerArticleDecision(article,[{...grant,...change}],now).allowed,false));
}
for(const url of ['https://evil.example/news/one','https://sub.publisher.example/news/one','https://publisher.example/other/one','http://publisher.example/news/one','https://a:b@publisher.example/news/one','javascript:alert(1)','https://publisher.example:8443/news/one']){
 test('reader rejects URL scope '+url,()=>assert.equal(readerSourceDecision(url,[grant],now).allowed,false));
}
test('article-specific grants never license an entire source',()=>{
 const g={...grant,scope:'article',canonical_url:article.canonical_url};
 assert.equal(readerArticleDecision(article,[g],now).allowed,true);
 assert.equal(readerArticleDecision({...article,canonical_url:'https://publisher.example/news/two'},[g],now).allowed,false);
});
test('article data cannot grant itself permission',()=>{
 assert.equal(readerArticleDecision({...article,reader_eligible:true,grant},[],now).allowed,false);
});
for(const [name,change] of Object.entries({summary:{body:{complete:false,format:'text_blocks',blocks:article.body.blocks}},missingBody:{body:null},html:{body:{complete:true,format:'html',blocks:article.body.blocks}},missingCredit:{byline:''},unreviewedRequirements:{requirements_reviewed:false},wrongAdapter:{adapter_id:'gdelt_gkg_v2'}})){
 test('reader rejects article: '+name,()=>assert.equal(readerArticleDecision({...article,...change},[grant],now).allowed,false));
}
test('reader filter records exclusion reasons without mutating articles',()=>{
 const result=filterReaderArticles([article,{...article,body:null}],[grant],now);
 assert.deepEqual(result.accepted,[article]);assert.equal(result.rejected.full_text_not_available,1);
});
test('strict news mode stops metadata ingestion before any network or DB work',async()=>{
 const result=await ingestGdeltNews({WORLD_NEWS_READER_ONLY:'true',WORLD_NEWS_INGEST_ENABLED:'true'},{fetchImpl:noNetwork});
 assert.equal(result.skipped,'native_reader_only_metadata_source');
});
test('strict feed does not re-serve an old cached external-link story',async()=>{
 const result=await handleWorldNews(new Request('https://api.mccluster.org/v1/world/news'),{WORLD_NEWS_READER_ONLY:'true'}, {fetchImpl:noNetwork,cacheImpl:{match:noNetwork}});
 assert.equal(result.headers.get('cache-control'),'no-store');const body=await result.json();
 assert.deepEqual(body.items,[]);assert.equal(body.reader_status,'awaiting_authorized_full_text');
});
test('strict reader HEAD and unrelated URLs preserve handler boundaries',async()=>{
 assert.equal(await handleWorldNews(new Request('https://api.mccluster.org/v1/other'),{WORLD_NEWS_READER_ONLY:'true'}),null);
 const res=await handleWorldNews(new Request('https://api.mccluster.org/v1/world/news',{method:'HEAD'}),{WORLD_NEWS_READER_ONLY:'true'});assert.equal(await res.text(),'');
});
test('strict reader rejects mutations and does not change legacy parsing',async()=>{
 const res=await handleWorldNews(new Request('https://api.mccluster.org/v1/world/news',{method:'POST'}),{WORLD_NEWS_READER_ONLY:'true'});assert.equal(res.status,405);
 assert.equal(cleanTitle('Test &amp; proof | XYZ'),'Test & proof');
 assert.deepEqual(await ingestGdeltNews({}, {fetchImpl:noNetwork}),{skipped:'disabled'});
});
test('World Bank query is fixed-host, bounded, key-free and source-specific',()=>{
 const u=new URL(q.url);assert.equal(u.hostname,'api.worldbank.org');assert.equal(u.searchParams.get('source'),'2');assert.equal(u.searchParams.get('mrnev'),'1');
 assert.equal(INDICATORS.length,8);assert.equal(u.searchParams.has('key'),false);
});
for(const economy of ['all','US;CN','https://evil.example','usa','HIC','US/../../']){
 test('indicator query rejects arbitrary or aggregate request '+economy,()=>assert.throws(()=>indicatorQuery({economy})));
}
test('indicator id injection cannot escape the provider allowlist',()=>{
 assert.throws(()=>indicatorQuery({indicators:['SP.POP.TOTL/../../']}));assert.throws(()=>indicatorQuery({indicators:[]}));
});
test('values retain real periods and null is not zero',()=>{
 const data=normalizeIndicators(payload(row(pop,10,'2024'),row(gdp,null,'2025')),q,clock().toISOString());
 const p=data.observations.find(x=>x.indicator===pop),g=data.observations.find(x=>x.indicator===gdp);
 assert.equal(p.value,10);assert.equal(p.period,'2024');assert.equal(p.is_live,false);assert.equal(g.value,null);assert.equal(g.status,'no_observation');
});
test('mixed years are explicit and real zero is preserved',()=>{
 const data=normalizeIndicators(payload(row(pop,0,'2024'),row(gdp,12,'2023')),q,clock().toISOString());
 assert.equal(data.mixed_periods,true);assert.equal(data.observations.find(x=>x.indicator===pop).value,0);
});
test('world population uses the supplied world aggregate, not a sum',()=>{
 const w=indicatorQuery({economy:'WLD',indicators:[pop]});
 const data=normalizeIndicators(payload(row(pop,100,'2024',{country:{id:'1W',value:'World'},countryiso3code:'WLD'})),w,clock().toISOString());
 assert.equal(data.observations[0].geography.type,'world_aggregate');assert.equal(data.observations[0].value,100);
});
for(const [label,r] of [['string',row(pop,'10')],['negative population',row(pop,-1)],['future',row(pop,10,'2040')],['wrong economy',row(pop,10,'2024',{country:{id:'FR'}})],['unexpected metric',row('unknown')]]){
 test('normalization rejects '+label,()=>assert.throws(()=>normalizeIndicators(payload(r),q,clock().toISOString())));
}
test('multiple pages and provider error objects cannot pretend to be a complete result',()=>{
 assert.throws(()=>normalizeIndicators([{pages:2},[row()]],q));assert.throws(()=>normalizeIndicators([{message:'invalid'}],q));
 assert.throws(()=>normalizeIndicators(payload(row(pop,10),row(pop,12)),q,clock().toISOString()));
});
test('negative GDP growth is valid and not clamped to zero',()=>{
 const id='NY.GDP.MKTP.KD.ZG';const query=indicatorQuery({economy:'US',indicators:[id]});
 assert.equal(normalizeIndicators(payload(row(id,-1.2)),query,clock().toISOString()).observations[0].value,-1.2);
});
test('fetch attaches no owner or service credentials',async()=>{
 const data=await fetchIndicators({economy:'US',indicators:[pop]}, {now:clock,fetchImpl:async(url,init)=>{
  assert.equal(init.redirect,'manual');assert.deepEqual(init.headers,{accept:'application/json'});return json(payload(row()));
 }});assert.equal(data.observations[0].value,10);
});
for(const status of [302,429,500]){
 test('provider '+status+' is a failure, not fabricated zeros',async()=>assert.rejects(fetchIndicators({economy:'US',indicators:[pop]}, {now:clock,fetchImpl:async()=>new Response(null,{status})})));
}
test('invalid JSON and oversized provider bodies fail closed',async()=>{
 await assert.rejects(fetchIndicators({}, {fetchImpl:async()=>new Response('<html>Error</html>')}));
 await assert.rejects(fetchIndicators({}, {fetchImpl:async()=>new Response('x'.repeat(524289))}));
});
test('cache coalesces requests and callers cannot mutate shared data',async()=>{
 let count=0;const client=createIndicatorClient({now:clock,clock:()=>now,fetchImpl:async()=>{count++;await new Promise(r=>setTimeout(r,5));return json(payload(row()));}});
 const input={economy:'US',indicators:[pop]};const [a,b]=await Promise.all([client(input),client(input)]);
 a.observations[0].value=999;assert.equal(b.observations[0].value,10);assert.equal((await client(input)).observations[0].value,10);assert.equal(count,1);
});
test('failed calls are never cached as successful data',async()=>{
 let count=0;const client=createIndicatorClient({fetchImpl:async()=>{count++;throw Error('offline');}});
 await assert.rejects(client({}));await assert.rejects(client({}));assert.equal(count,2);
});
