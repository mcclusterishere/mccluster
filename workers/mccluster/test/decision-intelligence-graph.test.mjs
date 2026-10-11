import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceGraph } from '../src/decision-intelligence/graph.js';
test('GEV projects only same-org evidence and real relationships', () => {
  const graph = buildEvidenceGraph({
    orgId: 'a',
    claims: [{ id:'c',org_id:'a',statement:'Claim' },{ id:'x',org_id:'b',statement:'Secret' }],
    sources: [{ id:'s',org_id:'a',title:'Document' },{ id:'z',org_id:'b',title:'Other' }],
    evidenceLinks: [{org_id:'a',source_id:'s',claim_id:'c',relationship:'supports'},
      {org_id:'b',source_id:'z',claim_id:'x',relationship:'supports'},
      {org_id:'a',source_id:'s',claim_id:'x',relationship:'supports'}]
  });
  assert.equal(graph.nodes.length,2);
  assert.deepEqual(graph.edges,[{from:'source:s',to:'claim:c',kind:'supports'}]);
});
test('GEV rejects unbounded graph requests', () => {
  assert.throws(()=>buildEvidenceGraph({orgId:'a',claims:Array.from({length:501},(_,i)=>({id:String(i),org_id:'a',statement:'C'}))}),/limit/);
});
test('GEV does not fabricate decisions', () => {
  const graph=buildEvidenceGraph({orgId:'a',decisionLinks:[{org_id:'a',decision_id:'d',claim_id:'c'}]});
  assert.equal(graph.nodes.length,0);
  assert.equal(graph.decisionLinksDeferred,true);
});
