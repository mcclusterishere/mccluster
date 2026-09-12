import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const campaign = JSON.parse(await readFile(resolve(here, 'campaign.v1.json'), 'utf8'));

test('PRIM3 Halo is Earth-only and live-ops isolated', () => {
  assert.equal(campaign.world.scope, 'Earth');
  assert.equal(campaign.world.live_ops_ingestion, false);
  assert.equal(campaign.world.facility_policy, 'fictional-only');
});

test('campaign contains exactly 66 missions', () => {
  const ids = [
    ...campaign.intro_missions.map((mission) => mission.mission_id),
    ...campaign.core_arcs.flatMap((arc) => arc.missions.map((mission) => mission.mission_id))
  ];
  assert.equal(campaign.intro_missions.length, 3);
  assert.equal(campaign.core_arcs.length, 21);
  assert.ok(campaign.core_arcs.every((arc) => arc.missions.length === 3));
  assert.equal(ids.length, 66);
  assert.equal(new Set(ids).size, 66);
});
