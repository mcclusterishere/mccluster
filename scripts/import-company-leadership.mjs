/* Offline importer for independently reviewed public company facts. No web fetch,
   database mutation, geocoding, trade or automatic publication. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateLeadershipReference} from '../workers/mccluster/src/finance/leadership.js';
const args=process.argv.slice(2),input=args[0],output=args[1];
if(!input||args.length>2)throw Error('Usage: node scripts/import-company-leadership.mjs reviewed.json [local-output.json]');
const doc=validateLeadershipReference(JSON.parse(await readFile(input,'utf8')));
const summary={version:doc.retrieved_at,companies:doc.companies.length,people:doc.companies.reduce((n,c)=>n+c.people.length,0),roles:doc.companies.reduce((n,c)=>n+c.people.reduce((m,p)=>m+p.roles.length,0),0),sources:doc.sources.length,geocoded_business_addresses:doc.companies.filter(c=>c.headquarters?.geolocation).length};
if(output){const destination=resolve(output),temporary=destination+'.importing';await writeFile(temporary,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});await rename(temporary,destination);}
console.log(JSON.stringify({...summary,written:output?resolve(output):null},null,2));
