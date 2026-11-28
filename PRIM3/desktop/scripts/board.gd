extends Node3D
## The 3D mission board: renders a PRIM3 state, takes the player's orders, and plays the threat phase.

signal finished(outcome: String, rounds: int)
signal quit_to_menu
signal restart

const R := preload("res://scripts/rules.gd")
const AI := preload("res://scripts/ai.gd")
const UI := preload("res://scripts/ui.gd")

const ROLE_COLOR := {"E": Color(0.98, 0.6, 0.22), "R": Color(0.4, 0.86, 0.45), "T": Color(0.25, 0.75, 0.98)}
const THREAT_COLOR := Color(0.9, 0.24, 0.22)
const STEP_TIME := 0.11

var mission: Dictionary = {}
var state: Dictionary = {}
var busy := false
var ended := false
var selected_id := ""
var hover_tile := Vector2i(-99, -99)

var pivot: Node3D
var camera: Camera3D
var yaw := 0.0
var zoom := 18.0
var unit_nodes := {}
var node_meshes := {}
var block_meshes := {}
var overlay: Node3D
var path_overlay: Node3D
var reach_move := {}
var reach_dash := {}

# HUD
var hud: CanvasLayer
var top_label: Label
var clock_label: Label
var objective_label: Label
var unit_label: Label
var action_row: HBoxContainer
var target_row: HBoxContainer
var log_label: RichTextLabel
var tip_label: Label
var phase_banner: Label
var pause_panel: Control
var end_panel: Control

func _ready() -> void:
	state = R.create_state(mission)
	_build_world()
	_build_hud()
	R.begin_player_phase(state)
	_log("[b]%s[/b] · %s. %s" % [mission.title, mission.level, "The squad is concealed." if mission.get("concealed", false) else "The guards are already alert."])
	_select_first()
	_refresh()
	_banner("ROUND 1 · YOUR TURN")

# ---------- world ----------

func _mat(color: Color, emissive := 0.0, alpha := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(color, alpha)
	m.roughness = 0.85
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if emissive > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = emissive
	return m

func _box(size: Vector3, pos: Vector3, mat: Material, parent: Node = self) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	parent.add_child(mi)
	return mi

func tile_center(x: int, y: int) -> Vector3:
	return Vector3(x + 0.5, 0.0, y + 0.5)

func _build_world() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.03, 0.035, 0.05)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.55, 0.6, 0.7)
	e.ambient_light_energy = 0.55
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.glow_enabled = true
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -35, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 90.0
	add_child(sun)

	var w := int(state.width)
	var h := int(state.height)
	_box(Vector3(w, 0.1, h), Vector3(w / 2.0, -0.05, h / 2.0), _mat(Color(0.11, 0.12, 0.14)))
	# grid lines
	var grid_mat := _mat(Color(0.3, 0.36, 0.44), 0.0, 0.35)
	for x in w + 1:
		_box(Vector3(0.02, 0.01, h), Vector3(x, 0.005, h / 2.0), grid_mat)
	for y in h + 1:
		_box(Vector3(w, 0.01, 0.02), Vector3(w / 2.0, 0.005, y), grid_mat)
	# extraction
	var ex_mat := _mat(UI.GOOD, 0.6, 0.35)
	for c in state.extraction.get("cells", []):
		_box(Vector3(0.96, 0.02, 0.96), tile_center(int(c.x), int(c.y)) + Vector3(0, 0.02, 0), ex_mat)
	# blockers
	var wall_mat := _mat(Color(0.28, 0.31, 0.36))
	var high_mat := _mat(Color(0.36, 0.38, 0.34))
	var low_mat := _mat(Color(0.42, 0.4, 0.33))
	var gate_mat := _mat(Color(0.75, 0.55, 0.15), 0.3)
	for k in state.blockers:
		var b: Dictionary = state.blockers[k]
		var xy := String(k).split(":")
		var x := int(xy[0])
		var y := int(xy[1])
		var p := tile_center(x, y)
		match String(b.kind):
			"WALL":
				block_meshes[k] = _box(Vector3(1, 2.2, 1), p + Vector3(0, 1.1, 0), wall_mat)
			"GATE":
				block_meshes[k] = _box(Vector3(0.9, 2.0, 0.3 if _gate_runs_x(x, y) else 0.9), p + Vector3(0, 1.0, 0), gate_mat)
			"HIGH":
				block_meshes[k] = _box(Vector3(0.9, 1.7, 0.9), p + Vector3(0, 0.85, 0), high_mat)
			"LOW":
				block_meshes[k] = _box(Vector3(0.92, 0.8, 0.92), p + Vector3(0, 0.4, 0), low_mat)
	# objective nodes
	for n in state.nodes:
		var p := tile_center(int(n.at.x), int(n.at.y))
		var mi := _box(Vector3(0.7, 1.1, 0.7), p + Vector3(0, 0.55, 0), _mat(UI.WARN, 1.2))
		node_meshes[n.id] = mi
		var lbl := Label3D.new()
		lbl.text = n.label
		lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lbl.font_size = 40
		lbl.pixel_size = 0.006
		lbl.position = p + Vector3(0, 1.7, 0)
		lbl.modulate = UI.WARN
		lbl.no_depth_test = true
		add_child(lbl)
	overlay = Node3D.new()
	add_child(overlay)
	path_overlay = Node3D.new()
	add_child(path_overlay)
	for u in state.units:
		_make_unit(u)
	# camera rig
	pivot = Node3D.new()
	pivot.position = Vector3(w / 2.0, 0, h / 2.0)
	add_child(pivot)
	camera = Camera3D.new()
	camera.fov = 50
	pivot.add_child(camera)
	zoom = clampf(maxf(w, h) * 0.78, 11.0, 24.0)
	# start between the middle of the board and the squad, so both the squad and the objective show
	var cx := 0.0
	var cy := 0.0
	var squad: Array = state.units.filter(func(u): return u.faction == "PLAYER")
	for u in squad:
		cx += u.x + 0.5
		cy += u.y + 0.5
	pivot.position = Vector3(w / 2.0, 0, h / 2.0).lerp(Vector3(cx / squad.size(), 0, cy / squad.size()), 0.5)
	_place_camera()

