/* prim3-mission/1: a FICTIONAL PRIM3 mission draft written from one stored headline (docs/prim3/NEWS-TO-MISSION.md).
   Structural validation plus two deliberately simple safety checks. It is not semantic review: a valid draft is still
   a draft (status "draft", publication_authorized false) until a person reads it.

   HOW WEAK THE SAFETY CHECKS ARE. They catch the obvious cases only:
   - real person: a capitalised name pair copied out of the headline, or an honorific followed by a capitalised name
     ("President X", "Dr Y"). A real name that is not in the headline and has no title passes.
   - country or group as the enemy: any country name (every ISO 3166 region Intl knows) or a listed demonym/group word
     in the opposition, or such a word directly followed by forces/army/regime/government/... anywhere in the mission.
     Misspellings, other languages, unlisted groups, real company names and paraphrase all pass. */
const SCHEMA = 'prim3-mission/1';
const THEMES = ['power', 'comms', 'data', 'logistics', 'water', 'transport', 'finance', 'industrial'];
const KEYS = ['schema', 'title', 'codename', 'country', 'place_label', 'lat', 'lon', 'theme', 'briefing', 'objective', 't_task', 'e_task', 'r_task',
  'opposition', 'stakes', 'difficulty', 'clock_rounds', 'time_of_day', 'weather', 'layout', 'inspired_by', 'status', 'publication_authorized'];
const TEXT = { title: 60, codename: 40, place_label: 80, briefing: 600, objective: 160, t_task: 160, e_task: 160, r_task: 160, opposition: 120, stakes: 200 };
const ENUMS = { theme: THEMES, time_of_day: ['dawn', 'day', 'dusk', 'night'], weather: ['clear', 'rain', 'fog'], layout: ['compound', 'port', 'datacenter', 'rooftops', 'yard'] };

const HONORIFIC = /\b(?:President|Prime Minister|Premier|Chancellor|King|Queen|Prince|Princess|Senator|Sen\.|Governor|Gov\.|Minister|Secretary|Mayor|Pope|Sheikh|Ayatollah|General|Gen\.|Colonel|Judge|Justice|CEO|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Sir|Dame|Rep\.)\s+[A-Z][\p{L}'-]+/u;
const DEMONYMS = ['american', 'russian', 'chinese', 'ukrainian', 'iranian', 'israeli', 'palestinian', 'syrian', 'iraqi', 'afghan', 'pakistani', 'indian',
  'korean', 'north korean', 'japanese', 'turkish', 'kurdish', 'saudi', 'yemeni', 'lebanese', 'egyptian', 'libyan', 'sudanese', 'somali', 'ethiopian',
  'eritrean', 'nigerian', 'kenyan', 'congolese', 'rwandan', 'mexican', 'venezuelan', 'colombian', 'cuban', 'haitian', 'brazilian', 'british', 'french',
  'german', 'polish', 'serbian', 'albanian', 'taiwanese', 'vietnamese', 'filipino', 'burmese', 'rohingya', 'uyghur', 'tibetan', 'arab', 'persian',
  'jewish', 'muslim', 'christian', 'hindu', 'sikh', 'buddhist', 'catholic', 'sunni', 'shia', 'shiite', 'roma', 'african', 'asian', 'latino', 'hispanic',
  'european', 'indigenous', 'tribal', 'immigrant', 'migrant', 'refugee'];
const ENEMY_NOUN = '(?:forces?|army|armies|military|troops|soldiers|navy|regime|government|agents?|operatives?|spies|militias?|nationals?|people|cartel|mob|gangs?)';
let COUNTRY_NAMES = null;
function countryNames() {
  if (COUNTRY_NAMES) return COUNTRY_NAMES;
  const names = new Set(), display = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    try { const name = display.of(code); if (name && name !== code && !/unknown/i.test(name)) names.add(name.toLowerCase()); } catch { /* not a region */ }
  }
  for (const extra of ['usa', 'u.s.', 'america', 'uk', 'britain', 'great britain', 'england', 'russia', 'china', 'iran', 'north korea', 'south korea', 'gaza', 'west bank', 'taiwan', 'palestine'])
    names.add(extra);
  return (COUNTRY_NAMES = [...names]);
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, word) => new RegExp(`(?:^|[^\\p{L}])${escape(word)}(?:$|[^\\p{L}])`, 'iu').test(text);

/* Adjacent capitalised word pairs in the headline that are not the place it names or a country: the usual shape of a
   person's or an organisation's name. Title Case headlines make this noisy, which errs towards rejecting. */
