class_name Prim3AI
extends RefCounted
## Deterministic decisions for both sides, one action at a time, so the board can animate each one.
##
## Threat side: the policy of js/prim3-tactics/tactical-threat-ai.mjs (fire at >= 50 %, reload an empty
## magazine, move to the best scored tile, then fire or overwatch; unaware threats walk their patrol
## and never shoot). DESKTOP: an awake threat sees an operative who is not concealed anywhere in its
## line of sight within the squad's sight range, not only inside its detection radius, and an awake
## threat that loses contact hunts towards where it last saw the squad (see update_awareness).
##
## Player side (autopilot): used by the headless McCluster game-studio playtest and by the "Auto"
## button. It plays the mission's real rules: stabilise, extract, run the objective, shoot, reload,
## then move towards the objective or the extraction zone, preferring cover.

const R := preload("res://scripts/rules.gd")
const FIRE_THRESHOLD := 50
const KEEP_DISTANCE := 3

static func apply(state: Dictionary, action: Dictionary) -> Dictionary:
	match String(action.type):
		"move":
			return R.move_unit(state, action.unit, action.to, false)
		"dash":
			return R.move_unit(state, action.unit, action.to, true)
		"fire":
			return R.fire(state, action.unit, action.target)
		"overwatch":
			return R.overwatch(state, action.unit)
		"hunker":
			return R.hunker(state, action.unit)
		"reload":
			return R.reload_weapon(state, action.unit)
		"stabilize":
			return R.stabilize(state, action.unit, action.target)
		"tech":
			return R.technical_action(state, action.unit, action.node, action.action)
		"extract":
			return R.extract(state, action.unit)
		"end":
			var u = R.unit_by_id(state, action.unit)
			if u != null:
				u.ap = 0
			return {"ok": true}
	return {"ok": false, "error": "unknown action %s" % action.type}

# ---------- threat side ----------

## DESKTOP: awareness is per hostile, so guards activate in groups rather than all at once. A guard
## wakes when it sees an operative who is not concealed, when it or a guard within 6 tiles is shot at,
## or when an awake guard within 6 tiles can see the squad. The resolver shares one alert network.
const WAKE_RADIUS := 6

static func _sees(state: Dictionary, t: Dictionary, p: Dictionary) -> bool:
	if p.concealed:
		return R.detects(state, t, p)
	return R.grid_distance(t, p) <= R.SIGHT_RANGE and R.has_line_of_sight(state, t, p)

static func _targets(state: Dictionary) -> Array:
	return state.units.filter(func(p): return p.faction == "PLAYER" and not p.dead and not p.downed and not R.is_extracted(p))

static func update_awareness(state: Dictionary, threat: Dictionary) -> bool:
	if threat.get("aware", false):
		return true
	var wake := false
	for e in state.events:
		if e.type != "FIRE" and e.type != "OVERWATCH_SHOT":
			continue
		var target = R.unit_by_id(state, String(e.targetId))
		if target != null and target.faction != "PLAYER" and (target.id == threat.id or R.grid_distance(target, threat) <= WAKE_RADIUS):
			wake = true
	if not wake:
		for p in _targets(state):
			if _sees(state, threat, p):
				wake = true
				break
	if not wake:
		for ally in state.units:
			if ally.faction == "PLAYER" or ally.id == threat.id or not R.alive(ally) or not ally.get("aware", false):
				continue
			if R.grid_distance(ally, threat) <= WAKE_RADIUS and _targets(state).any(func(p): return _sees(state, ally, p)):
				wake = true
				break
	if wake:
		threat.aware = true
		state.events.append({"type": "THREAT_AWARE", "unitId": threat.id, "round": state.round})
	return wake