func _gate_runs_x(x: int, y: int) -> bool:
	return state.blockers.has(R._k(x - 1, y)) or state.blockers.has(R._k(x + 1, y))

func _make_unit(u: Dictionary) -> void:
	var root := Node3D.new()
	root.position = tile_center(int(u.x), int(u.y))
	add_child(root)
	var color: Color = ROLE_COLOR.get(String(u.role), Color.WHITE) if u.faction == "PLAYER" else THREAT_COLOR
	var body := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.26
	cap.height = 1.4
	body.mesh = cap
	body.material_override = _mat(color, 0.15)
	body.position = Vector3(0, 0.7, 0)
	root.add_child(body)
	var head := MeshInstance3D.new()
	var visor := BoxMesh.new()
	visor.size = Vector3(0.3, 0.08, 0.12)
	head.mesh = visor
	head.material_override = _mat(Color(0.1, 0.1, 0.12))
	head.position = Vector3(0, 1.22, -0.22)
	root.add_child(head)
	var ring := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 0.36
	torus.outer_radius = 0.44
	ring.mesh = torus
	ring.material_override = _mat(UI.ACCENT, 2.0)
	ring.position = Vector3(0, 0.03, 0)
	ring.visible = false
	root.add_child(ring)
	var lbl := Label3D.new()
	lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lbl.font_size = 48
	lbl.pixel_size = 0.008
	lbl.outline_size = 10
	lbl.position = Vector3(0, 1.75, 0)
	lbl.no_depth_test = true
	root.add_child(lbl)
	unit_nodes[u.id] = {"root": root, "body": body, "ring": ring, "label": lbl}

func _place_camera() -> void:
	pivot.rotation.y = yaw
	camera.position = Vector3(0, zoom * 0.95, zoom * 0.72)
	camera.look_at(pivot.global_position, Vector3.UP)

func _process(delta: float) -> void:
	if camera == null:
		return
	var pan := Vector3.ZERO
	if not (pause_panel and pause_panel.visible):
		if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
			pan.z -= 1
		if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
			pan.z += 1
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			pan.x -= 1
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			pan.x += 1
	if pan != Vector3.ZERO:
		var move := pan.normalized().rotated(Vector3.UP, yaw) * delta * (6.0 + zoom * 0.6)
		pivot.position += move
		pivot.position.x = clampf(pivot.position.x, 0, state.width)
		pivot.position.z = clampf(pivot.position.z, 0, state.height)

# ---------- input ----------

func _pick_tile(screen_pos: Vector2) -> Vector2i:
	var from := camera.project_ray_origin(screen_pos)
	var dir := camera.project_ray_normal(screen_pos)
	var hit = Plane(Vector3.UP, 0.0).intersects_ray(from, dir)
	if hit == null:
		return Vector2i(-99, -99)
	return Vector2i(floori(hit.x), floori(hit.z))

