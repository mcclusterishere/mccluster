extends Node3D
## Site 0 facility viewer: the canonical master (assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v04.glb)
## shown as it is, never edited. build.sh copies the master into res://assets/site0/ (checking its
## SHA-256 against the v04 manifest) so the exported game carries it; when the editor runs from a
## repository checkout without that copy, the file is read from the repository instead.

signal back

const UI := preload("res://scripts/ui.gd")
const MASTER := "PRIM3_Site0_Master_Facility_v04.glb"
const LEVELS := ["L4", "L3", "L2", "L1", "B1", "B2", "B3", "B4", "B5"]

var model: Node3D
var pivot: Node3D
var camera: Camera3D
var yaw := 0.6
var pitch := -0.5
var distance := 10.0
var center := Vector3.ZERO
var dragging := false
var groups := {}
var info: Label

func _ready() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.04, 0.045, 0.06)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.7, 0.72, 0.78)
	e.ambient_light_energy = 0.7
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	add_child(sun)
	pivot = Node3D.new()
	add_child(pivot)
	camera = Camera3D.new()
	camera.near = 0.01
	camera.far = 10000
	pivot.add_child(camera)
	_build_hud()
	model = _load_master()
	if model == null:
		info.text = "The Site 0 master is not in this build. Run build.sh, which copies it in from assets/3d/prim3-site0/."
		return
	add_child(model)
	_paint(model)
	var aabb := _aabb(model)
	center = aabb.get_center()
	distance = aabb.size.length() * 0.75
	camera.far = distance * 20
	_group(model)
	_build_level_toggles()
	info.text = "Canonical master v04 · %d named nodes · drag to orbit, wheel to zoom, toggle levels on the left." % _count(model)
	_place()

func _load_master() -> Node3D:
	var res_path := "res://assets/site0/" + MASTER
	if ResourceLoader.exists(res_path):
		var scene = load(res_path)
		if scene is PackedScene:
			return scene.instantiate()
	var repo_path := ProjectSettings.globalize_path("res://").path_join("../../assets/3d/prim3-site0/" + MASTER).simplify_path()
	if not FileAccess.file_exists(repo_path):
		return null
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	if doc.append_from_file(repo_path, st) != OK:
		return null
	return doc.generate_scene(st)

## The master carries no materials; show its vertex colours where it has them.
func _paint(n: Node) -> void:
	if n is MeshInstance3D:
		var m := StandardMaterial3D.new()
		m.vertex_color_use_as_albedo = true
		m.albedo_color = Color(0.9, 0.92, 0.95)
		m.roughness = 0.9
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		n.material_override = m
	for c in n.get_children():
		_paint(c)

func _aabb(n: Node) -> AABB:
	var box := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var b: AABB = mi.global_transform * mi.get_aabb()
		if first:
			box = b
			first = false
		else:
			box = box.merge(b)
	return box

func _count(n: Node) -> int:
	return n.find_children("*", "Node3D", true, false).size()

func _level_of(name: String) -> String:
	for l in LEVELS:
		if name.begins_with(l + "_") or name == l:
			return l
	return "Shared"

func _group(n: Node) -> void:
	for c in n.find_children("*", "MeshInstance3D", true, false):
		var owner_node: Node = c
		var key := "Shared"
		while owner_node and owner_node != model:
			var k := _level_of(String(owner_node.name))
			if k != "Shared":
				key = k
				break
			owner_node = owner_node.get_parent()
		if not groups.has(key):
			groups[key] = []
		groups[key].append(c)

func _build_hud() -> void:
	var hud := CanvasLayer.new()
	add_child(hud)
	var top := UI.panel()
	top.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	top.offset_left = 16
	top.offset_right = -16
	top.offset_top = 12
	hud.add_child(top)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 20)
	top.add_child(row)
	row.add_child(UI.label("SITE 0 · Ground Zero", 22))
	info = UI.label("", 15, UI.MUTED)
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(info)
	var b := UI.button("Back (Esc)", 15)
	b.pressed.connect(func(): back.emit())
	row.add_child(b)
	var side := UI.panel()
	side.name = "Levels"
	side.position = Vector2(16, 84)
	hud.add_child(side)
	var col := VBoxContainer.new()
	col.name = "Col"
	side.add_child(col)
	col.add_child(UI.label("LEVELS", 14, UI.MUTED))
	set_meta("level_col", col)

func _build_level_toggles() -> void:
	var col: VBoxContainer = get_meta("level_col")
	for key in LEVELS + ["Shared"]:
		if not groups.has(key):
			continue
		var cb := CheckBox.new()
		cb.text = "%s  (%d)" % [key, groups[key].size()]
		cb.button_pressed = true
		cb.add_theme_font_size_override("font_size", 16)
		var k: String = key
		cb.toggled.connect(func(on):
			for mi in groups[k]:
				mi.visible = on)
		col.add_child(cb)

func _place() -> void:
	pivot.position = center
	pivot.rotation = Vector3(pitch, yaw, 0)
	camera.position = Vector3(0, 0, distance)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		back.emit()
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT or event.button_index == MOUSE_BUTTON_RIGHT:
			dragging = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance *= 0.9
			_place()
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance *= 1.1
			_place()
	elif event is InputEventMouseMotion and dragging:
		yaw -= event.relative.x * 0.006
		pitch = clampf(pitch - event.relative.y * 0.006, -1.5, 0.4)
		_place()
