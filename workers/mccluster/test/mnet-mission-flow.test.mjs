import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../js/mnet.js', import.meta.url), 'utf8');
/* the pure mission-post helpers the page loads before js/mnet.js (window.MCC_MISSION_POSTS) */
const MISSION_POSTS = createRequire(import.meta.url)('../../../js/world-mission-posts.js');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
/* a piece of the page, from the line that starts with `from` to the line that starts with `to` */
function slice(from,to){
  const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
  assert.ok(start>0&&end>start,'js/mnet.js still has '+from.trim());
  return source.slice(start,end);
}
/* the page's own first state of the mission feed, so the harness cannot drift from it */
const MISSION_FEED=(()=>{const m=/\n\s*missionFeed: (\{[^\n]*\}),\n/.exec(source);assert.ok(m,'the page declares state.missionFeed');return m[1];})();
class HarnessURL extends URL{static revokeObjectURL(){}}
function harness(){
  const handlers={};
  const nodes=new Map();
  function el(id){
    if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,value:'',textContent:'',innerHTML:'',checked:false,open:false,focus(){},closest(){return null;},showModal(){this.open=true;},close(){this.open=false;},addEventListener(type,fn){handlers[id+':'+type]=fn;},querySelector(){return el('proofSubmit');}});
    return nodes.get(id);
  }
  const calls=[];
  const state={user:{id:'user-1'},guest:false,boot:{next_step:'ready'},stall:'',missionFeed:vm.runInNewContext('('+MISSION_FEED+')')};
  const session={access_token:'fixture-mission-session'};
  const missions={all:[],current:null,assignment:null,stats:{},campaign:'',content:'',source:'',attributedMission:'',liveSession:'',liveMission:'',returnHref:'',proofFile:null,proofPreview:''};
  const stored=new Map();
  const context={
    /* missions are public (owner, 2026-11-17): js/mnet.js has no switch for them, so the flow runs as it ships */
    missions,$:el,state,MCC:{session(){return session;}},MISSION_FIELDS:'id,title,status',MISSION_POSTS,
    sbRest(path){const d=deferred();calls.push({kind:'rest',path,...d});return d.promise;},
    sbRpc(name,args){const d=deferred();calls.push({kind:'rpc',name,args,...d});return d.promise;},
    askToSignIn(reason){calls.push({kind:'gate',name:'signin',reason});},
    askToFinish(reason){calls.push({kind:'gate',name:'profile',reason});return true;},
    clearMissionCapture(){},setStatus(node,message){node.textContent=message;},
    /* the emblem or Fund it: the dialog asks the fund line after the mission loads; not this test's subject */
    fundState(){return Promise.resolve({open:false,note:''});},fundLineHtml(){return '';},
    missionHref:id=>'/mnet.html?mission='+id,loadMissions(){},
    uploadProofFile(){return Promise.resolve(null);},
    history:{replaceState(){}},location:{assign(){},origin:'https://mccluster.org'},
    sessionStorage:{getItem(k){return stored.has(k)?stored.get(k):null;},setItem(k,v){stored.set(k,String(v));}},
    window:{MCC_TRACK(){}},URL:HarnessURL,
    encodeURIComponent,Promise,console
  };
  const block=slice('  var missionOpenVersion=0;','  /* A shared mission link opens that mission');
  const fetchBlock=slice('  function fetchMission(id){','  function clearMissionCapture(){');
  const missionDisplay=slice('  function publicMission(m) {','  var MISSION_FIELDS=');
  // Exercise the real account predicates; only the UI prompt and transport are doubles.
  const sessionBlock=slice('  function sessionToken() {','  function storagePath(');
  const stepBlock=slice('  function needsStep() {','  function paintFinishCard(');
  /* the dialog's real words and links: the page's own escaping and link check, and the mission details read it makes
     before it draws (each mission asked for once; nothing more once the table is known to be absent) */
  const escBlock=slice('  function esc(value) {','  function setStatus(node, text, kind) {');
  const linkBlock=slice('  function safeHttpUrl(value) {','  /* Line icons for the post actions');
  const feedConstants=slice('  var MISSION_ID = /^[0-9a-f-]{36}$/i;','  /* the open missions, read once');
  const detailsBlock=slice('  function loadMissionDetails(ids) {','  /* the details of what is on screen now;');
  vm.runInNewContext(escBlock+linkBlock+feedConstants+detailsBlock+sessionBlock+stepBlock+missionDisplay+fetchBlock+block+';globalThis.actions={openMission,joinMission,submitMissionProof,creditLinkHtml};',context);
  return {actions:context.actions,missions,calls,el,state,session,stored};
}
const MISSION_A='0e1f0000-0000-4000-8000-00000000000a',MISSION_B='0e1f0000-0000-4000-8000-00000000000b';
const detailReads=h=>h.calls.filter(c=>c.kind==='rest'&&/^action_mission_details\?/.test(c.path));
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
/* THE DIALOG'S DETAILS (WORLD-FEED-AND-MISSIONS-20261117.md, target 6): a mission's proof hint, safety line and credit are read
   before its dialog draws, once per mission, and only for the mission still asked for */