## The operatives this hostile knows about: those it or a nearby awake guard can see, plus anyone who
## shot at the threat side this round.
static func known_players(state: Dictionary, threat = null) -> Array:
	var known := []
	var shooters := {}
	for e in state.events:
		if int(e.get("round", -1)) == int(state.round) and (e.type == "FIRE" or e.type == "OVERWATCH_SHOT"):
			shooters[String(e.get("attackerId", e.get("watcherId", "")))] = true
	var eyes := []
	for t in state.units:
		if t.faction == "PLAYER" or not R.alive(t) or not t.get("aware", false):
			continue
		if threat == null or t.id == threat.id or R.grid_distance(t, threat) <= WAKE_RADIUS:
			eyes.append(t)
	for p in _targets(state):
		if shooters.has(p.id):
			known.append(p)
			continue
		for t in eyes:
			if _sees(state, t, p):
				known.append(p)
				break
	return known

static func _best_shot(state: Dictionary, unit: Dictionary, targets: Array) -> Dictionary:
	var best := {}
	for t in targets:
		if t.dead or R.is_extracted(t):
			continue
		var p := R.shot_preview(state, unit, t)
		if p.legal and (best.is_empty() or int(p.hitChance) > int(best.hitChance) or (int(p.hitChance) == int(best.hitChance) and String(t.id) < String(best.target))):
			p.target = t.id
			best = p
	return best

static func _nearest(unit: Dictionary, targets: Array):
	var best = null
	var bd := 1 << 30
	for t in targets:
		var d := R.grid_distance(unit, t)
		if d < bd:
			bd = d
			best = t
	return best

static func _tile_score(state: Dictionary, unit: Dictionary, tile: Vector2i, known: Array) -> float:
	var ox := int(unit.x)
	var oy := int(unit.y)
	unit.x = tile.x
	unit.y = tile.y
	var score := 0.0
	var nearest = _nearest(unit, known)
	if nearest != null:
		var cover := R.cover_for_attack(state, unit, nearest)
		if cover.type == "HIGH":
			score += 3.0
		elif cover.type == "LOW":
			score += 2.0
	var shot := _best_shot(state, unit, known)
	if not shot.is_empty():
		score += 2.0 + float(shot.hitChance) / 100.0
	var keeps := true
	for p in known:
		if R.grid_distance(unit, p) < KEEP_DISTANCE:
			keeps = false
	score += 1.0 if keeps else -2.0
	unit.x = ox
	unit.y = oy
	return score

static func next_threat_action(state: Dictionary, unit: Dictionary, memo: Dictionary):
	if not R.alive(unit) or int(unit.ap) <= 0:
		return null
	var aware := update_awareness(state, unit)
	var known := known_players(state, unit) if aware else []
	if not known.is_empty():
		var seen_at = _nearest(unit, known)
		unit.lastKnown = {"x": seen_at.x, "y": seen_at.y}
	if known.is_empty() and aware and unit.get("lastKnown") != null and not memo.get("moved", false):
		# awake but lost contact: hunt towards where the squad was last seen
		memo.moved = true
		var lk: Dictionary = unit.lastKnown
		var hunt := _step_towards(state, unit, Vector2i(int(lk.x), int(lk.y)), int(unit.moveRange), true)
		if hunt == Vector2i(int(unit.x), int(unit.y)) or R.grid_distance(unit, lk) <= 1:
			unit.lastKnown = null
		if hunt != Vector2i(int(unit.x), int(unit.y)):
			return {"type": "move", "unit": unit.id, "to": hunt}
	if known.is_empty() and aware:
		return {"type": "overwatch", "unit": unit.id} if int(unit.ammo) > 0 and not memo.get("fired", false) else {"type": "end", "unit": unit.id}
	if known.is_empty():
		if memo.get("moved", false) or unit.patrol.is_empty():
			return {"type": "end", "unit": unit.id}
		var goal: Dictionary = unit.patrol[int(unit.patrolIndex) % unit.patrol.size()]
		if int(goal.x) == int(unit.x) and int(goal.y) == int(unit.y):
			unit.patrolIndex = int(unit.patrolIndex) + 1
			goal = unit.patrol[int(unit.patrolIndex) % unit.patrol.size()]
		var step := _step_towards(state, unit, Vector2i(int(goal.x), int(goal.y)), int(unit.moveRange))
		memo.moved = true
		if step == Vector2i(int(unit.x), int(unit.y)):
			return {"type": "end", "unit": unit.id}
		return {"type": "move", "unit": unit.id, "to": step}
	var shot := _best_shot(state, unit, known)
	if not shot.is_empty() and int(shot.hitChance) >= FIRE_THRESHOLD:
		memo.fired = true
		return {"type": "fire", "unit": unit.id, "target": shot.target}
	if memo.get("fired", false):
		return {"type": "end", "unit": unit.id}
	if int(unit.ammo) <= 0:
		if int(unit.reserveAmmo) > 0 and not memo.get("reloaded", false):
			memo.reloaded = true
			return {"type": "reload", "unit": unit.id}
		return {"type": "hunker", "unit": unit.id}
	if not memo.get("moved", false):
		memo.moved = true
		var reach := R.compute_reach(state, unit, int(unit.moveRange))
		var here := Vector2i(int(unit.x), int(unit.y))
		var best_tile := here
		var best_score := _tile_score(state, unit, here, known)
		var best_cost := 0
		var tiles: Array = reach.cost.keys()
		tiles.sort_custom(func(a, b): return a.y < b.y or (a.y == b.y and a.x < b.x))
		for tile in tiles:
			if tile == here:
				continue
			var s := _tile_score(state, unit, tile, known)
			var c: int = reach.cost[tile]
			if s > best_score + 0.001 or (absf(s - best_score) <= 0.001 and c < best_cost):
				best_score = s
				best_tile = tile
				best_cost = c
		# nothing worth shooting from anywhere in reach: close the distance instead
		if _best_shot_from(state, unit, best_tile, known).is_empty():
			var target = _nearest(unit, known)
			best_tile = _step_towards(state, unit, Vector2i(int(target.x), int(target.y)), int(unit.moveRange))
		if best_tile != here:
			return {"type": "move", "unit": unit.id, "to": best_tile}
	if not shot.is_empty():
		memo.fired = true
		return {"type": "fire", "unit": unit.id, "target": shot.target}
	return {"type": "overwatch", "unit": unit.id}

