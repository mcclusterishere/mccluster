// Owner-only, bounded, sampled regional geography. Never return visitor-level coordinates.
const MAX_ROWS = 10000;
const MIN_COHORT = 5;
export function aggregateGeoEvents(rows, granularity, asOf) {
  if (!['day','week','month'].includes(granularity)) throw new TypeError('Invalid granularity');
  const groups = new Map();
  for (const e of rows) {
    const lat=Number(e.latitude), lon=Number(e.longitude);
    if (e.latitude==null || e.longitude==null || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat)>90 || Math.abs(lon)>180) continue;
    const country=String(e.country||'').trim().slice(0,60);
    const region=String(e.region||'').trim().slice(0,60);
    if (!country) continue;
    const key=region ? country+' / '+region : country;
    const session=typeof e.session_id==='string'?e.session_id.trim():'';
    if(!session)continue;
    const g=groups.get(key)||{region:key,visits:0,latSum:0,lonSum:0,sessions:new Set()};
    g.visits++;g.latSum+=lat;g.lonSum+=lon;g.sessions.add(session);groups.set(key,g);
  }
  const cells=[...groups.values()].filter(g=>g.sessions.size>=MIN_COHORT)
    .sort((a,b)=>b.visits-a.visits).slice(0,500)
    .map(g=>({region:g.region,visits:g.visits,
      // Never derive a plotted point from a small group of visitors.
      // A 10-degree grid is intentionally approximate, not a device location.
      lat:Math.round(g.latSum/g.visits/10)*10,lon:Math.round(g.lonSum/g.visits/10)*10}));
  return {schema:'mccluster.geo-aggregate.v1',granularity,asOf,cells,
    sample_limited:rows.length>=MAX_ROWS,
    disclaimer:'Sampled first-party geographic observations. Only regions with at least five distinct observed sessions are shown; sessions are not unique people. Regional approximations, not device locations.'};
}
export async function ownerGeoResponse({url,env,user,requireHouseOwner,sbRowsPaged,json}) {
  await requireHouseOwner(env,user);
  const granularity=url.searchParams.get('granularity')||'day';
  if (!['day','week','month'].includes(granularity)) return json({error:'Invalid granularity'},400);
  const days={day:1,week:7,month:30}[granularity];
  const now=new Date(),since=new Date(now.getTime()-days*86400000).toISOString();
  const path='events?site_id=is.null&at=gte.'+encodeURIComponent(since)+
    '&name=in.(page_view,pageview)&select=latitude,longitude,country,region,session_id&order=at.desc';
  const rows=await sbRowsPaged(env,path,MAX_ROWS);
  return json(aggregateGeoEvents(rows,granularity,now.toISOString()));
}
