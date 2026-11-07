// Reusable in-mission adapter. Local checkpoint state controls presentation only;
// the server's signed item/evaluator owns answer validation. No tactical win credit.
export function checkpointReady(state, recipeId, checkpointId) {
 if(state?.battlefield?.generated?.recipeId!==recipeId||!checkpointId)return false;
 const [nodeId,step]=checkpointId.split(':');
 const node=state.nodes?.find(n=>n.id===nodeId);
 const expected=Number(step?.replace('STEP_',''));
 return Number.isInteger(expected)&&expected>0&&!!node&&(node.state==='VERIFIED'||Number(node.state?.replace('STEP_',''))>=expected);
}
export function createReleasedLearning({practice,release,getTacticalState}) {
 const bound=()=>{
  const v=practice.current;
  if(v?.released_mission?.id!==release.id||v.released_mission.recipe_hash!==release.recipe_hash)throw new Error('This learning session belongs to a different release.');
  return v;
 };
 return {
  async open(){
   if(!practice.current)await practice.start({fictionChecked:true,geographyChecked:true},{releaseId:release.id});
   let v=bound();
   if(v.flow.phase==='brief')await practice.submit('begin');
   v=bound();if(v.flow.phase==='play'&&!v.flow.tacticalHandoff)await practice.submit('handoff');
   return bound();
  },
  get ready(){const v=bound();return checkpointReady(getTacticalState(),release.recipe_id,v.released_mission.next_checkpoint_id);},
  async answer(answer){const v=bound();if(!this.ready)throw new Error('Reach and complete this checkpoint step in the game first.');return practice.submit('answer',{answer,checkpointId:v.released_mission.next_checkpoint_id});},
  async hint(){const v=bound();if(!this.ready)throw new Error('Reach this checkpoint first.');return practice.submit('hint',{checkpointId:v.released_mission.next_checkpoint_id});},
  finish(outcome){bound();return practice.submit('finish',{outcome});},
  retry:()=>practice.retry(),
  get current(){return bound();}
 };
}
