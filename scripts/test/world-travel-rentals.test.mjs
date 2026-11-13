import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {vehicleMarketMarkup} from '../../js/travel/vehicle-market.mjs';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('globe market has separate closed rent/buy paths and native owner management',async()=>{
 const html=vehicleMarketMarkup();
 for(const text of ['Rent a vehicle','Buy a vehicle','No verified listings','Square checkout is not connected','Card payment is not financing','control.html#system:rentals']) assert.ok(html.includes(text));
 assert.doesNotMatch(html,/Isabeata|Reserve|<input|<form/);
 const js=await read('js/travel/world-travel.mjs');
 assert.match(js,/wtMarketOpen/); assert.match(js,/vehicleMarketMarkup\(\)/);
 assert.doesNotMatch(js,/const RENTAL_CARS/);
});
test('standalone rental entry stops before legacy sample inventory or payment code',async()=>{
 const js=await read('whip/rentals/app.js');
 assert.ok(js.indexOf('return;')<js.indexOf('const SESSION_KEY'));
 assert.match(js,/No verified vehicles are published/);
 assert.doesNotMatch(await read('whip/rentals/sw.js'),/respondWith/);
});
