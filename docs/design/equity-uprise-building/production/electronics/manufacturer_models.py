"""Source-backed computer exteriors, not serviceable internals or vendor CAD.

Public API: ``build_manufacturer_model(exact_model_id)``. All returned meshes
use feet, Z up, front -Y, a centered XY footprint, and a support datum at Z=0.
Dimensions and source limitations live in manufacturer-model-references-v1.json.
No floor placement, asset registration, networking, logos, or live state occurs
here. Consumers retain existing asset IDs and apply one rigid placement transform.
"""
from __future__ import annotations

from dataclasses import dataclass
import copy
import json
import math
from pathlib import Path

import numpy as np
import trimesh

METRES_TO_FEET = 1.0 / 0.3048
CATALOG_PATH = Path(__file__).with_name("manufacturer-model-references-v1.json")
BLACK = (22, 24, 27, 255)
DARK = (38, 41, 45, 255)
GRILLE = (62, 65, 69, 255)
VOID = (6, 8, 10, 255)
SILVER = (180, 184, 188, 255)
RED = (166, 30, 37, 255)
OFF_LED = (94, 100, 105, 255)


@dataclass
class ManufacturerModel:
    model_id: str
    components: dict[str, trimesh.Trimesh]
    envelope_ft: tuple[float, float, float]  # width, depth, height
    metadata: dict

    @property
    def bounds_ft(self):
        w, d, h = self.envelope_ft
        return np.array([[-w / 2, -d / 2, 0], [w / 2, d / 2, h]])


def load_catalog():
    """Return a fresh catalog; callers cannot mutate a cached source record."""
    data = json.loads(CATALOG_PATH.read_text())
    if data.get("schema_version") != "1.0.0":
        raise ValueError("Unsupported manufacturer-model catalog schema")
    return data


def _paint(mesh, color):
    mesh.visual.face_colors = color
    return mesh


def _box(size, center, color):
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation(center)
    return _paint(mesh, color)


def _rounded_outline(width, height, radius, segments=5):
    radius = min(radius, width / 2, height / 2)
    points = []
    for x, z, start in ((width / 2 - radius, height / 2 - radius, 0),
                        (-width / 2 + radius, height / 2 - radius, 90),
                        (-width / 2 + radius, -height / 2 + radius, 180),
                        (width / 2 - radius, -height / 2 + radius, 270)):
        for angle in np.linspace(start, start + 90, segments + 1):
            a = math.radians(angle)
            points.append((x + radius * math.cos(a), z + radius * math.sin(a)))
    unique = []
    for point in points:
        if not unique or not np.allclose(unique[-1], point, rtol=0, atol=1e-12):
            unique.append(point)
    if np.allclose(unique[0], unique[-1], rtol=0, atol=1e-12):
        unique.pop()
    return np.array(unique)


def _prism(width, height, depth, radius, center, color, plane="xz"):
    """Convex rounded extrusion without optional polygon/boolean dependencies."""
    outline = _rounded_outline(width, height, radius)
    n = len(outline)
    vertices = [[x, y, z] for y in (-depth / 2, depth / 2) for x, z in outline]
    faces = []
    for i in range(1, n - 1):
        faces.extend(((0, i, i + 1), (n, n + i + 1, n + i)))
    for i in range(n):
        j = (i + 1) % n
        faces.extend(((i, n + i, n + j), (i, n + j, j)))
    vertices = np.array(vertices)
    if plane == "xy":
        vertices = vertices[:, [0, 2, 1]]
        faces = np.array(faces)[:, ::-1]
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.fix_normals()
    mesh.apply_translation(center)
    return _paint(mesh, color)


def _ring(width, height, thickness, radius, y, z, color):
    """Flat closed-outline trim. No invented badge or mark geometry."""
    outer = _rounded_outline(width, height, radius)
    inner = _rounded_outline(width - 2 * thickness, height - 2 * thickness,
                             max(radius - thickness, .0001))
    vertices = [[x, y, v + z] for loop in (outer, inner) for x, v in loop]
    n = len(outer)
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.extend(((i, j, n + j), (i, n + j, n + i)))
    return _paint(trimesh.Trimesh(vertices=vertices, faces=faces, process=False), color)


