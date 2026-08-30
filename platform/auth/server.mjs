import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';

const { Pool } = pg;
const env = process.env;
const PORT = Number(env.PORT || 8081);
const CLIENT_ID = env.GOOGLE_CLIENT_ID || '';
const COOKIE_NAME = env.AUTH_COOKIE_NAME || 'mcc_session';
const COOKIE_DOMAIN = env.AUTH_COOKIE_DOMAIN || '.mccluster.org';
const SESSION_DAYS = Math.max(1, Number(env.AUTH_SESSION_DAYS || 30));
const APP_ORIGIN = env.APP_ORIGIN || 'https://matthew.mccluster.org';
const ALLOWED_ORIGINS = new Set(String(env.ALLOWED_ORIGINS || APP_ORIGIN).split(',').map(v=>v.trim()).filter(Boolean));
const oauth = new OAuth2Client(CLIENT_ID || undefined);
const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined, max: 6 }) : null;
const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));

const sha256 = (s='') => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeUser = (u) => u ? ({ id:u.id, email:u.email, displayName:u.display_name, avatarUrl:u.avatar_url, status:u.status }) : null;
function parseCookies(header='') { return Object.fromEntries(header.split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return i<0?[v,'']:[v.slice(0,i),decodeURIComponent(v.slice(i+1))];})); }
function setCors(req,res,next){ const origin=req.get('origin'); if(origin && ALLOWED_ORIGINS.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');} res.setHeader('Access-Control-Allow-Headers','content-type,authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); if(req.method==='OPTIONS') return res.sendStatus(204); next(); }
app.use(setCors);

function cookie(value,maxAge){ const attrs=[`${COOKIE_NAME}=${encodeURIComponent(value)}`,'Path=/','HttpOnly','Secure','SameSite=Lax']; if(COOKIE_DOMAIN) attrs.push(`Domain=${COOKIE_DOMAIN}`); if(maxAge!=null) attrs.push(`Max-Age=${maxAge}`); return attrs.join('; '); }
async function db(){ if(!pool) throw new Error('DATABASE_URL is not configured'); await pool.query('select 1'); }
async function sessionFrom(req){
  if(!pool) return null;
  const bearer=req.get('authorization')?.replace(/^Bearer\s+/i,'');
  const token=bearer || parseCookies(req.get('cookie')||'')[COOKIE_NAME];
  if(!token) return null;
  const q=await pool.query(`select u.* from platform_sessions s join platform_users u on u.id=s.user_id where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now() and u.status='active'`,[sha256(token)]);
  return q.rows[0]||null;
}

app.get('/health', async (_req,res)=>{ try{await db();res.json({ok:true,service:'mccluster-auth',googleConfigured:Boolean(CLIENT_ID)});}catch(e){res.status(503).json({ok:false,error:e.message});} });
app.get('/v1/auth/config', (_req,res)=>res.json({googleClientId:CLIENT_ID||null,cookieDomain:COOKIE_DOMAIN}));

app.post('/v1/auth/google', async (req,res,next)=>{
  try{
    await db();
    if(!CLIENT_ID) return res.status(503).json({error:'GOOGLE_CLIENT_ID is not configured'});
    const credential=String(req.body?.credential||'');
    if(!credential) return res.status(400).json({error:'credential is required'});
    const ticket=await oauth.verifyIdToken({idToken:credential,audience:CLIENT_ID});
    const p=ticket.getPayload();
    if(!p?.sub || !p?.email || !p.email_verified) return res.status(401).json({error:'verified Google email is required'});
    const client=await pool.connect();
    try{
      await client.query('begin');
      let identity=await client.query(`select u.* from platform_identities i join platform_users u on u.id=i.user_id where i.provider='google' and i.provider_subject=$1`,[p.sub]);
      let user=identity.rows[0];
      if(!user){
        let uq=await client.query(`insert into platform_users(email,display_name,avatar_url,metadata) values($1,$2,$3,$4) on conflict(email) do update set display_name=coalesce(excluded.display_name,platform_users.display_name),avatar_url=coalesce(excluded.avatar_url,platform_users.avatar_url),updated_at=now() returning *`,[p.email,p.name||null,p.picture||null,{locale:p.locale||null}]);
        user=uq.rows[0];
        await client.query(`insert into platform_identities(user_id,provider,provider_subject,provider_email,claims) values($1,'google',$2,$3,$4) on conflict(provider,provider_subject) do update set provider_email=excluded.provider_email,claims=excluded.claims,updated_at=now()`,[user.id,p.sub,p.email,{hd:p.hd||null,email_verified:p.email_verified,name:p.name||null,picture:p.picture||null}]);
      }
      const raw=crypto.randomBytes(32).toString('base64url');
      const expires=new Date(Date.now()+SESSION_DAYS*86400000);
      const ip=req.get('cf-connecting-ip')||req.ip||'';
      await client.query(`insert into platform_sessions(user_id,token_hash,expires_at,ip_hash,user_agent) values($1,$2,$3,$4,$5)`,[user.id,sha256(raw),expires,sha256(`${env.SUBMISSION_SALT||'auth'}:${ip}`),String(req.get('user-agent')||'').slice(0,500)]);
      await client.query('commit');
      res.setHeader('Set-Cookie',cookie(raw,SESSION_DAYS*86400));
      res.json({ok:true,user:safeUser(user),expiresAt:expires.toISOString()});
    } catch(e){await client.query('rollback');throw e;} finally{client.release();}
  }catch(e){next(e);}
});

app.get('/v1/auth/session', async (req,res,next)=>{ try{const user=await sessionFrom(req); if(!user)return res.status(401).json({authenticated:false}); const memberships=await pool.query(`select m.tenant_id,m.role,t.slug,t.display_name from platform_memberships m join platform_tenants t on t.id=m.tenant_id where m.user_id=$1 order by t.display_name`,[user.id]); res.json({authenticated:true,user:safeUser(user),memberships:memberships.rows});}catch(e){next(e);} });
app.post('/v1/auth/logout', async (req,res,next)=>{ try{const token=parseCookies(req.get('cookie')||'')[COOKIE_NAME]; if(pool&&token) await pool.query('update platform_sessions set revoked_at=now() where token_hash=$1',[sha256(token)]); res.setHeader('Set-Cookie',cookie('',0)); res.json({ok:true});}catch(e){next(e);} });

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:err?.message||'internal error'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`McCluster Auth listening on ${PORT}`));
