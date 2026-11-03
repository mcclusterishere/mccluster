import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LabRuntimeError, SESSION_STATES } from "./equity-uprise-lab-runtime.mjs";
import { HSEEP_RUNTIME_VERSION, createHseepExercise, hseepRoleIds } from "./equity-uprise-hseep-runtime.mjs";

const load = (relativePath) => JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));

const pack = load("./hseep-building-safety-scenario-pack-v1.json");
const simulationObjects = load("../floor-01/floor-01-simulation-objects.json");
const objectInventory = load("../floor-01/floor-01-object-inventory.json");
const registry = load("../asset-registry/generated/equity-uprise-asset-registry-v1.json");
const catalog = load("../../../equity-uprise-development/FEDERAL-TRAINING-CATALOG.json");
const bindings = load("../../../equity-uprise-development/FEDERAL-TRAINING-BINDINGS.json");
const rubrics = load("../../../equity-uprise-development/competency-rubrics.json");
const sources = { simulationObjects, objectInventory, registry };

const EXPECTED = [
  "fire_smoke_evacuation",
  "shelter_in_place_severe_weather",
  "active_threat_awareness",
  "hazmat_release",
  "full_building_evacuation",
  "disability_inclusive_evacuation",
  "emergency_plan_tabletop",
];
const HSEEP_TYPES = new Set([...pack.doctrine.exercise_types["discussion-based"], ...pack.doctrine.exercise_types["operations-based"]]);
const refs = new Set((catalog.reference_materials || []).map((ref) => ref.reference_id));
const competencyIds = new Set(JSON.stringify(rubrics).match(/\b(?:CORE|SHR|PSC|RSP|ENT|MED|OPS)-\d{2}\b/g));
const roleIds = hseepRoleIds(pack);

assert.equal(HSEEP_RUNTIME_VERSION, "1.0.0");
assert.equal(pack.mode, "SIMULATION");
assert.equal(pack.execution_target, "SANDBOX");
assert.equal(pack.live_control_allowed, false);
assert.equal(pack.credential_is_not_competency, true);
assert.match(pack.pack_version, /^\d+\.\d+\.\d+$/);
assert.deepEqual(pack.scenarios.map((s) => s.canonical_scenario_id), EXPECTED);
assert.deepEqual(Object.keys(pack.doctrine.eeg_ratings), ["P", "S", "M", "U"]);
for (const field of ["incident_name", "operational_period", "ics_position", "activity_log"]) {
  assert.ok(pack.ics.ics_214_fields.includes(field), "ICS-214 field missing: " + field);
}

// The learner wording rule: prepares you for, never certified.
const forbiddenClaims = /\bcertif(?:ied|y|ication)\b|\bearn (?:your|a) (?:fema|cisa|comptia)/i;

for (const s of pack.scenarios) {
  const id = s.scenario_id;
  assert.ok(HSEEP_TYPES.has(s.hseep.exercise_type), id + " has an unknown HSEEP exercise type");
  const category = pack.doctrine.exercise_types["operations-based"].includes(s.hseep.exercise_type) ? "operations-based" : "discussion-based";
  assert.equal(s.hseep.exercise_category, category, id + " category does not match its type");
  assert.ok(s.hseep.objectives.length >= 2, id + " needs objectives");
  const objectiveIds = new Set(s.hseep.objectives.map((o) => o.objective_id));
  const actionIds = new Set(s.actions.map((a) => a.id));
  const covered = new Set();
  for (const c of s.hseep.eeg) {
    assert.ok(objectiveIds.has(c.objective_id), id + " EEG " + c.criterion_id + " names an unknown objective");
    for (const a of c.action_ids) { assert.ok(actionIds.has(a), id + " EEG names unknown action " + a); covered.add(a); }
  }
  assert.deepEqual([...covered].sort(), [...actionIds].sort(), id + ": every action must be evaluated by an EEG criterion");
  assert.ok(s.hseep.hotwash_prompts.length >= 2);
  for (const objective of objectiveIds) assert.ok(s.hseep.eeg.some((c) => c.objective_id === objective), id + " objective without EEG: " + objective);

  for (const role of [...s.team.roles_required, ...s.team.roles_optional]) assert.ok(roleIds.has(role), id + " unknown team role " + role);
  for (const a of s.actions) {
    assert.ok(Array.isArray(a.roles) && a.roles.length, id + " action without roles: " + a.id);
    for (const role of a.roles) assert.ok(roleIds.has(role), id + " action " + a.id + " unknown role " + role);
  }
  for (const c of s.competency_ids) assert.ok(competencyIds.has(c), id + " unknown competency " + c);
  for (const r of s.reference_ids) assert.ok(refs.has(r), id + " unknown reference " + r);
  for (const fid of s.federal_training_ids) {
    const binding = bindings.bindings.find((b) => b.catalog_id === fid);
    assert.ok(binding, id + " unknown federal binding " + fid);
    assert.ok((binding.hseep_scenario_ids || []).includes(id), fid + " does not bind " + id);
    assert.equal(binding.live_control_allowed, false);
  }
  assert.doesNotMatch(JSON.stringify(s.learner_copy), forbiddenClaims, id + " learner copy claims certification");
  assert.ok(!/IS-139/i.test(JSON.stringify(s)), "retired IS-139.A must never be cited");
}

