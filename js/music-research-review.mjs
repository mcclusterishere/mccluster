/* McCluster Creator Research Workbench
 * Creator JWT -> RLS-scoped jobs; individual deliberate approvals only.
 * No private master URL, service key, model download or implicit publication.
 */
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
const SB="https://zmnhbrjyhxzhkxmhkexs.supabase.co";
const KEY="sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
const $=id=>document.getElementById(id);
const STEPS=["analyze","separate","transcribe","engrave"];
let modelList=[],jobs=[];
const show=s=>{if($("researchReviewStatus"))$("researchReviewStatus").textContent=s;};

async function authenticated() {
  const user=window.MCC;
  if(!user?.refreshIfNeeded||!user?.mUid)throw Error("Sign in as an authorized creator");
  const session=await user.refreshIfNeeded();
  if(!session?.access_token||!(await user.mUid()))throw Error("Creator identity unavailable");
  return session.access_token;
}

async function rest(path,{method="GET",body}={}) {
  const token=await authenticated();
  const response=await fetch(SB+"/rest/v1/"+path,{
    method,headers:{apikey:KEY,authorization:"Bearer "+token,
      "content-type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const text=await response.text();
  let data;try{data=text?JSON.parse(text):null;}catch{data=null;}
  if(!response.ok)throw Error(data?.message||data?.error||"Research service "+response.status);
  return data;
}

function button(text,onClick,disabled=false){
  const b=document.createElement("button");b.type="button";b.textContent=text;
  b.className="mcc-research-action";b.disabled=disabled;
  b.addEventListener("click",async()=>{
    b.disabled=true;
    try{await onClick();}catch(e){show(String(e.message||"Request failed"));}
    finally{b.disabled=disabled;}
  });
  return b;
}
function stageLabel(s){return ({analyze:"Analyze audio",separate:"Separate instruments",
  transcribe:"Transcribe MIDI",engrave:"Draft MusicXML"})[s]||s;}

async function signArtifact(artifact,anchor){
  const token=await authenticated();
  const client=createClient(SB,KEY,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:"Bearer "+token}}
  });
  const {data,error}=await client.storage.from("creator-research-outputs")
    .createSignedUrl(artifact.object_path,60,{download:true});
  if(error||!data?.signedUrl)throw Error("Access to this private artifact was denied");
  anchor.href=data.signedUrl;
  anchor.rel="noopener noreferrer";
  anchor.target="_blank";
  anchor.textContent="Open private "+artifact.kind+" (60s)";
  show("A temporary owner-only link is ready; tap it within 60 seconds.");
}

