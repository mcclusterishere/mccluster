// Equity Uprise Lab Runtime — HSEEP building-safety exercises (team play).
//
// Wraps the Step 4 BuildingOperationsExercise so the new drills share its
// SANDBOX state engine, prerequisite gates and evidence spine, and adds what
// FEMA's HSEEP doctrine expects of an exercise:
//   - an exercise type (drill / tabletop / functional ...);
//   - Incident Command and building roles per player, with role-gated actions;
//   - an ICS-214-shaped activity log written for every action;
//   - Exercise Evaluation Guide (EEG) criteria rated P / S / M / U;
//   - a hotwash record and a DRAFT After-Action Report / Improvement Plan.
//
// Automation boundary: the runtime drafts. A human evaluator finalises the
// AAR/IP and assigns every improvement-item owner (server side, Supabase
// learning_hseep_* tables). Nothing here awards Verified/Applied/Mentor.
import { LabRuntimeError } from "./equity-uprise-lab-runtime.mjs";
import { BuildingOperationsExercise } from "./equity-uprise-building-ops-runtime.mjs";

export const HSEEP_RUNTIME_VERSION = "1.0.0";

const clone = (value) => JSON.parse(JSON.stringify(value));
function requireValue(condition, code, message) {
  if (!condition) throw new LabRuntimeError(code, message);
}

export function hseepRoleIds(pack) {
  return new Set([
    ...Object.keys(pack.ics?.positions || {}),
    ...Object.keys(pack.ics?.building_roles || {}),
    ...Object.keys(pack.ics?.exercise_staff || {}),
  ]);
}

// The Step 4 state engine loads Floor 1 objects; multi-floor drills also bind
// canonical registry assets (stair doors on every floor, the B1 fire alarm
// control panel). They are added as plain simulation objects, never as live
// endpoints.
function extendedSimulationObjects(definition, simulationObjects, registry) {
  const objects = [...(simulationObjects.objects || [])];
  const have = new Set(objects.map((object) => object.object_id));
  for (const assetId of definition.registry_bound_object_ids || []) {
    if (have.has(assetId)) continue;
    const asset = (registry.assets || []).find((entry) => entry.asset_id === assetId);
    requireValue(Boolean(asset), "HSEEP_REGISTRY_ASSET_MISSING", "registry asset not found: " + assetId);
    requireValue(asset.live_control_allowed !== true, "LIVE_CONTROL_FORBIDDEN", "registry asset enables live control: " + assetId);
    objects.push({ object_id: assetId, label: asset.label || assetId, normal_state: "available" });
    have.add(assetId);
  }
  return { ...simulationObjects, objects };
}

export class HseepExercise {
  constructor({ pack, definition, sources, roster, session_id, clock, execution_target = "SANDBOX" }) {
    requireValue(pack.mode === "SIMULATION" && pack.execution_target === "SANDBOX" && pack.live_control_allowed === false,
      "LIVE_CONTROL_FORBIDDEN", "HSEEP pack must remain simulation-only");
    requireValue(definition.source_scenario?.id === definition.canonical_scenario_id, "HSEEP_SOURCE_MISMATCH", "source scenario mismatch");
    const roles = hseepRoleIds(pack);
    const entries = Object.entries(roster || {});
    requireValue(entries.length > 0, "HSEEP_ROSTER_EMPTY", "at least one player is required");
    for (const [actor, role] of entries) {
      requireValue(roles.has(role), "HSEEP_UNKNOWN_ROLE", "unknown role " + role + " for " + actor);
    }
    const assigned = new Set(entries.map(([, role]) => role));
    const missing = (definition.team?.roles_required || []).filter((role) => !assigned.has(role));
    requireValue(missing.length === 0, "HSEEP_ROLES_UNFILLED", "required roles unfilled: " + missing.join(", "));
    requireValue(entries.length >= (definition.team?.min_players || 1) && entries.length <= (definition.team?.max_players || 1),
      "HSEEP_TEAM_SIZE", "team size outside " + definition.team?.min_players + "-" + definition.team?.max_players);

    this.pack = pack;
    this.definition = clone(definition);
    this.roster = Object.fromEntries(entries);
    this.clock = clock || (() => new Date().toISOString());
    this.ops = new BuildingOperationsExercise({
      definition,
      sourceScenario: definition.source_scenario,
      pack,
      sources: {
        simulationObjects: extendedSimulationObjects(definition, sources.simulationObjects, sources.registry),
        objectInventory: sources.objectInventory,
        registry: sources.registry,
      },
      session_id: session_id || "HSEEP::" + definition.canonical_scenario_id,
      actor_id: entries[0][0],
      execution_target,
    });
    this.actionById = new Map(definition.actions.map((action) => [action.id, action]));
    this.ics214 = [];
    this.attempts = new Map();
    this.hotwash = null;
  }

  start() {
    return this.ops.start();
  }

