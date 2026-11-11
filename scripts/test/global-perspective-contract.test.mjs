import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../js/tabbar.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('  function paintPerspective()'),source.indexOf('  function setPerspective(raw)'));
function paint(overrides={}) {
 const attrs={}, classes=new Set();
 const tab={href:'',innerHTML:'',setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k)}};
 const ctx={ADMIN_ON:false,PAGE_PROFILE:null,PERSPECTIVE:null,SELF_PROFILE:null,AUTH_STATE:{signed_in:true},HOUSE:'https://matthew.mccluster.org/',ROOT:'https://matthew.mccluster.org/',HOUSE_LABEL:'HERE',HOUSE_ROOM:['hire.html','case','Hire'],EVERYTHING_ROOM:['#everything','grid','Everything'],WINGS:{home:{slots:[]}},location:new URL('https://matthew.mccluster.org/listen.html'),PAGE_KEY:'listen.html',PAGE_WING:{'index.html':'home'},paintSitePolicy(){},platformMark:()=>'<img class="appbar__platform">',attrOf:x=>x,textOf:x=>x,initialOf:x=>x[0],shortName:x=>x.split(' ')[0],URL,URLSearchParams,dock:{style:{},querySelector:()=>tab},...overrides};
 vm.runInNewContext(fn+';paintPerspective();',ctx);
 return {ctx,tab,attrs,classes};
}
const artist={kind:'artist',handle:'fixture-ana',name:'Fixture Ana',avatar:'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-artwork/fixture/ana.jpg'};
test('stored artist remains the center on Music and ordinary personal browsing',()=>{
 for(const path of ['listen.html','index.html']) {
 const {tab,attrs,ctx}=paint({PERSPECTIVE:artist,location:new URL('https://matthew.mccluster.org/'+path)});
 assert.equal(tab.href,'https://matthew.mccluster.org/music-creator.html?handle=fixture-ana');
 assert.equal(attrs['data-perspective'],'fixture-ana');assert.ok(tab.innerHTML.includes(artist.avatar));
 assert.equal(ctx.WINGS.home.slots[0][0],'https://matthew.mccluster.org/index.html?front=house');
 assert.equal(ctx.WINGS.home.slots[1][2],'Everything');
 }
});
test('guest and explicit house perspective use the exact supplied M and personal home',()=>{
 for(const extra of [{AUTH_STATE:{signed_in:false}},{PERSPECTIVE:{kind:'house'},SELF_PROFILE:artist}]) {
 const {tab,attrs}=paint(extra);assert.equal(tab.href,'https://matthew.mccluster.org/index.html');
 assert.ok(tab.innerHTML.includes('https://matthew.mccluster.org/assets/img/m-mark.png'));assert.equal(attrs['data-perspective'],undefined);
 }
});
test('branded document wins locally, clearing it restores stored artist',()=>{
 const profile={kind:'page',handle:'page-profile',name:'Vaunt',home:'https://matthew.mccluster.org/front.html?project=vaunt',avatar:'https://matthew.mccluster.org/assets/img/vaunt-logo.webp'};
 const {tab,attrs}=paint({PERSPECTIVE:artist,PAGE_PROFILE:profile});
 assert.equal(tab.href,profile.home);assert.equal(attrs['data-perspective'],'page-profile');assert.ok(tab.innerHTML.includes(profile.avatar));
 assert.equal(paint({PERSPECTIVE:artist,PAGE_PROFILE:null}).tab.href,'https://matthew.mccluster.org/music-creator.html?handle=fixture-ana');
});
test('verified owner ignores customer branding and stored artist without painting customer controls',()=>{
 const {ctx,tab}=paint({ADMIN_ON:true,PERSPECTIVE:artist,PAGE_PROFILE:{home:'https://brand.fixture/front'}});
 assert.equal(ctx.WINGS.home.home,'https://matthew.mccluster.org/index.html');assert.equal(tab.innerHTML,'');
});
test('reload restores only the matching account perspective; sign-out and account switch reject it',()=>{
 const fn=source.slice(source.indexOf('  function readPerspective()'),source.indexOf('  function storePerspective(p)'));
 for(const [subject,storedSubject,expected] of [['account-a','account-a',artist],['account-b','account-a',null],['','account-a',null]]) {
  const ctx={currentSubject:()=>subject,PERSPECTIVE_SUB_KEY:'owner',PERSPECTIVE_KEY:'perspective',cleanPerspective:x=>x,sessionStorage:{getItem:k=>k==='owner'?storedSubject:JSON.stringify(artist)}};
  vm.runInNewContext(fn+';result=readPerspective();',ctx);
  assert.equal(JSON.stringify(ctx.result),JSON.stringify(expected));
 }
});
test('artist artwork does not widen customer page-logo permissions or cross-origin homes',()=>{
 const fn=source.slice(source.indexOf('  function cleanPageProfile(raw)'),source.indexOf('  var PAGE_PROFILE ='));
 const ctx={URL,ROOT:'https://matthew.mccluster.org/',location:new URL('https://brand.fixture.test/front.html'),document:{baseURI:'https://matthew.mccluster.org/'}};
 vm.runInNewContext(fn,ctx);
 const approved='https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/front-media/11111111-1111-4111-8111-111111111111/logo.png';
 for(const logo of ['https://matthew.mccluster.org/assets/img/vaunt-logo.webp',approved])assert.equal(ctx.cleanPageProfile({name:'Brand',home:'/front.html',logo}).avatar,logo);
 for(const logo of [artist.avatar,approved+'?token=secret',approved.replace('/public/','/authenticated/'),'https://other.invalid/logo.png'])assert.equal(ctx.cleanPageProfile({name:'Brand',home:'/front.html',logo}).avatar,'');
 assert.equal(ctx.cleanPageProfile({name:'Brand',home:'https://other.invalid/'}),null);
});
