import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { sha256 } from './distributed-auth.mjs';

const { Pool } = pg;
const env=process.env;
for(const key of ['LOCAL_DATABASE_URL','NODE_CODE','BUILDING_CODE','NODE_KEY_ID','NODE_SHARED_SECRET','CONTROL_PLANE_URL','LOCAL_ADMIN_TOKEN']) if(!env[key]) throw new Error(`${key} is required`);
const pool=new Pool({connectionString:env.LOCAL_DATABASE_URL,max:8});
const port=Number(env.BUILDING_NODE_PORT||8100);
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));

async function initialize(){
  await pool.query(`
    create table if not exists local_event_sequences(stream text primary key,next_sequence bigint not null default 1);
    create table if not exists local_event_outbox(
      id uuid primary key,stream text not null,sequence bigint not null,event_type text not null,
      occurred_at timestamptz not null,payload jsonb not null default '{}'::jsonb,
      delivered_at timestamptz,attempts integer not null default 0,last_error text,
      unique(stream,sequence)
    );
    create table if not exists local_command_receipts(
      command_id uuid primary key,command_type text not null,payload jsonb not null,
      status text not null,result jsonb,received_at timestamptz not null default now(),completed_at timestamptz
    );
  `);
}

function localAdmin(req,res,next){
  const token=req.get('authorization')?.replace(/^Bearer\s+/i,'')||req.get('x-admin-token');
  if(token!==env.LOCAL_ADMIN_TOKEN)return res.status(401).json({error:'unauthorized'});
  next();
}

async function emitEvent(stream,eventType,payload={}){
  const client=await pool.connect();
  try{
    await client.query('begin');
    await client.query('insert into local_event_sequences(stream) values($1) on conflict do nothing',[stream]);
    const seq=await client.query('update local_event_sequences set next_sequence=next_sequence+1 where stream=$1 returning next_sequence-1 sequence',[stream]);
    const id=crypto.randomUUID();
    await client.query(`insert into local_event_outbox(id,stream,sequence,event_type,occurred_at,payload) values($1,$2,$3,$4,now(),$5)`,[id,stream,seq.rows[0].sequence,eventType,payload]);
    await client.query('commit');
    return {id,sequence:seq.rows[0].sequence};
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}

function signedHeaders(rawBody){
  const timestamp=String(Date.now()),bodyHash=sha256(rawBody),secretHash=sha256(env.NODE_SHARED_SECRET);
  return {'content-type':'application/json','x-node-code':env.NODE_CODE,'x-key-id':env.NODE_KEY_ID,'x-timestamp':timestamp,'x-body-sha256':bodyHash,'x-signature':sha256(`${timestamp}.${bodyHash}.${secretHash}`)};
}

async function controlRequest(path,body={}){
  const raw=JSON.stringify(body);
  const response=await fetch(new URL(path,env.CONTROL_PLANE_URL),{method:'POST',headers:signedHeaders(raw),body:raw,signal:AbortSignal.timeout(15000)});
  const output=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`control plane ${response.status}: ${output.error||'request failed'}`);
  return output;
}

async function syncOutbox(){
  const q=await pool.query(`select id,stream,sequence,event_type "eventType",occurred_at "occurredAt",payload from local_event_outbox where delivered_at is null order by occurred_at limit 250`);
  if(!q.rowCount)return 0;
  try{
    const result=await controlRequest('/v1/node/events',{buildingCode:env.BUILDING_CODE,events:q.rows});
    await pool.query('update local_event_outbox set delivered_at=now(),last_error=null where id=any($1::uuid[])',[result.eventIds]);
    return result.accepted;
  }catch(error){
    await pool.query('update local_event_outbox set attempts=attempts+1,last_error=$2 where id=any($1::uuid[])',[q.rows.map(x=>x.id),String(error.message).slice(0,500)]);
    throw error;
  }
}

async function pollCommands(){
  if(String(env.NODE_ACTIVE||'false')!=='true')return 0;
  const result=await controlRequest('/v1/node/commands/poll',{buildingCode:env.BUILDING_CODE});
  for(const command of result.commands||[]){
    const inserted=await pool.query(`insert into local_command_receipts(command_id,command_type,payload,status) values($1,$2,$3,'received') on conflict do nothing returning command_id`,[command.id,command.command_type,command.payload]);
    if(!inserted.rowCount){await controlRequest(`/v1/node/commands/${command.id}/ack`,{ok:true,result:{duplicate:true}});continue;}
    // Physical and safety-sensitive actions are never executed by this generic agent.
    const resultData={queuedLocally:true,requiresLocalExecutor:true,safetyClass:command.safety_class};
    await pool.query(`update local_command_receipts set status='queued_local',result=$2 where command_id=$1`,[command.id,resultData]);
    await controlRequest(`/v1/node/commands/${command.id}/ack`,{ok:true,result:resultData});
  }
  return (result.commands||[]).length;
}

async function heartbeat(){
  return controlRequest('/v1/node/heartbeat',{buildingCode:env.BUILDING_CODE,softwareVersion:env.SOFTWARE_VERSION||'0.1.0',privateAddress:env.PRIVATE_ADDRESS||null,active:String(env.NODE_ACTIVE||'false')==='true',capabilities:{localFirst:true,outbox:true,commandInbox:true}});
}

app.get('/health',async(req,res)=>{
  try{await pool.query('select 1');const pending=await pool.query('select count(*)::int count from local_event_outbox where delivered_at is null');res.json({ok:true,nodeCode:env.NODE_CODE,buildingCode:env.BUILDING_CODE,active:String(env.NODE_ACTIVE||'false')==='true',pendingEvents:pending.rows[0].count});}
  catch{res.status(503).json({ok:false});}
});
app.post('/v1/local/events',localAdmin,async(req,res,next)=>{
  try{const {stream='operations',eventType,payload={}}=req.body||{};if(!eventType)return res.status(400).json({error:'eventType is required'});res.status(202).json(await emitEvent(stream,eventType,payload));}catch(error){next(error);}
});
app.post('/v1/local/sync',localAdmin,async(req,res,next)=>{try{res.json({synced:await syncOutbox()});}catch(error){next(error);}});
app.use((error,req,res,next)=>{console.error(error);res.status(500).json({error:error.message});});

await initialize();
setInterval(()=>syncOutbox().catch(error=>console.error('outbox sync',error.message)),Number(env.SYNC_INTERVAL_MS||5000)).unref();
setInterval(()=>pollCommands().catch(error=>console.error('command poll',error.message)),Number(env.COMMAND_POLL_INTERVAL_MS||5000)).unref();
setInterval(()=>heartbeat().catch(error=>console.error('heartbeat',error.message)),Number(env.HEARTBEAT_INTERVAL_MS||30000)).unref();
await heartbeat().catch(error=>console.error('initial heartbeat',error.message));
app.listen(port,'127.0.0.1',()=>console.log(`HERE building node ${env.NODE_CODE} listening locally on ${port}`));
