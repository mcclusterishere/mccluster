import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LOCATIONS,locationCoordinates} from '../js/city-arcade/mission-contract.mjs';
const source=await readFile(new URL('../core/data/fictional-city/district.v1.json',import.meta.url));
const n=JSON.parse(source).neighborhoods.find(n=>n.id==='bridgeport-robbery-1s');
const locations=LOCATIONS.map(p=>{
 if(!n.roads.some(r=>r.id===p.roadId&&r.points.some(pt=>pt[0]===p.point[0]&&pt[1]===p.point[1])))throw Error('Unknown canonical street vertex');
 return {...p,coordinates:locationCoordinates(p,n.geography)};
});
const data={schema:'mccluster.arcade-locations/v1',neighborhoodId:n.id,sourceSha256:createHash('sha256').update(source).digest('hex'),geography:{geographicOrigin:n.geography.geographicOrigin,worldOffsetXZ:n.geography.worldOffsetXZ},locations};
await writeFile(new URL('../data/city-arcade/locations.v1.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log('Wrote lightweight marker manifest from canonical city roads.');

await writeFile(new URL('../workers/mccluster/src/arcade/roads.generated.js',import.meta.url),'// Derived from canonical city roads by tools/build-arcade-locations.mjs. Do not hand edit.\nexport const arcadeRoads='+JSON.stringify({roads:n.roads})+';\n');
