class_name Prim3Rules
extends RefCounted
## PRIM3 tactical rules for the desktop build.
##
## A GDScript port of the rule subset the desktop missions use, taken from the vendored PRIM3
## resolver (js/prim3-tactics/tactical-resolver.mjs, from mcclusterishere/Prim3). The numbers are the
## resolver's: 2 AP, MOVE 1 AP / DASH 2 AP at double range, cover HIGH 40 / LOW 20, flank +15 aim and
## +20 crit, range penalty 4 per tile past 6, hunker 20, overwatch reaction penalty 15, hit clamped to
## 5..95 and crit to 0..75, the mission clock's DEGRADED / CRITICAL / TERMINAL escalation, and the same
## deterministic dice (rollAt). Where this file differs from the resolver it says so in a comment
## marked DESKTOP, and PRIM3/desktop/README.md lists every difference.
##
## The state is a plain Dictionary so it serialises to the same JSON shapes the web build uses.
## Every action mutates the state it is given and returns {ok: bool, error: String, ...}.

const EYE_HEIGHT := 1.6
const REACTION_AIM_PENALTY := 15
const SIGHT_RANGE := 14 # DESKTOP: how far the squad can see a hostile (the web build draws the whole board)
const M32 := 0xFFFFFFFF

# ---------- dice: a port of rollAt() ----------

static func imul(a: int, b: int) -> int:
	a &= M32
	b &= M32
	var lo := (a & 0xFFFF) * b
	var hi := (((a >> 16) * b) & 0xFFFF) << 16
	return (lo + hi) & M32

static func roll_at(seed_value: int, n: int) -> int:
	var h := (imul(seed_value & M32, 0x9e3779b1) ^ imul((n + 1) & M32, 0x85ebca6b)) & M32
	h ^= h >> 16
	h = imul(h, 0x7feb352d)
	h ^= h >> 15
	h = imul(h, 0x846ca68b)
	h ^= h >> 16
	return (h & M32) % 100

static func draw(state: Dictionary) -> int:
	var rng: Dictionary = state.rng
	var value := roll_at(int(rng.seed), int(rng.n))
	rng.n = int(rng.n) + 1
	return value

# ---------- state ----------

static func create_state(mission: Dictionary, seed_override = null) -> Dictionary:
	var rows: Array = mission.map
	var height := rows.size()
	var width := 0
	for r in rows:
		width = maxi(width, String(r).length())
	var blockers := {}
	var spawns := {"P": [], "H": []}
	var extraction := []
	var node_cells := {}
	for y in height:
		var row := String(rows[y])
		for x in width:
			var c: String = row[x] if x < row.length() else "#"
			match c:
				"#": blockers[_k(x, y)] = {"h": 3.0, "kind": "WALL"}
				"h": blockers[_k(x, y)] = {"h": 2.0, "kind": "HIGH"}
				"l": blockers[_k(x, y)] = {"h": 1.0, "kind": "LOW"}
				"g": blockers[_k(x, y)] = {"h": 3.0, "kind": "GATE"}
				"P": spawns.P.append(Vector2i(x, y))
				"H": spawns.H.append(Vector2i(x, y))
				"X": extraction.append(Vector2i(x, y))
				_:
					if c >= "1" and c <= "9":
						node_cells[c] = Vector2i(x, y)
	var units := []
	var squad: Array = mission.squad
	for i in squad.size():
		var u: Dictionary = _unit(squad[i], "PLAYER")
		var at: Vector2i = spawns.P[i] if i < spawns.P.size() else Vector2i(1, 1)
		u.x = at.x
		u.y = at.y
		u.concealed = bool(mission.get("concealed", false))
		units.append(u)
	var hostiles: Array = mission.hostiles
	for i in hostiles.size():
		var h: Dictionary = _unit(hostiles[i], "THREAT")
		var at: Vector2i = spawns.H[i] if i < spawns.H.size() else Vector2i(width - 2, 1)
		h.x = at.x
		h.y = at.y
		h.canBeDowned = false
		var patrol := []
		for p in hostiles[i].get("patrol", []):
			patrol.append({"x": int(p[0]), "y": int(p[1]), "z": 0})
		h.patrol = patrol
		h.patrolIndex = 0
		h.aware = false
		h.lastKnown = null
		units.append(h)
	var nodes := []
	for n in mission.get("nodes", []):
		var at: Vector2i = node_cells.get(String(n.cell), Vector2i(-1, -1))
		blockers[_k(at.x, at.y)] = {"h": 1.0, "kind": "NODE"}
		nodes.append({
			"id": n.id, "label": n.label, "state": n.state, "required": bool(n.get("required", true)),
			"at": {"x": at.x, "y": at.y, "z": 0, "range": int(n.get("range", 1)), "roles": n.get("roles", ["T"])},
			"actions": n.actions, "opens": n.get("opens", [])
		})
	var gates := []
	for k in blockers.keys():
		if blockers[k].kind == "GATE":
			gates.append(k)
	var ex_x := 0
	var ex_y := 0
	for e in extraction:
		ex_x += e.x
		ex_y += e.y
	var zone := {}
	if extraction.size():
		zone = {"cells": extraction.map(func(e): return {"x": e.x, "y": e.y, "z": 0})}
	var state := {
		"schema": "prim3-desktop-state/0.1",
		"missionId": mission.id,
		"width": width, "height": height,
		"round": 0, "phase": "SETUP",
		"units": units,
		"blockers": blockers,
		"gates": gates,
		"cover": {},
		"nodes": nodes,
		"extraction": zone,
		"mission": {
			"clock": int(mission.get("clock", 10)),
			"escalation": "STABLE",
			"extractionRequired": bool(mission.get("extractionRequired", true)),
			"extractedUnitIds": []
		},
		"alerted": not bool(mission.get("concealed", false)),
		"rng": {"seed": int(seed_override if seed_override != null else mission.get("seed", 1)), "n": 0},
		"events": []
	}
	rebuild_cover(state)
	return state

