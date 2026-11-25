// Bounded arcade locomotion on shared city road data, not a replacement city/world engine.
export const STREET_STOPS=Object.freeze([
 {id:'main-elm',point:[51.1422,-253.0175],roadId:'bridgeport-osm-186839735-0'},
 {id:'main-fairfield',point:[72.3313,-157.594],roadId:'bridgeport-osm-186839735-0'},
 {id:'middle-golden-hill',point:[113.8801,-311.9281],roadId:'bridgeport-osm-10180837-0'},
 {id:'main-golden-hill',point:[42.7721,-296.0761],roadId:'bridgeport-osm-186839735-0'},
 {id:'main-south',point:[70.8148,-164.4736],roadId:'bridgeport-osm-186839735-0'}
]);
export const SOLE_MISSION=Object.freeze({version:1,duration:150,speed:15,reward:100,
 route:['main-elm','main-fairfield','middle-golden-hill','main-golden-hill'],blockedRoads:[],
 encounters:[{id:'replica-courier',stopId:'main-south',name:'Replica courier',clues:['Both shoes are labelled LEFT.','The laces are neon.'],evidence:0,
 roast:'Two left shoes? Your outfit has turned every corner except the right one.',reward:75,penaltySeconds:8}]});
export function validateSoleMission(m){
 if(!m||m.version!==1||Object.keys(m).some(k=>!['version','duration','speed','reward','route','blockedRoads','encounters'].includes(k)))throw Error('Invalid Sole mission');
 for(const [k,lo,hi]of [['duration',45,300],['speed',5,25],['reward',0,500]])if(!Number.isFinite(m[k])||m[k]<lo||m[k]>hi)throw Error('Invalid '+k);
 if(!Array.isArray(m.route)||m.route.length!==4||m.route.some(id=>!STREET_STOPS.some(p=>p.id===id))||new Set(m.route).size!==4)throw Error('Choose four distinct street checkpoints');
 if(!Array.isArray(m.blockedRoads)||m.blockedRoads.length>4||m.blockedRoads.some(id=>typeof id!=='string'||!/^bridgeport-osm-\d+-\d+$/.test(id)))throw Error('Invalid closed roads');
 if(!Array.isArray(m.encounters)||m.encounters.length>3)throw Error('At most three fashion encounters');
 const ids=new Set();for(const e of m.encounters){
  if(!e||typeof e.id!=='string'||!/^[-a-z0-9]{1,40}$/.test(e.id)||ids.has(e.id)||!STREET_STOPS.some(p=>p.id===e.stopId))throw Error('Invalid encounter identity or placement');ids.add(e.id);
  if(typeof e.name!=='string'||e.name.length<1||e.name.length>60||typeof e.roast!=='string'||e.roast.length<1||e.roast.length>200)throw Error('Invalid encounter text');
  if(!Array.isArray(e.clues)||e.clues.length!==2||e.clues.some(c=>typeof c!=='string'||!c.length||c.length>120)||![0,1].includes(e.evidence))throw Error('Two clues and one evidence index required');
  if(!Number.isInteger(e.reward)||e.reward<0||e.reward>500||!Number.isInteger(e.penaltySeconds)||e.penaltySeconds<0||e.penaltySeconds>15)throw Error('Invalid encounter reward or consequence');
 }
 return structuredClone(m);
}
