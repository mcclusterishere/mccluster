import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const sections=['overview','audience','adaptive','content','identity','forensics','setup'];

async function analytics(){
  const source=await readFile('js/control-room/analytics.js','utf8');
  const context={window:{CR:{}},console};
  vm.createContext(context);
  vm.runInContext(source,context);
  const a=context.window.CR.analytics;
  a.init({request:()=>Promise.resolve({}),supa:()=>Promise.resolve([])});
  return a;
}

test('additive decision layer renders across all seven sections without replacing tabs',async()=>{
  const a=await analytics();
  for(const section of sections){
    a.state.section=section;
    const html=a.render();
    assert.match(html,/Decision support/);
    assert.match(html,/Existing dashboard modules remain below/);
    assert.match(html,/cra-tabs/);
    assert.match(html,/data-cra-sec="overview"/);
    assert.match(html,/data-cra-sec="setup"/);
    assert.match(html,/cra-insight/);
  }
});

test('additive cards do not remove existing section-specific functionality',async()=>{
  const a=await analytics();
  const expected={
    overview:/Traffic trend/,
    audience:/Audience trend/,
    adaptive:/Adaptive Experience|Experiment registry/,
    content:/Track detail/,
    identity:/How signups happened/,
    forensics:/Session forensics|data-crf-host/,
    setup:/Your websites/
  };
  for(const section of sections){
    a.state.section=section;
    assert.match(a.render(),expected[section],section);
  }
});

test('decision layer does not fabricate unavailable metrics',async()=>{
  const a=await analytics();
  a.state.section='audience';
  assert.match(a.render(),/once cross-visit identity is available/);
  a.state.section='setup';
  assert.match(a.render(),/No external analytics properties registered/);
});

test('responsive decision layer CSS is present',async()=>{
  const css=await readFile('css/control-analytics.css','utf8');
  assert.match(css,/\.cra-decision-layer/);
  assert.match(css,/\.cra-insights/);
  assert.doesNotMatch(css, /@media\s*\(max-width:/);
  assert.match(css, /@media\s*\(min-width:\s*601px\)/);
});