func _unit_at(t: Vector2i):
	for u in state.units:
		if not u.dead and not R.is_extracted(u) and int(u.x) == t.x and int(u.y) == t.y:
			if u.faction == "PLAYER" or R.visible_to_squad(state, u):
				return u
	return null

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			_toggle_pause()
			return
	if ended or (pause_panel and pause_panel.visible):
		return
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom = maxf(6.0, zoom - 1.2)
			_place_camera()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom = minf(40.0, zoom + 1.2)
			_place_camera()
		elif event.button_index == MOUSE_BUTTON_LEFT and not busy:
			_click(_pick_tile(event.position))
		elif event.button_index == MOUSE_BUTTON_RIGHT and not busy:
			_cycle_unit()
	elif event is InputEventMouseMotion:
		var t := _pick_tile(event.position)
		if t != hover_tile:
			hover_tile = t
			_draw_path_preview()
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_Q:
				_rotate(-PI / 2)
			KEY_E:
				_rotate(PI / 2)
		if busy:
			return
		match event.keycode:
			KEY_TAB:
				_cycle_unit()
			KEY_SPACE, KEY_ENTER, KEY_KP_ENTER:
				_end_turn()
			KEY_O:
				_order({"type": "overwatch"})
			KEY_H:
				_order({"type": "hunker"})
			KEY_R:
				_order({"type": "reload"})
			KEY_X:
				_order({"type": "extract"})
			KEY_F:
				var u = _selected()
				if u:
					var opts := R.technical_options(state, u)
					if opts.size():
						_order({"type": "tech", "node": opts[0].node, "action": opts[0].action})

func _rotate(amount: float) -> void:
	var tw := create_tween()
	var target := yaw + amount
	tw.tween_method(func(v):
		yaw = v
		_place_camera(), yaw, target, 0.25)

func _selected():
	return R.unit_by_id(state, selected_id) if selected_id != "" else null

func _click(t: Vector2i) -> void:
	if state.phase != "PLAYER":
		return
	var who = _unit_at(t)
	if who != null and who.faction == "PLAYER" and R.alive(who):
		_select(who.id)
		return
	var u = _selected()
	if u == null or int(u.ap) <= 0:
		return
	if who != null and who.faction == "THREAT":
		_order({"type": "fire", "target": who.id})
		return
	if who != null and who.faction == "PLAYER" and who.downed:
		_order({"type": "stabilize", "target": who.id})
		return
	if reach_move.has(t):
		_order({"type": "move", "to": t})
	elif reach_dash.has(t):
		_order({"type": "dash", "to": t})

func _select(id: String) -> void:
	selected_id = id
	_refresh()

func _select_first() -> void:
	for u in state.units:
		if u.faction == "PLAYER" and R.alive(u) and int(u.ap) > 0:
			selected_id = u.id
			return
	selected_id = ""

func _cycle_unit() -> void:
	var squad: Array = state.units.filter(func(u): return u.faction == "PLAYER" and R.alive(u) and int(u.ap) > 0)
	if squad.is_empty():
		return
	var idx := -1
	for i in squad.size():
		if squad[i].id == selected_id:
			idx = i
	_select(squad[(idx + 1) % squad.size()].id)
	var u = _selected()
	var tw := create_tween()
	tw.tween_property(pivot, "position", tile_center(int(u.x), int(u.y)), 0.3)

# ---------- orders ----------

func _order(partial: Dictionary) -> void:
	var u = _selected()
	if u == null or busy or ended:
		return
	var action := partial.duplicate()
	action.unit = u.id
	await _perform(action, true)
	if ended:
		return
	if not R.alive(u) or int(u.ap) <= 0:
		_select_first()
	_refresh()
	if not R.any_player_can_act(state):
		_end_turn()