test('the dialog draws each mission with its own details, read once, and a late answer for an older mission draws nothing',async()=>{
  const h=harness();
  const a=h.actions.openMission(MISSION_A);
  h.calls[0].resolve([{id:MISSION_A,title:'A',status:'open',skills:[]}]);
  await settle();
  assert.equal(detailReads(h).length,1,'the details are asked for before the dialog draws');
  assert.ok(detailReads(h)[0].path.endsWith('&mission_id=in.('+MISSION_A+')'),detailReads(h)[0].path);
  assert.equal(h.missions.current,null,'nothing is drawn while its details are out');
  const b=h.actions.openMission(MISSION_B);
  h.calls[2].resolve([{id:MISSION_B,title:'B',status:'open',skills:[]}]);
  await settle();
  assert.equal(detailReads(h).length,2);
  detailReads(h)[1].resolve([{mission_id:MISSION_B,credit_line:'Credit for B.',proof_hint:'A photo of B.'}]);
  await settle();
  assert.equal(h.missions.current.id,MISSION_B);
  assert.match(h.el('mnMissionDetail').innerHTML,/A photo of B\./);
  detailReads(h)[0].resolve([{mission_id:MISSION_A,credit_line:'Credit for A.',proof_hint:'A photo of A.'}]);
  await settle();
  const lookups=id=>h.calls.filter(c=>c.kind==='rest'&&c.path.startsWith('action_mission_assignments?mission_id=eq.'+id));
  lookups(MISSION_B)[0].resolve([]);
  await Promise.all([a,b]);
  assert.equal(h.missions.current.id,MISSION_B,'the late answer for A does not take the dialog back');
  assert.equal(h.el('mnMissionTitle').textContent,'B');
  assert.doesNotMatch(h.el('mnMissionDetail').innerHTML,/photo of A/);
  assert.equal(lookups(MISSION_A).length,0,'no assignment lookup for the mission left behind');
  /* A's details are kept: opening it again draws them without asking again */
  assert.equal(h.state.missionFeed.details[MISSION_A].proof_hint,'A photo of A.');
  const again=h.actions.openMission(MISSION_A);
  h.calls.at(-1).resolve([{id:MISSION_A,title:'A',status:'open',skills:[]}]);
  await settle();
  assert.equal(detailReads(h).length,2,'each mission is asked for once');
  assert.match(h.el('mnMissionDetail').innerHTML,/A photo of A\./);
  lookups(MISSION_A)[0].resolve([]);
  await again;
});
test('where the details table is not there yet, the dialog still opens, and that is remembered for the session',async()=>{
  const h=harness();
  const a=h.actions.openMission(MISSION_A);
  h.calls[0].resolve([{id:MISSION_A,title:'A',status:'open',skills:[]}]);
  await settle();
  detailReads(h)[0].reject(Object.assign(new Error('Could not find the table'),{status:404,data:{code:'PGRST205'}}));
  await settle();
  assert.equal(h.missions.current.id,MISSION_A,'the dialog opens without them');
  assert.doesNotMatch(h.el('mnMissionDetail').innerHTML,/mnMissionCredit|<blockquote>/);
  assert.equal(h.state.missionFeed.detailsAbsent,true);
  assert.equal(h.stored.get('mcc.missionDetails.absent'),'1');
  h.calls.at(-1).resolve([]);
  await a;
  const b=h.actions.openMission(MISSION_B);
  h.calls.at(-1).resolve([{id:MISSION_B,title:'B',status:'open',skills:[]}]);
  await settle();
  assert.equal(detailReads(h).length,1,'nothing more is asked once the table is known to be absent');
  assert.equal(h.missions.current.id,MISSION_B);
  h.calls.at(-1).resolve([]);
  await b;
});
/* A guest can open any mission the public may read (open, paused or closed: the policy "public reads open missions"), but only
   an open one takes new people, so only an open one asks a guest to sign in */
