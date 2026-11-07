/* Reconciled #543 private creator review UI; workspace selection comes from
 * the authoritative completed-handoff RPC, never a URL-supplied owner.
 * Uses the EXISTING McCluster auth session and publicly safe publishable key.
 * Never exposes a service key, masters, model checkpoint or private output URL.
 */
const SB="https://zmnhbrjyhxzhkxmhkexs.supabase.co";
const KEY="sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
const $=id=>document.getElementById(id);
let session=null,creatorMuid=null,models=[],tracks=[],jobs=[],artifacts=[];
let inFlight=false,nonce=null,enqueueEnabled=false,epoch=0;
const BRIDGE="https://api.mccluster.org/v1/music-workspace/analysis";
function active(token){return Boolean(token)&&token===session?.access_token&&token===window.MCC?.session()?.access_token;}
function clearPrivate(){epoch++;session=null;creatorMuid=null;tracks=[];jobs=[];artifacts=[];models=[];enqueueEnabled=false;nonce=null;inFlight=false;$("mrResearchConsent").checked=false;$("mrJobs").replaceChildren();$("mrTrack").replaceChildren();$("mrModel").replaceChildren();$("mrEnqueue").disabled=true;["mrTrack","mrStage","mrModel","mrResearchConsent","mrReload"].forEach(id=>{$(id).disabled=false;});}
const STAGE_PARENT={analyze:null,separate:"analyze",transcribe:"separate",engrave:"transcribe"};
const status=(msg,problem=false)=>{$("mrStatus").textContent=msg;$("mrStatus").dataset.state=problem?"error":"ok";};
function safeText(value){return String(value??"");}
function header(){if(!session?.access_token)throw Error("Sign into a McCluster M Account first");
 return {apikey:KEY,authorization:"Bearer "+session.access_token,"content-type":"application/json"};}