// Active threat: discussion only, non-graphic, official guidance only.
{
  const s = pack.scenarios.find((x) => x.canonical_scenario_id === "active_threat_awareness");
  assert.equal(s.hseep.exercise_type, "tabletop");
  assert.equal(s.content_policy.non_graphic, true);
  assert.equal(s.content_policy.tactics_beyond_official_guidance, false);
  assert.equal(s.content_policy.opt_out_without_penalty, true);
  assert.ok(s.federal_training_ids.includes("FEMA-IS-907-A"));
  const learnerFacing = JSON.stringify([s.title, s.learner_copy, s.actions, s.effects, s.hseep.objectives, s.hseep.eeg]).toLowerCase();
  for (const word of ["gun", "shoot", "weapon", "kill", "blood", "wound", "bullet", "attack the", "ambush", "disarm"]) {
    assert.ok(!learnerFacing.includes(word), "active-threat exercise contains graphic/tactical term: " + word);
  }
}

// Accessible evacuation: voluntary + confidential, synthetic codes, no elevator assumption, no PII keys.
{
  const s = pack.scenarios.find((x) => x.canonical_scenario_id === "disability_inclusive_evacuation");
  const helper = s.actions.find((a) => a.id === "access-helper");
  assert.equal(helper.expected.self_identification, "voluntary_and_confidential");
  assert.ok(helper.expected.assigned_helpers >= 1);
  assert.equal(s.actions.find((a) => a.id === "access-refuge").expected.use_elevator, false);
  assert.match(s.privacy_rule, /synthetic codes only/);
  const serialized = JSON.stringify(s).toLowerCase();
  for (const key of ["\"name\":", "diagnosis", "\"medical_condition\"", "\"dob\"", "\"phone\""]) assert.ok(!serialized.includes(key), "PII-shaped field in accessible drill: " + key);
}

// Full-building evacuation: every floor and the tunnel roster, never live tunnel control.
{
  const s = pack.scenarios.find((x) => x.canonical_scenario_id === "full_building_evacuation");
  assert.deepEqual(s.floor_scope, ["B1", "F1", "F2", "F3", "F4", "F5", "F6", "L7"]);
  assert.equal(s.actions.find((a) => a.id === "full-tunnel").expected.unlock_live_tunnel, false);
  assert.equal(s.actions.find((a) => a.id === "full-sweep-upper").expected.use_elevator, false);
  assert.ok(s.hseep.exercise_type === "functional");
  for (const id of s.registry_bound_object_ids) assert.ok(registry.assets.some((a) => a.asset_id === id), "unknown registry asset " + id);
}

function rosterFor(s) {
  const roster = {};
  const roles = [...s.team.roles_required];
  for (const role of s.team.roles_optional) if (roles.length < Math.max(s.team.min_players, roles.length + 1)) roles.push(role);
  roles.forEach((role, index) => { roster["player-" + String(index + 1).padStart(2, "0")] = role; });
  while (Object.keys(roster).length < s.team.min_players) roster["player-" + String(Object.keys(roster).length + 1).padStart(2, "0")] = s.team.roles_optional[0];
  return roster;
}
function actorFor(roster, action) {
  return Object.keys(roster).find((actor) => action.roles.includes(roster[actor]));
}
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 3, 15, 0, tick++)).toISOString();

