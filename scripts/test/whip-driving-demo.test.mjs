import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WHIP_BETA_PLAN} from '../../js/travel/whip-demo.mjs';
import {normalizeJourney} from '../../js/travel/journey-core.mjs';
import {withFutureTransport} from '../e2e/world-switch.mjs';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('beta plan is a closed proposal with a 49-driver maximum',()=>{
 assert.deepEqual(WHIP_BETA_PLAN,{maxDrivers:49,ridesLive:false,intakeOpen:false});
 assert.ok(Object.isFrozen(WHIP_BETA_PLAN));
});
test('deferred travel modes still normalize without changing their stored mode',()=>{
 for(const mode of ['drive','flight','train','walk','cycle','transit']) assert.equal(normalizeJourney({mode}).mode,mode);
});
test('public booking entry selects the inert demo; commercial foundation is preserved',async()=>{
 const source=await read('js/travel/whip-booking.mjs');
 assert.match(source,/export function attachWhipBooking\(options\) \{ return attachWhipDemo\(options\); \}/);
 assert.match(source,/export function attachLiveWhipBooking/);
 const demo=await read('js/travel/whip-demo.mjs');
 assert.doesNotMatch(demo,/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|accountApi|geolocation|Stripe)\b/);
 assert.doesNotMatch(demo,/<input|<form|https?:|\/api\//);
 assert.match(demo,/No real ride is booked/);
 assert.match(demo,/not enrollment/);
});
test('driving presentation cannot be enabled through a URL and preserves future journeys',async()=>{
 const source=await read('js/travel/world-travel.mjs');
 assert.match(source,/const DRIVING_PREVIEW = true;/);
 assert.match(source,/if \(DRIVING_PREVIEW && plan.mode !== 'drive'\).*preserved for later/s);
 assert.match(source,/if \(DRIVING_PREVIEW && \(kind !== 'drive'/);
 assert.match(source,/element.inert = true/);
 assert.match(withFutureTransport(source),/const DRIVING_PREVIEW = false;/);
 assert.match(source,/house owner's World/);
});
test('rider entry loads only the shared demo, and retired cache never intercepts requests',async()=>{
 const html=await read('whip/rider/index.html');
 assert.match(html,/No real ride is booked/);
 assert.doesNotMatch(html,/app\.js|4242|Jordan|data-miles|localhost/);
 assert.match(await read('whip/rider/demo.mjs'),/attachWhipBooking/);
 const sw=await read('whip/rider/sw.js');
 assert.doesNotMatch(sw,/respondWith|cache\.put/);
 assert.match(sw,/startsWith\('whip-equipped-'\)/);
});
