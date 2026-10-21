/* Owner-only inventory of measured datasets. Counts are not summed across
   families: these are different units and several describe the same activity. */
export const DATASETS = [
  ['events','Website events','Audience','events_lean','at','audience',false,'First-party · non-bot events',2],
  ['headlines','News headlines','Intelligence','media_news_articles','imported_at','intelligence',false,'Shared news catalog',6],
  ['publishers','News publishers','Intelligence','media_news_sources','created_at','intelligence',false,'Shared source catalog'],
  ['ingest_records','Ingested records','Intelligence','ops_ingest_records','ingested_at','intelligence',true,'House organization',24],
  ['connectors','Ingestion connectors','Intelligence','ops_ingest_connectors','created_at','intelligence',true,'Registered connectors; registration is not a successful sync'],
  ['ingest_runs','Ingestion attempts','Intelligence','ops_ingest_runs','started_at','intelligence',true,'Attempts include failed runs'],
  ['evidence','Evidence records','Intelligence','intel_evidence','created_at','intelligence',true,'Includes unreviewed evidence'],
  ['claims','Research claims','Intelligence','intel_claims','created_at','intelligence',true,'Includes unreviewed claims'],
  ['spatial_entities','Spatial entities','Intelligence','seek_first_entities','last_seen_at','intelligence',true,'Latest stored entities; not provider snapshot counts'],
  ['spatial_events','Spatial events','Intelligence','seek_first_events','updated_at','intelligence',true,'Stored events; updates retain provider provenance',24],
  ['spatial_observations','Spatial observations','Intelligence','seek_first_observations','created_at','intelligence',true,'Stored measurements; separate from entities and events'],
  ['social_posts','Imported publishing posts','Publishing','social_posts','created_at','#create:schedule',true,'Imported or platform-published posts; not impressions'],
  ['spatial_runs','Spatial ingestion attempts','Intelligence','seek_first_ingestion_runs','started_at','intelligence',true,'Attempts include failed runs'],
  ['social_accounts','Publishing accounts','Publishing','social_accounts','created_at','#create:channels',true,'Linked accounts; not measured reach'],
  ['social_metrics','Social metric snapshots','Publishing','social_metric_snapshots','recorded_at','#create:schedule',true,'Provider measurements; snapshots are not unique people',48],
  ['publish_jobs','Publishing jobs','Publishing','social_publish_jobs','created_at','#create:schedule',true,'Queued, completed and failed jobs'],
  ['missions','Missions','Action','action_missions','created_at','action',false,'First-party mission records, all states'],
  ['assignments','Mission assignments','Action','action_mission_assignments','joined_at','action',false,'Participation records, all states'],
  ['proofs','Mission proofs','Action','action_proofs','created_at','action',false,'Submitted evidence, all review states'],
  ['posts','Community posts','Community','network_posts','created_at','action',false,'Stored posts, including moderated or removed records'],
  ['tracks','Creator tracks','Content','creator_tracks','created_at','content',false,'Catalog records, including drafts'],
  ['music_orders','Music orders','Content','music_orders','created_at','content',false,'All order states; not revenue'],
  ['decisions','Adaptive decisions','System','experience_decisions','created_at','adaptive',false,'Recorded decisions; outcomes are measured separately'],
  ['observability','System events','System','control_observability_events','created_at','#system:observability',true,'House organization · retained events',24]
].map(([key,label,family,table,time,section,orgScoped,scope,quietHours])=>({key,label,family,table,time,section,orgScoped,scope,quietHours,
  contract_version:'analytics-coverage-contract/v1',
  producer:table,
  unit:'stored_rows',
  identity_basis:'Stored rows in '+table+'; cross-source/entity identity not inferred',
  numerator:'Count of rows matching declared scope and half-open time window',denominator:null,
  permitted_dimensions:['declared_organization_or_first_party_scope','time_window'],
  deduplication_key:{status:'unverified_domain_contract',note:'Coverage counts rows; it does not independently deduplicate domain entities.'},
  event_time_basis:time,
  lateness_policy:'Live database count; late rows change subsequent reads; no outcome maturity claim',
  retention:{status:'unverified_domain_policy'},
  privacy_class:'house_owner_aggregate',
  owner:{technical:'McCluster '+family.toLowerCase(),responsible_person:'unassigned'},
  reporting_destination:section,
  health_contract:{provider_health:'not_measured',data_quality:'not_adjudicated',
    states:['populated','empty','quiet','missing','unavailable'],
    note:'A row count, recent timestamp or registered connector does not establish current provider coverage.'}
}));

