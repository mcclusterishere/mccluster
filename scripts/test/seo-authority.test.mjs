import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const read=p=>readFileSync(p,"utf8");
test("SEO/AEO authority surfaces stay coherent",()=>{
 const e=JSON.parse(read("data/seo/entity-graph.json"));
 const v=JSON.parse(read("data/seo/evidence-ledger.json"));
 const s=JSON.parse(read("data/seo/sitemap-pages.json"));
 const p=read("matthew-mccluster.html"),h=read("hire.html"),l=read("llms.txt"),w=read("tools/build-walls.mjs");
 assert.equal(e.person["@id"],"https://matthew.mccluster.org/#matthew-mccluster");
 assert.match(p,/SEO-ENTITY:START/); assert.match(p,/A\$hon Voyage/); assert.match(p,/github\.com\/mcclusterishere/);
 assert.match(p,/"@type": "ProfilePage"[\s\S]*?"mainEntity": \{\s*"@id": "https:\/\/matthew\.mccluster\.org\/#matthew-mccluster"/);
 assert.doesNotMatch(p,/"@type": \[\s*"Person",\s*"ProfilePage"/);
 assert.doesNotMatch(p,/instructed new team members/);
 assert.match(h,/SEO-HIRE:START/); assert.doesNotMatch(h,/The Limited Offer|Photo & Video Shoot Day|Southern Connecticut State University/);
 for(const x of v.items.filter(x=>x.publish)) assert.equal(x.verification_status,"verified");
 for(const u of ["https://matthew.mccluster.org/newsroom.html","https://matthew.mccluster.org/services.html","https://matthew.mccluster.org/engineering/"]) assert.ok(s.pages.some(x=>x.url===u),u);
 assert.match(l,/17 tracks/); assert.match(l,/21 items/); assert.doesNotMatch(l,/registered Connecticut public charity/);
 assert.doesNotMatch(w,/writeFileSync\(smPath/);
});
test("SEO generators reproduce committed outputs",()=>{
 for(const tool of ["tools/build-profile-entity.mjs","tools/build-hire-schema.mjs","tools/build-newsroom.mjs","tools/build-sitemap.mjs"]){
   const r=spawnSync(process.execPath,[tool,"--check"],{encoding:"utf8"});
   assert.equal(r.status,0,tool+"\n"+(r.stdout||"")+(r.stderr||""));
 }
});
