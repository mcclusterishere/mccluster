#!/usr/bin/env node
/* Private, explicitly started music research worker.
 * Only a Supabase service role may claim/finalize queued work. No creator
 * identity is provided by the worker. Each job is already authenticated and
 * rights-checked by the pending SQL RPC contract.
 * No production scheduler, GPU host, or migration is deployed by this file.
 */
import {readFile, writeFile, mkdtemp, rm, mkdir, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, basename, extname, resolve, sep} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {executeApprovedStage} from "./model-adapters.mjs";

const ROOT=resolve(fileURLToPath(new URL("../../",import.meta.url)));
const BUCKET_OUT="creator-research-outputs";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NAME=/^[a-z0-9][a-z0-9_./-]{0,300}$/i;
const MIME={".mp3":"audio/mpeg",".wav":"audio/wav",".m4a":"audio/mp4",
  ".flac":"audio/flac",".ogg":"audio/ogg",".mid":"audio/midi",
  ".musicxml":"application/vnd.recordare.musicxml+xml",".json":"application/json"};
const SOURCES=new Set(["creator-masters",BUCKET_OUT]);
const safeName=(name)=>String(name).replace(/[^a-zA-Z0-9_.-]/g,"_").slice(0,90);
const sha=buf=>createHash("sha256").update(buf).digest("hex");
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const requireHttps=(url)=>{const u=new URL(url);if(u.protocol!=="https:")throw Error("HTTPS Supabase URL required");return u.origin;};
const pathSegments=s=>String(s).split("/").map(encodeURIComponent).join("/");

export class MusicResearchClient {
  constructor({url,serviceKey,fetcher=fetch}){
    if(typeof serviceKey!=="string"||serviceKey.length<24)throw Error("service credential is required");
    this.origin=requireHttps(url);
    this.fetcher=fetcher;
    this.headers={apikey:serviceKey,Authorization:"Bearer "+serviceKey};
  }
  async callRpc(name,args={}){
    if(!/^mcc_music_research_(?:claim|finish|fail|heartbeat)$/.test(name))
      throw Error("worker RPC is not allowlisted");
    const rsp=await this.fetcher(this.origin+"/rest/v1/rpc/"+name,{
      method:"POST",headers:{...this.headers,"Content-Type":"application/json"},
      body:JSON.stringify(args),signal:AbortSignal.timeout(25000)
    });
    if(!rsp.ok)throw Error("research RPC failed ("+rsp.status+")");
    const value=await rsp.json();
    return Array.isArray(value)&&name.endsWith("_claim")?value[0]||null:value;
  }
  claim(lease=600){return this.callRpc("mcc_music_research_claim",{
    p_worker:"mcc-cpu-v1",p_lease_seconds:lease});}
  heartbeat(job,lease){return this.callRpc("mcc_music_research_heartbeat",{
    p_job_id:job.job_id,p_token:job.lease_token,p_seconds:lease});}
  finish(job,result,artifacts){return this.callRpc("mcc_music_research_finish",{
    p_job_id:job.job_id,p_token:job.lease_token,p_result:result,p_artifacts:artifacts});}
  fail(job,code,retry=true){return this.callRpc("mcc_music_research_fail",{
    p_job_id:job.job_id,p_token:job.lease_token,
    p_error_code:String(code).slice(0,90),p_retryable:retry});}
  async fetchPrivate(bucket,path){
    if(!SOURCES.has(bucket)||!NAME.test(path)||path.includes("..")||path.startsWith("/"))
      throw Error("unsafe or non-allowlisted source reference");
    const rsp=await this.fetcher(this.origin+"/storage/v1/object/"+bucket+"/"+pathSegments(path),{
      headers:this.headers,signal:AbortSignal.timeout(120000)
    });
    if(!rsp.ok)throw Error("private source could not be retrieved ("+rsp.status+")");
    const length=Number(rsp.headers.get("content-length")||0);
    if(length>100*1024*1024)throw Error("source file too large");
    const data=Buffer.from(await rsp.arrayBuffer());
    if(!data.length||data.length>100*1024*1024)throw Error("bad source file size");
    return data;
  }
  async uploadPrivate(path,data,type){
    if(!NAME.test(path)||!path.startsWith("research/")||path.includes(".."))
      throw Error("invalid output object key");
    const address=this.origin+"/storage/v1/object/"+BUCKET_OUT+"/"+pathSegments(path);
    const headers={...this.headers,"Content-Type":type,"Cache-Control":"private, max-age=0",
      "x-upsert":"false"};
    const result=await this.fetcher(address,{
      method:"POST",headers,body:data,signal:AbortSignal.timeout(120000)});
    if(result.ok)return;
    if(result.status===409||result.status===400){
      // Network or DB failure on a previous attempt may have left an identical
      // object; validate its bytes, never overwrite a possibly different file.
      const earlier=await this.fetcher(address,{headers:this.headers,signal:AbortSignal.timeout(120000)});
      if(earlier.ok){
        const bytes=Buffer.from(await earlier.arrayBuffer());
        if(bytes.length===data.length&&sha(bytes)===sha(data))return;
      }
    }
    throw Error("private artifact upload rejected ("+result.status+")");
  }
}