def _recess_planar_sides(mesh, axis, extent, inset):
    """Recess broad socket faces while the curved perimeter keeps its envelope.

    This is a visual panel reveal, not a manufacturing void or service opening.
    Unsharing faces keeps the curved perimeter from changing its measured extent.
    """
    vertices = mesh.vertices[mesh.faces].copy()
    colors = list(mesh.visual.face_colors.copy())
    returns = []
    for sign in (-1, 1):
        selected = np.all(np.isclose(vertices[:, :, axis], sign * extent / 2), axis=1)
        edges = {}
        for face_index in np.flatnonzero(selected):
            face = vertices[face_index]
            for i in range(3):
                a, b = face[i].copy(), face[(i + 1) % 3].copy()
                key = tuple(sorted((tuple(a), tuple(b))))
                edges.setdefault(key, []).append((a, b, face_index))
        for values in edges.values():
            if len(values) != 1:
                continue
            a, b, face_index = values[0]
            c, e = b.copy(), a.copy()
            c[axis] -= sign * inset
            e[axis] -= sign * inset
            returns.extend(([a, b, c], [a, c, e]))
            colors.extend([mesh.visual.face_colors[face_index]] * 2)
        vertices[selected, :, axis] -= sign * inset
    if returns:
        vertices = np.concatenate([vertices, np.array(returns)])
    result = trimesh.Trimesh(vertices=vertices.reshape((-1, 3)),
        faces=np.arange(len(vertices) * 3).reshape((-1, 3)), process=False)
    result.visual.face_colors = colors
    return result


class _Builder:
    """Author in metres and batch tiny visual details into named components."""
    def __init__(self, entry):
        self.entry = entry
        dim = entry["dimensions_m"]
        self.w, self.d, self.h = dim["width"], dim["depth"], dim["height"]
        self.parts = {}
        self.features = {}

    def add(self, name, mesh):
        self.parts.setdefault(name, []).append(mesh)

    def box(self, name, size, center, color=DARK):
        self.add(name, _box(size, center, color))

    def panel(self, name, x, z, w, h, color=DARK, rear=False, depth=.0012, radius=.001):
        if name in {"FRONT_IO", "HANDLE_RECESS", "BAY_COVER"}:
            depth = min(depth, .00007)
        # Smaller depth is nearer the exterior, so sockets do not z-fight panels.
        y = self.d / 2 - depth * 1.5 if rear else -self.d / 2 + depth * 1.5
        self.add(name, _prism(w, h, depth, radius, (x, y, z), color))

    def port(self, name, x, z, w=.012, h=.006, rear=False, kind="usb_a"):
        # Thin dark inserts indicate a schematic socket, not a cuttable CAD hole.
        self.panel(name, x, z, w, h, VOID, rear, .00002,
                   min(w, h) / 2 if kind in {"usb_c", "audio", "power"} else .0007)
        self.features.setdefault(name, []).append({"kind": kind,
            "face": "rear" if rear else "front", "position_m": [x,
            self.d / 2 if rear else -self.d / 2, z], "schematic_position": True})

    def tower(self, radius=.008, feet=.006, color=DARK):
        w, d, h = self.w, self.d, self.h
        # Feet are inside the stated total height, never an added manufacturer dimension.
        body = _prism(w, h - feet, d - .006, radius,
                      (0, .001, (h + feet) / 2), color)
        self.add("CHASSIS", _recess_planar_sides(body, 0, w, .0015))
        self.add("CHASSIS", _ring(w, h - feet, .005, radius,
                                  -d / 2, (h + feet) / 2, color))
        rear_trim = _ring(w, h - feet, .005, radius, d / 2, (h + feet) / 2, color)
        rear_trim.invert()
        self.add("CHASSIS", rear_trim)
        self.panel("CHASSIS", 0, (h + feet) / 2, w - .009, h - feet - .009,
                   color, rear=True, depth=.002, radius=radius)
        if feet:
            for x in (-w * .36, w * .36):
                for y in (-d * .36, d * .36):
                    self.box("CHASSIS", (w * .11, d * .10, feet),
                             (x, y, feet / 2), BLACK)

    def slats(self, name, x0, x1, z0, z1, pitch=.012, slope=.7,
              color=GRILLE, rear=False, thickness=.0025):
        """Clipped diagonal strips: economical, schematic grille spacing."""
        y = self.d / 2 - .00015 if rear else -self.d / 2 + .00015
        for offset in np.arange(z0 - slope * (x1 - x0), z1, pitch):
            lo = max(x0, x0 + (z0 - offset) / slope) if slope > 0 else x0
            hi = min(x1, x0 + (z1 - offset) / slope) if slope > 0 else x1
            if hi - lo < .002:
                continue
            za, zb = offset + slope * (lo - x0), offset + slope * (hi - x0)
            half = thickness / 2
            verts = [[lo, y, max(z0, za - half)], [hi, y, max(z0, zb - half)],
                     [hi, y, min(z1, zb + half)], [lo, y, min(z1, za + half)]]
            self.add(name, _paint(trimesh.Trimesh(vertices=verts,
                faces=[[0, 1, 2], [0, 2, 3]], process=False), color))

    def holes(self, name, x0, x1, z0, z1, pitch=.010, rear=False):
        y = self.d / 2 - .0001 if rear else -self.d / 2 + .0001
        row = 0
        for z in np.arange(z0 + pitch / 2, z1 - pitch / 2, pitch * .87):
            for x in np.arange(x0 + pitch / 2 + (row % 2) * pitch / 2,
                               x1 - pitch / 2, pitch):
                a = np.arange(6) * math.pi / 3
                verts = np.column_stack([x + pitch * .41 * np.cos(a),
                                         np.full(6, y), z + pitch * .41 * np.sin(a)])
                mesh = _paint(trimesh.Trimesh(vertices=verts,
                    faces=[[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]],
                    process=False), VOID)
                if rear:
                    mesh.invert()
                self.add(name, mesh)
            row += 1

    def rear_panel(self, color=SILVER):
        self.panel("REAR_PANEL", 0, self.h * .5, self.w * .89,
                   self.h * .88, color, rear=True, depth=.0016)

    def psu(self, x, z, width=.065, height=.052):
        self.panel("POWER_SUPPLY", x, z, width, height, GRILLE, rear=True, depth=.0009)
        self.port("POWER_SUPPLY", x, z, .026, .018, rear=True, kind="ac_inlet")

    def finish(self):
        components = {}
        for name, meshes in self.parts.items():
            mesh = trimesh.util.concatenate(meshes)
            mesh.apply_scale(METRES_TO_FEET)
            mesh.metadata = {"component_id": name, "model_id": self.entry["model_id"],
                "exterior_only": True, "schematic_visual_details": True,
                "features": copy.deepcopy(self.features.get(name, []))}
            components[name] = mesh
        meta = copy.deepcopy(self.entry)
        meta.update({"units": "feet", "axis_order": ["width", "depth", "height"],
            "up_axis": "+Z", "front_axis": "-Y", "bottom_z_ft": 0,
            "exterior_only": True, "vendor_approved": False, "live_host": False,
            "sponsor_status": "unconfirmed_prospect", "serviceable_internals": False,
            "component_features": copy.deepcopy(self.features)})
        return ManufacturerModel(self.entry["model_id"], components,
            tuple(v * METRES_TO_FEET for v in (self.w, self.d, self.h)), meta)


