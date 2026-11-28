class_name Prim3Operators
extends RefCounted
## The squad and the hostiles as the web game draws them.
##
## E, R and T are the generated operator models in assets/3d/prim3-operators (made from the owner's
## loadout photographs, Prim3 phenotypes/operators/LOADOUTS.md), stood at the canon 1.75 m with their
## feet at the origin, facing +Z. H, the SOI-01 security officer, has no model yet, so it is the
## web game's procedural mannequin (js/prim3-tactics/operatives3d.mjs, H branch): faceless black
## figure, short sleeves, thin vest, body camera, holstered sidearm, cyberdeck; no helmet, no long gun.
## No marks are drawn anywhere.

const Env := preload("res://scripts/environment.gd")
const WEB := "res://assets/web/operators/"

static var _models := {}

static func _std(color: Color, rough: float, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	return m

static func _aabb(n: Node) -> AABB:
	var box := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var t: Transform3D = Transform3D.IDENTITY
		var cur: Node = mi
		while cur != null and cur != n:
			if cur is Node3D:
				t = (cur as Node3D).transform * t
			cur = cur.get_parent()
		var b: AABB = t * (mi as MeshInstance3D).get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box

## A generated operator model for E/R/T, normalised to operator height; null if it is missing.
static func glb_operator(role: String):
	var path := WEB + role + ".glb"
	if not _models.has(role):
		_models[role] = load(path) if ResourceLoader.exists(path) else null
	var scene: PackedScene = _models[role]
	if scene == null:
		return null
	var inner: Node3D = scene.instantiate()
	var holder := Node3D.new()
	holder.add_child(inner)
	var box := _aabb(inner)
	var target := Env.M(Env.OPERATOR_HEIGHT_M)
	var s := target / maxf(box.size.y, 0.001)
	inner.scale = Vector3.ONE * s
	inner.position = Vector3(-(box.position.x + box.size.x / 2.0) * s, -box.position.y * s, -(box.position.z + box.size.z / 2.0) * s)
	Env._shadows(holder)
	return holder

## The SOI-01 security officer, built in metres and scaled to a tile world.
static func soi_officer() -> Node3D:
	var body := _std(Color("0a0a0b"), 0.32, 0.08)
	var cloth := _std(Color("1a1d22"), 0.93)
	var vest := _std(Color("22262c"), 0.8)
	var hard := _std(Color("0d0e10"), 0.42, 0.35)
	var boot := _std(Color("080808"), 0.55)
	var red := Env.glow(Color("ff3344"), 6.0)
	var g := Node3D.new()
	var parts := Node3D.new()
	g.add_child(parts)
	var add := func(mesh: Mesh, mat: Material, pos: Vector3, scl := Vector3.ONE) -> MeshInstance3D:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = mat
		mi.position = pos
		mi.scale = scl
		parts.add_child(mi)
		return mi
	var cap := func(r: float, h: float) -> CapsuleMesh:
		var c := CapsuleMesh.new()
		c.radius = r
		c.height = maxf(h, r * 2.0)
		return c
	var bx := func(x: float, y: float, z: float) -> BoxMesh:
		var b := BoxMesh.new()
		b.size = Vector3(x, y, z)
		return b
	# legs and boots
	for sx in [-1, 1]:
		add.call(cap.call(0.075, 0.5), cloth, Vector3(sx * 0.1, 0.68, 0))
		add.call(cap.call(0.06, 0.46), cloth, Vector3(sx * 0.1, 0.27, 0))
		add.call(bx.call(0.11, 0.09, 0.26), boot, Vector3(sx * 0.1, 0.045, 0.04))
	# hips, belt, holster
	add.call(bx.call(0.31, 0.16, 0.2), cloth, Vector3(0, 0.92, 0))
	add.call(bx.call(0.33, 0.045, 0.215), vest, Vector3(0, 0.985, 0))
	add.call(bx.call(0.05, 0.16, 0.08), hard, Vector3(-0.19, 0.9, 0.02))
	# torso, thin vest, body camera
	add.call(cap.call(0.16, 0.56), cloth, Vector3(0, 1.25, 0), Vector3(1.12, 1, 0.76))
	add.call(bx.call(0.34, 0.3, 0.27), vest, Vector3(0, 1.25, 0))
	add.call(bx.call(0.05, 0.065, 0.028), hard, Vector3(-0.09, 1.36, 0.145))
	add.call(SphereMesh.new(), red, Vector3(-0.075, 1.345, 0.16), Vector3.ONE * 0.014)
	# short sleeves and bare black forearms
	for sx in [-1, 1]:
		add.call(cap.call(0.07, 0.26), cloth, Vector3(sx * 0.25, 1.33, 0))
		add.call(cap.call(0.05, 0.3), body, Vector3(sx * 0.27, 1.06, 0.03))
	# cyberdeck held at the waist
	add.call(bx.call(0.26, 0.02, 0.18), hard, Vector3(0, 1.0, 0.2))
	add.call(bx.call(0.26, 0.16, 0.015), Env.glow(Color("39424d"), 0.4), Vector3(0, 1.08, 0.12))
	# neck and faceless head
	add.call(cap.call(0.046, 0.1), body, Vector3(0, 1.55, 0))
	var head := SphereMesh.new()
	head.radius = 0.1
	head.height = 0.2
	add.call(head, body, Vector3(0, 1.69, 0.01), Vector3(0.9, 1.26, 1.0))
	parts.scale = Vector3.ONE * Env.M(1.0) * (Env.OPERATOR_HEIGHT_M / 1.84)
	Env._shadows(g)
	return g

## {root, model, ring, label} for one unit.
static func make(u: Dictionary) -> Dictionary:
	var root := Node3D.new()
	var model = glb_operator(String(u.role)) if u.faction == "PLAYER" else null
	if model == null:
		model = soi_officer()
	root.add_child(model)
	# team glow ring on the ground, as on Transit / Relay
	var ring := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 0.17
	torus.outer_radius = 0.2
	ring.mesh = torus
	var team: Color = Env.TEAM[u.faction]
	ring.material_override = Env.glow(team, 2.5)
	ring.position = Vector3(0, 0.01, 0)
	root.add_child(ring)
	var disc := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.19
	cyl.bottom_radius = 0.19
	cyl.height = 0.002
	disc.mesh = cyl
	disc.material_override = Env.glow(team, 0.8, 0.18)
	disc.position = Vector3(0, 0.006, 0)
	root.add_child(disc)
	var sel := MeshInstance3D.new()
	var st := TorusMesh.new()
	st.inner_radius = 0.24
	st.outer_radius = 0.27
	sel.mesh = st
	sel.material_override = Env.glow(Color.WHITE, 3.0)
	sel.position = Vector3(0, 0.012, 0)
	sel.visible = false
	root.add_child(sel)
	var lbl := Label3D.new()
	lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lbl.font_size = 40
	lbl.pixel_size = 0.0045
	lbl.outline_size = 10
	lbl.position = Vector3(0, Env.M(2.25), 0)
	lbl.no_depth_test = true
	root.add_child(lbl)
	return {"root": root, "body": model, "ring": sel, "team": ring, "label": lbl}
