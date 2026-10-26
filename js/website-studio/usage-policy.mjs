/** Money is integer micro-USD. Keep the existing 1,000 credits/USD unit.
 * This quotes usage; it does not mint credits or mutate the canonical ledger.
 */
const integer = (x, name) => {
  if (typeof x === 'number' && !Number.isSafeInteger(x)) throw new TypeError(name);
  if (!/^[0-9]{1,30}$/.test(String(x))) throw new TypeError(name);
  return BigInt(x);
};
export const ceilDiv = (a,b) => { if(a<0n||b<=0n)throw new TypeError('nonnegative quotient required'); return (a+b-1n)/b; };
export function quoteCredits({components, margin_bps=2500, collection_bps=0, rate_version}) {
  if (!Array.isArray(components)||!components.length||components.length>20||typeof rate_version!=='string'||!/^[A-Za-z0-9._:-]{1,80}$/.test(rate_version)) throw new TypeError('priced components required');
  const margin=integer(margin_bps,'margin'), fees=integer(collection_bps,'fees');
  if (margin+fees>=10000n) throw new TypeError('margin plus collection fees must be below 100%');
  let num=0n, den=1n;
  for(const c of components){
    const n=integer(c.unit_microusd,'price')*integer(c.quantity_numerator,'quantity');
    const d=integer(c.quantity_denominator??1,'denominator'); if(!d)throw new TypeError('zero denominator');
    num=num*d+n*den;den*=d;
  }
  // Round once after aggregation, never once per heartbeat/frame.
  const cogs=ceilDiv(num,den);
  const retail=ceilDiv(cogs*10000n,10000n-margin-fees);
  const credits=ceilDiv(retail,1000n);
  return {rate_version,cogs_microusd:cogs.toString(),retail_microusd:retail.toString(),credits:credits.toString(),credits_per_usd:1000};
}
export function deliveryBytes({viewer_seconds,bitrate_bps,overhead_bps=2000}){
  return ceilDiv(integer(viewer_seconds,'viewer seconds')*integer(bitrate_bps,'bitrate')*(10000n+integer(overhead_bps,'overhead')),80000n);
}
export function compareLive({host_minutes,viewer_minutes,bitrate_bps=2000000,sfu_allowance_bytes=0,mux_free_delivery_minutes=0}){
  const host=integer(host_minutes,'host minutes'),view=integer(viewer_minutes,'viewer minutes');
  const bytes=deliveryBytes({viewer_seconds:view*60n,bitrate_bps});
  const free=integer(sfu_allowance_bytes,'allowance');
  const muxFree=integer(mux_free_delivery_minutes,'mux allowance');
  return {cloudflare_stream_microusd:(view*1000n).toString(),
    cloudflare_sfu_microusd:ceilDiv((bytes>free?bytes-free:0n)*50000n,1000000000n).toString(),
    mux_live_720p_microusd:(host*25000n+(view>muxFree?view-muxFree:0n)*800n).toString(),estimated_sfu_bytes:bytes.toString(),
    exclusions:'Storage, orchestration, subscriptions, actual codec bitrate, promotions and taxes excluded. Not a provider invoice.'};
}
export function liveAdmission({used_host_seconds,reserved_host_seconds=0,used_starts,reserved_starts=0,remaining_viewer_seconds,active_sessions=0},policy,requested_seconds){
  for(const k of ['concurrent_host_sessions','weekly_starts','session_seconds','weekly_host_seconds','concurrent_viewers'])if(!Number.isSafeInteger(policy?.[k])||policy[k]<1)throw new TypeError('invalid policy');
  for(const n of [used_host_seconds,reserved_host_seconds,used_starts,reserved_starts,remaining_viewer_seconds,active_sessions,requested_seconds])if(!Number.isSafeInteger(n)||n<0)throw new TypeError('invalid usage');
  if(active_sessions>=policy.concurrent_host_sessions)return {allowed:false,reason:'already_live'};
  if(used_starts+reserved_starts>=policy.weekly_starts)return {allowed:false,reason:'weekly_start_limit'};
  const seconds=Math.min(requested_seconds,policy.session_seconds,policy.weekly_host_seconds-used_host_seconds-reserved_host_seconds);
  if(seconds<60||remaining_viewer_seconds<60)return {allowed:false,reason:'allowance_exhausted'};
  return {allowed:true,host_seconds:seconds,max_viewers:policy.concurrent_viewers,viewer_seconds:Math.min(remaining_viewer_seconds,seconds*policy.concurrent_viewers),recording:policy.recording};
}
/** These rows MUST come from verified backend run evidence, not browser reports.
 * Stopping a paid stream is not completing a mission. Censored runs are retained
 * for diagnosis but excluded; too much censoring prevents a misleading estimate.
 */
export function missionTiming(rows,{mission_type,definition_version,min_samples=100,min_people=20,max_per_person=5,current_estimate_seconds=null}={}){
  if(!Array.isArray(rows)||rows.length>100000||typeof mission_type!=='string'||!mission_type||definition_version==null||![min_samples,min_people,max_per_person].every(x=>Number.isSafeInteger(x)&&x>0)||min_samples<100||current_estimate_seconds!==null&&(!Number.isSafeInteger(current_estimate_seconds)||current_estimate_seconds<1))throw new TypeError('invalid timing evidence configuration');
  const candidates=rows.filter(r=>r.mission_type===mission_type&&r.definition_version===definition_version&&r.verified===true);
  const seen=new Set(),people=new Map(),values=[];let censored=0;
  for(const r of [...candidates].sort((a,b)=>String(b.completed_at).localeCompare(String(a.completed_at)))){
    if(!r.run_id||!r.person_id||seen.has(r.run_id))continue;seen.add(r.run_id);
    if(r.censored===true){censored++;continue;}
    if(r.duration_basis!=='active_work'||!Number.isSafeInteger(r.active_seconds)||r.active_seconds<1||r.active_seconds>2592000)continue;
    const count=people.get(r.person_id)||0;if(count>=max_per_person)continue;
    people.set(r.person_id,count+1);values.push(r.active_seconds);
  }
  const base={sample_count:values.length,distinct_people:people.size,censored_count:censored,definition_version,mission_type};
  if(values.length<min_samples||people.size<min_people||censored>seen.size*.1)return {...base,status:'insufficient_evidence',estimate_seconds:null};
  values.sort((a,b)=>a-b);const q=p=>values[Math.min(values.length-1,Math.ceil(p*values.length)-1)];
  const trimmed=values.slice(Math.floor(values.length*.1),Math.ceil(values.length*.9));
  const raw=q(.5), estimate=current_estimate_seconds?Math.round(Math.max(current_estimate_seconds*.8,Math.min(current_estimate_seconds*1.2,raw))):raw;
  return {...base,status:'proposal_requires_review',median_seconds:raw,p25_seconds:q(.25),p75_seconds:q(.75),p90_seconds:q(.9),trimmed_mean_seconds:Math.round(trimmed.reduce((a,b)=>a+b,0)/trimmed.length),estimate_seconds:estimate};
}