static func _unit(src: Dictionary, faction: String) -> Dictionary:
	var hp := int(src.get("hp", 6))
	var ammo := int(src.get("ammo", 4))
	return {
		"id": String(src.id), "faction": faction, "role": src.get("role", null), "name": String(src.get("name", src.id)),
		"x": 0, "y": 0, "z": 0,
		"hp": hp, "maxHp": int(src.get("maxHp", hp)),
		"ap": 0, "maxAp": int(src.get("maxAp", 2)),
		"moveRange": int(src.get("moveRange", 6)),
		"aim": int(src.get("aim", 70)), "crit": int(src.get("crit", 10)),
		"weaponDamage": int(src.get("weaponDamage", 3)), "critBonus": int(src.get("critBonus", 2)),
		"ammo": ammo, "magazineSize": int(src.get("magazineSize", ammo)), "reserveAmmo": int(src.get("reserveAmmo", 8)),
		"detectionRadius": int(src.get("detectionRadius", 5)),
		"concealed": false, "overwatch": false, "hunkered": false,
		"downed": false, "dead": false, "canBeDowned": src.get("canBeDowned", true) != false,
		"statuses": []
	}

static func _k(x: int, y: int) -> String:
	return "%d:%d" % [x, y]

## Cover for every walkable tile, from the blockers beside it: a full-height wall or high object gives
## HIGH cover on that side, a low object LOW cover. DESKTOP: the web levels author cover tiles by hand;
## the desktop maps derive them, keeping the resolver's {type, sides} shape (type is the best cover on
## the tile, sides are the sides that carry it).
static func rebuild_cover(state: Dictionary) -> void:
	var cover := {}
	var dirs := {"N": Vector2i(0, -1), "E": Vector2i(1, 0), "S": Vector2i(0, 1), "W": Vector2i(-1, 0)}
	for y in state.height:
		for x in state.width:
			if state.blockers.has(_k(x, y)):
				continue
			var high := []
			var low := []
			for side in dirs:
				var d: Vector2i = dirs[side]
				var b = state.blockers.get(_k(x + d.x, y + d.y))
				if b == null:
					continue
				if float(b.h) > EYE_HEIGHT:
					high.append(side)
				else:
					low.append(side)
			if high.size():
				cover[_k(x, y)] = {"type": "HIGH", "sides": high}
			elif low.size():
				cover[_k(x, y)] = {"type": "LOW", "sides": low}
	state.cover = cover

# ---------- queries ----------

static func unit_by_id(state: Dictionary, id: String):
	for u in state.units:
		if u.id == id:
			return u
	return null

static func is_extracted(u: Dictionary) -> bool:
	return u.statuses.has("EXTRACTED")

static func alive(u: Dictionary) -> bool:
	return not u.dead and not u.downed and not is_extracted(u)

