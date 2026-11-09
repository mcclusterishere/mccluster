// Account-scoped outbox for finished cloud runs whose practice result the server has not yet
// accepted. It is deliberately separate from the per-location gameplay session keys so that a
// local restart, apply, load or new cloud start can never erase an outstanding receipt (W2).
// Entries are immutable once written; they leave only through an accepted server receipt
// (settleResult) or an explicit, confirmed user discard (discardResult).
export const RESULT_OUTBOX_PREFIX='here.city-arcade.result-outbox.v1:';
export const START_INTENT_PREFIX='here.city-arcade.start-intent.v1:';
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_ENTRIES=10;
export function accountScope(){
  try{const s=JSON.parse(localStorage.getItem('mccdb_session')||'null');const id=s?.user?.id||s?.user_id||s?.id;return typeof id==='string'&&id?id:'device';}catch{return 'device';}
}
export function outboxKey(scope){return RESULT_OUTBOX_PREFIX+scope;}
function validEntry(e){
  return !!e&&typeof e==='object'&&typeof e.id==='string'&&UUID.test(e.id)&&typeof e.game==='string'&&typeof e.locationId==='string'
    &&e.body&&typeof e.body==='object'&&['won','failed'].includes(e.body.status)&&Number.isInteger(e.body.served)&&e.body.served>=0&&e.body.served<=12
    &&(e.body.encounters===undefined||(Array.isArray(e.body.encounters)&&e.body.encounters.length<=3&&e.body.encounters.every(id=>typeof id==='string')));
}
export function readOutbox(scope=accountScope()){
  try{const list=JSON.parse(localStorage.getItem(outboxKey(scope))||'[]');return Array.isArray(list)?list.filter(validEntry):[];}catch{return [];}
}
function write(scope,list){try{if(list.length)localStorage.setItem(outboxKey(scope),JSON.stringify(list.slice(-MAX_ENTRIES)));else localStorage.removeItem(outboxKey(scope));}catch{}}
// Idempotent: the same run id is stored once; a different body for the same id is refused so a
// receipt can never be rewritten after the fact.
export function enqueueResult(scope,entry){
  if(!validEntry(entry))return false;
  const list=readOutbox(scope),existing=list.find(e=>e.id===entry.id);
  if(existing)return JSON.stringify(existing.body)===JSON.stringify(entry.body);
  list.push({id:entry.id,game:entry.game,locationId:entry.locationId,body:JSON.parse(JSON.stringify(entry.body)),createdAt:new Date().toISOString()});
  write(scope,list);return true;
}
export function settleResult(scope,id){write(scope,readOutbox(scope).filter(e=>e.id!==id));}
export function discardResult(scope,id){settleResult(scope,id);}
export function pendingFor(scope,game,locationId){return readOutbox(scope).filter(e=>e.game===game&&e.locationId===locationId);}
// Start intent: the owner-bound idempotency key is persisted BEFORE the start request leaves the
// device, so an uncertain start (lost response, reload) is retried with the same key and the
// server returns the same frozen run instead of creating a second one (W3).
export function startIntentKey(scope,cloudId){return START_INTENT_PREFIX+scope+':'+cloudId;}
export function readStartIntent(scope,cloudId){
  try{const i=JSON.parse(localStorage.getItem(startIntentKey(scope,cloudId))||'null');return i&&UUID.test(i.startKey||'')&&Number.isInteger(i.revision)?i:null;}catch{return null;}
}
export function claimStartIntent(scope,cloudId,revision){
  const existing=readStartIntent(scope,cloudId);
  if(existing&&existing.revision===revision)return existing;
  const intent={startKey:crypto.randomUUID(),revision,createdAt:new Date().toISOString()};
  try{localStorage.setItem(startIntentKey(scope,cloudId),JSON.stringify(intent));}catch{}
  return intent;
}
export function clearStartIntent(scope,cloudId){try{localStorage.removeItem(startIntentKey(scope,cloudId));}catch{}}
