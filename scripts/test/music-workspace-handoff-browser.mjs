import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/selfservice-tools/node_modules/playwright/index.mjs');
const root=new URL('../../',import.meta.url);
const owner='cccccccc-cccc-cccc-cccc-cccccccccccc',id='dddddddd-dddd-dddd-dddd-dddddddddddd';
const provenance={project_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',version:1,credits:[{credited_to:'Fixture collaborator',uploaded_by:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',original_name:'original.wav'}]};
const draft={id,uid:owner,m_uid:owner,title:'Private collaboration',artist:'Fixture artist',description:'Fixture collaborator — original.wav',status:'draft',master_bucket:'creator-masters',master_path:owner+'/workspace/'+id+'.wav',rights_declaration:{workspace_handoff:provenance}};
// A valid, tiny PCM WAV. No media or accounts leave these in-memory fixtures.
const wave=Buffer.alloc(844);wave.write('RIFF');wave.writeUInt32LE(836,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(800,40);
async function fixture(browser,{foreign=false}={}){
 const page=await browser.newPage();const calls=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  const json=b=>route.fulfill({contentType:'application/json',body:JSON.stringify(b)});
  if(u.pathname==='/vendor/supabase-js-2.57.0.mjs')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {storage:{from(bucket){return {getPublicUrl(path){return {data:{publicUrl:'https://fixture.invalid/'+path}}},remove:async()=>({}),uploadToSignedUrl:async()=>{window.uploadBuckets.push(bucket);return {}}}}}}}`});
  if(u.hostname==='fixture.invalid'){
   if(u.pathname==='/creator.html')return route.fulfill({contentType:'text/html',body:(await readFile(new URL('creator.html',root),'utf8')).replace(/<script[\s\S]*?<\/script>/g,'')});
   return route.fulfill({status:204,body:''});
  }
  if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:`export function createClient(){return {storage:{from(bucket){return {getPublicUrl(path){return {data:{publicUrl:'https://fixture.invalid/'+path}}},remove:async()=>({}),uploadToSignedUrl:async()=>{window.uploadBuckets.push(bucket);return {}}}}}}}`});
  if(u.hostname!=='zmnhbrjyhxzhkxmhkexs.supabase.co')return route.abort();
  calls.push({path:u.pathname,query:u.search,method:r.method(),body:r.postData()?r.postDataJSON():null,auth:r.headers().authorization});
  if(u.pathname.includes('/storage/'))return route.fulfill({contentType:'audio/wav',body:wave});
  if(u.pathname.endsWith('/music_creator_profiles'))return json([{m_uid:owner,handle:'fixture',artist_name:'Fixture artist',status:'active',settings:{}}]);
  if(u.pathname.endsWith('/creator_tracks'))return json(r.method()==='GET'?(u.searchParams.has('id')?[{...draft,uid:foreign?'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb':owner}]:[]):[{id}]);
  if(u.pathname.endsWith('/music-access'))return json({bucket:'creator-previews',path:owner+'/preview.wav',token:'fixture'});
  return json([]);
 });
 await page.goto('https://fixture.invalid/creator.html?workspace_draft='+id);
 await page.evaluate(owner=>{window.uploadBuckets=[];window.currentSession={access_token:'owner-session',user:{id:owner}};window.MCC={session:()=>window.currentSession,refreshIfNeeded:async()=>window.currentSession,mUid:async()=>owner};window.MCC_CREATOR_ONBOARD={client:()=>({state:async()=>({creator:true})}),view:()=> 'studio',wantsEdit:()=>false,EDIT_URL:'creator.html?edit=profile'};},owner);
 await page.addScriptTag({content:await readFile(new URL('js/music-creator-page.js',root),'utf8')});
 await page.addScriptTag({type:'module',content:await readFile(new URL('js/music-creator-studio.js',root),'utf8')});
 return {page,calls,errors};
}
test('private draft resumes own master/credits, requires fresh rights and reuses master on existing release review',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const {page,calls,errors}=await fixture(browser);
 await page.waitForFunction(()=>document.getElementById('trackStatus').textContent.includes('draft loaded'));
 assert.equal(await page.locator('#trackTitle').inputValue(),draft.title);
 assert.equal(await page.locator('#ownsMaster').isChecked(),false);assert.equal(await page.locator('#collaboratorsCleared').isChecked(),false);
 assert.equal(calls.some(c=>c.method!=='GET'),false);
 assert.ok(calls.some(c=>c.query.includes('m_uid=eq.'+owner)&&c.query.includes('status=eq.draft')));
 await page.locator('#trackPreview').setInputFiles({name:'preview.wav',mimeType:'audio/wav',buffer:wave});
 await page.locator('#trackForm').dispatchEvent('submit');
 await page.waitForFunction(()=>document.getElementById('trackStatus').textContent.includes('Confirm your rights'));
 assert.deepEqual(await page.evaluate(()=>window.uploadBuckets),[]);
 await page.locator('#ownsMaster').check();await page.locator('#collaboratorsCleared').check();
 await page.locator('#trackForm').dispatchEvent('submit');
 await page.waitForFunction(()=>!location.search.includes('workspace_draft'));
 assert.deepEqual(await page.evaluate(()=>window.uploadBuckets),['creator-previews']);
 const edits=calls.filter(c=>c.path.endsWith('/creator_tracks')&&c.method==='PATCH');
 assert.equal(edits.length,2);assert.equal(edits[0].body.master_path,draft.master_path);assert.deepEqual(edits[0].body.rights_declaration.workspace_handoff,provenance);
 assert.equal(edits[1].body.status,'pending_review');assert.equal(edits.some(c=>c.body.status==='published'),false);
 assert.deepEqual(errors,[]);await page.close();
 const denied=await fixture(browser,{foreign:true});await denied.page.waitForFunction(()=>document.getElementById('trackStatus').textContent.includes('unavailable'));
 assert.equal(denied.calls.some(c=>c.path.includes('/storage/')),false);await denied.page.close();
 const changed=await fixture(browser);await changed.page.waitForFunction(()=>document.getElementById('trackStatus').textContent.includes('draft loaded'));
 await changed.page.evaluate(()=>{window.currentSession={access_token:'other-session',user:{id:'other'}}});await changed.page.locator('#trackForm').dispatchEvent('submit');
 await changed.page.waitForFunction(()=>document.getElementById('trackStatus').textContent.includes('Account changed'));
 assert.deepEqual(await changed.page.evaluate(()=>window.uploadBuckets),[]);
 }finally{await browser.close()}
});
