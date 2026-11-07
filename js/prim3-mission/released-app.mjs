import { LEARNING_VARIANTS, learningContext } from '../../PRIM3/game/halo/adaptive/topology-learning.mjs';
import {storedToken,SESSION_KEY} from '../owner-only.mjs';
import {createPracticeClient} from './client.mjs';
import {createReleasedLearning} from './released-learning.mjs';
import {saveGeneratedRecipe} from '../prim3-tactics/levels/generated.mjs';
const $=id=>document.getElementById(id),practice=createPracticeClient({token:()=>storedToken()});
const base='https://api.mccluster.org/v1/prim3/learning/adaptive/releases';
let selected=null,learning=null,busy=false,publishId=crypto.randomUUID(),timer=null,sources=[],context=null,citySnapshot=null;
const status=text=>{$('releaseStatus').textContent=text;};
async function api(path='',method='GET',body){const token=storedToken();if(!token)throw Error('Sign in again.');const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});if(storedToken()!==token)throw Error('Account changed. Reload.');const out=await r.json();if(!r.ok)throw Error(out.error||'Release unavailable');return out;}
async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){status(e.message);}finally{busy=false;render();}}
function render(){
 $('releaseRetry').hidden=!practice.pending;
 if(!learning)return;
 const v=learning.current,play=v.flow.phase==='play';
 $('releaseQuestion').textContent=v.flow.question?.prompt||'';
 $('releaseCheckpoint').textContent=v.released_mission.next_checkpoint_id?`${v.released_mission.next_checkpoint_id} · ${learning.ready?'Ready for math':'Complete this step in the game to answer'}`:'All checkpoint math completed.';
 $('releaseSubmit').disabled=busy||practice.pending||!play||!learning.ready||practice.mustFinish;
 $('releaseHint').disabled=$('releaseSubmit').disabled||practice.mustAnswer;
 $('releaseFinish').disabled=busy||practice.pending||!play||v.flow.debrief.attempts===0;
 $('releaseSummary').textContent=v.flow.phase==='debrief'?`${v.flow.debrief.correct}/${v.flow.debrief.attempts} answers correct; ${v.flow.debrief.independent} independent. Tactical outcome: ${v.flow.debrief.gameOutcome} (your report). No competency credit.`:'';
}
async function list(){const out=await api();$('releaseList').replaceChildren();for(const r of out.releases){const b=document.createElement('button');b.textContent=`${r.recipe_id} · expires ${new Date(r.expires_at).toLocaleString()}${r.revoked_at?' · revoked':''}`;b.onclick=()=>run(()=>choose(r.id));$('releaseList').append(b);}}
async function choose(id){const out=await api('/'+id);selected=out.release;$('releaseBrief').hidden=false;$('releaseTitle').textContent=selected.recipe.title;$('releaseBriefText').textContent=selected.recipe.disclaimer+' '+selected.recipe.objectives.map(o=>`${o.role}: ${o.steps.join(' → ')} at ${o.label}`).join('. ');$('releaseExpiry').textContent=`Expires ${new Date(selected.expires_at).toLocaleString()}. ${selected.source_snapshot?'Reviewed source: '+selected.source_snapshot.url:'Offline practice; no live news claim.'}`;$('releaseStart').disabled=!selected.available;$('releaseRevoke').disabled=!!selected.revoked_at;}
$('releaseReview').addEventListener('input',()=>{publishId=crypto.randomUUID();});
$('releaseSource').onchange=()=>{const s=sources.find(s=>s.id===$('releaseSource').value);$('releaseSourceLink').hidden=!s;if(s)$('releaseSourceLink').href=s.canonical_url;$('releaseNews').checked=false;};
$('releasePublish').onclick=()=>run(async()=>{const id=publishId,b={id,article_id:$('releaseSource').value||null,theme:$('releaseTheme').value,review:{fiction:$('releaseFiction').checked,geography:$('releaseGeography').checked,source:$('releaseNews').checked},input:{schema:'prim3.generated-input/v1',seed:Number($('releaseSeed').value),objective:$('releaseObjective').value,geography:{country:$('releaseCountry').value.toUpperCase(),place:$('releasePlace').value,lat:Number($('releaseLat').value),lon:Number($('releaseLon').value),terrain:$('releaseTerrain').value,sourceUrl:$('releaseGeo').value,reviewId:id}}};const out=await api('','POST',b);await list();await choose(out.release.id);status('Reviewed release saved.');});
$('releaseStart').onclick=()=>run(async()=>{
 if(!selected)throw Error('Choose a release.');
 if(timer){clearInterval(timer);timer=null;}learning=null;
 if(practice.current?.flow.phase==='debrief')practice.newPractice();
 if(practice.current&&practice.current.released_mission?.id!==selected.id)throw Error('Finish the existing practice before changing releases.');
 context=practice.current?.flow.learning_context??($('learningTopology').value==='legacy'?null:learningContext({version:'prim3.lattice-learning/v1',variant:$('learningVariant').value,topology:$('learningTopology').value}));
 if(context){$('learningVariant').value=context.variant;$('learningTopology').value=context.topology;describeMode();}
 if(!context&&$('learningVariant').value!=='generated')throw Error('Select a supported lattice learning mode for this variant.');
 const candidate=createReleasedLearning({practice,release:selected,getTacticalState:gameSnapshot,context});
 await candidate.open();learning=candidate;
 // Save only the immutable reviewed input; the existing generated level owns gameplay.
 const saved=!context||context.variant==='generated'?saveGeneratedRecipe(selected.recipe_input):{href:LEARNING_VARIANTS[context.variant].href+(context.variant==='city'?'?topology='+context.topology:'')};
 citySnapshot=null;
 $('releaseGame').hidden=false;$('releaseGame').src=saved.href;$('releasePlay').hidden=false;
 if(timer)clearInterval(timer);timer=setInterval(render,500);status('Complete the mission steps and answer their math here.');
});
$('releaseSubmit').onclick=()=>run(async()=>{const v=await learning.answer($('releaseAnswer').value);status(v.result.feedback);$('releaseAnswer').value='';});
$('releaseHint').onclick=()=>run(async()=>{const v=await learning.hint();status(v.result.hint);});
$('releaseFinish').onclick=()=>run(async()=>{await learning.finish($('releaseOutcome').value);status('Debrief saved. Tactical outcome remains your report.');});
$('releaseRetry').onclick=()=>run(async()=>{await practice.retry();status('Original learning receipt recovered. Re-enter the same release to continue.');});
$('releaseRevoke').onclick=()=>run(async()=>{await api('/'+selected.id+'/revoke','POST',{});await choose(selected.id);await list();status('Release revoked. Existing evidence is retained.');});
function conceal(){if(timer)clearInterval(timer);practice.clear();$('releaseGame').src='about:blank';document.querySelector('.pm').hidden=true;}
window.addEventListener('mcc:auth-changed',conceal);window.addEventListener('storage',e=>{if(e.key===SESSION_KEY||e.key===null)conceal();});window.addEventListener('pagehide',()=>{if(timer)clearInterval(timer);});
await run(async()=>{const {config}=await practice.connect();if(!config.enabled||!config.releases_enabled)throw Error('Reviewed missions are not enabled. No release has been written.');$('releasePublish').disabled=false;await list();try{sources=(await api('/sources')).sources;for(const s of sources){let u;try{u=new URL(s.canonical_url);}catch{continue;}if(u.protocol!=='https:')continue;const o=document.createElement('option');o.value=s.id;o.textContent=`${s.title} · ${s.published_at}`;$('releaseSource').append(o);}}catch{status('News discovery unavailable; reviewed offline practice remains available.');}if(practice.current?.released_mission){await choose(practice.current.released_mission.id);if(practice.current.flow.phase==='debrief'){context=practice.current.flow.learning_context??null;learning=createReleasedLearning({practice,release:selected,getTacticalState:()=>null,context});$('releasePlay').hidden=false;$('releaseGame').hidden=true;}}});

