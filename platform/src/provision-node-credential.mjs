import pg from 'pg';
import { sha256 } from './distributed-auth.mjs';

const {Pool}=pg;
for(const key of ['DATABASE_URL','NODE_CODE','NODE_KEY_ID','NODE_SHARED_SECRET'])if(!process.env[key])throw new Error(`${key} is required`);
if(process.env.NODE_SHARED_SECRET.length<32)throw new Error('NODE_SHARED_SECRET must be at least 32 characters');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
const q=await pool.query(`insert into platform_node_credentials(node_id,key_id,secret_hash)
  select id,$2,$3 from platform_server_nodes where node_code=$1
  on conflict(node_id) do update set key_id=excluded.key_id,secret_hash=excluded.secret_hash,enabled=true,rotated_at=now()
  returning node_id,key_id`,[process.env.NODE_CODE,process.env.NODE_KEY_ID,sha256(process.env.NODE_SHARED_SECRET)]);
if(!q.rowCount)throw new Error('NODE_CODE does not exist; run topology provisioning first');
console.log(`Credential provisioned for ${process.env.NODE_CODE} with key ${process.env.NODE_KEY_ID}`);
await pool.end();