static func _best_shot_from(state: Dictionary, unit: Dictionary, tile: Vector2i, known: Array) -> Dictionary:
	var ox := int(unit.x)
	var oy := int(unit.y)
	unit.x = tile.x
	unit.y = tile.y
	var shot := _best_shot(state, unit, known)
	unit.x = ox
	unit.y = oy
	return shot

## Distance field from a goal over open floor (walls block, units do not).
static func distance_field(state: Dictionary, goal: Vector2i) -> Dictionary:
	var dist := {goal: 0}
	var frontier := [goal]
	while frontier.size():
		var cur: Vector2i = frontier.pop_front()
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var n: Vector2i = cur + d
			if dist.has(n) or not R.in_bounds(state, n.x, n.y):
				continue
			if R.blocked(state, n.x, n.y) and n != goal:
				continue
			dist[n] = dist[cur] + 1
			frontier.append(n)
	return dist

static func _step_towards(state: Dictionary, unit: Dictionary, goal: Vector2i, max_cost: int, prefer_cover := false) -> Vector2i:
	var field := distance_field(state, goal)
	var reach := R.compute_reach(state, unit, max_cost)
	var here := Vector2i(int(unit.x), int(unit.y))
	var best := here
	var best_score := INF
	var tiles: Array = reach.cost.keys()
	tiles.sort_custom(func(a, b): return a.y < b.y or (a.y == b.y and a.x < b.x))
	for tile in tiles:
		if not field.has(tile):
			continue
		var s := float(field[tile])
		if prefer_cover:
			var cov = state.cover.get(R._k(tile.x, tile.y))
			if cov != null:
				s -= 1.5 if cov.type == "HIGH" else 0.75
		if s < best_score - 0.001:
			best_score = s
			best = tile
	return best

# ---------- player side (autopilot) ----------

