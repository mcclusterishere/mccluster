import assert from 'node:assert/strict';
import {evidence,actionChoices,selectEvidence,focusPayload} from '../../js/trace-your-tech.mjs';
assert.equal(new Set(evidence.map(x=>x.id)).size,evidence.length);
assert.deepEqual(new Set(evidence.map(x=>x.impact)),new Set(['Power & trade','People','Environment']));
for(const x of evidence) {
  assert.equal(new URL(x.source).protocol,'https:');
  assert.match(x.date,/^\d{4}(?:-\d{2})?$/);
  assert.ok(x.dateLabel && x.certainty);
  if(x.place) {assert.ok(Math.abs(x.lat)<=90&&Math.abs(x.lon)<=180);assert.equal(focusPayload(x).type,'hu:focus-place');}
  else assert.equal(focusPayload(x),null);
}
assert.equal(selectEvidence('Lithium','People','Stories').length,0);
assert.equal(selectEvidence('Cobalt','People','Stories')[0].id,'cobalt-workers');
assert.deepEqual(selectEvidence('Cobalt','All','Timeline').slice(0,2).map(x=>x.id),['cobalt-policy','cobalt-product']);
assert.deepEqual(actionChoices.map(x=>x.id),['repair','reuse','recycle']);
console.log('Trace Your Tech evidence, timeline, filters and globe payload passed.');