export function assertClaim(claim){
  if(!claim||!UUID.test(claim.job_id||"")||!UUID.test(claim.creator_m_uid||"")||
     !UUID.test(claim.lease_token||"")||
     !["analyze","separate","transcribe","engrave"].includes(claim.stage)||
     typeof claim.model_id!=="string"||!Array.isArray(claim.source_objects)||
     !claim.source_objects.length||claim.source_objects.length>32)throw Error("invalid leased job response");
  return claim;
}

async function readSources(client,claim,dir){
  const sourceDir=join(dir,"source");
  await mkdir(sourceDir,{mode:0o700});
  const files=[];
  let aggregate=0;
  for(let i=0;i<claim.source_objects.length;i++){
    const object=claim.source_objects[i];
    if(!object||!SOURCES.has(object.bucket)||!NAME.test(object.path||"")||object.path.includes(".."))
      throw Error("invalid source manifest");
    if(claim.stage==="analyze"||claim.stage==="separate"){
      if(object.bucket!=="creator-masters")throw Error("first stage must use a creator-owned master");
    } else if(object.bucket!==BUCKET_OUT)throw Error("derived stage requires approved private artifacts");
    const ext=extname(object.path).toLowerCase();
    if(![".wav",".mp3",".m4a",".flac",".ogg",".mid"].includes(ext))
      throw Error("unsupported source format");
    const data=await client.fetchPrivate(object.bucket,object.path);
    aggregate+=data.length;
    if(aggregate>220*1024*1024)throw Error("aggregate source payload too large");
    const name="input-"+String(i+1).padStart(2,"0")+"-"+safeName(basename(object.path));
    const path=join(sourceDir,name);
    await writeFile(path,data,{flag:"wx",mode:0o600});
    files.push(path);
  }
  return files;
}

async function deliver(client,claim,outputs){
  const manifest=[];
  let aggregate=0;
  for(let i=0;i<outputs.artifacts.length;i++){
    const item=outputs.artifacts[i];
    const data=await readFile(item.file);
    if(sha(data)!==item.sha256||data.length!==item.byteSize)
      throw Error("derived file changed after checkpoint");
    aggregate+=data.length;
    if(aggregate>240*1024*1024)throw Error("derived output total too large");
    const ext=extname(item.name).toLowerCase();
    const key="research/"+claim.creator_m_uid+"/"+claim.job_id+"/"+
      String(i+1).padStart(2,"0")+"-"+item.sha256.slice(0,14)+ext;
    await client.uploadPrivate(key,data,MIME[ext]||"application/octet-stream");
    manifest.push({kind:item.kind,object_path:key,checksum_sha256:item.sha256,
      byte_size:item.byteSize});
  }
  return manifest;
}

