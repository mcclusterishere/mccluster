import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../js/control-room/analytics-unified.js',import.meta.url),'utf8');
test('late country responses cannot overwrite new selection; missing values stay unknown',async()=>{
 const c={window:{},Intl,Date,Number};vm.runInNewContext(source,c);const ui=c.window.CR.analyticsUnified;
 let finish;const old=ui.loadWorld(()=>new Promise(r=>finish=r),()=>{},'US');
 const data={schema:'world-indicators/v1',observations:[{label:'Population',value:null,unit:'people',period:null,geography:{name:'United Kingdom'}}]};
 await ui.loadWorld(async()=>data,()=>{},'GB');finish({schema:'world-indicators/v1',observations:[]});await old;
 assert.equal(ui.worldState.economy,'GB');assert.equal(ui.worldState.data,data);assert.match(ui.worldContext(),/—/);assert.match(ui.worldContext(),/No observation/);assert.match(ui.worldContext(),/not live/);
});
