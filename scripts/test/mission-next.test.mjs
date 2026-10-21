/* WHAT'S NEXT (owner, 2026-10-20): once a mission is verified, the Action Record names one open mission the member has
   not taken, nearest to what they finished, else the most joined. The function is lifted out of js/mnet.js as written. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const src = await readFile(new URL('../../js/mnet.js', import.meta.url), 'utf8');
const body = src.match(/  function nextMission\(r\)\{[\s\S]*?\n  \}\n/);
assert.ok(body, 'nextMission is defined in js/mnet.js');
function pick(record, all, stats = {}) {
  const ctx = { missions: { all, stats } };
  vm.runInNewContext(body[0] + ';result=nextMission(record);', Object.assign(ctx, { record }));
  return ctx.result;
}
const open = [
  { id: 'a', title: 'Film your block', domain: 'media', skills: ['filming'] },
  { id: 'b', title: 'Write a Song', domain: 'music', skills: ['writing', 'music'] },
  { id: 'c', title: 'Register voters', domain: 'civic', skills: ['organizing'] },
  { id: 'done', title: 'Record a verse', domain: 'music', skills: ['music'] },
];

test('nothing is suggested before anything is verified', () => {
  assert.equal(pick({ missions: [{ mission_id: 'done', status: 'submitted' }] }, open), null);
  assert.equal(pick({ missions: [] }, open), null);
});

test('the suggestion shares a skill or field with the verified work, and is never one already taken', () => {
  const next = pick({ missions: [{ mission_id: 'done', status: 'verified' }, { mission_id: 'a', status: 'joined' }] }, open, { c: { joined: 99 } });
  assert.equal(next.id, 'b');
});

test('a finished mission that has since closed still steers the suggestion by its own skills and field', () => {
  const next = pick({ missions: [{ mission_id: 'closed', status: 'verified', domain: 'civic', skills: ['organizing'] }] }, open.slice(0, 3), { a: { joined: 50 } });
  assert.equal(next.id, 'c');
});

test('with nothing nearby, the most joined open mission is suggested', () => {
  const next = pick({ missions: [{ mission_id: 'gone', status: 'verified' }] }, open.slice(0, 3), { a: { joined: 2 }, c: { joined: 7 } });
  assert.equal(next.id, 'c');
});

test('when every open mission is taken, nothing is suggested', () => {
  const taken = open.map((m) => ({ mission_id: m.id, status: 'verified' }));
  assert.equal(pick({ missions: taken }, open), null);
});

test('the record draws it with one button that opens the mission, and repaints once missions load', () => {
  assert.match(src, /Next for you<\/p><b>'\+esc\(next\.title\)\+'<\/b><button class="mn__primary" type="button" data-open-mission="'\+esc\(next\.id\)\+'">View mission<\/button>/);
  assert.match(src, /worldMissionDeckLoaded=true;\n      paintActionRecord\(\);/);
});
