/* The McCluster Corp merch marketplace in a browser, phone first. Real pages and scripts from this
   checkout (market/*.html, js/market*.js, control.html + js/control-room/marketplace.js); EVERY network
   call is a synthetic fixture: /v1/merch on api.mccluster.org answers with the shapes
   workers/mccluster/src/merch/router.js returns, from an in-memory shop that keeps what the browser
   sends; Supabase auth and storage are stubbed; Stripe Checkout is a blank page. Nothing reaches a
   real service and no money moves. Checks at 390px first (scrollWidth === clientWidth), then 820 and
   1280; screenshots of the storefront, product page, seller dashboard and Control's Marketplace panel.
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/merch-marketplace.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/merch-marketplace-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org',SB='https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const SELLER_USER='a1111111-1111-4111-8111-111111111111',NEW_USER='e5555555-5555-4555-8555-555555555555',OWNER='0aaaaaaa-0000-4000-8000-000000000000';
const ORG_A='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',ORG_B='bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const L1='dddddddd-4444-4444-8444-dddddddddddd',L2='dddddddd-4444-4444-8444-ddddddddddd2';
const V1='eeeeeeee-5555-4555-8555-eeeeeeeeeee1',V2='eeeeeeee-5555-4555-8555-eeeeeeeeeee2',V3='eeeeeeee-5555-4555-8555-eeeeeeeeeee3';
const O1='ffffffff-6666-4666-8666-fffffffffff1';
const TOKEN='Tk'+'x'.repeat(41);
const img=(name)=>`${SB}/storage/v1/object/public/marketplace-media/${ORG_A}/${name}`;
const results=[];
function check(scope,name,condition,detail){results.push({scope,name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+'['+scope+'] '+name+(condition?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});

function shop(){
  const seller={slug:'alpha-goods',display_name:'Alpha Goods',bio:'Heavyweight tees and prints from Bridgeport.',logo_path:null,logo_url:null};
  const listings=[
    {id:L1,title:'Alpha Heavyweight Tee — a very long product title that must wrap at phone width',description:'Heavy cotton, screen printed by hand.\nShips in 3 days.',images:[`${ORG_A}/tee.jpg`,`${ORG_A}/tee2.jpg`],image_urls:[img('tee.jpg'),img('tee2.jpg')],price_cents:2500,currency:'usd',shipping_cents:500,
     seller,variants:[{id:V1,label:'M / Black',options:{size:'M',colour:'Black'},price_cents:2500,available:3,in_stock:true},{id:V2,label:'XL / Black',options:{size:'XL',colour:'Black'},price_cents:2800,available:0,in_stock:false}]},
    {id:L2,title:'Poster 18×24',description:'',images:[`${ORG_A}/poster.jpg`],image_urls:[img('poster.jpg')],price_cents:4000,currency:'usd',shipping_cents:0,seller,
     variants:[{id:V3,label:'One size',options:{},price_cents:4000,available:null,in_stock:true}]}
  ];
  return {seller,listings,calls:[],
    orders:[{id:O1,listing_id:L1,variant_id:V1,quantity:2,title_snapshot:'Alpha Heavyweight Tee',variant_label:'M / Black',sku:'ALPHA-M-BLK',subtotal_cents:5000,shipping_cents:500,tax_cents:350,total_cents:5850,platform_fee_cents:825,amount_refunded_cents:0,currency:'usd',status:'paid',buyer_email:'buyer@example.com',
      shipping_address:{name:'Buyer One',line1:'1 Main Street, Apartment 4B, a long address line',city:'Bridgeport',state:'CT',postal_code:'06604',country:'US'},carrier:null,tracking_number:null,livemode:true,paid_at:new Date().toISOString(),created_at:new Date().toISOString()}],
    adminSellers:[
      {org_id:ORG_B,slug:'bravo-merch',display_name:'Bravo Merch',bio:'Caps and stickers.',status:'applied',status_reason:null,created_at:new Date().toISOString(),stripe:{onboarding_status:'ready',charges_enabled:true,payouts_enabled:true,details_submitted:true}},
      {org_id:ORG_A,slug:'alpha-goods',display_name:'Alpha Goods',bio:'Heavyweight tees.',status:'approved',status_reason:null,created_at:new Date().toISOString(),stripe:{onboarding_status:'ready',charges_enabled:true,payouts_enabled:true,details_submitted:true}}]};
}
function dashboard(s,user){
  if(user===NEW_USER&&!s.applied)return {seller:null,platform_fee_bps:1500};
  return {seller:{org_id:ORG_A,slug:'alpha-goods',display_name:'Alpha Goods',bio:s.seller.bio,logo_path:null,logo_url:null,status:'approved',status_reason:null,role:'owner'},
    stripe:{connected:true,ready:true,onboarding_status:'ready',account_id:'acct_1Alpha',charges_enabled:true,payouts_enabled:true,details_submitted:true,requirements:{currently_due:[],past_due:[],disabled_reason:null},livemode:true},
    tax:{status:s.taxStatus||'active',missing:[]},platform_fee_bps:1500,
    listings:s.listings.map((l,i)=>({...l,status:i===0?'published':i===1?'pending_review':'draft',inventory_policy:'tracked',variants:l.variants.map(v=>({...v,sku:v.label==='M / Black'?'ALPHA-M-BLK':null,inventory_count:v.available??0,active:true}))})),
    orders:s.orders};
}
const userOf=auth=>{try{return JSON.parse(atob(String(auth||'').replace(/^Bearer\s+/i,'').split('.')[1])).sub;}catch{return null;}};

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
async function setup(viewport,user){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const s=shop(),errors=[];
  await ctx.addInitScript(({user})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(!user)return;
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:user,email:'u@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:user,email:'u@fixture.invalid'}}));
  },{user});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,method=req.method();
    if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    /* Stripe's Connect.js, as a fixture: the same global API (StripeConnect.init → instance.create(name)) */
    if(u.href==='https://connect-js.stripe.com/v1.0/connect.js')return route.fulfill({contentType:'text/javascript',body:`window.StripeConnect={init:function(o){window.__connectInit=o;return {create:function(n){var e=document.createElement('div');e.setAttribute('data-stripe-component',n);e.style.cssText='display:block;min-height:120px;border:1px solid #ccc;border-radius:10px;padding:12px;width:100%;box-sizing:border-box';e.textContent='Stripe '+n+' (fixture)';e.setOnTaxSettingsUpdated=function(){};o.fetchClientSecret().then(function(sec){e.setAttribute('data-secret',sec);});return e;}};}};`});
    if(u.origin==='https://checkout.stripe.com')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Stripe Checkout (fixture)</title><p>Stripe Checkout fixture</p>'});
    if(u.origin==='https://api.mccluster.org'){
      const body=method==='GET'?null:(req.postDataJSON()||{});const who=userOf(req.headers().authorization);
      if(p.startsWith('/v1/merch'))s.calls.push({method,path:p+u.search,body,who});
      if(p==='/v1/merch/listings')return json(route,{listings:s.listings});
      if(p==='/v1/merch/listings/'+L1)return json(route,{listing:s.listings[0]});
      if(p==='/v1/merch/sellers/alpha-goods')return json(route,{seller:s.seller,listings:s.listings});
      if(p==='/v1/merch/checkout'&&method==='POST')return json(route,{url:'https://checkout.stripe.com/c/pay/cs_test_Fixture0001',order_token:TOKEN,order_id:O1},201);
      if(p==='/v1/merch/orders/status')return u.searchParams.get('token')===TOKEN?json(route,{order:{id:O1,status:'shipped',title:'Alpha Heavyweight Tee',variant:'M / Black',quantity:2,subtotal_cents:5000,shipping_cents:500,tax_cents:350,total_cents:5850,amount_refunded_cents:0,currency:'usd',carrier:'USPS',tracking_number:'9400 1000 0000 0000',livemode:true,ship_to:{city:'Bridgeport',state:'CT'},seller:{slug:'alpha-goods',display_name:'Alpha Goods'}}}):json(route,{error:'Order not found'},404);
      if(p==='/v1/merch/seller'){if(!who)return json(route,{error:'Sign in to sell on McCluster'},401);return json(route,dashboard(s,who));}
      if(p==='/v1/merch/seller/apply'){s.applied=true;return json(route,{created:true,org_id:ORG_A,slug:body.slug,status:'applied'},201);}
      if(/^\/v1\/merch\/seller\/orders\/[0-9a-f-]+\/fulfil$/.test(p)){const o=s.orders[0];if(body.status==='shipped'){if(!body.carrier||!body.tracking_number)return json(route,{error:'Enter the carrier and tracking number'},400);Object.assign(o,{status:'shipped',carrier:body.carrier,tracking_number:body.tracking_number});}return json(route,{id:O1,status:body.status});}
      if(p==='/v1/merch/seller/account-session'&&method==='POST'){if(who!==SELLER_USER)return json(route,{error:'Only the shop owner can do that'},403);return json(route,{client_secret:'accs_secret_fixture',publishable_key:'pk_test_fixture',components:['tax_settings','tax_registrations','notification_banner']});}
      if(/^\/v1\/merch\/seller\/listings\/[0-9a-f-]+$/.test(p)&&method==='PATCH')return json(route,{ok:true});
      if(p==='/v1/merch/seller/listings'&&method==='POST'){s.listings.push({...s.listings[1],id:'dddddddd-4444-4444-8444-ddddddddddd3',title:body.title});return json(route,{id:'x',status:'draft'},201);}
      if(p==='/v1/merch/admin'){if(who!==OWNER)return json(route,{error:'McCluster operator access required'},403);
        return json(route,{platform_fee_bps:1500,sellers:s.adminSellers,listings:s.listings.map(l=>({...l,seller_org_id:ORG_A,status:'published',removed_reason:null})),orders:s.orders.map(o=>({...o,seller_org_id:ORG_A})),totals:{orders:1,gross_cents:5850,refunded_cents:0,platform_fee_cents:825,test_orders:0}});}
      if(/^\/v1\/merch\/admin\/sellers\/[0-9a-f-]+\/approve$/.test(p)){const t=s.adminSellers.find(x=>p.includes(x.org_id));t.status='approved';return json(route,{status:'approved'});}
      if(p==='/health')return json(route,{ok:true});
      if(p==='/v1/status')return json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}});
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:who},default_org_id:'o1',workspaces:who===OWNER?[{org_id:'o1',slug:'mccluster',kind:'studio',role:'owner',enabled:true,name:'McCluster'}]:[]});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.origin===SB){
      if(p==='/auth/v1/user'){const who=userOf(req.headers().authorization);return who?json(route,{id:who,email:'u@fixture.invalid'}):json(route,{msg:'bad jwt'},401);}
      if(p.startsWith('/storage/v1/object/public/marketplace-media/')){const f=p.endsWith('poster.jpg')?'assets/img/here-cover.jpg':p.endsWith('tee2.jpg')?'assets/img/heal-the-3-cover.jpg':'assets/img/hero_0001.jpg';return route.fulfill({body:await readFile(join(ROOT,f)),contentType:'image/jpeg'});}
      return json(route,[]);
    }
    if(u.origin===BASE){
      let rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));if(rel.endsWith('/'))rel+='index.html';
      const file=resolve(ROOT,rel);
      if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/TypeError|ReferenceError|SyntaxError/.test(m.text()))errors.push(m.text().slice(0,200));});
  return {ctx,page,s,errors};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