export async function boundedReads(tasks, limit=3) {
  const out=new Array(tasks.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,tasks.length)},async()=>{
    while(next<tasks.length){const i=next++;out[i]=await tasks[i]();}
  }));
  return out;
}

function windowFor(url) {
  const since=url.searchParams.get('since'),until=url.searchParams.get('until');
  if(!since&&!until)return null;
  const a=Date.parse(since),b=Date.parse(until);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b||b-a>5*366*86400000)
    throw Object.assign(new Error('Use a valid since/until range of at most five years'),{status:400});
  return {since:new Date(a).toISOString(),until:new Date(b).toISOString()};
}

async function measure(env,definition,orgId,window,fetchImpl) {
  const q=new URLSearchParams({select:definition.time,order:definition.time+'.desc.nullslast'});
  if(definition.orgScoped)q.set('org_id','eq.'+orgId);
  if(definition.key==='events'){q.set('site_id','is.null');q.set('is_bot','not.is.true');}
  if(window){q.append(definition.time,'gte.'+window.since);q.append(definition.time,'lt.'+window.until);}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetchImpl(env.SUPABASE_URL+'/rest/v1/'+definition.table+'?'+q,{
      headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,prefer:'count=exact',range:'0-0'},signal:controller.signal
    });
    const body=await response.json().catch(()=>null);
    if(!response.ok)return {status:['42P01','PGRST205'].includes(body?.code)?'missing':'unavailable',count:null,latest_at:null};
    const total=String(response.headers.get('content-range')||'').split('/').pop();
    if(!/^\d+$/.test(total)||!Number.isSafeInteger(Number(total))||!Array.isArray(body))return {status:'unavailable',count:null,latest_at:null};
    const latest=body[0]?.[definition.time];
    return {status:'measured',count:Number(total),latest_at:latest&&Number.isFinite(Date.parse(latest))?new Date(latest).toISOString():null};
  } catch {return {status:'unavailable',count:null,latest_at:null};}
  finally {clearTimeout(timer);}
}

export async function dataCoverage(env,orgId,url,{fetchImpl=fetch,now=new Date()}={}) {
  const window=windowFor(url),datasets=await boundedReads(DATASETS.map(d=>async()=>{
    const total=await measure(env,d,orgId,null,fetchImpl);
    const recent=window&&total.status==='measured'?await measure(env,d,orgId,window,fetchImpl):null;
    const age=total.latest_at?Math.max(0,(now-Date.parse(total.latest_at))/3600000):null;
    const state=total.status!=='measured'?total.status:total.count===0?'empty':d.quietHours&&age!==null&&age>d.quietHours?'quiet':'populated';
    return {key:d.key,label:d.label,family:d.family,section:d.section,scope:d.scope,time_field:d.time,
      unit:d.unit,owner:d.owner,contract_version:d.contract_version,health_contract:d.health_contract,
      count:total.count,latest_at:total.latest_at,status:total.status,state,
      window_count:recent?.count??null,window_status:recent?.status||(window?'unavailable':'not_requested'),
      quiet_after_hours:d.quietHours||null,
      next_step:state==='missing'?'Provision the existing governed schema before archiving.':state==='unavailable'?'Check the data service and permissions, then retry.':state==='empty'?'No stored records. Check the source or collection workflow.':state==='quiet'?'No recent records. Check the collection schedule and recent attempts.':'Open the dataset view for its measured detail.'};
  }));
  // Preserve the original seven metric keys for existing consumers.
  const metrics=Object.fromEntries(datasets.map(d=>[d.key,{count:d.count,status:d.status}]));
  return {ok:true,schema:'analytics-coverage/v2',measured_at:now.toISOString(),scope:'Stored records · first-party and house organization',window,datasets,metrics,
    summary:{datasets:datasets.length,populated:datasets.filter(d=>d.state==='populated').length,empty:datasets.filter(d=>d.state==='empty').length,quiet:datasets.filter(d=>d.state==='quiet').length,unavailable:datasets.filter(d=>['missing','unavailable'].includes(d.state)||['missing','unavailable'].includes(d.window_status)).length}};
}
