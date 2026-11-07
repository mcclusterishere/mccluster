/* Reviewed inputs -> deterministic non-canon side-operation recipe. No network,
   model text, live Ops data, learner profile, credentials or publication authority. */
export const SCHEMA = 'prim3.generated-input/v1';
export const VERSION = 'prim3.generated-recipe/v1';
export const DAY = 86_400_000;
export const OBJECTIVES = Object.freeze({
  restore: { title: 'Restore the training network', role: 'T', steps: ['Inspect', 'Restore', 'Verify'] },
  survey: { title: 'Survey the safe route', role: 'R', steps: ['Observe', 'Corroborate'] },
  recover: { title: 'Recover training supplies', role: 'E', steps: ['Secure'] }
});
export const TERRAINS = Object.freeze(['urban', 'coastal', 'woodland']);
const THEMES = ['power', 'comms', 'data', 'logistics', 'water', 'transport', 'finance', 'industrial'];
const copy = value => JSON.parse(JSON.stringify(value));
function text(value, name, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f<>]/.test(value)) throw new Error(`A valid ${name} is required.`);
  return value.trim();
}
function url(value) {
  const u = new URL(text(value, 'public source URL', 2048));
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) throw new Error('Use a public HTTPS source URL.');
  u.hash = ''; return u.href;
}
export function normalizeInput(value, now = Date.now(), {allowExpired=false} = {}) {
  if (!value || value.schema !== SCHEMA) throw new Error('Unknown generated mission input version.');
  if (!Number.isFinite(now)) throw new Error('A valid review time is required.');
  if (!Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) throw new Error('Seed must be an integer from 0 to 4294967295.');
  if (!Object.hasOwn(OBJECTIVES, value.objective)) throw new Error('Choose restore, survey or recover.');
  const g = value.geography;
  if (!g || !/^[A-Z]{2}$/.test(g.country || '') || !Number.isFinite(g.lat) || Math.abs(g.lat) > 80 || !Number.isFinite(g.lon) || Math.abs(g.lon) > 180) throw new Error('Review a country and finite coordinates (latitude within 80 degrees).');
  if (!TERRAINS.includes(g.terrain)) throw new Error('Choose a supported terrain.');
  if (value.review?.fiction !== true || value.review?.geography !== true) throw new Error('Review the fiction and geography before generating.');
  // Do not silently drop authoritative civic geometry and replace it with invented buildings.
  if (g.buildings?.length || g.civicExclusions?.length) throw new Error('Real building footprints need the reviewed City geometry adapter; this regional generator cannot reconstruct or relocate them.');
  let source = null;
  if (value.source != null) {
    const s = value.source, at = Date.parse(s.publishedAt);
    if (s.kind !== 'reviewed-public-news' || value.review?.source !== true || !Number.isFinite(at) || at > now || (!allowExpired && now >= at + DAY)) throw new Error('News needs an explicit source review and a publication time within the last 24 hours.');
    if (s.country !== g.country) throw new Error('The reviewed event country must match the geography, not the publisher country.');
    if (!THEMES.includes(s.theme)) throw new Error('Choose a supported news theme.');
    source = { kind: s.kind, eventId: text(s.eventId, 'source event ID'), url: url(s.url), publisher: text(s.publisher, 'publisher'), publishedAt: new Date(at).toISOString(), country: s.country, theme: s.theme, reviewId: text(s.reviewId, 'source review ID') };
  }
  return { schema: SCHEMA, seed: value.seed, objective: value.objective,
    geography: { country: g.country, place: text(g.place, 'regional place label'), lat: g.lat, lon: g.lon, terrain: g.terrain, sourceUrl: url(g.sourceUrl), reviewId: text(g.reviewId, 'geography review ID') },
    source, review: { fiction: true, geography: true, ...(source ? { source: true } : {}) } };
}
// Content identity, not an authorization token or anti-cheat signature.
function hash(value) { let h = 2166136261; for (const c of value) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
export function recipeId(input) { const raw = JSON.stringify(input); return `generated-${hash(raw)}${hash([...raw].reverse().join(''))}`; }
function random(seed) { let n = seed >>> 0; return () => { n = (Math.imul(1664525, n) + 1013904223) >>> 0; return n / 4294967296; }; }

export function compileRecipe(value, now = Date.now(), options = {}) {
  const input = normalizeInput(value, now, options), id = recipeId(input), g = input.geography;
  // News changes the layout stream, not just its title; geography and objective do too.
  const layoutInput = {seed:input.seed,objective:input.objective,country:g.country,lat:g.lat,lon:g.lon,terrain:g.terrain,
    source:input.source ? {eventId:input.source.eventId,url:input.source.url,theme:input.source.theme} : null};
  const rand = random(parseInt(hash(JSON.stringify(layoutInput)), 16));
  const objects = [], connections = [];
  const put = (assetId, x, y, extra = {}) => objects.push({ id: `prop-${objects.length}`, assetId, x, y, rotation: 0, elevation: 0, scale: 1, ...extra });
  const jitter = () => Math.floor(rand() * 5) - 2;
  // Wide north/south and east/west lanes keep the objective and escape routes open.
  // All geometry is synthetic, never claimed as actual roads or building footprints.
  const lots = [[-48,-36],[-32,18],[26,-36],[26,18]];
  for (const [x0,y0] of lots) {
    const x = x0 + jitter(), y = y0 + jitter();
    if (g.terrain === 'woodland') {
      put('tree-8',x,y); put('tree-8',x+8,y+8); put('rock-cluster',x+4,y+4);
    } else {
      put('warehouse-16',x,y);
      put('stairs-8',x+6,y-8);
    }
  }
  if (g.terrain === 'coastal') {
    for (let y=-48;y<48;y+=8) put('water-tile-16',48,y);
    put('bridge-16',48,-4);
    for (let y=-32;y<=32;y+=16) put('container-12',-58,y);
  } else if (g.terrain === 'urban') {
    for (const x of [-52,44]) for (const y of [-12,6]) {
      put('tower-8',x,y);
      connections.push({id:`tower-access-${x}-${y}`,type:'stairs',from:{x:x-4,y:y+4,layer:0},to:{x:x+4,y:y+4,layer:1},cost:20});
    }
  } else {
    put('warehouse-16',-48,36); put('stairs-8',-42,28);
  }
  for (let i=0;i<12;i++) {
    const x = (i%2 ? 1 : -1)*(12+Math.floor(rand()*5));
    const y = -36+Math.floor(i/2)*12+jitter();
    put(i%3 ? 'low-barrier-4' : 'crate-2',x,y);
  }
  const settings = OBJECTIVES[input.objective];
  const points = input.objective === 'restore' ? [[0,0]] : input.objective === 'survey' ? [[0,0],[0,36]] : [[-24,0],[24,0]];
  const objectives = points.map(([x,y],i) => ({ id: `CHECKPOINT-${i+1}`, label: `${input.objective === 'restore' ? 'Network' : input.objective === 'survey' ? 'Survey point' : 'Supply cache'} ${i+1}`, x,y,role:settings.role,steps:[...settings.steps] }));
  const doc = { schemaVersion: 1, objective: {type:'relay',x:0,y:0}, metadata: {theme:'white-industrial',description:'Synthetic regional practice',tags:[]}, id, title: `${settings.title} · ${g.place}`, bounds: { minX:-64,maxX:63,minY:-64,maxY:63 }, objects,
    spawns: [{id:'E',role:'E',team:'player',x:-4,y:-48,layer:0},{id:'R',role:'R',team:'player',x:0,y:-48,layer:0},{id:'T',role:'T',team:'player',x:4,y:-48,layer:0},
      // Fictional training opponents. No real people, organizations or country as enemies.
      {id:'SIM-1',role:'guard',team:'enemy',x:-10,y:40,layer:0},{id:'SIM-2',role:'guard',team:'enemy',x:10,y:40,layer:0}],
    extraction: {x:0,y:-56,radius:8}, connections };
  return { schema:VERSION,id,input:copy(input),document:doc,objectives,
    title:settings.title,fictional:true,sideOperation:true,publicationAuthorized:false,
    geography: {...copy(g), mapping:'regional-reference-only', exactSiteReconstruction:false},
    attribution: input.source ? copy(input.source) : null,
    expiresAt: input.source ? Date.parse(input.source.publishedAt)+DAY : null,
    disclaimer:'Fictional training scenario in a synthetic layout. The regional coordinates and cited sources do not establish real incidents, adversaries, building interiors or tactical conditions.' };
}

/** Map a local east/north offset to a broad geospatial reference, not a survey. */
export function regionalCoordinate(geography, eastM, northM) {
  if (![eastM,northM].every(Number.isFinite) || Math.max(Math.abs(eastM),Math.abs(northM))>128) throw new Error('Offset exceeds this regional map.');
  const lat=geography.lat+northM/111320;
  const lon=((geography.lon+eastM/(111320*Math.cos(geography.lat*Math.PI/180))+540)%360)-180;
  return {lat,lon};
}
