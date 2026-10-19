/* Research pipeline process allowlist.
 * No shell commands, no arbitrary user-chosen executables, and no implicit
 * checkpoint downloads. Commercial model approval is ALSO checked in SQL.
 */
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {access, readdir, realpath, stat} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join, resolve, relative, sep} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=resolve(fileURLToPath(new URL("../../",import.meta.url)));
const TYPES={analyze:new Set(["features"]),separate:new Set(["stem"]),
  transcribe:new Set(["midi"]),engrave:new Set(["musicxml"])};
const EXT={".wav":"stem",".mid":"midi",".musicxml":"musicxml",".xml":"musicxml",
  ".json":"features"};
const APPROVED_LICENSES=new Set(["first_party","approved_commercial"]);

export function modelApproved(manifest, id, stage) {
  if(!manifest||manifest.schema!=="mcc.music.research.model-registry.v1")
    throw Error("unrecognized model registry");
  const m=manifest.models?.find(x=>x.id===id);
  if(!m||m.stage!==stage||!m.enabled||!APPROVED_LICENSES.has(m.license)||
     typeof m.approval!=="string"||m.approval.length<10)
    throw Error("research model not licensed and explicitly enabled");
  if(!["first_party_fft","beat_this","audio_separator","basic_pitch","music21"].includes(m.adapter))
    throw Error("unknown or unsupported model runner");
  return m;
}

function safeLocal(path, base) {
  const p=resolve(path), b=resolve(base);
  if(p===b||!p.startsWith(b+sep))throw Error("outside the isolated job directory");
  return p;
}

async function hashFile(file) {
  const h=createHash("sha256");
  for await(const chunk of createReadStream(file))h.update(chunk);
  return h.digest("hex");
}
async function approvedCheckpoint(model, modelsDir) {
  const meta=model.checkpoint;
  if(!modelsDir||!meta||typeof meta.filename!=="string"||
      !/^[a-zA-Z0-9_.-]{3,180}$/.test(meta.filename)||
      !/^[a-f0-9]{64}$/.test(meta.sha256||"")||
      !meta.licenseEvidence||String(meta.licenseEvidence).length<15)
    throw Error("reviewed, SHA-pinned commercially approved checkpoint missing");
  const file=safeLocal(join(modelsDir,meta.filename),modelsDir);
  const s=await stat(file);
  if(!s.isFile()||s.size<=0||s.size>16*1024**3)throw Error("checkpoint invalid");
  if((await hashFile(file))!==meta.sha256)throw Error("checkpoint integrity mismatch");
  return file;
}

export function adapterCommand(model, stage, inputs, outdir, {modelsDir}={}) {
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>32)
    throw Error("expected 1–32 authorized input files");
  if(stage==="analyze"){
    if(inputs.length!==1)throw Error("analysis receives a single canonical master");
    const first={exe:process.execPath,args:[join(ROOT,"scripts/music-resonance-analyze.mjs"),
      inputs[0],"--output",join(outdir,"acoustic-features.json")]};
    if(model.adapter==="first_party_fft")return [first];
    if(model.adapter!=="beat_this"||!modelsDir)
      throw Error("unrecognized or unapproved enhanced beat model");
    return [first,{exe:"python3",args:[
      join(ROOT,"scripts/research-engine/beat_this_tempo.py"),
      "--source",inputs[0],"--checkpoint",join(modelsDir,model.checkpoint.filename),
      "--sha256",model.checkpoint.sha256,"--output",join(outdir,"beat-this.json"),
      "--device","cpu"]}];
  }
  if(stage==="separate"){
    if(inputs.length!==1||model.adapter!=="audio_separator"||!modelsDir)
      throw Error("separation requires one master and a reviewed local model");
    return [{exe:"audio-separator",args:[inputs[0],"--model_filename",model.checkpoint.filename,
      "--model_file_dir",modelsDir,"--output_dir",outdir,"--output_format","WAV"]}];
  }
  if(stage==="transcribe"){
    if(model.adapter!=="basic_pitch")throw Error("unsupported transcriber");
    const pitched=inputs.filter(f=>!/(?:^|[_ -.])(drums?|percussion|kick|snare|hats?)(?:[_ -.]|$)/i.test(f));
    if(!pitched.length)throw Error("no pitched input to transcribe");
    return pitched.map(input=>({exe:"basic-pitch",args:[outdir,input]}));
  }
  if(stage==="engrave"){
    if(model.adapter!=="music21")throw Error("unsupported engraver");
    const midi=inputs.filter(p=>/\.mid$/i.test(p));
    if(!midi.length)throw Error("approved MIDI inputs required");
    return [{exe:"python3",args:[join(ROOT,"scripts/research-engine/midi-to-musicxml.py"),
      "--output",join(outdir,"score.musicxml"),...midi]}];
  }
  throw Error("unsupported research stage");
}

