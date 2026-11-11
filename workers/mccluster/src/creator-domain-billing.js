import {stripeRequest} from './whip/stripe.js';
// The domain-order handler must establish its complete registrar/configuration gate
// before injecting this bridge. Default deny prevents an unfulfillable purchase.
export async function createCreatorDomainCheckout(order,env,{registrarReady=false}={}){
 if(!registrarReady||env.CREATOR_DOMAIN_SALES_ENABLED!=='true')throw new Error('Domain fulfillment is not configured');
 if(!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY||'')&&env.CREATOR_BILLING_ALLOW_LIVE!=='true')throw new Error('Live domain checkout is disabled');
 const expires=Math.floor(Date.parse(order.expires_at)/1000),now=Math.floor(Date.now()/1000);
 if(!/^[0-9a-f-]{36}$/i.test(order.id||'')||!/^[0-9a-f-]{36}$/i.test(order.auth_user_id||'')||!Number.isSafeInteger(order.total_cents)||order.total_cents<=0||String(order.currency).toUpperCase()!=='USD'||expires-now<31*60||expires-now>24*60*60)throw new Error('Invalid or expired domain quote');
 const session=await stripeRequest(env,'checkout/sessions',{
  mode:'payment',expires_at:expires,client_reference_id:order.auth_user_id,
  line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:order.total_cents,product_data:{name:'Domain '+order.action+': '+order.hostname}}}],
  metadata:{creator_domain_order_id:order.id,mccluster_user_id:order.auth_user_id},
  success_url:'https://matthew.mccluster.org/customer-domains.html?checkout=returned',
  cancel_url:'https://matthew.mccluster.org/customer-domains.html?checkout=cancelled'
 },{idempotencyKey:'domain-order-'+order.id});
 if(!session?.id||!session?.url)throw new Error('Domain checkout unavailable');
 return {id:session.id,url:session.url};
}
