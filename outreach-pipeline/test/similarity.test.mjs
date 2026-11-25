import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fingerprint, guard, compare, DEFAULT_THRESHOLDS } from '../src/similarity.mjs';
import { loadHistory } from '../src/history.mjs';

const prior = { id: 'p1', label: 'prior', subject: 'The year you closed the second warehouse', body: 'Riley,\n\nWhen Stonefield closed its second warehouse in 2025 you wrote that the decision took four minutes and the explanation took four months.\n\nI study computer science and I am building scheduling software for small crews, so I keep thinking about that gap between deciding and explaining.\n\nWould you have fifteen minutes this winter for a few questions about how you told your team?\n\nMatthew McCluster' };
const H = [fingerprint(prior)];

test('a shared sentence is rejected even inside an otherwise new letter', () => {
  const body = 'Dana,\n\nLarkspur Fund III will back eleven companies and keep a reserve for restarts, which nobody else writes down.\n\nI study computer science and I am building scheduling software for small crews, so I keep thinking about that gap between deciding and explaining.\n\nMatthew McCluster';
  const r = guard({ subject: 'Eleven companies', body }, H);
  assert.equal(r.ok, false);
  assert.ok(r.violations[0].reasons.some((x) => x.rule === 'shared_sentence'));
});
test('a light paraphrase that keeps a long phrase is rejected', () => {
  const body = 'Dana,\n\nAs a CS student I keep thinking about that gap between deciding and explaining, after reading your fund note about restarts and reserves for founders.\n\nMatthew McCluster';
  const r = guard({ subject: 'Restarts', body }, H);
  assert.equal(r.ok, false);
  assert.ok(r.violations[0].reasons.some((x) => x.rule === 'shared_phrase'));
});
test('the same subject or opening is rejected', () => {
  const r = guard({ subject: 'The year you closed the second warehouse', body: 'When Stonefield closed its second warehouse it changed how I think about freight software and the people who choose it every single day.' }, H);
  assert.equal(r.ok, false);
  const rules = r.violations[0].reasons.map((x) => x.rule);
  assert.ok(rules.includes('similar_subject'));
  assert.ok(rules.includes('same_opening'));
});
test('a genuinely different letter passes, signatures and greetings do not count', () => {
  const body = 'Ms. Whitfield,\n\nYour March note says Larkspur Fund III will back only eleven companies and hold money for founders who must restart after a failed first product.\n\nWould you be open to a short conversation about how you judge who earns that second try?\n\nMatthew McCluster';
  const r = guard({ subject: 'Eleven companies and a reserve', body }, H);
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
test('embedding similarity is enforced when vectors exist', () => {
  const a = fingerprint({ subject: 'x', body: 'Totally different words about sailing boats and harbor tides in Maine.', embedding: [1, 0, 0.01] });
  const b = fingerprint({ subject: 'y', body: 'Nothing alike here regarding mountain bikes, gravel, and the Rockies.', embedding: [1, 0, 0] });
  assert.ok(compare(a, b, DEFAULT_THRESHOLDS).reasons.some((x) => x.rule === 'embedding_cosine'));
});
test('the real November 2026 batch passes pairwise (calibration), when its files are on this box', { skip: !fs.existsSync('/workspace/hnw-outreach/drafts.json') }, () => {
  const h = loadHistory('/workspace/hnw-outreach');
  assert.ok(h.items.length >= 13);
  const fps = h.items.map((i) => fingerprint(i));
  for (let i = 0; i < fps.length; i += 1) for (let j = i + 1; j < fps.length; j += 1) {
    assert.deepEqual(compare(fps[i], fps[j]).reasons, [], `${fps[i].label} vs ${fps[j].label}`);
  }
});
