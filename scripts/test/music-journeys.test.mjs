import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyURL} from '../../js/music-journeys.mjs';
const base='https://matthew.mccluster.org/listen.html';
test('retained rooms preserve canonical query and fragment without broadening origins',()=>{
 for(const path of ['/game-hub.html#m=chem108&play=molecule-rush','/control.html?org=o1#home:today','/prim3-transit.html?level=equity-uprise-hq','/screens/terminal.html?mode=TRAINING']) {
  assert.equal(journeyURL(path,base)?.href,new URL(path,base).href);
 }
});
test('unrelated, credential-bearing and executable destinations never enter the retained shell',()=>{
 for(const path of ['https://mccluster.org/control.html','//example.org/game-hub.html','javascript:alert(1)','data:text/html,test','https://user:password@matthew.mccluster.org/control.html','/account.html','/preview/control.html','/control.html#mcc_handoff=secret','/control.html/child']) assert.equal(journeyURL(path,base),null,path);
});
