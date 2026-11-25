// Arcade-only consumer of shared globe view observations. Owns fetch lifetime, not city rendering.
export const GAME_CODE_RESERVE=100000;
export const DEFAULT_LOADING=Object.freeze({west:-73.1921,east:-73.1885,south:41.1788,north:41.1808,maxHeight:3000,maxBytes:1500000});
export function validateLoading(x){
 if(!x||Object.keys(DEFAULT_LOADING).some(k=>!Number.isFinite(x[k])))throw Error('Invalid loading settings');
 if(x.west< -73.194||x.east> -73.183||x.south<41.1695||x.north>41.183||x.west>=x.east||x.south>=x.north||x.maxHeight<200||x.maxHeight>10000||x.maxBytes<200000||x.maxBytes>3000000)throw Error('Loading region or budget out of bounds');
 return Object.fromEntries(Object.keys(DEFAULT_LOADING).map(k=>[k,x[k]]));
}
export function withinRegion(v,c){return v&&[v.lon,v.lat,v.height].every(Number.isFinite)&&v.lon>=c.west&&v.lon<=c.east&&v.lat>=c.south&&v.lat<=c.north&&v.height<=c.maxHeight;}
export function createRegionLoader({url,fetchImpl=fetch,onState=()=>{},config=DEFAULT_LOADING}={}){
 let settings=validateLoading(config),controller=null,loaded=null,pending=null,generation=0;
 const unload=()=>{generation++;controller?.abort();controller=null;loaded=null;pending=null;onState('unloaded');};
 async function load(reason='entry'){
  if(loaded)return loaded;if(pending)return pending;
  const seq=++generation;controller=new AbortController();onState('loading');
  pending=(async()=>{try{
   const r=await fetchImpl(url,{signal:controller.signal,cache:'no-cache'});if(!r.ok)throw Error('Shared city data unavailable');
   const reader=r.body.getReader(),chunks=[];let bytes=0;
   for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>settings.maxBytes-GAME_CODE_RESERVE){await reader.cancel();throw Error('City data exceeds your byte budget');}chunks.push(value);}
   const all=new Uint8Array(bytes);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
   const data=JSON.parse(new TextDecoder().decode(all)),n=data.neighborhoods?.find(n=>n.id==='bridgeport-robbery-1s');if(!n)throw Error('Shared neighborhood unavailable');
   if(seq!==generation)throw new DOMException('Load cancelled','AbortError');loaded=n;onState('loaded',{bytes,reason});return n;
  }catch(e){if(seq===generation)onState(e.name==='AbortError'?'unloaded':'error',{message:e.message});throw e;}finally{if(seq===generation){pending=null;controller=null;}}})();return pending;
 }
 return {load,unload,get loaded(){return loaded;},setConfig(c){settings=validateLoading(c);unload();},observe(view){if(withinRegion(view,settings))return load('zoom');unload();return Promise.resolve(null);}};
}
