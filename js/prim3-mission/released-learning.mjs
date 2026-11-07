import { learningContext } from '../../PRIM3/game/halo/adaptive/topology-learning.mjs';
// Reusable in-mission adapter. Local checkpoint state controls presentation only;
// the server's signed item/evaluator owns answer validation. No tactical win credit.
export function checkpointReady(state, recipeId, checkpointId) {
 if(state?.battlefield?.generated?.recipeId!==recipeId||!checkpointId)return false;
 const [nodeId,step]=checkpointId.split(':');
 const node=state.nodes?.find(n=>n.id===nodeId);
 const expected=Number(step?.replace('STEP_',''));
 return Number.isInteger(expected)&&expected>0&&!!node&&(node.state==='VERIFIED'||Number(node.state?.replace('STEP_',''))>=expected);
}
export function createReleasedLearning({practice,release,getTacticalState,context=null}) {
 if(context)context=learningContext(context);
 const bound=()=>{
  const v=practice.current;
  if(v?.released_mission?.id!==release.id||v.released_mission.recipe_hash!==release.recipe_hash)throw new Error('This learning session belongs to a different release.');
  if(JSON.stringify(v.flow.learning_context??null)!==JSON.stringify(context))throw new Error('Learning mode differs from this saved session.');
  return v;
 };
 return {
  async open(){
   if(!practice.current)await practice.start({fictionChecked:true,geographyChecked:true},{releaseId:release.id,learningContext:context});
   let v=bound();
   if(v.flow.phase==='brief')await practice.submit('begin');
   v=bound();if(v.flow.phase==='play'&&!v.flow.tacticalHandoff)await practice.submit('handoff');
   return bound();
  },
  get ready(){const v=bound(),s=getTacticalState(),cp=v.released_mission.next_checkpoint_id;if(!context||context.variant==='generated')return checkpointReady(s,release.recipe_id,cp);const step=Number(cp?.split('STEP_')[1]);return Number.isInteger(step)&&step>0&&s?.variant===context.variant&&s?.topology===context.topology&&(s.turn>step||(step===1&&s.hasActed===true));},
  async answer(answer){const v=bound();if(!this.ready)throw new Error('Reach and complete this checkpoint step in the game first.');return practice.submit('answer',{answer,checkpointId:v.released_mission.next_checkpoint_id});},
  async hint(){const v=bound();if(!this.ready)throw new Error('Reach this checkpoint first.');return practice.submit('hint',{checkpointId:v.released_mission.next_checkpoint_id});},
  finish(outcome){const v=bound();if(outcome==='completed'&&v.released_mission.next_checkpoint_id)throw new Error('Complete all checkpoint math before reporting completion.');return practice.submit('finish',{outcome});},
  retry:()=>practice.retry(),
  get current(){return bound();}
 };
}
