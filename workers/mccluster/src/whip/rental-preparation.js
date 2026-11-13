/* Self-drive preparation boundary. No switch in this module can launch rentals.
 * Uses the existing tenant membership and rental tables; never cab clearance. */
import app from './booking-gate.js';
import { requireOperator } from './router.js';
import { boundedJson } from '../../../../js/travel/route-core.mjs';

const VEHICLE_FIELDS = 'id,tenant_id,name,category,location_label,daily_rate_cents,available,updated_at';
const BOOKING_FIELDS = 'id,vehicle_id,status,start_at,end_at,total_cents,payment_status,updated_at';
const closed = { bookings_live:false, purchases_live:false, publishing_live:false,
  evidence_status:'unverified', blockers:['owner_consent_and_title','operating_model_and_local_authority',
    'rental_insurance','vehicle_safety_and_availability','renter_clearance_and_agreement',
    'payment_account_and_reconciliation','atomic_booking_holds'] };
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store, private'}});
const error = (message,status=400) => Object.assign(new Error(message),{status});
const id = value => typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
async function db(env,path,init={}) {
  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw error('Rental database is not connected.',503);
  const res=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...init,headers:{
    apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
    'content-type':'application/json',Prefer:'return=representation'}});
  if(!res.ok) throw error('Rental records could not be saved or loaded. Refresh before retrying a save.',503);
  const rows=await res.json();
  if(!Array.isArray(rows)) throw error('Rental records are unavailable.',503);
  return rows;
}
function fields(body,editing) {
  if(!body || typeof body!=='object' || Array.isArray(body)) throw error('A vehicle draft is required.');
  const allowed=['name','category','location_label','daily_rate_cents',...(editing?['expected_updated_at']:[])];
  if(Object.keys(body).some(k=>!allowed.includes(k))) throw error('Only preparation fields may be changed; publication and clearance are disabled.');
  const result={};
  for(const key of ['name','category','location_label']) {
    if(typeof body[key]!=='string' || !body[key].trim() || body[key].length>100 || /[\u0000-\u001f]/.test(body[key]))
      throw error('Name, category and general pickup area are required (100 characters maximum each).');
    result[key]=body[key].trim();
  }
  if(!Number.isSafeInteger(body.daily_rate_cents)||body.daily_rate_cents<1||body.daily_rate_cents>1000000)
    throw error('Planning daily rate must be an integer from 1 to 1000000 cents.');
  result.daily_rate_cents=body.daily_rate_cents;
  return result;
}
export function createRentalPreparation(next=app) {
 return {async fetch(req,env,ctx) {
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'');
  if(req.method==='OPTIONS') return next.fetch(req,env,ctx);
  if(path==='/api/rentals/readiness'&&req.method==='GET') return json(closed);
  // Never project old seeded/private inventory as approved public listings.
  if(path==='/api/rentals/vehicles'&&req.method==='GET') return json({vehicles:[],...closed});
  if((path==='/api/rentals/bookings'||path.startsWith('/api/rentals/bookings/'))&&!['GET','HEAD'].includes(req.method))
    return json({code:'rentals_in_preparation',error:'Self-drive bookings, checkout and vehicle release are closed pending launch review.',...closed},503);
  const summary=path.match(/^\/api\/operators\/([^/]+)\/rentals$/);
  const vehicles=path.match(/^\/api\/operators\/([^/]+)\/vehicles(?:\/([^/]+))?$/);
  if(!summary && !(vehicles && ['POST','PATCH'].includes(req.method))) return next.fetch(req,env,ctx);
  try {
    const tenantId=(summary||vehicles)[1];
    if(!id(tenantId)) throw error('Invalid operator.');
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) throw error('Rental database is not connected.',503);
    // Real server-validated M Account; no x-we-role, demo identity or client owner id.
    await requireOperator(req,env,tenantId,['owner','admin']);
    if(summary) {
      if(req.method!=='GET') throw error('Method not allowed.',405);
      const offset=Number(url.searchParams.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000) throw error('Invalid page.');
      const [fleet,bookings]=await Promise.all([
        db(env,'rental_vehicles?tenant_id=eq.'+encodeURIComponent(tenantId)+'&select='+VEHICLE_FIELDS+'&order=created_at.desc,id.asc&limit=51&offset='+offset),
        db(env,'rental_bookings?tenant_id=eq.'+encodeURIComponent(tenantId)+'&select='+BOOKING_FIELDS+'&order=created_at.desc,id.asc&limit=51&offset='+offset)
      ]);
      return json({source:'stored_records',...closed,vehicles:fleet.slice(0,50),bookings:bookings.slice(0,50),
        offset,next_offset:fleet.length>50||bookings.length>50?offset+50:null});
    }
    const editing=req.method==='PATCH';
    if(editing!==Boolean(vehicles[2]) || (vehicles[2]&&!id(vehicles[2]))) throw error('Invalid vehicle route.');
    let body;
    try { body=await boundedJson(req,2048); } catch(e) { throw error('A valid vehicle draft of at most 2048 bytes is required.',e instanceof RangeError?413:400); }
    const patch=fields(body,editing);
    // Every write withdraws the listing. No UI or legacy API can publish it.
    patch.available=false; patch.updated_at=new Date().toISOString();
    let rows;
    if(editing) {
      if(typeof body.expected_updated_at!=='string'||!Number.isFinite(Date.parse(body.expected_updated_at)))
        throw error('Reload the vehicle before saving; its revision is required.',409);
      rows=await db(env,'rental_vehicles?tenant_id=eq.'+encodeURIComponent(tenantId)+'&id=eq.'+encodeURIComponent(vehicles[2])+
        '&updated_at=eq.'+encodeURIComponent(body.expected_updated_at)+'&select='+VEHICLE_FIELDS,{method:'PATCH',body:JSON.stringify(patch)});
      if(!rows.length) throw error('Vehicle changed or is unavailable. Reload before editing.',409);
    } else {
      const tenant=await db(env,'tenants?id=eq.'+encodeURIComponent(tenantId)+'&select=name&limit=1');
      if(!tenant[0]) throw error('Operator not found.',404);
      rows=await db(env,'rental_vehicles?select='+VEHICLE_FIELDS,{method:'POST',body:JSON.stringify({
        ...patch,id:crypto.randomUUID(),tenant_id:tenantId,operator_name:tenant[0].name,
        rating:null,rental_count:0,seats:null,transmission:'Unknown',fuel_type:'Unknown',mileage_per_day:0})});
    }
    if(rows.length!==1) throw error('Save result is uncertain. Reload the fleet before retrying.',503);
    return json({vehicle:rows[0],source:'stored_records',...closed},editing?200:201);
  } catch(e) {
    const status=[400,401,403,404,405,409,413,503].includes(e.status)?e.status:503;
    return json({error:status===503?'Rental records are unavailable. Reload before retrying a save.':e.message},status);
  }
 }};
}
export default createRentalPreparation();
