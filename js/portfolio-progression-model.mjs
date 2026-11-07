// Pure projection shared by the Worker and the review UI. XP is motivation, never credit or mastery.
export const STATES = ['planned', 'in_progress', 'self_reported'];
const bad = message => { throw Object.assign(new Error(message), {status:400}); };
export function cleanDraft(input, catalog, roles) {
  if (!input || !Array.isArray(input.courses) || input.courses.length !== catalog.courses.length) bad('All eight course slots are required');
  const seen = new Set();
  const courses = input.courses.map(c => {
    if (!c || !catalog.courses.some(x => x.id === c.id) || seen.has(c.id)) bad('Unknown or duplicate course');
    seen.add(c.id);
    if (!STATES.includes(c.status) || typeof c.visible !== 'boolean') bad('Invalid course state');
    // No arbitrary URLs, documents, personal identifiers, verification flags or XP accepted.
    return {id:c.id, status:c.status, visible:c.visible};
  });
  const experience = input.experience || [];
  if (!Array.isArray(experience) || experience.length > 30) bad('Too many experience intervals');
  return {courses, experience:experience.map(e => {
    if (!e || !roles.roles.some(r => r.slug === e.role)) bad('Choose an existing résumé role');
    for (const key of ['start','end']) if (!/^\d{4}-\d{2}-\d{2}$/.test(e[key] || '') || !Number.isFinite(Date.parse(e[key])) || new Date(e[key]).toISOString().slice(0,10) !== e[key]) bad('Use valid exact dates');
    if (e.end < e.start || e.end > new Date().toISOString().slice(0,10)) bad('Dates must be ordered and not in the future');
    if (typeof e.visible !== 'boolean') bad('Choose experience visibility');
    return {role:e.role,start:e.start,end:e.end,visible:e.visible};
  })};
}
export function initialDraft(catalog) {
  return {courses:catalog.courses.map(c=>({id:c.id,status:'planned',visible:false})),experience:[]};
}
export function experienceYears(intervals) {
  const merged = [];
  for (const [start,end] of intervals.map(e=>[Date.parse(e.start),Date.parse(e.end)]).sort((a,b)=>a[0]-b[0])) {
    const last=merged.at(-1);
    if (last && start <= last[1]) last[1]=Math.max(last[1],end); else merged.push([start,end]);
  }
  return Math.floor(merged.reduce((n,[a,b])=>n+b-a,0)/86400000/365.2425*10)/10;
}
export function project(draft, catalog, roles, credentials=[], {publicOnly=false}={}) {
  const courses = draft.courses.filter(c=>!publicOnly || c.visible).map(c=>{
    const def=catalog.courses.find(x=>x.id===c.id);
    // Trusted server reads only. A prep completion never becomes an exam pass or accepted credit.
    const verified=credentials.some(e=>e.external_program==='CLEP' && e.issuer==='College Board' && e.title===def.title && !c.id.startsWith('prep-') && e.verification_status==='reviewer_verified' && e.verified_by && e.verified_by!==e.user_id && e.verified_at);
    return {...def,status:c.status,exam:verified?'verified':'not_recorded',xp:(c.status==='self_reported'?25:0)+(verified?100:0)};
  });
  const intervals=draft.experience.filter(e=>!publicOnly || e.visible);
  const experience=intervals.map(e=>({...e,title:roles.roles.find(r=>r.slug===e.role).title,status:'self_reported'}));
  const xp=courses.reduce((n,c)=>n+c.xp,0);
  return {version:1,name:catalog.name,goals:catalog.goals,courses,experience,years:experienceYears(intervals),xp,level:1+Math.floor(xp/100),next:100-xp%100,
    stats:[...new Set(catalog.courses.map(c=>c.stat))].map(label=>({label,xp:courses.filter(c=>c.stat===label).reduce((n,c)=>n+c.xp,0)})),
    credits:null,rule:'25 XP per self-reported project; 100 XP per reviewer-verified exam. No academic credit is inferred.'};
}