def _dell(b):
    w, d, h = b.w, b.d, b.h
    b.tower(.010, .005)
    b.panel("FRONT_GRILLE", 0, h * .5, w * .95, h * .95, VOID)
    b.slats("FRONT_GRILLE", -w * .47, w * .075, h * .035, h * .96,
            pitch=.011, slope=.62, thickness=.003)
    b.slats("FRONT_GRILLE", w * .215, w * .47, h * .035, h * .96,
            pitch=.011, slope=.62, thickness=.003)
    b.panel("FRONT_IO", w * .145, h * .5, w * .105, h * .97, GRILLE, depth=.0008)
    b.panel("HANDLE_RECESS", -w * .18, h * .91, w * .47, h * .075, BLACK,
            depth=.0006, radius=.008)
    b.port("FRONT_IO", w * .145, h * .88, .012, .012, kind="power")
    b.port("STATUS_INDICATOR", w * .145, h * .835, .002, .002, kind="unlit_led")
    b.port("FRONT_IO", w * .145, h * .795, .005, .005, kind="audio")
    for z in (.745, .690):
        b.port("FRONT_IO", w * .145, h * z, .0055, .013)
    for z in (.635, .585):
        b.port("FRONT_IO", w * .145, h * z, .003, .009, kind="usb_c")
    b.rear_panel()
    b.psu(.015, h * .89, .12, .065)
    b.panel("REAR_VENT", -w * .21, h * .57, w * .43, h * .47, BLACK, rear=True)
    b.holes("REAR_VENT", -w * .42, 0, h * .34, h * .79, .014, rear=True)
    for z in (.62, .58):
        b.port("NIC_PORT", w * .12, h * z, .014, .012, True, "ethernet")
    for x in (.10, .16):
        for z in (.51, .47):
            b.port("REAR_IO", w * x, h * z, .0055, .013, True)
    for z in (.41, .37, .33):
        b.port("REAR_IO", w * .13, h * z, .0035, .009, True, "usb_c")
    for z in np.linspace(h * .065, h * .265, 6):
        b.panel("EXPANSION_COVERS", -w * .09, z, w * .58, .009, GRILLE, True)


