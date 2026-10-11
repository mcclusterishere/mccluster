/* Pure scoring utilities; do not infer identities from devices or IP addresses. */
export function engagementScore(events, now = Date.now()) {
  const recent = events.filter(e => {
    const at=Date.parse(e.at||'');
    return Number.isFinite(at) && at>=now-30*86400000 && at<=now;
  });
  const sessions = new Set(recent.map(e=>e.session_id).filter(Boolean));
  const meaningful = recent.filter(e=>!['page_view','heartbeat'].includes(e.name));
  return {value:Math.min(100,meaningful.length*4+sessions.size*3),
    events:recent.length,sessions:sessions.size,meaningful:meaningful.length};
}
export function validateUserPage(url) {
  const limit=Number(url.searchParams.get('limit')||50);
  const page=Number(url.searchParams.get('page')||1);
  if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(page)||page<1||page>10000)
    return null;
  return {limit,page};
}
export function groupUserEvents(rows, allowedIds) {
  const out=new Map([...allowedIds].map(id=>[id,[]]));
  for(const row of rows){
    const id=String(row.uid||'');
    if(out.has(id)&&out.get(id).length<100)out.get(id).push(row);
  }
  return out;
}