func _perform(action: Dictionary, by_player: bool) -> Dictionary:
	busy = true
	var before := {}
	for x in state.units:
		before[x.id] = {"hp": x.hp, "dead": x.dead, "downed": x.downed, "concealed": x.concealed}
	var nodes_before := {}
	for n in state.nodes:
		nodes_before[n.id] = n.state
	var event_start: int = state.events.size()
	var res: Dictionary = AI.apply(state, action)
	if not res.ok:
		if by_player:
			_tip(String(res.get("error", "Not possible")))
		busy = false
		return res
	var actor = R.unit_by_id(state, action.unit)
	var name := _name(actor)
	match String(action.type):
		"move", "dash":
			await _walk(actor, res.path)
			if res.interrupted:
				_log("%s runs into contact and stops." % name)
		"fire":
			var target = R.unit_by_id(state, action.target)
			await _shot(actor, target, res)
			var verdict := "misses"
			if res.hit:
				verdict = "hits for %d%s" % [res.damage, " (critical)" if res.critical else ""]
			_log("%s fires at %s (%d%%) and %s." % [name, _name(target), res.hitChance, verdict])
		"overwatch":
			_log("%s is on overwatch." % name)
		"hunker":
			_log("%s hunkers down." % name)
		"reload":
			_log("%s reloads." % name)
		"stabilize":
			_log("%s gets %s back on their feet." % [name, _name(R.unit_by_id(state, action.target))])
		"tech":
			var n = R.node_by_id(state, action.node)
			_log("%s: %s → %s." % [name, n.label, n.state])
		"extract":
			_log("%s is out." % name)
	# overwatch shots and other events raised during the action
	for i in range(event_start, state.events.size()):
		var ev: Dictionary = state.events[i]
		if ev.type == "OVERWATCH_SHOT":
			var w = R.unit_by_id(state, ev.watcherId)
			var t = R.unit_by_id(state, ev.targetId)
			_log("Overwatch: %s fires at %s (%d%%) and %s." % [_name(w), _name(t), ev.hitChance, "hits for %d" % ev.damage if ev.hit else "misses"])
			await _tracer(w, t, ev.hit)
		elif ev.type == "CONCEALMENT_BROKEN":
			_log("[color=#f5c84c]%s has been spotted.[/color]" % _name(R.unit_by_id(state, ev.unitId)))
		elif ev.type == "ALERT":
			_banner("ALARM · THE GUARDS ARE AWAKE")
		elif ev.type == "BLOCKERS_REMOVED":
			_log("[color=#5cdb80]The gate opens.[/color]")
			for k in ev.cells:
				if block_meshes.has(k):
					var mi: MeshInstance3D = block_meshes[k]
					var tw := create_tween()
					tw.tween_property(mi, "position:y", -1.1, 0.6)
	for x in state.units:
		var b: Dictionary = before[x.id]
		if not b.dead and x.dead:
			_log("[color=#f2544c]%s is down for good.[/color]" % _name(x))
		elif not b.downed and x.downed:
			_log("[color=#f5c84c]%s is downed. Stabilise them from an adjacent tile.[/color]" % _name(x))
	_sync_units()
	busy = false
	_check_end()
	return res

func _name(u) -> String:
	if u == null:
		return "?"
	if u.faction == "PLAYER":
		return "%s (%s)" % [u.name, u.id]
	return "%s %s" % [u.name, u.id]

# ---------- animation ----------

func _walk(u: Dictionary, path: Array) -> void:
	var node: Node3D = unit_nodes[u.id].root
	var tw := create_tween()
	for step in path:
		var p := tile_center(step.x, step.y)
		tw.tween_callback(func():
			var dir: Vector3 = p - node.position
			if dir.length() > 0.01:
				node.look_at(node.position + dir, Vector3.UP))
		tw.tween_property(node, "position", p, STEP_TIME)
	await tw.finished

func _shot(a: Dictionary, t: Dictionary, res: Dictionary) -> void:
	var an: Node3D = unit_nodes[a.id].root
	var tn: Node3D = unit_nodes[t.id].root
	var dir := tn.position - an.position
	if dir.length() > 0.01:
		an.look_at(an.position + dir, Vector3.UP)
	await _tracer(a, t, res.hit)
	_float_text(tn.position + Vector3(0, 2.1, 0), ("CRIT %d" % res.damage if res.critical else "HIT %d" % res.damage) if res.hit else "MISS", UI.DANGER if res.hit else UI.MUTED)

func _tracer(a: Dictionary, t: Dictionary, hit: bool) -> void:
	if a == null or t == null:
		return
	var p1: Vector3 = unit_nodes[a.id].root.position + Vector3(0, 1.0, 0)
	var p2: Vector3 = unit_nodes[t.id].root.position + Vector3(0, 1.0, 0)
	if not hit:
		p2 += Vector3(randf_range(-0.6, 0.6), randf_range(0.2, 0.7), randf_range(-0.6, 0.6))
	var mi := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.025
	cyl.bottom_radius = 0.025
	cyl.height = p1.distance_to(p2)
	mi.mesh = cyl
	mi.material_override = _mat(Color(1.0, 0.85, 0.4), 4.0)
	add_child(mi)
	mi.position = (p1 + p2) / 2.0
	mi.look_at(p2, Vector3.UP if absf((p2 - p1).normalized().y) < 0.99 else Vector3.RIGHT)
	mi.rotate_object_local(Vector3.RIGHT, PI / 2)
	var tw := create_tween()
	tw.tween_interval(0.12)
	tw.tween_property(mi, "transparency", 1.0, 0.18)
	tw.tween_callback(mi.queue_free)
	await get_tree().create_timer(0.25).timeout

