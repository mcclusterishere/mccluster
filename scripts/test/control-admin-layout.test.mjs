import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const window={CR:{}};const ctx=vm.createContext({window});
for(const file of ['nav','section-groups','analytics-layout','analytics-deck'])vm.runInContext(await readFile('js/control-room/'+file+'.js','utf8'),ctx);
const {analyticsLayout:layout,analyticsDeck:deck,sectionGroups:groups,nav}=window.CR;
test('layout cannot drop, duplicate, hide or move Overview; denies extra policy fields',()=>{
 const v=layout.defaults();assert.equal(layout.validate(v).order.length,6);
 for(const bad of [{...v,order:v.order.slice(1)},{...v,order:[...v.order.slice(1),'overview']},{...v,grants:true},{...v,defaults:{...v.defaults,content:'forensics'}},{...v,version:2},{...v,order:['overview','audience','audience','action','intelligence','inventory']}])assert.throws(()=>layout.validate(bad));
});
test('configured deck preserves eleven details, labels, health actions and direct deep links',()=>{
 const v=layout.defaults();v.order=['overview','inventory','content','action','intelligence','audience'];v.defaults.inventory='forensics';deck.configure(v);
 assert.deepEqual(Array.from(deck.chapters,c=>c[0]),v.order);
 for(const [id] of deck.sections){const html=deck.render({section:id,errors:{}},'<p>Original content</p>');assert.equal((html.match(/role="tab"/g)||[]).length,6);assert.match(html,/Original content/);assert.match(html,/data-cad-health/);assert.ok(deck.chapter(id)[2].includes(id));}
 assert.match(deck.render({section:'overview',errors:{}},''),/data-cra-sec="forensics">Data &amp; setup|data-cra-sec="forensics">Data & setup/);
 deck.configure(null);assert.equal(deck.chapters[1][0],'audience');
});
test('all Sell/Create/System items and child operations remain reachable through local groups',()=>{
 for(const id of ['sell','create','system']){
  const section=nav.section(id),all=groups.groups(section);assert.deepEqual(Array.from(all).flatMap(g=>Array.from(g.items,x=>x.id)).sort(),Array.from(section.items,x=>x.id).sort());
  for(const item of section.items){const entry=nav.resolve(item.route).entry,html=groups.render(entry);assert.ok(html.includes(item.route));for(const child of item.views||[])assert.ok(nav.resolve(child.route).entry.leaf);}
  const extended={...section,items:[...section.items,{id:'future',route:'#'+id+':future',label:'Future'}]};assert.ok(groups.groups(extended).some(g=>g.items.some(i=>i.id==='future')));
 }
});
