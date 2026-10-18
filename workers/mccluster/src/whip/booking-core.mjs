// Whip Equipped LLC — bounded, operator-controlled booking primitives.
// All monetary amounts come from verified road geometry and server policy.
const encoder=new TextEncoder();
export const RIDES_MESSAGE='Whip Equipped ride booking is not live yet. Driver applications and profiles remain available.';
export function activeBindings(env={}) {
  const needed=['WHIP_RIDES_LIVE','WHIP_LLC_TNC_REGISTRATION_CONFIRMED','WHIP_LLC_INSURANCE_CONFIRMED',
    'WHIP_DRIVER_APPROVAL_GATE_ENABLED','WHIP_COMMERCIAL_ROUTING_ACTIVE','WHIP_BOOKING_SCHEMA_READY'];
  const missing=needed.filter(k=>env[k]!=='true');
  for(const key of ['WHIP_TOMTOM_API_KEY','WHIP_QUOTE_SIGNING_KEY','STRIPE_SECRET_KEY','STRIPE_PUBLISHABLE_KEY','STRIPE_WEBHOOK_SECRET'])
    if(!env[key])missing.push(key);
  return {live:missing.length===0,missing};
}
export function validPoint(point) {
  if(!Array.isArray(point)||point.length!==2||point.some(n=>typeof n!=='number'||!Number.isFinite(n))
    ||Math.abs(point[0])>180||Math.abs(point[1])>90)throw new TypeError('Select a specific point from both map results.');
  return [point[0],point[1]];
}
export function validLabel(value) {
  const label=String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  if(label.length<3||label.length>200)throw new TypeError('Use a specific pickup and destination address.');
  return label;
}
function integer(n,low,high,why) {
  if(!Number.isSafeInteger(n)||n<low||n>high)throw new RangeError(why);
  return n;
}
export function quoteFare(meters,seconds,rates) {
  integer(meters,100,500000,'The route distance is not within the service area.');
  integer(seconds,20,120000,'The route duration is not usable.');
  const base=integer(rates.baseCents,1,50000,'Operator fare policy is unavailable.');
  const mile=integer(rates.mileCents,1,50000,'Operator fare policy is unavailable.');
  const minute=integer(rates.minuteCents,0,3000,'Operator fare policy is unavailable.');
  const minimum=integer(rates.minimumCents,100,100000,'Operator fare policy is unavailable.');
  const price=Math.max(minimum,base+Math.ceil(meters*mile/1609.344)+Math.ceil(seconds*minute/60));
  return integer(price,100,1000000,'The quoted fare exceeds the supported maximum.');
}
export function serverRates(env) {
  return {
    baseCents:Number(env.WHIP_BASE_FARE_CENTS),mileCents:Number(env.WHIP_PER_MILE_CENTS),
    minuteCents:Number(env.WHIP_PER_MINUTE_CENTS),minimumCents:Number(env.WHIP_MINIMUM_FARE_CENTS)
  };
}
export async function commercialRoute(origin,destination,apiKey,request=fetch) {
  validPoint(origin);validPoint(destination);
  if(!apiKey)throw new Error('Commercial routing is not configured.');
  const places=[origin,destination].map(p=>[p[1],p[0]].map(v=>v.toFixed(6)).join(',')).join(':');
  const url=new URL('https://api.tomtom.com/routing/1/calculateRoute/'+places+'/json');
  url.searchParams.set('key',apiKey);url.searchParams.set('travelMode','car');url.searchParams.set('traffic','true');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  let response;
  try{response=await request(url.toString(),{headers:{accept:'application/json'},signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer'});}
  finally{clearTimeout(timer);}
  if(!response?.ok)throw new Error('Commercial directions are unavailable.');
  const body=await response.json();
  const route=body?.routes?.[0],summary=route?.summary;
  const distance=Number(summary?.lengthInMeters),duration=Number(summary?.travelTimeInSeconds);
  if(!Number.isSafeInteger(distance)||!Number.isSafeInteger(duration)||distance<100||duration<20)
    throw new Error('The routing provider could not return a valid road estimate.');
  return {distanceMeters:distance,durationSeconds:duration,provider:'tomtom-commercial'};
}
const encode=object=>btoa(String.fromCharCode(...encoder.encode(JSON.stringify(object)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
function decode(token) {
  if(!/^[A-Za-z0-9_-]{1,2600}$/.test(token))throw new TypeError('The ride quote is invalid.');
  const base=token.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=Uint8Array.from(atob(base.padEnd(Math.ceil(base.length/4)*4,'=')),ch=>ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function macKey(secret) {
  if(typeof secret!=='string'||secret.length<32)throw new TypeError('The booking signing key has not been configured safely.');
  return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function signQuote(payload,secret) {
  const body=encode(payload),key=await macKey(secret);
  const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(body));
  return body+'.'+btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
export async function verifyQuote(token,secret,subject,now=Date.now()) {
  if(typeof token!=='string'||token.length>3500)throw new TypeError('Ride quote invalid.');
  const [body,signature,...tail]=token.split('.');
  if(tail.length||!body||!signature||!/^[A-Za-z0-9_-]{43}$/.test(signature))
    throw new TypeError('Ride quote invalid.');
  const key=await macKey(secret);
  const sig=Uint8Array.from(atob(signature.replace(/-/g,'+').replace(/_/g,'/').padEnd(44,'=')),c=>c.charCodeAt(0));
  if(!(await crypto.subtle.verify('HMAC',key,sig,encoder.encode(body))))throw new TypeError('Ride quote signature invalid.');
  const p=decode(body);
  if(p.v!==1||p.sub!==subject||p.tier!=='WE Standard'||p.currency!=='usd' ||
    !Number.isSafeInteger(p.expires)||p.expires<=now||p.expires>now+180000 ||
    !/^[0-9a-f-]{36}$/.test(p.tenant||'')||!/^[a-zA-Z0-9_-]{8,80}$/.test(p.nonce||''))
    throw new TypeError('Ride quote expired or issued for another account.');
  validPoint(p.origin);validPoint(p.destination);validLabel(p.pickupLabel);validLabel(p.dropoffLabel);
  integer(p.fareCents,100,1000000,'Ride quote fare invalid.');
  integer(p.platformFeeCents,0,p.fareCents,'Ride quote fee invalid.');
  return p;
}
export function approvedDriver(driver,now=Date.now()) {
  if(!driver||driver.approval_status!=='approved'||driver.compliance_verified!==true)return false;
  for(const field of ['license_expires_at','insurance_expires_at','screening_expires_at']) {
    const expires=Date.parse(driver[field]||'');
    if(!Number.isFinite(expires)||expires<=now)return false;
  }
  return true;
}
export function keyForBooking(value) {
  const k=String(value||'').trim();
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(k))throw new TypeError('A valid idempotency key is required.');
  return k;
}