import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const campaign = JSON.parse(fs.readFileSync(path.join(here, 'campaign.v1.json'), 'utf8'));

function invariant(ok, message) {
  if (!ok) throw new Error(`PRIM3 Halo campaign invariant failed: ${message}`);
}

invariant(campaign.world?.scope === 'Earth', 'campaign must start Earth-only');
invariant(campaign.world?.live_ops_ingestion === false, 'game must not ingest live Halo Ops data');
invariant(campaign.world?.facility_policy === 'fictional-only', 'campaign facilities must be fictional');
invariant(campaign.intro_missions?.length === 3, 'exactly three intro missions required');
invariant(campaign.core_arcs?.length === 21, 'exactly 21 core arcs required');

const missionIds = new Set(campaign.intro_missions.map((mission) => mission.mission_id));
for (const arc of campaign.core_arcs) {
  invariant(arc.missions?.length === 3, `${arc.arc_id} must contain three variants`);
  invariant(arc.missions.map((mission) => mission.variant).join('') === 'ABC', `${arc.arc_id} variants must be A/B/C`);
  for (const mission of arc.missions) {
    invariant(!missionIds.has(mission.mission_id), `duplicate mission id ${mission.mission_id}`);
    missionIds.add(mission.mission_id);
  }
}

invariant(missionIds.size === 66, `expected 66 unique missions, got ${missionIds.size}`);
console.log(JSON.stringify({ ok: true, campaign: campaign.campaign_id, missions: missionIds.size, core_arcs: campaign.core_arcs.length }));
