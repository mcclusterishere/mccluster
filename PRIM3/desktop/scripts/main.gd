extends Node
## PRIM3 desktop entry point: the McCluster studio playtest when launched with --mccluster-scenario,
## otherwise the title menu, the mission board and the Site 0 facility viewer.

const Studio := preload("res://scripts/studio.gd")
const BoardScript := preload("res://scripts/board.gd")
const FacilityScript := preload("res://scripts/facility.gd")
const UI := preload("res://scripts/ui.gd")
const SAVE_PATH := "user://prim3-desktop-save.json"

var missions: Array = []
var save := {"completed": [], "best": {}}
var current: Node = null

func _ready() -> void:
	missions = load_missions()
	var args := OS.get_cmdline_user_args()
	if Studio.wants_studio(args):
		var code: int = Studio.new().run(missions, args)
		get_tree().quit(code)
		return
	load_save()
	show_menu()
	_maybe_capture(args)

## --prim3-capture=<png> [--prim3-screen=menu|brief|board|facility] [--prim3-mission=<n>]: render one
## screen, save it and quit. Used to check the build renders (and for screenshots) without a person.
func _maybe_capture(args: PackedStringArray) -> void:
	var out := ""
	var screen := "menu"
	var index := 0
	for a in args:
		if a.begins_with("--prim3-capture="):
			out = a.get_slice("=", 1)
		elif a.begins_with("--prim3-screen="):
			screen = a.get_slice("=", 1)
		elif a.begins_with("--prim3-mission="):
			index = int(a.get_slice("=", 1))
	if out == "":
		return
	match screen:
		"brief":
			show_brief(index)
		"board":
			start_mission(index)
		"facility":
			show_facility()
	for _i in 45:
		await get_tree().process_frame
	if screen == "board" and current.has_method("demo_hover"):
		current.demo_hover()
		for _i in 10:
			await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png(out)
	print("captured ", out)
	get_tree().quit()

static func load_missions() -> Array:
	var text := FileAccess.get_file_as_string("res://data/missions.json")
	var data = JSON.parse_string(text)
	var list: Array = data.missions
	list.sort_custom(func(a, b): return int(a.order) < int(b.order))
	return list

func load_save() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var data = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if data is Dictionary:
		save.completed = data.get("completed", [])
		save.best = data.get("best", {})

func write_save() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(save, "  "))

func _swap(node: Node) -> void:
	if current:
		current.queue_free()
	current = node
	add_child(node)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_F11:
		var w := get_window()
		w.mode = Window.MODE_WINDOWED if w.mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN

# ---------- menu ----------

func unlocked(index: int) -> bool:
	return index == 0 or save.completed.has(missions[index - 1].id)

func show_menu() -> void:
	var root := UI.screen()
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	col.custom_minimum_size = Vector2(520, 0)
	col.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	col.grow_horizontal = Control.GROW_DIRECTION_BOTH
	col.grow_vertical = Control.GROW_DIRECTION_BOTH
	root.add_child(col)
	col.add_child(UI.label("PRIM3", 72, UI.TEXT))
	col.add_child(UI.label("Site 0 tactical missions", 22, UI.MUTED))
	col.add_child(UI.spacer(18))
	col.add_child(UI.label("MISSIONS", 15, UI.MUTED))
	for i in missions.size():
		var m: Dictionary = missions[i]
		var done: bool = save.completed.has(m.id)
		var text := "%d.  %s   ·   %s%s" % [i + 1, m.title, m.level, "   ✓" if done else ""]
		var b := UI.button(text)
		b.disabled = not unlocked(i)
		if b.disabled:
			b.tooltip_text = "Finish the mission before it to unlock this one."
		b.pressed.connect(show_brief.bind(i))
		col.add_child(b)
	col.add_child(UI.spacer(10))
	var fac := UI.button("Site 0 facility")
	fac.pressed.connect(show_facility)
	col.add_child(fac)
	var full := UI.button("Toggle fullscreen  (F11)")
	full.pressed.connect(func():
		var w := get_window()
		w.mode = Window.MODE_WINDOWED if w.mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN)
	col.add_child(full)
	var quit := UI.button("Quit")
	quit.pressed.connect(func(): get_tree().quit())
	col.add_child(quit)
	col.add_child(UI.spacer(10))
	col.add_child(UI.label("McCluster Corp · v%s" % ProjectSettings.get_setting("application/config/version", "0.1.0"), 13, UI.MUTED))
	_swap(root)

func show_brief(index: int) -> void:
	var m: Dictionary = missions[index]
	var root := UI.screen()
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	col.custom_minimum_size = Vector2(640, 0)
	col.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	col.grow_horizontal = Control.GROW_DIRECTION_BOTH
	col.grow_vertical = Control.GROW_DIRECTION_BOTH
	root.add_child(col)
	col.add_child(UI.label("%s  ·  %s" % [m.level, m.title], 40, UI.TEXT))
	var brief := UI.label(m.brief, 19, UI.TEXT)
	brief.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(brief)
	col.add_child(UI.label("Clock: %d rounds   ·   Hostiles: %d   ·   %s" % [int(m.clock), m.hostiles.size(), "Squad starts concealed" if m.get("concealed", false) else "The guards are awake"], 16, UI.MUTED))
	var help := UI.label(UI.CONTROLS_HELP, 15, UI.MUTED)
	help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(help)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var go := UI.button("Deploy")
	go.pressed.connect(start_mission.bind(index))
	var back := UI.button("Back")
	back.pressed.connect(show_menu)
	row.add_child(go)
	row.add_child(back)
	col.add_child(row)
	_swap(root)
	go.grab_focus()

func start_mission(index: int) -> void:
	var board: Node3D = BoardScript.new()
	board.mission = missions[index]
	board.finished.connect(_on_finished.bind(index))
	board.quit_to_menu.connect(show_menu)
	board.restart.connect(start_mission.bind(index))
	_swap(board)

func _on_finished(outcome: String, rounds: int, index: int) -> void:
	if outcome != "win":
		return
	var id: String = missions[index].id
	if not save.completed.has(id):
		save.completed.append(id)
	var best = save.best.get(id)
	if best == null or rounds < int(best):
		save.best[id] = rounds
	write_save()

func show_facility() -> void:
	var f: Node3D = FacilityScript.new()
	f.back.connect(show_menu)
	_swap(f)