function headlineNames(title, placeLabel) {
  const place = String(placeLabel || '').toLowerCase(), pairs = new Set();
  for (const run of String(title || '').match(/[A-Z][\p{Ll}'-]+(?:\s+[A-Z][\p{Ll}'-]+)+/gu) || []) {
    const words = run.split(/\s+/);
    for (let i = 0; i + 1 < words.length; i++) pairs.add(`${words[i]} ${words[i + 1]}`);
  }
  return [...pairs].filter((p) => !place.includes(p.toLowerCase()) && !countryNames().includes(p.toLowerCase()));
}

export function validatePrim3Mission(analysis, evidence, targetId) {
  const reject = (reason) => { throw Object.assign(new Error(`prim3_mission_invalid: ${reason}`), { retryable: false }); };
  const h = evidence?.headline;
  if (!h || typeof h !== 'object' || String(h.article_id || '').toLowerCase() !== String(targetId || '').toLowerCase()) reject('evidence does not match the job target');
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) reject('object required');
  const base = { schema: SCHEMA, schema_valid: true, publication_authorized: false, safety_checks: 'heuristic_only', support_status: 'requires_human_review' };

  if ('refused' in analysis) {
    if (Object.keys(analysis).sort().join(',') !== 'reason,refused' || analysis.refused !== true) reject('refusal must be exactly {refused: true, reason}');
    if (typeof analysis.reason !== 'string' || !analysis.reason.trim() || analysis.reason.length > 300) reject('refusal reason required (max 300)');
    return { ...base, outcome: 'refused' };
  }

  const unknown = Object.keys(analysis).filter((k) => !KEYS.includes(k));
  if (unknown.length) reject(`unknown keys: ${unknown.slice(0, 5).join(', ')}`);
  const missing = KEYS.filter((k) => !(k in analysis));
  if (missing.length) reject(`missing keys: ${missing.slice(0, 5).join(', ')}`);
  if (analysis.schema !== SCHEMA) reject('wrong schema');
  if (analysis.status !== 'draft' || analysis.publication_authorized !== false) reject('a mission is always an unpublished draft');
  for (const [key, max] of Object.entries(TEXT)) {
    const v = analysis[key];
    if (typeof v !== 'string' || !v.trim() || /[\u0000-\u001f\u007f]/.test(v)) reject(`invalid ${key}`);
    if (v.length > max) reject(`${key} longer than ${max}`);
  }
  for (const [key, allowed] of Object.entries(ENUMS)) if (!allowed.includes(analysis[key])) reject(`invalid ${key}`);
  if (!Number.isInteger(analysis.difficulty) || analysis.difficulty < 1 || analysis.difficulty > 5) reject('difficulty must be an integer 1-5');
  if (!Number.isInteger(analysis.clock_rounds) || analysis.clock_rounds < 8 || analysis.clock_rounds > 20) reject('clock_rounds must be an integer 8-20');
  const sentences = (analysis.briefing.match(/[.!?](?=\s|$)/g) || []).length;
  if (sentences < 2 || sentences > 4) reject('briefing must be 2-4 sentences');

  // Place and provenance come from the stored headline, never from the model.
  if (analysis.country !== h.country) reject('country must be the headline country');
  for (const axis of ['lat', 'lon']) {
    const want = h[axis], got = analysis[axis];
    if (want === null || want === undefined ? got !== null : !(typeof got === 'number' && Math.abs(got - want) <= 0.01)) reject(`${axis} must be the headline ${axis}`);
  }
  const ib = analysis.inspired_by;
  if (!ib || typeof ib !== 'object' || Array.isArray(ib)) reject('inspired_by required');
  if (Object.keys(ib).sort().join(',') !== 'domain,title,url') reject('inspired_by must be exactly {title, url, domain}');
  if (ib.title !== h.title || ib.url !== h.url || ib.domain !== h.domain) reject('inspired_by must copy the stored headline');

  // Heuristic safety checks (see the header for what they miss).
  const story = KEYS.filter((k) => k in TEXT && k !== 'place_label').map((k) => analysis[k]).join('\n');
  if (HONORIFIC.test(story)) reject('names a real person (title + name)');
  const names = headlineNames(h.title, h.place_label);
  const named = names.find((n) => mentions(story, n));
  if (named) reject('names a person or organisation from the headline');
  const opposition = analysis.opposition;
  const enemyWord = [...countryNames(), ...DEMONYMS].find((w) => mentions(opposition, w));
  if (enemyWord) reject('opposition names a real country or group');
  const enemyPhrase = [...countryNames(), ...DEMONYMS].find((w) => new RegExp(`(?:^|[^\\p{L}])${escape(w)}\\s+${ENEMY_NOUN}\\b`, 'iu').test(story));
  if (enemyPhrase) reject('treats a real country or group as a hostile force');

  return { ...base, outcome: 'mission' };
}
