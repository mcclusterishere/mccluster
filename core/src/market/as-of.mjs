/* Offline projection of authorized ops_ingest_records exports; not a collector or trading model. */
import {pathToFileURL} from 'node:url';
import {open} from 'node:fs/promises';
// PostgreSQL exports retain microseconds. Parse whole seconds separately so JS
// Date never rounds/truncates a fraction across the availability boundary.
function timestamp(value) {
 if(typeof value!=='string')return null;
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
 if(!m)return null;
 const whole=m[1]+'T'+m[2],ms=Date.parse(whole+'Z');
 if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,19)!==whole)return null;
 const hours=Number(m[6]||0),minutes=Number(m[7]||0);
 if(hours>23||minutes>59)return null;
 const offset=BigInt((hours*60+minutes)*(m[5]==='-'?-1:1));
 return BigInt(ms)*1000n+BigInt((m[3]||'').padEnd(6,'0'))-offset*60_000_000n;
}
function isoMicroseconds(value) {
 const remainder=(value%1000n+1000n)%1000n;
 return new Date(Number((value-remainder)/1000n)).toISOString().replace('Z',String(remainder).padStart(3,'0')+'Z');
}
const policy=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0;
export function observationsAsOf(records,{orgId,at}={}) {
 const cutoff=timestamp(at);
 if(!orgId||cutoff===null||!Array.isArray(records)||records.length>5000)throw Error('invalid_replay_input');
 const grouped=new Map(),excluded=[];
 for(const r of records){
  if(!r||r.org_id!==orgId)throw Error('replay_org_mismatch');
  const reject=reason=>excluded.push({id:r.id??null,reason});
  // created_at survives idempotent re-ingestion. observed_at is the economic/event
  // date; ingested_at is refreshed on replay. Neither proves earlier availability.
  const known=timestamp(r.created_at);
  if(!r.id||!r.connector_id||!r.external_id||known===null){reject('missing_identity_or_first_seen');continue;}
  if(r.status!=='accepted'){reject('current_governance_exclusion');continue;}
  if(!policy(r.license_policy)||!policy(r.retention_policy)){reject('missing_policy_snapshot');continue;}
  if(known>cutoff){reject('not_known_at_decision');continue;}
  const key=JSON.stringify([r.connector_id,r.external_id]),group=grouped.get(key)||[];
  group.push({r,known});grouped.set(key,group);
 }
 const observations=[];
 for(const group of grouped.values()){
  const latest=group.reduce((a,x)=>x.known>a?x.known:a,group[0].known),candidates=group.filter(x=>x.known===latest);
  const distinct=new Set(candidates.map(x=>x.r.content_hash));
  if(distinct.size!==1||!candidates[0].r.content_hash){for(const {r} of candidates)excluded.push({id:r.id,reason:'ambiguous_same_time_revision'});continue;}
  // Upsert deduplicates by payload hash: A→B→A refreshes A.ingested_at,
  // not A.created_at. No occurrence log exists in this export. If an older
  // payload was received at/after the latest distinct revision (or its receipt
  // is unknown), even an earlier cutoff cannot reconstruct intervening returns.
  const latestHash=candidates[0].r.content_hash;
  const ambiguous=group.some(({r,known})=>{
   if(r.content_hash===latestHash)return false;
   const receipt=timestamp(r.ingested_at);
   return receipt===null||receipt<known||receipt>=latest;
  });
  if(ambiguous){for(const {r} of group)excluded.push({id:r.id,reason:'unreconstructable_revision_history'});continue;}
  const {r}=candidates.sort((a,b)=>String(a.r.id).localeCompare(String(b.r.id)))[0];
  observations.push({id:r.id,connector_id:r.connector_id,external_id:r.external_id,known_at:r.created_at,
    observed_at_current:r.observed_at,content_hash:r.content_hash,payload:r.payload,source_ref_current:r.source_ref,
    license_policy:r.license_policy,retention_policy:r.retention_policy});
 }
 observations.sort((a,b)=>JSON.stringify([a.connector_id,a.external_id]).localeCompare(JSON.stringify([b.connector_id,b.external_id])));
 return {schema:'market-as-of/v1',org_id:orgId,decision_at:isoMicroseconds(cutoff),observations,excluded,
   coverage:'provided_records_only',publication_time_claimed:false,
   limitations:['Deduplicated payload receipts are not revision occurrences; overlapping or unknown older receipts exclude the entire eligible series','Timestamps are compared at microsecond precision; unsupported timestamp forms are rejected','First seen in this system, not an asserted public release timestamp','Current governance exclusions apply; historical status changes are not reconstructed','Source references and observed dates can change on replay; current metadata is not asserted to have been known at the decision time','Input may omit securities, delistings or revisions; this is not a survivorship-free backtest','Policy snapshots are preserved, not a new permission to use or redistribute data']};
}
export async function replayFile(path,orgId,at){
 const handle=await open(path,'r');let data;
 try{const buffer=Buffer.alloc(2*1024*1024+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
  if(bytesRead>2*1024*1024)throw Error('replay_file_too_large');data=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
 }finally{await handle.close();}
 return observationsAsOf(data,{orgId,at});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [file,orgId,at,...extra]=process.argv.slice(2);
 if(!file||!orgId||!at||extra.length){console.error('Usage: node core/src/market/as-of.mjs AUTHORIZED_RECORDS.json ORG_ID DECISION_TIME_WITH_ZONE');process.exitCode=1;}
 else try{console.log(JSON.stringify(await replayFile(file,orgId,at),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
