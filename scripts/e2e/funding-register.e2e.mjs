/* Existing Funding programs surface with fixtures; never writes application data. */
import assert from 'node:assert/strict';
import {join} from 'node:path';
const {context,widths,browser,server,BASE,OUT,json}=await import('./analytics-unified.e2e.mjs');
const item={route_id:'N01',program_title:'Fixture research program',funder_name:'Fixture official funder',instrument:'research_award',call_status:'closed',technical_fit:{status:'proposed_not_evaluated',work_packages:['W04']},applicant_eligibility:{status:'external_prerequisite'},application_readiness:{status:'blocked'},source_review:'unverified_or_partial',criterion_counts:{blocking:3},source_url:'https://example.org/official',requirements_complete:false,criteria:[{criterion_id:'N01-C01',classification:'proposed_target',requirement:'Fixture target',status:'unverified',blocking:false,source_basis:'implementation_proposal',evidence_refs:[]}],source_versions:[]};
let checks=0;const check=(name,v)=>{assert.ok(v,name);checks++;console.log('PASS '+name);};
try{for(const size of [{width:390,height:844},{width:820,height:1180},{width:1280,height:1000}]){
 const {ctx,page,errors}=await context(size,{theme:'dark',reduced:true,deviceScaleFactor:1});
 await ctx.route('**/v1/control/funding/catalog',route=>json(route,{ok:true,schema_state:'installed',opportunities:[],drafts:[{draft_id:'T01',title:'Fixture private draft',presenting_to:'Fixture partner',relationship_status:'prospective_lead'}]}));
 await ctx.route('**/v1/control/funding/register*',route=>json(route,{ok:true,items:[item],completeness:{state:'complete'}}));
 await page.goto(BASE+'/control.html#create:funding',{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-funding-view="catalog"]');await page.locator('[data-funding-view="catalog"]').click();await page.waitForSelector('[data-funding-route="N01"]');
 check(size.width+' separate funding decisions',await page.locator('#crFundingIntelligence').innerText().then(t=>t.includes('Technical fit: proposed not evaluated')&&t.includes('Applicant eligibility: external prerequisite')&&t.includes('Application readiness: blocked')));
 await page.locator('[data-funding-route="N01"]').click();await page.waitForFunction(()=>!!window.CR.fundingIntelligence.state.detail);check(size.width+' detail preserves criteria uncertainty',await page.locator('#crFundingIntelligence').innerText().then(t=>t.includes('Screening register only')&&t.includes('proposed target · unverified')));
 const w=await widths(page);check(size.width+' funding has no horizontal overflow',w.scrollW===w.clientW);await page.screenshot({path:join(OUT,'funding-'+size.width+'.png')});
 await page.locator('[data-funding-view="drafts"]').click();check(size.width+' private drafts preserved',await page.locator('#crFundingIntelligence').innerText().then(t=>t.includes('Fixture private draft')&&t.includes('PRIVATE DRAFT')));
 check(size.width+' funding no runtime errors '+JSON.stringify(errors),!errors.length);await ctx.close();
}console.log('PASS '+checks+' assertions');}finally{await browser.close();server.close();}
