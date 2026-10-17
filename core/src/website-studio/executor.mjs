/** Loopback HTTP executor for the EXISTING compute node agent. Configure the
 * agent's studio-native-1 implementation to this service; no service-role key
 * enters a compute node. The job-specific ticket authorizes only one asset.
 */
import http from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {prepareMedia} from './prepare.mjs';
async function bytes(response,max){const reader=response.body.getReader(),parts=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw Error('Media byte limit exceeded');}parts.push(value);}}finally{reader.releaseLock();}return Buffer.concat(parts);}
export async function executeStudioTask(input,{fetcher=fetch,allowedOrigin='https://api.mccluster.org'}={}){
 if(input?.origin!==allowedOrigin||!/^[a-f0-9-]{36}$/.test(input?.asset_id||'')||!/^[a-f0-9]{64}$/.test(input?.ticket||''))throw Error('Invalid Studio task capability');
 const endpoint=allowedOrigin+'/v1/creator-sites/studio/processor/'+input.asset_id;
 const request=async(suffix,init={})=>{const r=await fetcher(endpoint+suffix,{...init,headers:{authorization:'Bearer '+input.ticket,...init.headers},redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Studio processor transport failed ('+r.status+')');return r;};
 let dir;
 try{
  const context=await (await request('')).json();const u=new URL(context.source_url);
  if(u.protocol!=='https:'||u.hostname!=='zmnhbrjyhxzhkxmhkexs.supabase.co'||!u.pathname.startsWith('/storage/v1/object/sign/mnet-media/studio/'))throw Error('Untrusted source location');
  const original=await fetcher(u.href,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!original.ok)throw Error('Source download failed');
  const source=await bytes(original,67108864);if(source.length!==Number(context.expected_bytes))throw Error('Source byte count changed');
  dir=await mkdtemp(path.join(os.tmpdir(),'mcc-studio-'));const filename=path.join(dir,'source');await writeFile(filename,source,{mode:0o600});
  const manifest=await prepareMedia(filename,path.join(dir,'output'),context.settings);
  for(const file of manifest.files){const receipt=await (await request('/files/'+file.name,{method:'PUT',body:await readFile(path.join(dir,'output',file.name))})).json();if(receipt.sha256!==file.sha256||receipt.bytes!==file.bytes)throw Error('Derivative receipt mismatch');}
  await request('/finish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(manifest)});
  return {asset_id:input.asset_id,prepared:true,processor:manifest.version,output_bytes:manifest.bytes};
 }catch(error){await request('/fail',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>{});throw error;}
 finally{if(dir)await rm(dir,{recursive:true,force:true});}
}
export function startExecutor({token=process.env.STUDIO_EXECUTOR_TOKEN,port=Number(process.env.STUDIO_EXECUTOR_PORT||9463)}={}){
 if(!token||token.length<32)throw Error('A local executor token of at least 32 characters is required');let busy=false;
 const server=http.createServer(async(req,res)=>{
  const answer=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(req.url==='/health'&&req.method==='GET')return answer(200,{ok:true,implementation:'studio-native-1',busy});
  const given=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
  if(given.length!==expected.length||!timingSafeEqual(given,expected))return answer(401,{error:'Unauthorized'});
  if(req.url!=='/execute'||req.method!=='POST')return answer(404,{error:'Not found'});if(busy)return answer(429,{error:'Processor is busy'});busy=true;
  try{const parts=[];let n=0;for await(const b of req){n+=b.length;if(n>8192)throw Error('Task too large');parts.push(b);}const body=JSON.parse(Buffer.concat(parts));if(body.capability!=='media.prepare'||body.implementation!=='studio-native-1')throw Error('Unsupported task');answer(200,await executeStudioTask(body.input));}
  catch(_){answer(422,{error:'Preparation failed; see the source-format guidance and retry.'});}finally{busy=false;}
 });server.listen(port,'127.0.0.1');return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))startExecutor();