export async function processOnce(client,{leaseSeconds=600,registry,modelsDir=null,
  stageRunner=executeApprovedStage,makeTemp=mkdtemp}={}){
  if(!registry||registry.schema!=="mcc.music.research.model-registry.v1")
    throw Error("approved model manifest must be supplied");
  const claim=client.claim?await client.claim(leaseSeconds):null;
  if(!claim)return {status:"empty"};
  const job=assertClaim(claim);
  let dir,heartbeatBusy=false,leaseRevoked=false;
  const controller=new AbortController();
  const heartbeat=async()=>{
    if(heartbeatBusy||leaseRevoked)return;
    heartbeatBusy=true;
    try{
      const ok=await client.heartbeat(job,leaseSeconds);
      if(ok!==true){leaseRevoked=true;controller.abort();}
    }catch{leaseRevoked=true;controller.abort();}
    finally{heartbeatBusy=false;}
  };
  const interval=setInterval(heartbeat,Math.max(12000,Math.floor(leaseSeconds*1000/3)));
  interval.unref?.();
  try{
    dir=await makeTemp(join(tmpdir(),"mcc-music-queue-"));
    const input=await readSources(client,job,dir);
    const output=join(dir,"out");
    await mkdir(output,{mode:0o700});
    const derived=await stageRunner({stage:job.stage,model_id:job.model_id},
      registry,input,output,{modelsDir,signal:controller.signal});
    if(leaseRevoked||controller.signal.aborted)throw Error("lease_revoked");
    const artifacts=await deliver(client,job,derived);
    if(leaseRevoked||controller.signal.aborted)throw Error("lease_revoked");
    const summary={
      schema:"mcc.music.pipeline.stage-result.v1",
      stage:job.stage,modelId:job.model_id,modelVersion:derived.modelVersion,
      state:"awaiting_creator_review",artifactCount:artifacts.length,
      noAutomaticPublication:true,derivedNotGroundTruth:true,
      ...(derived.summary||{})
    };
    const ok=await client.finish(job,summary,artifacts);
    if(ok!==true)throw Error("finish_not_acknowledged");
    return {status:"awaiting_review",stage:job.stage,artifactCount:artifacts.length};
  } catch(error){
    if(!leaseRevoked){
      const code=/license|approved|checkpoint/i.test(String(error?.message))?"model_not_approved":
        /source|rights|unsafe|manifest/i.test(String(error?.message))?"invalid_job_source":
        "stage_execution_failed";
      try{await client.fail(job,code,code==="stage_execution_failed");}catch{}
    }
    return {status:"failed",stage:job.stage,
      code:leaseRevoked?"lease_revoked":"stage_execution_failed"};
  } finally{
    clearInterval(interval);
    controller.abort();
    if(dir)await rm(dir,{recursive:true,force:true,maxRetries:2});
  }
}

async function main(){
  const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,MCC_APPROVED_MODEL_DIR}=process.env;
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)
    throw Error("supply Supabase service role and URL in a PRIVATE isolated worker environment");
  const manifest=JSON.parse(await readFile(join(ROOT,"config/music-research-models.v1.json"),"utf8"));
  const client=new MusicResearchClient({url:SUPABASE_URL,serviceKey:SUPABASE_SERVICE_ROLE_KEY});
  const once=process.argv.includes("--once"),loop=process.argv.includes("--loop");
  if(once===loop)throw Error("choose exactly --once or --loop");
  do{
    const result=await processOnce(client,{registry:manifest,modelsDir:MCC_APPROVED_MODEL_DIR});
    // No file paths, user identifiers, audio, JWTs, or private media logged.
    process.stdout.write("[mcc-research] "+result.status+" "+(result.stage||"none")+"\n");
    if(result.status==="empty")await delay(5000);
  }while(loop);
}
if(process.argv[1]&&/music-job-worker\.mjs$/.test(process.argv[1])){
  main().catch(e=>{process.stderr.write("[mcc-research] worker failed: "+
    (/service|credential|URL/i.test(String(e.message))?"configuration":"internal")+"\n");
    process.exitCode=1;});
}
