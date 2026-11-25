#!/usr/bin/env python3
"""Equity Uprise interior furniture kit (v3).

One shared, data-driven furniture library for every floor builder.

* ``furniture-catalog-v3.json`` holds real-world dimensions (inches), clearances
  and the form recipe for every furniture type.
* each floor's ``floor-XX-interior-layout-v3.json`` holds the placements: stable
  id, catalog type, position, rotation, zone and the program/occupancy source
  that justifies the piece.
* this module turns a catalog type + floor palette into ONE merged mesh and adds
  every placement as a node that references that mesh. Repeated pieces (eight
  forum chairs, twelve carrels) therefore share one glTF mesh: instancing-friendly,
  one material path per piece, phone-friendly triangle counts.

Local furniture frame: feet, origin at the footprint centre on the floor, +Y is
the direction the piece *faces* (the way a seated person looks, the working
side of a desk). ``rot_deg`` rotates that frame counter-clockwise about +Z.

The kit draws furniture. It never draws a logo or lettering: brand marks are
brand slots (see ``production/brand/``) filled at runtime from owner-supplied
artwork only.

NOT FOR CONSTRUCTION.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import trimesh

FT = 0.3048
IN = 1.0 / 12.0
HERE = Path(__file__).resolve().parent
CATALOG_PATH = HERE / "furniture-catalog-v3.json"
CATALOG = json.loads(CATALOG_PATH.read_text())
TYPES = CATALOG["types"]

DEFAULT_PALETTE = {
    "upholstery": [71, 69, 68, 255],
    "upholstery_alt": [86, 83, 80, 255],
    "leather": [92, 62, 45, 255],
    "wood": [108, 82, 60, 255],
    "wood_dark": [70, 52, 40, 255],
    "metal": [48, 51, 56, 255],
    "metal_light": [128, 131, 134, 255],
    "stone": [70, 71, 72, 255],
    "laminate": [196, 192, 184, 255],
    "screen": [22, 29, 34, 255],
    "accent": [133, 26, 29, 255],
    "white": [222, 221, 216, 255],
    "plant": [66, 92, 62, 255],
    "plant_alt": [88, 112, 74, 255],
    "rug": [58, 56, 55, 255],
    "glass": [196, 220, 228, 110],
    "paper": [214, 206, 188, 255],
    "safety": [196, 156, 38, 255],
}


# ---------------------------------------------------------------------------
# primitive parts (local feet coordinates)
# ---------------------------------------------------------------------------
class Parts:
    def __init__(self, palette):
        self.pal = palette
        self.meshes = []

    def _color(self, key):
        c = self.pal.get(key) or DEFAULT_PALETTE.get(key)
        if c is None:
            raise KeyError(f"palette key {key!r} missing")
        return c

    def box(self, x1, y1, z1, x2, y2, z2, key):
        if not (x2 > x1 and y2 > y1 and z2 > z1):
            raise ValueError(f"degenerate furniture box {(x1, y1, z1, x2, y2, z2)}")
        m = trimesh.creation.box(extents=(x2 - x1, y2 - y1, z2 - z1))
        m.apply_translation(((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2))
        m.visual.face_colors = self._color(key)
        self.meshes.append(m)
        return m

    def cbox(self, cx, cy, w, d, z1, z2, key):
        return self.box(cx - w / 2, cy - d / 2, z1, cx + w / 2, cy + d / 2, z2, key)

    def tilted_box(self, cx, cy, w, d, z1, z2, tilt_deg, key):
        """Box tilted backwards about its bottom-front X edge (chair backs)."""
        m = trimesh.creation.box(extents=(w, d, z2 - z1))
        m.apply_translation((0, 0, (z2 - z1) / 2))
        m.apply_transform(trimesh.transformations.rotation_matrix(math.radians(-tilt_deg), [1, 0, 0]))
        m.apply_translation((cx, cy, z1))
        m.visual.face_colors = self._color(key)
        self.meshes.append(m)
        return m

    def cyl(self, cx, cy, r, z1, z2, key, sections=12):
        m = trimesh.creation.cylinder(radius=r, height=z2 - z1, sections=sections)
        m.apply_translation((cx, cy, (z1 + z2) / 2))
        m.visual.face_colors = self._color(key)
        self.meshes.append(m)
        return m

    def rod(self, p1, p2, r, key, sections=6):
        p1 = np.asarray(p1, float)
        p2 = np.asarray(p2, float)
        m = trimesh.creation.cylinder(radius=r, segment=np.vstack([p1, p2]), sections=sections)
        m.visual.face_colors = self._color(key)
        self.meshes.append(m)
        return m

    def blob(self, cx, cy, cz, rx, ry, rz, key, subdivisions=1):
        m = trimesh.creation.icosphere(subdivisions=subdivisions, radius=1.0)
        m.apply_scale((rx, ry, rz))
        m.apply_translation((cx, cy, cz))
        m.visual.face_colors = self._color(key)
        self.meshes.append(m)
        return m

    def merged(self):
        return trimesh.util.concatenate(self.meshes)


# ---------------------------------------------------------------------------
# form recipes: every recipe receives Parts, w, d, h (feet) and the type spec
# ---------------------------------------------------------------------------
def _legs4(p, w, d, top, inset, r, key, square=True):
    for sx in (-1, 1):
        for sy in (-1, 1):
            x = sx * (w / 2 - inset)
            y = sy * (d / 2 - inset)
            if square:
                p.cbox(x, y, 2 * r, 2 * r, 0, top, key)
            else:
                p.cyl(x, y, r, 0, top, key, 6)


def form_side_chair(p, w, d, h, s):
    seat_h = s.get("seat_h_in", 18) * IN
    up = s.get("upholstery", "upholstery")
    _legs4(p, w, d, seat_h - 0.12, 0.12, 0.045, "metal", square=False)
    p.cbox(0, 0.02, w, d - 0.08, seat_h - 0.16, seat_h, up)
    p.tilted_box(0, -d / 2 + 0.1, w - 0.04, 0.16, seat_h - 0.05, h, 8, s.get("back", up))


def form_task_chair(p, w, d, h, s):
    seat_h = s.get("seat_h_in", 19) * IN
    up = s.get("upholstery", "upholstery")
    for i in range(5):
        a = math.tau * i / 5 + math.pi / 2
        x2, y2 = math.cos(a) * w * 0.45, math.sin(a) * w * 0.45
        p.rod((0, 0, 0.18), (x2, y2, 0.12), 0.05, "metal", 5)
        p.cyl(x2, y2, 0.08, 0.0, 0.12, "metal", 6)
    p.cyl(0, 0, 0.07, 0.18, seat_h - 0.25, "metal_light", 8)
    p.cbox(0, 0.05, w * 0.72, d * 0.7, seat_h - 0.25, seat_h, up)
    p.tilted_box(0, -d * 0.32, w * 0.66, 0.14, seat_h + 0.25, h, 10, up)
    p.rod((0, -d * 0.3, seat_h - 0.1), (0, -d * 0.34, seat_h + 0.4), 0.05, "metal", 5)
    for sx in (-1, 1):
        x = sx * w * 0.38
        p.cbox(x, 0.0, 0.1, d * 0.42, seat_h + 0.58, seat_h + 0.68, "metal")
        p.cbox(x, -0.1, 0.07, 0.07, seat_h - 0.1, seat_h + 0.6, "metal")


def form_stool(p, w, d, h, s):
    up = s.get("upholstery", "upholstery")
    r = min(w, d) / 2
    p.cyl(0, 0, r * 0.9, 0, 0.05, "metal", 12)
    p.cyl(0, 0, 0.06, 0.05, h - 0.16, "metal_light", 8)
    p.cyl(0, 0, r * 0.62, h * 0.35, h * 0.35 + 0.05, "metal", 12)
    p.cyl(0, 0, r, h - 0.16, h, up, 14)


def form_armchair(p, w, d, h, s):
    up = s.get("upholstery", "upholstery")
    alt = s.get("upholstery_alt", "upholstery_alt")
    seat_h = s.get("seat_h_in", 16) * IN
    arm_w = s.get("arm_in", 5) * IN
    _legs4(p, w, d, 0.3, 0.2, 0.05, "wood_dark", square=False)
    p.cbox(0, 0, w, d, 0.3, seat_h - 0.3, up)
    p.cbox(0, 0.12, w - 2 * arm_w, d - 0.55, seat_h - 0.3, seat_h, alt)
    p.tilted_box(0, -d / 2 + 0.28, w - 2 * arm_w, 0.45, seat_h - 0.3, h, 6, up)
    for sx in (-1, 1):
        p.cbox(sx * (w / 2 - arm_w / 2), 0, arm_w, d, 0.3, seat_h + 0.62, up)


def form_sofa(p, w, d, h, s):
    up = s.get("upholstery", "upholstery")
    alt = s.get("upholstery_alt", "upholstery_alt")
    seat_h = s.get("seat_h_in", 17) * IN
    arm_w = s.get("arm_in", 7) * IN
    seats = s.get("seats", 3)
    p.cbox(0, 0, w - 0.3, d - 0.3, 0.0, 0.3, "metal")
    p.cbox(0, 0, w, d, 0.3, seat_h - 0.35, up)
    inner = w - 2 * arm_w
    cw = inner / seats
    for i in range(seats):
        cx = -inner / 2 + cw * (i + 0.5)
        p.cbox(cx, 0.15, cw - 0.06, d - 0.75, seat_h - 0.35, seat_h, alt)
        p.tilted_box(cx, -d / 2 + 0.42, cw - 0.08, 0.5, seat_h - 0.05, h - 0.05, 9, alt)
    p.cbox(0, -d / 2 + 0.2, w, 0.4, seat_h - 0.35, h - 0.25, up)
    for sx in (-1, 1):
        p.cbox(sx * (w / 2 - arm_w / 2), 0, arm_w, d, 0.3, seat_h + 0.55, up)


def form_sectional_l(p, w, d, h, s):
    """L sectional: main run along local x at the back, return along -x side."""
    up = s.get("upholstery", "upholstery")
    alt = s.get("upholstery_alt", "upholstery_alt")
    depth = s.get("seat_depth_in", 38) * IN
    seat_h = s.get("seat_h_in", 17) * IN
    # main run (back edge at -d/2)
    y0 = -d / 2 + depth / 2
    p.cbox(0, y0, w, depth, 0.0, seat_h - 0.35, up)
    p.cbox(0, -d / 2 + 0.2, w, 0.4, seat_h - 0.35, h - 0.2, up)
    n = max(2, int(round((w - depth) / 2.6)))
    cw = (w - depth) / n
    for i in range(n):
        cx = -w / 2 + depth + cw * (i + 0.5)
        p.cbox(cx, y0 + 0.2, cw - 0.06, depth - 0.75, seat_h - 0.35, seat_h, alt)
    # return run along local -x (back edge at -w/2)
    xr = -w / 2 + depth / 2
    ret_len = d - depth
    yr = -d / 2 + depth + ret_len / 2
    p.cbox(xr, yr, depth, ret_len, 0.0, seat_h - 0.35, up)
    p.cbox(-w / 2 + 0.2, (y0 + yr) / 2 + ret_len / 4, 0.4, d - 0.4, seat_h - 0.35, h - 0.2, up)
    p.cbox(xr + 0.2, yr, depth - 0.75, ret_len - 0.1, seat_h - 0.35, seat_h, alt)
    p.cbox(-w / 2 + depth / 2 + 0.2, y0 + 0.2, depth - 0.7, depth - 0.75, seat_h - 0.35, seat_h, alt)
    p.cbox(w / 2 - 0.3, y0, 0.6, depth, seat_h - 0.35, seat_h + 0.5, up)


def form_bench(p, w, d, h, s):
    top = s.get("top", "wood")
    p.cbox(0, 0, w, d, h - 0.17, h, top)
    p.cbox(0, 0, w - 0.3, d - 0.2, h - 0.25, h - 0.17, s.get("upholstery", top))
    for sx in (-1, 1):
        p.cbox(sx * (w / 2 - 0.35), 0, 0.12, d - 0.1, 0, h - 0.17, "metal")
    p.cbox(0, 0, w - 0.8, 0.1, 0.25, 0.35, "metal")


def form_banquette(p, w, d, h, s):
    up = s.get("upholstery", "upholstery")
    alt = s.get("upholstery_alt", "upholstery_alt")
    seat_h = s.get("seat_h_in", 18) * IN
    p.cbox(0, 0.1, w, d - 0.2, 0.0, seat_h - 0.3, "wood_dark")
    p.cbox(0, 0.15, w - 0.1, d - 0.45, seat_h - 0.3, seat_h, alt)
    p.cbox(0, -d / 2 + 0.25, w, 0.5, seat_h - 0.3, h, up)
    p.cbox(0, -d / 2 + 0.06, w, 0.12, 0.0, h + 0.05, "wood_dark")


def form_pouf(p, w, d, h, s):
    up = s.get("upholstery", "upholstery_alt")
    r = min(w, d) / 2
    p.cyl(0, 0, r * 0.94, 0, 0.12, "metal", 12)
    p.cyl(0, 0, r, 0.12, h, up, 14)


def form_table_rect(p, w, d, h, s):
    top = s.get("top", "wood")
    base = s.get("base", "legs")
    th = s.get("top_in", 1.5) * IN
    p.cbox(0, 0, w, d, h - th, h, top)
    if base == "trestle":
        for sx in (-1, 1):
            x = sx * (w / 2 - min(1.2, w * 0.18))
            p.cbox(x, 0, 0.16, d - 0.6, 0.1, h - th, "metal")
            p.cbox(x, 0, 0.3, d - 0.3, 0, 0.1, "metal")
        p.cbox(0, 0, w - 2 * min(1.2, w * 0.18), 0.12, h - th - 0.35, h - th - 0.2, "metal")
    elif base == "panel":
        for sx in (-1, 1):
            p.cbox(sx * (w / 2 - 0.12), 0, 0.12, d - 0.1, 0, h - th, s.get("panel", top))
        p.cbox(0, -d / 2 + 0.45, w - 0.3, 0.06, h - th - 1.0, h - th, s.get("panel", top))
    elif base == "pedestal2":
        for sx in (-1, 1):
            x = sx * w * 0.28
            p.cbox(x, 0, 0.5, 0.5, 0.08, h - th, "metal")
            p.cbox(x, 0, 1.0, d * 0.7, 0, 0.08, "metal")
    else:
        _legs4(p, w, d, h - th, 0.25, 0.07, "metal")
        p.cbox(0, -d / 2 + 0.25, w - 0.6, 0.06, h - th - 0.35, h - th, "metal")
        p.cbox(0, d / 2 - 0.25, w - 0.6, 0.06, h - th - 0.35, h - th, "metal")
    if s.get("power_module"):
        p.cbox(0, 0, min(1.4, w * 0.2), 0.45, h, h + 0.04, "metal")


def form_table_round(p, w, d, h, s):
    top = s.get("top", "wood")
    r = min(w, d) / 2
    th = s.get("top_in", 1.5) * IN
    p.cyl(0, 0, r, h - th, h, top, 24)
    if r > 3:
        for i in range(3):
            a = math.tau * i / 3
            p.cyl(math.cos(a) * r * 0.42, math.sin(a) * r * 0.42, 0.22, 0, h - th, "metal", 10)
        p.cyl(0, 0, r * 0.5, h - th - 0.12, h - th, "metal", 16)
    else:
        p.cyl(0, 0, min(0.8, r * 0.6), 0, 0.08, "metal", 16)
        p.cyl(0, 0, 0.12, 0.08, h - th, "metal", 8)
    if s.get("power_module"):
        p.cyl(0, 0, 0.45, h, h + 0.05, "metal", 12)


def form_coffee_table(p, w, d, h, s):
    top = s.get("top", "wood_dark")
    p.cbox(0, 0, w, d, h - 0.12, h, top)
    p.cbox(0, 0, w - 0.4, d - 0.4, 0.25, 0.32, top)
    _legs4(p, w, d, h - 0.12, 0.12, 0.05, "metal")


def form_side_table(p, w, d, h, s):
    r = min(w, d) / 2
    p.cyl(0, 0, r, h - 0.1, h, s.get("top", "stone"), 16)
    p.cyl(0, 0, 0.07, 0.06, h - 0.1, "metal", 8)
    p.cyl(0, 0, r * 0.7, 0, 0.06, "metal", 14)


def _monitor(p, x, y, mw, mh, z, key="screen", tilt=0):
    p.cbox(x, y + 0.12, 0.35, 0.25, z - 0.06, z - 0.02, "metal")
    p.cbox(x, y + 0.12, 0.08, 0.08, z, z + 0.45, "metal")
    p.cbox(x, y, mw, 0.07, z + 0.35, z + 0.35 + mh, key)


def form_desk(p, w, d, h, s):
    top = s.get("top", "wood")
    th = 1.25 * IN
    p.cbox(0, 0, w, d, h - th, h, top)
    for sx in (-1, 1):
        p.cbox(sx * (w / 2 - 0.08), 0, 0.12, d - 0.05, 0, h - th, "metal")
    p.cbox(0, -d / 2 + 0.3, w - 0.3, 0.06, h - th - 1.1, h - th, s.get("panel", "metal"))
    n = s.get("monitors", 1)
    mw = s.get("monitor_w_in", 24) * IN
    if n:
        span = n * mw + (n - 1) * 0.05
        for i in range(n):
            x = -span / 2 + mw * (i + 0.5) + i * 0.05
            _monitor(p, x, -d / 2 + 0.55, mw, mw * 0.58, h)
    # Registered electronics can replace scenic screens without erasing input furniture.
    if s.get("keyboard", bool(n)):
        p.cbox(0, s.get("keyboard_y_ft", 0.15), min(1.5, w * 0.35), 0.5, h, h + 0.04, "metal")
    if s.get("pedestal", True):
        p.cbox(w / 2 - 0.85, -0.2, 1.3, d - 0.9, 0.05, h - 0.2, s.get("pedestal_finish", "metal"))
    if s.get("privacy_screen"):
        p.cbox(0, -d / 2 + 0.05, w, 0.1, h, h + s["privacy_screen"] * IN, s.get("screen_finish", "upholstery_alt"))
    if s.get("paper"):
        p.cbox(-w * 0.25, 0.2, 0.75, 0.95, h, h + 0.05, "paper")


def form_desk_l(p, w, d, h, s):
    """L-shaped executive desk; main top along local x, return toward -x/+y."""
    top = s.get("top", "wood_dark")
    th = 1.5 * IN
    md = s.get("main_depth_in", 36) * IN
    rd = s.get("return_depth_in", 24) * IN
    ym = -d / 2 + md / 2
    p.cbox(0, ym, w, md, h - th, h, top)
    p.cbox(-w / 2 + rd / 2, ym + md / 2 + (d - md) / 2, rd, d - md, h - th, h, top)
    p.cbox(w / 2 - 0.1, ym, 0.2, md, 0, h - th, top)
    p.cbox(0.6, -d / 2 + 0.1, w - 1.4, 0.12, 0.3, h - th, top)
    p.cbox(-w / 2 + rd / 2, d / 2 - 0.1, rd, 0.2, 0, h - th, top)
    p.cbox(-w / 2 + rd / 2, ym + md / 2 + 0.6, rd - 0.15, 1.2, 0.05, h - th, "wood_dark")
    if s.get("monitors", 1):
        _monitor(p, 0.3, -d / 2 + 0.6, 27 * IN, 27 * IN * 0.58, h)
    if s.get("keyboard", False):
        p.cbox(0.3, s.get("keyboard_y_ft", ym + 0.3), min(1.5, w * 0.35), 0.5, h, h + 0.04, "metal")
    p.cbox(1.6, -d / 2 + 0.9, 0.9, 0.6, h, h + 0.05, "paper")


def form_workbench(p, w, d, h, s):
    top = s.get("top", "wood")
    p.cbox(0, 0, w, d, h - 0.15, h, top)
    _legs4(p, w, d, h - 0.15, 0.15, 0.08, "metal")
    p.cbox(0, 0, w - 0.4, d - 0.4, 0.5, 0.58, "metal")
    # pegboard / riser at the back with a shelf and task light
    back = s.get("back_h_in", 30) * IN
    p.cbox(0, -d / 2 + 0.06, w, 0.1, h, h + back, s.get("pegboard", "laminate"))
    p.cbox(0, -d / 2 + 0.45, w, 0.75, h + back - 0.1, h + back, "metal")
    p.cbox(0, -d / 2 + 0.6, w - 0.4, 0.15, h + back - 0.3, h + back - 0.12, "white")
    if s.get("instrument"):
        p.cbox(-w * 0.25, -d / 2 + 0.7, 1.1, 0.8, h, h + 0.55, "metal")
        p.cbox(-w * 0.25, -d / 2 + 0.32, 0.9, 0.04, h + 0.12, h + 0.45, "screen")
    if s.get("monitors"):
        _monitor(p, w * 0.22, -d / 2 + 0.55, 24 * IN, 24 * IN * 0.58, h)
    if s.get("keyboard", False):
        p.cbox(0, 0.45, min(1.5, w * 0.35), 0.5, h, h + 0.04, "metal")
    if s.get("vise"):
        p.cbox(w / 2 - 0.4, d / 2 - 0.25, 0.5, 0.5, h, h + 0.35, "metal_light")


def form_carrel(p, w, d, h, s):
    top = s.get("top", "wood")
    scr = s.get("screen_h_in", 20) * IN
    p.cbox(0, 0, w, d, h - 0.1, h, top)
    for sx in (-1, 1):
        p.cbox(sx * (w / 2 - 0.05), 0, 0.1, d, 0, h + scr, s.get("panel", "wood"))
    p.cbox(0, -d / 2 + 0.05, w, 0.1, 0.4, h + scr, s.get("panel", "wood"))
    p.cbox(0, -d / 2 + 0.45, w - 0.2, 0.7, h + scr - 0.55, h + scr - 0.47, top)
    p.cbox(0, -d / 2 + 0.2, w * 0.5, 0.06, h + 0.1, h + 0.3, "accent" if s.get("lamp_accent") else "white")
    if s.get("paper", True):
        p.cbox(0.2, 0.1, 0.8, 1.0, h, h + 0.04, "paper")
    if s.get("keyboard", False):
        p.cbox(0, 0.45, min(1.5, w * 0.35), 0.5, h, h + 0.04, "metal")


def form_shelving(p, w, d, h, s):
    case = s.get("case", "wood_dark")
    shelves = s.get("shelves", 6)
    sections = max(1, int(round(w / 3.0)))
    double = s.get("double_sided", False)
    p.cbox(0, 0, w, d, 0, 0.3, case)
    p.cbox(0, 0, w, d, h - 0.1, h, case)
    for i in range(sections + 1):
        x = -w / 2 + i * (w / sections)
        x = min(max(x, -w / 2 + 0.05), w / 2 - 0.05)
        p.cbox(x, 0, 0.08, d, 0, h, case)
    if not double:
        p.cbox(0, -d / 2 + 0.04, w, 0.06, 0.3, h - 0.1, case)
    else:
        p.cbox(0, 0, w, 0.05, 0.3, h - 0.1, case)
    pitch = (h - 0.4) / shelves
    for k in range(1, shelves):
        p.cbox(0, 0, w - 0.1, d - 0.02, 0.3 + k * pitch - 0.05, 0.3 + k * pitch, case)
    # contents: book/box rows read as material, not pixel noise
    fill = s.get("fill", "paper")
    for k in range(shelves):
        z = 0.3 + k * pitch
        for i in range(sections):
            x0 = -w / 2 + i * (w / sections) + 0.12
            sw = w / sections - 0.24
            fr = 0.55 + 0.35 * ((i * 7 + k * 3) % 5) / 4
            faces = (-1, 1) if double else (1,)
            for fy in faces:
                yy = fy * d / 4 if double else 0.05
                dd = d / 2 - 0.12 if double else d - 0.25
                p.cbox(x0 + sw * fr / 2, yy, sw * fr, dd, z, z + pitch * 0.72, fill)


def form_cabinet(p, w, d, h, s):
    case = s.get("case", "wood_dark")
    p.cbox(0, 0, w - 0.1, d - 0.05, 0, 0.25, "metal")
    p.cbox(0, 0, w, d, 0.25, h - 0.08, case)
    p.cbox(0, 0, w + 0.04, d + 0.04, h - 0.08, h, s.get("top", "stone"))
    doors = max(1, int(round(w / 1.6)))
    for i in range(1, doors):
        x = -w / 2 + i * w / doors
        p.cbox(x, d / 2, 0.025, 0.03, 0.35, h - 0.15, "metal")
    drawers = s.get("drawers", 0)
    for k in range(1, drawers):
        z = 0.25 + k * (h - 0.33) / drawers
        p.cbox(0, d / 2, w - 0.1, 0.03, z - 0.02, z, "metal")


def form_flat_file(p, w, d, h, s):
    p.cbox(0, 0, w, d, 0, h - 0.12, s.get("case", "metal"))
    for k in range(1, 6):
        z = k * (h - 0.12) / 6
        p.cbox(0, d / 2, w - 0.15, 0.03, z - 0.03, z, "metal_light")
    p.cbox(0, 0, w + 0.1, d + 0.1, h - 0.12, h, s.get("top", "laminate"))
    p.cbox(-w * 0.15, 0, w * 0.55, d * 0.6, h, h + 0.02, "paper")
    p.cbox(w * 0.3, d * 0.1, w * 0.2, d * 0.3, h, h + 0.02, "paper")


def form_high_table(p, w, d, h, s):
    top = s.get("top", "wood")
    p.cbox(0, 0, w, d, h - 0.12, h, top)
    for sx in (-1, 1):
        p.cbox(sx * w * 0.32, 0, 0.18, 0.18, 0.08, h - 0.12, "metal")
        p.cbox(sx * w * 0.32, 0, 0.6, d * 0.75, 0, 0.08, "metal")
    p.cbox(0, 0, w * 0.64, 0.1, 0.9, 1.0, "metal")


def form_whiteboard(p, w, d, h, s):
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.08)
        p.cbox(x, 0, 0.1, 0.1, 0.25, h, "metal")
        p.cbox(x, 0, 0.12, d, 0.12, 0.2, "metal")
        for sy in (-1, 1):
            p.cyl(x, sy * (d / 2 - 0.08), 0.08, 0, 0.12, "metal", 6)
    p.cbox(0, 0, w - 0.25, 0.06, h * 0.38, h - 0.1, "white")
    p.cbox(0, 0.06, w - 0.6, 0.12, h * 0.38 - 0.05, h * 0.38, "metal")
    if s.get("pinned"):
        for i in range(5):
            p.cbox(-w * 0.35 + i * w * 0.17, 0.05, 0.55, 0.02, h * 0.55 + (i % 2) * 0.6, h * 0.55 + (i % 2) * 0.6 + 0.75, "paper")


def form_easel(p, w, d, h, s):
    p.rod((-w / 2 + 0.1, d / 2 - 0.1, 0), (0, 0, h), 0.04, "wood", 5)
    p.rod((w / 2 - 0.1, d / 2 - 0.1, 0), (0, 0, h), 0.04, "wood", 5)
    p.rod((0, -d / 2 + 0.1, 0), (0, 0, h), 0.04, "wood", 5)
    p.cbox(0, d * 0.18, w * 0.9, 0.05, h * 0.45, h * 0.92, "paper")
    p.cbox(0, d * 0.22, w * 0.9, 0.12, h * 0.44, h * 0.46, "wood")


def form_lectern(p, w, d, h, s):
    p.cbox(0, 0, w * 0.9, d * 0.8, 0, 0.12, "metal")
    p.cbox(0, 0, w * 0.6, d * 0.4, 0.12, h - 0.4, s.get("case", "wood_dark"))
    p.tilted_box(0, 0.25, w, d, h - 0.45, h - 0.33, -14, s.get("case", "wood_dark"))


def form_planter(p, w, d, h, s):
    r = min(w, d) / 2
    pot_h = s.get("pot_h_in", 22) * IN
    p.cyl(0, 0, r, 0, pot_h, s.get("pot", "stone"), 14)
    p.cyl(0, 0, r * 0.92, pot_h - 0.05, pot_h + 0.02, "wood_dark", 14)
    canopy = h - pot_h
    p.cyl(0, 0, 0.06, pot_h, pot_h + canopy * 0.55, "wood_dark", 5)
    p.blob(0, 0, pot_h + canopy * 0.62, r * 1.25, r * 1.2, canopy * 0.42, "plant", 1)
    p.blob(r * 0.45, -r * 0.3, pot_h + canopy * 0.42, r * 0.8, r * 0.75, canopy * 0.3, "plant_alt", 1)
    p.blob(-r * 0.4, r * 0.35, pot_h + canopy * 0.78, r * 0.75, r * 0.7, canopy * 0.25, "plant_alt", 1)


def form_planter_trough(p, w, d, h, s):
    pot_h = s.get("pot_h_in", 26) * IN
    p.cbox(0, 0, w, d, 0, pot_h, s.get("pot", "stone"))
    n = max(2, int(w / 1.6))
    for i in range(n):
        x = -w / 2 + (i + 0.5) * w / n
        p.blob(x, 0, pot_h + (h - pot_h) * 0.45, w / n * 0.62, d * 0.62, (h - pot_h) * 0.5, "plant" if i % 2 else "plant_alt", 1)


def form_rug(p, w, d, h, s):
    p.cbox(0, 0, w, d, 0.005, max(h, 0.04), s.get("finish", "rug"))
    if s.get("border"):
        b = 0.35
        k = s["border"]
        p.cbox(0, d / 2 - b / 2, w, b, 0.006, max(h, 0.04) + 0.003, k)
        p.cbox(0, -d / 2 + b / 2, w, b, 0.006, max(h, 0.04) + 0.003, k)


def form_plinth_display(p, w, d, h, s):
    p.cbox(0, 0, w, d, 0, h, s.get("case", "white"))
    if s.get("vitrine", True):
        p.cbox(0, 0, w - 0.1, d - 0.1, h, h + 1.2, "glass")
        p.cbox(0, 0, w * 0.35, d * 0.35, h, h + 0.45, s.get("object", "metal_light"))


def form_light_stand(p, w, d, h, s):
    for i in range(3):
        a = math.tau * i / 3 + math.pi / 2
        p.rod((0, 0, 1.0), (math.cos(a) * w * 0.45, math.sin(a) * d * 0.45, 0), 0.03, "metal", 5)
    p.rod((0, 0, 0.9), (0, 0, h - 0.8), 0.04, "metal", 6)
    p.cbox(0, 0.1, w * 0.95, 0.5, h - 1.3, h, "white")
    p.cbox(0, -0.25, w * 0.7, 0.25, h - 1.15, h - 0.15, "metal")


def form_camera_tripod(p, w, d, h, s):
    for i in range(3):
        a = math.tau * i / 3 + math.pi / 2
        p.rod((0, 0, h - 0.6), (math.cos(a) * w * 0.45, math.sin(a) * d * 0.45, 0), 0.03, "metal", 5)
    p.cbox(0, 0, 0.35, 0.8, h - 0.6, h - 0.15, "screen")
    p.cyl(0, 0.45, 0.12, h - 0.48, h - 0.28, "metal_light", 8)


def form_backdrop(p, w, d, h, s):
    for sx in (-1, 1):
        p.cbox(sx * (w / 2 - 0.1), 0, 0.1, 0.1, 0, h, "metal")
        p.cbox(sx * (w / 2 - 0.1), 0, 0.2, d, 0, 0.08, "metal")
    p.cbox(0, 0, w, 0.12, h - 0.15, h, "metal")
    p.cbox(0, 0.02, w - 0.3, 0.04, 0.0, h - 0.15, s.get("finish", "upholstery_alt"))
    p.cbox(0, d * 0.35, w - 0.3, d * 0.6, 0.0, 0.02, s.get("finish", "upholstery_alt"))


def form_mic_desk(p, w, d, h, s):
    """Round podcast/recording table with boom-arm microphones."""
    form_table_round(p, w, d, h, {"top": s.get("top", "wood_dark")})
    n = s.get("mics", 4)
    r = min(w, d) / 2
    for i in range(n):
        a = math.tau * i / n + math.pi / 4
        bx, by = math.cos(a) * r * 0.55, math.sin(a) * r * 0.55
        p.cyl(bx, by, 0.08, h, h + 0.08, "metal", 6)
        tx, ty = math.cos(a) * r * 0.82, math.sin(a) * r * 0.82
        p.rod((bx, by, h + 0.08), (tx, ty, h + 0.9), 0.025, "metal", 4)
        p.cyl(tx, ty, 0.09, h + 0.85, h + 1.15, "screen", 8)


def form_acoustic_screen(p, w, d, h, s):
    p.cbox(0, 0, w, 0.18, 0.15, h, s.get("finish", "upholstery_alt"))
    for sx in (-1, 1):
        p.cbox(sx * (w / 2 - 0.3), 0, 0.12, d, 0, 0.15, "metal")


def form_monitor_cart(p, w, d, h, s):
    p.cbox(0, 0, w * 0.9, d, 0, 0.15, "metal")
    p.cbox(0, 0, 0.3, 0.3, 0.15, h - 2.2, "metal")
    p.cbox(0, 0.15, w, 0.12, h - 2.6, h, "screen")


def form_kitchenette(p, w, d, h, s):
    p.cbox(0, 0, w, d - 0.05, 0, 0.3, "metal")
    p.cbox(0, 0, w, d - 0.05, 0.3, h - 0.12, s.get("case", "wood"))
    p.cbox(0, 0, w + 0.05, d, h - 0.12, h, s.get("top", "stone"))
    p.cbox(w * 0.2, 0.1, 1.5, 1.2, h - 0.05, h + 0.02, "metal_light")
    p.cbox(0, -d / 2 + 0.6, w, 1.1, h + 1.6, h + 3.6, s.get("case", "wood"))
    p.cbox(-w * 0.3, 0, 1.2, 1.2, h, h + 1.2, "metal")
    for i in range(1, int(w / 1.5)):
        x = -w / 2 + i * 1.5
        p.cbox(x, d / 2, 0.025, 0.03, 0.4, h - 0.2, "metal")


def form_mfp(p, w, d, h, s):
    p.cbox(0, 0, w, d, 0, h - 0.6, "white")
    p.cbox(0, 0, w, d, h - 0.6, h - 0.1, "metal_light")
    p.cbox(0, 0, w - 0.1, d - 0.2, h - 0.1, h, "white")
    p.cbox(w * 0.25, d / 2 - 0.1, 0.5, 0.2, h - 0.35, h - 0.15, "screen")


def form_lockers(p, w, d, h, s):
    n = max(1, int(round(w / 1.25)))
    p.cbox(0, 0, w, d, 0, 0.3, "metal")
    p.cbox(0, 0, w, d, 0.3, h, s.get("case", "metal_light"))
    for i in range(1, n):
        x = -w / 2 + i * w / n
        p.cbox(x, d / 2, 0.03, 0.03, 0.35, h - 0.05, "metal")
    for i in range(n):
        x = -w / 2 + (i + 0.5) * w / n
        for z in (h * 0.88, h * 0.82):
            p.cbox(x, d / 2, 0.5, 0.02, z, z + 0.02, "metal")


def form_tool_chest(p, w, d, h, s):
    p.cbox(0, 0, w, d, 0.25, h, s.get("case", "accent"))
    for k in range(1, 7):
        z = 0.25 + k * (h - 0.3) / 7
        p.cbox(0, d / 2, w - 0.1, 0.03, z - 0.02, z, "metal_light")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(sx * (w / 2 - 0.2), sy * (d / 2 - 0.2), 0.12, 0, 0.25, "metal", 6)


def form_console_rack(p, w, d, h, s):
    """Free-standing equipment rack (lab / staging)."""
    p.cbox(0, 0, w, d, 0, h, "metal")
    for k in range(1, 9):
        z = 0.4 + k * (h - 0.8) / 9
        p.cbox(0, d / 2 + 0.01, w - 0.3, 0.02, z, z + 0.25, "screen" if k % 3 else "metal_light")


FORMS = {
    "side_chair": form_side_chair,
    "task_chair": form_task_chair,
    "stool": form_stool,
    "armchair": form_armchair,
    "sofa": form_sofa,
    "sectional_l": form_sectional_l,
    "bench": form_bench,
    "banquette": form_banquette,
    "pouf": form_pouf,
    "table_rect": form_table_rect,
    "table_round": form_table_round,
    "coffee_table": form_coffee_table,
    "side_table": form_side_table,
    "desk": form_desk,
    "desk_l": form_desk_l,
    "workbench": form_workbench,
    "carrel": form_carrel,
    "shelving": form_shelving,
    "cabinet": form_cabinet,
    "flat_file": form_flat_file,
    "high_table": form_high_table,
    "whiteboard": form_whiteboard,
    "easel": form_easel,
    "lectern": form_lectern,
    "planter": form_planter,
    "planter_trough": form_planter_trough,
    "rug": form_rug,
    "plinth_display": form_plinth_display,
    "light_stand": form_light_stand,
    "camera_tripod": form_camera_tripod,
    "backdrop": form_backdrop,
    "mic_desk": form_mic_desk,
    "acoustic_screen": form_acoustic_screen,
    "monitor_cart": form_monitor_cart,
    "kitchenette": form_kitchenette,
    "mfp": form_mfp,
    "lockers": form_lockers,
    "tool_chest": form_tool_chest,
    "console_rack": form_console_rack,
}


# ---------------------------------------------------------------------------
# catalog resolution
# ---------------------------------------------------------------------------
def resolve(type_key, overrides=None):
    """Return (spec, w_ft, d_ft, h_ft) for a catalog type with optional size overrides."""
    if type_key not in TYPES:
        raise KeyError(f"unknown furniture type {type_key!r}")
    spec = dict(TYPES[type_key])
    spec.update(spec.get("options", {}))
    ov = dict(overrides or {})
    w = ov.pop("w_in", spec["dims_in"]["w"]) * IN
    d = ov.pop("d_in", spec["dims_in"]["d"]) * IN
    h = ov.pop("h_in", spec["dims_in"]["h"]) * IN
    spec.update(ov)
    return spec, w, d, h


def footprint_corners(x, y, w, d, rot_deg):
    a = math.radians(rot_deg)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for lx, ly in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        pts.append((x + lx * ca - ly * sa, y + lx * sa + ly * ca))
    return pts


def rot_toward(x, y, tx, ty):
    """Rotation (deg) that makes local +Y face the target point."""
    return math.degrees(math.atan2(-(tx - x), (ty - y)))


class FurnitureKit:
    """Places catalog furniture into a trimesh scene as instanced nodes."""

    def __init__(self, scene, palette, floor_tag, z0_ft=0.0, mark=None):
        self.scene = scene
        self.palette = dict(DEFAULT_PALETTE)
        self.palette.update(palette or {})
        self.floor_tag = floor_tag
        self.z0 = z0_ft
        self.mark = mark or (lambda _i: None)
        self.geoms = {}
        self.placed = []
        self.triangles = 0

    def _geom_key(self, type_key, spec, w, d, h, finish):
        sig = json.dumps({"t": type_key, "w": round(w, 4), "d": round(d, 4), "h": round(h, 4),
                          "f": finish, "o": {k: spec[k] for k in sorted(spec) if k not in ("label", "notes", "dims_in", "clearance_in", "category", "options", "source")}},
                         sort_keys=True, default=str)
        return f"{self.floor_tag}-FURN-{type_key}-{hashlib.sha1(sig.encode()).hexdigest()[:8]}"

    def _build(self, type_key, spec, w, d, h, finish):
        pal = dict(self.palette)
        pal.update(finish or {})
        p = Parts(pal)
        FORMS[spec["form"]](p, w, d, h, spec)
        mesh = p.merged()
        mesh.apply_scale(FT)
        return mesh

    def place(self, item):
        type_key = item["type"]
        spec, w, d, h = resolve(type_key, item.get("size"))
        finish = {k: v for k, v in (item.get("finish") or {}).items()}
        for k, v in list(finish.items()):
            if isinstance(v, str):
                finish[k] = self.palette.get(v) or DEFAULT_PALETTE[v]
        gkey = self._geom_key(type_key, spec, w, d, h, finish)
        if gkey not in self.geoms:
            mesh = self._build(type_key, spec, w, d, h, finish)
            # Shared geometry: every placement below is a node referencing it.
            self.scene.geometry[gkey] = mesh
            self.geoms[gkey] = mesh
        x, y = item["x"], item["y"]
        rot = item.get("rot_deg")
        if rot is None and item.get("face"):
            rot = rot_toward(x, y, *item["face"])
        rot = float(rot or 0.0)
        z = self.z0 + float(item.get("z_ft", 0.0))
        T = trimesh.transformations.rotation_matrix(math.radians(rot), [0, 0, 1])
        T[:3, 3] = (x * FT, y * FT, z * FT)
        node = f"{item['id']}::{type_key}"
        self.scene.graph.update(frame_to=node, frame_from=self.scene.graph.base_frame, matrix=T, geometry=gkey)
        self.triangles += len(self.geoms[gkey].faces)
        if item.get("realizes_inventory_id"):
            self.mark(item["realizes_inventory_id"])
        rec = {
            "id": item["id"], "type": type_key, "category": spec.get("category"),
            "x": x, "y": y, "rot_deg": round(rot, 3), "w_ft": round(w, 4), "d_ft": round(d, 4), "h_ft": round(h, 4),
            "z_ft": float(item.get("z_ft", 0.0)),
            "realizes_inventory_id": item.get("realizes_inventory_id"),
            "zone": item.get("zone"), "blocks": spec.get("blocks", True),
            "tucks_under": spec.get("tucks_under", False), "is_surface": spec.get("is_surface", False),
            "seat": spec.get("seat", False), "clearance_in": spec.get("clearance_in", {}),
            "footprint": [[round(a, 4), round(b, 4)] for a, b in footprint_corners(x, y, w, d, rot)],
        }
        self.placed.append(rec)
        return rec

    def build_layout(self, layout):
        for item in layout["items"]:
            self.place(item)
        return self.placed

    def summary(self):
        types = sorted({p["type"] for p in self.placed})
        return {
            "furniture_items": len(self.placed),
            "furniture_types": len(types),
            "furniture_type_list": types,
            "furniture_unique_meshes": len(self.geoms),
            "furniture_triangles_instanced": self.triangles,
            "furniture_triangles_unique": int(sum(len(g.faces) for g in self.geoms.values())),
        }


def load_layout(path):
    data = json.loads(Path(path).read_text())
    return data
