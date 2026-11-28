extends SceneTree
## Headless rules tests for PRIM3 desktop:  godot --headless --path PRIM3/desktop -s res://tests/run_tests.gd
## The dice and shot numbers are checked against tests/resolver-vectors.json, which
## scripts/test/prim3-desktop.test.mjs generates from the web resolver and keeps in sync.

const R := preload("res://scripts/rules.gd")
const AI := preload("res://scripts/ai.gd")
const Studio := preload("res://scripts/studio.gd")

var failures := 0
var passes := 0

func check(cond: bool, name: String) -> void:
	if cond:
		passes += 1
	else:
		failures += 1
		printerr("FAIL: " + name)

func mission(map: Array, extra := {}) -> Dictionary:
	var m := {
		"id": "test", "title": "Test", "level": "T", "clock": 6, "seed": 1, "concealed": false, "extractionRequired": true,
		"map": map,
		"squad": [{"id": "E1", "role": "E", "hp": 8, "aim": 72, "moveRange": 6}, {"id": "T1", "role": "T", "hp": 6, "aim": 62, "moveRange": 6}],
		"hostiles": [{"id": "H1", "hp": 5, "aim": 60, "moveRange": 5, "detectionRadius": 3}],
		"nodes": []
	}
	m.merge(extra, true)
	return m

