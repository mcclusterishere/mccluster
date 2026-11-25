/* THE CHARACTER CAST: one registry, read by MNET posting and by the city game.

   Owner, 2026-11-03: every story character gets a profile on MNET and posts
   publicly, run by the OVH box, with a psychological profile "so they feel like
   real people"; minors get no social profiles; the same personality powers
   in-game conversation later.

   core/data/characters/cast.v1.json is the canonical file. Each character keeps
   a stable id (the source id for city characters, prim3-<key> for the PRIM3
   regional agents) and points at its source: district.v1.json or
   prim3/agents.mjs. The source outranks this file: the cast adds psychology and
   MNET settings, never a new fact about a source character.

   validateCast() is the review gate: every source character is covered, no
   minor has a profile, ids and handles are stable and unique, names and ages
   match the source, and nothing names an AI model or a real public figure. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRIM3_AGENTS } from '../prim3/agents.mjs';
import { checkPost } from './post-safety.mjs';

export const CAST_FILE = fileURLToPath(new URL('../../data/characters/cast.v1.json', import.meta.url));
export const MANIFEST_FILE = fileURLToPath(new URL('../../data/fictional-city/district.v1.json', import.meta.url));
export const CAST_SCHEMA = 'mccluster.character-cast/v1';
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,35}$/;
export const ACTOR_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/; // ops_platform_actors.actor_key
export const POSTING = Object.freeze(['eligible', 'held']);
export const PSYCH_LISTS = Object.freeze(['values', 'fears', 'wants', 'contradictions', 'speech', 'triggers', 'postsAbout', 'neverTalksAbout']);
export const PSYCH_TEXT = Object.freeze(['temperament', 'humor', 'dailyRoutine', 'newsReaction', 'voiceSample']);

/* AI model and provider names never appear in cast content (owner rule). */
export const MODEL_NAME_PATTERN = /\b(?:qwen\w*|llama\w*|mistral\w*|mixtral|gemma\w*|gemini|gpt[-\s]?\d\w*|chatgpt|openai|claude|anthropic|grok|copilot|deepseek|phi-?\d|ollama|language model)\b/i;
/* Real public figures a fictional profile must never be, or be confused with. */
export const REAL_PEOPLE_PATTERN = /\b(?:matthew mccluster|donald trump|joe biden|kamala harris|barack obama|elon musk|taylor swift|beyonc[eé]|drake|kanye|jay-?z|oprah|mark zuckerberg|jeff bezos|bill gates|narendra modi|xi jinping|vladimir putin|volodymyr zelensky|keir starmer|emmanuel macron)\b/i;

let cached = null;
export function loadCast(file = CAST_FILE) {
  if (file === CAST_FILE && cached) return cached;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (file === CAST_FILE) cached = data;
  return data;
}
export function loadManifest(file = MANIFEST_FILE) { return JSON.parse(readFileSync(file, 'utf8')); }

export function characterById(id, cast = loadCast()) { return cast.characters.find(c => c.id === id) || null; }
export function characterBySource(kind, ref, cast = loadCast()) { return cast.characters.find(c => c.source.kind === kind && c.source.ref === ref) || null; }

const isMinorAgeRange = range => /^1[0-7]\b|^1[0-8]\s*[–-]\s*1[0-8]\b/.test(String(range || '').trim());

/* Every person the sources define, with the adult/minor call the cast must honor. */
export function sourceCharacters(manifest = loadManifest(), agents = PRIM3_AGENTS) {
  const out = [];
  for (const a of agents) out.push({ id: `prim3-${a.key}`, kind: 'prim3.agent', ref: a.key, name: a.name, age: null, minor: false });
  for (const n of manifest.npcs || []) out.push({ id: n.id, kind: 'fictional-city.npc', ref: n.id, name: n.name, age: n.age ?? null, minor: Boolean(n.minor) || (Number.isFinite(n.age) && n.age < 18) });
  for (const n of manifest.garageCrew || []) out.push({ id: n.id, kind: 'fictional-city.garageCrew', ref: n.id, name: n.name, age: n.age ?? null, minor: false });
  for (const n of manifest.expansionNpcs || []) out.push({ id: n.id, kind: 'fictional-city.expansionNpc', ref: n.id, name: n.name, age: n.age ?? null, minor: Boolean(n.minor) || (Number.isFinite(n.age) && n.age < 18) });
  for (const arc of manifest.storyArcs || []) for (const c of arc.cast || []) out.push({ id: c.id, kind: 'fictional-city.storyArcCast', ref: c.id, name: c.name, age: null, minor: isMinorAgeRange(c.ageRange) });
  return out;
}

/* Names that public posts must never contain: the minors the sources define. */
export function minorNames(manifest = loadManifest()) {
  const names = new Set();
  for (const s of sourceCharacters(manifest)) {
    if (!s.minor) continue;
    names.add(s.name);
    const first = String(s.name).replace(/[“”"].*?[“”"]/g, ' ').trim().split(/\s+/)[0];
    if (first && first.length > 2) names.add(first);
  }
  return [...names];
}

