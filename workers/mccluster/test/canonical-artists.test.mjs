import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CANONICAL_ARTISTS,handleCanonicalArtists} from '../src/canonical-artists.js';
import {preflightResponse} from '../src/preflight.js';
const artist=Object.keys(CANONICAL_ARTISTS)[1];
test('canonical IDs and fallback artwork remain the explicit album registry, not display-name matching',async()=>{
 const data=JSON.parse(await readFile(new URL('../../../data/albums.json',import.meta.url),'utf8'));
 for(const [id,value]of Object.entries(CANONICAL_ARTISTS)){assert.equal(data.artist_profiles[id].home,value.home);assert.equal(data.artist_profiles[id].logo,value.logo);}
});
test('authenticated cross-origin artist binding preflight is answered before auth',()=>{
 const r=preflightResponse(new Request('https://api.mccluster.org/v1/canonical-artists/bind',{method:'OPTIONS',headers:{origin:'https://matthew.mccluster.org','access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}}),{});
 assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://matthew.mccluster.org');assert.match(r.headers.get('access-control-allow-headers'),/authorization/i);
});
test('unknown identity and unavailable storage disclose no grant or caller-supplied destination',async()=>{
 const db={select:async()=>{throw Error('database details');}};
 const r=await handleCanonicalArtists(new Request('https://api.mccluster.org/v1/canonical-artists/resolve?id='+encodeURIComponent(artist)),{},{db});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/database details|owner_user_id/);
 const unknown=await handleCanonicalArtists(new Request('https://api.mccluster.org/v1/canonical-artists/resolve?id=Equity%20Uprise'),{},{db});assert.equal(unknown.status,404);
 for(const id of ['__proto__','constructor','toString']){
  let reads=0;const r=await handleCanonicalArtists(new Request('https://api.mccluster.org/v1/canonical-artists/resolve?id='+id),{},{db:{select:async()=>{reads++;return [];}}});assert.equal(r.status,404);assert.equal(reads,0);
 }
});
