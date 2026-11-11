// Read-only diagnostic of existing city adapter data. --strict fails on mismatches or unsupported parity.
import { readFile } from 'node:fs/promises';
import { createSpatialWorld, isWalkable, moveWithCollisions, PLAYER_RADIUS } from '../../js/fictional-city/spatial.mjs';
import { tacticalRegion } from '../../js/fictional-city/tactical.mjs';
import { createPlacesIndex } from '../../js/fictional-city/places.mjs';
const read = async name => JSON.parse(await readFile(new URL(`../../core/data/fictional-city/${name}.v1.json`, import.meta.url)));
const [places, district] = await Promise.all([read('places'), read('district')]);
const world = createSpatialWorld([...district.businesses, district.garage], district.district.island.hq, places);
const region = tacticalRegion(places, world, places.frame.bounds, { manifest: district });
const index = createPlacesIndex(places, district);
const doors = [...places.parcels, ...places.legacyParcels].map(p => {
  const door = index.resolve(p.id), tile = region.toLocalTile(door.x, door.z);
  return { id: p.id, metres: {x:door.x,z:door.z}, tile, tactical:region.kindRows[tile.y]?.[tile.x], freewalk:isWalkable(door.x,door.z,world,PLAYER_RADIUS) };
});
const doorMismatches = doors.filter(d => d.freewalk && d.tactical !== '.');
const profiles = [PLAYER_RADIUS, .3].map(radius => {
  let edges = 0; const mismatches = [];
  for(let y=0;y<region.H;y++) for(let x=0;x<region.W;x++) {
    if(region.kindRows[y][x] !== '.') continue;
    for(const [dx,dy] of [[1,0],[0,1]]) {
      if(region.kindRows[y+dy]?.[x+dx] !== '.') continue;
      edges++;
      const from = region.toCity(x,y), to = region.toCity(x+dx,y+dy);
      // Both directions matter because continuous movement slides along blockers.
      for(const [a,b] of [[from,to],[to,from]]) {
        const actual = moveWithCollisions(a,b.x-a.x,b.z-a.z,world,undefined,radius);
        if(Math.hypot(actual.x-b.x,actual.z-b.z) > .05) mismatches.push({from:a,to:b,actual});
      }
    }
  }
  return {radiusM:radius,undirectedEdges:edges,directedMismatches:mismatches.length,examples:mismatches.slice(0,8)};
});
const report = {
  scope:'Existing fictional district/places adapter only; excludes concurrent Bridgeport extensions. This bridge is not a shipped shared interior navigation runtime.',
  frame:places.frame, tileM:region.tileM, freewalkRadiusM:PLAYER_RADIUS,
  doorCount:doors.length, doorMismatchCount:doorMismatches.length, doorMismatches, movementProfiles:profiles,
  unsupported:[
    'No shared continuous HQ interior adapter: cannot claim same-door/stair/furniture traversal parity in both modes.',
    'City tactical region has one floor and no vertical links; HQ protected stairs belong to its separate level adapter.',
    'City freewalk collision is planar and has no shared height-aware LOS query. Tactical heights approximate footprint blockers; LOS parity is unverified.',
    'Interior furniture uses separate procedural collision fixtures and HQ tactical cover; no common furniture occupancy authority is consumed by both.'
  ]
};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--strict') && (doorMismatches.length || profiles.some(p=>p.directedMismatches) || report.unsupported.length)) process.exitCode=1;
