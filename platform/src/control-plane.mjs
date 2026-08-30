import express from 'express';
import pg from 'pg';
import { requestIsFresh, safeEqualHex, sha256 } from './distributed-auth.mjs';

const { Pool } = pg;
const env = process.env;
const port = Number(env.CONTROL_PLANE_PORT || 8090);
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: env.DATABASE_URL, ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined, max:12 });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit:'2mb', verify:(req,res,buffer)=>{ req.rawBody = Buffer.from(buffer); } }));

function admin(req,res,next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i,'') || req.get('x-admin-token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return res.status(401).json({error:'unauthorized'});
  next();
}

async function nodeAuth(req,res,next) {
  try {
    const nodeCode=req.get('x-node-code'), keyId=req.get('x-key-id'), timestamp=req.get('x-timestamp');
    const bodyHash=req.get('x-body-sha256'), signature=req.get('x-signature');
    if (!nodeCode || !keyId || !timestamp || !bodyHash || !signature || !requestIsFresh(timestamp)) return res.status(401).json({error:'invalid node authentication'});
    const actualHash=sha256(req.rawBody || Buffer.alloc(0));
    if (!safeEqualHex(actualHash,bodyHash)) return res.status(401).json({error:'body hash mismatch'});
    const q=await pool.query(`select n.id,n.node_code,n.building_id,c.secret_hash from platform_server_nodes n join platform_node_credentials c on c.node_id=n.id where n.node_code=$1 and c.key_id=$2 and c.enabled=true`,[nodeCode,keyId]);
    if (!q.rowCount) return res.status(401).json({error:'unknown node'});
    const expected=sha256(`${timestamp}.${bodyHash}.${q.rows[0].secret_hash}`);
    if (!safeEqualHex(expected,signature)) return res.status(401).json({error:'invalid signature'});
    req.node=q.rows[0]; next();
  } catch(error) { next(error); }
}

app.get('/health', async (req,res)=>{
  try { await pool.query('select 1'); res.json({ok:true,service:'here-control-plane',now:new Date().toISOString()}); }
  catch { res.status(503).json({ok:false}); }
});

app.post('/v1/node/heartbeat',nodeAuth,async(req,res,next)=>{
  try {
    const {softwareVersion=null,privateAddress=null,capabilities={},active=false}=req.body||{};
    await pool.query(`update platform_server_nodes set status='healthy',active=$2,last_heartbeat_at=now(),software_version=$3,private_address=$4,capabilities=$5,updated_at=now() where id=$1`,[req.node.id,Boolean(active),softwareVersion,privateAddress,capabilities]);
    res.json({accepted:true,serverTime:new Date().toISOString()});
  } catch(error){next(error);}
});

app.post('/v1/node/events',nodeAuth,async(req,res,next)=>{
  const client=await pool.connect();
  try {
    const events=Array.isArray(req.body?.events)?req.body.events:[];
    if(events.length>500) return res.status(413).json({error:'maximum batch is 500 events'});
    await client.query('begin');
    let accepted=0;
    for(const event of events){
      const q=await client.query(`insert into platform_building_events(id,building_id,source_node_id,stream,sequence,event_type,occurred_at,payload)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do nothing`,[event.id,req.node.building_id,req.node.id,event.stream,event.sequence,event.eventType,event.occurredAt,event.payload||{}]);
      accepted+=q.rowCount;
    }
    await client.query('commit');
    res.json({accepted,duplicates:events.length-accepted,eventIds:events.map(x=>x.id)});
  } catch(error){await client.query('rollback');next(error);} finally{client.release();}
});

app.post('/v1/node/commands/poll',nodeAuth,async(req,res,next)=>{
  const client=await pool.connect();
  try {
    await client.query('begin');
    await client.query(`update platform_building_commands set status='queued',target_node_id=null,leased_until=null,updated_at=now() where building_id=$1 and status='leased' and leased_until<now()`,[req.node.building_id]);
    const q=await client.query(`select id,command_type,payload,safety_class,expires_at from platform_building_commands
      where building_id=$1 and status='queued' and not_before<=now() and (expires_at is null or expires_at>now())
      order by created_at limit 25 for update skip locked`,[req.node.building_id]);
    if(q.rowCount) await client.query(`update platform_building_commands set status='leased',target_node_id=$2,leased_until=now()+interval '60 seconds',updated_at=now() where id=any($1::uuid[])`,[q.rows.map(x=>x.id),req.node.id]);
    await client.query('commit'); res.json({commands:q.rows});
  } catch(error){await client.query('rollback');next(error);} finally{client.release();}
});

app.post('/v1/node/commands/:id/ack',nodeAuth,async(req,res,next)=>{
  try {
    const {ok=true,result={}}=req.body||{};
    const q=await pool.query(`update platform_building_commands set status=$3,result=$4,acknowledged_at=now(),updated_at=now()
      where id=$1 and target_node_id=$2 and status='leased' returning id`,[req.params.id,req.node.id,ok?'acknowledged':'failed',result]);
    if(!q.rowCount)return res.status(409).json({error:'command is not leased to this node'});
    res.json({accepted:true});
  } catch(error){next(error);}
});

app.post('/v1/admin/commands',admin,async(req,res,next)=>{
  try {
    const {buildingCode,commandType,payload={},safetyClass='normal',idempotencyKey,expiresAt=null}=req.body||{};
    if(!buildingCode||!commandType||!idempotencyKey)return res.status(400).json({error:'buildingCode, commandType and idempotencyKey are required'});
    if(safetyClass==='local_only')return res.status(400).json({error:'local_only commands cannot enter the central control plane'});
    const q=await pool.query(`insert into platform_building_commands(building_id,command_type,payload,safety_class,idempotency_key,expires_at)
      select id,$2,$3,$4,$5,$6 from platform_buildings where code=$1
      on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning *`,[buildingCode,commandType,payload,safetyClass,idempotencyKey,expiresAt]);
    if(!q.rowCount)return res.status(404).json({error:'building not found'});
    res.status(202).json(q.rows[0]);
  } catch(error){next(error);}
});

app.use((error,req,res,next)=>{console.error(error);res.status(500).json({error:'internal error'});});
app.listen(port,'0.0.0.0',()=>console.log(`HERE control plane listening on ${port}`));
