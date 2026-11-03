/* Molecule Rush: the pure engine. No DOM, no storage, no clock of its own, so scripts/test/game-hub.test.mjs can run
   every rule. The study content is Chem-108's own (js/game-hub/chem108/data/, pinned in SOURCE.json); the alias, review
   and choice rules below are ports of Chem-108's dist/core.js, held to the vendored original by the tests. */

/* ---- ported from Chem-108 dist/core.js (same semantics; `now` and `rand` are injectable for tests) ---- */
export const norm = (s) => String(s).toLowerCase().trim().replace(/[–−—]/g, '-').replace(/\s+/g, ' ').replace(/\s*([,-])\s*/g, '$1');
export function accepted(item, value) { return [item.name, ...(item.aliases || [])].some((n) => norm(n) === norm(value)); }
export function update(old, ok, now = Date.now()) {
  const streak = ok ? (old?.streak || 0) + 1 : 0;
  return { seen: (old?.seen || 0) + 1, correct: (old?.correct || 0) + (ok ? 1 : 0), streak, due: now + (ok ? [600000, 86400000, 259200000, 604800000][Math.min(streak - 1, 3)] : 60000) };
}
export function shuffle(items, rand = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function choose(items, records, last, now = Date.now()) {
  let pool = items.filter((x) => x.id !== last);
  if (!pool.length) pool = items;
  const rank = (p) => (!p ? 1 : p.due <= now ? 0 : 2);
  return [...pool].sort((a, b) => { const pa = records[a.id], pb = records[b.id]; return rank(pa) - rank(pb) || (pa?.due || 0) - (pb?.due || 0); })[0];
}

/* ---- the catalogue: Chem-108's topics and questions, assembled the way its dist/app.js does ---- */
export function buildCatalog(data, extra) {
  const topics = [...extra.decks.slice(0, 7), ...data.decks, ...extra.decks.slice(7)]
    .map((d, i) => ({ id: d.id, title: d.title, number: String(i + 1).padStart(2, '0') }));
  const cards = [...data.cards, ...extra.cards].map((c) => ({ id: c.id, deck: c.deck, prompt: c.prompt, name: c.answer, aliases: c.aliases || [], explain: c.explain, symbol: c.symbol }));
  const molecules = data.molecules.map((m) => ({ id: m.id, deck: m.deck, prompt: 'Name this molecular structure.', name: m.name, aliases: m.aliases || [], explain: m.explain, formula: m.formula, svg: m.svg }));
  const elementCards = new Map(extra.cards.filter((c) => /^element-\d+$/.test(c.id)).map((c) => [Number(c.id.slice(8)), c]));
  const elements = extra.elements.map((e) => {
    const card = elementCards.get(e.z);
    return { z: e.z, symbol: e.symbol, name: e.name, aliases: card ? card.aliases || [] : [], deck: card ? card.deck : (e.z <= 20 ? 'elements20' : 'elements'), family: e.family, explain: card ? card.explain : '' };
  });
  return { topics, cards, molecules, elements, topic: (id) => topics.find((t) => t.id === id) };
}

/* ---- Spot the Group: the functional-group family of each structure Chem-108 draws for its groups deck (plus its two
   haloalkanes). The family follows from the name's ending or prefix as Chem-108's own groups cards teach it. ---- */
export const FAMILIES = {
  alcohol: { label: 'Alcohol', rule: '–OH on a saturated carbon: the name ends in -ol.' },
  aldehyde: { label: 'Aldehyde', rule: 'C=O with a hydrogen on the carbonyl carbon (–CHO): the name ends in -al.' },
  ketone: { label: 'Ketone', rule: 'C=O with carbon groups on both sides: the name ends in -one.' },
  acid: { label: 'Carboxylic acid', rule: '–COOH: the name ends in -oic acid, and that carbon is C1.' },
  ester: { label: 'Ester', rule: 'R–C(=O)–O–R: the oxygen continues to another carbon group; the name ends in -oate.' },
  ether: { label: 'Ether', rule: 'R–O–R, oxygen between two carbon groups: named as an alkoxy substituent (methoxy-).' },
  amine: { label: 'Amine', rule: 'N bonded to carbon, with no carbonyl on that carbon: the name ends in -amine.' },
  amide: { label: 'Amide', rule: 'N directly on a carbonyl carbon: the name ends in -amide.' },
  haloalkane: { label: 'Haloalkane', rule: 'A halogen on the chain, named as a prefix (chloro-, bromo-).' }
};
export const MOLECULE_FAMILY = {
  'methanol': 'alcohol', 'ethanol': 'alcohol', 'propan-1-ol': 'alcohol', 'propan-2-ol': 'alcohol',
  'ethanal': 'aldehyde', 'propanal': 'aldehyde',
  'propan-2-one': 'ketone', 'butan-2-one': 'ketone',
  'ethanoic acid': 'acid', 'propanoic acid': 'acid',
  'ethyl ethanoate': 'ester', 'methoxyethane': 'ether', 'ethanamine': 'amine', 'ethanamide': 'amide',
  '2-chlorobutane': 'haloalkane', '1-bromopropane': 'haloalkane'
};

/* ---- the modes. Each one says which Chem-108 topics it can draw from and what one question item is. ---- */
export const MODES = {
  'name-it': { title: 'Name It', blurb: 'A structure appears. Pick its IUPAC name.' },
  'spot-group': { title: 'Spot the Group', blurb: 'Which functional group is this?' },
  'element-sprint': { title: 'Element Sprint', blurb: 'Symbol to name, name to symbol.' },
  'topic-blitz': { title: 'Topic Blitz', blurb: 'Any Chem-108 topic, its own cards.' }
};

/* every item a mode can ask, each carrying `deck` (its Chem-108 topic) and `group` (the pool its distractors come from) */
export function modeItems(catalog, mode) {
  if (mode === 'name-it') return catalog.molecules.map((m) => ({ ...m, kind: 'structure', group: 'mol:' + m.deck }));
  if (mode === 'spot-group') {
    const fams = catalog.molecules.filter((m) => MOLECULE_FAMILY[m.name]).map((m) => {
      const f = FAMILIES[MOLECULE_FAMILY[m.name]];
      const article = /^[aeiou]/i.test(f.label) ? 'an' : 'a';
      return { id: 'family:' + m.id, deck: 'groups', kind: 'structure', group: 'family', prompt: 'Which functional group is this?', name: f.label, aliases: [], svg: m.svg, formula: m.formula, molecule: m.name, explain: `${m.name} is ${article} ${f.label.toLowerCase()}. ${f.rule}` };
    });
    const cards = catalog.cards.filter((c) => c.deck === 'groups').map((c) => ({ ...c, kind: 'card', group: 'card:groups' }));
    return [...fams, ...cards];
  }
  if (mode === 'element-sprint') {
    return catalog.elements.flatMap((e) => [
      { id: 'el-name:' + e.z, deck: e.deck, kind: 'symbol', group: 'el-name:' + e.deck, prompt: 'Which element is this?', big: e.symbol, name: e.name, aliases: e.aliases, explain: e.symbol + ' is ' + e.name + ', atomic number ' + e.z + '.' },
      { id: 'el-sym:' + e.z, deck: e.deck, kind: 'name', group: 'el-sym:' + e.deck, prompt: 'What is the symbol?', big: e.name, name: e.symbol, aliases: [], explain: e.name + ' is ' + e.symbol + ', atomic number ' + e.z + '.' }
    ]);
  }
  if (mode === 'topic-blitz') {
    return [...catalog.cards.map((c) => ({ ...c, kind: 'card', group: 'card:' + c.deck })), ...catalog.molecules.map((m) => ({ ...m, kind: 'structure', group: 'mol:' + m.deck }))];
  }
  throw new Error('unknown mode ' + mode);
}

/* the topics a mode can be filtered to, in Chem-108's order */
export function modeTopics(catalog, mode) {
  const decks = new Set(modeItems(catalog, mode).map((q) => q.deck));
  return catalog.topics.filter((t) => decks.has(t.id));
}

export function pool(catalog, mode, topic = 'all') {
  return modeItems(catalog, mode).filter((q) => topic === 'all' || q.deck === topic);
}

/* Four options: the right answer and three distractors from the SAME pool (same topic, same kind), never two that read
   the same (Chem-108's norm() de-duplication) and never a distractor the right answer would itself accept. For Name It
   the right option is sometimes shown as one of its accepted aliases (Chem-108: "1-hexene" is accepted for hex-1-ene),
   so the player learns both; checking still runs through accepted(). */
export function makeQuestion(catalog, mode, item, { rand = Math.random, aliasChance = mode === 'name-it' ? 0.25 : 0 } = {}) {
  const all = modeItems(catalog, mode);
  const seen = new Set([norm(item.name), ...item.aliases.map(norm)]);
  const others = shuffle(all.filter((m) => m.group === item.group && m.id !== item.id), rand).filter((m) => {
    const key = norm(m.name);
    if (seen.has(key) || accepted(item, m.name)) return false;
    seen.add(key); return true;
  }).slice(0, 3);
  if (others.length < 3) throw new Error(`pool ${item.group} has too few distinct answers for ${item.id}`);
  const label = item.aliases.length && rand() < aliasChance ? item.aliases[Math.floor(rand() * item.aliases.length)] : item.name;
  const options = shuffle([{ label, correct: true }, ...others.map((m) => ({ label: m.name, correct: false }))], rand);
  return { id: item.id, mode, deck: item.deck, kind: item.kind, prompt: item.prompt, svg: item.svg || null, big: item.big || null, symbol: item.symbol || null, item: { name: item.name, aliases: item.aliases }, answer: item.name, shown: label, explain: item.explain || '', formula: item.formula || null, molecule: item.molecule || null, options };
}

export function check(question, label) { return accepted(question.item, label); }

/* ---- the round: 60 seconds, 3 lives, a streak multiplier ---- */
export const ROUND_SECONDS = 60, LIVES = 3, BASE_POINTS = 100, MAX_MULTIPLIER = 5;
export const multiplier = (streak) => Math.min(MAX_MULTIPLIER, 1 + Math.floor(Math.max(0, streak) / 3));

export function newRound({ mode, topic = 'all', seconds = ROUND_SECONDS } = {}) {
  return { mode, topic, score: 0, streak: 0, bestStreak: 0, lives: LIVES, timeLeft: seconds, answered: 0, correct: 0, missed: [], over: false, reason: null };
}

/* applies one answer; returns the new state and what happened (pure: the old state is not changed) */
export function answer(state, question, label) {
  if (state.over) return { state, ok: false, points: 0 };
  const ok = check(question, label);
  const s = { ...state, missed: state.missed, answered: state.answered + 1 };
  let points = 0;
  if (ok) {
    s.streak = state.streak + 1; s.bestStreak = Math.max(state.bestStreak, s.streak); s.correct = state.correct + 1;
    points = BASE_POINTS * multiplier(s.streak); s.score = state.score + points;
  } else {
    s.streak = 0; s.lives = state.lives - 1;
    s.missed = [...state.missed, { id: question.id, deck: question.deck, prompt: question.prompt, picked: label, answer: question.answer, aliases: question.item.aliases, svg: question.svg, big: question.big, explain: question.explain, formula: question.formula }];
    if (s.lives <= 0) { s.over = true; s.reason = 'lives'; }
  }
  return { state: s, ok, points };
}

export function tick(state, seconds) {
  if (state.over) return state;
  const timeLeft = Math.max(0, state.timeLeft - seconds);
  return timeLeft <= 0 ? { ...state, timeLeft: 0, over: true, reason: 'time' } : { ...state, timeLeft };
}

/* ---- what is kept in this browser: best score per mode, accuracy per topic, Chem-108-style review records ----
   `records` are updated answer by answer during the round (update(), so a missed item comes back sooner and a known one
   later, exactly as Chem-108 schedules them); recordRound folds the round's best score and topic accuracy in. */
export function emptySave() { return { v: 1, best: {}, topics: {}, records: {} }; }
export function recordRound(save, state, results, records = save.records) {
  const out = { v: 1, best: { ...save.best }, topics: { ...save.topics }, records: { ...records } };
  const key = state.mode;
  const newBest = state.score > (out.best[key] || 0);
  if (newBest) out.best[key] = state.score;
  for (const r of results) {
    const t = out.topics[r.deck] || { seen: 0, correct: 0 };
    out.topics[r.deck] = { seen: t.seen + 1, correct: t.correct + (r.ok ? 1 : 0) };
  }
  return { save: out, newBest };
}
export const accuracy = (t) => (t && t.seen ? Math.round((100 * t.correct) / t.seen) : null);

/* the next item: Chem-108's choose() over the pool (due reviews first, then new, never the same twice running) */
export function nextItem(items, records, lastId, { rand = Math.random, now = Date.now() } = {}) {
  return choose(shuffle(items, rand), records, lastId, now);
}