function gameSnapshot(){
 const w=$('releaseGame').contentWindow;if(!context||context.variant==='generated')return w?.__tx?.state;
 if(context.variant==='city')return citySnapshot?.();
 if(context.variant==='courtyard'){const s=w?.__PRIM3?.snapshot();return s?{variant:'courtyard',topology:'square',turn:s.turn}:null;}
 const s=w?.__tx?.state;return s?{variant:context.variant,topology:'square',turn:s.round}:null;
}
$('releaseGame').addEventListener('load',async()=>{if(context?.variant==='city'){try{const w=$('releaseGame').contentWindow;citySnapshot=()=>w.__prim3CityLearningSnapshot?.();}catch{status('City learning snapshot unavailable. Resume the same mission.');}}});
function describeMode(){const v=$('learningVariant').value,t=$('learningTopology').value;$('learningFrame').textContent=LEARNING_VARIANTS[v].title+'. '+LEARNING_VARIANTS[v].frame+'. '+(v==='generated'?'Math follows the generated objective steps.':'After each of the first three turns, answer one practice question. Combat progress is browser-reported.');$('learningTopology').querySelector('[value=hex]').disabled=v!=='city';$('learningTopology').querySelector('[value=legacy]').disabled=v!=='generated';if((t==='hex'&&v!=='city')||(t==='legacy'&&v!=='generated'))$('learningTopology').value='square';}
$('learningVariant').onchange=describeMode;describeMode();