def _apple(b):
    w, d, h = b.w, b.d, b.h
    base_h = .008
    body = _prism(w, d, h - base_h, .023,
                  (0, 0, (h + base_h) / 2), SILVER, "xy")
    b.add("CHASSIS", _recess_planar_sides(body, 1, d, .0025))
    b.add("CHASSIS", _prism(w * .88, d * .88, base_h, .022,
                               (0, 0, base_h / 2), GRILLE, "xy"))
    for x in (-.062, -.044):
        b.port("FRONT_IO", x, .033, .009, .0035, kind="thunderbolt_5_usb_c")
    b.port("FRONT_IO", .005, .033, .026, .002, kind="sdxc")
    b.port("STATUS_INDICATOR", .064, .033, .0018, .0018, kind="unlit_led")
    b.panel("REAR_VENT", 0, .075, .167, .027, GRILLE, True)
    b.holes("REAR_VENT", -.083, .083, .062, .088, .005, True)
    for x in (-.069, -.060, -.051, -.042):
        b.port("REAR_IO", x, .033, .0035, .009, True, "thunderbolt_5_usb_c")
    b.port("NIC_PORT", -.027, .033, .013, .011, True, "ethernet_10gb")
    b.port("POWER_SUPPLY", -.002, .033, .021, .016, True, "ac_inlet")
    for x in (.019, .031):
        b.port("REAR_IO", x, .033, .005, .014, True)
    b.port("DISPLAY_OUTPUTS", .049, .033, .014, .005, True, "hdmi")
    b.port("REAR_IO", .067, .033, .004, .004, True, "audio")
    b.port("REAR_IO", .081, .033, .009, .009, True, "power")


def _framework(b):
    w, d, h = b.w, b.d, b.h
    b.tower(.005, .004, BLACK)
    plinth = _prism(w, d, .008, .002, (0, 0, .008), SILVER, "xy")
    b.add("CHASSIS", _recess_planar_sides(plinth, 1, d, .0015))
    # Blank interchangeable tiles, not patterned/brand tiles or copied artwork.
    for row in range(7):
        for col in range(3):
            b.panel("FRONT_TILES", (col - 1) * w * .30,
                    .0366 + row * w * .30, w * .28, w * .28,
                    (48, 50, 53, 255), radius=.0015)
    for x in (-w * .24, w * .24):
        b.panel("EXPANSION_CARD_SLOTS", x, .008, w * .42, .006, GRILLE, depth=.0009)
        b.panel("EXPANSION_CARD_SLOTS", x, .008, w * .39, .0048, SILVER, depth=.0007)
    b.port("FRONT_IO", w * .34, .018, .013, .005, kind="power_button")
    b.rear_panel(BLACK)
    # Rear placement uses the maker's Max 300 family reference, not 495 CAD.
    for columns, rows, bottom in (((-.31, -.16), 11, .27), ((.08, .23), 5, .66)):
        for column in columns:
            for row in range(rows):
                x, z = w * column, h * (bottom + row * .058)
                b.box("REAR_VENT", (w * .125, .0008, h * .05),
                      (x, d / 2 - .0008, z), GRILLE)
                b.holes("REAR_VENT", x - w * .062, x + w * .062,
                        z - h * .025, z + h * .025, .0035, True)
    b.panel("POWER_SUPPLY", 0, h * .12, w * .80, h * .15, GRILLE, True, .0009)
    b.port("POWER_SUPPLY", -w * .28, h * .12, .016, .025, True, "ac_inlet")
    b.holes("POWER_SUPPLY", -w * .10, w * .37, h * .05, h * .19, .006, True)
    b.port("DISPLAY_OUTPUTS", w * .36, h * .86, .005, .014, True, "hdmi")
    for z in (.75, .65):
        b.port("REAR_IO", w * .36, h * z, .0035, .009, True, "usb4_c")
    for x in (.35, .20):
        b.port("DISPLAY_OUTPUTS", w * x, h * .53, .005, .014, True, "displayport")
    for x in (.35, .27):
        b.port("REAR_IO", w * x, h * .40, .0055, .013, True)
    b.port("NIC_PORT", w * .14, h * .40, .012, .014, True, "ethernet_5gb")
    b.port("REAR_IO", w * .35, h * .29, .004, .004, True, "audio")