export function validateCast(cast, { manifest = loadManifest(), agents = PRIM3_AGENTS } = {}) {
  const errors = [];
  const err = (id, message) => errors.push(`${id || 'cast'}: ${message}`);
  if (cast?.schema !== CAST_SCHEMA) err(null, `schema must be ${CAST_SCHEMA}`);
  const list = Array.isArray(cast?.characters) ? cast.characters : [];
  const sources = sourceCharacters(manifest, agents);
  const sourceById = new Map(sources.map(s => [s.id, s]));
  const ids = new Set(), keys = new Set();
  const minors = sources.filter(s => s.minor).map(s => s.id).sort();
  if (JSON.stringify([...(cast?.excludedMinors || [])].sort()) !== JSON.stringify(minors)) err(null, `excludedMinors must list exactly the source minors: ${minors.join(', ')}`);

  for (const c of list) {
    const id = c?.id;
    if (!ID_PATTERN.test(String(id || ''))) { err(id, 'id must match ' + ID_PATTERN); continue; }
    if (ids.has(id)) err(id, 'duplicate id');
    ids.add(id);
    if (c.adult !== true) err(id, 'only adults get profiles');
    if (Number.isFinite(c.age) && c.age < 18) err(id, 'minor age');
    if (!c.name || typeof c.name !== 'string') err(id, 'name required');

    const src = c.source || {};
    if (src.kind === 'mnet-cast.regular') {
      if (sourceById.has(id)) err(id, 'a regular may not reuse a source id');
      if (!id.startsWith('regular-')) err(id, 'regular ids start with regular-');
      const hangouts = new Set([...(manifest.businesses || []), ...(manifest.expansionBusinesses || [])].map(b => b.id));
      if (!hangouts.has(c.canon?.hangoutBusinessId)) err(id, 'regular must anchor to an existing business');
    } else {
      const s = sourceById.get(id);
      if (!s) err(id, `no source character ${src.kind}:${src.ref}`);
      else {
        if (s.kind !== src.kind || s.ref !== src.ref) err(id, `source mismatch: expected ${s.kind}:${s.ref}`);
        if (s.minor) err(id, 'source marks this character a minor: no social profile');
        if (s.name !== c.name) err(id, `name differs from source (${s.name})`);
        if ((s.age ?? null) !== (c.age ?? null)) err(id, `age differs from source (${s.age})`);
      }
    }

    const m = c.mnet || {};
    if (m.actorKey !== `chr.${id}` || m.handle !== m.actorKey || !ACTOR_KEY_PATTERN.test(m.actorKey)) err(id, 'actorKey and handle must be chr.<id> within 40 characters');
    if (keys.has(m.actorKey)) err(id, 'duplicate actorKey');
    keys.add(m.actorKey);
    if (!m.displayName || !m.headline || m.headline.length > 120) err(id, 'displayName and headline (<=120) required');
    if (!POSTING.includes(m.posting)) err(id, 'posting must be eligible or held');
    if (m.posting === 'held' && !String(m.heldReason || '').trim()) err(id, 'held characters need a heldReason');
    const cad = m.cadence || {};
    if (!Number.isInteger(cad.postsPerDay) || cad.postsPerDay < 1 || cad.postsPerDay > 3) err(id, 'postsPerDay 1..3 (ops_platform_actors.daily_limit)');
    const [start, end] = cad.activeHoursLocal || [];
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end)) err(id, 'activeHoursLocal [start,end] within 0..24');
    try { new Intl.DateTimeFormat('en-US', { timeZone: cad.timezone }); } catch { err(id, 'invalid timezone'); }
    if (!(cad.replyAffinity >= 0 && cad.replyAffinity <= 1)) err(id, 'replyAffinity 0..1');
    if (!/^[A-Z]{2}$/.test(String(m.newsLens?.fips || '')) || !Array.isArray(m.newsLens?.keywords)) err(id, 'newsLens needs a FIPS country and keywords');

    const p = c.psych || {};
    for (const key of PSYCH_TEXT) if (typeof p[key] !== 'string' || p[key].trim().length < 3) err(id, `psych.${key} required`);
    for (const key of PSYCH_LISTS) if (!Array.isArray(p[key]) || !p[key].length || p[key].some(v => typeof v !== 'string' || !v.trim())) err(id, `psych.${key} must be a non-empty list`);
    if (!Array.isArray(p.relationships)) err(id, 'psych.relationships must be a list');
    if (typeof p.voiceSample === 'string') {
      const verdict = checkPost(p.voiceSample, { minors: minorNames(manifest) });
      if (!verdict.ok) err(id, `voiceSample fails the post validator: ${verdict.reason}`);
    }
  }
  for (const c of list) for (const rel of c?.psych?.relationships || []) {
    if (!ids.has(rel.id) && !sourceById.has(rel.id)) err(c.id, `relationship to unknown character ${rel.id}`);
    if (rel.id === c.id) err(c.id, 'relationship to self');
  }
  for (const s of sources) if (!s.minor && !ids.has(s.id)) err(s.id, `source character not covered (${s.kind})`);
  const text = JSON.stringify(list); // the authority block may quote the owner by name
  const model = text.match(MODEL_NAME_PATTERN);
  if (model) err(null, `AI model name in cast content: ${model[0]}`);
  const person = text.match(REAL_PEOPLE_PATTERN);
  if (person) err(null, `real public figure named: ${person[0]}`);
  return errors;
}

/* The compact persona a prompt carries: psychology, never the full source bio. */
export function personaCard(c, cast = loadCast()) {
  const names = new Map(cast.characters.map(x => [x.id, x.name]));
  const p = c.psych;
  return {
    id: c.id, name: c.name, role: c.canon?.role || c.mnet.headline,
    temperament: p.temperament, values: p.values.slice(0, 3), wants: p.wants.slice(0, 2),
    contradiction: p.contradictions[0], speech: p.speech.slice(0, 3), humor: p.humor,
    triggers: p.triggers.slice(0, 2), postsAbout: p.postsAbout.slice(0, 3), neverTalksAbout: p.neverTalksAbout,
    newsReaction: p.newsReaction, voice: p.voiceSample,
    knows: p.relationships.filter(r => names.has(r.id)).slice(0, 3).map(r => `${names.get(r.id)}: ${r.note}`),
  };
}

export function postingRoster(cast = loadCast()) {
  return cast.characters.filter(c => c.mnet.posting === 'eligible');
}
