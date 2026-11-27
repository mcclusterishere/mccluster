import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import api from '../../js/arctic-sea-ice.js';
import cursor from '../../js/world-environment-cursor.js';
const base = new URL('../../data/environment/arctic-ice/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json',base)));
const stamp = d => Date.parse(d+'T00:00:00Z');
const days = api.daysOf(manifest);

test('sourced files match the published manifest and bounded geographic display grid', () => {
  assert.deepEqual(manifest.bounds, [-180,45,180,90]);
  assert.equal(manifest.sourceCRS, 'EPSG:3411');
  assert.equal(manifest.outputCRS, 'EPSG:4326');
  assert.ok(days.length >= 2);
  for (const f of manifest.frames) {
    const data = readFileSync(new URL(f.image,base)), url = new URL(f.url);
    assert.equal(url.host,'noaadata.apps.nsidc.org');
    assert.match(url.pathname, new RegExp(f.day.replaceAll('-','') + '_concentration_v4.0.tif$'));
    assert.equal(data.readUInt32BE(0),0x89504e47);
    assert.deepEqual([data.readUInt32BE(16),data.readUInt32BE(20)],manifest.dimensions);
    assert.equal(data.length, f.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'),f.imageSHA256);
    assert.match(f.sourceSHA256,/^[a-f0-9]{64}$/);
  }
});
test('manifest restricts frame paths to distinct real UTC dates', () => {
  for (const frame of [{day:'2020-02-31',image:'2020-02-31.png'}, {day:'2020-02-20',image:'https://not-used/'}, {day:'../x'}]) {
    assert.throws(() => api.daysOf({frames:[frame]}));
  }
  assert.throws(() => api.daysOf({frames:[...manifest.frames,...manifest.frames]}));
});
test('off leaves cursor marks alone, every archive date is addressable, gaps and Live have no image', () => {
  const m=[stamp('2020-03-16')];
  assert.equal(api.withDays(m,[]),m);
  const both=api.withDays(m,days);
  for (const d of days) {
    const t=stamp(d);
    assert.equal(cursor.atOfPosition(both,both.indexOf(t)),t);
    assert.equal(api.dayAt(days,t+23*3600e3),d);
  }
  assert.equal(api.dayAt(days,m[0]),null);
  assert.equal(api.dayAt(days,null),null);
});
function mock(){
  const pending=[], layers=[], receipts=[], removed=[];
  const renderer=api.createGlobe({viewer:{imageryLayers:{
    addImageryProvider(p){const layer={p};layers.push(layer);return layer;},
    remove(l,destroy){removed.push([l,destroy]);}},camera:{setView(){}}},
    Cesium:{Rectangle:{fromDegrees:(...args)=>args},Credit:class{},TextureMagnificationFilter:{NEAREST:1},
      TextureMinificationFilter:{NEAREST:1},SingleTileImageryProvider:{fromUrl:(url,opts)=>new Promise((ok,no)=>pending.push({ok,no,url,opts}))}},
    requestRender(){},tell:s=>receipts.push(s)});
  return {renderer,pending,layers,receipts,removed};
}
test('only the most recently selected raster can paint; disable removes it immediately',async()=>{
  const {renderer,pending,layers,removed,receipts}=mock();
  const old=renderer.show(days[0]), next=renderer.show(days[1]);
  assert.deepEqual(pending[1].opts.rectangle,manifest.bounds);
  pending[1].ok('current'); await next; pending[0].ok('older'); await old;
  assert.equal(layers.length,1); assert.equal(layers[0].p,'current');
  assert.equal(receipts.length,1); assert.equal(receipts[0].status,'ready');
  await renderer.show(null); assert.equal(removed.length,1); assert.equal(removed[0][1],true);
  assert.equal(renderer.state().status,'off');
});
test('failed and abandoned raster never leave a stale layer and can retry',async()=>{
  const {renderer,pending,layers,receipts}=mock();
  const a=renderer.show(days[0]); pending[0].no(new Error('unavailable')); await a;
  assert.equal(renderer.state().status,'failed'); assert.equal(receipts.length,1);
  const retry=renderer.show(days[0]); renderer.destroy(); pending[1].ok('old'); await retry;
  assert.equal(layers.length,0); assert.equal(renderer.state().day,null);
  await renderer.show('https://example.org/fake.png'); assert.equal(pending.length,2);
});
