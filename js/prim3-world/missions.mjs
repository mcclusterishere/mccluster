/* PRIM3 World: the mission records (data/prim3/world-missions.json) and the checks the World builder runs on them.
   Pure functions only: no DOM, no network, so node --test runs them as they run in the page. */

export const DATA_URL = 'data/prim3/world-missions.json';
export const DRAFT_KEY = 'prim3.world.drafts.v1';
export const REGIONS = Object.freeze(['Americas', 'Europe', 'Africa', 'Middle East', 'Asia', 'Oceania']);
export const DIFFICULTIES = Object.freeze(['standard', 'hard', 'severe']);
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const LEVELS_FALLBACK = Object.freeze([{ id: 'transit-relay', title: 'Transit / Relay', page: 'prim3-transit.html' }]);

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function levelsOf(doc) {
  return Array.isArray(doc && doc.levels) && doc.levels.length ? doc.levels : LEVELS_FALLBACK;
}
export function castOf(doc) {
  return Array.isArray(doc && doc.cast) ? doc.cast.slice().sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
}
/* the nations of the 24 mains: each needs at least one mission */
export function castNations(doc) {
  const seen = new Map();
  for (const c of castOf(doc)) if (c && c.main && c.country && text(c.country.code) && !seen.has(c.country.code)) seen.set(c.country.code, c.country.name);
  return [...seen].map(([code, name]) => ({ code, name }));
}
export function missionsIn(doc, region) {
  const list = Array.isArray(doc && doc.missions) ? doc.missions : [];
  return region && region !== 'All' ? list.filter((m) => m.region === region) : list.slice();
}
export function findMission(doc, id) {
  return (Array.isArray(doc && doc.missions) ? doc.missions : []).find((m) => m && m.id === id) || null;
}
export function deployHref(m) {
  return 'prim3-transit.html?mission=' + encodeURIComponent(m.id) + '&new=1';
}

/* One record's problems, as short sentences the builder shows next to the record. */
export function missionErrors(m, doc) {
  const e = [];
  if (!m || typeof m !== 'object') return ['Not a mission record.'];
  if (!text(m.id)) e.push('Id is required.');
  else if (!ID_PATTERN.test(m.id)) e.push('Id must be lowercase letters, numbers and dashes.');
  if (!m.country || !/^[A-Z]{2}$/.test(m.country.code || '')) e.push('Country needs a two-letter ISO code.');
  if (!m.country || !text(m.country.name)) e.push('Country needs a name.');
  if (!REGIONS.includes(m.region)) e.push('Region must be one of ' + REGIONS.join(', ') + '.');
  if (!num(m.lat) || m.lat < -90 || m.lat > 90) e.push('Latitude must be between -90 and 90.');
  if (!num(m.lon) || m.lon < -180 || m.lon > 180) e.push('Longitude must be between -180 and 180.');
  if (!m.character || !text(m.character.name)) e.push('Character is required.');
  if (!m.character || !text(m.character.role)) e.push('Character role is required.');
  if (!text(m.title)) e.push('Title is required.');
  if (!text(m.briefing)) e.push('Briefing is required.');
  if (!text(m.objective)) e.push('Objective is required.');
  if (!levelsOf(doc).some((l) => l.id === m.level)) e.push('Level must be a playable level.');
  if (!DIFFICULTIES.includes(m.difficulty)) e.push('Difficulty must be ' + DIFFICULTIES.join(', ') + '.');
  if (m.status !== 'draft') e.push('Status stays "draft" until the owner promotes it.');
  if (m.side_operation !== true) e.push('Side operation must stay true: World missions are non-canon side operations.');
  if (!Array.isArray(m.sources) || !m.sources.length) e.push('Cite at least one canon source.');
  else if (m.sources.some((s) => !s || !text(s.file) || !text(s.section))) e.push('Every source needs a file and a section.');
  return e;
}

/* The whole set: every record, unique ids, and one mission at least per cast nation. */
export function validate(doc) {
  const list = Array.isArray(doc && doc.missions) ? doc.missions : [];
  const records = {}, general = [];
  const ids = new Map();
  list.forEach((m, i) => {
    const errs = missionErrors(m, doc);
    const key = m && text(m.id) ? m.id : '#' + (i + 1);
    if (m && text(m.id)) {
      if (ids.has(m.id)) errs.push('Id "' + m.id + '" is used more than once.');
      ids.set(m.id, (ids.get(m.id) || 0) + 1);
    }
    if (errs.length) records[key] = (records[key] || []).concat(errs);
  });
  const covered = new Set(list.map((m) => m && m.country && m.country.code));
  for (const n of castNations(doc)) if (!covered.has(n.code)) general.push('No mission yet for ' + n.name + ' (' + n.code + ').');
  if (!list.length) general.push('There are no missions.');
  const count = Object.values(records).reduce((a, r) => a + r.length, 0) + general.length;
  return { ok: count === 0, count, records, general };
}

export function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
export function uniqueId(doc, base) {
  const used = new Set((doc.missions || []).map((m) => m.id));
  const root = slug(base) || 'mission';
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) if (!used.has(root + '-' + i)) return root + '-' + i;
}
/* a new, deliberately incomplete record for the builder: the checks say what is still missing */
export function blankMission(doc, cast) {
  const c = cast || castOf(doc)[0] || { name: '', role: '', country: { code: 'US', name: 'United States' } };
  return {
    id: uniqueId(doc, c.country.code + '-new-mission'),
    featured: false,
    status: 'draft',
    side_operation: true,
    country: { code: c.country.code, name: c.country.name },
    region: regionFor(doc, c.country.code) || 'Americas',
    place: '',
    lat: 0,
    lon: 0,
    character: { name: c.name, role: c.role },
    title: '',
    briefing: '',
    objective: '',
    level: levelsOf(doc)[0].id,
    difficulty: 'standard',
    canon_depth: 'background',
    note: '',
    sources: []
  };
}
export function regionFor(doc, code) {
  const m = (doc.missions || []).find((x) => x.country && x.country.code === code);
  return m ? m.region : null;
}

/* Import: a file must look like this document before it replaces the working set. */
export function parseImport(raw) {
  let doc;
  try { doc = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return { ok: false, error: 'That file is not JSON.' }; }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.missions)) return { ok: false, error: 'That file has no "missions" list.' };
  if (doc.schema && doc.schema !== 'prim3.world-missions/v1') return { ok: false, error: 'Unknown schema "' + doc.schema + '".' };
  return { ok: true, doc };
}
export function exportText(doc) {
  return JSON.stringify({ ...doc, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n';
}
