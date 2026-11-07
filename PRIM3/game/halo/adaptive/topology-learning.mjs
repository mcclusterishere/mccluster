// Versioned mathematical exercises. Coordinates are declared lattice coordinates,
// never opaque resolver node indices, navigable routes, AP, or combat evidence.
export const LEARNING_VARIANTS = Object.freeze({
 'generated': {title:'Generated side operation',href:null,frame:'generated signed display',topologies:['square']},
 'transit-relay': {title:'Transit / Relay',href:'prim3-transit.html?level=transit-relay',frame:'X=x−32, Y=31−y; +X east, +Y north; 3.54 m/tile',topologies:['square']},
 'equity-uprise-hq': {title:'Equity Uprise HQ',href:'prim3-transit.html?level=equity-uprise-hq',frame:'X=x−3, Y=8−y; +X east, +Y north; 3.54 m/tile',topologies:['square']},
 'equity-uprise-b1': {title:'Equity Uprise B1 · Restore the Picture',href:'prim3-transit.html?level=equity-uprise-b1&side=defend',frame:'X=x−3, Y=8−y; +X east, +Y north; 3.54 m/tile',topologies:['square']},
 'equity-uprise-b1-attack': {title:'Equity Uprise B1 · Blind the Floor',href:'prim3-transit.html?level=equity-uprise-b1&side=attack',frame:'X=x−3, Y=8−y; +X east, +Y north; 3.54 m/tile',topologies:['square']},
 'courtyard': {title:'Courtyard study',href:'demos/prim3-courtyard/index.html',frame:'X=x−4.5, Y=4.5−y; +X right, +Y up; display cells, no geographic anchor',topologies:['square']},
 'city': {title:'City street simulation',href:'prim3-city-tactics.html',frame:'bridgeport-golden-hill.enu.v1; +x east, +y up, +z south; street floor',topologies:['square','hex']}
});
export function learningContext(value) {
 if(!value||Object.keys(value).some(k=>!['version','variant','topology'].includes(k))||value.version!=='prim3.lattice-learning/v1'||!Object.hasOwn(LEARNING_VARIANTS,value.variant)||!LEARNING_VARIANTS[value.variant].topologies.includes(value.topology))throw Error('Unsupported learning context');
 return {version:value.version,variant:value.variant,topology:value.topology};
}
export function latticeQuestion(context,seed,ordinal,level) {
 const c=learningContext(context),n=ordinal+(seed%7),span=level+1;
 const a={q:level===1?n:-n,r:level===3?-span:span},b={q:a.q+span+(n%3),r:a.r+(n%2?span:-span)};
 const dq=b.q-a.q,dr=b.r-a.r;
 const expected=c.topology==='hex'?(Math.abs(dq)+Math.abs(dr)+Math.abs(dq+dr))/2:Math.abs(dq)+Math.abs(dr);
 const axes=c.topology==='hex'?'Pointy axial (q,r), s=−q−r. +q east; +r southeast. Radius 1.5 m; one neighbor edge is √3×1.5 m.':c.variant==='city'?'Square (q,r): +q east, +r south; 2 m per edge.':LEARNING_VARIANTS[c.variant].frame;
 return {expected,frame:axes,unit:'lattice steps',skill:c.topology==='hex'?'hex-axial-distance/v1':'square-cardinal-distance/v1',
  prompt:`${axes} On an unobstructed ${c.topology} practice lattice, find the minimum number of neighbor steps from (${a.q}, ${a.r}) to (${b.q}, ${b.r}). This is not a route through walls or an AP cost.`,
  hint:c.topology==='hex'?'Find Δq and Δr. Δs=−Δq−Δr. Add |Δq|+|Δr|+|Δs| and divide by 2.':'Only cardinal neighbors count. Add the absolute changes of the two coordinates.',
  feedback:c.topology==='hex'?`(|${dq}| + |${dr}| + |${-dq-dr}|) / 2 = ${expected} lattice steps.`:`|${dq}| + |${dr}| = ${expected} lattice steps.`};
}