test('a guest is asked to sign in only for a mission that takes new people',async()=>{
  for(const [status,line] of [['open','Sign in to join this mission.'],['paused','This mission is not taking new people.'],['closed','This mission is not taking new people.']]){
    const h=harness();
    h.state.user=null;h.state.guest=true;
    const opening=h.actions.openMission('mission-'+status);
    h.calls[0].resolve([{id:'mission-'+status,title:status,status,skills:[]}]);
    const result=await opening;
    assert.equal(result&&result.opened,true,status);
    assert.equal(h.el('mnMissionJoin').hidden,status!=='open',status);
    assert.equal(h.el('mnMissionDialogStatus').textContent,line,status);
    assert.equal(h.calls.length,1,'a guest looks up no assignment: '+status);
  }
});
/* Every word of a mission and its details reaches the dialog escaped, and only http(s) addresses become links (the rows are
   public data any editor of the catalog writes; the page never trusts them) */
test('the dialog escapes every word of a mission and its details, and links only http(s) addresses',async()=>{
  const h=harness();
  const X='0e1f0000-0000-4000-8000-0000000000a1';
  const opening=h.actions.openMission(X);
  h.calls[0].resolve([{id:X,title:'<img src=x onerror=alert(1)>',description:'<script>alert(2)</script> & "quoted"',status:'open',base_points:'<b>9</b>',difficulty:'"><img src=x onerror=alert(3)>',skills:['<svg onload=alert(4)>']}]);
  await settle();
  detailReads(h)[0].resolve([{mission_id:X,catalog:'other',
    credit_line:'From <b>Evil</b> (javascript:alert(5)) see https://ok.example/path"><img src=x onerror=alert(6)> and data:text/html,<script>alert(7)</script>.',
    proof_hint:'<img src=x onerror=alert(8)>proof',safety_note:'<script>alert(9)</script>safety',about:'<i>their words</i>',about_credit:'<a href="javascript:alert(10)">who</a>',
    source_url:'https://source.example/"onmouseover="alert(11)',license_name:'<i>Licence</i>',license_url:'https://creativecommons.org/licenses/by/4.0/',doi:'https://doi.org/10.5281/zenodo.1'}]);
  await settle();
  h.calls.at(-1).resolve([]);
  await opening;
  const html=h.el('mnMissionDetail').innerHTML;
  assert.equal(h.el('mnMissionTitle').textContent,'<img src=x onerror=alert(1)>','the title is text, never markup');
  for(const raw of ['<script','<img','<svg','<i>','<b>9','<b>Evil','onerror=alert(3)>','"onmouseover','href="javascript:']){
    assert.ok(!html.includes(raw),'no raw '+raw+' in the dialog: '+html);
  }
  for(const shown of ['&lt;script&gt;alert(2)&lt;/script&gt; &amp; &quot;quoted&quot;','&lt;img src=x onerror=alert(8)&gt;proof','&lt;script&gt;alert(9)&lt;/script&gt;safety','<blockquote>&lt;i&gt;their words&lt;/i&gt;</blockquote>','&lt;a href=&quot;javascript:alert(10)&quot;&gt;who&lt;/a&gt;','&lt;svg onload=alert(4)&gt;']){
    assert.ok(html.includes(shown),'shown as words: '+shown);
  }
  /* every link the dialog writes: an http(s) address, quoted, and opened apart from the World */
  const links=[...html.matchAll(/<a\b([^>]*)>/g)].map(m=>m[1]);
  assert.ok(links.length>=3,html);
  for(const attrs of links){
    const href=/^ href="([^"]*)" target="_blank" rel="noopener noreferrer"$/.exec(attrs);
    assert.ok(href,'a link is exactly an href, target and rel: '+attrs);
    assert.match(href[1],/^https?:\/\/[^"<>\s]+$/,'an http(s) address: '+href[1]);
  }
  /* and the link check itself, whatever a row carries (the details are cleaned before they are kept; this is the page's own
     check behind that): never a link to anything but http(s), and the address escaped in the attribute and in the words */
  assert.equal(h.actions.creditLinkHtml('javascript:alert(12)'),'javascript:alert(12)');
  assert.equal(h.actions.creditLinkHtml('data:text/html,<script>alert(13)</script>'),'data:text/html,&lt;script&gt;alert(13)&lt;/script&gt;');
  assert.equal(h.actions.creditLinkHtml('https://ok.example/a"b<c'),'<a href="https://ok.example/a%22b%3Cc" target="_blank" rel="noopener noreferrer">https://ok.example/a&quot;b&lt;c</a>');
});
