import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFrozenCapture, validateFrozenCapture } from '../src/media/frozen-capture.mjs';
function capture() { return { capture_id:'take-1',instant_ms:1000,max_sync_error_ms:5, views:[0,1,2].map(i=>({camera_id:`cam-${i}`,asset_id:`asset-${i}`,sha256:String(i).repeat(64),mime_type:'image/jpeg',width:1920,height:1080,capture_time_ms:1000,sync_uncertainty_ms:1})) }; }
test('three aligned stills produce disabled metadata contract, never a render claim',()=>{const r=prepareFrozenCapture(capture());assert.equal(r.execution.enabled,false);assert.equal(r.status,'metadata_validated_not_reconstructed');});
test('rejects video input and mismatched camera clocks',()=>{const c=capture();c.views[0].mime_type='video/mp4';c.views[1].capture_time_ms=1020;assert.equal(validateFrozenCapture(c).valid,false);});
test('uncertainty counts against synchronization tolerance',()=>{const c=capture();c.views[0].sync_uncertainty_ms=6;assert.equal(validateFrozenCapture(c).valid,false);});
test('duplicate camera and asset rejected',()=>{const c=capture();c.views[1]={...c.views[0]};assert.equal(validateFrozenCapture(c).valid,false);});
test('URLs, paths and source bytes cannot enter the request',()=>{for(const key of ['url','path','data','base64']){const c=capture();c.views[0][key]='secret';assert.equal(validateFrozenCapture(c).valid,false);}});
test('invalid timing, dimensions and evidence rejected',()=>{for(const [key,value] of [['capture_time_ms',NaN],['width',0],['sha256','']]){const c=capture();c.views[0][key]=value;assert.equal(validateFrozenCapture(c).valid,false);}});
test('unknown source metadata is not copied into prepared request',()=>{const c=capture();c.owner_secret='secret';c.views[0].private_note='secret';assert.ok(!JSON.stringify(prepareFrozenCapture(c)).includes('secret'));});
test('malformed root and view count fail closed',()=>{for(const c of [null,[],{}, {...capture(),views:[]}])assert.equal(validateFrozenCapture(c).valid,false);});
