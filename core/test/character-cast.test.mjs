import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCast, loadManifest, validateCast, sourceCharacters, characterById, characterBySource, personaCard, postingRoster, minorNames } from '../src/characters/cast.mjs';
import { PRIM3_AGENTS } from '../src/prim3/agents.mjs';

/* Stable ids: the game and MNET address characters by these. Adding is fine;
   renaming or removing one breaks saved state and live profiles, so it fails here. */
const STABLE_IDS = Object.freeze([
  'prim3-aya-shinoda', 'prim3-arjun-mehta', 'prim3-li-wei', 'prim3-sari-wulandari', 'prim3-hassan-raza',
  'prim3-chioma-okeke', 'prim3-rafael-costa', 'prim3-nusrat-rahman', 'prim3-dmitri-volkov', 'prim3-oksana-bondarenko',
  'prim3-yonas-bekele', 'prim3-valeria-soto', 'prim3-amira-hassan', 'prim3-miguel-santos', 'prim3-grace-mbala',
  'prim3-minh-tran', 'prim3-leila-hosseini', 'prim3-emre-yildiz', 'prim3-jonas-weber', 'prim3-priya-srisawat',
  'prim3-helen-clarke', 'prim3-marc-dubois', 'prim3-thandiwe-nkosi', 'prim3-hana-lee', 'mara-costa', 'lin-qiao',
  'eli-mensah', 'nadia-vale', 'tasha-bell', 'ren-okafor', 'mike-hawk', 'ada-reyes', 'noah-bennett', 'june-park',
  'leo-mercer', 'samira-diallo', 'vik-rao', 'marisol-vega', 'owen-price', 'zofia-nowak', 'cleo-baptiste', 'kwame-addo',
  'darnell-brooks', 'priya-nair', 'hugo-soto', 'amina-noor', 'tomas-silva', 'beatrice-cole', 'mccluster', 'majid',
  'gunny', 'gordon-pfeiffer', 'todd-brenneman', 'derek-vollmer', 'gary-babbitt', 'brett-sorensen', 'logan-pemberton',
  'hunter-gustafson', 'marty-feldstein', 'nour-haddad', 'chad-ledger', 'odessa-pike', 'winthrop-ashcroft-pell',
  'skyler-moonbeam-katz', 'bryce-lundqvist', 'lorraine-abernathy', 'rosa-delgado', 'margaux-vanderhoff',
  'frank-mulrooney', 'dale-pruitt', 'brenda-szabo', 'ray-fitch', 'sami-haddad', 'gus-pappas', 'tobias-lund',
  'whitney-crane', 'raymond-dupree', 'gloria-benitez', 'neil-faraday', 'lou-baranski', 'dante-moreau', 'earl-pickens',
  'norma-klein', 'patti-larkin', 'kayleigh-spurlock', 'ainsley-whitmore-sterling', 'hollis-ashby', 'pierce-vanderhoff',
  'ignacio-delgado', 'tammy-pruitt', 'linda-babbitt', 'curtis-abernathy', 'brittany-ledger', 'peg-mulrooney',
  'leila-haddad', 'robbery-dave', 'robbery-harold', 'robbery-mama', 'robbery-ocho-gr8', 'robbery-low-ski',
  'robbery-og', 'robbery-shopkeeper', 'robbery-pastor', 'regular-walt-ferreira', 'regular-dee-harmon',
  'regular-marcus-tellez', 'regular-cilla-banks', 'regular-benny-lazar', 'regular-joanne-petrakis',
]);

const cast = loadCast();
const manifest = loadManifest();
const clone = () => JSON.parse(JSON.stringify(cast));

test('the cast passes its own review gate', () => {
  assert.deepEqual(validateCast(cast, { manifest }), []);
});

test('every adult source character has a profile; counts by source', () => {
  const by = {};
  for (const c of cast.characters) by[c.source.kind] = (by[c.source.kind] || 0) + 1;
  assert.deepEqual(by, { 'prim3.agent': 24, 'fictional-city.npc': 24, 'fictional-city.garageCrew': 3, 'fictional-city.expansionNpc': 44, 'fictional-city.storyArcCast': 8, 'mnet-cast.regular': 6 });
  assert.equal(PRIM3_AGENTS.length, 24);
  for (const s of sourceCharacters(manifest)) if (!s.minor) assert.ok(characterById(s.id), `missing ${s.id}`);
  assert.equal(characterBySource('prim3.agent', 'aya-shinoda').id, 'prim3-aya-shinoda');
  assert.equal(characterBySource('fictional-city.npc', 'mara-costa').name, 'Mara Costa');
});

