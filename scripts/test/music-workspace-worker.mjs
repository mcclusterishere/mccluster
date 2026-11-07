import {test} from 'node:test';import assert from 'node:assert/strict';import {handleMusicWorkspace,musicAudioSignature} from '../../workers/mccluster/src/music-workspace.js';
test('music proxy keeps user JWT and denies unsigned file access; originals cannot be replaced',async()=>{
 const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-key'},original=globalThis.fetch,calls=[];const project='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',asset='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',bytes=new TextEncoder().encode('RIFF0000WAVE');
 assert.equal(musicAudioSignature(bytes,'audio/wav'),true);assert.equal(musicAudioSignature(new TextEncoder().encode('<html>'),'audio/mpeg'),false);
 globalThis.fetch=async(url,init)=>{calls.push({url,init});if(String(url).includes('/rpc/'))return Response.json(JSON.parse(init.body).p_action==='asset_upload'?{id:asset,mime:'audio/wav',bytes:12}:{ok:true});return new Response('{}',{status:200})};try{
 const path='https://api.mccluster.org/v1/music-workspace/file?project='+project+'&id='+asset;assert.equal((await handleMusicWorkspace(new Request(path),env)).status,401);assert.equal(calls.length,0);
 assert.equal((await handleMusicWorkspace(new Request(path,{method:'POST',headers:{authorization:'Bearer creator-session'},body:bytes}),env)).status,200);
 assert.equal(calls.every(c=>c.init.headers.authorization==='Bearer creator-session'),true);assert.equal(calls[1].init.headers['x-upsert'],'false');assert.equal(JSON.parse(calls[2].init.body).p_data.sha256.length,64);
 calls.length=0;assert.equal((await handleMusicWorkspace(new Request(path,{method:'POST',headers:{authorization:'Bearer creator-session'},body:new Uint8Array(12)}),env)).status,400);assert.equal(calls.length,1);
 }finally{globalThis.fetch=original}
});