func _float_text(pos: Vector3, text: String, color: Color) -> void:
	var l := Label3D.new()
	l.text = text
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.font_size = 64
	l.pixel_size = 0.006
	l.outline_size = 12
	l.modulate = color
	l.no_depth_test = true
	l.position = pos
	add_child(l)
	var tw := create_tween()
	tw.tween_property(l, "position:y", pos.y + 0.9, 0.9)
	tw.parallel().tween_property(l, "modulate:a", 0.0, 0.9)
	tw.tween_callback(l.queue_free)

func _sync_units() -> void:
	for u in state.units:
		var n: Dictionary = unit_nodes[u.id]
		var root: Node3D = n.root
		root.position = tile_center(int(u.x), int(u.y))
		var seen: bool = R.visible_to_squad(state, u)
		root.visible = seen and not R.is_extracted(u)
		var body: MeshInstance3D = n.body
		if u.dead:
			body.rotation_degrees = Vector3(90, 0, 0)
			body.position = Vector3(0, 0.28, 0)
			body.transparency = 0.45
		elif u.downed:
			body.rotation_degrees = Vector3(70, 0, 0)
			body.position = Vector3(0, 0.35, 0)
		else:
			body.rotation_degrees = Vector3.ZERO
			body.position = Vector3(0, 0.7, 0)
			body.transparency = 0.35 if u.concealed else 0.0
		n.ring.visible = u.id == selected_id
		var flags := ""
		if u.overwatch:
			flags += " OW"
		if u.hunkered:
			flags += " HK"
		if u.concealed:
			flags += " ◌"
		var tag: String = String(u.role) if u.faction == "PLAYER" else ("H" if u.name != "Heavy" else "HV")
		n.label.text = "" if u.dead else "%s  %d/%d%s" % [tag, int(u.hp), int(u.maxHp), flags]
		n.label.modulate = (ROLE_COLOR.get(String(u.role), Color.WHITE) if u.faction == "PLAYER" else THREAT_COLOR).lightened(0.25)
	for nd in state.nodes:
		var mi: MeshInstance3D = node_meshes[nd.id]
		var c := UI.WARN
		if nd.state == "OPEN":
			c = UI.ACCENT
		elif nd.state == "VERIFIED":
			c = UI.GOOD
		mi.material_override = _mat(c, 1.2)

func _clear(node: Node3D) -> void:
	for c in node.get_children():
		c.queue_free()

func _draw_reach() -> void:
	_clear(overlay)
	reach_move = {}
	reach_dash = {}
	var u = _selected()
	if u == null or state.phase != "PLAYER" or busy or int(u.ap) <= 0:
		return
	var move_mat := _mat(UI.ACCENT, 0.8, 0.28)
	var dash_mat := _mat(UI.WARN, 0.6, 0.3)
	var full := R.compute_reach(state, u, int(u.moveRange) * (2 if int(u.ap) >= 2 else 1))
	for t in full.cost:
		if t == Vector2i(int(u.x), int(u.y)):
			continue
		if R.occupant(state, t.x, t.y, u.id) != null and R.visible_to_squad(state, R.occupant(state, t.x, t.y, u.id)):
			continue
		var c: int = full.cost[t]
		if c <= int(u.moveRange):
			reach_move[t] = true
			_box(Vector3(0.9, 0.02, 0.9), tile_center(t.x, t.y) + Vector3(0, 0.03, 0), move_mat, overlay)
		elif int(u.ap) >= 2:
			reach_dash[t] = true
			_box(Vector3(0.55, 0.02, 0.55), tile_center(t.x, t.y) + Vector3(0, 0.03, 0), dash_mat, overlay)
	# cover markers next to the hovered tile are drawn by the path preview