test('minors get no profile: the five flagged students and the 16-18 story teens', () => {
  const minors = sourceCharacters(manifest).filter(s => s.minor).map(s => s.id).sort();
  assert.deepEqual(minors, ['graham-vanderhoff', 'imani-abernathy', 'kensington-ashby', 'mateo-delgado', 'robbery-kiara', 'robbery-malik', 'tucker-whitmore-sterling']);
  assert.deepEqual([...cast.excludedMinors].sort(), minors);
  for (const id of minors) assert.equal(characterById(id), null);
  assert.ok(cast.characters.every(c => c.adult === true && !(Number.isFinite(c.age) && c.age < 18)));
  assert.equal(manifest.expansionNpcs.filter(n => n.minor).length, 5);
});

test('ids are stable and handles follow them', () => {
  const ids = new Set(cast.characters.map(c => c.id));
  for (const id of STABLE_IDS) assert.ok(ids.has(id), `stable id removed or renamed: ${id}`);
  for (const c of cast.characters) {
    assert.equal(c.mnet.actorKey, `chr.${c.id}`);
    assert.equal(c.mnet.handle, c.mnet.actorKey);
    assert.ok(c.mnet.actorKey.length <= 40);
    if (c.source.kind !== 'mnet-cast.regular') assert.equal(c.source.ref, c.id.replace(/^prim3-/, c.source.kind === 'prim3.agent' ? '' : 'prim3-'));
  }
});

test('the gate catches what review must catch', () => {
  const withMinor = clone();
  withMinor.characters.push({ ...withMinor.characters.find(c => c.id === 'mara-costa'), id: 'imani-abernathy', name: 'Imani Abernathy', age: 16, source: { kind: 'fictional-city.expansionNpc', ref: 'imani-abernathy' }, mnet: { ...withMinor.characters[0].mnet, actorKey: 'chr.imani-abernathy', handle: 'chr.imani-abernathy' } });
  assert.ok(validateCast(withMinor, { manifest }).some(e => /minor/.test(e)));

  const missing = clone(); missing.characters = missing.characters.filter(c => c.id !== 'gloria-benitez');
  assert.ok(validateCast(missing, { manifest }).some(e => e.startsWith('gloria-benitez: source character not covered')));

  const drift = clone(); drift.characters.find(c => c.id === 'lin-qiao').name = 'Lin Q.';
  assert.ok(validateCast(drift, { manifest }).some(e => /name differs from source/.test(e)));

  const aged = clone(); aged.characters.find(c => c.id === 'nour-haddad').age = 22;
  assert.ok(validateCast(aged, { manifest }).some(e => /age differs/.test(e)));

  const model = clone(); model.characters[0].psych.humor = 'Talks like a Llama 3 prompt.';
  assert.ok(validateCast(model, { manifest }).some(e => /AI model name/.test(e)));

  const real = clone(); real.characters[0].psych.relationships.push({ id: 'mara-costa', note: 'once met Elon Musk' });
  assert.ok(validateCast(real, { manifest }).some(e => /real public figure/.test(e)));

  const dup = clone(); dup.characters.push(dup.characters[3]);
  assert.ok(validateCast(dup, { manifest }).some(e => /duplicate id/.test(e)));

  const loud = clone(); loud.characters[0].mnet.cadence.postsPerDay = 5;
  assert.ok(validateCast(loud, { manifest }).some(e => /postsPerDay/.test(e)));

  const held = clone(); delete held.characters.find(c => c.id === 'majid').mnet.heldReason;
  assert.ok(validateCast(held, { manifest }).some(e => /heldReason/.test(e)));
});

test('every profile is a full psychology, with relationships that resolve', () => {
  for (const c of cast.characters) {
    for (const key of ['temperament', 'humor', 'dailyRoutine', 'newsReaction', 'voiceSample']) assert.ok(c.psych[key].length > 3, `${c.id}.${key}`);
    for (const key of ['values', 'fears', 'wants', 'contradictions', 'speech', 'triggers', 'postsAbout', 'neverTalksAbout']) assert.ok(c.psych[key].length >= 1, `${c.id}.${key}`);
    assert.doesNotMatch(JSON.stringify(c.psych.speech), /accent|dialect spelling/i, 'speech habits, never phonetic accents');
  }
  const card = personaCard(characterById('eli-mensah'), cast);
  assert.ok(card.knows.some(k => k.startsWith('Mara Costa:')));
  assert.equal(JSON.stringify(card).includes('backstory'), false, 'prompts carry psychology, not the whole source bio');
});

test('held characters: the Whip garage crew and the two story bosses', () => {
  const held = cast.characters.filter(c => c.mnet.posting === 'held').map(c => c.id).sort();
  assert.deepEqual(held, ['gunny', 'majid', 'mccluster', 'robbery-harold', 'robbery-ocho-gr8']);
  assert.equal(postingRoster(cast).length, 104);
  assert.ok(postingRoster(cast).every(c => c.mnet.posting === 'eligible'));
});

test('minor names are on the post block-list', () => {
  const names = minorNames(manifest);
  for (const n of ['Imani', 'Mateo', 'Tucker', 'Malik', 'Kiara']) assert.ok(names.includes(n), n);
});
