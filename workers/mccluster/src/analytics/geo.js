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
    if (!country || !region) continue;
    const key=country+' / '+region;
    const g=groups.get(key)||{region:key,visits:0,latSum:0,lonSum:0};
    g.visits++;g.latSum+=lat;g.lonSum+=lon;groups.set(key,g);
  }
  const cells=[...groups.values()].filter(g=>g.visits>=MIN_COHORT)
    .sort((a,b)=>b.visits-a.visits).slice(0,500)
    .map(g=>({region:g.region,visits:g.visits,
      // Centroid snapped to 0.5 degree grid: do not emit raw coordinates.
      lat:Math.round(g.latSum/g.visits*2)/2,lon:Math.round(g.lonSum/g.visits*2)/2}));
  return {schema:'mccluster.geo-aggregate.v1',granularity,asOf,cells,
    sample_limited:rows.length===MAX_ROWS,
    disclaimer:'Sampled first-party geographic observations. Regional approximations, not device locations.'};
}
export async function ownerGeoResponse({url,env,user,requireHouseOwner,sbRows,json}) {
  await requireHouseOwner(env,user);
  const granularity=url.searchParams.get('granularity')||'day';
  if (!['day','week','month'].includes(granularity)) return json({error:'Invalid granularity'},400);
  const days={day:1,week:7,month:30}[granularity];
  const now=new Date(),since=new Date(now.getTime()-days*86400000).toISOString();
  const path='events?site_id=is.null&at=gte.'+encodeURIComponent(since)+
    '&name=in.(page_view,pageview)&select=latitude,longitude,country,region&order=at.desc&limit='+MAX_ROWS;
  const rows=await sbRows(env,path);
  return json(aggregateGeoEvents(rows,granularity,now.toISOString()));
}
