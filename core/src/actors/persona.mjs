import { digest, boundedText } from './evidence.mjs';
export const PERSONA_VERSION = 'actor-persona/v1';
export const AI_DISCLOSURE = Object.freeze({ is_ai: true, actor_kind: 'fictional_ai', label: 'AI character', operator: 'McCluster' });
const present = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000;

// Canon sources and selected adaptation cast are owner-controlled, not model-generated.
// No character accounts are provisioned by this module.
export function validatePersonaConfig(config) {
  if (config?.schema !== PERSONA_VERSION || !present(config.version) || !Array.isArray(config.selected_cast) ||
      !Array.isArray(config.characters) || config.characters.length > 100) throw new Error('Invalid versioned actor persona config');
  const keys = new Set(), voices = new Set();
  for (const p of config.characters) {
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(p.actor_key || '') || keys.has(p.actor_key) || !present(p.name) ||
        p.identity_kind !== 'fictional_ai' || !['pending', 'approved', 'rejected'].includes(p.identity_status) ||
        !present(p.canon?.version) || !['verified', 'pending', 'proposed'].includes(p.canon.status) || !Array.isArray(p.canon?.sources) || !p.canon.sources.length ||
        p.canon.sources.length > 8 || p.canon.sources.some(s => !present(s.ref) || !present(s.version)) ||
        !present(p.voice?.perspective) || !present(p.voice?.rhythm) || !present(p.voice?.humor) || !present(p.voice?.motivation) ||
        !Array.isArray(p.topics) || p.topics.length > 12 || p.topics.some(t => !present(t)) || !Array.isArray(p.surfaces) ||
        !p.surfaces.length || p.surfaces.some(s => !['news', 'song', 'post'].includes(s))) throw new Error('Invalid source-backed persona');
    if (p.identity_status === 'approved' && (!present(p.approval_ref) || !present(p.canon.approval_ref) || p.canon.status !== 'verified' ||
        p.canon.sources.some(s => !['CANON', 'CANON-AUTHORING-AUTHORITY', 'OWNER_APPROVED'].includes(s.status)))) throw new Error('Persona approval provenance missing or source is not canon');
    const voice = digest([p.voice.perspective, p.voice.rhythm, p.voice.humor, p.voice.motivation].map(s => s.trim().toLowerCase()));
    if (voices.has(voice)) throw new Error('Characters must have distinct voice configurations');
    voices.add(voice); keys.add(p.actor_key);
  }
  if (new Set(config.selected_cast).size !== config.selected_cast.length || config.selected_cast.some(k => !keys.has(k))) throw new Error('Selected adaptation cast must reference known personas');
  return config;
}

export function selectedPersonas(config, kind) {
  validatePersonaConfig(config);
  return config.characters.filter(p => config.selected_cast.includes(p.actor_key) && p.identity_status === 'approved' && p.surfaces.includes(kind));
}

// Owner editing stays on ops_platform_actors.persona.commenting. This is a view
// of existing actor rows, not a second character registry or account seeder.
export function personaConfigFromActors(actors) {
  const configured = actors.filter(a => a.persona?.commenting);
  if (!configured.length) return null;
  const versions = new Set(configured.map(a => a.persona.commenting.config_version));
  if (versions.size !== 1) throw new Error('Actor cast config versions disagree');
  const characters = configured.map(a => {
    if (a.persona.commenting.character?.actor_key !== a.actor_key || typeof a.persona.commenting.selected !== 'boolean') throw new Error('Actor config identity mismatch');
    return a.persona.commenting.character;
  });
  return validatePersonaConfig({ schema: PERSONA_VERSION, version: [...versions][0], characters,
    selected_cast: configured.filter(a => a.persona.commenting.selected).map(a => a.actor_key) });
}

export function personaForActor(actor, config) {
  if (config) {
    validatePersonaConfig(config);
    const p = config.characters.find(p => p.actor_key === actor.actor_key);
    if (!p || !config.selected_cast.includes(p.actor_key)) throw new Error('Actor outside selected adaptation cast');
    return { ...p, voice: Object.fromEntries(['perspective', 'rhythm', 'humor', 'motivation'].map(k => [k, boundedText(p.voice[k], 600)])),
      config_version: config.version, digest: digest(p), disclosure: AI_DISCLOSURE };
  }
  // Preserve the existing actor row; do not invent canon/approval versions from its name.
  const p = actor.persona || {};
  return { actor_key: actor.actor_key, name: boundedText(p.name || actor.actor_key, 100),
    identity_kind: 'fictional_ai', identity_status: 'not_reconciled',
    canon: { version: null, sources: [], status: 'needs_reconciliation' }, config_version: null,
    // Old biography text may conflict with newer specialist canon or reveal
    // writer-only history. Unreconciled biography never becomes prompt authority.
    voice: { perspective: '', rhythm: boundedText(p.voice, 700), humor: '', motivation: boundedText(p.motivation, 300) },
    digest: digest(p), disclosure: AI_DISCLOSURE };
}
