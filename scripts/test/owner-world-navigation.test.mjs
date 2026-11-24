import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const source=read('js/tabbar.js');
const fn=source.slice(source.indexOf('function adminBar()'),source.indexOf('function markAdminHere()'));
for(const world of ['https://mccluster.org/?view=feed','https://humanuprise.com/?view=feed','https://matthew.mccluster.org/mnet.html?view=feed']){
  test('owner keeps seven destinations and the canonical World door: '+world,()=>{
    /* the owner's pages are linked where the table serves them (pageHref, js/tabbar.js; scripts/test/site-hosts-engine.test.mjs
       runs it with each table): here a stand-in that answers Matthew's host, as before P1 */
    const ctx={pageHref:p=>'https://matthew.mccluster.org/'+p,ROOT:'https://matthew.mccluster.org/',HOUSE_LABEL:'Matthew',textOf:x=>x,worldAt:q=>{assert.equal(q,'?view=feed');return world;},PLAY_SVG:'',HOME_SVG:'',CHART_SVG:'',WORLD_SVG:''};
    vm.runInNewContext(fn+'; result=adminBar();',ctx);
    const links=[...ctx.result.matchAll(/<a\b([^>]+)>/g)].map(m=>({key:/data-appnav="([^"]+)"/.exec(m[1])[1],href:/href="([^"]+)"/.exec(m[1])[1]}));
    assert.deepEqual(links.map(x=>x.key),['music','admin-inbox','admin-home','home','analytics','world','games']);
    assert.equal(links.find(x=>x.key==='world').href,world);
    assert.ok(links.every(x=>!x.href.includes('halo=')));
  });
}
test('Halo still uses its separate existing Products door and the owner gate remains',()=>{
  const nav=read('js/site-navigation.js');
  /* the doors ask the bar where the page is (page(): the table's serving host), never the dock's house, which keeps Matthew's host until P3 (review V2-1, 2026-11-24); the door's target is unchanged */
  assert.match(nav,/label:'Hitman’s Halo', group:'Products', href:page\('action-globe\.html\?explore=1&halo=1'\)/);
  assert.match(nav,/if \(!bar\.admin\(\)\)/);
});
