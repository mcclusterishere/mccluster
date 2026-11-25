import test from 'node:test';
import assert from 'node:assert/strict';
import { MissionLab, DAY } from '../../PRIM3/game/halo/adaptive/engine.mjs';
const owner = { tenant: 't1', user: 'owner', role: 'owner' };
const learner = { tenant: 't1', user: 'learner', role: 'learner' };
function fixture() {
  let now = Date.parse('2026-11-04T12:00:00Z');
  const lab = new MissionLab({ clock: () => now });
  const input = { country: 'US', region: 'Connecticut' };
  const draft = lab.draft(owner, input);
  const review = () => lab.review(owner, draft.id, { fictionChecked: true, geographyChecked: true });
  const release = () => { review(); return lab.release(owner, draft.id); };
  return { lab, input, draft, review, release, advance: ms => { now += ms; }, now: () => now };
}
function play(f) {
  f.release(); let s = f.lab.start(learner, f.draft.id);
  const send = (type, fields = {}) => {
    s = f.lab.view(learner, s.id);
    const e = { id: `event-${s.nextSeq}`, seq: s.nextSeq, type, questionId: s.question?.id, ...fields };
    const result = f.lab.submit(learner, s.id, e); s = f.lab.view(learner, s.id); return { result, e };
  };
  send('begin'); return { send, view: () => s };
}
function solution(s) { const nums = s.question.prompt.match(/-?\d+/g).map(Number); return Math.abs(nums[2] - nums[0]); }
test('owner-only draft/review/release, tenant and learner isolation', () => {
  const f = fixture();
  assert.throws(() => f.lab.draft(learner, f.input), /Owner/);
  assert.throws(() => f.lab.release(owner, f.draft.id), /Reviewed/);
  assert.throws(() => f.lab.review(owner, f.draft.id, {}), /Complete/);
  assert.equal(f.lab.list(learner).length, 0);
  f.release(); const s = f.lab.start(learner, f.draft.id);
  assert.throws(() => f.lab.view({ ...learner, user: 'other' }, s.id), /not found/);
  assert.throws(() => f.lab.start({ ...learner, tenant: 'other' }, f.draft.id), /not found/);
});
test('source validation, copied provenance, dedupe and no headline/actor leak', () => {
  const f = fixture(); const source = { kind: 'reviewed-public-news', verified: true, eventId: 'gdelt-1', reviewId: 'review-1', url: 'https://example.org/news', publishedAt: new Date(f.now()).toISOString(), headline: 'Real person accused of crime' };
  const m = f.lab.draft(owner, { ...f.input, source });
  assert.equal(JSON.stringify(m).includes('Real person'), false);
  source.eventId = 'changed'; assert.equal(m.source.eventId, 'gdelt-1');
  assert.throws(() => f.lab.draft(owner, { ...f.input, source: { ...source, eventId: 'gdelt-1' } }), /Duplicate/);
  for (const patch of [{kind:'halo-ops'}, {verified:false}, {url:'javascript:alert(1)'}, {publishedAt:'invalid'}, {publishedAt:new Date(f.now()+1).toISOString()}])
    assert.throws(() => f.lab.draft(owner, { ...f.input, source: { ...source, ...patch } }));
});
test('exact expiry, no release extension and revocation', () => {
  const f = fixture(); const m = f.release(); assert.equal(m.expiresAt-m.releasedAt, DAY);
  assert.throws(() => f.lab.release(owner, m.id), /Reviewed/);
  f.advance(DAY-1); assert.equal(f.lab.list(learner).length, 1);
  f.advance(1); assert.equal(f.lab.list(learner).length, 0);
  assert.throws(() => f.lab.start(learner,m.id), /expired/);
  const g=fixture(); const p=play(g); g.lab.revoke(owner,g.draft.id);
  assert.throws(() => p.send('answer', {answer:1}), /unavailable/);
});
test('stale source cannot be released after sitting in review', () => {
  const f=fixture(); const m=f.lab.draft(owner,{...f.input,source:{kind:'reviewed-public-news',verified:true,eventId:'a',reviewId:'b',url:'https://example.org',publishedAt:new Date(f.now()).toISOString()}});
  f.lab.review(owner,m.id,{fictionChecked:true,geographyChecked:true,sourceChecked:true}); f.advance(DAY+1);
  assert.throws(()=>f.lab.release(owner,m.id),/stale/);
});
test('brief, deterministic validation, independent progression, hints and debrief', () => {
  const f=fixture(), p=play(f);
  p.send('answer',{answer:solution(p.view())}); p.send('answer',{answer:solution(p.view())});
  assert.equal(p.view().level,2);
  p.send('hint'); const r=p.send('answer',{answer:solution(p.view())}).result;
  assert.equal(r.correct,true); assert.equal(r.independent,false); assert.equal(p.view().level,2);
  p.send('answer',{answer:-999}); assert.equal(p.view().level,1);
  assert.throws(()=>p.send('answer',{answer:''}),/Integer/);
  assert.throws(()=>p.send('answer',{answer:true}),/Integer/);
  assert.throws(()=>p.send('answer',{answer:'1e2'}),/Integer/);
  p.send('finish',{outcome:'completed'});
  assert.equal(p.view().phase,'debrief'); assert.equal(p.view().debrief.principlesCredit,false);
  assert.equal(p.view().debrief.independent,2); assert.equal(p.view().debrief.attempts,4);
});
test('offline replay is idempotent after lost ACK even at expiry; conflicts and ordering rejected', () => {
  const f=fixture(), p=play(f); const { e, result }=p.send('answer',{answer:solution(p.view())});
  const sid=p.view().id;
  assert.deepEqual(f.lab.submit(learner,sid,e),result);
  assert.equal(p.view().debrief.attempts,1);
  assert.throws(()=>f.lab.submit(learner,sid,{...e,answer:999}),/Conflicting/);
  assert.throws(()=>f.lab.submit(learner,sid,{...e,id:'new',seq:99}),/Out of order/);
  f.advance(DAY); assert.deepEqual(f.lab.submit(learner,sid,e),result);
  assert.throws(()=>p.send('answer',{answer:1}),/expired/);
});
test('copied views cannot mutate service answers or release status',()=>{
  const f=fixture(),p=play(f); const v=p.view(); v.mission.status='draft'; v.level=999;
  assert.equal(f.lab.view(learner,v.id).level,1); assert.equal(f.lab.list(learner).length,1);
});
test('canonical URL and event dedupe survive tracking parameters and country changes',()=>{
  const f=fixture();const source={kind:'reviewed-public-news',verified:true,eventId:'story',reviewId:'review',url:'https://example.org/story?utm_source=a',publishedAt:new Date(f.now()).toISOString()};
  f.lab.draft(owner,{...f.input,source});
  assert.throws(()=>f.lab.draft(owner,{country:'GB',region:'England',source:{...source,eventId:'new',url:'https://example.org/story?utm_source=b'}}),/Duplicate/);
  assert.throws(()=>f.lab.draft(owner,{...f.input,source:{...source,url:'https://example.org/different'}}),/Duplicate/);
});
test('fresh items vary answers and stale item IDs cannot earn another assessment',()=>{
  const f=fixture(),p=play(f); const first=p.view().question.id, a=solution(p.view());
  p.send('answer',{answer:a});assert.notEqual(solution(p.view()),a);
  assert.throws(()=>p.send('answer',{questionId:first,answer:a}),/Current question/);
});
test('review cannot change released content and game completion cannot bypass practice',()=>{
  const f=fixture(),p=play(f);
  assert.throws(()=>f.lab.review(owner,f.draft.id,{fictionChecked:true,geographyChecked:true}),/draft/);
  assert.throws(()=>p.send('finish',{outcome:'completed'}),/Practice/);
});
