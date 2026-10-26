/* Adapter contract for pinned #543's existing mcc_music_research_enqueue path.
   Deliberately no enqueue call or provider runner. Never a second queue. Inputs
   must come from verified identity/database records, not browser assertions. */
const previous = {analyze:null,separate:'analyze',transcribe:'separate',engrave:'transcribe'};
export function workspaceAnalysisHandoff({actorId,creatorMUid,track,attestation,stage,consent,parent,model}={}) {
 const blockers=[];
 if(!Object.hasOwn(previous,stage))throw new TypeError('Unsupported analysis stage');
 if(!actorId||!creatorMUid||track?.uid!==actorId||track?.m_uid!==creatorMUid)throw new TypeError('Creator-owned track required');
 if(!track?.rights_declaration?.workspace_handoff)throw new TypeError('Workspace provenance required');
 if(consent!==true)blockers.push('Explicit analysis consent required');
 if(!['attested','cleared'].includes(track.rights_status)||attestation?.track_id!==track.id||attestation?.creator_m_uid!==creatorMUid||attestation?.owns_master!==true||attestation?.collaborators_cleared!==true)blockers.push('Creator rights attestation required');
 if(['rejected','archived'].includes(track.status)||track.master_bucket!=='creator-masters'||!String(track.master_path||'').startsWith(actorId+'/workspace/'))blockers.push('Eligible private release master required');
 if(previous[stage]&&!(parent?.creator_m_uid===creatorMUid&&parent?.track_id===track.id&&parent?.stage===previous[stage]&&parent?.status==='approved'))blockers.push('Creator approval of prior stage required');
 if(!model?.enabled||model.stage!==stage||!['first_party','approved_commercial'].includes(model.license_class)||!model.reviewed_at)blockers.push('Reviewed and enabled model required');
 blockers.push('Research pipeline integration and deployment approval pending');
 return Object.freeze({track_id:track.id,stage,prior_stage:previous[stage],provider_execution:false,enqueue_allowed:false,blockers:Object.freeze(blockers),existing_queue_rpc:'mcc_music_research_enqueue'});
}