def _lenovo(b):
    w, d, h = b.w, b.d, b.h
    b.tower(.011, .007, BLACK)
    for y in (-d / 2 + .00005, d / 2 - .00005):
        b.add("PERIMETER_TRIM", _ring(w * .96, h * .965, .0028, .010,
                                      y, h * .505, RED))
    b.panel("FRONT_GRILLE", -w * .17, h * .50, w * .58, h * .88, GRILLE)
    b.holes("FRONT_GRILLE", -w * .45, w * .10, h * .065, h * .94, .013)
    b.panel("FRONT_IO", w * .16, h * .50, w * .105, h * .88, GRILLE, depth=.0008)
    b.port("FRONT_IO", w * .16, h * .875, .008, .008, kind="power")
    for z in (.815, .76):
        b.port("FRONT_IO", w * .16, h * z, .0055, .013)
    for z in (.705, .66):
        b.port("FRONT_IO", w * .16, h * z, .003, .009, kind="usb_c_data_only")
    b.port("FRONT_IO", w * .16, h * .62, .004, .004, kind="audio")
    for z in (.22, .48, .74):
        b.panel("STORAGE_BAY_COVERS", w * .33, h * z, w * .18, h * .24, DARK)
        b.panel("STORAGE_BAY_COVERS", w * .29, h * z, .002, h * .18, RED, depth=.0007)
    b.rear_panel(BLACK)
    b.psu(w * .30, h * .29, w * .20, h * .23)
    b.panel("REAR_VENT", w * .30, h * .73, w * .21, h * .21, GRILLE, True)
    b.holes("REAR_VENT", w * .19, w * .41, h * .63, h * .83, .009, True)
    for z in (.08, .12, .16, .84, .88, .92):
        b.panel("EXPANSION_COVERS", -w * .10, h * z, w * .51, .009, GRILLE, True)
    for x in (-w * .12, -w * .035):
        for z in (.39, .43, .47):
            b.port("REAR_IO", x, h * z, .0055, .013, True)
    b.port("REAR_IO", -w * .23, h * .40, .0035, .009, True, "usb_c")
    for z in (.37, .32):
        b.port("NIC_PORT", -w * .03, h * z, .014, .012, True, "ethernet")
    for x in (-w * .12, -w * .03):
        b.port("REAR_IO", x, h * .56, .004, .004, True, "audio")


def _hp(b):
    w, d, h = b.w, b.d, b.h
    b.tower(.014, .005, DARK)
    b.panel("FRONT_GRILLE", 0, h * .49, w * .90, h * .88, VOID)
    b.slats("FRONT_GRILLE", -w * .44, w * .44, h * .05, h * .91,
            pitch=.016, slope=.75, thickness=.0025)
    # Reflect a second set of diagonal strips to form the recognizable lattice.
    before = len(b.parts["FRONT_GRILLE"])
    b.slats("FRONT_GRILLE", -w * .44, w * .44, h * .05, h * .91,
            pitch=.016, slope=.75, thickness=.0025)
    for mesh in b.parts["FRONT_GRILLE"][before:]:
        mesh.vertices[:, 0] *= -1
        mesh.invert()
    b.panel("HANDLE_RECESS", 0, h * .953, w * .57, .019, VOID, depth=.0008, radius=.005)
    b.panel("FRONT_IO", 0, h * .615, w * .73, .025, GRILLE, depth=.0007)
    b.port("FRONT_IO", -w * .29, h * .615, .008, .008, kind="power")
    b.port("STATUS_INDICATOR", -w * .23, h * .615, .002, .002, kind="unlit_led")
    b.port("FRONT_IO", -w * .17, h * .615, .004, .004, kind="audio")
    for x in (-.07, .04):
        b.port("FRONT_IO", w * x, h * .615, .013, .0055)
    for x in (.15, .25):
        b.port("FRONT_IO", w * x, h * .615, .009, .0035, kind="usb_c")
    b.panel("BAY_COVER", 0, h * .54, w * .72, h * .11, DARK, depth=.0007)
    # Tall side intake is an original schematic mesh, no copied image texture.
    b.box("SIDE_VENT", (.0008, d * .26, h * .70),
          (w / 2 - .0004, d * .03, h * .52), VOID)
    for y in np.linspace(-d * .085, d * .145, 15):
        b.box("SIDE_VENT", (.0005, .0015, h * .67),
              (w / 2 - .00025, y, h * .52), GRILLE)
    b.rear_panel(BLACK)
    # Rear remains a ventilated enclosure and an AC inlet, not an invented GPU layout.
    b.psu(0, h * .13, w * .68, h * .15)
    b.panel("REAR_VENT", 0, h * .70, w * .75, h * .37, GRILLE, True)
    b.holes("REAR_VENT", -w * .36, w * .36, h * .52, h * .87, .012, True)


