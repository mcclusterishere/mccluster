// Run only in the isolated combination with City #748 da0b411b. No copied graph or fallback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {legacyToLocal,localToLegacy} from '../../js/spatial/metric-frame.mjs';
import {routeToEntrance,clearEdge} from '../../js/spatial/region-graph.mjs';
import {STREET_STOPS} from '../../js/city-arcade/sole-config.mjs';
import {sharedStopId,sharedClosures} from '../../js/city-arcade/sole-spatial.mjs';
const region=JSON.parse(await readFile(new URL('../../data/spatial/bridgeport-downtown.v2.json',import.meta.url)));
assert.equal(region.contract.id,'bridgeport-downtown.v2');assert.equal(region.contract.revision,2);
for(const stop of STREET_STOPS){const source=region.contract.entrances.find(e=>e.id===sharedStopId(stop.id));assert.equal(source.alias,stop.id);assert.deepEqual(source.legacy.point,stop.point);const p={x:stop.point[0],y:0,z:stop.point[1]},round=localToLegacy(region.contract,legacyToLocal(region.contract,p));assert.ok(Math.hypot(round.x-p.x,round.z-p.z)<.001);}
for(const topology of ['hex','square']){
 const entrance=id=>region.graphs[topology].entrances.find(e=>e.id===sharedStopId(id));let position=entrance('main-golden-hill').position,costM=0;
 for(const stop of STREET_STOPS){const path=routeToEntrance(region,topology,position,sharedStopId(stop.id));assert.ok(path);assert.deepEqual(path.points.at(-1),entrance(stop.id).position);for(let i=1;i<path.points.length;i++)assert.ok(clearEdge(region,path.points[i-1],path.points[i]));costM+=path.costM;position=path.points.at(-1);}
 const closed=sharedClosures(['bridgeport-osm-186839735-0']);assert.equal(routeToEntrance(region,topology,entrance('main-golden-hill').position,sharedStopId('main-elm'),{closedRoadIds:closed}),null);assert.ok(routeToEntrance(region,topology,entrance('main-golden-hill').position,sharedStopId('main-elm'),{closedRoadIds:[]}));
 console.log(JSON.stringify({topology,fiveStops:true,exactConnectors:true,sweptClear:true,legacyRoundtripBelow1mm:true,wholeWayClosureBlocks:true,reopenRestores:true,costM}));
}