func _draw_path_preview() -> void:
	_clear(path_overlay)
	var u = _selected()
	tip_label.text = ""
	if u == null or busy or state.phase != "PLAYER":
		return
	var who = _unit_at(hover_tile)
	if who != null and who.faction == "THREAT":
		var p := R.shot_preview(state, u, who)
		if p.legal:
			tip_label.text = "Fire at %s: %d%% to hit · %d%% crit · %d dmg · cover %s%s" % [_name(who), p.hitChance, p.critChance, p.damage, p.cover, " · FLANKED" if p.flanked else ""]
		else:
			tip_label.text = "No shot at %s: %s" % [_name(who), String(p.reason).replace("_", " ").to_lower()]
		return
	if not (reach_move.has(hover_tile) or reach_dash.has(hover_tile)):
		return
	var reach := R.compute_reach(state, u, int(u.moveRange) * 2)
	var path := R.path_to(reach, hover_tile)
	var dot := _mat(Color.WHITE, 1.0, 0.85)
	for step in path:
		var s := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.07
		sm.height = 0.14
		s.mesh = sm
		s.material_override = dot
		s.position = tile_center(step.x, step.y) + Vector3(0, 0.12, 0)
		path_overlay.add_child(s)
	var cov = state.cover.get(R._k(hover_tile.x, hover_tile.y))
	if cov != null:
		var sides := {"N": Vector3(0, 0, -0.45), "S": Vector3(0, 0, 0.45), "E": Vector3(0.45, 0, 0), "W": Vector3(-0.45, 0, 0)}
		for side in cov.sides:
			var shield := _box(Vector3(0.3 if side in ["N", "S"] else 0.06, 0.5 if cov.type == "HIGH" else 0.25, 0.06 if side in ["N", "S"] else 0.3),
				tile_center(hover_tile.x, hover_tile.y) + sides[side] + Vector3(0, 0.3, 0), _mat(UI.ACCENT, 1.5), path_overlay)
			shield.name = "cover"
		tip_label.text = "%s cover · %s" % [cov.type.capitalize(), "dash (2 AP)" if reach_dash.has(hover_tile) else "move (1 AP)"]
	else:
		tip_label.text = "No cover · %s" % ("dash (2 AP)" if reach_dash.has(hover_tile) else "move (1 AP)")

# ---------- turn flow ----------

func _end_turn() -> void:
	if busy or ended or state.phase != "PLAYER":
		return
	busy = true
	_clear(overlay)
	_clear(path_overlay)
	R.begin_threat_phase(state)
	_refresh()
	_banner("THREAT PHASE")
	await get_tree().create_timer(0.6).timeout
	for t in state.units:
		if t.faction == "PLAYER" or not R.alive(t):
			continue
		var memo := {}
		for _i in 6:
			var a = AI.next_threat_action(state, t, memo)
			if a == null:
				break
			var visible_before: bool = R.visible_to_squad(state, t)
			busy = false
			var res := await _perform(a, false)
			busy = true
			if not res.ok:
				AI.apply(state, {"type": "end", "unit": t.id})
			if ended:
				return
			if visible_before or R.visible_to_squad(state, t):
				await get_tree().create_timer(0.25).timeout
	R.resolve_clock(state)
	var esc: String = state.mission.escalation
	if esc == "CRITICAL":
		_log("[color=#f2544c]Clock critical: %d rounds left.[/color]" % state.mission.clock)
	elif esc == "DEGRADED" and int(state.mission.clock) == 5:
		_log("[color=#f5c84c]Clock degraded: 5 rounds left.[/color]")
	busy = false
	_check_end()
	if ended:
		return
	R.begin_player_phase(state)
	_select_first()
	_refresh()
	_banner("ROUND %d · YOUR TURN" % int(state.round))

func _check_end() -> void:
	if ended:
		return
	var outcome := R.outcome(state)
	if outcome == "":
		return
	ended = true
	_sync_units()
	_clear(overlay)
	_clear(path_overlay)
	finished.emit(outcome, int(state.round))
	_show_end(outcome)

func _auto_turn() -> void:
	if busy or ended or state.phase != "PLAYER":
		return
	for u in state.units:
		if u.faction != "PLAYER":
			continue
		var memo := {}
		for _i in 8:
			var a = AI.next_player_action(state, u, memo)
			if a == null:
				break
			selected_id = u.id
			var res := await _perform(a, false)
			if not res.ok:
				AI.apply(state, {"type": "end", "unit": u.id})
			if ended:
				return
	_refresh()
	_end_turn()

# ---------- HUD ----------

