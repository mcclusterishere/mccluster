/* Prototype creator review and rights-checked research queue client.
 * Uses the EXISTING McCluster auth session and publicly safe publishable key.
 * Never exposes a service key, masters, model checkpoint or private output URL.
 */
const SB="https://zmnhbrjyhxzhkxmhkexs.supabase.co";
const KEY="sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
const $=id=>document.getElementById(id);
let session=null,creatorMuid=null,models=[],tracks=[],jobs=[],artifacts=[];
let inFlight=false,nonce=null;
const stages=["analyze","separate","transcribe","engrave"];
const STAGE_PARENT={analyze:null,separate:"analyze",transcribe:"separate",engrave:"transcribe"};
const status=(msg,problem=false)=>{$("mrStatus").textContent=msg;$("mrStatus").dataset.state=problem?"error":"ok";};
function safeText(value){return String(value??"");}
function header(){if(!session?.access_token)throw Error("Sign into a McCluster M Account first");
 return {apikey:KEY,authorization:"Bearer "+session.access_token,"content-type":"application/json"};}
async function api(path,{method="GET",body}={}){
 const res=await fetch(SB+"/rest/v1/"+path,{method,headers:header(),body:body==null?undefined:JSON.stringify(body),
   cache:"no-store"});
 const result=await res.json().catch(()=>null);
 if(!res.ok)throw Error(safeText(result?.message||result?.error||result?.hint||"Request failed")+" ("+res.status+")");
 return result;
}
const query=(k)=>encodeURIComponent(k);
async function rpc(name,args={}){return api("rpc/"+name,{method:"POST",body:args});}
function showUnavailable(error){
 $("mrTrack").replaceChildren(new Option("Research service not available", ""));
 $("mrModel").replaceChildren(new Option("No approved model", ""));
 $("mrEnqueue").disabled=true;status("Research queue unavailable: "+safeText(error?.message||error),true);
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
 return !inFlight && !!session && !!selected() && !!matchingModel() &&
   (currentStage()==="analyze"||!!parentApproved()) && $("mrResearchConsent").checked;
}
function refreshInputs(){
 const stage=currentStage();
 $("mrModel").replaceChildren();
 const candidates=models.filter(x=>x.stage===stage);
 for(const m of candidates){const o=new Option(m.model_id+" · "+m.version,m.model_id);$("mrModel").add(o);}
 if(!candidates.length)$("mrModel").add(new Option("No commercially approved model", ""));
 const dep=STAGE_PARENT[stage],p=parentApproved();
 $("mrDependency").textContent=!dep ? "Stage 1: analyze the rights-attested original master." :
   p ? "Prerequisite approved: "+dep+" / "+p.id.slice(0,8)+" (creator review recorded)." :
     "BLOCKED: first approve the "+dep+" stage for this recording.";
 $("mrEnqueue").disabled=!eligible();
}
function formatTime(text){const t=Date.parse(text);return Number.isFinite(t)?new Date(t).toLocaleString():"Unknown date";}
async function signedArtifact(a){
 // Storage policy authorizes SELECT only if this private artifact belongs to the
 // authenticated canonical M_UID. URL is ephemeral; no URL is persisted to DB.
 const object=a.object_path.split("/").map(encodeURIComponent).join("/");
 const url=SB+"/storage/v1/object/sign/creator-research-outputs/"+object;
 const response=await fetch(url,{method:"POST",headers:header(),
   body:JSON.stringify({expiresIn:120}),cache:"no-store"});
 const result=await response.json().catch(()=>({}));
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
 }catch(e){status("Review failed: "+e.message,true);}
 finally{inFlight=false;refreshInputs();}
}
async function cancelJob(id){
 if(!window.confirm("Cancel the queued/processing draft job? Completed private artifacts are not published."))return;
 try{inFlight=true;refreshInputs();
  const ok=await rpc("mcc_music_research_cancel",{p_job_id:id});
  status(ok?"Cancelled":"Job could not be cancelled in its current state.");await reload();
 }catch(e){status("Cancellation failed: "+e.message,true);}
 finally{inFlight=false;refreshInputs();}
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
         button.disabled=true;
         try{const url=await signedArtifact(artifact);
           const anchor=document.createElement("a");
           anchor.href=url;anchor.rel="noopener noreferrer";anchor.target="_blank";
           anchor.textContent="Open signed result (120-second link)";
           const holder=document.createElement("span");holder.className="mr-templink";holder.append(anchor);
           button.after(holder);
         }catch(e){status("Artifact review link failed: "+e.message,true);}
         finally{button.disabled=false;}
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
 if(!creatorMuid)return;
 // Filter by canonical creator ID in addition to server-enforced RLS.
 const [owned,approved,history,files]=await Promise.all([
   api("creator_tracks?m_uid=eq."+query(creatorMuid)+
      "&select=id,title,status,rights_status,master_path&order=created_at.desc&limit=100"),
   rpc("mcc_music_research_available_models"),
   api("music_research_jobs?creator_m_uid=eq."+query(creatorMuid)+"&select=*&order=created_at.desc&limit=100"),
   api("music_research_artifacts?creator_m_uid=eq."+query(creatorMuid)+"&select=id,job_id,kind,object_path,checksum_sha256,byte_size,status&limit=300")
 ]);
 tracks=(owned||[]).filter(t=>t.master_path&&["attested","cleared"].includes(t.rights_status));
 models=approved||[];jobs=history||[];artifacts=files||[];
 const last=$("mrTrack").value;
 $("mrTrack").replaceChildren();
 for(const track of tracks)$("mrTrack").add(new Option(track.title+" · "+track.status,track.id));
 if(!tracks.length)$("mrTrack").add(new Option("No rights-attested uploaded masters", ""));
 if(tracks.some(t=>t.id===last))$("mrTrack").value=last;
 refreshInputs();showJobs();
 status("Loaded "+tracks.length+" eligible creator release(s), "+models.length+
   " approved model(s), and "+jobs.length+" private job(s).");
}
async function enqueue(){
 if(!eligible())return;
 const track=selected(),stage=currentStage(),model=matchingModel(),parent=parentApproved();
 if(!track||!model||stage!=="analyze"&&!parent)return;
 try{
   inFlight=true;refreshInputs();
   if(!nonce)nonce="mcc:"+stage+":"+crypto.randomUUID();
   const id=await rpc("mcc_music_research_enqueue",{
     p_track_id:track.id,p_stage:stage,p_model_id:model.model_id,
     p_idempotency_key:nonce,p_parent_job_id:parent?.id||null
   });
   status("Job "+String(id).slice(0,8)+" queued securely. The queue requires an approved worker before processing.");
   nonce=null;$("mrResearchConsent").checked=false;
   await reload();
 }catch(e){status("Enqueue refused: "+e.message,true);}
 finally{inFlight=false;refreshInputs();}
}
async function boot(){
 try{
   if(!window.MCC?.refreshIfNeeded||!window.MCC?.mUid)throw Error("McCluster identity layer missing");
   session=await window.MCC.refreshIfNeeded();
   if(!session?.access_token)throw Error("Sign into your McCluster account on the parent site");
   creatorMuid=await window.MCC.mUid();
   if(!creatorMuid)throw Error("Creator identity not linked to this account");
   await reload();
 }catch(e){showUnavailable(e);}
}
["mrStage","mrTrack","mrModel","mrResearchConsent"].forEach(id=>{
 $(id).addEventListener("change",()=>{nonce=null;refreshInputs();if(id==="mrTrack")showJobs();});
});
$("mrReload").onclick=()=>reload().catch(showUnavailable);
$("mrEnqueue").onclick=enqueue;
boot();