static func in_bounds(state: Dictionary, x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x < state.width and y < state.height

static func blocked(state: Dictionary, x: int, y: int) -> bool:
	return state.blockers.has(_k(x, y))

static func occupant(state: Dictionary, x: int, y: int, except_id := ""):
	for u in state.units:
		if u.dead or is_extracted(u) or u.id == except_id:
			continue
		if u.x == x and u.y == y:
			return u
	return null

static func grid_distance(a: Dictionary, b: Dictionary) -> int:
	return absi(int(a.x) - int(b.x)) + absi(int(a.y) - int(b.y))

## Bresenham cells strictly between a and b (the resolver's lineCells).
static func line_cells(a: Dictionary, b: Dictionary) -> Array:
	var cells := []
	var x0 := int(a.x)
	var y0 := int(a.y)
	var x1 := int(b.x)
	var y1 := int(b.y)
	var dx := absi(x1 - x0)
	var sx := 1 if x0 < x1 else -1
	var dy := -absi(y1 - y0)
	var sy := 1 if y0 < y1 else -1
	var err := dx + dy
	while not (x0 == x1 and y0 == y1):
		var e2 := 2 * err
		if e2 >= dy:
			err += dy
			x0 += sx
		if e2 <= dx:
			err += dx
			y0 += sy
		if not (x0 == x1 and y0 == y1):
			cells.append(Vector2i(x0, y0))
	return cells

## One floor: any blocker on the line blocks, except one low enough to see over (h <= eye height).
static func has_line_of_sight(state: Dictionary, a: Dictionary, b: Dictionary) -> bool:
	for c in line_cells(a, b):
		var wall = state.blockers.get(_k(c.x, c.y))
		if wall != null and float(wall.h) > EYE_HEIGHT:
			return false
	return true

static func source_side(target: Dictionary, attacker: Dictionary) -> String:
	var dx := int(attacker.x) - int(target.x)
	var dy := int(attacker.y) - int(target.y)
	if absi(dx) > absi(dy):
		return "E" if dx > 0 else "W"
	return "S" if dy > 0 else "N"

static func cover_for_attack(state: Dictionary, target: Dictionary, attacker: Dictionary) -> Dictionary:
	var cover = state.cover.get(_k(int(target.x), int(target.y)))
	if cover == null:
		return {"type": "NONE", "bonus": 0, "flanked": false}
	if not cover.sides.has(source_side(target, attacker)):
		return {"type": "NONE", "bonus": 0, "flanked": true, "underlying": cover.type}
	return {"type": cover.type, "bonus": 40 if cover.type == "HIGH" else 20, "flanked": false}

static func shot_preview(state: Dictionary, attacker: Dictionary, target: Dictionary, reaction := false) -> Dictionary:
	if attacker.dead or attacker.downed or is_extracted(attacker) or target.dead or is_extracted(target):
		return {"legal": false, "reason": "INVALID_UNIT_STATE"}
	if attacker.faction == target.faction:
		return {"legal": false, "reason": "FRIENDLY_TARGET"}
	if target.downed:
		return {"legal": false, "reason": "TARGET_DOWNED"} # DESKTOP: nobody shoots an operative who is already down
	if not has_line_of_sight(state, attacker, target):
		return {"legal": false, "reason": "NO_LINE_OF_SIGHT"}
	if int(attacker.ammo) <= 0:
		return {"legal": false, "reason": "EMPTY_MAGAZINE"}
	var distance := grid_distance(attacker, target)
	if attacker.has("weaponRange") and distance > int(attacker.weaponRange):
		return {"legal": false, "reason": "OUT_OF_RANGE"}
	var cover := cover_for_attack(state, target, attacker)
	var range_penalty := maxi(0, distance - 6) * 4
	var hunker_penalty := 20 if target.hunkered else 0
	var flank_bonus := 15 if cover.flanked else 0
	var reaction_penalty := REACTION_AIM_PENALTY if reaction else 0
	var chance := clampi(int(attacker.aim) - int(cover.bonus) - range_penalty - hunker_penalty + flank_bonus - reaction_penalty, 5, 95)
	var crit_chance := clampi(int(attacker.crit) + (20 if cover.flanked else 0), 0, 75)
	return {
		"legal": true, "hitChance": chance, "critChance": crit_chance,
		"damage": int(attacker.weaponDamage), "critDamage": int(attacker.weaponDamage) + int(attacker.critBonus),
		"cover": cover.type, "flanked": cover.flanked, "distance": distance
	}

static func detects(state: Dictionary, watcher: Dictionary, target: Dictionary) -> bool:
	return grid_distance(watcher, target) <= int(watcher.detectionRadius) and has_line_of_sight(state, watcher, target)

## Hostiles the squad can see right now. DESKTOP: fog of war for the 3D board.
static func visible_to_squad(state: Dictionary, target: Dictionary) -> bool:
	if target.faction == "PLAYER":
		return true
	if target.dead:
		return true
	for p in state.units:
		if p.faction != "PLAYER" or not alive(p):
			continue
		if grid_distance(p, target) <= SIGHT_RANGE and has_line_of_sight(state, p, target):
			return true
	return false

# ---------- reach and paths ----------

## Breadth-first reach from a unit. Units the mover's side can see block; hostiles the squad cannot
## see do not (a move into one is interrupted on contact, as in the resolver).
static func compute_reach(state: Dictionary, unit: Dictionary, max_cost: int) -> Dictionary:
	var start := Vector2i(int(unit.x), int(unit.y))
	var came := {start: start}
	var cost := {start: 0}
	var frontier := [start]
	var order := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]
	while frontier.size():
		var cur: Vector2i = frontier.pop_front()
		var c: int = cost[cur]
		if c >= max_cost:
			continue
		for d in order:
			var nx: Vector2i = cur + d
			if cost.has(nx) or not in_bounds(state, nx.x, nx.y) or blocked(state, nx.x, nx.y):
				continue
			var o = occupant(state, nx.x, nx.y, unit.id)
			if o != null and (unit.faction != "PLAYER" or o.faction == "PLAYER" or visible_to_squad(state, o)):
				continue
			cost[nx] = c + 1
			came[nx] = cur
			frontier.append(nx)
	return {"cost": cost, "came": came}

