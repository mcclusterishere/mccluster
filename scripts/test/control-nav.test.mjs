/* The one Control Room navigation definition (js/control-room/nav.js).
   NAV must cover every view the old seven-surface Control had (no orphaned
   route), every renderer it names must exist, and the sidebar, phone bar,
   palette, registry and owner bar must all read it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../../js/control-room/nav.js';
const N=globalThis.CR.nav;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');

/* The old IA, frozen here as history: 7 surfaces / 33 views. */
const OLD={
  work:['inbox','desk-bot','pipeline','people','companies','relationships','clients','tasks','bookings','orders','projects','deliverables','payments','renewals','outreach','operations'],
  create:['projects','front-page','library','schedule','channels','instagram','music','clipping','action-network','funding','song-test','build'],
  system:['command','overview','workload','observability','resources']
};
const OLD_BARE=['home','ai','analytics','apps'];
const COMPAT={'inbox.html':'#work:inbox','crm.html':'#work:pipeline','desk.html':'#work:outreach','admin.html':'#work:operations','management.html':'#create:channels','music-admin.html':'#create:music','vault.html':'#create:music','lanes.html':'#create:music','studio.html':'#create:projects','insights.html':'#analytics'};

test('six sections; four on the phone bar, the rest behind More',()=>{
  assert.deepEqual(N.NAV.map(s=>s.id),['home','people','sell','create','insights','system']);
  assert.deepEqual(N.phoneSections().map(s=>s.id),['home','people','sell','create']);
  for(const s of N.NAV){assert.ok(s.label&&s.icon&&N.ICONS[s.icon],s.id+' needs a label and a drawn icon');assert.ok(s.items.length,s.id+' has no items');}
});

