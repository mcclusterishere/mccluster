const API='https://api.mccluster.org/v1/arcade';
export async function arcadeRequest(path,method='GET',body) {
  let token;try{token=JSON.parse(localStorage.getItem('mccdb_session')||'null')?.access_token;}catch{}
  if(!token)throw Error('Sign in with your owner account.');
  const response=await fetch(API+path,{method,cache:'no-store',redirect:'error',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>null);
  if(!response.ok||data?.ok!==true)throw Error(response.status===409?'This mission changed. Load it before saving again.':response.status===401||response.status===403?'Owner access is required.':'Cloud arcade unavailable. Your local result remains on this device.');
  return data.value;
}