async function api(path,{method="GET",body}={}){
 const token=session?.access_token;
 if(!active(token))throw Error("Sign in again before continuing.");
 const res=await fetch(SB+"/rest/v1/"+path,{method,headers:header(),body:body==null?undefined:JSON.stringify(body),
   cache:"no-store"});
 const result=await res.json().catch(()=>null);
 if(!active(token))throw Error("Account changed. Refresh your private records.");
 if(!res.ok)throw Error(safeText(result?.message||result?.error||result?.hint||"Request failed")+" ("+res.status+")");
 return result;
}
async function rpc(name,args={}){return api("rpc/"+name,{method:"POST",body:args});}
function showUnavailable(error){
 tracks=[];models=[];jobs=[];artifacts=[];$("mrJobs").replaceChildren();$("mrResearchConsent").checked=false;
 $("mrTrack").replaceChildren(new Option("Research service not available", ""));
 $("mrModel").replaceChildren(new Option("No approved model", ""));
 enqueueEnabled=false;$("mrEnqueue").disabled=true;$("mrAvailability").textContent="Requests are unavailable. No processing has been requested.";status("Research queue unavailable: "+safeText(error?.message||error),true);
}
function selected(){return tracks.find(x=>x.id===$("mrTrack").value)||null;}
function currentStage(){return $("mrStage").value;}
function matchingModel(){return models.find(m=>m.model_id===$("mrModel").value&&m.stage===currentStage());}
function parentApproved(){
 const track=selected(),prior=STAGE_PARENT[currentStage()];
 if(!track||!prior)return null;
 return jobs.find(j=>j.track_id===track.id&&j.stage===prior&&j.status==="approved")||null;
}
function eligible(){
 return !inFlight && active(session?.access_token) && enqueueEnabled && selected()?.eligible===true && !!matchingModel() &&
   (currentStage()==="analyze"||!!parentApproved()) && $("mrResearchConsent").checked;
}
function refreshInputs(){
 document.querySelectorAll("#mrJobs button").forEach(button=>{button.disabled=inFlight||button.dataset.pending==="true";});
 ["mrTrack","mrStage","mrModel","mrResearchConsent","mrReload"].forEach(id=>{$(id).disabled=inFlight;});
 const stage=currentStage(),lastModel=$("mrModel").value;
 $("mrModel").replaceChildren();
 const candidates=models.filter(x=>x.stage===stage);
 for(const m of candidates){const o=new Option(m.model_id+" · "+m.version,m.model_id);$("mrModel").add(o);}
 if(candidates.some(m=>m.model_id===lastModel))$("mrModel").value=lastModel;
 if(!candidates.length)$("mrModel").add(new Option("No commercially approved model", ""));
 const dep=STAGE_PARENT[stage],p=parentApproved();
 $("mrDependency").textContent=selected()&&!selected().eligible?"Complete rights and release review in Creator Studio before requesting analysis.":!dep ? "Stage 1: analyze the rights-attested original master." :
   p ? "Prerequisite approved: "+dep+" / "+p.id.slice(0,8)+" (creator review recorded)." :
     "BLOCKED: first approve the "+dep+" stage for this recording.";
 $("mrEnqueue").disabled=!eligible();
}
function formatTime(text){const t=Date.parse(text);return Number.isFinite(t)?new Date(t).toLocaleString():"Unknown date";}
async function signedArtifact(a){
 // Storage policy authorizes SELECT only if this private artifact belongs to the
 // authenticated canonical M_UID. URL is ephemeral; no URL is persisted to DB.
 const token=session?.access_token;
 if(!active(token)||!artifacts.some(x=>x.id===a.id))throw Error("Private artifact access changed");
 const object=a.object_path.split("/").map(encodeURIComponent).join("/");
 const url=SB+"/storage/v1/object/sign/creator-research-outputs/"+object;
 const response=await fetch(url,{method:"POST",headers:header(),
   body:JSON.stringify({expiresIn:120}),cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 if(!active(token))throw Error("Account changed");
 if(!response.ok||!result.signedURL)throw Error(result.message||result.error||"Cannot prepare private review link");
 const returned=result.signedURL;
 let signed;
 if(/^https:\/\//.test(returned))signed=returned;
 else if(returned.startsWith("/storage/v1/"))signed=SB+returned;
 else if(returned.startsWith("/object/"))signed=SB+"/storage/v1"+returned;
 else throw Error("Unexpected storage signing response");
 if(new URL(signed).origin!==new URL(SB).origin)throw Error("Private preview host mismatch");
 return signed;
}
function rowText(tag,value,cls){
 const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=safeText(value);return el;
}
function action(label,callback,disabled=false){
 const b=document.createElement("button");b.type="button";b.textContent=label;b.disabled=disabled;b.addEventListener("click",callback);return b;
}
function report(result){
 const div=document.createElement("pre");div.className="mr-report";
 const compact={
   schema:result?.schema,stage:result?.stage,model_id:result?.model_id,
   tempo_key_v2:result?.tempo_key_v2||null,
   tempo_key_baseline:result?.tempo_key_baseline||null,
   resonance:result?.resonance||null,
   stems_estimated:result?.stems_estimated||null,
   estimated_midi_parts:result?.estimated_midi_parts||null,
   draft_musicxml_parts:result?.draft_musicxml_parts||null,
   limitations:"Model outputs are draft estimates and are private pending creator approval."
 };
 div.textContent=JSON.stringify(compact,null,2).slice(0,9500);return div;
}
async function review(id,decision){
 if(inFlight)return;const generation=epoch;
 const j=jobs.find(j=>j.id===id);
 if(!j||j.status!=="awaiting_review")return;
 const confirmation=window.confirm((decision==="approved"?"Approve":"Reject")+
   " these derived research results for YOUR creator account? This does not make them public.");
 if(!confirmation)return;
 const note=decision==="rejected"?window.prompt("Reason for rejection (optional):",""):"Creator reviewed private artifacts";
 if(note===null)return;
 try{inFlight=true;refreshInputs();
   await rpc("mcc_music_research_review",{p_job_id:id,p_decision:decision,p_note:String(note).slice(0,2000)});
   status("Creator review recorded. Derived artifacts remain private.");await reload();
 }catch(e){if(generation===epoch)status("Review failed: "+e.message,true);}
 finally{if(generation===epoch){inFlight=false;refreshInputs();}}
}
async function cancelJob(id){
 if(inFlight)return;const generation=epoch;
 if(!window.confirm("Cancel the queued/processing draft job? Completed private artifacts are not published."))return;
 try{inFlight=true;refreshInputs();
  const ok=await rpc("mcc_music_research_cancel",{p_job_id:id});
  status(ok?"Cancelled":"Job could not be cancelled in its current state.");await reload();
 }catch(e){if(generation===epoch)status("Cancellation failed: "+e.message,true);}
 finally{if(generation===epoch){inFlight=false;refreshInputs();}}
}
function showJobs(){
 const target=$("mrJobs");target.replaceChildren();
 const track=selected(),scope=jobs.filter(j=>!track||j.track_id===track.id);
 if(!scope.length){target.append(rowText("p","No research jobs for this recording yet."));return;}
 for(const job of scope){
   const card=document.createElement("article");card.className="mr-job";
   const h=document.createElement("h3");h.textContent=job.stage.toUpperCase()+" · "+job.status;
   const title=tracks.find(t=>t.id===job.track_id)?.title||"Unknown recording";
   card.append(h,rowText("p",title+" · Model "+job.model_id+" · "+formatTime(job.created_at),"mr-small"));
   if(job.error_code)card.append(rowText("p","Error category: "+job.error_code,"mr-error"));
   if(job.status==="awaiting_review"||job.status==="approved")card.append(report(job.result));
   const sub=artifacts.filter(a=>a.job_id===job.id);
   if(sub.length){
     const list=document.createElement("div");list.className="mr-attachments";
     for(const artifact of sub){
       const span=rowText("span",artifact.kind+" · "+Math.round(artifact.byte_size/1024)+" KiB · "+artifact.status);
       const button=action("View private "+artifact.kind,async()=>{
         button.disabled=true;button.dataset.pending="true";
         try{const url=await signedArtifact(artifact);
           const anchor=document.createElement("a");
           anchor.href=url;anchor.rel="noopener noreferrer";anchor.target="_blank";
           anchor.textContent="Open signed result (120-second link)";
           const holder=document.createElement("span");holder.className="mr-templink";holder.append(anchor);
           button.after(holder);
         }catch(e){status("Artifact review link failed: "+e.message,true);}
         finally{delete button.dataset.pending;button.disabled=inFlight;}
       });
       list.append(span,button);
     }
     card.append(list);
   }
   if(job.status==="awaiting_review"){
      card.append(rowText("p","Read the derived feature report and review every private stem or score before approving.","mr-warning"));
      const controls=document.createElement("div");controls.className="mr-actions";
      controls.append(action("Approve this stage",()=>review(job.id,"approved"),inFlight),
       action("Reject results",()=>review(job.id,"rejected"),inFlight));
      card.append(controls);
   }else if(["queued","processing"].includes(job.status)){
      card.append(action("Cancel job",()=>cancelJob(job.id),inFlight));
   }
   target.append(card);
 }
}
async function reload(){
 if(!creatorMuid||!active(session?.access_token))throw Error("Sign in to load private records.");
 const token=session.access_token,generation=epoch;
 const response=await fetch(BRIDGE,{headers:{authorization:"Bearer "+token},cache:"no-store"});
 const state=await response.json().catch(()=>({}));
 if(generation!==epoch||!active(token))throw Error("Account changed. Refresh your private records.");
 if(!response.ok)throw Error(state.error||"Research records unavailable");
 tracks=state.tracks||[];models=state.models||[];jobs=state.jobs||[];artifacts=state.artifacts||[];
 enqueueEnabled=state.enqueue_enabled===true;
 const last=$("mrTrack").value||new URLSearchParams(location.search).get("track");
 $("mrTrack").replaceChildren();
 for(const track of tracks)$("mrTrack").add(new Option(track.title+" · "+track.status,track.id));
 if(!tracks.length)$("mrTrack").add(new Option("No completed workspace handoffs", ""));
 if(tracks.some(t=>t.id===last))$("mrTrack").value=last;
 if($("mrTrack").value!==last)nonce=null;
 $("mrResearchConsent").checked=false;
 $("mrAvailability").textContent=!enqueueEnabled?"New requests are disabled. Existing private results can still be reviewed.":state.execution_enabled===true?"Requests are available. Processing requires approved models; each stage stays private pending your review.":"Requests can be queued, but processing is disabled. Jobs will wait until an approved worker is enabled.";
 refreshInputs();showJobs();
 status("Loaded "+tracks.length+" completed workspace handoff(s) and "+jobs.length+" private job(s).");
}
async function enqueue(){
 const generation=epoch;
 if(!eligible())return;
 const track=selected(),stage=currentStage(),model=matchingModel(),parent=parentApproved();
 if(!track||!model||stage!=="analyze"&&!parent)return;
 try{
   inFlight=true;refreshInputs();
   if(!nonce)nonce="mcc:"+stage+":"+crypto.randomUUID();
   const token=session.access_token;
   const response=await fetch(BRIDGE,{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({track_id:track.id,stage,model_id:model.model_id,idempotency_key:nonce,parent_job_id:parent?.id||null,consent:true})});
   const value=await response.json().catch(()=>({}));
   if(!active(token))throw Error("Account changed. Reload your private records.");
   if(!response.ok)throw Error(value.error||"Request failed. Retry with the same selection.");
   const id=value.job_id;
   status("Request accepted for job "+String(id).slice(0,8)+". Processing availability is shown above.");
   nonce=null;$("mrResearchConsent").checked=false;
   await reload();
 }catch(e){if(generation===epoch)status("Enqueue refused: "+e.message,true);}
 finally{if(generation===epoch){inFlight=false;refreshInputs();}}
}
async function boot(){
 const generation=epoch;
 try{
   if(!window.MCC?.refreshIfNeeded||!window.MCC?.mUid)throw Error("McCluster identity layer missing");
   const nextSession=await window.MCC.refreshIfNeeded();
   if(generation!==epoch)return;session=nextSession;
   if(!session?.access_token)throw Error("Sign into your McCluster account on the parent site");
   const token=session.access_token;
   const nextMuid=await window.MCC.mUid();
   if(generation!==epoch||!active(token))return;creatorMuid=nextMuid;
   if(!creatorMuid)throw Error("Creator identity not linked to this account");
   await reload();
 }catch(e){if(generation===epoch)showUnavailable(e);}
}
["mrStage","mrTrack","mrModel","mrResearchConsent"].forEach(id=>{
 $(id).addEventListener("change",()=>{if(id!=="mrResearchConsent"){nonce=null;$("mrResearchConsent").checked=false;}refreshInputs();if(id==="mrTrack")showJobs();});
});
$("mrReload").onclick=async()=>{if(inFlight)return;const generation=epoch;inFlight=true;refreshInputs();try{await reload();}catch(e){if(generation===epoch)showUnavailable(e);}finally{if(generation===epoch){inFlight=false;refreshInputs();}}};
$("mrEnqueue").onclick=enqueue;
for(const event of ["mcc:auth-changed","storage"])window.addEventListener(event,()=>{clearPrivate();status("Checking the signed-in account…");boot();});
window.addEventListener("pagehide",clearPrivate);
boot();