test('every route is unique, canonical, and resolves to itself',()=>{
  const routes=N.leaves().map(l=>l.leaf.route);
  assert.equal(new Set(routes).size,routes.length);
  for(const l of N.leaves()){
    assert.match(l.leaf.route,/^#[a-z]+:[a-z-]+(:[a-z-]+)?$/);
    const r=N.resolve(l.leaf.route);assert.equal(r.entry.leaf.route,l.leaf.route);assert.equal(r.legacy,false);
  }
});

test('no orphaned route: every old view id and bare surface is claimed by exactly one leaf',()=>{
  const claims={};
  for(const l of N.leaves())for(const w of l.leaf.was.filter(x=>x.startsWith('#'))){assert.ok(!claims[w],w+' is claimed twice');claims[w]=l.leaf.route;}
  for(const [surface,views] of Object.entries(OLD))for(const v of views){
    const old='#'+surface+':'+v;
    assert.ok(claims[old],old+' has no new home in NAV');
    const r=N.resolve(old);assert.equal(r.entry.leaf.route,claims[old],old);
  }
  for(const b of OLD_BARE){assert.ok(claims['#'+b],'#'+b+' has no new home');assert.equal(N.resolve('#'+b).entry.leaf.route,claims['#'+b]);}
  assert.equal(Object.values(OLD).flat().length+OLD_BARE.length,37,'the frozen old IA is complete');
});

test('the old routers\' aliases and the compat pages\' old targets still land',()=>{
  for(const [surface,map] of Object.entries(N.legacyAliases))for(const [alias,view] of Object.entries(map)){
    assert.equal(N.resolve('#'+surface+':'+alias).entry.leaf.route,N.resolve('#'+surface+':'+view).entry.leaf.route,'#'+surface+':'+alias);
  }
  for(const [page,old] of Object.entries(COMPAT)){const r=N.resolve(old).entry;assert.ok(r.leaf.was.includes(old),page+' target '+old+' lost its home');}
  assert.equal(N.resolve('#work').entry.leaf.route,'#people:inbox:conversations');
  assert.equal(N.resolve('#work:nonsense').entry.leaf.route,'#people:inbox:conversations');
  assert.equal(N.resolve('#create:nonsense').entry.leaf.route,'#create:projects:projects');
  assert.equal(N.resolve('#system').entry.leaf.route,'#system:overview');
  assert.equal(N.resolve('#nowhere').entry.leaf.route,'#home:today');
  assert.equal(N.resolve('').entry.leaf.route,'#home:today');
});

test('every renderer a leaf names exists in the Control shell',async()=>{
  const js=await read('js/control-room-v2.js');
  const deckSrc=await read('js/control-room/analytics-deck.js');
  const deck=[...deckSrc.match(/var sections=\[(.*?)\];/)[1].matchAll(/\['([a-z]+)','/g)].map(m=>m[1]);
  const work=js.slice(js.indexOf('function renderWorkView(view)'),js.indexOf('var POST_SALE_NOTES'));
  const postSale=js.slice(js.indexOf('var POST_SALE_NOTES'),js.indexOf('function projectById'));
  const create=js.slice(js.indexOf('function renderCreate()'),js.indexOf('function renderChannels()'));
  const system=js.slice(js.indexOf('function renderSystem()'),js.indexOf('function appCard('));
  const leafBody=js.slice(js.indexOf('function leafBody(entry)'),js.indexOf('function renderLeaf()'));
  for(const l of N.leaves()){
    const r=l.leaf.renderer;assert.ok(r,l.leaf.route+' names no renderer');
    const [kind,view]=r.split('.');
    if(kind==='work')assert.ok(work.includes('"'+view+'"')||postSale.includes('    '+view+': "')||['orders','bookings'].includes(view),r);
    else if(kind==='create')assert.ok(create.includes('state.createView === "'+view+'"')||view==='schedule',r);
    else if(kind==='system')assert.ok(system.includes('state.systemView === "'+view+'"')||view==='resources',r);
    else if(kind==='analytics')assert.ok(deck.includes(view),r+' is not an analytics deck chapter');
    else if(r==='home.today')assert.match(js,/function renderToday\(\)/);
    else if(r==='slot')assert.ok(l.leaf.module,l.leaf.route+' is a mount point without a module name');
    else assert.ok(leafBody.includes('r === "'+r+'"'),r+' is not dispatched by leafBody');
  }
});

test('the in-flight PRs only have to register a renderer',()=>{
  const slots=Object.fromEntries(N.leaves().filter(l=>l.leaf.module).map(l=>[l.leaf.route,l.leaf.module]));
  assert.deepEqual(slots,{'#sell:store:marketplace':'marketplace','#sell:store:direct':'musicDirect','#sell:music:lyrics':'lyrics'});
});

test('the palette finds a view by its old name',()=>{
  for(const [q,route] of [['desk bot','#people:inbox:ai-reply'],['pipeline','#people:deals:pipeline'],['crm','#people:deals:pipeline'],['vault','#sell:music:catalog'],['funding','#system:uprise:funding'],['build code','#system:build'],['halo','#insights:halo'],['front page','#create:front-page'],['renewals','#sell:payments:renewals'],['observability','#system:observability']])
    assert.equal(N.search(q)[0].route,route,q);
  assert.equal(N.entries().length,N.leaves().length);
});

test('every navigation surface reads NAV; none keeps its own list',async()=>{
  const [html,v2,reg,core,site,polish]=await Promise.all(['control.html','js/control-room-v2.js','js/control-registry.js','js/control-room/workspace-core.js','js/site-navigation.js','js/control-room-polish.js'].map(read));
  assert.match(v2,/function renderNav\(\)[\s\S]*NAV\.map\(function \(s\)/,'sidebar and phone bar');
  assert.match(v2,/NAVI\.moreSections\(\)/,'More sheet');
  assert.match(v2,/function paletteCommands\(q\)[\s\S]*NAVI\.search\(q\)/,'⌘K palette');
  assert.match(reg,/var SURFACES = N\.entries\(\)/,'registry');
  assert.match(core,/NAVI\.leaves\(\)\.map/,'owner workspace + shared bar routes');
  assert.match(site,/js\/control-room\/nav\.js/,'the shared bar loads NAV before the routes');
  assert.doesNotMatch(html,/data-surface=/);
  assert.doesNotMatch(v2,/\["Work · Inbox"|var SURFACES = \[/);
  assert.ok(N.resolve('#system:overview').entry.leaf.route==='#system:overview'&&polish.includes('#system:overview'),'polish hops to a live NAV route');
});