func _build_hud() -> void:
	hud = CanvasLayer.new()
	add_child(hud)
	var top := UI.panel()
	top.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	top.offset_left = 16
	top.offset_right = -16
	top.offset_top = 12
	hud.add_child(top)
	var trow := HBoxContainer.new()
	trow.add_theme_constant_override("separation", 28)
	top.add_child(trow)
	top_label = UI.label("", 20)
	trow.add_child(top_label)
	clock_label = UI.label("", 20, UI.WARN)
	trow.add_child(clock_label)
	objective_label = UI.label("", 17, UI.MUTED)
	objective_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	objective_label.clip_text = true
	trow.add_child(objective_label)
	var menu_btn := UI.button("Menu (Esc)", 15)
	menu_btn.pressed.connect(_toggle_pause)
	trow.add_child(menu_btn)

	var bottom := UI.panel()
	bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_left = 16
	bottom.offset_right = -16
	bottom.offset_bottom = -12
	bottom.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hud.add_child(bottom)
	var bcol := VBoxContainer.new()
	bcol.add_theme_constant_override("separation", 8)
	bottom.add_child(bcol)
	unit_label = UI.label("", 18)
	bcol.add_child(unit_label)
	action_row = HBoxContainer.new()
	action_row.add_theme_constant_override("separation", 8)
	bcol.add_child(action_row)
	target_row = HBoxContainer.new()
	target_row.add_theme_constant_override("separation", 8)
	bcol.add_child(target_row)
	tip_label = UI.label("", 15, UI.ACCENT)
	bcol.add_child(tip_label)

	var side := UI.panel()
	side.set_anchors_and_offsets_preset(Control.PRESET_RIGHT_WIDE)
	side.offset_left = -360
	side.offset_right = -16
	side.offset_top = 84
	side.offset_bottom = -330
	hud.add_child(side)
	log_label = RichTextLabel.new()
	log_label.bbcode_enabled = true
	log_label.scroll_following = true
	log_label.add_theme_font_size_override("normal_font_size", 15)
	log_label.add_theme_font_size_override("bold_font_size", 15)
	log_label.add_theme_color_override("default_color", UI.TEXT)
	side.add_child(log_label)

	phase_banner = UI.label("", 34, UI.TEXT)
	phase_banner.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	phase_banner.offset_top = 110
	phase_banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	phase_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	phase_banner.add_theme_color_override("font_outline_color", Color.BLACK)
	phase_banner.add_theme_constant_override("outline_size", 8)
	hud.add_child(phase_banner)

	pause_panel = _modal("Paused", [["Resume", _toggle_pause], ["Restart mission", func(): restart.emit()], ["Quit to menu", func(): quit_to_menu.emit()]], UI.CONTROLS_HELP)
	hud.add_child(pause_panel)
	pause_panel.visible = false

func _modal(title: String, buttons: Array, body := "") -> Control:
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.6)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var p := UI.panel()
	p.custom_minimum_size = Vector2(560, 0)
	p.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	p.grow_horizontal = Control.GROW_DIRECTION_BOTH
	p.grow_vertical = Control.GROW_DIRECTION_BOTH
	shade.add_child(p)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	p.add_child(col)
	col.add_child(UI.label(title, 36))
	if body != "":
		var l := UI.label(body, 15, UI.MUTED)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size = Vector2(520, 0)
		col.add_child(l)
	for b in buttons:
		var btn := UI.button(b[0])
		btn.pressed.connect(b[1])
		col.add_child(btn)
	return shade

func _toggle_pause() -> void:
	if end_panel:
		return
	pause_panel.visible = not pause_panel.visible

func _show_end(outcome: String) -> void:
	var titles := {"win": "Mission complete", "lose-clock": "Out of time", "lose-t": "The Technical is lost", "lose-all": "Squad down"}
	var body := {
		"win": "Objective verified and the squad is out in %d rounds." % int(state.round),
		"lose-clock": "The clock ran out before the squad got out.",
		"lose-t": "Without the Technical nobody can run the objective.",
		"lose-all": "Nobody is left standing."
	}
	end_panel = _modal(titles.get(outcome, outcome), [["Play again", func(): restart.emit()], ["Missions", func(): quit_to_menu.emit()]], body.get(outcome, ""))
	hud.add_child(end_panel)

func _banner(text: String) -> void:
	phase_banner.text = text
	phase_banner.modulate.a = 1.0
	var tw := create_tween()
	tw.tween_interval(1.2)
	tw.tween_property(phase_banner, "modulate:a", 0.0, 0.5)

func _log(text: String) -> void:
	log_label.append_text(text + "\n")

func _tip(text: String) -> void:
	tip_label.text = text
	tip_label.add_theme_color_override("font_color", UI.DANGER)
	var tw := create_tween()
	tw.tween_interval(1.8)
	tw.tween_callback(func(): tip_label.add_theme_color_override("font_color", UI.ACCENT))

