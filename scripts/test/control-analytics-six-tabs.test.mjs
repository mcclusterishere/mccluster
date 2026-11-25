import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context={window:{CR:{}}};vm.createContext(context);
vm.runInContext(await readFile('js/control-room/analytics-deck.js','utf8'),context);
const deck=context.window.CR.analyticsDeck;
test('six primary chapters cover every existing detail route exactly once',()=>{
 assert.equal(deck.chapters.length,6);assert.equal(deck.chapters[0][0],'overview');
 const leaves=deck.chapters.flatMap(c=>c[2]);
 assert.equal(new Set(leaves).size,11);
 assert.deepEqual([...leaves].sort(),[...deck.sections].map(s=>s[0]).sort());
 for(const read of deck.reads)assert.ok(leaves.includes(read[2]),read[0]+' keeps a destination');
});
test('every legacy leaf selects its parent tab while retaining its detail and controls',()=>{
 for(const [id,label] of deck.sections){
  const html=deck.render({section:id,errors:{}},'<p>Retained evidence</p>');
  assert.equal((html.match(/role="tab"/g)||[]).length,6);
  assert.equal((html.match(/aria-selected="true"/g)||[]).length,1);
  const parent=deck.chapter(id);
  assert.ok(html.includes('aria-labelledby="cad-tab-'+parent[0]+'"'));
  assert.ok(html.includes('<h2>'+label+'</h2>'));
  assert.ok(html.includes('Retained evidence'));
  for(const child of parent[2])assert.ok(html.includes('data-cra-sec="'+child+'"'));
 }
});
