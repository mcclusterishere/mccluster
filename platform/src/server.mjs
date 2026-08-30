import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import Stripe from 'stripe';
import { GoogleGenAI } from '@google/genai';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { Pool } = pg;
const env = process.env;
const PORT = Number(env.PORT || 8080);
const APP_ORIGIN = env.APP_ORIGIN || 'https://matthew.mccluster.org';
const PLATFORM_ORIGIN = env.PLATFORM_ORIGIN || `http://localhost:${PORT}`;
const app = express();
app.disable('x-powered-by');

function configured(...keys) { return keys.every((k) => Boolean(env[k])); }
function bool(name, fallback=false) { return env[name] == null ? fallback : String(env[name]).toLowerCase() === 'true'; }
function cents(dollars) { return Math.round(Number(dollars) * 100); }
function slugify(s='') { return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64) || `client-${Date.now()}`; }
function cleanDomain(s='') { return s.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]; }
function cleanFilename(s='upload.bin') { return s.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-120); }
function sha256(s='') { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

const pool = env.DATABASE_URL ? new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 8,
}) : null;

const r2 = configured('R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET')
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    })
  : null;

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
const gemini = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;

function providerStatus() {
  return {
    database: { configured: Boolean(pool), provider: 'railway-postgres' },
    storage: { configured: Boolean(r2), provider: 'cloudflare-r2', bucket: env.R2_BUCKET || null },
    domains: { configured: Boolean(env.NAMESILO_API_KEY), provider: 'namesilo', purchasesEnabled: bool('ALLOW_DOMAIN_PURCHASES') },
    payments: { configured: Boolean(stripe), provider: 'stripe-connect', liveRevenueShareEnabled: bool('ALLOW_LIVE_REVENUE_SHARE') },
    ai: { configured: Boolean(gemini), provider: 'gemini', model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite' },
    gpu: { configured: Boolean(env.RUNPOD_API_KEY && (env.RUNPOD_ENDPOINT_ID || env.RUNPOD_3D_ENDPOINT_ID || env.RUNPOD_SPLAT_ENDPOINT_ID || env.RUNPOD_VIDEO_ENDPOINT_ID)), provider: 'runpod' },
  };
}

function requireAdmin(req,res,next) {
  if (!env.ADMIN_TOKEN) return res.status(503).json({ error: 'ADMIN_TOKEN is not configured' });
  const token = req.get('x-admin-token') || req.get('authorization')?.replace(/^Bearer\s+/i,'');
  if (token !== env.ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function originAllowed(origin) {
  if (!origin) return true;
  if (origin === APP_ORIGIN || origin.endsWith('.mccluster.org')) return true;
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((x)=>x.trim()).filter(Boolean);
  return allowed.includes(origin);
}

app.post('/v1/webhooks/stripe', express.raw({type:'application/json'}), async (req,res) => {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook not configured');
  try {
    const evt = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
    if (pool && evt.type === 'account.updated') {
      const a = evt.data.object;
      await pool.query(`update platform_payment_accounts set charges_enabled=$2,payouts_enabled=$3,onboarding_status=$4,updated_at=now() where provider='stripe' and provider_account_id=$1`,[
        a.id, Boolean(a.charges_enabled), Boolean(a.payouts_enabled), a.details_submitted ? 'ready' : 'started'
      ]);
    }
    if (pool) await pool.query(`insert into platform_events(type,actor,data) values($1,'stripe',$2)`,[`stripe.${evt.type}`,{eventId:evt.id,objectId:evt.data?.object?.id||null}]);
    res.json({received:true});
  } catch (e) {
    console.error('stripe webhook', e);
    res.status(400).send(`Webhook error: ${e.message}`);
  }
});

app.use(express.json({ limit: '4mb' }));
app.use((req,res,next) => {
  const origin = req.get('origin');
  if (req.path.startsWith('/v1/public/')) {
    res.setHeader('Access-Control-Allow-Origin','*');
  } else if (originAllowed(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary','Origin');
  }
  res.setHeader('Access-Control-Allow-Headers','content-type, authorization, x-admin-token');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req,res) => {
  const status = providerStatus();
  const cards = Object.entries(status).map(([name,p]) => `<li><b>${name}</b><span class="${p.configured?'ok':'no'}">${p.configured?'READY':'NEEDS KEY / SETUP'}</span><small>${p.provider}</small></li>`).join('');
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>McCluster Platform</title><style>body{font:16px system-ui;background:#0b0b0c;color:#eee;max-width:760px;margin:auto;padding:40px 18px}h1{font-size:42px;margin:0 0 8px}p{color:#aaa;line-height:1.5}ul{list-style:none;padding:0;display:grid;gap:10px}li{border:1px solid #28282b;border-radius:14px;padding:14px;display:grid;grid-template-columns:1fr auto;gap:4px 12px}small{color:#777}.ok{color:#8ee59a}.no{color:#f3b2a7}</style><h1>McCluster Platform</h1><p>Shared control plane for client sites, domains, CMS, storage, payments, AI intake and Forge jobs.</p><ul>${cards}</ul><p><a style="color:#d9b96a" href="/health">Health</a></p>`);
});

app.get('/health', async (req,res) => {
  let db = false;
  if (pool) { try { await pool.query('select 1'); db = true; } catch {} }
  const providers = providerStatus();
  providers.database.reachable = db;
  res.status(db ? 200 : 503).json({ ok: db, service: 'mccluster-platform', now: new Date().toISOString(), providers });
});
app.get('/v1/providers', requireAdmin, (req,res) => res.json(providerStatus()));

async function event(tenantId,type,actor,data={}) {
  if (!pool) return;
  try { await pool.query('insert into platform_events(tenant_id,type,actor,data) values($1,$2,$3,$4)',[tenantId||null,type,actor||null,data]); } catch {}
}

app.post('/v1/tenants', requireAdmin, async (req,res,next) => {
  try {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const { displayName, legalName, kind='business', ownerName, ownerEmail, ownerPhone, notes, metadata={} } = req.body || {};
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });
    const base = slugify(displayName); let slug = base; let n = 1;
    while ((await pool.query('select 1 from platform_tenants where slug=$1',[slug])).rowCount) slug = `${base}-${++n}`;
    const q = await pool.query(`insert into platform_tenants(slug,legal_name,display_name,kind,status,owner_name,owner_email,owner_phone,notes,metadata)
      values($1,$2,$3,$4,'onboarding',$5,$6,$7,$8,$9) returning *`,[slug,legalName||null,displayName,kind,ownerName||null,ownerEmail||null,ownerPhone||null,notes||null,metadata]);
    await event(q.rows[0].id,'tenant.created','platform',{displayName,kind});
    res.status(201).json(q.rows[0]);
  } catch (e) { next(e); }
});

app.get('/v1/tenants', requireAdmin, async (req,res,next) => {
  try { if (!pool) throw new Error('DATABASE_URL is not configured'); res.json((await pool.query('select * from platform_tenants order by created_at desc')).rows); }
  catch(e){ next(e); }
});

app.post('/v1/sites', requireAdmin, async (req,res,next) => {
  try {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const { tenantId, name, slug, primaryDomain, theme={}, settings={} } = req.body || {};
    if (!tenantId || !name) return res.status(400).json({ error: 'tenantId and name are required' });
    const q = await pool.query(`insert into platform_sites(tenant_id,slug,name,primary_domain,theme,settings)
      values($1,$2,$3,$4,$5,$6) returning *`,[tenantId,slugify(slug||name),name,primaryDomain||null,theme,settings]);
    await event(tenantId,'site.created','platform',{siteId:q.rows[0].id,name});
    res.status(201).json(q.rows[0]);
  } catch (e) { next(e); }
});

app.get('/v1/public/sites/:slug', async (req,res,next) => {
  try {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const s = await pool.query(`select s.*,t.slug tenant_slug,t.display_name tenant_name,t.kind tenant_kind,t.metadata tenant_metadata
      from platform_sites s join platform_tenants t on t.id=s.tenant_id where s.slug=$1`,[req.params.slug]);
    if (!s.rowCount) return res.status(404).json({error:'site not found'});
    const site = s.rows[0];
    const [pages,content] = await Promise.all([
      pool.query(`select slug,title,blocks,seo,revision,published_at from platform_pages where site_id=$1 and status='published' order by slug`,[site.id]),
      pool.query(`select type,slug,title,data,sort_order,starts_at,ends_at,published_at from platform_content_items where site_id=$1 and status='published' order by type,sort_order,created_at`,[site.id])
    ]);
    res.json({site,pages:pages.rows,content:content.rows});
  } catch(e){ next(e); }
});

app.post('/v1/sites/:siteId/pages', requireAdmin, async (req,res,next) => {
  try {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const { slug, title, blocks=[], seo={}, publish=false } = req.body || {};
    if (!slug || !title) return res.status(400).json({error:'slug and title are required'});
    const status = publish ? 'published' : 'draft';
    const q = await pool.query(`insert into platform_pages(site_id,slug,title,status,blocks,seo,published_at) values($1,$2,$3,$4,$5,$6,case when $4='published' then now() else null end)
      on conflict(site_id,slug) do update set title=excluded.title,status=excluded.status,blocks=excluded.blocks,seo=excluded.seo,revision=platform_pages.revision+1,published_at=case when excluded.status='published' then now() else platform_pages.published_at end,updated_at=now() returning *`,[req.params.siteId,slugify(slug),title,status,blocks,seo]);
    res.json(q.rows[0]);
  } catch(e){ next(e); }
});

app.post('/v1/sites/:siteId/content', requireAdmin, async (req,res,next) => {
  try {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const { type, slug, title=null, data={}, sortOrder=0, startsAt=null, endsAt=null, publish=false } = req.body || {};
    if (!type || !slug) return res.status(400).json({error:'type and slug are required'});
    const status = publish ? 'published' : 'draft';
    const q = await pool.query(`insert into platform_content_items(site_id,type,slug,title,status,data,sort_order,starts_at,ends_at,published_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,case when $5='published' then now() else null end)
      on conflict(site_id,type,slug) do update set title=excluded.title,status=excluded.status,data=excluded.data,sort_order=excluded.sort_order,starts_at=excluded.starts_at,ends_at=excluded.ends_at,published_at=case when excluded.status='published' then now() else platform_content_items.published_at end,updated_at=now() returning *`,[req.params.siteId,type,slugify(slug),title,status,data,sortOrder,startsAt,endsAt]);
    res.json(q.rows[0]);
  } catch(e){ next(e); }
});

app.post('/v1/public/sites/:slug/submissions/:type', async (req,res,next) => {
  try {
    if (!bool('ENABLE_PUBLIC_FORMS',true)) return res.status(404).end();
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const type = slugify(req.params.type);
    if (!['contact','prayer','rsvp','newsletter','new-here'].includes(type)) return res.status(400).json({error:'unsupported submission type'});
    const site = await pool.query('select id from platform_sites where slug=$1',[req.params.slug]);
    if (!site.rowCount) return res.status(404).json({error:'site not found'});
    const body = req.body || {};
    if (body.website) return res.status(202).json({accepted:true});
    const ip = req.get('cf-connecting-ip') || req.ip || '';
    await pool.query(`insert into platform_submissions(site_id,type,name,email,phone,payload,source_ip_hash) values($1,$2,$3,$4,$5,$6,$7)`,[
      site.rows[0].id,type,String(body.name||'').slice(0,160)||null,String(body.email||'').slice(0,254)||null,String(body.phone||'').slice(0,80)||null,body,sha256(`${env.SUBMISSION_SALT||env.ADMIN_TOKEN||'salt'}:${ip}`)
    ]);
    res.status(202).json({accepted:true});
  } catch(e){ next(e); }
});

const briefSchema = {
  type:'object',
  properties:{
    businessName:{type:'string'}, oneSentencePositioning:{type:'string'}, audiences:{type:'array',items:{type:'string'},maxItems:5}, primaryActions:{type:'array',items:{type:'string'},maxItems:5},
    pages:{type:'array',maxItems:10,items:{type:'object',properties:{slug:{type:'string'},title:{type:'string'},purpose:{type:'string'},sections:{type:'array',items:{type:'string'},maxItems:8}},required:['slug','title','purpose','sections']}},
    appFeatures:{type:'array',items:{type:'string'},maxItems:12}, paymentNeeds:{type:'array',items:{type:'string'},maxItems:8}, contentNeededFromClient:{type:'array',items:{type:'string'},maxItems:20}, accessibilityNotes:{type:'array',items:{type:'string'},maxItems:8}, launchChecklist:{type:'array',items:{type:'string'},maxItems:20}
  }, required:['businessName','oneSentencePositioning','audiences','primaryActions','pages','appFeatures','paymentNeeds','contentNeededFromClient','accessibilityNotes','launchChecklist']
};

app.post('/v1/intakes/site-brief', requireAdmin, async (req,res,next) => {
  try {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    if (!gemini || !bool('ENABLE_SITE_INTERVIEW',true)) throw new Error('Gemini intake is not configured');
    const body = req.body || {}; const tenantId = body.tenantId || null;
    const row = await pool.query(`insert into platform_intakes(tenant_id,source,raw_input,status,model) values($1,'sales-interview',$2,'processing',$3) returning id`,[tenantId,body,env.GEMINI_MODEL || 'gemini-3.5-flash-lite']);
    const intakeId = row.rows[0].id;
    const prompt = `You are the structured intake engine for McCluster's website platform. Turn the supplied interview and any supplied source material into a launch brief for a responsive website/PWA. Never invent legal claims, addresses, staff names, schedules, prices, donation details, ministry facts or accessibility claims. If information is missing, put it in contentNeededFromClient. For churches, prioritize New Here, service times, livestream, giving, events, ministries, prayer/contact, accessibility and installable-app behavior only when supported. Return only the requested JSON schema.\n\nINPUT:\n${JSON.stringify(body)}`;
    const response = await gemini.models.generateContent({ model:env.GEMINI_MODEL || 'gemini-3.5-flash-lite', contents:prompt, config:{responseMimeType:'application/json',responseJsonSchema:briefSchema} });
    const brief = JSON.parse(response.text || '{}');
    await pool.query(`update platform_intakes set structured_brief=$2,status='ready',updated_at=now() where id=$1`,[intakeId,brief]);
    if (tenantId) await event(tenantId,'intake.ready','gemini',{intakeId});
    res.json({intakeId,brief});
  } catch(e){ next(e); }
});

app.post('/v1/sites/:siteId/materialize-brief', requireAdmin, async (req,res,next) => {
  try {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    const { intakeId, publish=false } = req.body || {};
    const q = await pool.query(`select structured_brief from platform_intakes where id=$1 and status='ready'`,[intakeId]);
    if (!q.rowCount) return res.status(404).json({error:'ready intake not found'});
    const brief = q.rows[0].structured_brief || {};
    const made=[];
    for (const p of brief.pages || []) {
      const blocks = [{type:'brief',purpose:p.purpose,sections:p.sections}];
      const r = await pool.query(`insert into platform_pages(site_id,slug,title,status,blocks,seo,published_at) values($1,$2,$3,$4,$5,'{}',case when $4='published' then now() else null end)
        on conflict(site_id,slug) do update set title=excluded.title,status=excluded.status,blocks=excluded.blocks,revision=platform_pages.revision+1,updated_at=now() returning id,slug,title,status`,[
          req.params.siteId,slugify(p.slug||p.title),p.title,publish?'published':'draft',blocks
        ]);
      made.push(r.rows[0]);
    }
    res.json({pages:made,brief});
  } catch(e){ next(e); }
});

app.post('/v1/storage/upload-url', requireAdmin, async (req,res,next) => {
  try {
    if (!r2 || !bool('ENABLE_DIRECT_UPLOADS',true)) throw new Error('R2 upload service is not configured');
    const { tenantId, siteId=null, filename='upload.bin', contentType='application/octet-stream', kind='file' } = req.body || {};
    if (!tenantId) return res.status(400).json({error:'tenantId is required'});
    const key = `${tenantId}/${slugify(kind)}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}-${cleanFilename(filename)}`;
    const url = await getSignedUrl(r2,new PutObjectCommand({Bucket:env.R2_BUCKET,Key:key,ContentType:contentType}),{expiresIn:900});
    const publicUrl = env.R2_PUBLIC_BASE_URL ? `${env.R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${key}` : null;
    if (pool) await pool.query(`insert into platform_assets(tenant_id,site_id,kind,storage_key,public_url,mime_type,metadata) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,[tenantId,siteId,kind,key,publicUrl,contentType,{filename,pendingUpload:true}]);
    res.json({method:'PUT',expiresIn:900,key,uploadUrl:url,publicUrl,headers:{'content-type':contentType}});
  } catch(e){ next(e); }
});

async function namesilo(op, params={}) {
  if (!env.NAMESILO_API_KEY) throw new Error('NAMESILO_API_KEY is not configured');
  const u = new URL(`https://www.namesilo.com/api/${op}`);
  u.searchParams.set('version','1'); u.searchParams.set('type','json'); u.searchParams.set('key',env.NAMESILO_API_KEY);
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k,String(v)); });
  const r = await fetch(u,{signal:AbortSignal.timeout(15000)}); if(!r.ok) throw new Error(`NameSilo ${op} HTTP ${r.status}`); return r.json();
}

app.get('/v1/domains/check', async (req,res,next) => {
  try {
    if (!bool('ENABLE_DOMAIN_SEARCH',true)) return res.status(404).end();
    const domain = cleanDomain(req.query.domain || '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return res.status(400).json({error:'valid domain query is required'});
    const [availability,prices] = await Promise.all([namesilo('checkRegisterAvailability',{domains:domain}),namesilo('getPrices')]);
    const tld = domain.split('.').pop(); const wholesale = Number(prices?.reply?.[tld]?.registration || 0); const markup = Number(env.NAMESILO_RESELLER_MARKUP_CENTS || 1800)/100;
    const available = Array.isArray(availability?.reply?.available) ? availability.reply.available.includes(domain) : undefined;
    res.json({domain,available,wholesale:wholesale||null,retail:wholesale?Math.ceil((wholesale+markup)*100)/100:null,currency:'USD',registrar:'NameSilo'});
  } catch(e){ next(e); }
});

app.post('/v1/domains/register', requireAdmin, async (req,res,next) => {
  try {
    if (!bool('ALLOW_DOMAIN_PURCHASES')) return res.status(409).json({error:'domain purchasing is disabled until sandbox testing is complete'});
    const { tenantId, siteId=null, domain:raw, years=1, contactId, confirm=false } = req.body || {}; const domain=cleanDomain(raw||'');
    if(!tenantId||!domain||confirm!==true) return res.status(400).json({error:'tenantId, domain and confirm:true are required'});
    const out = await namesilo('registerDomain',{domain,years,private:1,auto_renew:1,contact_id:contactId,payment_id:env.NAMESILO_PAYMENT_ID||undefined,portfolio:`client-${tenantId}`});
    const code=Number(out?.reply?.code); if(!(code>=300&&code<303)) return res.status(409).json({error:'registration failed',registrar:out.reply});
    const wholesaleCents=cents(out.reply.order_amount||0), retailCents=wholesaleCents+Number(env.NAMESILO_RESELLER_MARKUP_CENTS||1800);
    if(pool) await pool.query(`insert into platform_domains(tenant_id,site_id,domain,wholesale_cents,retail_cents,status,metadata) values($1,$2,$3,$4,$5,'registered',$6) on conflict(domain) do update set status='registered',updated_at=now(),metadata=excluded.metadata`,[tenantId,siteId,domain,wholesaleCents,retailCents,{registrarReply:out.reply}]);
    await event(tenantId,'domain.registered','namesilo',{domain,wholesaleCents,retailCents});
    res.status(201).json({domain,wholesaleCents,retailCents});
  } catch(e){ next(e); }
});

app.post('/v1/payments/stripe/onboard', requireAdmin, async (req,res,next) => {
  try {
    if(!stripe) throw new Error('STRIPE_SECRET_KEY is not configured'); if(!pool) throw new Error('DATABASE_URL is not configured');
    const {tenantId,email,country='US',dealMode='paid',revenueSharePercent=null,revenueShareTermMonths=null,revenueShareCapCents=null}=req.body||{};
    if(!tenantId||!email) return res.status(400).json({error:'tenantId and email are required'});
    const existing=await pool.query(`select * from platform_payment_accounts where tenant_id=$1 and provider='stripe'`,[tenantId]); let accountId=existing.rows[0]?.provider_account_id;
    if(!accountId){
      const account=await stripe.accounts.create({type:'express',country,email,capabilities:{card_payments:{requested:true},transfers:{requested:true}},metadata:{tenant_id:tenantId}}); accountId=account.id;
      await pool.query(`insert into platform_payment_accounts(tenant_id,provider,provider_account_id,onboarding_status,deal_mode,revenue_share_percent,revenue_share_term_months,revenue_share_cap_cents) values($1,'stripe',$2,'started',$3,$4,$5,$6)
        on conflict(tenant_id,provider) do update set provider_account_id=excluded.provider_account_id,onboarding_status='started',deal_mode=excluded.deal_mode,revenue_share_percent=excluded.revenue_share_percent,revenue_share_term_months=excluded.revenue_share_term_months,revenue_share_cap_cents=excluded.revenue_share_cap_cents,updated_at=now()`,[tenantId,accountId,dealMode==='equity_uprise'?'equity_uprise':'paid',revenueSharePercent,revenueShareTermMonths,revenueShareCapCents]);
    }
    const link=await stripe.accountLinks.create({account:accountId,type:'account_onboarding',refresh_url:env.STRIPE_REFRESH_URL||`${APP_ORIGIN}/account.html?stripe=refresh`,return_url:env.STRIPE_RETURN_URL||`${APP_ORIGIN}/account.html?stripe=return`});
    await event(tenantId,'payments.onboarding_link.created','stripe',{accountId,dealMode}); res.json({accountId,onboardingUrl:link.url,expiresAt:link.expires_at});
  } catch(e){ next(e); }
});

app.post('/v1/spaces', requireAdmin, async (req,res,next) => {
  try {
    if(!pool) throw new Error('DATABASE_URL is not configured'); const {tenantId,siteId=null,name,slug,kind='property',address=null,status='active',metadata={}}=req.body||{};
    if(!tenantId||!name) return res.status(400).json({error:'tenantId and name are required'});
    const q=await pool.query(`insert into platform_spaces(tenant_id,site_id,slug,name,kind,address,status,metadata) values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict(tenant_id,slug) do update set site_id=excluded.site_id,name=excluded.name,kind=excluded.kind,address=excluded.address,status=excluded.status,metadata=platform_spaces.metadata||excluded.metadata,updated_at=now() returning *`,[tenantId,siteId,slugify(slug||name),name,kind,address,status,metadata]);
    res.status(201).json(q.rows[0]);
  } catch(e){ next(e); }
});

app.post('/v1/spaces/:spaceId/captures', requireAdmin, async (req,res,next) => {
  try {
    if(!pool) throw new Error('DATABASE_URL is not configured'); const {captureType='reality-capture',sourceAssetIds=[],metadata={}}=req.body||{};
    const q=await pool.query(`insert into platform_spatial_captures(space_id,capture_type,source_asset_ids,metadata) values($1,$2,$3,$4) returning *`,[req.params.spaceId,captureType,sourceAssetIds,metadata]);
    res.status(201).json(q.rows[0]);
  } catch(e){ next(e); }
});

function runpodEndpointFor(type){
  if(type==='image-to-3d'&&env.RUNPOD_3D_ENDPOINT_ID) return env.RUNPOD_3D_ENDPOINT_ID;
  if(['gaussian-splat','reality-capture'].includes(type)&&env.RUNPOD_SPLAT_ENDPOINT_ID) return env.RUNPOD_SPLAT_ENDPOINT_ID;
  if(['video-clips','transcribe'].includes(type)&&env.RUNPOD_VIDEO_ENDPOINT_ID) return env.RUNPOD_VIDEO_ENDPOINT_ID;
  return env.RUNPOD_ENDPOINT_ID;
}

app.post('/v1/forge/jobs', requireAdmin, async (req,res,next) => {
  try {
    if(!bool('ENABLE_GPU_JOBS',true)) return res.status(404).end(); if(!env.RUNPOD_API_KEY) throw new Error('RUNPOD_API_KEY is not configured'); if(!pool) throw new Error('DATABASE_URL is not configured');
    const {tenantId=null,siteId=null,type,input={}}=req.body||{}; if(!type) return res.status(400).json({error:'type is required'}); const endpoint=runpodEndpointFor(type); if(!endpoint) throw new Error(`No Runpod endpoint is configured for ${type}`);
    const row=await pool.query(`insert into platform_jobs(tenant_id,site_id,type,input,status) values($1,$2,$3,$4,'queued') returning *`,[tenantId,siteId,type,input]); const localJob=row.rows[0];
    const r=await fetch(`https://api.runpod.ai/v2/${endpoint}/run`,{method:'POST',headers:{Authorization:`Bearer ${env.RUNPOD_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({input:{jobId:localJob.id,type,tenantId,siteId,...input}}),signal:AbortSignal.timeout(20000)}); const out=await r.json();
    if(!r.ok||!out.id){await pool.query(`update platform_jobs set status='failed',error=$2,updated_at=now() where id=$1`,[localJob.id,JSON.stringify(out)]);return res.status(502).json({error:'Runpod job submission failed',details:out});}
    await pool.query(`update platform_jobs set provider_job_id=$2,status='running',updated_at=now() where id=$1`,[localJob.id,out.id]); if(tenantId) await event(tenantId,'forge.job.started','runpod',{jobId:localJob.id,providerJobId:out.id,type});
    res.status(202).json({jobId:localJob.id,providerJobId:out.id,type,status:'running'});
  } catch(e){ next(e); }
});

app.get('/v1/forge/jobs/:id', requireAdmin, async (req,res,next) => {
  try {
    if(!pool) throw new Error('DATABASE_URL is not configured'); const q=await pool.query('select * from platform_jobs where id=$1',[req.params.id]); if(!q.rowCount)return res.status(404).json({error:'job not found'}); const job=q.rows[0];
    if(job.provider==='runpod'&&job.provider_job_id&&env.RUNPOD_API_KEY&&['queued','running'].includes(job.status)){
      const endpoint=runpodEndpointFor(job.type); const r=await fetch(`https://api.runpod.ai/v2/${endpoint}/status/${job.provider_job_id}`,{headers:{Authorization:`Bearer ${env.RUNPOD_API_KEY}`},signal:AbortSignal.timeout(15000)});
      if(r.ok){const out=await r.json();const map={COMPLETED:'succeeded',FAILED:'failed',CANCELLED:'cancelled',IN_QUEUE:'queued',IN_PROGRESS:'running'};const status=map[out.status]||job.status;await pool.query(`update platform_jobs set status=$2,output=coalesce($3,output),error=coalesce($4,error),updated_at=now(),completed_at=case when $2 in ('succeeded','failed','cancelled') then now() else completed_at end where id=$1`,[job.id,status,out.output||null,out.error?JSON.stringify(out.error):null]);}
    }
    res.json((await pool.query('select * from platform_jobs where id=$1',[req.params.id])).rows[0]);
  } catch(e){ next(e); }
});

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:err?.message||'internal error'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`McCluster Platform listening on ${PORT} (${PLATFORM_ORIGIN})`));
