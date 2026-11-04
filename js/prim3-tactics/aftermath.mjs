/* Debrief facts from the saved tactical run. No campaign awards, progression or story changes. */
const COMPLETE = new Set(['COMPLETE', 'VERIFIED', 'SECURED', 'SEALED_STABILIZED']);
const ROLES = { E: 'Entry', R: 'Recon', T: 'Technical' };
export function missionAftermath(state, outcome, { objectiveNode = 'RELAY', objectiveLabel = 'Relay' } = {}) {
  const goals = [
    ...state.nodes.filter((n) => n.required).map((n) => ({ id: n.id, label: n.id === objectiveNode ? objectiveLabel : n.id, state: n.state, complete: COMPLETE.has(n.state) })),
    ...state.objectives.filter((o) => o.required).map((o) => ({ id: o.id, label: o.id, state: o.state, complete: COMPLETE.has(o.state) }))
  ];
  const squad = state.units.filter((u) => u.faction === 'PLAYER').map((u) => {
    const extracted = state.mission.extractedUnitIds.includes(u.id) || u.statuses.includes('EXTRACTED');
    const condition = u.dead ? 'Lost' : u.downed ? 'Downed' : u.hp < u.maxHp ? 'Injured' : 'Unhurt';
    const location = extracted ? 'Extracted' : u.dead ? 'Not extracted' : 'Still on site';
    return { id: u.id, label: `${ROLES[u.role] || u.role} · ${u.id}`, condition, location, hp: u.hp, maxHp: u.maxHp, extracted };
  });
  const counts = { extracted: squad.filter((u) => u.extracted).length, lost: squad.filter((u) => u.condition === 'Lost').length, downed: squad.filter((u) => u.condition === 'Downed').length, injured: squad.filter((u) => u.condition === 'Injured').length };
  let next;
  if (outcome === 'lose-clock') next = 'On a retry, plan the route to the objective and extraction before spending turns.';
  else if (outcome === 'lose-t') next = 'On a retry, keep Technical protected until the required technical work is verified.';
  else if (outcome === 'lose-downed' || outcome === 'lose-all') next = 'On a retry, use cover and protect the route out. This exercise has no carry or revive action.';
  else if (outcome === 'lose-verified') next = 'On a retry, stop the opposing team from restoring and verifying its picture.';
  else if (counts.lost || counts.downed || counts.injured) next = 'The objective is complete, but the squad took losses or damage. Replay to try a safer approach.';
  else next = 'The squad completed this run without damage. Replay to compare a different route or return to choose another mission.';
  return { outcome, round: state.round, clock: state.mission.clock, escalation: state.mission.escalation, extractionRequired: state.mission.extractionRequired, goals, squad, counts, next };
}
