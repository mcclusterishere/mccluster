/* Owner Analytics coverage from canonical raw and lean event names.
 * Historical mismatch, taxonomy omission and provider absence remain visible.
 * No inferred metrics, cross-site identity, or false provider success. */
const int=value=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
};
export function cleanInventory(rows) {
  if(!Array.isArray(rows)||rows.length>1000)throw Error('Inventory is unavailable or too large');
  const items=rows.map(row=>{
    const name=String(row?.event_name||'').slice(0,120);
    if(!name)throw Error('Missing event-name inventory key');
    const total=int(row.raw_total),lean=int(row.lean_total),bots=int(row.bot_rows);
    if(total===null||lean===null||bots===null)throw Error('Invalid event-name counts');
    const stage=typeof row.taxonomy_stage==='string'?row.taxonomy_stage:null;
    return {name,raw_total:total,lean_total:lean,bot_rows:bots,
      recent_24h:int(row.recent_24h),recent_7d:int(row.recent_7d),
      first_seen_at:row.first_seen_at||null,last_seen_at:row.last_seen_at||null,
      taxonomy_stage:stage,classification:stage?'classified':'unclassified',
      taxonomy_note:typeof row.taxonomy_note==='string'?row.taxonomy_note.slice(0,240):null,
      projection_match:total===lean};
  });
  return {schema:'analytics-event-inventory/v1',scope:'first_party',unit:'stored_event_rows',
    snapshot:'live_read_not_frozen',rows:items,
    summary:{names:items.length,unclassified_names:items.filter(r=>!r.taxonomy_stage).length,
      unclassified_events:items.filter(r=>!r.taxonomy_stage).reduce((n,r)=>n+r.raw_total,0),
      mismatched_names:items.filter(r=>!r.projection_match).length}};
}
const validError=v=>/^meta_error_[0-9]{3}$/.test(String(v||''))?String(v):null;
export function socialCoverage(accounts,postCount,snapshotCount){
  if(!Array.isArray(accounts))throw Error('Social source inventory unavailable');
  const instagram=accounts.filter(a=>a?.platform==='instagram');
  const errors=instagram.map(a=>validError(a.media_discovery_error)).filter(Boolean);
  const connected=instagram.filter(a=>a.status==='connected').length;
  const posts=int(postCount),snapshots=int(snapshotCount);
  return {instagram:{
    account_count:instagram.length,connected_accounts:connected,
    imported_posts:posts,metric_snapshots:snapshots,
    provider_observation:'not_measured',
    reauthorization_required:errors.includes('meta_error_190'),
    error_codes:[...new Set(errors)],
    status:errors.includes('meta_error_190')?'reauthorization_required'
      :posts===null||snapshots===null?'unavailable'
      :snapshots===0?'no_verified_provider_metrics':'provider_records_present',
    next_step:errors.includes('meta_error_190')?'Reconnect Instagram in Control → Create → Channels, then run verified media discovery.'
      :'Connect and verify a provider account before claiming reach.'
  }};
}
