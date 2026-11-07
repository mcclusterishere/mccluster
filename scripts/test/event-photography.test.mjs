import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { buildGraph, renderBlock } from '../../tools/build-hire-schema.mjs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const ledger = () => JSON.parse(read('data/offers.json'));
function element() {
  return { innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {},
    setAttribute() {}, focus() {}, addEventListener() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, appendChild() {}, remove() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
}
function sandbox() {
  const nodes = {};
  const context = vm.createContext({ window: {}, console, setTimeout, clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {} },
    document: { currentScript: null, readyState: 'loading',
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      createElement() { const el = element(); Object.defineProperty(el, 'textContent', { set(v) { el.innerHTML = String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;'); } }); return el; },
      addEventListener() {}, body: element(), documentElement: element() } });
  vm.runInContext(read('js/offers.js'), context);
  context.document.getElementById = id => nodes[id] ||= element();
  return { context, nodes, api: context.window.MCC_OFFERS };
}
function onboarding(state) {
  const {context, nodes, api} = sandbox();
  // Exercise the real functions with network/account boot omitted. No production exports needed.
  const source = read('js/onboard.js').split('  Promise.all([window.MCC_OFFERS.load()')[0];
  vm.runInContext(source + `
    window.testOnboard = { configure: function(state, ledger) { S = state; L = ledger; },
      brief, walk, validate, renderReview, answerLines, send, wireStage,
      current: function() { return walk()[at]; },
      setStep: function(id) { at = walk().findIndex(function(s) { return s.id === id; }); },
      stubRender: function() { render = function() {}; } };
  })();`, context);
  const form = context.window.testOnboard;
  form.configure(state, api.derive(ledger()));
  return {form, context, nodes, api};
}
const eventState = {offer:'who-did-the-shoot', mode:'m', projectType:'event', photoNeeds:['event'], eventHours:'3'};

test('ledger retains $201/hour and derives $603 minimum without inventing travel', () => {
  const {api} = sandbox(), L = ledger(), r = api.eventPhotographyLine(L);
  assert.equal(r.amount, 201); assert.equal(r.minimum_hours, 3); assert.equal(api.minimumFor(r), 603);
  assert.match(r.unit, /3-hour minimum/);
  assert.match(api.eventPhotographyIntro(L), /Connecticut, within approximately 75 minutes of New Haven/);
  assert.match(api.eventPhotographyIntro(L), /\$603 for 3 hours/);
  assert.match(api.eventPhotographyTerms(L), /Travel.*separate line item.*agreed before booking/);
  assert.equal(Object.hasOwn(r, 'travel_amount'), false);
  const o = api.offerOf(L,'who-did-the-shoot');
  assert.equal(o.pricing.m.from, Math.min(...o.pricing.m.rate_lines.map(api.minimumFor)));
});

test('quotes enforce three hours and reject missing, malformed, negative and non-finite duration', () => {
  const {api} = sandbox(), L = ledger();
  for (const value of [undefined, null, '', '  ', false, [], {}, 'no', NaN, Infinity, 'Infinity', -3, 0, 1, 2, 2.99, 1e100]) {
    assert.equal(api.eventPhotographyQuote(L,value).valid,false,String(value));
  }
  for (const [hours,base] of [[3,603],['3',603],[3.5,703.5],[4,804]]) {
    const q=api.eventPhotographyQuote(L,hours);
    assert.equal(q.valid,true);assert.equal(q.base,base);assert.equal(Object.hasOwn(q,'total'),false);
  }
});

test('derived minimum and quote both follow changes to the one ledger', () => {
  const {api}=sandbox(), L=ledger(), r=api.eventPhotographyLine(L);
  r.amount=250;r.minimum_hours=4;
  assert.equal(api.minimumFor(r),1000);
  assert.equal(api.eventPhotographyQuote(L,3).valid,false);
  assert.equal(api.eventPhotographyQuote(L,4).base,1000);
  assert.match(api.eventPhotographyIntro(L),/\$1,000 for 4 hours/);
});

test('video-only events, raw footage, portraits and unrelated services do not become photo bookings', () => {
  const {api}=sandbox();
  assert.equal(api.eventPhotographySelected(eventState),true);
  assert.equal(api.eventPhotographySelected({...eventState,photoNeeds:['candid']}),true);
  assert.equal(api.eventPhotographySelected({...eventState,photoNeeds:[],deliverables:['edited-photos']}),true);
  for(const state of [
    {...eventState,photoNeeds:[],videoNeeds:['highlight'],deliverables:['raw','video-final']},
    {...eventState,projectType:'portrait',photoNeeds:['portraits']},
    {...eventState,offer:'write-a-song'},
  ]) assert.equal(api.eventPhotographySelected(state),false);
});

test('shoot sales CTA requests a quote and leaves the shared booking deposit untouched', () => {
  const {api}=sandbox(), L=ledger(), o=api.offerOf(L,'who-did-the-shoot');
  assert.equal(o.checkout.m.onboard,true);assert.equal(o.checkout.m.offering,undefined);
  assert.match(o.checkout.m.after,/travel.*agreed before booking/);
  const offerings=JSON.parse(read('data/offerings.json')).offerings;
  const deposit=offerings.find(o=>o.slug==='booking-deposit');
  assert.ok(deposit);assert.equal(deposit.min,100);assert.equal(deposit.max,10000);
});

test('hire renderer passes the derived minimum into the actual package cards', () => {
  const {context,api}=sandbox();
  let source=read('js/hire-offers.js');
  source=source.slice(0,source.indexOf('  O.load().then')) + 'window.testModePanel=modePanel;})();';
  vm.runInContext(source,context);
  const L=api.derive(ledger());
  const html=context.window.testModePanel(L,api.offerOf(L,'who-did-the-shoot'),'m');
  assert.match(html,/data-shop="photo-event"[^>]*data-shop-p="603"[^>]*data-shop-m="from"[^>]*data-shop-min="603"/);
  assert.match(html,/3-hour minimum · \$603 base/);
  assert.match(html,/Travel is quoted as a separate line item and agreed before booking/);
  assert.doesNotMatch(html,/two-hour minimum/);
});

test('package discounts cannot reduce event photography below its minimum', () => {
  const {context}=sandbox();
  let source=read('js/shop.js');
  source=source.replace('  window.MCC_SHOP = {','  window.testShop = { totals, summary, set: function(i,p) { items=i; picked=p; } };\n  window.MCC_SHOP = {');
  vm.runInContext(source,context);
  const shop=context.window.testShop;
  const items={event:{id:'photo-event',n:'Event photography · 3-hour base',p:603,m:'from',minimum:603,note:'Travel quoted separately and agreed before booking.'},portrait:{id:'portrait',n:'Portrait',p:285,m:'once'}};
  shop.set(items,['event']);assert.equal(shop.totals().onceOff,603);
  shop.set(items,['event','portrait']);assert.equal(shop.totals().onceOff,603+285*.95);
  assert.match(shop.summary(),/minimums apply/);assert.match(shop.summary(),/Travel quoted separately/);
});

test('onboarding adds duration only for event photography in standard mode', () => {
  const {form}=onboarding({...eventState});
  const step=form.brief().find(s=>s.id==='w_event_hours');
  assert.equal(step.kind,'number');assert.equal(form.validate(step),true);
  assert.match(form.renderReview(),/\$603 for 3 hours/);
  assert.match(form.renderReview(),/Quote pending; not included in the base/);
  assert.match(form.answerLines().join('\n'),/\$603 service base.*separate quote pending agreement/);
  assert.equal(onboarding({...eventState,mode:'equity'}).form.brief().some(s=>s.id==='w_event_hours'),false);
  assert.equal(onboarding({...eventState,photoNeeds:[],videoNeeds:['highlight'],deliverables:['raw']}).form.brief().some(s=>s.id==='w_event_hours'),false);
});

test('resumed review with old two-hour answer cannot submit and returns to duration', () => {
  const {form,context,nodes}=onboarding({...eventState,eventHours:'2'});
  context.window.MCC_OFFER_CRM={build(){throw new Error('should not build');},post(){throw new Error('should not post');}};
  form.stubRender();form.send();assert.equal(form.current().id,'w_event_hours');
  assert.match(nodes.obErr.textContent,/at least 3 hours/);assert.equal(nodes.obErr.hidden,false);
});

test('review Change links are handled before choice-button filtering', () => {
  const {form,nodes}=onboarding({...eventState});let click;
  nodes.obStage=element();nodes.obStage.addEventListener=(event,fn)=>{if(event==='click')click=fn;};
  form.setStep('review');form.stubRender();form.wireStage();
  click({target:{closest:s=>s==='[data-goto]'?{dataset:{goto:'w_event_hours'}}:null}});
  assert.equal(form.current().id,'w_event_hours');
});

test('structured offer keeps hourly price, minimum quantity, service area and separate travel', () => {
  const L=ledger(),graph=buildGraph(L),service=graph['@graph'].find(s=>s['@id'].endsWith('#who-did-the-shoot'));
  const offer=service.offers.find(o=>o.name==='Event photography');
  assert.equal(offer.priceSpecification.price,201);assert.equal(offer.priceSpecification.unitCode,'HUR');
  assert.equal(offer.eligibleQuantity.minValue,3);assert.match(offer.description,/\$603 base/);
  assert.match(offer.description,/approximately 75 minutes/);assert.match(offer.description,/Travel.*agreed before booking/);
  assert.ok(read('hire.html').includes(renderBlock(L)));
});

test('generated knowledge follows the same event minimum and quote-first sales path', () => {
  const sql=execFileSync(process.execPath,['scripts/kb-build.mjs'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
  assert.match(sql,/Event photography: \$201 — per hour · 3-hour minimum · \$603 base/);
  assert.match(sql,/Request a shoot quote: https:\/\/matthew.mccluster.org\/onboard.html\?offer=who-did-the-shoot/);
  assert.doesNotMatch(sql,/two-hour minimum/);
});
