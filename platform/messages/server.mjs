import express from 'express';
import pg from 'pg';
import twilio from 'twilio';

const { Pool } = pg;
const env = process.env;
const PORT = Number(env.PORT || 8082);
const pool = env.DATABASE_URL ? new Pool({ connectionString:env.DATABASE_URL, ssl:env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined, max:6 }) : null;
const client = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? twilio(env.TWILIO_ACCOUNT_SID,env.TWILIO_AUTH_TOKEN) : null;
const app = express();
app.disable('x-powered-by');

function requireAdmin(req,res,next){ const token=req.get('x-admin-token')||req.get('authorization')?.replace(/^Bearer\s+/i,''); if(!env.ADMIN_TOKEN)return res.status(503).json({error:'ADMIN_TOKEN is not configured'}); if(token!==env.ADMIN_TOKEN)return res.status(401).json({error:'unauthorized'}); next(); }
function need(){ if(!pool) throw new Error('DATABASE_URL is not configured'); if(!client) throw new Error('Twilio credentials are not configured'); }
function e164(v=''){const s=String(v).replace(/[^+\d]/g,'');return /^\+[1-9]\d{7,14}$/.test(s)?s:null;}
async function latestConsent(tenantId,phone){ const q=await pool.query(`select * from messaging_consents where tenant_id=$1 and phone_e164=$2 order by occurred_at desc limit 1`,[tenantId,phone]); return q.rows[0]||null; }

app.post('/v1/webhooks/twilio/inbound', express.urlencoded({extended:false}), async (req,res,next)=>{
  try{
    need();
    const signature=req.get('x-twilio-signature')||'';
    const publicBase=(env.MESSAGES_PUBLIC_ORIGIN||'').replace(/\/$/,'');
    const url=`${publicBase}/v1/webhooks/twilio/inbound`;
    if(env.NODE_ENV==='production' && (!publicBase || !twilio.validateRequest(env.TWILIO_AUTH_TOKEN,signature,url,req.body))) return res.status(403).send('invalid signature');
    const from=e164(req.body.From), to=e164(req.body.To), sid=String(req.body.MessageSid||'');
    if(!from||!to||!sid) return res.status(400).send('bad request');
    const number=await pool.query('select * from messaging_numbers where e164=$1',[to]);
    if(!number.rowCount) return res.status(404).send('unknown number');
    const tenantId=number.rows[0].tenant_id;
    const contact=await pool.query(`insert into messaging_contacts(tenant_id,phone_e164) values($1,$2) on conflict(tenant_id,phone_e164) do update set updated_at=now() returning *`,[tenantId,from]);
    const body=String(req.body.Body||''); const upper=body.trim().toUpperCase();
    if(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(upper)) await pool.query(`insert into messaging_consents(tenant_id,contact_id,phone_e164,purpose,status,source,evidence) values($1,$2,$3,'general','opted_out','sms-keyword',$4)`,[tenantId,contact.rows[0].id,from,{keyword:upper,messageSid:sid}]);
    if(['START','UNSTOP'].includes(upper)) await pool.query(`insert into messaging_consents(tenant_id,contact_id,phone_e164,purpose,status,source,evidence) values($1,$2,$3,'general','opted_in','sms-keyword',$4)`,[tenantId,contact.rows[0].id,from,{keyword:upper,messageSid:sid}]);
    await pool.query(`insert into messaging_messages(tenant_id,contact_id,direction,from_e164,to_e164,body,provider_message_id,status,metadata) values($1,$2,'inbound',$3,$4,$5,$6,'received',$7)`,[tenantId,contact.rows[0].id,from,to,body,sid,{numMedia:Number(req.body.NumMedia||0)}]);
    res.type('text/xml').send('<Response></Response>');
  }catch(e){next(e);}
});

app.post('/v1/webhooks/twilio/status', express.urlencoded({extended:false}), async (req,res,next)=>{
  try{
    need(); const signature=req.get('x-twilio-signature')||''; const publicBase=(env.MESSAGES_PUBLIC_ORIGIN||'').replace(/\/$/,''); const url=`${publicBase}/v1/webhooks/twilio/status`;
    if(env.NODE_ENV==='production' && (!publicBase || !twilio.validateRequest(env.TWILIO_AUTH_TOKEN,signature,url,req.body))) return res.status(403).send('invalid signature');
    const sid=String(req.body.MessageSid||''); const status=String(req.body.MessageStatus||'unknown');
    if(sid) await pool.query(`update messaging_messages set status=$2,error_code=$3,error_message=$4,delivered_at=case when $2='delivered' then now() else delivered_at end where provider='twilio' and provider_message_id=$1`,[sid,status,req.body.ErrorCode||null,req.body.ErrorMessage||null]);
    res.sendStatus(204);
  }catch(e){next(e);}
});

