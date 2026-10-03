import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const read=p=>readFileSync(p,"utf8");
test("SEO/AEO authority surfaces stay coherent",()=>{
 const e=JSON.parse(read("data/seo/entity-graph.json"));
 const d=JSON.parse(read("data/dossier.json"));
 const v=JSON.parse(read("data/seo/evidence-ledger.json"));
 const s=JSON.parse(read("data/seo/sitemap-pages.json"));
 const p=read("matthew-mccluster.html"),h=read("hire.html"),l=read("llms.txt"),w=read("tools/build-walls.mjs");
 const policy=read("policy.html"),portfolio=read("portfolio.html"),press=read("press.html"),card=read("card.html"),brands=read("data/brands.json"),roles=read("data/roles.json");
 assert.equal(e.schema_version,"mccluster-seo-entity/v2");
 assert.equal(e.person["@id"],"https://matthew.mccluster.org/#matthew-mccluster");
 assert.equal(e.person.worksFor["@id"],"https://matthew.mccluster.org/#mccluster-corp");
 assert.ok(!Object.hasOwn(e.person,"founder"),"Person must not carry Organization founder direction");
 assert.ok(e.person.affiliation.some(x=>x["@id"]==="https://matthew.mccluster.org/#southern-connecticut-state-university"));
 assert.ok(e.person.owns.some(x=>x["@id"]==="https://matthew.mccluster.org/whip.html#whip-equipped"));
 assert.ok(e.person.skills.includes("GNSS and fleet telematics"));
 assert.equal(e.organization.founder["@id"],"https://matthew.mccluster.org/#matthew-mccluster");
 assert.equal(e.projects.equity_uprise.parentOrganization["@id"],"https://matthew.mccluster.org/#mccluster-corp");
 assert.equal(e.projects.prim3.parentOrganization["@id"],"https://matthew.mccluster.org/#mccluster-corp");
 assert.equal(e.projects.heal_the_3rd_world.parentOrganization["@id"],"https://matthew.mccluster.org/#equity-uprise");
 assert.equal(e.software.action_network.about["@id"],"https://matthew.mccluster.org/#equity-uprise");
 assert.equal(e.software.action_network.publisher["@id"],"https://matthew.mccluster.org/#mccluster-corp");
 assert.equal(e.software.action_network.creator["@id"],"https://matthew.mccluster.org/#matthew-mccluster");
 assert.ok(!JSON.stringify(e).includes("equity-uprise.html"),"do not emit shelved Equity Uprise URL");
 const ids=[]; const schema=JSON.parse(p.match(/<!-- SEO-ENTITY:START -->\s*<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
 for(const n of schema["@graph"]) if(n["@id"]) ids.push(n["@id"]);
 assert.equal(new Set(ids).size,ids.length,"canonical graph IDs must be unique");
 assert.ok(!JSON.stringify(schema).includes("identity_resolution"),"internal identity-resolution metadata must not be emitted");
 assert.match(p,/Southern Connecticut State University/);
 assert.match(p,/GNSS|telematics/);
 assert.doesNotMatch(p,/Owner-Operator of:[\s\S]*through September 2026/);
 assert.doesNotMatch(p,/Street Credit Bureau/);
 assert.equal(d.person.school.status,"Enrolled undergraduate");
 assert.equal(d.person.school.major,"Computer Science");
 assert.doesNotMatch(JSON.stringify(d),/registered Connecticut public charity/i);
 assert.doesNotMatch(JSON.stringify(d),/instructing new team members/i);
 const policyLd=JSON.parse(policy.split('<script type="application/ld+json">')[1].split("</script>")[0]);
 const portfolioLd=JSON.parse(portfolio.split('<script type="application/ld+json">')[1].split("</script>")[0]);
 assert.ok(!policyLd["@graph"].some(n=>n["@type"]==="Person"&&n["@id"]===e.person["@id"]));
 assert.ok(!portfolioLd["@graph"].some(n=>n["@type"]==="Person"&&n["@id"]===e.person["@id"]));
 assert.doesNotMatch(card,/"@type": "Person"/);
 assert.doesNotMatch(portfolio,/registered Connecticut public charity/i);
 assert.doesNotMatch(press,/Street Credit Bureau|registered Connecticut public charity/i);
 assert.doesNotMatch(brands,/registered Connecticut public charity|Every frame, chord, and line of code/i);
 assert.match(roles,/Automotive Systems & Telematics Operator/);
 assert.match(h,/Founder · connected mobility/);
 assert.match(l,/Southern Connecticut State University/);
 assert.match(l,/telematics/);
 assert.match(p,/SEO-ENTITY:START/); assert.match(p,/A\$hon Voyage/); assert.match(p,/github\.com\/mcclusterishere/);
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


test("recruiter authority intent pages are indexable, evidence-linked and canonical",()=>{
 const sitemap=JSON.parse(read("data/seo/sitemap-pages.json"));
 const hub=read("engineering/index.html");
 const pages=[
  ["engineering/it-support-systems.html","IT Support and Systems Specialist"],
  ["engineering/data-center-networking.html","Data Center and Network Infrastructure Specialist"],
  ["engineering/mccluster-platform.html","Platform and Backend Engineer"],
  ["engineering/field-technology-telematics.html","Field Technology and Telematics Specialist"]
 ];
 const titles=new Set();
 for(const [path,occupation] of pages){
   const html=read(path);
   const title=html.split("<title>")[1]?.split("</title>")[0];
   assert.ok(title && !titles.has(title),path+" must have a unique title");
   titles.add(title);
   assert.ok(html.includes("https://matthew.mccluster.org/#matthew-mccluster"),path+" must reference canonical Person");
   assert.ok(html.includes(occupation),path+" must declare the intended occupation");
   assert.ok(!html.includes("JobPosting"),path+" must not use JobPosting schema");
   const canonical=html.split('<link rel="canonical" href="')[1]?.split('"')[0];
   assert.ok(canonical && sitemap.pages.some(x=>x.url===canonical),path+" canonical must be in sitemap");
   assert.ok(hub.includes(path.split("/").at(-1)),path+" must be linked from engineering hub");
 }
 const llms=read("llms.txt");
 assert.match(llms,/IT support & systems/);
 assert.match(llms,/Data center, networking & infrastructure/);
 assert.match(llms,/Platform, backend & technical operations/);
 assert.match(llms,/Field technology, telematics & vehicle systems/);
});


test("recruiter evidence ledger maps role titles to four substantive canonical pages",()=>{
 const d=JSON.parse(read("data/seo/recruiter-evidence.json"));
 const page=read("engineering/recruiter-role-map.html");
 const sitemap=JSON.parse(read("data/seo/sitemap-pages.json"));
 assert.equal(d.schema_version,"mccluster-recruiter-authority/v1");
 assert.equal(d.person_id,"https://matthew.mccluster.org/#matthew-mccluster");
 assert.equal(d.clusters.length,4);
 const urls=new Set(d.clusters.map(x=>x.canonical_url));
 assert.equal(urls.size,4);
 for(const c of d.clusters){
   assert.ok(c.role_titles.length>=5,c.id+" should cover multiple recruiter titles");
   assert.ok(c.query_families.length>=5,c.id+" should cover multiple query families");
   assert.ok(c.evidence.length>=2,c.id+" must carry evidence links");
   assert.ok(c.caveat,c.id+" must state an evidence boundary");
   assert.ok(sitemap.pages.some(x=>x.url===c.canonical_url),c.canonical_url+" missing from sitemap");
 }
 assert.ok(sitemap.pages.some(x=>x.url==="https://matthew.mccluster.org/engineering/recruiter-role-map.html"));
 const roleMapLd=JSON.parse(page.split('<script type="application/ld+json">')[1].split("</script>")[0]);
 assert.notEqual(roleMapLd["@type"],"JobPosting");
 assert.ok(page.includes("target query families, not ranking claims or guarantees"));
 const r=spawnSync(process.execPath,["tools/build-recruiter-role-map.mjs","--check"],{encoding:"utf8"});
 assert.equal(r.status,0,(r.stdout||"")+(r.stderr||""));
});
