import {readFileSync,writeFileSync} from "node:fs";
const check=process.argv.includes("--check");
const PAGE="matthew-mccluster.html", START="<!-- SEO-ENTITY:START -->", END="<!-- SEO-ENTITY:END -->";
const d=JSON.parse(readFileSync("data/seo/entity-graph.json","utf8"));
const SITE="https://matthew.mccluster.org", PERSON=SITE+"/#matthew-mccluster";
const graph=[
  {"@type":"ProfilePage","@id":SITE+"/matthew-mccluster.html#profile-page",url:d.canonical_url,
   name:"Matthew McCluster: Infrastructure, Technical Operations, Platforms & Creative Direction",
   dateModified:d.updated_at,mainEntity:{"@id":PERSON},about:{"@id":PERSON}},
  d.person,d.organization,
  ...Object.values(d.education||{}),...Object.values(d.organizations||{}),...Object.values(d.projects||{}),
  ...Object.values(d.software||{}),...Object.values(d.creative_works||{}),
  {"@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"name":"Home","item":SITE+"/"},
    {"@type":"ListItem","position":2,"name":"Matthew McCluster","item":d.canonical_url}
  ]}
];
const block=START+"\n<script type=\"application/ld+json\">\n"+JSON.stringify({"@context":"https://schema.org","@graph":graph},null,2)+"\n</script>\n"+END;
const page=readFileSync(PAGE,"utf8"), re=new RegExp(START+"[\\s\\S]*?"+END);
if(!re.test(page)) throw new Error("profile entity markers missing");
const out=page.replace(re,block);
if(check){if(out!==page){console.error("profile entity JSON-LD drift");process.exit(1)}console.log("profile entity JSON-LD in sync")}
else{writeFileSync(PAGE,out);console.log("updated "+PAGE)}