function run(s) {
  tick = 0;
  // A full roster covering every role an action needs.
  const roster = rosterFor(s);
  for (const action of s.actions) {
    if (!actorFor(roster, action)) roster["player-" + String(Object.keys(roster).length + 1).padStart(2, "0")] = action.roles[0];
  }
  const ex = createHseepExercise({ pack, scenarioId: s.scenario_id, ...sources, roster, session_id: "HSEEP::" + s.scenario_id + "::VERIFY", clock });
  ex.start();
  assert.equal(ex.ops.session.phase, SESSION_STATES.RUNNING);
  assert.ok(ex.ops.sandbox.summary().changed_state_count > 0, s.scenario_id + " fault must change state");
  for (const action of s.actions) {
    const result = ex.execute(actorFor(roster, action), action.id, action.expected || {});
    assert.equal(result.status, "success", s.scenario_id + " failed " + action.id);
  }
  assert.equal(ex.canComplete(), true);
  assert.equal(ex.complete().phase, SESSION_STATES.COMPLETED);
  ex.recordHotwash([{ actor_id: Object.keys(roster)[0], prompt_index: 0, text: "Route choice was quick." }]);
  const evidence = ex.exportEvidence();
  assert.ok(evidence.eeg.every((row) => row.rating === "P" && row.human_review_required === true));
  assert.equal(evidence.aar_ip_draft.status, "draft");
  assert.equal(evidence.aar_ip_draft.finalised_by_human, false);
  assert.equal(evidence.aar_ip_draft.improvement_plan.length, 0);
  assert.equal(evidence.ics_214.entries.length, s.actions.length);
  assert.equal(evidence.runtime_evidence.evaluation.passed, true);
  assert.equal(evidence.live_control_allowed, false);
  return evidence;
}

for (const s of pack.scenarios) {
  assert.equal(JSON.stringify(run(s)), JSON.stringify(run(s)), s.scenario_id + " must replay deterministically");
}

// Role gates, wrong answers and the draft AAR/IP.
{
  const s = pack.scenarios.find((x) => x.canonical_scenario_id === "fire_smoke_evacuation");
  tick = 0;
  const ex = createHseepExercise({ pack, scenarioId: s.scenario_id, ...sources, roster: { ic: "incident_commander", acct: "accountability_lead", w: "floor_warden", l: "liaison_officer" }, clock });
  ex.start();
  assert.equal(ex.execute("w", "fire-close", {}).status, "role_refused");
  assert.equal(ex.execute("ic", "fire-report", { response: "investigate_first" }).status, "incorrect");
  assert.equal(ex.execute("ic", "fire-report", s.actions[0].expected).status, "success");
  assert.equal(ex.execute("w", "fire-route", { route: "site-east-egress-walk", use_elevator: false }).status, "blocked");
  assert.equal(ex.execute("w", "fire-inspect", {}).status, "success");
  assert.equal(ex.execute("w", "fire-route", { route: "site-east-egress-walk", use_elevator: false }).status, "incorrect");
  assert.equal(ex.execute("w", "fire-route", { route: "site-north-egress-walk", use_elevator: false }).status, "success");
  assert.equal(ex.execute("w", "fire-doors", { close_doors_behind: true }).status, "success");
  const rows = Object.fromEntries(ex.evaluate().map((row) => [row.criterion_id, row]));
  const ratings = Object.fromEntries(Object.entries(rows).map(([k, row]) => [k, row.rating]));
  assert.equal(ratings["FIRE-EEG-1"], "S");
  assert.equal(ratings["FIRE-EEG-2"], "M");
  assert.equal(rows["FIRE-EEG-2"].failed_attempts, 2);
  assert.equal(ratings["FIRE-EEG-3"], "U");
  const aar = ex.draftAarIp();
  assert.equal(aar.critical_task_failed, true);
  assert.ok(aar.improvement_plan.every((item) => item.owner === null && item.status === "open"), "owners are assigned by a person");
  assert.ok(ex.ics214Log().entries.some((entry) => entry.ics_position === "floor_warden" && /role_refused/.test(entry.activity)));
}

// Required roles and LIVE are refused.
assert.throws(
  () => createHseepExercise({ pack, scenarioId: "full_building_evacuation", ...sources, roster: { a: "incident_commander" } }),
  (error) => error instanceof LabRuntimeError && (error.code === "HSEEP_ROLES_UNFILLED" || error.code === "HSEEP_TEAM_SIZE"),
);
assert.throws(
  () => createHseepExercise({ pack, scenarioId: "fire_smoke_evacuation", ...sources, roster: { a: "incident_commander" }, execution_target: "LIVE" }),
  (error) => error instanceof LabRuntimeError && error.code === "LIVE_CONTROL_FORBIDDEN",
);

console.log(JSON.stringify({
  status: "PASS",
  step: "lab-runtime-hseep-building-safety",
  hseep_runtime_version: HSEEP_RUNTIME_VERSION,
  pack_version: pack.pack_version,
  scenarios_verified: pack.scenarios.map((s) => s.scenario_id),
  exercise_types: [...new Set(pack.scenarios.map((s) => s.hseep.exercise_type))],
  eeg_criteria: pack.scenarios.reduce((n, s) => n + s.hseep.eeg.length, 0),
  role_gated_team_play: true,
  ics_214_log: true,
  aar_ip_draft_only: true,
  deterministic_replay: true,
  sandbox_only: true,
  live_control_allowed: false,
}, null, 2));
