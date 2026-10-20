/* Canonical McCluster music/media relation contract v1.
 * A declaration does not grant access or ownership: server-side ACL/RLS and
 * licensed storage must authorize every actual media or audio operation.
 */
const validId=x=>typeof x==="string"&&x.length>=1&&x.length<=150&&/^[A-Za-z0-9:_-]+$/.test(x);
const kinds=new Set(["audio","video","image","live","short_clip","mixed_media","3d","studio_project"]);
const origins=new Set(["human","approved_agent","system"]);
const states=new Set(["draft","pending_rights","approved","revoked"]);
const relationKinds=new Set(["track","project","none"]);
const exposureKinds=new Set(["user_selected","system_opt_in","system_queue","editorial_autoplay","creator_preview"]);
export const MEDIA_GRAPH_VERSION="mcc.media.music-relation.v1";

export function validateMusicMediaRelation(raw) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("media relation must be an object");
  const {mediaId,mediaKind,producer,rights,audioRelation,provenance}=raw;
  if(!validId(mediaId)||!kinds.has(mediaKind))throw Error("invalid canonical media identity or kind");
  if(!producer||!origins.has(producer.kind)||!validId(producer.id))
    throw Error("human/agent/system creation authority must be declared");
  if(!rights||!states.has(rights.status)||!validId(rights.ownerId))
    throw Error("rights status and responsible owner are mandatory");
  if(!audioRelation||!relationKinds.has(audioRelation.kind))
    throw Error("every media asset must declare its relationship to Music");
  if(audioRelation.kind==="none"){
    if(typeof audioRelation.reason!=="string"||audioRelation.reason.length<8)
      throw Error("silent/no-audio media require an explicit reason");
    if(audioRelation.trackId||audioRelation.projectId)
      throw Error("unlinked asset cannot claim a track/project");
  }else{
    const key=audioRelation.kind==="track"?"trackId":"projectId";
    if(!validId(audioRelation[key]))throw Error("music reference must identify a canonical track or project");
    if(audioRelation.url||audioRelation.masterUrl||audioRelation.accessToken)
      throw Error("do not copy signed media URLs or authentication tokens into the relation");
  }
  if(producer.kind==="approved_agent" && (!provenance||!validId(provenance.agentRunId)))
    throw Error("agent output requires an attributable run ID");
  if(raw.subjectDna||raw.genome||raw.healthInferences)
    throw Error("the media graph must not collect personal DNA, health, or inferred neural traits");
  return Object.freeze({
    schema:MEDIA_GRAPH_VERSION,mediaId,mediaKind,
    producer:Object.freeze({kind:producer.kind,id:producer.id}),
    rights:Object.freeze({status:rights.status,ownerId:rights.ownerId}),
    audioRelation:Object.freeze({...audioRelation}),
    provenance:provenance?Object.freeze({
      agentRunId:provenance.agentRunId||null,sourceMediaId:provenance.sourceMediaId||null,
      transform:provenance.transform||null
    }):null
  });
}

export function researchAllowedForAsset(relation,{researchOptIn=false}={}) {
  const r=validateMusicMediaRelation(relation);
  return Object.freeze({
    analysisPermitted:researchOptIn===true&&r.rights.status==="approved"&&
      r.audioRelation.kind!=="none",
    reason:researchOptIn!==true?"requires affirmative analysis opt-in":
      r.rights.status!=="approved"?"rights not approved":
      r.audioRelation.kind==="none"?"asset contains no linked music":"approved opt-in analytical job",
    // Approval to analyze is still NOT a license to train an external model.
    modelTrainingPermitted:false,automaticPublicationPermitted:false
  });
}

export function playbackSelectionEvidence(origin,details={}) {
  if(!exposureKinds.has(origin))throw Error("unrecognized music selection origin");
  const meaningfulChoice=origin==="user_selected";
  return {
    schema:"mcc.music.selection-evidence.v1",selectionOrigin:origin,
    playedVia:"MCC_MUSIC",exposure:origin!=="user_selected",
    inferPreference:meaningfulChoice && details.affirmativePreference===true,
    // An explicit play still isn't enough to infer personality, genetic or neural traits.
    inferBrainActivity:false,inferMedicalStatus:false,
    needsGesture:origin!=="user_selected",
    userConsentRequired:!meaningfulChoice
  };
}
