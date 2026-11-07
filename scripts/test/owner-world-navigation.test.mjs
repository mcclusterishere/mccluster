import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const source=read('js/tabbar.js');
const fn=source.slice(source.indexOf('function adminBar()'),source.indexOf('function markAdminHere()'));
for(const world of ['https://mccluster.org/?view=feed','https://humanuprise.com/?view=feed','https://matthew.mccluster.org/mnet.html?view=feed']){
  test('owner keeps seven destinations and the canonical World door: '+world,()=>{
    const ctx={HOUSE:'https://matthew.mccluster.org/',ROOT:'https://matthew.mccluster.org/',HOUSE_LABEL:'Matthew',textOf:x=>x,worldAt:q=>{assert.equal(q,'?view=feed');return world;},PLAY_SVG:'',HOME_SVG:'',CHART_SVG:'',WORLD_SVG:''};
    vm.runInNewContext(fn+'; result=adminBar();',ctx);
    const links=[...ctx.result.matchAll(/<a\b([^>]+)>/g)].map(m=>({key:/data-appnav="([^"]+)"/.exec(m[1])[1],href:/href="([^"]+)"/.exec(m[1])[1]}));
    assert.deepEqual(links.map(x=>x.key),['music','admin-inbox','admin-home','home','analytics','world','games']);
    assert.equal(links.find(x=>x.key==='world').href,world);
    assert.ok(links.every(x=>!x.href.includes('halo=')));
  });
}
test('Halo still uses its separate existing Products door and the owner gate remains',()=>{
  const nav=read('js/site-navigation.js');
  assert.match(nav,/label:'Hitman’s Halo', group:'Products', href:new URL\('action-globe\.html\?explore=1&halo=1', house\)\.href/);
  assert.match(nav,/if \(!bar\.admin\(\)\)/);
});
