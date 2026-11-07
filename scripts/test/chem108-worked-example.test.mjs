import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { EXAMPLE, LESSONS, matchesExample, renderExample, contrast } from '../../js/game-hub/chem108/worked-example.mjs';
import { AUTHOR_SPECS, compileLesson, validateSpec } from '../../js/game-hub/chem108/lesson-authoring.mjs';
import { draftVersion, requestReview } from '../../js/game-hub/chem108/worked-example-author.mjs';
import { structureAnswer } from '../../js/game-hub/chem108/structure-answer.mjs';
import * as E from '../../js/game-hub/chem108/engine.mjs';
const require=createRequire(import.meta.url),data=require('../../js/game-hub/chem108/data/data.js'),extra=require('../../js/game-hub/chem108/data/extra-data.js');
const catalog=E.buildCatalog(data,extra);
const inventory=require('../../data/game-hub/chem108-explanation-coverage.json');
for(const actual of data.molecules) test(`${actual.id} ${actual.name}: source identity, formula/valence, original anchors, parent and both answer paths`,()=>{
  const lesson=LESSONS[actual.id],g=lesson.graph,spec=AUTHOR_SPECS[actual.id];
  assert.equal(g.smiles,actual.smiles);assert.equal(g.formula,actual.formula);assert.equal(g.name,actual.name);
  assert.equal(g.svgSha256,createHash('sha256').update(actual.svg).digest('hex'));
  assert.equal(lesson.formalCharge,null);assert.equal(g.formalCharge,null);assert.equal(g.smilesModelCharge,0);
  const counts={};
  for(const a of g.atoms) {
    counts[a.element]=(counts[a.element]||0)+1;counts.H=(counts.H||0)+a.hydrogens;
    assert.equal(a.hydrogens+a.lewisBondOrderSum,{C:4,O:2,N:3,Cl:1,Br:1}[a.element]);
    assert.match(actual.svg,new RegExp('atom-'+a.id+'(?:[\\s\'\"])'));
  }
  const expected=Object.fromEntries([...actual.formula.matchAll(/([A-Z][a-z]?)(\d*)/g)].map(m=>[m[1],Number(m[2]||1)]));
  assert.deepEqual(counts,expected);
  for(const b of g.bonds) {
    assert.match(actual.svg,new RegExp(`bond-${b.id} atom-${b.a} atom-${b.b}`));
  }
  assert.ok(validateSpec(spec,g));
  const ring=spec.family.includes('aromatic')||['phenol','arylamine','cycloalkane'].includes(spec.family);
  if(ring) assert.ok(g.bonds.some(b=>(b.a===spec.parent.at(0)&&b.b===spec.parent.at(-1))||(b.b===spec.parent.at(0)&&b.a===spec.parent.at(-1))));
  else {
    let max=0;
    const walk=path=>{max=Math.max(max,path.length);for(const b of g.bonds){const end=path.at(-1),next=b.a===end?b.b:b.b===end?b.a:null;if(next!==null&&g.atoms[next].element==='C'&&!path.includes(next))walk([...path,next]);}};
    g.atoms.filter(a=>a.element==='C').forEach(a=>walk([a.id]));
    assert.equal(spec.parent.length,max,'chosen parent has maximum carbon-path length');
  }
  for(const feature of lesson.features) for(const id of feature.bonds) assert.ok(g.bonds[id]);
  assert.equal(lesson.check.options.filter(o=>o.correct).length,1);
  const q=E.makeQuestion(catalog,'name-it',E.modeItems(catalog,'name-it').find(m=>m.id===actual.id));
  for(const name of [actual.name,...actual.aliases]) assert.ok(E.check(q,name));
  for(const ok of [true,false]) {
    const picked=ok?actual.name:q.options.find(o=>!o.correct).label;
    const result=E.answer(E.newRound({mode:'name-it'}),q,picked);
    assert.equal(result.state.answered,1);assert.equal(result.state.correct,ok?1:0);
    if(!ok) assert.ok(matchesExample(result.state.missed[0]));
    const html=structureAnswer(q,picked,ok,catalog);
    assert.ok(html.includes(actual.svg));assert.match(html,/data-atom=/);assert.match(html,/data-depth="3"/);
    assert.ok(!html.includes('Deeper annotations have not been reviewed'));
  }
  const record=inventory.structures.find(m=>m.id===actual.id);
  assert.equal(record.annotationStatus,'validated-local');assert.equal(record.atomicValidation,'validated-local');
  assert.equal(record.historyStatus,'molecule-specific-history-not-reviewed');
});
test('every structure uses the owner authoring compiler; edited drafts stay isolated and escaped',()=>{
  for(const [id,base] of Object.entries(LESSONS)) {
    assert.deepEqual(compileLesson(AUTHOR_SPECS[id]),base);
    const draft=draftVersion(base,'<img src=x onerror=alert(1)>',base.layers.map(l=>l.text),'Check naming');
    assert.equal(draft.questionId,id);assert.equal(draft.version,2);assert.equal(base.version,1);
    assert.deepEqual(draft.anchors,base.anchors);assert.deepEqual(draft.graph,base.graph);
    const html=renderExample({id,answer:base.name},catalog,draft);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img'));
    assert.equal(requestReview(draft).status,'needs-review');assert.equal(draft.status,'draft');
  }
  assert.throws(()=>draftVersion(EXAMPLE,'',[],''));assert.throws(()=>requestReview({...EXAMPLE,status:'draft',reviewNote:''}));
  assert.throws(()=>validateSpec({...AUTHOR_SPECS.m27,parent:[0,2]},EXAMPLE.graph));
  assert.throws(()=>validateSpec({...AUTHOR_SPECS.m27,focus:[999]},EXAMPLE.graph));
});
test('specific error contrasts aliases against the actual question, without cross-card feedback',()=>{
  assert.match(contrast('propan-1-ol',catalog,LESSONS.m27),/propan-2-ol/);
  assert.match(contrast('acetone',catalog,LESSONS.m27),/ketone/);
  assert.match(contrast('cyclohexane',catalog,LESSONS.m41),/benzene/);
  assert.equal(contrast('unrecognized',catalog),'');
  assert.equal(renderExample({id:'family:m27',answer:'Alcohol'},catalog),'');
});
test('branch and positional-isomer locants follow the authored original atom paths',()=>{
  const at=(id,atom)=>LESSONS[id].labels[atom];
  assert.equal(at('m18',1),'C2');assert.equal(at('m20',1),'C2');assert.equal(at('m20',3),'C3');
  assert.equal(at('m47',6),'C2');assert.equal(at('m48',5),'C3');assert.equal(at('m49',4),'C4');
  assert.equal(at('m26',2),'C1');assert.equal(at('m27',1),'C2');
  assert.equal(at('m34',1),'C1');assert.equal(LESSONS.m34.parent.length,2);
  assert.equal(LESSONS.m45.parent.length,6);assert.ok(!LESSONS.m45.parent.includes(1));
});
