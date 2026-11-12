/* Public issuer facts, reviewed offline. No source collection, owner portfolio inference,
   person geolocation, provider credential, order API or database mutation. */
import REFERENCE from '../../../../data/markets/company-leadership.json' with { type: 'json' };
const DAY = 86400000;
const TYPES = new Set(['official_issuer', 'sec_filing', 'wikidata_coordinates','official_geocoder','openstreetmap_geocoder']);
const HOSTS = ['amd.com', 'chevron.com', 'verizon.com', 'aep.com', 'aepinvestors.com', 'att.com', 'sec.gov', 'wikidata.org', 'chevroncorp.gcs-web.com','census.gov','openstreetmap.org','osmfoundation.org','iso20022.org'];
const fail = code => { const e = new Error(code); e.code=code; e.status=400; throw e; };
const record = x => x && typeof x==='object' && !Array.isArray(x);
const text = (x,max=500) => typeof x==='string' && x.trim()===x && x.length>0 && x.length<=max && !/[\u0000-\u001f\u007f<>]/.test(x);
function fields(x, allowed) { if (!record(x) || Object.keys(x).some(k=>!allowed.includes(k))) fail('invalid_leadership_reference'); }
function date(x, partial=false) {
  if (typeof x!=='string' || !(partial ? /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/ : /^\d{4}-\d{2}-\d{2}$/).test(x)) return false;
  const full=x.length===4?x+'-01-01':x.length===7?x+'-01':x;
  const ms=Date.parse(full+'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10)===full;
}
function link(x) {
  try { if(typeof x!=='string')return false;const u=new URL(x);return x.length<=2048 && u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)); } catch { return false; }
}
const list = (x,max) => Array.isArray(x) && x.length<=max;
export function validateLeadershipReference(doc) {
  fields(doc,['schema_version','retrieved_at','sources','companies','licensing_audit','limitations','purpose','mic_standard']);
  if (doc.schema_version!==1 || !date(doc.retrieved_at) || !list(doc.sources,300) || !list(doc.companies,100) || !list(doc.limitations,30) || !doc.limitations.every(x=>text(x,2000)) || !list(doc.licensing_audit,30)) fail('invalid_leadership_reference');
  if(doc.purpose!==undefined&&!text(doc.purpose,2000))fail('invalid_leadership_reference');
  if(doc.mic_standard!==undefined){fields(doc.mic_standard,['source_url','retrieved_at','mapping','note']);fields(doc.mic_standard.mapping,['XNAS','XNYS']);if(!link(doc.mic_standard.source_url)||!date(doc.mic_standard.retrieved_at)||!text(doc.mic_standard.note,2000)||!Object.values(doc.mic_standard.mapping).every(x=>text(x,100)))fail('invalid_leadership_reference');}
  const sources=new Map();
  for(const source of doc.sources){
    fields(source,['id','url','title','source_type','published_at','as_of','retrieved_at','retrieval_method','note','attribution','license']);
    if(!text(source.id,100)||sources.has(source.id)||!link(source.url)||!text(source.title)||!TYPES.has(source.source_type)||!date(source.retrieved_at)||source.retrieved_at>doc.retrieved_at||source.published_at!==null&&!date(source.published_at,true)||source.as_of!==null&&!date(source.as_of,true))fail('invalid_leadership_source');
    const host=new URL(source.url).hostname;
    if((source.source_type==='wikidata_coordinates')!==(/(^|\.)wikidata\.org$/.test(host)) || source.source_type==='sec_filing'&&!/(^|\.)sec\.gov$/.test(host))fail('invalid_leadership_source');
    if(source.note!==undefined&&!text(source.note,3000)||source.retrieval_method!==undefined&&!text(source.retrieval_method,100))fail('invalid_leadership_source');
        if(source.attribution!==undefined&&!text(source.attribution)||source.license!==undefined&&!text(source.license))fail('invalid_leadership_source');
    if(source.source_type==='official_issuer'&&!['amd.com','chevron.com','verizon.com','aep.com','aepinvestors.com','att.com','chevroncorp.gcs-web.com'].some(h=>host===h||host.endsWith('.'+h)))fail('invalid_leadership_source');
    if(source.source_type==='official_geocoder'&&!/(^|\.)census\.gov$/.test(host)||source.source_type==='openstreetmap_geocoder'&&host!=='nominatim.openstreetmap.org')fail('invalid_leadership_source');
    sources.set(source.id,source);
  }
  const refs=ids=>list(ids,10)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>sources.has(id)&&['official_issuer','sec_filing'].includes(sources.get(id).source_type));
  const seen=new Set(),listings=new Set();
  for(const company of doc.companies){
    fields(company,['ticker','mic','name','cik','headquarters','coverage','people','exchange','identity_source_ids','scheduled_changes','listing_note']);
    if(typeof company.ticker!=='string'||typeof company.mic!=='string'||typeof company.cik!=='string'||!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(company.ticker)||!/^X(NAS|NYS)$/.test(company.mic)||!/^\d{10}$/.test(company.cik)||!text(company.name)||seen.has(company.cik)||listings.has(company.ticker+':'+company.mic)||!list(company.people,250))fail('invalid_leadership_company');
    seen.add(company.cik);listings.add(company.ticker+':'+company.mic);
    fields(company.coverage,['executives','directors','limitations','executive_count','regional_executive_count','director_count','unique_people_count']);
    if(!text(company.coverage.executives,2000)||!text(company.coverage.directors,2000)||!list(company.coverage.limitations,30)||!company.coverage.limitations.every(x=>text(x,2000)))fail('invalid_leadership_company');
    if(company.exchange!==undefined&&!text(company.exchange,100)||company.listing_note!==undefined&&!text(company.listing_note,2000))fail('invalid_leadership_company');
    if(!refs(company.identity_source_ids)||!company.identity_source_ids.some(id=>sources.get(id).url==='https://data.sec.gov/submissions/CIK'+company.cik+'.json'))fail('invalid_leadership_identity');
    if(company.scheduled_changes!==undefined){
      if(!list(company.scheduled_changes,50))fail('invalid_leadership_change');
      for(const change of company.scheduled_changes){
        fields(change,['name','title','effective_at','source_ids']);
        if(!text(change.name,200)||!text(change.title)||!date(change.effective_at)||!refs(change.source_ids))fail('invalid_leadership_change');
      }
    }
    for(const key of ['executive_count','regional_executive_count','director_count','unique_people_count'])if(company.coverage[key]!==undefined&&(!Number.isSafeInteger(company.coverage[key])||company.coverage[key]<0||company.coverage[key]>500))fail('invalid_leadership_company');
    const names=new Set();
    for(const person of company.people){
      fields(person,['name','roles']);
      if(!text(person.name,200)||names.has(person.name)||!list(person.roles,20)||!person.roles.length)fail('invalid_leadership_person');
      names.add(person.name);
      for(const role of person.roles){
        fields(role,['category','title','organization','source_ids','role_start','role_end','observed_at','verification','role_start_precision','date_note','board_service_start','board_service_start_precision']);
        if(!['executive','director','regional_executive'].includes(role.category)||!text(role.title)||!text(role.organization)||!refs(role.source_ids)||!date(role.observed_at)||role.observed_at>doc.retrieved_at||role.verification!=='issuer_roster_observed'||role.role_start!==null&&!date(role.role_start,true)||role.role_end!==null&&!date(role.role_end,true))fail('invalid_leadership_role');
        if(role.date_note!==undefined&&!text(role.date_note,2000)||role.board_service_start!==undefined&&!date(role.board_service_start,true)||role.role_start_precision!=null&&!['day','month','year'].includes(role.role_start_precision)||role.board_service_start_precision!=null&&!['day','month','year'].includes(role.board_service_start_precision))fail('invalid_leadership_role');
        if(role.role_start&&role.role_end&&role.role_start>role.role_end)fail('invalid_leadership_role');
        if(role.source_ids.some(id=>sources.get(id).retrieved_at!==role.observed_at))fail('invalid_leadership_role');
      }
    }
    const h=company.headquarters;
    if(h!==null){
      fields(h,['city','region','country','address','source_ids','geolocation']);
      if(!text(h.city,150)||!text(h.region,150)||!text(h.country,100)||h.address!==null&&!text(h.address,500)||!refs(h.source_ids))fail('invalid_leadership_place');
      if(h.geolocation!==null){
        const g=h.geolocation;fields(g,['type','latitude','longitude','matched_address','query_address','source_ids','source_url','geocoder','precision','confidence','retrieved_at','attribution','license','note','license_url','osm_type','osm_id','osm_url']);
        if(g.type!=='headquarters_business_address'||!['address_range_interpolated','mapped_office_building'].includes(g.precision)||!['moderate','high_address_match'].includes(g.confidence)||!Number.isFinite(g.latitude)||Math.abs(g.latitude)>90||!Number.isFinite(g.longitude)||Math.abs(g.longitude)>180||g.latitude===0&&g.longitude===0||!text(g.matched_address)||!text(g.query_address)||!link(g.source_url)||!date(g.retrieved_at)||!text(g.attribution)||!text(g.geocoder)||!text(g.license)||!text(g.note,2000)||g.license_url!==undefined&&!link(g.license_url)||g.osm_url!==undefined&&!link(g.osm_url)||g.osm_type!==undefined&&!['way','node','relation'].includes(g.osm_type)||g.osm_id!==undefined&&(!Number.isSafeInteger(g.osm_id)||g.osm_id<1))fail('invalid_leadership_place');
        if(!list(g.source_ids,10)||!g.source_ids.length||g.source_ids.some(id=>!sources.has(id)||!['official_geocoder','openstreetmap_geocoder'].includes(sources.get(id).source_type))||!g.source_ids.some(id=>sources.get(id).url===g.source_url))fail('invalid_leadership_place');
        if(g.precision==='mapped_office_building'&&(g.license_url!=='https://www.openstreetmap.org/copyright'||!/^https:\/\/www\.openstreetmap\.org\/(way|node|relation)\/\d+$/.test(g.osm_url||'')))fail('invalid_leadership_place');
      }
    }
  }
  for(const audit of doc.licensing_audit){
    fields(audit,['dataset','paid_license_required','source_urls','retrieved_at','finding','license']);
    if(!text(audit.dataset)||typeof audit.paid_license_required!=='boolean'||!list(audit.source_urls,20)||!audit.source_urls.every(link)||!date(audit.retrieved_at)||!text(audit.finding,3000)||audit.license!==undefined&&!text(audit.license))fail('invalid_leadership_licensing');
  }
  return doc;
}
function freshness(observed,now){const age=Math.floor((now-Date.parse(observed+'T00:00:00Z'))/DAY);return {state:age<0?'future_observation':age>30?'review_due':'recently_observed',observed_at:observed,age_days:age<0?null:age,is_live:false};}
export function leadershipView({symbol=null,mic=null,now=Date.now(),reference=REFERENCE}={}){
  const doc=validateLeadershipReference(reference);
  if(!Number.isFinite(now)||symbol!==null&&typeof symbol!=='string'||mic!==null&&typeof mic!=='string'||symbol!==null&&!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)||mic!==null&&!/^[A-Z0-9]{4}$/.test(mic)||mic!==null&&symbol===null)fail('invalid_leadership_query');
  const common={schema:'finance-executive-roster/v1',reference_version:doc.retrieved_at,generated_at:new Date(now).toISOString(),kind:'reviewed_public_reference',is_live:false,automatic_collection:false,ownership:'not_asserted',limitations:doc.limitations};
  if(symbol===null)return {...common,status:'available',companies:doc.companies.map(c=>({symbol:c.ticker,mic:c.mic,issuer_id:'sec:'+c.cik,name:c.name,headquarters:c.headquarters,people_count:c.people.length,role_count:c.people.reduce((n,p)=>n+p.roles.length,0),freshness:freshness(doc.retrieved_at,now)}))};
  const c=doc.companies.find(c=>c.ticker===symbol&&(!mic||c.mic===mic));
  if(!c)return {...common,status:'not_covered',symbol,company:null,reason:'No reviewed roster for this listing. No role or location is inferred.'};
  const used=new Set([...c.identity_source_ids,...(c.scheduled_changes||[]).flatMap(x=>x.source_ids),...c.people.flatMap(p=>p.roles.flatMap(r=>r.source_ids))]);
  for(const id of c.headquarters?.source_ids||[])used.add(id);
  for(const id of c.headquarters?.geolocation?.source_ids||[])used.add(id);
  return {...common,status:'available',company:{...c,issuer_id:'sec:'+c.cik,people:c.people.map(p=>({...p,roles:p.roles.map(r=>({...r,freshness:freshness(r.observed_at,now)}))}))},sources:doc.sources.filter(s=>used.has(s.id)),licensing_audit:doc.licensing_audit};
}