def _thelio(b):
    w, d, h = b.w, b.d, b.h
    b.tower(.017, .012, DARK)
    b.panel("FRONT_PANEL", 0, h * .51, w * .96, h * .95, BLACK,
            depth=.001, radius=.017)
    b.panel("FRONT_IO", w * .27, h * .79, w * .095, h * .225,
            SILVER, depth=.0008, radius=.009)
    b.port("FRONT_IO", w * .27, h * .875, .013, .013, kind="power")
    for z in (.815, .775):
        b.port("FRONT_IO", w * .27, h * z, .005, .012)
    b.port("FRONT_IO", w * .27, h * .735, .004, .004, kind="audio")
    b.port("FRONT_IO", w * .27, h * .705, .0035, .009, kind="usb_c")
    # Left narrow chevron slit bank; right broad upper mesh are not interchangeable.
    for z in np.linspace(h * .18, h * .72, 22):
        for y in (d * .12, d * .20, d * .28):
            for sign in (-1, 1):
                mesh = _box((.0008, .020, .003), (-w / 2 + .0004, 0, 0), VOID)
                matrix = trimesh.transformations.rotation_matrix(sign * .55, [1, 0, 0])
                mesh.apply_transform(matrix)
                mesh.apply_translation([0, y + sign * .008, z])
                b.add("SIDE_VENTS", mesh)
    b.box("SIDE_VENTS", (.0008, d * .76, h * .36),
          (w / 2 - .0004, 0, h * .70), GRILLE)
    for z in np.linspace(h * .53, h * .87, 17):
        b.box("SIDE_VENTS", (.0005, d * .73, .003),
              (w / 2 - .00025, 0, z), VOID)
    b.rear_panel(BLACK)
    b.psu(0, h * .14, w * .56, h * .17)
    b.panel("REAR_VENT", 0, h * .67, w * .70, h * .46, GRILLE, True)
    b.holes("REAR_VENT", -w * .34, w * .34, h * .45, h * .89, .015, True)


def _asus_station(b):
    w, d, h = b.w, b.d, b.h
    # The published diagram measures the box; unsized feet/handles are omitted.
    b.tower(.004, 0, SILVER)
    b.panel("FRONT_GRILLE", 0, h * .49, w * .94, h * .83, GRILLE)
    b.slats("FRONT_GRILLE", -w * .46, w * .46, h * .075, h * .91,
            pitch=.006, slope=1.0, color=SILVER, thickness=.0018)
    for z in (.04, .955):
        b.panel("HANDLE_RECESS", 0, h * z, w * .94, h * .065,
                BLACK, depth=.00007, radius=.012)
    x = w * .32
    b.panel("FRONT_IO", x, h * .77, .017, .018, DARK, radius=.003)
    b.port("FRONT_IO", x, h * .77, .007, .007, kind="power")
    for z in (.73, .71):
        b.port("STATUS_INDICATOR", x, h * z, .002, .002, kind="unlit_led")
    for z in (.66, .63):
        b.port("FRONT_IO", x, h * z, .004, .004, kind="audio")
    for z in (.595, .565):
        b.port("FRONT_IO", x, h * z, .009, .0035, kind="usb_c")
    for z in (.535, .505, .465):
        b.port("FRONT_IO", x, h * z, .013, .0055)
    b.rear_panel(SILVER)
    b.psu(0, h * .09, w * .65, h * .12)
    # Circular fan grille is the distinctive right-hand region in the rear photo.
    cx, cz, radius = -w * .16, h * .65, w * .255
    b.panel("REAR_VENT", cx, cz, radius * 2, radius * 2,
            SILVER, True, .0009, radius)
    for x in np.linspace(cx - radius * .92, cx + radius * .92, 19):
        half_h = math.sqrt(max(0, radius ** 2 - (x - cx) ** 2)) * .92
        b.panel("REAR_VENT", x, cz, .0028, half_h * 2,
                VOID, True, .0005, radius=.001)
    b.panel("REAR_IO", w * .27, h * .64, w * .22, h * .40,
            BLACK, True, .0009)
    for z in (.79, .735):
        b.port("NIC_PORT", w * .30, h * z, .010, .020, True, "qsfp_400gb")
    for x in (.31, .24):
        for z in (.655, .595):
            b.port("REAR_IO", w * x, h * z, .0055, .013, True)
    for z, kind in ((.655, "management_ethernet"), (.595, "ethernet_10gb")):
        b.port("NIC_PORT", w * .15, h * z, .010, .012, True, kind)
    for x in (.17, .24, .31):
        b.port("REAR_IO", w * x, h * .525, .004, .004, True, "audio")
    b.port("REAR_IO", w * .31, h * .49, .003, .007, True, "micro_usb")
    b.port("DISPLAY_OUTPUTS", w * .31, h * .455, .004, .007, True, "mini_displayport")
    for z in np.linspace(h * .18, h * .40, 5):
        b.panel("EXPANSION_COVERS", w * .05, z, w * .62, .012, GRILLE, True)


