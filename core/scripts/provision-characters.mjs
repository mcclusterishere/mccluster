#!/usr/bin/env node
/* Create or refresh the cast's MNET profiles from core/data/characters/cast.v1.json.

   Needs supabase/pending/mnet_character_cast_v1.sql applied (owner approval).
   Runs on the box with Core's service-role environment.

     node core/scripts/provision-characters.mjs            # plan only: prints what would be provisioned
     node core/scripts/provision-characters.mjs --apply    # rpc ops_character_provision for every eligible character (actors stay DISABLED)
     node core/scripts/provision-characters.mjs --enable   # also switch eligible characters on (a separate owner decision)

   Held characters (posting:"held") are never provisioned here; minors are not
   in the cast at all. Idempotent: a second run refreshes profile text and persona. */
import { loadCast, validateCast, personaCard } from '../src/characters/cast.mjs';

export function provisionPayload(c, cast) {
  return {
    p_character_id: c.id,
    p_display_name: c.mnet.displayName,
    p_headline: c.mnet.headline,
    p_bio: c.psych.temperament,
    p_daily_limit: c.mnet.cadence.postsPerDay,
    p_persona: { ...personaCard(c, cast), universe: c.universe, profile_version: 1, source: c.source },
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const cast = loadCast();
  const errors = validateCast(cast);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; return; }
  const eligible = cast.characters.filter(c => c.mnet.posting === 'eligible');
  if (!args.has('--apply') && !args.has('--enable')) {
    console.log(JSON.stringify({ plan: eligible.map(c => c.mnet.actorKey), held: cast.characters.filter(c => c.mnet.posting === 'held').map(c => c.id) }, null, 1));
    return;
  }
  const { rest, resolveHouseOrgId } = await import('../src/supabase.mjs');
  const orgId = await resolveHouseOrgId();
  for (const c of eligible) {
    const { body } = await rest('rpc/ops_character_provision', { method: 'POST', body: JSON.stringify({ p_org_id: orgId, ...provisionPayload(c, cast) }) });
    console.log(JSON.stringify({ character: c.id, ...body }));
  }
  if (args.has('--enable')) {
    const keys = eligible.map(c => c.mnet.actorKey).join(',');
    await rest(`ops_platform_actors?actor_key=in.(${keys})`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ enabled: true }) });
    console.log(JSON.stringify({ enabled: eligible.length }));
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.message); process.exitCode = 1; });