app.use(express.json({limit:'2mb'}));
app.get('/health',async(_req,res)=>{try{if(!pool)throw new Error('DATABASE_URL missing');await pool.query('select 1');res.json({ok:true,service:'mccluster-messages',twilioConfigured:Boolean(client)});}catch(e){res.status(503).json({ok:false,error:e.message});}});

app.post('/v1/messages/consent',requireAdmin,async(req,res,next)=>{try{if(!pool)throw new Error('DATABASE_URL missing');const {tenantId,phone,status='opted_in',purpose='general',source='web-form',evidence={}}=req.body||{};const p=e164(phone);if(!tenantId||!p||!['opted_in','opted_out'].includes(status))return res.status(400).json({error:'tenantId, E.164 phone and valid status required'});const c=await pool.query(`insert into messaging_contacts(tenant_id,phone_e164) values($1,$2) on conflict(tenant_id,phone_e164) do update set updated_at=now() returning *`,[tenantId,p]);const q=await pool.query(`insert into messaging_consents(tenant_id,contact_id,phone_e164,purpose,status,source,evidence) values($1,$2,$3,$4,$5,$6,$7) returning *`,[tenantId,c.rows[0].id,p,purpose,status,source,evidence]);res.status(201).json(q.rows[0]);}catch(e){next(e);}});

app.post('/v1/messages/send',requireAdmin,async(req,res,next)=>{try{
  need(); const {tenantId,to,body,mediaUrls=[],purpose='general',from=null}=req.body||{}; const dest=e164(to), explicitFrom=e164(from||'');
  if(!tenantId||!dest||(!body&&!mediaUrls.length)) return res.status(400).json({error:'tenantId, E.164 to, and body or mediaUrls required'});
  const consent=await latestConsent(tenantId,dest); if(!consent||consent.status!=='opted_in') return res.status(409).json({error:'recipient does not have current opt-in consent',phone:dest});
  const acct=await pool.query(`select * from messaging_accounts where tenant_id=$1 and provider='twilio' and status='active'`,[tenantId]); if(!acct.rowCount) return res.status(409).json({error:'tenant messaging account is not active'});
  const opts={to:dest,body:String(body||''),statusCallback:`${String(env.MESSAGES_PUBLIC_ORIGIN||'').replace(/\/$/,'')}/v1/webhooks/twilio/status`}; if(mediaUrls.length)opts.mediaUrl=mediaUrls;
  if(acct.rows[0].provider_messaging_service_id) opts.messagingServiceSid=acct.rows[0].provider_messaging_service_id; else if(explicitFrom) opts.from=explicitFrom; else return res.status(409).json({error:'messaging service or from number required'});
  const m=await client.messages.create(opts); const c=await pool.query(`insert into messaging_contacts(tenant_id,phone_e164) values($1,$2) on conflict(tenant_id,phone_e164) do update set updated_at=now() returning *`,[tenantId,dest]);
  const q=await pool.query(`insert into messaging_messages(tenant_id,contact_id,direction,from_e164,to_e164,body,media,provider_message_id,status,sent_at,metadata) values($1,$2,'outbound',$3,$4,$5,$6,$7,$8,now(),$9) returning *`,[tenantId,c.rows[0].id,m.from||explicitFrom||'service',dest,String(body||''),mediaUrls,m.sid,m.status,{purpose}]);res.status(202).json(q.rows[0]);
}catch(e){next(e);}});

app.get('/v1/messages',requireAdmin,async(req,res,next)=>{try{if(!pool)throw new Error('DATABASE_URL missing');const tenantId=req.query.tenantId;if(!tenantId)return res.status(400).json({error:'tenantId required'});const q=await pool.query(`select * from messaging_messages where tenant_id=$1 order by created_at desc limit 250`,[tenantId]);res.json(q.rows);}catch(e){next(e);}});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:err?.message||'internal error'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`McCluster Messages listening on ${PORT}`));
