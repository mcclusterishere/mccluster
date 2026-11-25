import {validateSoleMission} from './sole-config.mjs';
import { validateTeaMission } from './tea-config.mjs';
export const GAME_ID = 'gauranfucking-tea-tea-rush';
export const LOCATIONS = Object.freeze([
  { id:'bridgeport-main-elm', name:'Main Street & Elm Street', roadId:'bridgeport-osm-186839735-0', point:[51.1422,-253.0175] },
  { id:'bridgeport-main-golden-hill', name:'Main Street & Golden Hill Street', roadId:'bridgeport-osm-186839735-0', point:[42.7721,-296.0761] }
]);
// Location points are existing road vertices, not invented storefront parcels.
export function missionKey(gameId,locationId){return (gameId==='designer-kicks-sole-run'?'sole-':'')+locationId;}
export function knownMissionKey(id){return LOCATIONS.some(p=>id===p.id||id==='sole-'+p.id);}
export function validateMission(m) {
  if(!m || m.version!==1 || ![GAME_ID,'designer-kicks-sole-run'].includes(m.gameId) || !LOCATIONS.some(p=>p.id===m.locationId))throw Error('Invalid arcade mission');
  const field=m.gameId===GAME_ID?'tea':'sole';
  if(Object.keys(m).some(k=>!['version','gameId','locationId',field].includes(k)))throw Error('Unknown mission field');
  return {version:1,gameId:m.gameId,locationId:m.locationId,[field]:field==='tea'?validateTeaMission(m.tea):validateSoleMission(m.sole)};
}
export function locationCoordinates(location, geography) {
  const [lon0,lat0]=geography.geographicOrigin,[ox,oz]=geography.worldOffsetXZ,[x,z]=location.point;
  return [lon0+(x-ox)/(111320*Math.cos(lat0*Math.PI/180)),lat0-(z-oz)/111320];
}
