/* Rentals in the World's Travel sheet (owner, 2026-10-20): cars from Whip Equipped LLC, Matthew's separate company,
   named as such; the Isabeata 2024 (a fictional make) at $350 a week; Reserve continues in Whip Equipped's own
   rentals app, which never takes a reservation for a car the fleet has not listed, and invents no rating. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

test('Travel lists the Isabeata 2024 at $350 a week, from Whip Equipped as a separate company', async () => {
  const js = await read('js/travel/world-travel.mjs');
  assert.match(js, /const RENTAL_CARS = \[\{ id:'we-rental-isabeata-2024', name:'Isabeata 2024', kind:'Economy', seats:5, weekly:350, color:'#c9ced4' \}\];/);
  assert.match(js, /From Whip Equipped LLC, a separate company\./);
  assert.match(js, /href="https:\/\/matthew\.mccluster\.org\/whip\/rentals\/\?vehicle=\$\{encodeURIComponent\(car\.id\)\}"/);
  assert.match(js, /data-travel-sub="directions"[^]*data-travel-sub="rentals"[^]*data-travel-sub="commercial"[^]*data-travel-sub="private"/);
  assert.doesNotMatch(js, /data-travel-chip="multi"/, 'Door-to-door stays under Plan a trip');
});

test('Whip rentals shows the Isabeata 2024 but takes no reservation until the fleet lists it, and invents no rating', async () => {
  const js = await read('whip/rentals/app.js');
  assert.match(js, /const ISABEATA=\{id:'we-rental-isabeata-2024',name:'Isabeata 2024',category:'economy',daily:50,weekly:350,rating:null,trips:0,/);
  assert.match(js, /listed:false\};/);
  assert.match(js, /const fleetIsabeata=vehicles\.find\(v=>v\.name===ISABEATA\.name\);if\(fleetIsabeata\)fleetIsabeata\.aliases=\[ISABEATA\.id\];else vehicles\.unshift\(ISABEATA\);/,
    'a fleet vehicle named Isabeata 2024 replaces the placeholder and answers its link');
  assert.match(js, /\$\('#continueCheckout'\)\.onclick=\(\)=>\{if\(state\.selected\.listed===false\)return;/);
  assert.match(js, /\$\('#continueCheckout'\)\.disabled=v\.listed===false;/);
  assert.match(js, /v\.rating==null\?'New'/);
  assert.match(js, /const wanted=params\.get\('vehicle'\);if\(!handled&&wanted&&vehicles\.some\(/);
});
