// Controller-only DOM double. This does NOT replace real browser/layout QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('UI controller plans, cancels, simulates, invalidates and blocks H3 without a provider', async () => {
  const elements = new Map();
  class Element {
    constructor() { this.value = ''; this.checked = false; this.hidden = false; this.textContent = ''; this.disabled = false; this.files = []; this.events = {}; this.classList = { toggle() {} }; }
    addEventListener(name, fn) { this.events[name] = fn; }
    replaceChildren(...options) { this.value = options[0]?.value || ''; }
    removeAttribute(name) { delete this[name]; }
    click() { return this.events.click?.(); }
    pause() {} load() {}
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const original = { document:globalThis.document, window:globalThis.window, Option:globalThis.Option };
  globalThis.document = { getElementById:get, createElement:() => new Element() };
  globalThis.window = { addEventListener() {} };
  globalThis.Option = class { constructor(label,value) { this.label = label; this.value = value; } };
  const set = (id,value) => { get(id).value = value; };
  const input = id => get(id).events.input?.();
  try {
    for (const [id,value] of Object.entries({renderer:'fal-h3-max-recast',resolution:'768P',duration:'10',start:'0',fps:'24',budget:'5','character-label':'Character A'})) set(id,value);
    let code = await readFile(new URL('../public/app.mjs',import.meta.url),'utf8');
    code = code.replace("'/lib/recast-contract.mjs'",JSON.stringify(new URL('../lib/recast-contract.mjs',import.meta.url).href));
    await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
    await get('plan-button').click(); assert.match(get('form-status').textContent,/Choose both/);
    get('source-input').files = [new File(['synthetic fixture'],'clip.mp4',{type:'video/mp4'})];
    get('source-input').events.change(); get('source-preview').duration = 60; get('source-preview').onloadedmetadata();
    get('character-input').files = [new File(['synthetic fixture'],'character.png',{type:'image/png'})];
    get('character-input').events.change(); get('character-preview').onload();
    for (const id of ['rights-footage','rights-likeness','rights-sharing','shot-check']) get(id).checked = true;
    set('start','40'); set('duration','10'); set('budget','2'); await get('plan-button').click(); assert.match(get('form-status').textContent,/exceeds/);
    set('budget','5'); await get('plan-button').click();
    const plan = JSON.parse(get('provenance').textContent);
    assert.equal(plan.editorial.startSeconds,40); assert.equal(plan.editorial.durationSeconds,10); assert.equal(plan.cost.estimatedUsd,3);
    assert.equal(plan.readyForLive,false); assert.equal(plan.output,null);
    get('simulate-button').click(); assert.equal(get('job-state').textContent,'Queued');
    get('cancel-button').click(); assert.equal(get('job-state').textContent,'Canceled');
    await new Promise(resolve => setTimeout(resolve,1000)); assert.equal(get('job-state').textContent,'Canceled');
    await get('plan-button').click(); get('simulate-button').click();
    await new Promise(resolve => setTimeout(resolve,2400));
    assert.equal(get('job-state').textContent,'Simulation complete'); assert.match(get('job-description').textContent,/No generated output/);
    set('direction','New direction'); input('direction'); assert.equal(get('take-card').hidden,true);
    set('renderer','openjutsu-h3-selfhost'); get('renderer').events.change(); assert.equal(get('rights-sharing').checked,false);
    get('rights-sharing').checked = true; await get('plan-button').click(); assert.match(get('form-status').textContent,/licensing/);
    assert.equal(get('take-card').hidden,true);
    get('reset-button').click(); assert.equal(get('source-preview').hidden,true); assert.equal(get('rights-footage').checked,false);
  } finally {Object.assign(globalThis,original);}
});