static func player_goal(state: Dictionary, unit: Dictionary) -> Vector2i:
	var hurt_unit = null
	var hd := 1 << 30
	for o in state.units:
		if o.faction == "PLAYER" and o.downed and not o.dead and o.id != unit.id and R.grid_distance(unit, o) < hd:
			hd = R.grid_distance(unit, o)
			hurt_unit = o
	if hurt_unit != null:
		return Vector2i(int(hurt_unit.x), int(hurt_unit.y))
	if not R.required_nodes_done(state):
		for n in state.nodes:
			if n.required and not ["VERIFIED", "SEALED_STABILIZED"].has(n.state):
				var at: Dictionary = n.at
				return Vector2i(int(at.x), int(at.y))
	var best := Vector2i(int(unit.x), int(unit.y))
	var bd := 1 << 30
	for c in state.extraction.get("cells", []):
		var d := absi(int(c.x) - int(unit.x)) + absi(int(c.y) - int(unit.y))
		if d < bd:
			bd = d
			best = Vector2i(int(c.x), int(c.y))
	return best

static func next_player_action(state: Dictionary, unit: Dictionary, memo: Dictionary):
	if not R.alive(unit) or int(unit.ap) <= 0:
		return null
	for other in state.units:
		if other.faction == "PLAYER" and other.downed and not other.dead and R.grid_distance(unit, other) <= 1:
			return {"type": "stabilize", "unit": unit.id, "target": other.id}
	if R.required_nodes_done(state) and R.in_extraction(state, unit):
		return {"type": "extract", "unit": unit.id}
	var techs := R.technical_options(state, unit)
	if techs.size():
		return {"type": "tech", "unit": unit.id, "node": techs[0].node, "action": techs[0].action}
	var hurt: bool = state.units.any(func(o): return o.faction == "PLAYER" and o.downed and not o.dead)
	if hurt and not memo.get("moved", false):
		memo.moved = true
		var to := _step_towards(state, unit, player_goal(state, unit), int(unit.moveRange), false)
		if to != Vector2i(int(unit.x), int(unit.y)):
			return {"type": "move", "unit": unit.id, "to": to}
	var seen: Array = state.units.filter(func(t): return t.faction == "THREAT" and R.alive(t) and R.visible_to_squad(state, t))
	var shot := _best_shot(state, unit, seen)
	var stealthy: bool = unit.concealed and not state.alerted
	if not stealthy and not shot.is_empty() and int(shot.hitChance) >= 55:
		return {"type": "fire", "unit": unit.id, "target": shot.target}
	if int(unit.ammo) <= 0 and int(unit.reserveAmmo) > 0:
		return {"type": "reload", "unit": unit.id}
	if not memo.get("moved", false):
		memo.moved = true
		var goal := player_goal(state, unit)
		var step := _step_towards(state, unit, goal, int(unit.moveRange), false) if seen.is_empty() else _advance_in_cover(state, unit, goal, seen)
		if step != Vector2i(int(unit.x), int(unit.y)):
			return {"type": "move", "unit": unit.id, "to": step}
	if not stealthy and not shot.is_empty():
		return {"type": "fire", "unit": unit.id, "target": shot.target}
	if not seen.is_empty() and int(unit.ammo) > 0:
		return {"type": "overwatch", "unit": unit.id}
	if int(unit.ap) >= 1 and not memo.get("moved2", false):
		memo.moved2 = true
		var goal2 := player_goal(state, unit)
		var step2 := _step_towards(state, unit, goal2, int(unit.moveRange), false)
		if step2 != Vector2i(int(unit.x), int(unit.y)):
			return {"type": "move", "unit": unit.id, "to": step2}
	return {"type": "end", "unit": unit.id}

## Under fire: the reachable tile with the best cover-and-shot score, nudged towards the goal.
static func _advance_in_cover(state: Dictionary, unit: Dictionary, goal: Vector2i, seen: Array) -> Vector2i:
	var field := distance_field(state, goal)
	var reach := R.compute_reach(state, unit, int(unit.moveRange))
	var here := Vector2i(int(unit.x), int(unit.y))
	var best := here
	var best_score := -INF
	var tiles: Array = reach.cost.keys()
	tiles.sort_custom(func(a, b): return a.y < b.y or (a.y == b.y and a.x < b.x))
	for tile in tiles:
		if not field.has(tile):
			continue
		var s := _tile_score(state, unit, tile, seen) - 0.35 * float(field[tile])
		if s > best_score + 0.001:
			best_score = s
			best = tile
	return best