function note(text,kind=""){
  const p=document.createElement("p");p.className="mcc-research-note "+kind;p.textContent=text;return p;
}
async function requestStage(trackId,stage,modelId,parent=null){
  if(!STEPS.includes(stage)||!modelList.some(m=>m.stage===stage&&m.model_id===modelId))
    throw Error("This stage requires a commercially approved model");
  const key=("mcc_"+trackId.replace(/-/g,"")+"_"+
    (parent?parent.replace(/-/g,""):"start")+"_"+stage).slice(0,125);
  const result=await rest("rpc/mcc_music_research_enqueue",{method:"POST",
    body:{p_track_id:trackId,p_stage:stage,p_model_id:modelId,
      p_idempotency_key:key,p_parent_job_id:parent}});
  show(stageLabel(stage)+" queued with creator permissions. The previous stage remains unchanged.");
  await refresh();
  return result;
}
export async function enqueueNewCreatorAnalysis(trackId){
  if(!/^[0-9a-f-]{36}$/i.test(String(trackId||"")))
    throw Error("A completed creator track is required");
  // No queue on unapproved schema: the creator's release remains submitted.
  const models=await rest("music_research_models?select=model_id,stage&enabled=eq.true");
  modelList=Array.isArray(models)?models:[];
  const model=modelList.find(x=>x.stage==="analyze"&&x.model_id==="mcc_spectral_v1");
  if(!model)throw Error("The queued research database rollout is not yet approved");
  await requestStage(trackId,"analyze",model.model_id);
}
async function review(job,decision){
  if(!["approved","rejected"].includes(decision))throw Error("Unsupported decision");
  if(job.status!=="awaiting_review")throw Error("Stage is not awaiting creator review");
  const msg=decision==="approved"?
    "Approve this unverified research stage and authorize the next stage to be requested separately?":
    "Reject this stage and its derived artifacts?";
  if(!window.confirm(msg))return;
  await rest("rpc/mcc_music_research_review",{method:"POST",
    body:{p_job_id:job.id,p_decision:decision,p_note:"Reviewed in Creator Research Workbench"}});
  show("Creator decision recorded: "+decision+".");
  await refresh();
}
async function listArtifacts(job){
  return await rest("music_research_artifacts?job_id=eq."+encodeURIComponent(job.id)+
    "&select=id,kind,status,object_path,byte_size,checksum_sha256&order=created_at.asc&limit=40");
}
async function renderJob(job,parent){
  const article=document.createElement("article");article.className="mcc-research-job";
  const heading=document.createElement("h4");
  heading.textContent=stageLabel(job.stage)+" · "+job.status;
  article.append(heading);
  article.append(note("Track "+job.track_id.slice(0,8)+" · "+
    new Date(job.created_at).toLocaleString()+
    " · model "+job.model_id));
  if(job.status==="failed")article.append(note("Processing failed; no result was approved.","warning"));
  const artifacts=await listArtifacts(job);
  if(artifacts.length){
    const list=document.createElement("div");list.className="mcc-research-artifacts";
    for(const item of artifacts){
      const row=document.createElement("div");
      row.className="mcc-research-artifact";
      row.append(note(item.kind+" · "+Math.ceil(item.byte_size/1024)+" KiB · "+item.status));
      const a=document.createElement("a");a.textContent="Private preview not generated";
      a.tabIndex=-1;a.setAttribute("aria-disabled","true");
      if(item.status!=="rejected"){
        row.append(button("Create 60-second preview",()=>signArtifact(item,a)));
        a.removeAttribute("aria-disabled");a.tabIndex=0;
      }
      row.append(a);list.append(row);
    }
    article.append(list);
  }
  if(job.status==="awaiting_review"){
    article.append(button("Approve this stage",()=>review(job,"approved")));
    article.append(button("Reject",()=>review(job,"rejected")));
  }
  if(job.status==="approved"){
    const next=STEPS[STEPS.indexOf(job.stage)+1];
    if(next){
      const available=modelList.find(m=>m.stage===next);
      if(available){
        article.append(button("Request "+stageLabel(next),
          ()=>requestStage(job.track_id,next,available.model_id,job.id)));
      }else article.append(note(stageLabel(next)+" unavailable until a licensed model is approved."));
    }else article.append(note("Final score approved for creator use; public publication remains a separate authorized action."));
  }
  parent.append(article);
}
async function refresh(){
  const target=$("researchJobs");
  if(!target)return;
  target.replaceChildren();
  try{
    const [models,rows]=await Promise.all([
      rest("music_research_models?enabled=eq.true&select=model_id,stage"),
      rest("music_research_jobs?select=id,track_id,parent_job_id,stage,model_id,status,created_at,reviewed_at,result,error_code&order=created_at.desc&limit=40")
    ]);
    modelList=models||[];jobs=rows||[];
    if(!jobs.length){target.append(note("No queued research jobs yet. Enroll a rights-attested release to begin."));return;}
    for(const job of jobs)await renderJob(job,target);
    show(jobs.length+" jobs read under creator RLS; no private masters exposed.");
  }catch(e){
    target.append(note("Research queue is not yet active, or your creator session needs authentication."));
    show("Existing release submissions are unaffected. "+String(e.message||""));
  }
}

$("researchRefresh")?.addEventListener("click",refresh);
window.addEventListener("mcc:research-queued",refresh);
document.addEventListener("DOMContentLoaded",refresh,{once:true});
