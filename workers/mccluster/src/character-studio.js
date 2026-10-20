// Character Studio compiler v1. Pure, deterministic, no model calls or side effects.
// Real character creation produces a private design specification, never a person,
// licensed likeness, activated agent, or public profile.
export const CHARACTER_STUDIO_VERSION = 'character-studio.v1';

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function field(value, name, minimum, maximum, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string') invalid(name + ' must be text');
  const result = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const length = [...result].length;
  if (length < minimum || length > maximum) invalid(name + ' must be ' + minimum + '–' + maximum + ' characters');
  if (/[\u0000-\u001F\u007F-\u009F]/.test(result)) invalid(name + ' contains invalid characters');
  return result;
}
function pillars(value) {
  if (value === undefined) return ['Origin & choices', 'Story conflict', 'Behind the character'];
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) invalid('Choose one to four content pillars');
  const items = value.map((v, i) => field(v, 'Content pillar ' + (i + 1), 3, 80));
  if (new Set(items.map(x => x.toLowerCase())).size !== items.length) invalid('Content pillars must be distinct');
  return items;
}
const BLOCKED = [
  'account_status', 'published_at', 'rights_verified', 'canon_approved',
  'region_approved', 'region_key', 'region_provenance', 'external_publish_enabled',
  'auto_reply_enabled', 'monthly_autospend_limit_cents', 'agent_contract',
  'm_uid', 'org_id', 'owner_id', 'social_accounts', 'verified_human', 'source_core_job_ref'
];

/**
 * The compiler is deliberately provider-independent. A model-based creative
 * assistant may propose fields later, but this validated contract remains
 * the final authority for storage, approvals, and budget.
 */
export function compileCharacterBlueprint(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Character brief must be an object');
  if (BLOCKED.some(key => Object.prototype.hasOwnProperty.call(input, key))) {
    invalid('A character brief cannot set approval, identity, agent, or publishing privileges');
  }
  const displayName = field(input.display_name, 'Display name', 2, 120);
  const handle = field(input.handle, 'Handle', 3, 32).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(handle)) invalid('Handle must be 3–32 lowercase letters, digits, dots, dashes or underscores');
  if (['admin', 'support', 'official', 'verified', 'moderator', 'system', 'mccluster'].includes(handle)) {
    invalid('This handle is reserved');
  }
  const storyWorld = field(input.story_world, 'Story world', 2, 120);
  const country = field(input.story_country, 'Story distribution country', 2, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) invalid('Story distribution country must be a two-letter ISO country code');
  const mission = field(input.editorial_mission, 'Editorial mission', 12, 1000);
  const voice = field(input.voice, 'Character voice', 3, 280);
  const desire = field(input.desire, 'Character desire', 3, 280);
  const fear = field(input.fear, 'Character fear', 3, 280);
  const contradiction = field(input.contradiction, 'Character contradiction', 3, 280);
  const appearance = field(input.appearance_direction, 'Appearance direction', 0, 500, true);
  const sourceIp = field(input.source_ip, 'Source intellectual property', 0, 120, true);
  const contentPillars = pillars(input.content_pillars);
  const identityKind = input.identity_kind === undefined ? 'fictional_character' : input.identity_kind;
  if (!['fictional_character', 'studio_system_persona'].includes(identityKind)) {
    invalid('Only original fictional characters or explicitly labeled studio personas are supported in this preview');
  }
  // A story DISTRIBUTION country is not a citizenship, hometown, live location,
  // network presence, real-world resident or verified mission.
  const characterId = handle.replace(/[._]+/g, '-').replace(/-+/g, '-');
  const disclosure = 'Fictional digital character from a creator studio. Not a real individual or verified human member; content may be AI-assisted.';
  const persona = {
    version: CHARACTER_STUDIO_VERSION,
    story_world: storyWorld,
    source_ip_claim: sourceIp || null,
    voice, desire, fear, contradiction,
    appearance_direction: appearance || null,
    content_pillars: contentPillars,
    real_person_likeness: 'not_authorized',
    voice_clone: 'not_authorized',
    trained_on_person: false,
    creative_boundaries: [
      'Always disclose the fictional nature of the account',
      'Never fabricate human follower counts, real-world presence, independent testimony or verified actions',
      'Never reveal unapproved canon, confidential creator data, or real-person identity details',
      'No audio, image, video, external publishing or autonomous spending without separate approval'
    ]
  };
  const agentContract = {
    lifecycle: 'specified_not_provisioned',
    namespace: 'house-agents/' + characterId,
    execution_enabled: false,
    schedule_enabled: false,
    external_publish_enabled: false,
    auto_reply_enabled: false,
    max_autospend_cents: 0,
    memory_scope: 'character_and_approved_canon_only',
    tools_allowed: [],
    tools_approval_required: ['media.generate', 'character.voice.clone', 'network.post.publish', 'external.social.publish'],
    review_required: true
  };
  const socialBio = (displayName + ' · ' + storyWorld + '. Fictional digital character. ' +
    mission.slice(0, 130).replace(/[.!?]+$/, '') + '.').slice(0, 240);
  const preview = {
    social_bio: socialBio,
    character_hook: displayName + ' wants ' + desire.charAt(0).toLowerCase() + desire.slice(1) +
      ', but fears ' + fear.charAt(0).toLowerCase() + fear.slice(1) + '.',
    visual_brief: appearance || 'Visual identity not yet designed or approved.',
    voice_direction: voice,
    content_series: contentPillars.map((title, index) => ({
      title,
      brief: 'Draft a fictional ' + storyWorld + ' moment from ' + displayName + "'s perspective on " + title.toLowerCase() + '.',
      sequence: index + 1
    })),
    introductory_draft: 'Meet ' + displayName + '. ' + mission + ' [Fictional digital character — creator-controlled draft.]'
  };
  return {
    schema_version: CHARACTER_STUDIO_VERSION,
    character_id: characterId,
    handle,
    display_name: displayName,
    identity_kind: identityKind,
    narrative_board: 'other',
    story_country: country,
    distribution_basis: 'owner_selected_story_distribution_only_not_residence',
    editorial_mission: mission,
    disclosure,
    personality: persona,
    agent_contract: agentContract,
    canon_refs: [],
    preview,
    approvals: {
      status: 'draft',
      published: false,
      rights_verified: false,
      canon_approved: false,
      region_approved: false,
      media_generation_enabled: false,
      autonomous_execution_enabled: false
    }
  };
}
