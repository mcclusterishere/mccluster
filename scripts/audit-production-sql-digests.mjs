// Compare the read-only Supabase migration statement digest snapshot to
// committed canonical SQL. This does not connect to production or execute SQL.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const snapshotPath=process.argv[2]||'docs/control-plane/production-sql-digests-20261021.json';
const snapshot=JSON.parse(readFileSync(snapshotPath,'utf8'));
const ledger=JSON.parse(readFileSync('supabase/production-ledger.json','utf8'));
const rows=snapshot.migrations;
if(snapshot.project_ref!==ledger.project_ref) throw Error('Wrong Supabase project');
if(snapshot.migration_count!==rows.length) throw Error('Snapshot count mismatch');
if(new Set(rows.map(x=>x.version)).size!==rows.length) throw Error('Duplicate production migration version');
const byVersion=new Map(rows.map(x=>[x.version,x]));
const results=[];
for(const entry of ledger.migrations){
 const stored=byVersion.get(entry.version);
 const file=join('supabase/migrations',entry.version+'_'+entry.name+'.sql');
 if(!stored){results.push({version:entry.version,name:entry.name,status:'not_in_snapshot'});continue}
 if(stored.name!==entry.name){results.push({version:entry.version,name:entry.name,live_name:stored.name,status:'name_mismatch'});continue}
 if(!existsSync(file)){results.push({version:entry.version,name:entry.name,status:'missing_canonical_file'});continue}
 const sql=readFileSync(file,'utf8');
 const hash=createHash('sha256').update(sql).digest('hex');
 let status;
 if(/^\d{4}$/.test(entry.version)) status='legacy_anchor_not_exact';
 else if(stored.statement_count!==1) status='multi_statement_review';
 else status=hash===stored.stored_sha256?'exact':'sql_hash_mismatch';
 results.push({version:entry.version,name:entry.name,status,...(status==='sql_hash_mismatch'?{stored_sha256:stored.stored_sha256,source_sha256:hash,stored_bytes:stored.stored_bytes,source_bytes:Buffer.byteLength(sql,'utf8')}: {})});
}
for(const stored of rows)if(!ledger.migrations.some(x=>x.version===stored.version))results.push({version:stored.version,name:stored.name,status:'unregistered_live_migration'});
const counts=Object.fromEntries([...new Set(results.map(x=>x.status))].sort().map(status=>[status,results.filter(x=>x.status===status).length]));
const exceptions=results.filter(x=>!['exact','legacy_anchor_not_exact'].includes(x.status));
const postCutover=results.filter(x=>x.version >= ledger.production_sql_cutover_version);
const postCutoverCounts=Object.fromEntries([...new Set(postCutover.map(x=>x.status))].sort().map(status=>[status,postCutover.filter(x=>x.status===status).length]));
const report={snapshot:snapshotPath,project_ref:snapshot.project_ref,live_count:rows.length,ledger_count:ledger.migrations.length,latest_version:snapshot.latest_version,counts,post_cutover_counts:postCutoverCounts,exceptions};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--strict')&&exceptions.length)process.exitCode=1;
