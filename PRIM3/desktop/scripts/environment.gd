class_name Prim3Environment
extends RefCounted
## Builds a mission's world from the web game's own art, the way js/prim3-tactics/level3d.mjs does:
## one world unit is one 3.54 m tile (scale.mjs), real things keep their size in metres, the White
## Industrial kit models are fitted to the footprint and height the rules declare (the kit only
## changes the look, never the rules), surfaces use the CC0 Poly Haven PBR sets, and the night is
## lit by the courtyard_night HDRI with a cool moon and warm lamps ("field" look).
## Each mission's data/missions.json "environment" block picks the textures, kit pieces, dressing
## beyond the playable edge, and the light; nothing here is Site 0 geometry.

const TILE_M := 3.54
const OPERATOR_HEIGHT_M := 1.75
const WEB := "res://assets/web/"
const TEAM := {"PLAYER": Color("2fe0f0"), "THREAT": Color("ff3b3b")}
const OVER := {"reach": Color("389cff"), "path": Color("ffb547")}

static func M(metres: float) -> float:
	return metres / TILE_M

static var _tex_cache := {}
static var _kit_cache := {}
static var _catalog := {}

static func tex(name: String) -> Texture2D:
	if _tex_cache.has(name):
		return _tex_cache[name]
	var path := WEB + "tactics/pbr/" + name + ".jpg"
	var t: Texture2D = load(path) if ResourceLoader.exists(path) else null
	_tex_cache[name] = t
	return t

## A PBR material from one Poly Haven set (diff / nor_gl / rough), triplanar so any box tiles cleanly.
static func pbr(set_name: String, scale := 1.0, tint := Color.WHITE) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = tint
	var d := tex(set_name + "_diff")
	if d:
		m.albedo_texture = d
		var n := tex(set_name + "_nor_gl")
		if n:
			m.normal_enabled = true
			m.normal_texture = n
		var r := tex(set_name + "_rough")
		if r:
			m.roughness_texture = r
			m.roughness = 1.0
		m.uv1_triplanar = true
		m.uv1_world_triplanar = true
		m.uv1_scale = Vector3.ONE * scale
	else:
		m.albedo_color = Color(0.25, 0.27, 0.3) * tint
		m.roughness = 0.9
	return m

static func catalog() -> Dictionary:
	if _catalog.is_empty():
		var p := WEB + "kit/catalog.json"
		if FileAccess.file_exists(p):
			var data = JSON.parse_string(FileAccess.get_file_as_string(p))
			for a in data.assets:
				_catalog[a.id] = a
	return _catalog

## A kit model fitted to a footprint (w along X, d along Z, in tiles) and a height (tiles), feet at y.
static func kit(id: String, w: float, d: float, h: float, uniform := false):
	var a = catalog().get(id)
	if a == null:
		return null
	if not _kit_cache.has(id):
		var path: String = WEB + "kit/" + String(a.model)
		_kit_cache[id] = load(path) if ResourceLoader.exists(path) else null
	var scene: PackedScene = _kit_cache[id]
	if scene == null:
		return null
	var o: Node3D = scene.instantiate()
	var fp = a.get("footprint", {})
	var fw: float = float(fp.get("width", a.width)) if fp is Dictionary else float(a.width)
	var fd: float = float(fp.get("depth", a.depth)) if fp is Dictionary else float(a.depth)
	if uniform:
		o.scale = Vector3.ONE * (h / float(a.height))
	else:
		o.scale = Vector3(w / fw, h / float(a.height), d / fd)
	_shadows(o)
	return o

static func _shadows(n: Node) -> void:
	if n is GeometryInstance3D:
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for c in n.get_children():
		_shadows(c)

