// CANON: owner chronology decision 2026-11-09. IDs and completion authority do not move.
export const CHRONOLOGY_VERSION='prim3.semesters/v2';
export const STAGES=['opening','midterms','finals'];
export const SEMESTERS=Array.from({length:7},(_,i)=>({season:i+1,semester:i+1,term:i%2?'Spring':'Fall',year:2026+Math.ceil(i/2),break:i%2?'summer':'winter',breakId:`BREAK-S${String(i+1).padStart(2,'0')}`,breakStatus:'unreleased'}));
export function episodeTerm(globalEpisode){
 if(!Number.isInteger(globalEpisode)||globalEpisode<1||globalEpisode>21)throw Error('Unknown core episode');
 const semester=SEMESTERS[Math.floor((globalEpisode-1)/3)],slot=(globalEpisode-1)%3;
 return {...semester,globalEpisode,episodeId:`S${String(semester.season).padStart(2,'0')}E${String(slot+1).padStart(2,'0')}`,stage:STAGES[slot],required:true,chronologyVersion:CHRONOLOGY_VERSION,
   narrativeTiming:globalEpisode>=19?'semester-frame/convergent-finals-operation':globalEpisode===1?'opening-frame/finals-2029-flash-forward':'semester-frame'};
}
// Metadata-only identity migration. Keep unknown fields, IDs, scores and completion timestamps.
// A future version fails closed. The caller retains the source save until successful persistence.
export function migrateProgress(saved={}){
 if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Invalid progression save');
 if(saved.chronologyVersion&&saved.chronologyVersion!==CHRONOLOGY_VERSION)throw Error('Unsupported chronology version');
 return {...structuredClone(saved),chronologyVersion:CHRONOLOGY_VERSION};
}
export function semesterProgress(completedEpisodeIds,season){
 const term=SEMESTERS[season-1];if(!term)throw Error('Unknown semester');const done=new Set(completedEpisodeIds);
 const episodes=[1,2,3].map(slot=>episodeTerm((season-1)*3+slot));
 return {...term,episodes:episodes.map(e=>({...e,complete:done.has(e.episodeId)})),complete:episodes.every(e=>done.has(e.episodeId)),breakIsCoreEpisode:false};
}
