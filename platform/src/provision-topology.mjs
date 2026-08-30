import fs from 'node:fs/promises';
import pg from 'pg';
import { sha256 } from './distributed-auth.mjs';

const {Pool}=pg;
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const inventory=JSON.parse(await fs.readFile(new URL('../config/server-inventory.json',import.meta.url),'utf8'));
if(inventory.servers.length!==33)throw new Error(`inventory must contain exactly 33 servers, found ${inventory.servers.length}`);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
const client=await pool.connect();
try{
  await client.query('begin');
  for(const building of inventory.buildings){
    await client.query(`insert into platform_buildings(code,name,timezone,mode,status,metadata) values($1,$2,$3,$4,'provisioning',$5)
      on conflict(code) do update set name=excluded.name,timezone=excluded.timezone,metadata=platform_buildings.metadata||excluded.metadata,updated_at=now()`,[building.code,building.name,building.timezone,building.mode,{inventoryVersion:inventory.version}]);
  }
  for(const server of inventory.servers){
    await client.query(`insert into platform_server_nodes(building_id,node_code,role,ordinal,status,capabilities,metadata)
      select b.id,$2,$3,$4,'provisioning',$5,$6 from (select $1::text code) x left join platform_buildings b on b.code=x.code
      on conflict(node_code) do update set building_id=excluded.building_id,role=excluded.role,ordinal=excluded.ordinal,capabilities=excluded.capabilities,metadata=platform_server_nodes.metadata||excluded.metadata,updated_at=now()`,[
        server.buildingCode,server.nodeCode,server.role,server.ordinal,
        server.role.startsWith('building_')?{localFirst:true,paired:true}:{},
        {inventoryVersion:inventory.version}
      ]);
  }
  await client.query('commit');
  console.log(`Provisioned ${inventory.buildings.length} buildings and ${inventory.servers.length} server records`);
}catch(error){await client.query('rollback');throw error;}finally{client.release();await pool.end();}
