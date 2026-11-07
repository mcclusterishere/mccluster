/* Canonical authenticated RPC adapter. No Worker proxy or service-role credential. */
(function(root){
 'use strict';root.CR=root.CR||{};
 function create(options){
  var org=options.orgId,supa=options.supa;
  if(typeof org!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(org)||!supa||typeof supa.token!=='function'||typeof supa.url!=='string'||!supa.key)throw Error('Authenticated workspace configuration required');
  var principal=null;
  function fail(message,status){return Object.assign(Error(message),{status:status});}
  async function session(){
   var token=await supa.token(),sub;
   try{sub=JSON.parse(root.atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch(_){throw fail('Sign in required',401);}
   if(typeof sub!=='string'||!sub)throw fail('Sign in required',401);
   // This comparison fences UI identity only. PostgreSQL verifies the signed JWT and owner role.
   if(principal&&principal!==sub)throw fail('Account changed. Reopen layout settings.',403);
   principal=sub;return {token:token,sub:sub};
  }
  async function rpc(name,args){
   var before=await session(),response;
   try{response=await (options.fetch||root.fetch)(supa.url.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',cache:'no-store',headers:{apikey:supa.key,authorization:'Bearer '+before.token,'content-type':'application/json'},body:JSON.stringify(args)});}catch(_){throw fail('Layout request outcome is unknown. Reload before saving again.',503);}
   var data;try{data=await response.json();}catch(_){throw fail('Layout response unavailable. Reload before saving again.',503);}
   if(!response.ok)throw fail(response.status===409?'Layout changed elsewhere.':response.status===401||response.status===403?'Owner access required.':'Layout service unavailable. Reload before saving again.',response.status);
   await session();
   if(!data||data.org_id!==org||data.schema!=='analytics-layout/v1'||typeof data.revision!=='string'||!/^\d+$/.test(data.revision))throw fail('Unexpected layout scope or revision.',503);
   return {schema:data.schema,revision:data.revision,layout:root.CR.analyticsLayout.validate(data.layout)};
  }
  return {identity:async function(){return (await session()).sub;},load:function(){return rpc('owner_analytics_layout_read_v1',{p_org_id:org});},save:function(input){return rpc('owner_analytics_layout_save_v1',{p_org_id:org,p_expected_revision:input.expectedRevision,p_layout:root.CR.analyticsLayout.validate(input.layout)});}};
 }
 root.CR.analyticsLayoutAdapter={create:create};
})(typeof window==='undefined'?globalThis:window);
