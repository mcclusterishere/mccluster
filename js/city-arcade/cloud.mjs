const API='https://api.mccluster.org/v1/arcade';
// A 409 means what its route conflicts on (W2): a finish conflict is a run whose result the server already
// holds with different values, never a changed mission; mission saves and starts conflict on the revision.
export const FINISH_CONFLICT='The server already holds a different result for this run. This device copy was not saved; review it before discarding.';
export const MISSION_CONFLICT='This mission changed. Load it before saving again.';
export async function arcadeRequest(path,method='GET',body) {
  let token;try{token=JSON.parse(localStorage.getItem('mccdb_session')||'null')?.access_token;}catch{}
  if(!token)throw Object.assign(Error('Sign in with your owner account.'),{cloudUnavailable:true});
  const response=await fetch(API+path,{method,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}).catch(error=>{throw Object.assign(error,{cloudUnavailable:true});});
  const data=await response.json().catch(()=>null);
  if(!response.ok||data?.ok!==true)throw Object.assign(Error(response.status===409?(path.startsWith('/finish/')?FINISH_CONFLICT:MISSION_CONFLICT):response.status===401||response.status===403?'Owner access is required.':'Cloud arcade unavailable. Your local result remains on this device.'),{status:response.status,cloudUnavailable:![409,422].includes(response.status)});
  return data.value;
}

export async function arcadeCloudAvailable(){
  try{return (await arcadeRequest('/capabilities'))?.cloudEnabled===true;}catch{return false;}
}