static func path_to(reach: Dictionary, dest: Vector2i) -> Array:
	if not reach.cost.has(dest):
		return []
	var path := []
	var cur := dest
	while reach.came[cur] != cur:
		path.push_front(cur)
		cur = reach.came[cur]
	return path

# ---------- actions ----------

static func _event(state: Dictionary, ev: Dictionary) -> void:
	ev.round = state.round
	state.events.append(ev)

static func _can_act(state: Dictionary, unit) -> String:
	if unit == null:
		return "Unknown unit"
	if not alive(unit):
		return "Unit cannot act"
	if state.phase != ("PLAYER" if unit.faction == "PLAYER" else "THREAT"):
		return "Not this side's phase"
	if int(unit.ap) <= 0:
		return "No action points left"
	return ""

static func begin_player_phase(state: Dictionary) -> void:
	state.round = int(state.round) + 1
	state.phase = "PLAYER"
	for u in state.units:
		if u.faction != "PLAYER" or not alive(u):
			continue
		u.ap = u.maxAp
		u.overwatch = false
		u.hunkered = false
	_event(state, {"type": "PLAYER_PHASE_BEGIN"})

static func begin_threat_phase(state: Dictionary) -> void:
	state.phase = "THREAT"
	for u in state.units:
		if u.faction == "PLAYER" or not alive(u):
			continue
		u.ap = u.maxAp
		u.overwatch = false
		u.hunkered = false
	_event(state, {"type": "THREAT_PHASE_BEGIN"})

static func resolve_clock(state: Dictionary) -> void:
	state.phase = "CLOCK_STATE"
	var m: Dictionary = state.mission
	m.clock = maxi(0, int(m.clock) - 1)
	if m.clock == 0:
		m.escalation = "TERMINAL"
	elif m.clock <= 2:
		m.escalation = "CRITICAL"
	elif m.clock <= 5 and m.escalation == "STABLE":
		m.escalation = "DEGRADED"
	_event(state, {"type": "CLOCK_STATE_RESOLVED", "clock": m.clock, "escalation": m.escalation})

static func _break_concealment(state: Dictionary, unit: Dictionary, reason: String) -> void:
	if unit.concealed:
		unit.concealed = false
		_event(state, {"type": "CONCEALMENT_BROKEN", "unitId": unit.id, "reason": reason})
	if not state.alerted:
		state.alerted = true
		_event(state, {"type": "ALERT", "by": unit.id})