func _refresh() -> void:
	_sync_units()
	var m: Dictionary = state.mission
	top_label.text = "%s · %s   ROUND %d   %s" % [mission.level, mission.title, int(state.round), "YOUR TURN" if state.phase == "PLAYER" else "THREAT PHASE"]
	clock_label.text = "CLOCK %d · %s" % [int(m.clock), m.escalation]
	clock_label.add_theme_color_override("font_color", UI.DANGER if m.escalation in ["CRITICAL", "TERMINAL"] else (UI.WARN if m.escalation == "DEGRADED" else UI.GOOD))
	var todo := []
	for n in state.nodes:
		todo.append("%s: %s" % [n.label, n.state])
	var out: int = state.units.filter(func(u): return u.faction == "PLAYER" and R.is_extracted(u)).size()
	objective_label.text = "%s   ·   Extracted %d/%d" % [", ".join(todo), out, state.units.filter(func(u): return u.faction == "PLAYER" and not u.dead).size()]
	for c in action_row.get_children():
		c.queue_free()
	for c in target_row.get_children():
		c.queue_free()
	var u = _selected()
	if u == null or state.phase != "PLAYER":
		unit_label.text = "Threat phase…" if state.phase != "PLAYER" else "No operative can act. End the turn."
		if state.phase == "PLAYER":
			_add_action("End turn (Space)", _end_turn)
		_draw_reach()
		return
	unit_label.text = "%s   HP %d/%d   AP %d/%d   Ammo %d/%d (+%d)%s%s" % [_name(u), int(u.hp), int(u.maxHp), int(u.ap), int(u.maxAp), int(u.ammo), int(u.magazineSize), int(u.reserveAmmo),
		"   CONCEALED" if u.concealed else "", "   OVERWATCH" if u.overwatch else ""]
	_add_action("Overwatch (O)", func(): _order({"type": "overwatch"}), int(u.ap) > 0 and int(u.ammo) > 0)
	_add_action("Hunker (H)", func(): _order({"type": "hunker"}), int(u.ap) > 0)
	_add_action("Reload (R)", func(): _order({"type": "reload"}), int(u.ap) > 0 and int(u.ammo) < int(u.magazineSize) and int(u.reserveAmmo) > 0)
	for opt in R.technical_options(state, u):
		var o: Dictionary = opt
		var n = R.node_by_id(state, o.node)
		_add_action("%s %s (F)" % [o.label, n.label], func(): _order({"type": "tech", "node": o.node, "action": o.action}))
	if R.in_extraction(state, u):
		_add_action("Extract (X)", func(): _order({"type": "extract"}), R.required_nodes_done(state))
	for other in state.units:
		if other.faction == "PLAYER" and other.downed and not other.dead and R.grid_distance(u, other) <= 1:
			var oid: String = other.id
			_add_action("Stabilise %s" % other.id, func(): _order({"type": "stabilize", "target": oid}))
	_add_action("Auto turn", _auto_turn)
	_add_action("End turn (Space)", _end_turn)
	for t in state.units:
		if t.faction != "THREAT" or not R.alive(t) or not R.visible_to_squad(state, t):
			continue
		var p := R.shot_preview(state, u, t)
		if not p.legal:
			continue
		var tid: String = t.id
		var b := UI.button("Fire %s · %d%%" % [t.id, p.hitChance], 15)
		b.add_theme_color_override("font_color", UI.DANGER)
		b.disabled = int(u.ap) <= 0
		b.pressed.connect(func(): _order({"type": "fire", "target": tid}))
		b.mouse_entered.connect(func(): tip_label.text = "%d%% to hit · %d%% crit · %d dmg · cover %s%s" % [p.hitChance, p.critChance, p.damage, p.cover, " · FLANKED" if p.flanked else ""])
		target_row.add_child(b)
	_draw_reach()

func _add_action(text: String, cb: Callable, enabled := true) -> void:
	var b := UI.button(text, 15)
	b.disabled = not enabled or busy
	b.pressed.connect(cb)
	b.focus_mode = Control.FOCUS_NONE
	action_row.add_child(b)

## Used by the capture mode: hover a reachable tile with cover so a screenshot shows the move preview.
func demo_hover() -> void:
	var best := Vector2i(-99, -99)
	for t in reach_move:
		if state.cover.has(R._k(t.x, t.y)) and (best.x < 0 or t.y < best.y):
			best = t
	if best.x >= 0:
		hover_tile = best
		_draw_path_preview()
