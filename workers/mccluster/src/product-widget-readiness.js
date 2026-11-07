// Owner-operable inspection over the canonical app registry and access contract.
// No configuration, grant, billing or product-data writes are exposed.
import {reply} from './lib/http.js';
import {requireMembership} from './workspaces.js';
import {createProductWidgetAccess} from './lib/product-widget-access.js';
export const PRODUCT_WIDGET_READINESS='/v1/owner/product-widgets';
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9._-]{0,79}$/.test(x);
const deny=(status,message)=>Object.assign(Error(message),{status});
function policySet(app){
 const config=app.settings?.widget_access_v1;
 if(!config||config.version!==1||!config.widgets||typeof config.widgets!=='object'||Array.isArray(config.widgets))return null;
 const entries=Object.entries(config.widgets);
 if(!entries.length||entries.length>16||entries.some(([key,p])=>!id(key)||!p||typeof p!=='object'||Array.isArray(p)))return null;
 return Object.fromEntries(entries);
}
export async function handleProductWidgetReadiness(request,env,{requireHouseOwner,read}={}){
 if(new URL(request.url).pathname!==PRODUCT_WIDGET_READINESS)return null;
 const respond=(data,status=200)=>{const r=reply(request,env,data,status);r.headers.set('cache-control','private, no-store');return r;};
 try{
  if(typeof requireHouseOwner!=='function'||typeof read!=='function')throw deny(503,'Owner verification unavailable');
  const user=await requireHouseOwner(request,env);
  if(!user?.id)throw deny(401,'Sign in required');
  let input;
  if(request.method==='GET'){
   const url=new URL(request.url);if([...url.searchParams.keys()].some(k=>k!=='org_id'))throw deny(400,'Unsupported query');
   input={org_id:url.searchParams.get('org_id')};
  }else if(request.method==='POST'){
   if(!request.headers.get('content-type')?.includes('application/json'))throw deny(415,'JSON required');
   const reader=request.body?.getReader();if(!reader)throw deny(400,'Request required');let bytes=0,text='';const decoder=new TextDecoder();
   for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();throw deny(413,'Request too large');}text+=decoder.decode(value,{stream:true});}
   try{input=JSON.parse(text+decoder.decode());}catch{throw deny(400,'Invalid JSON');}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['org_id','app_key','widget_id','preview_plan'].includes(k)))throw deny(400,'Unsupported fields');
   if(!id(input.app_key)||(input.widget_id!==undefined&&!id(input.widget_id))||(input.preview_plan!==undefined&&(!id(input.preview_plan)||!input.widget_id)))throw deny(400,'Choose a registered product and widget');
  }else throw deny(405,'Method not allowed');
  if(typeof input.org_id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.org_id))throw deny(400,'Workspace required');
  // House ownership does not grant membership in a customer's workspace.
  await requireMembership(env,user,input.org_id);
  const base={contract:'mccluster-owner-product-readiness/v1',checked_at:new Date().toISOString(),org_id:input.org_id,read_only:true};
  if(request.method==='GET'){
   const rows=await read('platform_apps?select=app_key,name,enabled&order=app_key.asc&limit=101');
   if(!Array.isArray(rows))throw deny(503,'Product registry unavailable');
   return respond({...base,limited:rows.length>100,apps:rows.slice(0,100).filter(a=>id(a.app_key)).map(a=>({app_key:a.app_key,name:String(a.name||a.app_key).slice(0,160),enabled:typeof a.enabled==='boolean'?a.enabled:null}))});
  }
  const rows=await read('platform_apps?app_key=eq.'+encodeURIComponent(input.app_key)+'&select=app_key,name,enabled,settings&limit=2');
  if(!Array.isArray(rows)||rows.length>1)throw deny(503,'Product registry unavailable');
  const app=rows[0];if(!app||app.app_key!==input.app_key)throw deny(404,'Registered product not found');
  const policies=policySet(app);
  const report={...base,app_key:app.app_key,name:String(app.name||app.app_key).slice(0,160),widgets:[],state:'unconfigured',reason:'widget_policy_missing',next:'Choose and review widget capabilities and plan mappings before activation.'};
  if(typeof app.enabled!=='boolean')return respond({...report,state:'unavailable',reason:'product_enablement_unknown',next:'Repair missing product enablement evidence in the canonical registry.'});
  if(!app.enabled)return respond({...report,state:'forbidden',reason:'product_disabled',next:'This registered product is disabled. Readiness checks cannot enable it.'});
  if(!policies)return respond(report);
  if(input.widget_id&&!Object.hasOwn(policies,input.widget_id))throw deny(404,'Registered widget not found');
  const gate=createProductWidgetAccess({catalog:{[app.app_key]:policies},authenticate:async()=>user,
   // This endpoint inspects only the registry record, never a customer's product data.
   authorizeResource:async(_r,_e,c)=>c.productId===app.app_key&&c.resourceId===app.app_key,
   authorizeInternal:async()=>true,authorizePreview:async()=>true}); // verified house owner above, for this request only
  for(const widgetId of input.widget_id?[input.widget_id]:Object.keys(policies)){
   const decision=await gate.inspect(request,env,{orgId:input.org_id,productId:app.app_key,widgetId,resourceId:app.app_key,previewPlan:input.preview_plan});
   const p=policies[widgetId];
   const plans=p.kind==='subscription'&&app.app_key!=='system'&&['available','locked'].includes(decision.state)?Object.keys(p.plans||{}).filter(id).slice(0,16):[];
   report.widgets.push({...decision,preview_plans:plans});
  }
  // There is deliberately no aggregate "product is ready" claim from a widget check.
  report.state='inspected';report.reason=null;report.next='These decisions cover registry inspection only. Product actions must independently enforce their resource and licensing checks.';
  return respond(report);
 }catch(e){const status=[400,401,403,404,405,413,415].includes(e.status)?e.status:503;return respond({ok:false,state:status===503?'unavailable':'forbidden',error:status===503?'Readiness evidence is unavailable. Retry after checking the service.':e.message},status);}
}