static func _apply_hit(target: Dictionary, preview: Dictionary, roll: int, crit_roll: int) -> Dictionary:
	var hit := roll < int(preview.hitChance)
	var critical := hit and crit_roll < int(preview.critChance)
	var damage := 0
	if hit:
		damage = int(preview.critDamage) if critical else int(preview.damage)
		target.hp = maxi(0, int(target.hp) - damage)
		if target.hp <= 0:
			if target.canBeDowned and not target.downed:
				target.downed = true
			else:
				target.dead = true
			target.overwatch = false
	return {"hit": hit, "critical": critical, "damage": damage}

## Every opposing unit on overwatch with a legal shot at the mover's tile fires once.
static func _reactions(state: Dictionary, mover: Dictionary) -> bool:
	for w in state.units:
		if not w.overwatch or not alive(w) or w.faction == mover.faction:
			continue
		if mover.concealed:
			if not detects(state, w, mover):
				continue
			_break_concealment(state, mover, "DETECTION")
		var preview := shot_preview(state, w, mover, true)
		if not preview.legal:
			continue
		var r := draw(state)
		var cr := draw(state)
		w.overwatch = false
		w.ammo = int(w.ammo) - 1
		w.concealed = false
		var result := _apply_hit(mover, preview, r, cr)
		_event(state, {"type": "OVERWATCH_SHOT", "watcherId": w.id, "targetId": mover.id,
			"at": {"x": mover.x, "y": mover.y, "z": 0}, "hit": result.hit, "critical": result.critical,
			"damage": result.damage, "hitChance": preview.hitChance})
		if mover.dead or mover.downed:
			return true
	return false

static func _detected_now(state: Dictionary, mover: Dictionary) -> bool:
	for e in state.units:
		if e.faction == mover.faction or not alive(e):
			continue
		if detects(state, e, mover):
			return true
	return false

## MOVE (1 AP, move range) or DASH (2 AP, twice the range). Returns the tiles actually walked.
static func move_unit(state: Dictionary, unit_id: String, dest: Vector2i, dash := false) -> Dictionary:
	var unit = unit_by_id(state, unit_id)
	var err := _can_act(state, unit)
	if err != "":
		return {"ok": false, "error": err}
	var cost := 2 if dash else 1
	if int(unit.ap) < cost:
		return {"ok": false, "error": "Not enough action points"}
	if blocked(state, dest.x, dest.y):
		return {"ok": false, "error": "Destination is a wall"}
	var max_distance := int(unit.moveRange) * (2 if dash else 1)
	var reach := compute_reach(state, unit, max_distance)
	var path := path_to(reach, dest)
	if path.is_empty():
		return {"ok": false, "error": "No traversable path within movement range"}
	unit.ap = int(unit.ap) - cost
	var walked := []
	var interrupted = null
	var downed := false
	for step in path:
		if occupant(state, step.x, step.y, unit.id) != null:
			interrupted = step
			break
		unit.x = step.x
		unit.y = step.y
		walked.append(step)
		if _reactions(state, unit):
			downed = true
			break
	if unit.concealed and _detected_now(state, unit):
		_break_concealment(state, unit, "DETECTION")
	# a moving hostile spots a concealed operative inside its detection radius
	for other in state.units:
		if other.faction != unit.faction and other.concealed and alive(other) and alive(unit) and detects(state, unit, other):
			_break_concealment(state, other, "DETECTION")
	var walked_out := walked.map(func(c): return {"x": c.x, "y": c.y, "z": 0})
	if interrupted != null:
		_event(state, {"type": "MOVE_INTERRUPTED", "unitId": unit.id, "path": walked_out, "blockedAt": {"x": interrupted.x, "y": interrupted.y, "z": 0}})
		# contact: whoever was hiding there is now seen
		var hidden = occupant(state, interrupted.x, interrupted.y, unit.id)
		if hidden != null and hidden.faction != unit.faction:
			_break_concealment(state, unit, "CONTACT")
	else:
		_event(state, {"type": "DASH" if dash else "MOVE", "unitId": unit.id, "path": walked_out, "apRemaining": unit.ap, "interrupted": "OVERWATCH" if downed else null})
	return {"ok": true, "path": walked, "interrupted": interrupted != null, "downed": downed}

