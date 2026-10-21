#!/usr/bin/env node
// Read-only comparison: node scripts/supabase-compare-live-ledger.mjs live-migrations.json
// live-migrations.json is an array of {version,name}, exported from Supabase migration history.
// Never repairs production history or infers migration SQL from names.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source=process.argv[2];
if(!source){console.error('Usage: node scripts/supabase-compare-live-ledger.mjs <live-migrations.json>');process.exit(2);}
const raw=JSON.parse(await readFile(source,'utf8'));
const live=Array.isArray(raw)?raw:raw.migrations;
if(!Array.isArray(live))throw Error('Expected migrations array');
const ledger=JSON.parse(await readFile(new URL('../supabase/production-ledger.json',import.meta.url),'utf8'));
const contract=JSON.parse(await readFile(new URL('../core/drift-contract.json',import.meta.url),'utf8'));
const order=rows=>[...rows].map(x=>({version:String(x.version),name:String(x.name)})).sort((a,b)=>a.version.localeCompare(b.version));
const digest=rows=>createHash('sha256').update(order(rows).map(x=>x.version+':'+x.name).join('\n'),'utf8').digest('hex');
const byVersion=new Map(live.map(x=>[String(x.version),x]));
const used=new Set();
const aliases=[];
const unresolved=[];
for(const row of ledger.migrations){
 const version=String(row.applied_version||row.version);
 const match=byVersion.get(version);
 if(!match){unresolved.push({ledger_version:row.version,applied_version:version,name:row.name});continue;}
 used.add(version);
 if(match.name!==row.name)aliases.push({version,ledger_name:row.name,production_name:match.name});
}
const productionOnly=live.filter(x=>!used.has(String(x.version)));
const report={
 production:{count:live.length,latest:order(live).at(-1),sha256:digest(live)},
 repository:{count:ledger.migrations.length,latest:order(ledger.migrations).at(-1),sha256:digest(ledger.migrations)},
 drift_contract:contract.supabase,
 production_only:productionOnly,ledger_unresolved:unresolved,aliases,
 safe_to_repair_automatically:false,
 note:'The repo migration files and production SQL must be independently verified before changing canonical history.'
};
console.log(JSON.stringify(report,null,2));
if(productionOnly.length||unresolved.length)process.exitCode=1;
