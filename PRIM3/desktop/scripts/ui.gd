class_name Prim3UI
extends RefCounted
## Small UI kit for the desktop build: one dark palette, plain text, no marks drawn.

const BG := Color(0.035, 0.043, 0.06)
const PANEL := Color(0.07, 0.085, 0.11, 0.92)
const LINE := Color(0.2, 0.24, 0.3)
const TEXT := Color(0.92, 0.94, 0.96)
const MUTED := Color(0.58, 0.63, 0.7)
const ACCENT := Color(0.2, 0.78, 0.92)
const DANGER := Color(0.95, 0.33, 0.3)
const GOOD := Color(0.36, 0.86, 0.5)
const WARN := Color(0.98, 0.78, 0.3)

const CONTROLS_HELP := "Left-click an operative to select it, a blue tile to move (1 AP), a yellow tile to dash (2 AP), a visible hostile to fire. Tab: next operative · O overwatch · H hunker · R reload · F objective · X extract · Space or Enter: end turn · WASD or arrow keys: pan · Q / E: rotate · mouse wheel: zoom · Esc: menu · F11: fullscreen."

static func screen() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(bg)
	return root

static func label(text: String, size := 18, color := TEXT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l

static func spacer(h: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c

static func box(color: Color, border := LINE, radius := 8) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = color
	s.border_color = border
	s.set_border_width_all(1)
	s.set_corner_radius_all(radius)
	s.content_margin_left = 14
	s.content_margin_right = 14
	s.content_margin_top = 10
	s.content_margin_bottom = 10
	return s

static func button(text: String, size := 18) -> Button:
	var b := Button.new()
	b.text = text
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.add_theme_font_size_override("font_size", size)
	b.add_theme_color_override("font_color", TEXT)
	b.add_theme_color_override("font_disabled_color", Color(MUTED, 0.5))
	b.add_theme_stylebox_override("normal", box(Color(0.09, 0.11, 0.14)))
	b.add_theme_stylebox_override("hover", box(Color(0.12, 0.16, 0.2), ACCENT))
	b.add_theme_stylebox_override("pressed", box(Color(0.08, 0.2, 0.25), ACCENT))
	b.add_theme_stylebox_override("focus", box(Color(0.12, 0.16, 0.2), ACCENT))
	b.add_theme_stylebox_override("disabled", box(Color(0.06, 0.07, 0.09), Color(LINE, 0.5)))
	return b

static func panel() -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", box(PANEL))
	return p