static func fire(state: Dictionary, attacker_id: String, target_id: String) -> Dictionary:
	var a = unit_by_id(state, attacker_id)
	var t = unit_by_id(state, target_id)
	var err := _can_act(state, a)
	if err != "":
		return {"ok": false, "error": err}
	if t == null:
		return {"ok": false, "error": "Unknown target"}
	var preview := shot_preview(state, a, t)
	if not preview.legal:
		return {"ok": false, "error": preview.reason}
	a.ap = int(a.ap) - 1
	a.ammo = int(a.ammo) - 1
	var r := draw(state)
	var cr := draw(state)
	_break_concealment(state, a, "FIRED")
	var result := _apply_hit(t, preview, r, cr)
	_event(state, {"type": "FIRE", "attackerId": a.id, "targetId": t.id, "hit": result.hit, "critical": result.critical,
		"damage": result.damage, "hitChance": preview.hitChance})
	var out := preview.duplicate()
	out.merge(result, true)
	out.ok = true
	return out

static func overwatch(state: Dictionary, unit_id: String) -> Dictionary:
	var u = unit_by_id(state, unit_id)
	var err := _can_act(state, u)
	if err != "":
		return {"ok": false, "error": err}
	if int(u.ammo) <= 0:
		return {"ok": false, "error": "EMPTY_MAGAZINE"}
	u.ap = int(u.ap) - 1
	u.overwatch = true
	u.ap = 0 # DESKTOP: overwatch ends the activation, as players expect; the resolver spends 1 AP
	_event(state, {"type": "OVERWATCH_SET", "unitId": u.id})
	return {"ok": true}

static func hunker(state: Dictionary, unit_id: String) -> Dictionary:
	var u = unit_by_id(state, unit_id)
	var err := _can_act(state, u)
	if err != "":
		return {"ok": false, "error": err}
	u.ap = int(u.ap) - 1
	u.hunkered = true
	_event(state, {"type": "HUNKER", "unitId": u.id})
	return {"ok": true}

static func reload_weapon(state: Dictionary, unit_id: String) -> Dictionary:
	var u = unit_by_id(state, unit_id)
	var err := _can_act(state, u)
	if err != "":
		return {"ok": false, "error": err}
	var needed := maxi(0, int(u.magazineSize) - int(u.ammo))
	if needed == 0 or int(u.reserveAmmo) == 0:
		return {"ok": false, "error": "Nothing to reload"}
	u.ap = int(u.ap) - 1
	var loaded := mini(needed, int(u.reserveAmmo))
	u.ammo = int(u.ammo) + loaded
	u.reserveAmmo = int(u.reserveAmmo) - loaded
	_event(state, {"type": "RELOAD", "unitId": u.id, "loaded": loaded, "ammo": u.ammo, "reserveAmmo": u.reserveAmmo})
	return {"ok": true}

## DESKTOP: a stabilised operative gets back up with 1 HP so the squad can still walk out. In the
## resolver STABILIZE only marks the status.
static func stabilize(state: Dictionary, actor_id: String, target_id: String) -> Dictionary:
	var a = unit_by_id(state, actor_id)
	var t = unit_by_id(state, target_id)
	var err := _can_act(state, a)
	if err != "":
		return {"ok": false, "error": err}
	if t == null or not t.downed or t.dead or t.faction != a.faction:
		return {"ok": false, "error": "Target is not stabilizable"}
	if grid_distance(a, t) > 1:
		return {"ok": false, "error": "Target is not adjacent"}
	a.ap = int(a.ap) - 1
	t.downed = false
	t.hp = 1
	t.ap = 0
	if not t.statuses.has("STABILIZED"):
		t.statuses.append("STABILIZED")
	_event(state, {"type": "STABILIZE", "actorId": a.id, "targetId": t.id})
	return {"ok": true}

static func node_by_id(state: Dictionary, id: String):
	for n in state.nodes:
		if n.id == id:
			return n
	return null

## Technical actions this unit could take right now: [{node, action, apCost}].
static func technical_options(state: Dictionary, unit: Dictionary) -> Array:
	var out := []
	if _can_act(state, unit) != "":
		return out
	for n in state.nodes:
		var at: Dictionary = n.at
		if absi(int(unit.x) - int(at.x)) + absi(int(unit.y) - int(at.y)) > int(at.range):
			continue
		if not at.roles.has(String(unit.role)):
			continue
		var acts = n.actions.get(n.state, {})
		for act in acts:
			if int(unit.ap) >= int(acts[act].get("apCost", 1)):
				out.append({"node": n.id, "action": act, "apCost": int(acts[act].get("apCost", 1)), "label": String(acts[act].get("label", act))})
	return out