export async function runProcess(exe,args,{cwd,signal,timeoutMs=20*60*1000}={}) {
  if(!cwd||!Array.isArray(args)||!Number.isSafeInteger(timeoutMs)||timeoutMs>25*60*1000)
    throw Error("invalid model invocation parameters");
  const env={
    PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin",
    HOME:process.env.HOME||"/tmp",
    LANG:"C.UTF-8",OMP_NUM_THREADS:"4",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",
    HF_HUB_DISABLE_TELEMETRY:"1",TOKENIZERS_PARALLELISM:"false",
    PYTHONDONTWRITEBYTECODE:"1",PIP_NO_INDEX:"1"
  };
  return await new Promise((ok,fail)=>{
    const child=spawn(exe,args,{cwd,env,stdio:["ignore","ignore","ignore"],signal});
    let complete=false;
    const timer=setTimeout(()=>{child.kill("SIGTERM");},timeoutMs);
    const finish=(err)=>{if(complete)return;complete=true;clearTimeout(timer);
      if(err)fail(err);else ok();};
    child.on("error",()=>finish(Error("approved model executable unavailable")));
    child.on("close",(code,reason)=>{
      if(code===0&&!signal?.aborted)finish(null);
      else finish(Error(signal?.aborted?"research lease revoked":
        reason?"worker process terminated":"model exited with nonzero status"));
    });
  });
}

export async function collectStageOutputs(outdir,stage) {
  const found=[];
  for(const ent of await readdir(outdir,{withFileTypes:true})){
    if(!ent.isFile()||ent.isSymbolicLink())continue;
    const file=join(outdir,ent.name);
    const safe=await realpath(file);
    safeLocal(safe,outdir);
    const ext=ent.name.slice(ent.name.lastIndexOf(".")).toLowerCase(),kind=EXT[ext];
    if(!TYPES[stage]?.has(kind))continue;
    const size=(await stat(file)).size;
    if(size<1||size>100*1024*1024)throw Error("derived media exceeds authorized artifact limit");
    found.push({file,kind,name:ent.name,sha256:await hashFile(file),byteSize:size});
  }
  if(!found.length||found.length>32)throw Error("model produced no eligible outputs or too many artifacts");
  return found;
}

export async function executeApprovedStage(job,manifest,inputs,outputDir,{modelsDir,signal,runner=runProcess}={}) {
  const m=modelApproved(manifest,job.model_id,job.stage);
  if(["audio_separator","beat_this"].includes(m.adapter))await approvedCheckpoint(m,modelsDir);
  const commands=adapterCommand(m,job.stage,inputs,outputDir,{modelsDir});
  for(const command of commands)await runner(command.exe,command.args,
    {cwd:outputDir,signal,timeoutMs:job.stage==="separate"?25*60*1000:12*60*1000});
  const artifacts=await collectStageOutputs(outputDir,job.stage);
  return {stage:job.stage,modelId:m.id,modelVersion:m.version,artifacts};
}
