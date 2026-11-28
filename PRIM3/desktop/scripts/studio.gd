class_name Prim3Studio
extends RefCounted
## Headless McCluster game-studio playtest.
##
## Core launches Godot as `godot --headless --path <project> -- --mccluster-scenario=<id>
## --mccluster-seed=<n> --mccluster-max-steps=<n>` (core/src/game-studio/godot-runtime.mjs) and reads
## `MCCLUSTER_EVENT {json}` lines from stdout. This runner plays a real desktop mission with the
## autopilot on the real rules and reports observations, actions and a terminal event in exactly the
## shapes the tactical sandbox fixture (core/fixtures/prim3-tactical-sandbox) emits.
##
## Extra argument: --mccluster-mission=<mission id> (default: the scenario id if it names a mission,
## otherwise the first mission).

const R := preload("res://scripts/rules.gd")
const AI := preload("res://scripts/ai.gd")

var scenario_id := "TEST_MISSION_000"
var mission_id := ""
var seed_value = null
var max_steps := 2000
var step := 0
var state := {}
var goals := []

static func wants_studio(args: PackedStringArray) -> bool:
	for a in args:
		if a.begins_with("--mccluster-scenario="):
			return true
	return false

func emit_event(payload: Dictionary) -> void:
	print("MCCLUSTER_EVENT " + JSON.stringify(payload))

func parse_args(args: PackedStringArray) -> void:
	for arg in args:
		if arg.begins_with("--mccluster-scenario="):
			scenario_id = arg.get_slice("=", 1)
		elif arg.begins_with("--mccluster-seed="):
			seed_value = int(arg.get_slice("=", 1))
		elif arg.begins_with("--mccluster-max-steps="):
			max_steps = clampi(int(arg.get_slice("=", 1)), 1, 100000)
		elif arg.begins_with("--mccluster-mission="):
			mission_id = arg.get_slice("=", 1)

func goal(name: String) -> void:
	if not goals.has(name):
		goals.append(name)

func snapshot() -> Dictionary:
	var squad := []
	for u in state.units:
		squad.append({"id": u.id, "faction": u.faction, "role": u.role, "x": u.x, "y": u.y, "hp": u.hp, "ap": u.ap,
			"ammo": u.ammo, "concealed": u.concealed, "overwatch": u.overwatch, "downed": u.downed, "dead": u.dead,
			"extracted": R.is_extracted(u)})
	return {
		"scenario": scenario_id, "mission": state.missionId, "seed": state.rng.seed, "step": step,
		"round": state.round, "phase": state.phase, "clock": state.mission.clock, "escalation": state.mission.escalation,
		"alerted": state.alerted, "nodes": state.nodes.map(func(n): return {"id": n.id, "state": n.state}),
		"units": squad
	}

func observation(summary: String) -> void:
	emit_event({
		"kind": "observation", "t_ms": Time.get_ticks_msec(),
		"state_ref": "inline://prim3-desktop/%s/%d" % [state.missionId, step],
		"frame_ref": "headless://prim3-desktop/%s/%d" % [state.missionId, step],
		"summary": summary, "state": snapshot()
	})

func action_event(type_name: String, target: String, result: String, params := {}) -> void:
	step += 1
	emit_event({"kind": "action", "t_ms": Time.get_ticks_msec(), "type": type_name, "target": target, "params": params, "result": result})

func pick_mission(missions: Array) -> Dictionary:
	var want := mission_id if mission_id != "" else scenario_id
	for m in missions:
		if m.id == want:
			return m
	return missions[0]

func _act(action: Dictionary) -> Dictionary:
	var before_alive: int = state.units.filter(func(u): return u.faction == "THREAT" and not u.dead).size()
	var res: Dictionary = AI.apply(state, action)
	var kind := String(action.type)
	var target := String(action.get("target", action.get("node", action.unit)))
	var params := {"unit": action.unit}
	if action.has("to"):
		params.to = {"x": action.to.x, "y": action.to.y}
	var result := "ok" if res.ok else "refused: %s" % res.get("error", "")
	if kind == "fire" and res.ok:
		kind = "attack"
		params.hit_chance = res.hitChance
		params.damage = res.damage
		result = ("crit" if res.critical else "hit") if res.hit else "miss"
	elif kind == "tech" and res.ok:
		params.action = action.action
		result = String(res.nodeState)
	action_event(kind, target, result, params)
	if res.ok and (kind == "move" or kind == "dash"):
		goal("move using action points")
	var after_alive: int = state.units.filter(func(u): return u.faction == "THREAT" and not u.dead).size()
	if after_alive < before_alive:
		goal("resolve hostile")
	if kind == "tech" and res.ok and res.nodeState == "VERIFIED":
		goal("complete objective")
	if kind == "extract" and res.ok:
		goal("extract squad")
	return res

func run(missions: Array, args: PackedStringArray) -> int:
	parse_args(args)
	var mission := pick_mission(missions)
	state = R.create_state(mission, seed_value)
	R.begin_player_phase(state)
	observation("mission_ready")
	var selected := {}
	var outcome := ""
	var guard := 0
	while outcome == "" and step < max_steps and guard < 400:
		guard += 1
		# player phase
		for u in state.units:
			if u.faction != "PLAYER":
				continue
			var memo := {}
			for _i in 8:
				var a = AI.next_player_action(state, u, memo)
				if a == null:
					break
				if not selected.has(u.id):
					selected[u.id] = true
					action_event("select_unit", u.id, "selected")
					goal("select a unit")
				var res := _act(a)
				if not res.ok:
					AI.apply(state, {"type": "end", "unit": u.id})
				outcome = R.outcome(state)
				if outcome != "" or step >= max_steps:
					break
			if outcome != "" or step >= max_steps:
				break
		if outcome != "" or step >= max_steps:
			break
		action_event("end_turn", "player", "enemy_turn_started")
		observation("player_phase_complete")
		R.begin_threat_phase(state)
		for t in state.units:
			if t.faction == "PLAYER":
				continue
			var memo := {}
			for _i in 6:
				var a = AI.next_threat_action(state, t, memo)
				if a == null:
					break
				var res: Dictionary = AI.apply(state, a)
				if not res.ok:
					AI.apply(state, {"type": "end", "unit": t.id})
			outcome = R.outcome(state)
			if outcome != "":
				break
		if outcome == "":
			goal("survive enemy turn")
			R.resolve_clock(state)
			outcome = R.outcome(state)
			observation("enemy_turn_completed")
			if outcome == "":
				R.begin_player_phase(state)
	observation("mission_%s" % (outcome if outcome != "" else "unfinished"))
	var failed := []
	if outcome != "win":
		failed.append(outcome if outcome != "" else "step budget")
	emit_event({
		"kind": "terminal",
		"status": "completed" if failed.is_empty() else "failed",
		"reason": "PRIM3 desktop mission %s: %s" % [state.missionId, outcome if outcome != "" else "step budget exceeded"],
		"completed_goals": goals, "failed_goals": failed,
		"elapsed_ms": Time.get_ticks_msec(),
		"mission": state.missionId, "rounds": state.round, "outcome": outcome
	})
	return 0 if failed.is_empty() else 2