func _init() -> void:
	var vectors = JSON.parse_string(FileAccess.get_file_as_string("res://tests/resolver-vectors.json"))
	# dice
	for v in vectors.rolls:
		var got := []
		for n in 8:
			got.append(R.roll_at(int(v.seed), n))
		check(got == v.rolls.map(func(x): return int(x)), "rollAt matches the resolver for seed %d (%s vs %s)" % [int(v.seed), got, v.rolls])
	# shot previews
	var open_map := []
	for y in 16:
		open_map.append(".".repeat(16))
	for c in vectors.previews:
		var s := R.create_state(mission(open_map))
		s.cover = {}
		if c.cover != null:
			s.cover[R._k(int(c.t.x), int(c.t.y))] = {"type": c.cover.type, "sides": c.cover.sides}
		var a: Dictionary = s.units[0]
		var t: Dictionary = s.units[2]
		a.x = int(c.a.x)
		a.y = int(c.a.y)
		a.aim = int(c.a.aim)
		a.crit = int(c.a.crit)
		t.x = int(c.t.x)
		t.y = int(c.t.y)
		t.hunkered = bool(c.get("hunkered", false))
		s.units[1].x = 15
		s.units[1].y = 15
		var p := R.shot_preview(s, a, t)
		check(p.legal and int(p.hitChance) == int(c.expect.hitChance), "hit chance %s vs %s for %s" % [p.get("hitChance"), c.expect.hitChance, c])
		check(int(p.critChance) == int(c.expect.critChance), "crit chance %s vs %s" % [p.get("critChance"), c.expect.critChance])
		check(String(p.cover) == String(c.expect.cover) and bool(p.flanked) == bool(c.expect.flanked), "cover %s/%s vs %s/%s" % [p.cover, p.flanked, c.expect.cover, c.expect.flanked])
		check(int(R.shot_preview(s, a, t, true).hitChance) == int(c.reactionHitChance), "reaction hit chance")

	# walls block sight, low cover does not
	var s2 := R.create_state(mission([
		"P.#.H",
		"P....",
		".....",
		"..l..",
		"....."]))
	var e1: Dictionary = s2.units[0]
	var h1: Dictionary = s2.units[2]
	check(not R.has_line_of_sight(s2, e1, h1), "a wall blocks the line of sight")
	h1.x = 2
	h1.y = 4
	e1.x = 2
	e1.y = 2
	check(R.has_line_of_sight(s2, e1, h1), "low cover does not block the line of sight")
	check(s2.cover.has(R._k(2, 4)) and s2.cover[R._k(2, 4)].type == "LOW" and s2.cover[R._k(2, 4)].sides.has("N"), "low cover is derived beside a low object")

	# move and dash costs
	var s3 := R.create_state(mission([
		"P.........",
		"P.........",
		"..........",
		".........H"]))
	R.begin_player_phase(s3)
	var m1 := R.move_unit(s3, "E1", Vector2i(6, 0))
	check(m1.ok and s3.units[0].x == 6 and int(s3.units[0].ap) == 1, "MOVE costs 1 AP within move range")
	var m2 := R.move_unit(s3, "E1", Vector2i(9, 2), true)
	check(not m2.ok, "DASH needs 2 AP")
	var m3 := R.move_unit(s3, "T1", Vector2i(9, 2), true)
	check(m3.ok and int(s3.units[1].ap) == 0, "DASH covers twice the range for 2 AP")

	# overwatch reaction
	var s4 := R.create_state(mission([
		"P.........",
		"P.........",
		"..........",
		"H........."]))
	R.begin_player_phase(s4)
	R.overwatch(s4, "E1")
	R.begin_threat_phase(s4)
	R.move_unit(s4, "H1", Vector2i(3, 3))
	var shots: Array = s4.events.filter(func(e): return e.type == "OVERWATCH_SHOT")
	check(shots.size() == 1 and not s4.units[0].overwatch, "overwatch fires once at a mover in sight")

	# objective, gate and extraction
	var s5 := R.create_state(mission([
		"P1Pg..",
		"...g.X",
		"...g.."], {"nodes": [{"id": "N", "label": "Node", "cell": "1", "state": "LOCKED", "required": true, "range": 1, "roles": ["T"], "opens": ["gates"],
			"actions": {"LOCKED": {"BREACH": {"next": "OPEN", "apCost": 1}}, "OPEN": {"VERIFY": {"next": "VERIFIED", "apCost": 1}}}}]}))
	s5.units[2].x = 0
	s5.units[2].y = 2
	s5.units[2].dead = true
	R.begin_player_phase(s5)
	check(not R.technical_action(s5, "E1", "N", "BREACH").ok, "only the Technical runs the node")
	check(R.technical_action(s5, "T1", "N", "BREACH").ok, "BREACH from an adjacent tile")
	check(not R.technical_action(s5, "T1", "N", "BREACH").ok, "BREACH is not available once OPEN")
	check(R.technical_action(s5, "T1", "N", "VERIFY").ok and R.required_nodes_done(s5), "VERIFY completes the node")
	check(s5.gates.is_empty() and not R.blocked(s5, 3, 0), "verifying the node opens the gate")
	R.begin_player_phase(s5)
	check(R.move_unit(s5, "E1", Vector2i(5, 1)).ok, "the opened gate can be walked through")
	check(R.extract(s5, "E1").ok, "extract from the zone")
	check(R.outcome(s5) == "", "the mission is not won while an operative is still inside")
	R.move_unit(s5, "T1", Vector2i(5, 1))
	R.extract(s5, "T1")
	check(R.outcome(s5) == "win", "every survivor out with the objective verified wins")

	# extraction is refused before the objective
	var s6 := R.create_state(mission(["PX1", "P.."], {"nodes": [{"id": "N", "label": "Node", "cell": "1", "state": "LOCKED", "required": true, "actions": {"LOCKED": {"BREACH": {"next": "VERIFIED"}}}}]}))
	R.begin_player_phase(s6)
	R.move_unit(s6, "E1", Vector2i(1, 0))
	check(not R.extract(s6, "E1").ok, "no extraction before the objective is done")

	# clock escalation
	var s7 := R.create_state(mission(["P..", "P.H"]))
	var seen := []
	for i in 6:
		R.resolve_clock(s7)
		seen.append(s7.mission.escalation)
	check(seen == ["DEGRADED", "DEGRADED", "DEGRADED", "CRITICAL", "CRITICAL", "TERMINAL"], "clock escalation %s" % [seen])
	check(R.outcome(s7) == "lose-clock", "a terminal clock loses the mission")

	# downed, stabilised
	var s8 := R.create_state(mission(["PP", ".."]))
	s8.units[1].hp = 0
	s8.units[1].downed = true
	R.begin_player_phase(s8)
	check(R.stabilize(s8, "E1", "T1").ok and not s8.units[1].downed and int(s8.units[1].hp) == 1, "stabilise gets a downed operative up")

	# the studio playtest is deterministic
	var missions: Array = load("res://scripts/main.gd").load_missions()
	check(missions.size() >= 3, "three missions ship")
	for m in missions:
		var st := R.create_state(m)
		check(st.units.filter(func(u): return u.faction == "PLAYER").size() == m.squad.size(), "%s places the whole squad" % m.id)
		check(st.nodes.all(func(n): return int(n.at.x) >= 0), "%s places its objective" % m.id)
		var field := AI.distance_field(st, Vector2i(int(st.extraction.cells[0].x), int(st.extraction.cells[0].y)))
		# with every gate open, the extraction zone is reachable from the squad's start
		for k in st.gates:
			st.blockers.erase(k)
		field = AI.distance_field(st, Vector2i(int(st.extraction.cells[0].x), int(st.extraction.cells[0].y)))
		check(field.has(Vector2i(int(st.units[0].x), int(st.units[0].y))), "%s: the extraction zone is reachable" % m.id)

	print("PRIM3 desktop rules tests: %d passed, %d failed" % [passes, failures])
	quit(1 if failures else 0)
