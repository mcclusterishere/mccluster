import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../'+p, import.meta.url),'utf8');
test('Control has a separate installed app identity and internet-required description',()=>{
 const m=JSON.parse(read('control.webmanifest'));const old=JSON.parse(read('manifest.json'));
 assert.equal(m.id,'./control.html');assert.equal(m.start_url,'./control.html');
 assert.notEqual(m.id,old.id);assert.equal(m.display,'standalone');
 assert.match(m.description,/require internet/);assert.equal(m.icons.length,2);
 assert.deepEqual(m.icons.map(i=>i.sizes),['192x192','512x512']);
 assert.ok(m.icons.every(i=>i.src.startsWith('assets/img/')&&i.purpose==='any'));
});
test('Control uses its own manifest, preserving authenticated gate and existing worker registration',()=>{
 const page=read('control.html');
 assert.match(page,/<link rel="manifest" href="control.webmanifest">/);
 assert.match(page,/id="cpGate"/);assert.match(page,/id="crApp" hidden/);
 assert.match(page,/js\/theme.js/);
});
