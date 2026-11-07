// Isolated SQL fixture. Synthetic identities; never imported by shipped code.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {PGlite}=createRequire(join(process.env.PGLITE_DIR||'/tmp/readiness-tools/node_modules','entry.cjs'))('@electric-sql/pglite');
export const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
export async function fixture(){
 const db=new PGlite();await db.exec(await readFile(new URL('../../../supabase/tests/owner_widget_definitions.stub.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../../supabase/pending/owner_widget_definitions_v1.sql',import.meta.url),'utf8'));
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${OWNER}',false);`);
 const rpc=async(name,body={})=>{
  const params=name==='owner_widget_snapshot_v1'?[body.p_app_key??null]:[body.p_app_key,body.p_action,body.p_expected_revision??null,body.p_expected_draft??null,body.p_value??null,body.p_history_id??null];
  return (await db.query(`select public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) as result`,params)).rows[0].result;
 };
 return {db,rpc,snapshot:app=>rpc('owner_widget_snapshot_v1',{p_app_key:app}),async edit(s,action,value,history){return rpc('owner_widget_edit_v1',{p_app_key:s.app_key,p_action:action,p_expected_revision:s.revision,p_expected_draft:s.draft?.revision??null,p_value:value,p_history_id:history});}};
}
