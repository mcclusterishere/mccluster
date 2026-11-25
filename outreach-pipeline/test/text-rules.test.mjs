import test from 'node:test';
import assert from 'node:assert/strict';
import { dashViolations, hasNoDashes, frameViolations, stripSignature } from '../src/text-rules.mjs';

test('every dash character is refused', () => {
  for (const s of ['a \u2014 b', 'a\u2013b', 'one-third', 'wait - what', 'so--then', '- bullet', 'x \u2212 y', 'a\u2012b', 'a\u2015b']) {
    assert.equal(hasNoDashes(s), false, s);
  }
});
test('hyphens inside email addresses and URLs are allowed', () => {
  assert.equal(hasNoDashes('Write to jane-doe@my-site.example or see https://my-site.example/a-b-c today.'), true);
  assert.deepEqual(dashViolations('plain words, commas; colons: fine.'), []);
});
test('frame B refuses pitches, self description and more than one question', () => {
  const body = 'Mr. Lane,\n\nYour 2026 essay on regional freight said most of the dispatch work still happens on calls. I am a student building something similar at McCluster. What changed your mind? And why now?\n\nMatthew McCluster';
  const p = frameViolations('B', { subject: 'Freight calls', body });
  assert.ok(p.some((x) => x.includes('student')));
  assert.ok(p.some((x) => x.includes('mccluster')));
  assert.ok(p.some((x) => x.includes('exactly one question')));
});
test('frame B signature is not a pitch', () => {
  const body = 'Mr. Lane,\n\nYour 2026 essay on regional freight said most dispatch work still happens on calls nobody writes down, which surprised me given how much software the industry bought in the last decade. You also said the best dispatchers never trusted the screens.\n\nWhat did the best dispatcher you ever watched do that no product has copied yet?\n\nMatthew McCluster';
  assert.deepEqual(frameViolations('B', { subject: 'The dispatchers', body }), []);
});
test('frame A needs the student line and an ask; frame C needs an ask', () => {
  assert.ok(frameViolations('A', { subject: 's', body: 'word '.repeat(60) }).some((x) => x.includes('student')));
  assert.ok(frameViolations('C', { subject: 's', body: 'word '.repeat(60) }).some((x) => x.includes('ask')));
});
test('subject dashes are refused too', () => {
  assert.ok(frameViolations('C', { subject: 'Quick intro \u2014 please', body: 'Could you help with one introduction? '.repeat(8) }).some((x) => x.startsWith('subject has')));
});
test('greeting and signature are stripped before comparison', () => {
  assert.equal(stripSignature('Dana,\n\nBody line.\n\nMatthew McCluster\nmattmccluster@gmail.com'), 'Body line.');
});
