import {arcadeRoads} from './roads.generated.js';
import {newStreetRun} from '../../../../js/city-arcade/sole-street-engine.mjs';
import { reply } from '../lib/http.js';
import { validateMission, knownMissionKey, missionKey, LOCATIONS } from '../../../../js/city-arcade/mission-contract.mjs';
export const ARCADE_PREFIX='/v1/arcade';
const fail=(status,message)=>Object.assign(Error(message),{status});
async function body(request) {
  if(!request.headers.get('content-type')?.includes('application/json'))throw fail(415,'JSON required');
  const reader=request.body?.getReader();if(!reader)throw fail(400,'Body required');
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw fail(413,'Body too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try { const b=JSON.parse(new TextDecoder().decode(bytes));if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b; }catch{throw fail(400,'Invalid JSON');}
}
export async function handleArcade(request,env,{requireHouseOwner,fetchImpl=fetch}={}) {
  const path=new URL(request.url).pathname;
  if(path!==ARCADE_PREFIX&&!path.startsWith(ARCADE_PREFIX+'/'))return null;
  const respond=(data,status=200)=>{const r=reply(request,env,data,status);r.headers.set('cache-control','private, no-store');return r;};
  try {
    if(typeof requireHouseOwner!=='function')throw fail(503,'Authorization unavailable');
    const user=await requireHouseOwner(request,env);if(!user?.id)throw fail(401,'Authentication required');
    const cloudEnabled=env.ARCADE_CLOUD_ENABLED==='true'&&!!env.SUPABASE_URL&&!!env.SUPABASE_SERVICE_ROLE_KEY;
    if(path===ARCADE_PREFIX+'/capabilities'&&request.method==='GET')return respond({ok:true,value:{cloudEnabled}});
    if(!cloudEnabled)throw fail(503,'Arcade cloud is disabled');
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw fail(503,'Arcade storage unavailable');
    const parts=path.slice(ARCADE_PREFIX.length+1).split('/'),id=parts[1];
    let action,doc=null,revision=null;
    if(parts.length===1&&parts[0]==='results'&&request.method==='GET')action='history';
    else if(parts.length===2&&parts[0]==='missions'&&knownMissionKey(id)){
      if(request.method==='GET')action='read';
      else if(request.method==='PUT'){
        const b=await body(request);if(Object.keys(b).some(k=>!['document','expectedRevision'].includes(k)))throw fail(400,'Unknown field');
        try{doc=validateMission(b.document);if(doc.sole)newStreetRun(doc.sole,arcadeRoads,LOCATIONS.find(p=>p.id===doc.locationId).point);}catch(e){throw fail(422,e.message);}
        if(missionKey(doc.gameId,doc.locationId)!==id)throw fail(422,'Location mismatch');revision=b.expectedRevision;action='save';
      }else throw fail(405,'Method not allowed');
    }else if(parts.length===2&&parts[0]==='start'&&knownMissionKey(id)&&request.method==='POST'){
      const b=await body(request);if(Object.keys(b).some(k=>k!=='expectedRevision'))throw fail(400,'Unknown field');revision=b.expectedRevision;action='start';
    }else if(parts.length===2&&parts[0]==='finish'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)&&request.method==='POST'){
      doc=await body(request);if(Object.keys(doc).some(k=>!['status','served','encounters'].includes(k))||!['won','failed'].includes(doc.status)||!Number.isInteger(doc.served)||doc.served<0||doc.served>12)throw fail(422,'Invalid practice result');if(doc.encounters!==undefined&&(!Array.isArray(doc.encounters)||doc.encounters.length>3||doc.encounters.some(id=>typeof id!=='string'||!/^[-a-z0-9]{1,40}$/.test(id))))throw fail(422,'Invalid encounters');action='finish';
    }else throw fail(404,'Arcade route not found');
    if(['save','start'].includes(action)&&(!Number.isInteger(revision)||revision<0||revision>2147483646))throw fail(400,'Expected revision required');
    const response=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/arcade_command',{
      method:'POST',redirect:'manual',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
      body:JSON.stringify({p_action:action,p_actor:user.id,p_id:id||'',p_document:doc,p_revision:revision})
    });
    if(response.status>=300&&response.status<400)throw fail(503,'Storage redirect refused');
    const result=await response.json();
    if(!response.ok){const status={42501:403,40001:409,P0002:404,23514:422,22023:422}[result?.code]||503;throw fail(status,status===409?'Mission or result changed. Reload before retrying.':status===503?'Arcade storage unavailable.':'Arcade request rejected.');}
    return respond({ok:true,value:result},action==='start'?201:200);
  }catch(e){const status=[400,401,403,404,405,409,413,415,422,503].includes(e.status)?e.status:503;return respond({ok:false,error:status===503?'Arcade service unavailable.':e.message},status);}
}
