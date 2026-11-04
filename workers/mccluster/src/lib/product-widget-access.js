// Server-side composition over existing membership, capability and billing authority.
// No catalog, prices, grants, billing writes or HTTP route is activated here.
import {requireMembership} from '../workspaces.js';
import {requireCapability} from './capabilities.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const key=value=>typeof value==='string'&&/^[a-z][a-z0-9._-]{0,79}$/.test(value);

export function createProductWidgetAccess({catalog,authenticate,authorizeResource,authorizeInternal,authorizePreview}) {
  if(!catalog||typeof authenticate!=='function'||typeof authorizeResource!=='function')throw Error('Server catalog and authorization adapters required');
  // Catalog is server-owned reviewed configuration, never a request body or user setting.
  const definitions=structuredClone(catalog);
  async function inspect(request,env,{orgId,productId,widgetId,resourceId,previewPlan}={}) {
    const user=await authenticate(request,env);
    if(!user?.id)throw fail(401,'Sign in required');
    const result=state=>({contract:'mccluster-product-widget/v1',product_id:productId,widget_id:widgetId,org_id:orgId,resource_id:resourceId??null,state,allowed:state==='available'});
    if(!key(productId)||!key(widgetId))throw fail(400,'Product and widget required');
    const policy=definitions[productId]?.[widgetId];
    // Check tenant/resource authority before disclosing subscription or configuration.
    let membership;
    try {
      membership=await requireMembership(env,user,orgId);
      if(await authorizeResource(request,env,{user,membership,productId,widgetId,resourceId})!==true)return result('forbidden');
      if(!policy||!key(policy.capability))return result('unconfigured');
      await requireCapability(env,membership,policy.capability);
    }catch(e){if(e.status===403)return result('forbidden');if(e.status===401)throw e;return result('unavailable');}
    if(productId==='system'&&policy.kind!=='internal')return result('unconfigured');
    if(!['internal','included','subscription'].includes(policy.kind)||policy.configured!==true)return result('unconfigured');
    const context={user,membership,productId,widgetId,resourceId};
    if(policy.kind==='internal'){
      if(typeof authorizeInternal!=='function')return result('unconfigured');
      if(await authorizeInternal(request,env,context)!==true)return result('forbidden');
      if(previewPlan!==undefined)throw fail(400,'Internal infrastructure has no subscription preview');
      return result('available');
    }
    let plans;
    if(policy.kind==='subscription'){
      plans=policy.plans;
      if(!plans||Array.isArray(plans)||typeof plans!=='object'||!Object.keys(plans).length)return result('unconfigured');
      for(const [name,keys] of Object.entries(plans)){
        if(!key(name)||!Array.isArray(keys)||!keys.length||keys.some(k=>typeof k!=='string'||!/^CREATOR_(STARTER|PLUS|PRO|BUSINESS)_(MONTHLY|ANNUAL)_PRICE_ID$/.test(k)))return result('unconfigured');
      }
    }
    // Only the owner presentation adapter may simulate a reviewed plan. It grants nothing.
    if(previewPlan!==undefined){
      if(!plans||!Object.hasOwn(plans,previewPlan))throw fail(400,'Unknown presentation plan');
      if(typeof authorizePreview!=='function'||await authorizePreview(request,env,context)!==true)throw fail(403,'Owner presentation preview required');
    }
    if(policy.kind==='included')return result('available');
    const prices=Object.values(plans).flat().map(k=>env[k]);
    if(prices.some(p=>typeof p!=='string'||!/^price_[A-Za-z0-9]+$/.test(p)))return result('unconfigured');
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return result('unavailable');
    let decision;
    try{
      const url=new URL('/rest/v1/creator_billing_subscriptions',env.SUPABASE_URL);
      url.searchParams.set('org_id','eq.'+membership.org_id);
      url.searchParams.set('select','org_id,status,stripe_price_id,current_period_end');
      url.searchParams.set('limit','2'); // canonical schema has unique org_id; duplicates are unavailable
      const response=await fetch(url,{redirect:'manual',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});
      if(response.status>=300&&response.status<400)throw Error('Billing redirect refused');
      if(!response.ok)throw Error('Billing read failed');
      const rows=await response.json();
      if(!Array.isArray(rows)||rows.length>1||rows.some(r=>!r||r.org_id!==membership.org_id||typeof r.status!=='string'||typeof r.stripe_price_id!=='string'))throw Error('Invalid billing result');
      const row=rows[0];
      if(row?.status==='active'&&!Number.isFinite(Date.parse(row.current_period_end)))throw Error('Invalid subscription expiry');
      decision=result(row?.status==='active'&&Date.parse(row.current_period_end)>Date.now()&&prices.includes(row.stripe_price_id)?'available':'locked');
    }catch{decision=result('unavailable');}
    if(previewPlan!==undefined)decision.presentation={plan_code:previewPlan,state:'available',simulation:true,grants_access:false};
    return decision;
  }
  async function requireAccess(request,env,input){
    if(input?.previewPlan!==undefined)throw fail(400,'Presentation preview is not action authorization');
    const decision=await inspect(request,env,input);
    if(!decision.allowed)throw fail(['unavailable','unconfigured'].includes(decision.state)?503:403,decision.state);
    return decision;
  }
  return {inspect,requireAccess};
}