const fontsOk=page=>page.evaluate(()=>[...document.querySelectorAll('.mk input,.mk select,.mk textarea')].every(el=>parseFloat(getComputedStyle(el).fontSize)>=16));

try{
  for(const vp of [{width:390,height:844},{width:820,height:1180},{width:1280,height:800}]){
    const scope=vp.width+'px',shots=vp.width===390;
    /* ---- buyer: storefront, product, checkout redirect, shop, order status ---- */
    {
      const {ctx,page,s,errors}=await setup(vp,null);
      await page.goto(BASE+'/market/',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('.mk-card',{timeout:20000});
      await page.waitForFunction(()=>[...document.querySelectorAll('.mk-card__img')].every(i=>i.complete),null,{timeout:10000}).catch(()=>{});
      check(scope,'storefront lists the published items',await page.locator('.mk-card').count()===2);
      check(scope,'storefront: no sideways scroll',await overflow(page)===0,await overflow(page));
      check(scope,'storefront names McCluster Corp',/McCluster Corp/.test(await page.locator('.mk-top').textContent()));
      if(shots)await page.screenshot({path:join(OUT,'storefront-390.png'),fullPage:true});
      await page.locator('.mk-card').first().click();
      await page.waitForSelector('[data-variant]',{timeout:20000});
      check(scope,'product: the sold-out option cannot be chosen',await page.locator(`[data-variant="${V2}"]`).isDisabled());
      check(scope,'product: buy waits for an option',await page.locator('#mkBuy').isDisabled());
      await page.locator(`[data-variant="${V1}"]`).click();
      await page.locator('#mkQty').selectOption('2');
      check(scope,'product: the total before tax is shown',/\$55\.00 \+ tax/.test(await page.locator('#mkBuy').textContent()),await page.locator('#mkBuy').textContent());
      check(scope,'product: no sideways scroll',await overflow(page)===0,await overflow(page));
      check(scope,'product: controls at 16px or more',await fontsOk(page));
      if(shots)await page.screenshot({path:join(OUT,'product-390.png'),fullPage:true});
      await Promise.all([page.waitForURL(/checkout\.stripe\.com/,{timeout:20000}),page.locator('#mkBuy').click()]);
      const co=s.calls.find(c=>c.path==='/v1/merch/checkout');
      check(scope,'checkout sends only the listing, the option and the quantity',co&&JSON.stringify(Object.keys(co.body).sort())===JSON.stringify(['listing_id','quantity','variant_id'])&&co.body.quantity===2&&co.body.variant_id===V1,co&&co.body);
      check(scope,'checkout goes to Stripe',/checkout\.stripe\.com/.test(page.url()));
      await page.goto(BASE+'/market/shop.html?s=alpha-goods',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.getElementById('mkShopName').textContent==='Alpha Goods',null,{timeout:20000});
      check(scope,'shop page by slug',await page.locator('.mk-card').count()===2);
      check(scope,'shop: no sideways scroll',await overflow(page)===0,await overflow(page));
      await page.goto(BASE+'/market/order.html?t='+TOKEN+'&done=1',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('#mkOrder .mk-pill',{timeout:20000});
      const ot=await page.locator('#mkOrder').textContent();
      check(scope,'order status: shipped with tracking, tax shown, no street address',/Shipped/.test(ot)&&/9400 1000 0000 0000/.test(ot)&&/\$3\.50/.test(ot)&&!/Main Street/.test(ot),ot.slice(0,200));
      check(scope,'order: no sideways scroll',await overflow(page)===0,await overflow(page));
      if(shots)await page.screenshot({path:join(OUT,'order-status-390.png'),fullPage:true});
      check(scope,'buyer pages: no script errors',errors.length===0,errors);
      await ctx.close();
    }
    /* ---- seller: dashboard, editor, orders, mark shipped ---- */
    {
      const {ctx,page,s,errors}=await setup(vp,SELLER_USER);
      await page.goto(BASE+'/market/sell.html',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('[data-tab="orders"]',{timeout:20000});
      const t=await page.locator('#mkSell').textContent();
      check(scope,'seller: approval, Stripe and tax states',/Approved/.test(t)&&/Stripe ready/.test(t)&&/Sales tax on/.test(t),t.slice(0,200));
      check(scope,'seller: listings with stock per option',/M \/ Black \(3\)/.test(t),t.slice(0,300));
      check(scope,'seller dashboard: no sideways scroll',await overflow(page)===0,await overflow(page));
      if(shots)await page.screenshot({path:join(OUT,'seller-dashboard-390.png'),fullPage:true});
      await page.locator('[data-act="new"]').click();
      await page.waitForSelector('#mkEditor',{timeout:10000});
      await page.locator('[data-act="addvariant"]').click();
      check(scope,'editor: no sideways scroll with two options',await overflow(page)===0,await overflow(page));
      check(scope,'editor: controls at 16px or more',await fontsOk(page));
      if(shots)await page.screenshot({path:join(OUT,'seller-listing-editor-390.png'),fullPage:true});
      await page.locator('#mkEditor [name="title"]').fill('Sticker pack');
      await page.locator('#mkEditor [name="price"]').fill('6.50');
      await page.locator('#mkEditor .mk-vrow').nth(1).locator('[data-v="label"]').fill('Glossy');
      await page.locator('#mkEditor button[type="submit"]').click();
      await page.waitForFunction(()=>/Saved\./.test(document.getElementById('mkSell').textContent),null,{timeout:10000});
      const saved=s.calls.find(c=>c.path==='/v1/merch/seller/listings'&&c.method==='POST');
      check(scope,'editor: price in cents, options with names',saved&&saved.body.price_cents===650&&saved.body.variants.length===2&&saved.body.variants[1].label==='Glossy',saved&&saved.body);
      await page.locator('[data-tab="orders"]').click();
      await page.waitForSelector(`[data-ship="${O1}"]`,{timeout:10000});
      check(scope,'orders: the buyer address is shown to the seller',/1 Main Street/.test(await page.locator('#mkSell').textContent()));
      check(scope,'orders: no sideways scroll',await overflow(page)===0,await overflow(page));
      if(shots)await page.screenshot({path:join(OUT,'seller-orders-390.png'),fullPage:true});
      await page.locator(`[data-carrier="${O1}"]`).selectOption('UPS');
      await page.locator(`[data-tracking="${O1}"]`).fill('1Z999AA10123456784');
      await page.locator(`[data-ship="${O1}"]`).click();
      await page.waitForFunction(()=>/Marked shipped/.test(document.getElementById('mkSell').textContent),null,{timeout:10000});
      const sh=s.calls.find(c=>/\/fulfil$/.test(c.path));
      check(scope,'mark shipped sends carrier and tracking',sh&&sh.body.status==='shipped'&&sh.body.carrier==='UPS'&&sh.body.tracking_number==='1Z999AA10123456784',sh&&sh.body);
      /* a waiting listing can go back to draft */
      await page.locator('[data-tab="listings"]').click();
      await page.waitForSelector(`[data-todraft="${L2}"]`,{timeout:10000});
      await page.locator(`[data-todraft="${L2}"]`).click();
      await page.waitForFunction(()=>/Back to draft\./.test(document.getElementById('mkSell').textContent),null,{timeout:10000});
      check(scope,'pending_review listing back to draft',!!s.calls.find(c=>c.path===`/v1/merch/seller/listings/${L2}`&&c.method==='PATCH'&&c.body.unpublish===true));
      /* an edit sends the stock count it loaded, so the server can refuse a stale write */
      await page.locator(`[data-edit="${L1}"]`).click();
      await page.waitForSelector('#mkEditor',{timeout:10000});
      await page.locator('#mkEditor [name="title"]').fill('Alpha Tee, renamed');
      await page.locator('#mkEditor button[type="submit"]').click();
      await page.waitForFunction(()=>/Saved\./.test(document.getElementById('mkSell').textContent),null,{timeout:10000});
      const ed=s.calls.find(c=>c.path===`/v1/merch/seller/listings/${L1}`&&c.method==='PATCH');
      check(scope,'edit carries the loaded stock as expected_inventory',ed&&ed.body.variants[0].expected_inventory===3&&ed.body.variants[0].inventory_count===3&&ed.body.variants[0].id===V1,ed&&ed.body.variants);
      check(scope,'seller: no script errors',errors.length===0,errors);
      await ctx.close();
    }
    /* ---- seller: the Sales tax step in Stripe's embedded components ---- */
    {
      const {ctx,page,s,errors}=await setup(vp,SELLER_USER);
      s.taxStatus='pending';
      await page.goto(BASE+'/market/sell.html',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('[data-act="tax"]',{timeout:20000});
      check(scope,'tax: not set up, and checkout is said to wait for it',/Sales tax not set up/.test(await page.locator('#mkSell').textContent())&&/cannot check out until sales tax is set up/.test(await page.locator('#mkSell').textContent()));
      await page.locator('[data-act="tax"]').click();
      await page.waitForSelector('[data-stripe-component="tax-registrations"][data-secret]',{timeout:20000});
      const parts=await page.locator('[data-stripe-component]').evaluateAll(els=>els.map(e=>e.getAttribute('data-stripe-component')));
      check(scope,'tax: Stripe tax settings, registrations and banner are mounted',JSON.stringify(parts)===JSON.stringify(['notification-banner','tax-settings','tax-registrations']),parts);
      check(scope,'tax: Connect.js is given the server session and publishable key',await page.evaluate(()=>window.__connectInit&&window.__connectInit.publishableKey==='pk_test_fixture'));
      check(scope,'tax: the session is asked for by the seller, with no account in the request',s.calls.filter(c=>c.path==='/v1/merch/seller/account-session').every(c=>c.who===SELLER_USER&&Object.keys(c.body||{}).length===0));
      check(scope,'tax step: no sideways scroll',await overflow(page)===0,await overflow(page));
      if(shots)await page.screenshot({path:join(OUT,'seller-sales-tax-390.png'),fullPage:true});
      await page.locator('[data-act="taxdone"]').click();
      await page.waitForSelector('[data-tab="orders"]',{timeout:10000});
      check(scope,'tax: no script errors',errors.length===0,errors);
      await ctx.close();
    }
    /* ---- a new seller applies ---- */
    {
      const {ctx,page,s,errors}=await setup(vp,NEW_USER);
      await page.goto(BASE+'/market/sell.html',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('#mkApply',{timeout:20000});
      check(scope,'apply: the 15% is stated before applying',/15% of each sale/.test(await page.locator('#mkSell').textContent()));
      check(scope,'apply: no sideways scroll',await overflow(page)===0,await overflow(page));
      if(shots)await page.screenshot({path:join(OUT,'seller-apply-390.png'),fullPage:true});
      await page.locator('#mkApply [name="display_name"]').fill('New Shop');
      await page.locator('#mkApply [name="slug"]').fill('new-shop');
      await page.locator('#mkApply button[type="submit"]').click();
      await page.waitForFunction(()=>/Applied\./.test(document.getElementById('mkSell').textContent),null,{timeout:10000});
      check(scope,'apply posts the shop',!!s.calls.find(c=>c.path==='/v1/merch/seller/apply'&&c.body.slug==='new-shop'));
      check(scope,'apply: no script errors',errors.length===0,errors);
      await ctx.close();
    }
    /* ---- signed out ---- */
    {
      const {ctx,page}=await setup(vp,null);
      await page.goto(BASE+'/market/sell.html',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('a[href*="login.html"]',{timeout:20000});
      check(scope,'signed out: sign in, back to the sell page',/next=%2Fmarket%2Fsell\.html/.test(await page.locator('a[href*="login.html"]').getAttribute('href')));
      await ctx.close();
    }
    /* ---- owner: Control → Work → Marketplace ---- */
    {
      const {ctx,page,s,errors}=await setup(vp,OWNER);
      await page.goto(BASE+'/control.html#work:marketplace',{waitUntil:'domcontentloaded'});
      await page.waitForSelector('[data-crmk-seller="approve"]',{timeout:30000});
      const t=await page.locator('#crSurface').textContent();
      check(scope,'control: fee totals and the waiting seller',/\$8\.25/.test(t)&&/1sellers waiting|1\s*sellers waiting/.test(t.replace(/\s+/g,''))||(/\$8\.25/.test(t)&&/Bravo Merch/.test(t)),t.slice(0,300));
      check(scope,'control marketplace: no sideways scroll',await overflow(page)===0,await overflow(page));
      if(shots)await page.screenshot({path:join(OUT,'control-marketplace-390.png'),fullPage:true});
      await page.locator(`[data-crmk-seller="approve"][data-id="${ORG_B}"]`).click();
      await page.waitForFunction(()=>!document.querySelector('[data-crmk-seller="approve"]'),null,{timeout:10000});
      check(scope,'control: approve calls the admin route',!!s.calls.find(c=>c.path===`/v1/merch/admin/sellers/${ORG_B}/approve`&&c.who===OWNER));
      check(scope,'control: no script errors',errors.length===0,errors);
      await ctx.close();
    }
  }
}finally{await browser.close();}
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} passed; screenshots in ${OUT}`);
process.exit(failed.length?1:0);
