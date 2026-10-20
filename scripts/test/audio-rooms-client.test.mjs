/* The audio rooms client (js/mnet-audio.js): the microphone opens only from
   the Speak tap, the page never handles member ids, and bodies reach
   MCC.api as objects (it stringifies them itself; a string arrives quoted). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const js = await readFile(new URL('../../js/mnet-audio.js', import.meta.url), 'utf8');

test('the microphone is asked for once, from the Speak handler only', () => {
  assert.equal(js.match(/getUserMedia\(/g)?.length, 1);
  const speak = js.slice(js.indexOf('async function speak('), js.indexOf('async function hand('));
  assert.match(speak, /getUserMedia\(\{audio:\{/);
  assert.match(speak, /video:false/);
});

test('the page never names or sends a member id', () => {
  assert.doesNotMatch(js, /m_uid/);
  assert.match(js, /\{target:p\.participant_id,allow:true\}/);
  assert.match(js, /\{publisher:publisher\}/);
});

test('signed-in calls hand MCC.api an object body, never a pre-stringified one', () => {
  assert.doesNotMatch(js, /M\.api\([^)]*JSON\.stringify/);
  assert.match(js, /return M\.api\(ROOT\+path,body===undefined\?undefined:\{method:'POST',body:body\}\);/);
});

test('a visitor listens with a pass and no session; going elsewhere asks for sign-in', () => {
  assert.match(js, /open\('\/rooms\/'\+r\.id\+'\/listen',\{\}\)/);
  assert.match(js, /credentials:'omit'/);
  assert.match(js, /if\(pass\)return open\(path,body,pass\);/);
  assert.match(js, /if\(ok\)void join\(r\);else askSignIn\(\);/);
});

test('the globe hears where conversations are on air as counts per country, never people', () => {
  const tell = js.slice(js.indexOf('function tellGlobe('), js.indexOf('async function livePlaces('));
  assert.match(tell, /\{type:'hu:live-places',source:'audio',places:places\}/);
  assert.match(tell, /location\.origin/);
  const count = js.slice(js.indexOf('async function livePlaces('), js.indexOf('function paintPlace('));
  assert.match(count, /return \{code:k,count:count\[k\]\};/);
  assert.doesNotMatch(count, /display_name|participant_id|host/);
});
