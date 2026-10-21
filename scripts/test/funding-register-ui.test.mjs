import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
async function panel(request){
 const listeners={};const window={CR:{},addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn)};
 vm.runInNewContext(await readFile('js/control-room/funding-intelligence.js','utf8'),{window,URL,document:{getElementById:()=>null}});
 const F=window.CR.fundingIntelligence;F.init({request,render:()=>{}});F.state.mode='catalog';
 return{F,emit:(name,detail)=>(listeners[name]||[]).forEach(fn=>fn({detail}))};
}
const item={route_id:'N01',program_title:'Test program',funder_name:'Official funder',instrument:'research_award',call_status:'closed',technical_fit:{status:'proposed_not_evaluated',work_packages:['W04']},applicant_eligibility:{status:'external_prerequisite'},application_readiness:{status:'blocked'},source_review:'unverified_or_partial',criterion_counts:{blocking:3},source_url:'https://example.org/official',requirements_complete:false};
test('funding cards distinguish technical fit, eligibility, readiness and incomplete criteria',async()=>{
 const {F}=await panel(path=>Promise.resolve(path.endsWith('/catalog')?{schema_state:'installed',drafts:[],opportunities:[]}:{ok:true,items:[item],completeness:{state:'truncated',limit:100}}));
 await F.load();const html=F.render();
 assert.match(html,/Technical fit:<\/b> proposed not evaluated/);assert.match(html,/Applicant eligibility:<\/b> external prerequisite/);assert.match(html,/Application readiness:<\/b> blocked/);assert.match(html,/completeness: truncated/);assert.match(html,/3 blocking criteria/);assert.doesNotMatch(html,/eligible to apply|funded|\d+%/i);
});
test('register details preserve unknowns and label proposed targets separately from requirements',async()=>{
 const detail={...item,criteria:[{criterion_id:'N01-C01',classification:'proposed_target',requirement:'Test target <not a funder rule>',status:'unverified',source_basis:'implementation_proposal',blocking:false,evidence_refs:[]}],source_versions:[]};
 const {F}=await panel(path=>Promise.resolve(path.endsWith('/catalog')?{schema_state:'installed',opportunities:[],drafts:[]}:{ok:true,items:[path.includes('?')?detail:item],completeness:{state:'complete'}}));
 await F.load();await F.loadRoute('N01');const html=F.render();
 assert.match(html,/Screening register only/);assert.match(html,/proposed target · unverified/);assert.match(html,/&lt;not a funder rule&gt;/);assert.match(html,/Reviewer: not assigned/);assert.match(html,/Evidence references: none/);assert.match(html,/aria-expanded="true"/);
});
test('missing register preserves the existing catalog and drafts without implying readiness',async()=>{
 const {F}=await panel(path=>path.endsWith('/catalog')?Promise.resolve({schema_state:'installed',opportunities:[{program_title:'Legacy program'}],drafts:[{title:'Private draft'}]}):Promise.reject(new Error('Migration pending')));
 await F.load();assert.match(F.render(),/Migration pending/);assert.match(F.render(),/Legacy program/);assert.equal(F.state.catalog.drafts.length,1);
});
test('sign-out clears funding records and fences late catalog and detail responses',async()=>{
 const pending=[];const {F,emit}=await panel(path=>new Promise(resolve=>pending.push({path,resolve})));
 const load=F.load(),details=F.loadRoute('N01');emit('mcc:auth-changed',{signed_in:false});
 for(const p of pending)p.resolve(p.path.endsWith('/catalog')?{opportunities:[item],drafts:[]}:{ok:true,items:[item]});await Promise.all([load,details]);
 assert.equal(F.state.catalog,null);assert.equal(F.state.register,null);assert.equal(F.state.detail,null);assert.match(F.render(),/Reload Control/);await F.load();assert.equal(pending.length,3);
});
