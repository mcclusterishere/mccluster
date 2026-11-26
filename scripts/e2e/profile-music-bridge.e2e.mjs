/* Fixture-only browser checks. No account, music or profile calls hit production. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const app='https://mccluster.org', api='https://api.mccluster.org';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ownTrack='44444444-4444-4444-8444-444444444444';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const account={identity:{mccluster_id:'fixture.member'},profile:{m_uid:uid,visibility:'public',display_name:'The account name',headline:'Custom profile headline',bio:'Their own words.'},counts:{}};
const creator={m_uid:uid,handle:'studio-alias',artist_name:'The Artist Name',bio:'Artist bio',settings:{}};
const release={id:ownTrack,m_uid:uid,status:'published',title:'Published fixture track',artist:'The Artist Name',access_mode:'public',audio_url:app+'/assets/audio/profile-fixture.wav',duration_ms:5000};
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png'};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
let total=0;
function check(name,result){assert.ok(result,name);total++;console.log('PASS '+name);}
function wave(){
  const b=Buffer.alloc(44+80000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(80000,40);return b;
}
async function setup(width,{signed=true,denied=false}={}){
  const ctx=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
  const eq=(u,k)=>u.searchParams.get(k)?.slice(3);
  const auth=await readFile(join(ROOT,'js/mcc-auth.js'),'utf8');
  await ctx.addInitScript(({signed})=>{
    if(signed){
      const expires_at=Math.floor(Date.now()/1000)+3600;
      localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp:expires_at,sub:'22222222-2222-4222-8222-222222222222'})).replace(/=+$/,'')+'.y',refresh_token:'fixture',expires_at}));
    }
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
  },{signed});
  const calls=[];
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    const json=(b,status=200)=>route.fulfill({status,headers:cors,contentType:'application/json',body:JSON.stringify(b)});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    if(u.origin===api){
      if(p==='/v1/mnet/bootstrap')return json({identity:{mccluster_id:'viewer.one'},profile:{onboarding_complete:true},needs_onboarding:false});
      if(p.endsWith('/posts'))return json({posts:[]});
      if(p==='/v1/mnet/people/'+uid || p==='/v1/mnet/people/fixture.member'){
        calls.push(p);return denied||!signed?json({},404):json(account);
      }
      if(p==='/v1/mnet/people/mccluster')return json({identity:{mccluster_id:'mccluster'},profile:{m_uid:other,display_name:'Configured house profile',headline:'Public house bio'}});
      if(p.startsWith('/v1/fronts/'))return json({ok:false},404);
      return json({ok:false,items:[],posts:[],threads:[],events:[]},p==='/v1/status'?403:200);
    }
    if(u.hostname.endsWith('.supabase.co')){
      if(p==='/functions/v1/music-access')return json({url:release.audio_url,expires_in:300});
      if(p==='/rest/v1/music_creator_profiles'){
        const alias=eq(u,'handle'), m=eq(u,'m_uid');
        return json(alias==='studio-alias'||m===uid||(!alias&&!m)?[creator]:[]);
      }
      if(p==='/rest/v1/creator_tracks'){
        if(!eq(u,'m_uid')) return json([]);
        check('request is scoped to the exact member and published releases',eq(u,'m_uid')===uid&&eq(u,'status')==='published');
        return json(u.searchParams.get('select')?.includes('m_uid')?[release,{...release,id:other,status:'draft',title:'Never expose draft'}]:[release]);
      }
      return json([]);
    }
    if(u.origin!==app)return route.abort();
    if(p==='/assets/audio/profile-fixture.wav')return route.fulfill({contentType:'audio/wav',body:wave()});
    if(p==='/js/mcc-auth.js')return route.fulfill({contentType:'text/javascript',body:auth});
    const path=resolve(ROOT,'.'+p);
    if(!path.startsWith(resolve(ROOT)+sep))return route.abort();
    try{return route.fulfill({body:await readFile(path),contentType:MIME[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  return {ctx,page:await ctx.newPage(),calls};
}
try{
  for(const width of [390,1280]){
    const {ctx,page,calls}=await setup(width);
    await page.goto(app+'/member-front.html?handle=fixture.member');
    await page.locator('#mfMusic a').first().waitFor();
    check(width+' username: custom profile and published music appear together',await page.locator('#mfHeadline').textContent()==='Custom profile headline'&&await page.locator('#mfMusic').getByText('Published fixture track').count()===1);
    check(width+' username: drafts omitted',await page.locator('#mfMusic').getByText('Never expose draft').count()===0);
    await Promise.all([page.waitForURL('**/music-creator.html?handle=studio-alias#release-'+ownTrack),page.getByRole('link',{name:'Published fixture track',exact:true}).click()]);
    await page.locator('#creatorAccountProfile').waitFor();
    const player=page.locator('#creatorPublicTracks [data-creator-track="'+ownTrack+'"]');
    await player.waitFor();
    check(width+' artist: shared account UUID resolves the profile despite the artist alias',calls.includes('/v1/mnet/people/'+uid)&&await page.locator('#creatorAccountProfile').getByText('Their own words.').count()===1);
    await player.click();
    await page.waitForFunction(()=>window.MCC_MUSIC?.audio.currentTime>.1&&!window.MCC_MUSIC.audio.paused);
    check(width+' artist: the existing player actually starts the release',true);
    check(width+' artist: no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    await page.goto(app+'/listen.html');
    const artistCard=page.locator('#artistsRow a[href="music-creator.html?handle=studio-alias"]');
    await Promise.all([page.waitForURL('**/music-creator.html?handle=studio-alias'),artistCard.click()]);
    await page.waitForFunction(() => document.getElementById('creatorAccountProfile') || document.getElementById('mccMusicViewFrame')?.contentDocument?.getElementById('creatorAccountProfile'));
    const artistView = await page.locator('#mccMusicViewFrame').count() ? page.frameLocator('#mccMusicViewFrame') : page;
    await artistView.locator('#creatorAccountProfile').waitFor();
    check(width+' artist card: opens the configured account profile and released music together',await artistView.locator('#creatorPublicTracks [data-creator-track="'+ownTrack+'"]').count()===1);
    await page.goto(app+'/listen.html');
    await Promise.all([page.waitForURL('**/artist.html?artist=zakir-elhajoui#produced'),page.locator('#producersRow a[href="artist.html?artist=zakir-elhajoui#produced"]').click()]);
    await page.waitForFunction(() => document.getElementById('artistProfile') || document.getElementById('mccMusicViewFrame')?.contentDocument?.getElementById('artistProfile'));
    const producerView = await page.locator('#mccMusicViewFrame').count() ? page.frameLocator('#mccMusicViewFrame') : page;
    await producerView.locator('#produced [data-music-play]').first().waitFor();
    check(width+' producer: real credited tracks, no inferred account profile',await producerView.locator('#artistProfile').isHidden()&&await producerView.locator('#produced [data-music-play]').count()>0);
    check(width+' producer: no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    if(width===390){
      await page.goto(app+'/mnet.html?profile=fixture.member');
      await page.locator('#mnPersonMusic a').first().waitFor({timeout:12000});
      check('390 World username: the existing social profile includes the matching music',await page.locator('#mnPersonBody').getByText('Their own words.').count()===1 && await page.locator('#mnPersonMusic').getByText('Published fixture track').count()===1);
    }
    await ctx.close();
  }
  for(const opts of [{signed:false},{denied:true}]){
    const {ctx,page}=await setup(390,opts);
    await page.goto(app+'/music-creator.html?handle=studio-alias');
    await page.locator('#creatorPublicTracks [data-creator-track]').first().waitFor();
    check((opts.denied?'Denied viewer':'Guest')+': the public release stays available without revealing the social profile',await page.locator('#creatorAccountProfile').isHidden());
    await ctx.close();
  }
  console.log(total+' checks passed');
}finally{await browser.close();}