static func technical_action(state: Dictionary, actor_id: String, node_id: String, action_id: String) -> Dictionary:
	var a = unit_by_id(state, actor_id)
	var err := _can_act(state, a)
	if err != "":
		return {"ok": false, "error": err}
	var n = node_by_id(state, node_id)
	if n == null:
		return {"ok": false, "error": "Unknown node"}
	var at: Dictionary = n.at
	if absi(int(a.x) - int(at.x)) + absi(int(a.y) - int(at.y)) > int(at.range):
		return {"ok": false, "error": "Actor is not in position for %s" % node_id}
	if not at.roles.has(String(a.role)):
		return {"ok": false, "error": "Role %s cannot operate %s" % [a.role, node_id]}
	var acts = n.actions.get(n.state, {})
	if not acts.has(action_id):
		_event(state, {"type": "TECHNICAL_ACTION_REJECTED", "actorId": a.id, "nodeId": node_id, "actionId": action_id, "nodeState": n.state})
		return {"ok": false, "error": "Not available while %s" % n.state}
	var t: Dictionary = acts[action_id]
	var ap_cost := int(t.get("apCost", 1))
	if int(a.ap) < ap_cost:
		return {"ok": false, "error": "Not enough action points"}
	a.ap = int(a.ap) - ap_cost
	n.state = t.next
	_event(state, {"type": "TECHNICAL_ACTION_ACCEPTED", "actorId": a.id, "nodeId": node_id, "actionId": action_id, "nodeState": n.state, "apCost": ap_cost})
	if bool(t.get("noisy", false)):
		_break_concealment(state, a, "NOISE")
	if n.state == "VERIFIED" and n.opens.size():
		var removed := []
		if n.opens.has("gates"):
			for k in state.gates:
				state.blockers.erase(k)
				removed.append(k)
			state.gates = []
		rebuild_cover(state)
		_event(state, {"type": "BLOCKERS_REMOVED", "nodeId": node_id, "cells": removed})
	return {"ok": true, "nodeState": n.state}

static func in_extraction(state: Dictionary, u: Dictionary) -> bool:
	if state.extraction.is_empty():
		return false
	for c in state.extraction.cells:
		if int(c.x) == int(u.x) and int(c.y) == int(u.y):
			return true
	return false

static func extract(state: Dictionary, unit_id: String) -> Dictionary:
	var u = unit_by_id(state, unit_id)
	var err := _can_act(state, u)
	if err != "":
		return {"ok": false, "error": err}
	if u.faction != "PLAYER":
		return {"ok": false, "error": "Only player units can extract"}
	if not in_extraction(state, u):
		return {"ok": false, "error": "Unit is not in the extraction zone"}
	if not required_nodes_done(state):
		return {"ok": false, "error": "The objective is not done yet"} # DESKTOP: no walking out early
	state.mission.extractedUnitIds.append(u.id)
	u.statuses.append("EXTRACTED")
	u.ap = 0
	u.overwatch = false
	u.hunkered = false
	_event(state, {"type": "EXTRACT", "unitId": u.id})
	return {"ok": true}

static func required_nodes_done(state: Dictionary) -> bool:
	for n in state.nodes:
		if n.required and not ["VERIFIED", "SEALED_STABILIZED"].has(n.state):
			return false
	return true

static func mission_complete(state: Dictionary) -> bool:
	if not required_nodes_done(state):
		return false
	var survivors: Array = state.units.filter(func(u): return u.faction == "PLAYER" and not u.dead)
	if survivors.is_empty():
		return false
	if not state.mission.extractionRequired:
		return true
	for u in survivors:
		if not state.mission.extractedUnitIds.has(u.id):
			return false
	return true

## "win", "lose-clock", "lose-t", "lose-all" or "" while the mission runs.
static func outcome(state: Dictionary) -> String:
	if mission_complete(state):
		return "win"
	var squad: Array = state.units.filter(func(u): return u.faction == "PLAYER")
	var standing := squad.filter(func(u): return not u.dead and not u.downed)
	if standing.is_empty():
		return "lose-all"
	if not required_nodes_done(state):
		var t_alive := squad.any(func(u): return u.role == "T" and not u.dead)
		if not t_alive:
			return "lose-t"
	if state.mission.escalation == "TERMINAL":
		return "lose-clock"
	return ""

static func any_player_can_act(state: Dictionary) -> bool:
	for u in state.units:
		if u.faction == "PLAYER" and alive(u) and int(u.ap) > 0:
			return true
	return false