def _asus_laptop(b):
    w, d, h = b.w, b.d, b.h
    # Published closed maximum is the complete envelope. No imaginary open height.
    base = _prism(w, d, h * .72, .006, (0, 0, h * .36), BLACK, "xy")
    # The range is published; its exact spatial taper is a schematic visual detail.
    base.vertices[:, 2] -= .0034 * (.5 - base.vertices[:, 1] / d) * (base.vertices[:, 2] / (h * .72))
    base = _recess_planar_sides(base, 0, w, .001)
    b.add("CHASSIS", _recess_planar_sides(base, 1, d, .001))
    lid = _prism(w, d, h * .25, .006, (0, 0, h * .875), DARK, "xy")
    lid.vertices[:, 2] -= .0034 * (.5 - lid.vertices[:, 1] / d)
    b.add("LID", lid)
    # Side sockets live on the closed base, not the front/display surface.
    ports = [(-1, .092, "ac_input", .012, .005),
             (-1, .073, "hdmi", .014, .0045),
             (-1, .054, "usb4_c", .009, .0035),
             (-1, .035, "usb_a", .013, .005),
             (-1, .018, "audio", .004, .004),
             (1, .080, "usb_c", .009, .0035),
             (1, .058, "usb_a", .013, .005),
             (1, .030, "sd_card", .025, .002)]
    for side, y, kind, width, height in ports:
        name = "DISPLAY_OUTPUTS" if kind == "hdmi" else "POWER_INPUT" if kind == "ac_input" else "SIDE_IO"
        b.box(name, (.0005, width, height),
              (side * (w / 2 - .00025), y, h * .37), VOID)
        b.features.setdefault(name, []).append({"kind": kind,
            "face": "left" if side < 0 else "right", "position_m": [side * w / 2, y, h * .37],
            "schematic_position": True})
    b.panel("HINGE_VENT", 0, h * .44, w * .66, h * .27, VOID, True, .0005)


_BUILDERS = {
    "dell-pro-precision-9-t6-pw9t6260": _dell,
    "apple-mac-studio-m5-ultra": _apple,
    "framework-desktop-ryzen-ai-max-plus-pro-495-192gb": _framework,
    "lenovo-thinkstation-px": _lenovo,
    "hp-z8-fury-g6i-standard-panel": _hp,
    "system76-thelio-major-r5-n4": _thelio,
    "asus-expertcenter-pro-et900n-g3": _asus_station,
    "asus-proart-p16-h7606wx-rtx5090-closed": _asus_laptop,
}


def build_manufacturer_model(model_id: str) -> ManufacturerModel:
    """Build one exact catalog profile; unknown IDs never become generic boxes."""
    entries = {m["model_id"]: m for m in load_catalog()["models"]}
    if not isinstance(model_id, str) or model_id not in entries or model_id not in _BUILDERS:
        raise ValueError(f"Unknown manufacturer model ID: {model_id!r}")
    builder = _Builder(entries[model_id])
    _BUILDERS[model_id](builder)
    return builder.finish()