  execute(actorId, actionId, input = {}) {
    const role = this.roster[actorId];
    requireValue(Boolean(role), "HSEEP_UNKNOWN_ACTOR", "actor not on the roster: " + actorId);
    const action = this.actionById.get(actionId);
    requireValue(Boolean(action), "UNKNOWN_BUILDING_OPS_ACTION", "unknown HSEEP action " + actionId);
    const tally = this.attempts.get(actionId) || { success: 0, incorrect: 0, blocked: 0, role_refused: 0 };
    let result;
    if (Array.isArray(action.roles) && !action.roles.includes(role)) {
      result = { action_id: actionId, status: "role_refused", correct: false, role, allowed_roles: clone(action.roles) };
    } else {
      result = this.ops.execute(actionId, input);
    }
    tally[result.status] = (tally[result.status] || 0) + 1;
    this.attempts.set(actionId, tally);
    this.ics214.push({
      entry_seq: this.ics214.length + 1,
      at: this.clock(),
      actor_id: actorId,
      ics_position: role,
      activity: actionId + " -> " + result.status,
    });
    return { ...result, actor_id: actorId, ics_position: role };
  }

  canComplete() {
    return this.ops.canComplete();
  }

  complete() {
    return this.ops.complete();
  }

  recordHotwash(responses) {
    const prompts = this.definition.hseep.hotwash_prompts || [];
    requireValue(Array.isArray(responses) && responses.length > 0, "HSEEP_HOTWASH_EMPTY", "hotwash needs at least one response");
    this.hotwash = {
      prompts: clone(prompts),
      responses: responses.map((entry) => ({ actor_id: String(entry.actor_id || ""), prompt_index: Number(entry.prompt_index) || 0, text: String(entry.text || "").slice(0, 2000) })),
      recorded_at: this.clock(),
    };
    return clone(this.hotwash);
  }

  // Draft EEG ratings from the action ledger: P with no failed attempts,
  // S with one, M with more, U when the task was never performed.
  evaluate() {
    return (this.definition.hseep.eeg || []).map((criterion) => {
      const performed = criterion.action_ids.every((id) => this.ops.successfulActionIds.has(id));
      const misses = criterion.action_ids.reduce((sum, id) => {
        const tally = this.attempts.get(id) || {};
        return sum + (tally.incorrect || 0) + (tally.blocked || 0) + (tally.role_refused || 0);
      }, 0);
      const rating = !performed ? "U" : misses === 0 ? "P" : misses === 1 ? "S" : "M";
      return {
        criterion_id: criterion.criterion_id,
        objective_id: criterion.objective_id,
        task: criterion.task,
        critical: criterion.critical,
        rating,
        observation_type: rating === "P" ? "strength" : "area_for_improvement",
        failed_attempts: misses,
        rated_by: "level_1_automated_verifier",
        human_review_required: true,
      };
    });
  }

  draftAarIp() {
    const ratings = this.evaluate();
    const strengths = ratings.filter((row) => row.rating === "P");
    const areas = ratings.filter((row) => row.rating !== "P");
    return {
      status: "draft",
      finalised_by_human: false,
      exercise_type: this.definition.hseep.exercise_type,
      scenario_id: this.definition.scenario_id,
      objectives: clone(this.definition.hseep.objectives),
      core_capabilities: clone(this.definition.hseep.core_capabilities),
      strengths: strengths.map((row) => ({ criterion_id: row.criterion_id, objective_id: row.objective_id, text: row.task })),
      areas_for_improvement: areas.map((row) => ({ criterion_id: row.criterion_id, objective_id: row.objective_id, text: row.task, rating: row.rating })),
      improvement_plan: areas.map((row, index) => ({
        item_code: this.definition.scenario_id + "-IP-" + String(index + 1).padStart(2, "0"),
        objective_id: row.objective_id,
        issue: row.task + " (" + row.rating + ")",
        corrective_action: null,
        core_capability: this.definition.hseep.core_capabilities[0] || null,
        owner: null,
        due_date: null,
        status: "open",
      })),
      hotwash: clone(this.hotwash),
      critical_task_failed: areas.some((row) => row.critical && row.rating === "U"),
    };
  }

  ics214Log() {
    return {
      incident_name: this.definition.title + " (EXERCISE)",
      operational_period: this.ics214.length ? { from: this.ics214[0].at, to: this.ics214[this.ics214.length - 1].at } : null,
      entries: clone(this.ics214),
    };
  }

  exportEvidence() {
    return {
      hseep_runtime_version: HSEEP_RUNTIME_VERSION,
      pack_id: this.pack.pack_id,
      pack_version: this.pack.pack_version,
      exercise_type: this.definition.hseep.exercise_type,
      roster: clone(this.roster),
      ics_214: this.ics214Log(),
      eeg: this.evaluate(),
      aar_ip_draft: this.draftAarIp(),
      ...this.ops.exportEvidence(),
    };
  }
}

export function createHseepExercise({ pack, scenarioId, simulationObjects, objectInventory, registry, roster, session_id, clock, execution_target = "SANDBOX" }) {
  const definition = pack.scenarios.find((scenario) => scenario.scenario_id === scenarioId || scenario.canonical_scenario_id === scenarioId);
  requireValue(Boolean(definition), "HSEEP_SCENARIO_NOT_FOUND", "HSEEP scenario not found: " + scenarioId);
  return new HseepExercise({ pack, definition, sources: { simulationObjects, objectInventory, registry }, roster, session_id, clock, execution_target });
}
