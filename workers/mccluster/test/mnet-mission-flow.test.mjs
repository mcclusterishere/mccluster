import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../js/mnet.js', import.meta.url), 'utf8');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const handlers={};
  const nodes=new Map();
  function el(id){
    if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,value:'',textContent:'',innerHTML:'',checked:false,open:false,focus(){},closest(){return null;},showModal(){this.open=true;},close(){this.open=false;},addEventListener(type,fn){handlers[id+':'+type]=fn;},querySelector(){return el('proofSubmit');}});
    return nodes.get(id);
  }
  const calls=[];
  const state={user:{id:'user-1'},guest:false,boot:{next_step:'ready'},stall:''};
  const session={access_token:'fixture-mission-session'};
  const missions={all:[],current:null,assignment:null,stats:{},campaign:'',content:'',source:'',attributedMission:'',liveSession:'',liveMission:'',returnHref:'',proofFile:null,proofPreview:''};
  const context={
    missions,$:el,state,MCC:{session(){return session;}},MISSION_FIELDS:'id,title,status',
    sbRest(path){const d=deferred();calls.push({kind:'rest',path,...d});return d.promise;},
    sbRpc(name,args){const d=deferred();calls.push({kind:'rpc',name,args,...d});return d.promise;},
    askToSignIn(reason){calls.push({kind:'gate',name:'signin',reason});},
    askToFinish(reason){calls.push({kind:'gate',name:'profile',reason});return true;},
    clearMissionCapture(){},setStatus(node,message){node.textContent=message;},
    /* the emblem or Fund it: the dialog asks the fund line after the mission loads; not this test's subject */
    fundState(){return Promise.resolve({open:false,note:''});},fundLineHtml(){return '';},
    esc:String,missionHref:id=>'/mnet.html?mission='+id,loadMissions(){},
    uploadProofFile(){return Promise.resolve(null);},
    history:{replaceState(){}},location:{assign(){}},
    window:{MCC_TRACK(){}},URL:{revokeObjectURL(){}},
    encodeURIComponent,Promise,console
  };
  const start=source.indexOf('  var missionOpenVersion=0;');
  const end=source.indexOf('  /* A shared mission link opens that mission',start);
  assert.ok(start>0&&end>start,'mission handlers are present');
  const block=source.slice(start,end);
  const fetchStart=source.indexOf('  function fetchMission(id){');
  const fetchEnd=source.indexOf('  function clearMissionCapture(){',fetchStart);
  assert.ok(fetchStart>0&&fetchEnd>fetchStart);
  // Exercise the real account predicates; only the UI prompt and transport are doubles.
  const sessionStart=source.indexOf('  function sessionToken() {');
  const sessionEnd=source.indexOf('  function storagePath(',sessionStart);
  const stepStart=source.indexOf('  function needsStep() {');
  const stepEnd=source.indexOf('  function paintFinishCard(',stepStart);
  assert.ok(sessionStart>0&&sessionEnd>sessionStart&&stepStart>0&&stepEnd>stepStart);
  vm.runInNewContext(source.slice(sessionStart,sessionEnd)+source.slice(stepStart,stepEnd)+source.slice(fetchStart,fetchEnd)+block+';globalThis.actions={openMission,joinMission,submitMissionProof};',context);
  return {actions:context.actions,missions,calls,el,state,session};
}
test('rapid mission switches ignore stale detail response',async()=>{
  const h=harness();
  const a=h.actions.openMission('mission-A'),b=h.actions.openMission('mission-B');
  h.calls[1].resolve([{id:'mission-B',title:'B',status:'open',skills:[]}]);
  await settle();
  assert.equal(h.missions.current.id,'mission-B');
  h.calls[0].resolve([{id:'mission-A',title:'A',status:'open',skills:[]}]);
  h.calls[2].resolve([]);
  await Promise.all([a,b]);
  assert.equal(h.missions.current.id,'mission-B');
});
test('older assignment lookup cannot overwrite a newly opened mission',async()=>{
  const h=harness();
  h.missions.all=[{id:'mission-A',title:'A',status:'open',skills:[]},{id:'mission-B',title:'B',status:'open',skills:[]}];
  const a=h.actions.openMission('mission-A');
  await settle();
  const b=h.actions.openMission('mission-B');
  await settle();
  h.calls[1].resolve([{id:'assignment-B',status:'in_progress'}]);
  await b;
  h.calls[0].resolve([{id:'assignment-A',status:'in_progress'}]);
  await a;
  assert.equal(h.missions.current.id,'mission-B');
  assert.equal(h.missions.assignment.id,'assignment-B');
});
test('duplicate join invocations send one RPC',async()=>{
  const h=harness();
  const assignmentId='22222222-2222-4222-8222-222222222222';
  h.missions.current={id:'mission-A',title:'A'};
  const joining=h.actions.joinMission(),duplicate=h.actions.joinMission();
  assert.equal(h.calls.filter(c=>c.name==='join_action_mission').length,1);
  assert.equal((await duplicate).accepted,false);
  h.calls[0].resolve({assignment_id:assignmentId,status:'in_progress'});
  assert.equal((await joining).accepted,true);
  assert.equal(h.missions.assignment.id,assignmentId);
  assert.equal(h.el('mnMissionJoin').disabled,false);
});
test('join prompts for a current session and completed profile before any RPC',async()=>{
  for(const condition of ['guest','expired','profile','retry']){
    const h=harness();
    h.missions.current={id:'mission-A',title:'A'};
    h.el('mnMissionDialog').open=true;
    if(condition==='guest')h.state.guest=true;
    if(condition==='expired')h.session.access_token='';
    if(condition==='profile')h.state.boot.next_step='profile';
    if(condition==='retry')h.state.stall='retry';
    assert.equal((await h.actions.joinMission()).accepted,false,condition);
    assert.equal(h.calls.filter(c=>c.kind==='rpc').length,0,condition);
    assert.equal(h.calls[0].name,['guest','expired'].includes(condition)?'signin':'profile',condition);
    assert.equal(h.el('mnMissionDialog').open,false,condition);
  }
});
test('join requires an active database assignment before reporting acceptance',async()=>{
  for(const reply of [{}, {assignment_id:'not-a-uuid',status:'in_progress'}, {assignment_id:'22222222-2222-4222-8222-222222222222',status:'withdrawn'}]){
    const h=harness();
    h.missions.current={id:'mission-A',title:'A'};
    const joining=h.actions.joinMission();
    h.calls[0].resolve(reply);
    assert.equal((await joining).accepted,false);
    assert.equal(h.missions.assignment,null);
    assert.equal(h.el('mnMissionJoin').disabled,false);
  }
});
test('duplicate proof submissions send one RPC',async()=>{
  const h=harness();
  h.missions.current={id:'mission-A'};
  h.missions.assignment={id:'assignment-A',status:'in_progress'};
  h.el('mnMissionProofType').value='text';
  h.el('mnMissionProofStatement').value='Detailed proof statement for the test.';
  const event={preventDefault(){},target:{querySelector(){return h.el('proofSubmit');}}};
  h.actions.submitMissionProof(event);h.actions.submitMissionProof(event);
  await settle();
  assert.equal(h.calls.filter(c=>c.name==='submit_action_proof').length,1);
  h.calls[0].resolve({ok:true});
  await settle();
  const share=h.calls.find(c=>c.name==='set_action_share_intent');
  assert.ok(share);
  share.resolve({ok:true});
  await settle();
  assert.equal(h.missions.assignment.status,'submitted');
});
test('proof completion from another mission does not mutate current assignment',async()=>{
  const h=harness();
  h.missions.current={id:'mission-A'};
  h.missions.assignment={id:'assignment-A',status:'in_progress'};
  h.el('mnMissionProofType').value='text';
  const event={preventDefault(){},target:{querySelector(){return h.el('proofSubmit');}}};
  h.actions.submitMissionProof(event);
  await settle();
  h.missions.current={id:'mission-B'};
  h.missions.assignment={id:'assignment-B',status:'in_progress'};
  h.calls[0].resolve({ok:true});
  await settle();
  h.calls[1].resolve({ok:true});
  await settle();
  assert.equal(h.missions.assignment.status,'in_progress');
});
