/* Public SEC association reference. No instrument/plan/ownership eligibility inference. */
import REFERENCE from '../../../../data/markets/sec-listing-directory.json' with {type:'json'};
import PILOT from '../../../../data/markets/sector-research-pilot.json' with {type:'json'};
const EXCHANGES=new Set(['Nasdaq','NYSE','OTC','CBOE','TXSE',null]);
const fail=code=>{throw Object.assign(new Error(code),{code,status:400});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
function time(x){return typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,19)===x.slice(0,19);}
function keys(x,allowed){if(!plain(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail('invalid_reference');}
export function validateUniverseReference(d){
  keys(d,['schema','retrieved_at','source','counts','limitations','listings']);
  if(d.schema!=='owner-finance-sec-directory-v1'||!time(d.retrieved_at))fail('invalid_reference_time');
  keys(d.source,['url','retrieved_at_utc','http_status','bytes','sha256','response_last_modified','response_date','path']);
  if(d.source.url!=='https://www.sec.gov/files/company_tickers_exchange.json'||d.source.retrieved_at_utc!==d.retrieved_at||d.source.http_status!==200||!Number.isSafeInteger(d.source.bytes)||d.source.bytes<1||d.source.bytes>10000000||typeof d.source.sha256!=='string'||! /^[a-f0-9]{64}$/.test(d.source.sha256))fail('invalid_source');
  for(const k of ['response_last_modified','response_date','path'])if(d.source[k]!=null&&!text(d.source[k],300))fail('invalid_source_metadata');
  if(!Array.isArray(d.limitations)||d.limitations.length>30||d.limitations.some(x=>!text(x,1500)))fail('invalid_limitations');
  if(!Array.isArray(d.listings)||!d.listings.length||d.listings.length>50000)fail('invalid_listings');
  const ids=new Set(),ciks=new Set(),counts={};
  for(const row of d.listings){
    keys(row,['issuer_id','cik','ticker','name','exchange','listing_id']);
    if(typeof row.cik!=='string'||!/^\d{10}$/.test(row.cik)||row.issuer_id!=='sec:'+row.cik||typeof row.ticker!=='string'||!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(row.ticker)||!text(row.name,250)||!EXCHANGES.has(row.exchange))fail('invalid_listing');
    const exchange=row.exchange||'UNKNOWN';
    if(row.listing_id!==row.issuer_id+'|'+exchange+'|'+row.ticker||ids.has(row.listing_id))fail('invalid_listing_identity');
    ids.add(row.listing_id);ciks.add(row.cik);counts[exchange]=(counts[exchange]||0)+1;
  }
  keys(d.counts,['listing_associations','distinct_ciks','distinct_listing_ids','by_exchange']);
  if(d.counts.listing_associations!==ids.size||d.counts.distinct_listing_ids!==ids.size||d.counts.distinct_ciks!==ciks.size||!plain(d.counts.by_exchange)||JSON.stringify(Object.entries(counts).sort())!==JSON.stringify(Object.entries(d.counts.by_exchange).sort()))fail('invalid_counts');
  return d;
}
validateUniverseReference(REFERENCE);
export function validateSectorPilot(d,reference=REFERENCE){
  keys(d,['schema','research_date','source_directory_sha256','coverage','sector_scheme','limitations','listings']);
  if(d.schema!=='owner-finance-pilot-reference-v1'||d.source_directory_sha256!==reference.source.sha256||typeof d.research_date!=='string'||!time(d.research_date+'T00:00:00Z'))fail('invalid_pilot');
  keys(d.sector_scheme,['id','labels','disclosure']);
  if(d.sector_scheme.id!=='independent-research-sectors-v1'||!Array.isArray(d.sector_scheme.labels)||d.sector_scheme.labels.length!==11||new Set(d.sector_scheme.labels).size!==11||d.sector_scheme.labels.some(x=>!text(x,80))||!text(d.sector_scheme.disclosure,1000))fail('invalid_sector_scheme');
  if(!Array.isArray(d.limitations)||d.limitations.some(x=>!text(x,1500))||!Array.isArray(d.listings)||!d.listings.length||d.listings.length>1000)fail('invalid_pilot');
  const byId=new Map(reference.listings.map(x=>[x.listing_id,x])),ids=new Set(),ciks=new Set(),sectors=new Set();let us=0,foreign=0;
  const source=(url,cik)=>{if(typeof url!=='string')return false;try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&((u.hostname==='data.sec.gov'&&u.pathname==='/submissions/CIK'+cik+'.json')||(u.hostname==='www.sec.gov'&&u.pathname.startsWith('/Archives/edgar/data/'+Number(cik)+'/')));}catch{return false;}};
  for(const row of d.listings){
    keys(row,['cik','classification_review_date','country_of_incorporation','country_of_incorporation_source','coverage_group','direct_purchase_plan_fees','direct_purchase_plan_minimum','direct_purchase_plan_status','exchange','existing_reference_example','held_quantity','home_listing_description','home_listing_source','identity_note','incorporation_jurisdiction_as_reported','issuer_id','listing_id','name','ownership_status','recent_annual_filing','reference_status','sec_sic','sec_sic_description','sec_sic_source','sec_submissions_retrieved_at','sec_submissions_sha256','sector','sector_assignment_method','sector_scheme','security_type','security_type_note','security_type_source','ticker','underlying_ordinary_shares_per_receipt','user_purchase_eligibility']);
    const original=byId.get(row.listing_id);if(!original||ids.has(row.listing_id)||['issuer_id','cik','ticker','name','exchange'].some(k=>row[k]!==original[k]))fail('pilot_identity_mismatch');
    if(row.reference_status!=='research_candidate_only'||row.ownership_status!=='not_confirmed'||row.held_quantity!==null||row.user_purchase_eligibility!=='unreviewed'||row.direct_purchase_plan_status!=='unreviewed'||row.direct_purchase_plan_minimum!==null||row.direct_purchase_plan_fees!==null||typeof row.existing_reference_example!=='boolean')fail('pilot_cannot_assert_ownership_or_eligibility');
    if(!d.sector_scheme.labels.includes(row.sector)||row.sector_scheme!==d.sector_scheme.id||!text(row.sector_assignment_method,300)||typeof row.sec_sic!=='string'||!/^\d{4}$/.test(row.sec_sic)||!text(row.sec_sic_description,300)||!source(row.sec_sic_source,row.cik)||!time(row.sec_submissions_retrieved_at)||typeof row.sec_submissions_sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sec_submissions_sha256)||row.classification_review_date!==d.research_date)fail('invalid_sector_evidence');
    for(const k of ['security_type_note','identity_note','home_listing_description','incorporation_jurisdiction_as_reported'])if(row[k]!=null&&!text(row[k],1500))fail('invalid_pilot_text');
    if(row.country_of_incorporation!==null&&(!text(row.country_of_incorporation,100)||!source(row.country_of_incorporation_source,row.cik)))fail('invalid_pilot_country');
    if(![null,'ordinary_registered_share','american_depositary_receipt','american_depositary_share','common_share'].includes(row.security_type)||(row.security_type!==null&&!source(row.security_type_source,row.cik)))fail('invalid_security_type');
    if(['american_depositary_receipt','american_depositary_share'].includes(row.security_type)&&(!Number.isFinite(row.underlying_ordinary_shares_per_receipt)||row.underlying_ordinary_shares_per_receipt<=0))fail('invalid_receipt_ratio');
    for(const k of ['home_listing_source','country_of_incorporation_source','security_type_source'])if(row[k]!=null&&!source(row[k],row.cik))fail('invalid_pilot_source');
    if(row.underlying_ordinary_shares_per_receipt!=null&&(!Number.isFinite(row.underlying_ordinary_shares_per_receipt)||row.underlying_ordinary_shares_per_receipt<=0))fail('invalid_receipt_ratio');
    keys(row.recent_annual_filing,['form','filed_at','period_ended','url']);if(!['10-K','20-F','40-F'].includes(row.recent_annual_filing.form)||typeof row.recent_annual_filing.filed_at!=='string'||!time(row.recent_annual_filing.filed_at+'T00:00:00Z')||typeof row.recent_annual_filing.period_ended!=='string'||!time(row.recent_annual_filing.period_ended+'T00:00:00Z')||!source(row.recent_annual_filing.url,row.cik))fail('invalid_annual_filing');
    if(row.coverage_group==='us_listing_sector_reference')us++;else if(row.coverage_group==='selected_foreign_issuer_us_listing')foreign++;else fail('invalid_coverage_group');
    ids.add(row.listing_id);ciks.add(row.cik);sectors.add(row.sector);
  }
  keys(d.coverage,['listing_count','unique_issuer_ciks','research_sectors','us_listing_sector_references','selected_foreign_issuer_us_listings']);
  if(d.coverage.listing_count!==ids.size||d.coverage.unique_issuer_ciks!==ciks.size||d.coverage.research_sectors!==sectors.size||d.coverage.us_listing_sector_references!==us||d.coverage.selected_foreign_issuer_us_listings!==foreign)fail('invalid_pilot_counts');
  return d;
}
validateSectorPilot(PILOT);
const sorted=[...REFERENCE.listings].sort((a,b)=>a.name.localeCompare(b.name)||a.listing_id.localeCompare(b.listing_id));
function freshness(now){const age=now-Date.parse(REFERENCE.retrieved_at);return !Number.isFinite(age)||age<0?'future_observation':age>7*86400000?'review_due':'recently_observed';}
export function universeSummary({now=Date.now()}={}){return {kind:'sec_association_reference',listing_count:REFERENCE.counts.listing_associations,issuer_count:REFERENCE.counts.distinct_ciks,issuer_count_basis:'distinct SEC CIKs, not verified operating-company groups',by_exchange:{...REFERENCE.counts.by_exchange},retrieved_at:REFERENCE.retrieved_at,source:{...REFERENCE.source},freshness:freshness(now),pilot_coverage:{...PILOT.coverage},sector_scheme:{...PILOT.sector_scheme,labels:[...PILOT.sector_scheme.labels]},eligible_count:null,confirmed_held_count:null,eligibility:'unreviewed',is_live:false,limitations:[...REFERENCE.limitations]};}
export function universeView({q='',exchange='',scope='directory',offset=0,limit=25,now=Date.now()}={}){
  if(typeof q!=='string'||q.length>80||/[\u0000-\u001f]/.test(q)||typeof exchange!=='string'||(exchange!==''&&exchange!=='UNKNOWN'&&!EXCHANGES.has(exchange))||!['directory','sector_pilot'].includes(scope)||!Number.isSafeInteger(offset)||offset<0||offset>50000||!Number.isSafeInteger(limit)||limit<1||limit>50)fail('invalid_universe_query');
  const terms=q.trim().toLocaleLowerCase('en-US'),pilotById=new Map(PILOT.listings.map(x=>[x.listing_id,x]));
  const rows=sorted.filter(x=>(!exchange||(x.exchange||'UNKNOWN')===exchange)&&(!terms||[x.ticker,x.name,x.cik].some(s=>s.toLocaleLowerCase('en-US').includes(terms)))&&(scope==='directory'||pilotById.has(x.listing_id)));
  const items=rows.slice(offset,offset+limit).map(x=>({...x,...(scope==='sector_pilot'?structuredClone(pilotById.get(x.listing_id)):{}),ownership:'not_asserted',direct_purchase_eligibility:'unknown'}));
  return {schema:'finance-universe-view/v1',...universeSummary({now}),scope,offset,limit,total:rows.length,items};
}
