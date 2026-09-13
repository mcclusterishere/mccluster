extends Node

var scenario_id := "TEST_MISSION_000"
var seed_value := 0
var max_steps := 200
var step := 0
var ap := 2
var enemy_hp := 2
var extracted := false
var selected := false
var in_cover := false
var completed_goals: Array[String] = []

func emit_event(payload: Dictionary) -> void:
	print("MCCLUSTER_EVENT " + JSON.stringify(payload))

func parse_args() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--mccluster-scenario="):
			scenario_id = arg.get_slice("=", 1)
		elif arg.begins_with("--mccluster-seed="):
			seed_value = int(arg.get_slice("=", 1))
		elif arg.begins_with("--mccluster-max-steps="):
			max_steps = clampi(int(arg.get_slice("=", 1)), 1, 100000)

func observation(summary: String) -> void:
	emit_event({
		"kind": "observation",
		"t_ms": Time.get_ticks_msec(),
		"state_ref": "inline://sandbox/%d" % step,
		"frame_ref": "headless://sandbox/%d" % step,
		"summary": summary,
		"state": {
			"scenario": scenario_id,
			"seed": seed_value,
			"step": step,
			"ap": ap,
			"enemy_hp": enemy_hp,
			"selected": selected,
			"in_cover": in_cover,
			"extracted": extracted
		}
	})

func action(type_name: String, target: String, result: String, params := {}) -> void:
	step += 1
	emit_event({
		"kind": "action",
		"t_ms": Time.get_ticks_msec(),
		"type": type_name,
		"target": target,
		"params": params,
		"result": result
	})

func run_scenario() -> void:
	observation("sandbox_ready")
	selected = true
	action("select_unit", "alpha-1", "selected")
	completed_goals.append("select a unit")
	observation("unit_selected")

	ap -= 1
	action("move", "cover-a", "moved", {"ap_cost": 1})
	completed_goals.append("move using action points")
	in_cover = true
	observation("unit_in_cover")

	action("end_turn", "player", "enemy_turn_started")
	ap = 2
	observation("enemy_turn_completed")
	completed_goals.append("survive enemy turn")

	ap -= 1
	enemy_hp -= 1
	action("attack", "hostile-1", "hit", {"damage": 1, "ap_cost": 1})
	observation("hostile_damaged")

	ap -= 1
	enemy_hp -= 1
	action("attack", "hostile-1", "eliminated", {"damage": 1, "ap_cost": 1})
	completed_goals.append("resolve hostile")
	observation("hostile_eliminated")

	extracted = true
	action("extract", "zone-alpha", "mission_complete")
	completed_goals.append("extract squad")
	observation("mission_complete")

	var failed: Array[String] = []
	if step > max_steps:
		failed.append("step budget")
	emit_event({
		"kind": "terminal",
		"status": "completed" if failed.is_empty() else "failed",
		"reason": "deterministic tactical sandbox completed" if failed.is_empty() else "step budget exceeded",
		"completed_goals": completed_goals,
		"failed_goals": failed,
		"elapsed_ms": Time.get_ticks_msec()
	})
	get_tree().quit(0 if failed.is_empty() else 2)

func _ready() -> void:
	parse_args()
	call_deferred("run_scenario")