static func box(parent: Node, size: Vector3, pos: Vector3, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	parent.add_child(mi)
	return mi

static func glow(color: Color, energy := 2.0, alpha := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(color, alpha)
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	return m

static func c(x: int, y: int) -> Vector3:
	return Vector3(x + 0.5, 0.0, y + 0.5)

# ---------- lighting ----------

static func light(root: Node3D, env: Dictionary) -> void:
	var we := WorldEnvironment.new()
	var e := Environment.new()
	var hdr_path := WEB + "tactics/hdri/courtyard_night_1k.hdr"
	if ResourceLoader.exists(hdr_path):
		var sky := Sky.new()
		var pano := PanoramaSkyMaterial.new()
		pano.panorama = load(hdr_path)
		pano.energy_multiplier = float(env.get("sky_energy", 0.9))
		sky.sky_material = pano
		e.background_mode = Environment.BG_SKY
		e.sky = sky
		e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
		e.ambient_light_energy = float(env.get("ambient", 0.8))
		e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	else:
		e.background_mode = Environment.BG_COLOR
		e.background_color = Color("121b24")
		e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		e.ambient_light_color = Color("8fa6c4")
		e.ambient_light_energy = 0.5
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	e.tonemap_exposure = float(env.get("exposure", 1.2))
	e.fog_enabled = true
	e.fog_light_color = Color(env.get("fog", "121b24"))
	e.fog_density = float(env.get("fog_density", 0.012))
	e.fog_sky_affect = 0.6
	e.glow_enabled = true
	e.glow_intensity = 0.7
	e.glow_bloom = 0.08
	e.ssao_enabled = true
	e.ssao_radius = 0.6
	e.ssao_intensity = 1.6
	e.adjustment_enabled = true
	e.adjustment_contrast = 1.06
	e.adjustment_saturation = 1.05
	we.environment = e
	root.add_child(we)
	var moon := DirectionalLight3D.new()
	moon.light_color = Color(env.get("moon", "bfd2ff"))
	moon.light_energy = float(env.get("moon_energy", 1.1))
	moon.rotation_degrees = Vector3(-52, float(env.get("moon_yaw", -35)), 0)
	moon.shadow_enabled = true
	moon.directional_shadow_max_distance = 60.0
	moon.shadow_blur = 1.5
	root.add_child(moon)

static func lamp(root: Node3D, pos: Vector3, color: Color, energy := 2.2, rng := 6.0) -> void:
	var l := OmniLight3D.new()
	l.light_color = color
	l.light_energy = energy
	l.omni_range = rng
	l.omni_attenuation = 1.4
	l.position = pos
	l.shadow_enabled = false
	root.add_child(l)

# ---------- the board ----------

## Builds ground, walls, kit cover, gates, objective terminals, extraction pads and the dressing
## beyond the edge. Returns {"blocks": {key: Node3D}, "nodes": {id: {terminal, beacon, light}}}.
static func build(root: Node3D, state: Dictionary, mission: Dictionary) -> Dictionary:
	var env: Dictionary = mission.get("environment", {})
	light(root, env)
	var w := int(state.width)
	var h := int(state.height)
	var out := {"blocks": {}, "nodes": {}}
	var world := Node3D.new()
	world.name = "World"
	root.add_child(world)

	# ground: the playable floor, then an apron beyond it so the board does not float in space
	var floor_mat := pbr(String(env.get("ground", "concrete_pavement")), float(env.get("ground_scale", 0.45)))
	box(world, Vector3(w, 0.06, h), Vector3(w / 2.0, -0.03, h / 2.0), floor_mat)
	var apron_mat := pbr(String(env.get("apron", "asphalt_02")), 0.3, Color(0.75, 0.75, 0.78))
	box(world, Vector3(w + 60, 0.05, h + 60), Vector3(w / 2.0, -0.08, h / 2.0), apron_mat)
	# tile seams, faint, as on the web board
	var seam := glow(Color(0.55, 0.7, 0.85), 0.25, 0.10)
	for x in w + 1:
		box(world, Vector3(0.012, 0.004, h), Vector3(x, 0.002, h / 2.0), seam)
	for y in h + 1:
		box(world, Vector3(w, 0.004, 0.012), Vector3(w / 2.0, 0.002, y), seam)

	var wall_mat := pbr(String(env.get("wall", "concrete_wall_006")), 0.6)
	var wall_h := M(float(env.get("wall_m", 3.4)))
	var cap_mat := pbr("concrete_wall_006", 0.6, Color(0.6, 0.62, 0.66))
	var high_kit: Array = env.get("high", ["high-cover-4"])
	var low_kit: Array = env.get("low", ["low-barrier-4"])
	var i_high := 0
	var i_low := 0
	for k in state.blockers:
		var b: Dictionary = state.blockers[k]
		var xy := String(k).split(":")
		var x := int(xy[0])
		var y := int(xy[1])
		var p := c(x, y)
		var runs_x: bool = state.blockers.has(R_k(x - 1, y)) or state.blockers.has(R_k(x + 1, y))
		match String(b.kind):
			"WALL":
				var wm := box(world, Vector3(1, wall_h, 1), p + Vector3(0, wall_h / 2.0, 0), wall_mat)
				box(wm, Vector3(1.02, M(0.18), 1.02), Vector3(0, wall_h / 2.0 + M(0.09), 0), cap_mat)
				out.blocks[k] = wm
			"GATE":
				var g = kit("gate-8", 1.0 if runs_x else M(0.4), M(0.4) if runs_x else 1.0, M(3.6))
				if g == null:
					g = box(world, Vector3(0.95, M(3.6), 0.15), p + Vector3(0, M(1.8), 0), glow(Color("ffb547"), 0.6))
				else:
					g.position = p
					world.add_child(g)
				var stripe: MeshInstance3D = box(g if g is MeshInstance3D else world, Vector3(0.9, M(0.12), 0.9), (Vector3.ZERO if g is MeshInstance3D else p) + Vector3(0, M(3.7), 0), glow(Color("ffb547"), 3.0))
				out.blocks[k] = [g, stripe]
			"HIGH":
				var id := String(high_kit[i_high % high_kit.size()])
				i_high += 1
				out.blocks[k] = _place_cover(world, id, p, M(2.1), x + y)
			"LOW":
				var id2 := String(low_kit[i_low % low_kit.size()])
				i_low += 1
				out.blocks[k] = _place_cover(world, id2, p, M(1.15), x * 3 + y)

	# objective terminals: the kit's relay terminal, an amber beacon and a lamp, as on Transit / Relay
	for n in state.nodes:
		var p := c(int(n.at.x), int(n.at.y))
		var t = kit("relay-terminal", M(1.44), M(1.44), M(2.2))
		if t == null:
			t = box(world, Vector3(M(1.4), M(2.2), M(1.4)), p + Vector3(0, M(1.1), 0), pbr("container_side", 1.0))
		else:
			t.position = p
			world.add_child(t)
		var plinth := box(world, Vector3(0.86, M(0.12), 0.86), p + Vector3(0, M(0.06), 0), pbr("metal_grate_rusty", 1.2))
		var beacon := box(world, Vector3(M(0.5), M(0.5), M(0.5)), p + Vector3(0, M(2.6), 0), glow(Color("ffb547"), 4.0))
		var l := OmniLight3D.new()
		l.light_color = Color("ffb547")
		l.light_energy = 2.0
		l.omni_range = 2.6
		l.position = p + Vector3(0, M(2.4), 0)
		world.add_child(l)
		out.nodes[n.id] = {"terminal": t, "beacon": beacon, "light": l, "plinth": plinth}

	# extraction: the kit's marker and a green rim light
	var ex: Array = state.extraction.get("cells", [])
	for e in ex:
		var p := c(int(e.x), int(e.y))
		var mk = kit("extraction-marker", 0.92, 0.92, M(0.12))
		if mk:
			mk.position = p + Vector3(0, 0.004, 0)
			world.add_child(mk)
		box(world, Vector3(0.94, 0.01, 0.94), p + Vector3(0, 0.012, 0), glow(Color("5cdb80"), 1.2, 0.28))
	if ex.size():
		var mid := Vector3.ZERO
		for e in ex:
			mid += c(int(e.x), int(e.y))
		lamp(world, mid / ex.size() + Vector3(0, 0.9, 0), Color("5cdb80"), 1.6, 3.5)

	# lamps over the board
	for lp in env.get("lamps", []):
		var pos := c(int(lp[0]), int(lp[1]))
		_lamp_post(world, pos, Color(env.get("lamp_color", "ffa458")))

	# dressing beyond the playable edge only: [kit id, tile x, tile z, w m, d m, h m, yaw degrees]
	for d in env.get("dressing", []):
		var uniform: bool = ["tree-8", "rock-cluster", "pipe-stack-6"].has(String(d[0]))
		var o = kit(String(d[0]), M(float(d[3])), M(float(d[4])), M(float(d[5])), uniform)
		if o:
			o.position = Vector3(float(d[1]), 0, float(d[2]))
			o.rotation.y = deg_to_rad(float(d[6]) if d.size() > 6 else 0.0)
			world.add_child(o)
	return out

static func R_k(x: int, y: int) -> String:
	return "%d:%d" % [x, y]

static func _place_cover(world: Node3D, id: String, p: Vector3, h: float, salt: int):
	var a = catalog().get(id)
	var o = null
	if a != null:
		var real_h := minf(float(a.height), h * TILE_M * 1.6)
		var footprint := 0.86
		match id:
			"crate-2":
				o = kit(id, M(2.0), M(2.0), M(1.8))
			"hvac-3":
				o = kit(id, footprint, M(2.4), M(1.7))
			"pipe-stack-6", "rock-cluster", "tree-8":
				o = kit(id, footprint, footprint, h, true)
			"container-12":
				o = kit(id, 0.98, footprint, M(2.6))
			_:
				o = kit(id, footprint, M(1.0) if h < M(1.5) else M(1.5), h)
		if o and real_h > 0:
			o.position = p
			o.rotation.y = (PI / 2.0) * (salt % 2)
			world.add_child(o)
			return o
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.5, 0.5, 0.48)
	return box(world, Vector3(0.86, h, 0.86), p + Vector3(0, h / 2.0, 0), m)

static func _lamp_post(world: Node3D, pos: Vector3, color: Color) -> void:
	var pole_mat := StandardMaterial3D.new()
	pole_mat.albedo_color = Color(0.12, 0.13, 0.14)
	pole_mat.metallic = 0.6
	pole_mat.roughness = 0.4
	var hgt := M(5.2)
	box(world, Vector3(M(0.14), hgt, M(0.14)), pos + Vector3(0, hgt / 2.0, 0), pole_mat)
	box(world, Vector3(M(1.0), M(0.1), M(0.3)), pos + Vector3(M(0.45), hgt, 0), pole_mat)
	box(world, Vector3(M(0.5), M(0.05), M(0.22)), pos + Vector3(M(0.75), hgt - M(0.07), 0), glow(color, 5.0))
	lamp(world, pos + Vector3(M(0.8), hgt - M(0.3), 0), color, 3.2, 5.5)
