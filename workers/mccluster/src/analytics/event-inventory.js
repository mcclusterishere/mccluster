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
// One organization-scoped SQL read returns complete account and provider
// counts. A missing/cancelled read is unknown, never an exact zero.
export function socialCoverage(source) {
  const posts=int(source?.instagram_posts);
  const snapshots=int(source?.verified_insight_snapshots);
  const accounts=int(source?.instagram_accounts);
  const connected=int(source?.connected_accounts);
  const expired=source?.authorization_expired;
  const complete=posts!==null&&snapshots!==null&&accounts!==null&&
    connected!==null&&connected<=accounts&&typeof expired==='boolean';
  const authRequired=complete?expired:null;
  return {instagram:{
    account_count:complete?accounts:null,
    connected_accounts:complete?connected:null,
    imported_posts:complete?posts:null,
    metric_snapshots:complete?snapshots:null,
    provider_observation:'not_measured',
    reauthorization_required:authRequired,
    error_codes:authRequired===true?['meta_error_190']:[],
    status:!complete?'unavailable':expired?'reauthorization_required':
      snapshots===0?'no_verified_provider_metrics':'provider_records_present',
    next_step:!complete?'Check provider measurement availability, then retry.':
      expired?'Reconnect Instagram in Control → Create → Channels, then run verified media discovery.':
      snapshots===0?'No verified Instagram insight snapshots; verify connection and discovery.':
      'Provider API records are present; do not infer impression or reach totals from record counts.'
  }};
}
