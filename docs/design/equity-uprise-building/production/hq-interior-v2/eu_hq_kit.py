"""Equity Uprise HQ Interior v2 — instanced furniture/equipment kit for Blender 4.2+.

Every master lives once in the KIT collection (excluded from the view layer) and is
placed with collection-instance empties. Per-floor finishes come from custom
properties on the instancing empty (eu_wood, eu_fabric, eu_stone, eu_accent,
eu_metallic), read in the shaders with the Attribute node (type INSTANCER), so one
mesh serves every floor's palette.

Units: kit geometry is authored in feet and converted to metres once (FT).
Local frame: origin at the floor centre of the footprint, Z up, the object's
"front" faces local -Y (south at rotation 0).

Original procedural geometry. No logo, mark or wordmark is modelled anywhere.
NOT FOR CONSTRUCTION.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector

FT = 0.3048


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)


# ---------------------------------------------------------------- materials
def _p(m):
    return m.node_tree.nodes["Principled BSDF"]


def mat(name, color="#808080", rough=0.5, metal=0.0, **kw):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = _p(m)
    p.inputs["Base Color"].default_value = srgb(color)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if kw.get("transmission"):
        p.inputs["Transmission Weight"].default_value = kw["transmission"]
        p.inputs["IOR"].default_value = 1.45
    if kw.get("emit"):
        p.inputs["Emission Color"].default_value = srgb(kw["emit"])
        p.inputs["Emission Strength"].default_value = kw.get("emit_strength", 4.0)
    if kw.get("alpha") is not None:
        p.inputs["Alpha"].default_value = kw["alpha"]
        m.blend_method = "BLEND"
    if kw.get("coat"):
        p.inputs["Coat Weight"].default_value = kw["coat"]
    if kw.get("sheen"):
        p.inputs["Sheen Weight"].default_value = kw["sheen"]
    m.diffuse_color = srgb(color)
    return m


def _noise(nt, scale, detail=4.0, distortion=0.0, stretch=(1, 1, 1)):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = stretch
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    nz.inputs["Distortion"].default_value = distortion
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    return nz


def tint_mat(name, attr, rough, metal=0.0, grain=None, veins=False, sheen=0.0, coat=0.0, metal_attr=None):
    """Material whose base colour is read from the instancing empty's custom property."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = _p(m)
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_type = "INSTANCER"
    a.attribute_name = attr
    col = a.outputs["Color"]
    if grain or veins:
        nz = _noise(nt, grain or 6.0, 6.0, 2.5 if veins else 0.0, (1, 1, 14) if grain else (1, 1, 1))
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.35 if not veins else 0.48
        ramp.color_ramp.elements[0].color = (0.78, 0.78, 0.78, 1) if not veins else (1, 1, 1, 1)
        ramp.color_ramp.elements[1].position = 0.75 if not veins else 0.52
        ramp.color_ramp.elements[1].color = (1.12, 1.12, 1.12, 1) if not veins else (1.9, 1.9, 1.9, 1)
        nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(col, mix.inputs[6])
        nt.links.new(ramp.outputs["Color"], mix.inputs[7])
        col = mix.outputs[2]
    nt.links.new(col, p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if metal_attr:
        b = nt.nodes.new("ShaderNodeAttribute")
        b.attribute_type = "INSTANCER"
        b.attribute_name = metal_attr
        nt.links.new(b.outputs["Fac"], p.inputs["Metallic"])
    if sheen:
        p.inputs["Sheen Weight"].default_value = sheen
    if coat:
        p.inputs["Coat Weight"].default_value = coat
    m.diffuse_color = (0.5, 0.5, 0.5, 1)
    return m


def face_ramp_mat(name, stops, rough=0.6, attr="eu_var"):
    """Colour chosen per face from a stored face attribute (books, coats, leaves)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = _p(m)
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_type = "GEOMETRY"
    a.attribute_name = attr
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.color_ramp.interpolation = "CONSTANT"
    els = r.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for i, (pos, hx) in enumerate(stops):
        els[i].position = pos
        els[i].color = srgb(hx)
    nt.links.new(a.outputs["Fac"], r.inputs["Fac"])
    nt.links.new(r.outputs["Color"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = rough
    return m


def kit_materials():
    M = {}
    M["wood"] = tint_mat("KIT_Wood_byFloor", "eu_wood", 0.42, grain=5.0, coat=0.15)
    M["fabric"] = tint_mat("KIT_Fabric_byFloor", "eu_fabric", 0.92, sheen=0.6)
    M["stone"] = tint_mat("KIT_Stone_byFloor", "eu_stone", 0.22, veins=True, coat=0.3)
    M["accent"] = tint_mat("KIT_Accent_byFloor", "eu_accent", 0.35, metal_attr="eu_metallic")
    M["rug"] = tint_mat("KIT_Rug_byFloor", "eu_rug", 0.97, grain=40.0)
    M["steel"] = mat("KIT_BlackenedSteel", "#232427", 0.38, 0.85)
    M["brass"] = mat("KIT_Brass", "#B08A4E", 0.28, 1.0)
    M["galv"] = mat("KIT_GalvanizedSteel", "#9AA0A3", 0.45, 1.0)
    M["glass"] = mat("KIT_Glass", "#DDE6E8", 0.03, transmission=1.0)
    M["smoked"] = mat("KIT_SmokedGlass", "#4A4E50", 0.05, transmission=0.85)
    M["screen"] = mat("KIT_ScreenOn", "#0D141B", 0.15, emit="#3B5568", emit_strength=1.1)
    M["screen_off"] = mat("KIT_ScreenOff", "#0B0C0E", 0.12)
    M["emit"] = mat("KIT_LampShadeLit", "#F4E2C0", 0.6, emit="#FFD9A0", emit_strength=6.0)
    M["led"] = mat("KIT_LEDStrip", "#FFE7C0", 0.5, emit="#FFC983", emit_strength=18.0)
    M["pot"] = mat("KIT_CeramicPot", "#D9D2C4", 0.55)
    M["soil"] = mat("KIT_Soil", "#2B2520", 0.95)
    M["paper"] = mat("KIT_Paper", "#EDE8DC", 0.85)
    M["rubber"] = mat("KIT_Rubber", "#1A1A1A", 0.8)
    M["leaf"] = face_ramp_mat("KIT_Foliage", [(0.0, "#3E5A2E"), (0.35, "#557A3A"), (0.7, "#6B8F48")], 0.55)
    M["books"] = face_ramp_mat("KIT_BookSpines", [(0.0, "#7A2E2A"), (0.2, "#2F4A5C"), (0.4, "#C9B48A"),
                                                   (0.6, "#3D5A3A"), (0.8, "#E7E0D0")], 0.7)
    M["coats"] = face_ramp_mat("KIT_Coats", [(0.0, "#4B5634"), (0.25, "#A88B68"), (0.5, "#2E2F31"),
                                             (0.75, "#C7B9A0")], 0.9)
    M["felt_panel"] = tint_mat("KIT_FeltPanel_byFloor", "eu_fabric", 0.95)
    M["chrome"] = mat("KIT_BrushedSteel", "#B9BCBE", 0.3, 1.0)
    M["map"] = mat("KIT_PinBoard", "#E4DCC8", 0.9)
    M["green_mat"] = mat("KIT_AntistaticMat", "#2F6B5A", 0.7)
    return M


# ---------------------------------------------------------------- mesh building
class Builder:
    """Accumulates boxes/cylinders (feet) into one bmesh with material indices."""

    def __init__(self, mats):
        self.bm = bmesh.new()
        self.mats = []
        self.M = mats
        self.var = self.bm.faces.layers.float.new("eu_var")

    def _mi(self, key):
        m = self.M[key] if isinstance(key, str) else key
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _tag(self, geom, key, var=0.0):
        mi = self._mi(key)
        for f in [g for g in geom if isinstance(g, bmesh.types.BMFace)]:
            f.material_index = mi
            f[self.var] = var

    def box(self, x0, y0, z0, x1, y1, z1, key, var=0.0, rot=0.0):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        vs = r["verts"]
        sx, sy, sz = (x1 - x0), (y1 - y0), (z1 - z0)
        bmesh.ops.scale(self.bm, vec=(sx * FT, sy * FT, sz * FT), verts=vs)
        if rot:
            bmesh.ops.rotate(self.bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(rot), 3, "Z"), verts=vs)
        bmesh.ops.translate(self.bm, vec=((x0 + x1) / 2 * FT, (y0 + y1) / 2 * FT, (z0 + z1) / 2 * FT), verts=vs)
        self._tag(list({f for v in vs for f in v.link_faces}), key, var)

    def cyl(self, x, y, z0, z1, r, key, seg=24, r2=None, var=0.0):
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg,
                                    radius1=r * FT, radius2=(r if r2 is None else r2) * FT, depth=(z1 - z0) * FT)
        vs = res["verts"]
        bmesh.ops.translate(self.bm, vec=(x * FT, y * FT, (z0 + z1) / 2 * FT), verts=vs)
        self._tag(list({f for v in vs for f in v.link_faces}), key, var)

    def ellipse_slab(self, x, y, z0, z1, a, b, key, seg=48):
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg,
                                    radius1=1.0, radius2=1.0, depth=(z1 - z0) * FT)
        vs = res["verts"]
        bmesh.ops.scale(self.bm, vec=(a * FT, b * FT, 1.0), verts=vs)
        bmesh.ops.translate(self.bm, vec=(x * FT, y * FT, (z0 + z1) / 2 * FT), verts=vs)
        self._tag(list({f for v in vs for f in v.link_faces}), key)

    def sphere(self, x, y, z, r, key, sub=2, var=0.0, squash=1.0):
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r * FT)
        vs = res["verts"]
        bmesh.ops.scale(self.bm, vec=(1, 1, squash), verts=vs)
        bmesh.ops.translate(self.bm, vec=(x * FT, y * FT, z * FT), verts=vs)
        self._tag(list({f for v in vs for f in v.link_faces}), key, var)

    def to_object(self, name, coll, bevel=0.012):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        for poly in me.polygons:
            poly.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        if bevel:
            md = ob.modifiers.new("soft_edges", "BEVEL")
            md.width = bevel
            md.segments = 2
            md.limit_method = "ANGLE"
            md.harden_normals = False
        return ob


# ---------------------------------------------------------------- kit recipes (feet)
def chair_task(b):
    b.box(-0.9, -0.85, 1.45, 0.9, 0.85, 1.75, "fabric")
    b.box(-0.85, 0.62, 1.8, 0.85, 0.82, 3.35, "fabric")
    b.box(-0.08, 0.6, 1.5, 0.08, 0.75, 1.9, "steel")
    b.cyl(0, 0, 0.35, 1.45, 0.1, "steel", 12)
    for i in range(5):
        a = i * 2 * math.pi / 5
        b.box(-0.05, 0, 0.2, 0.05, 1.1, 0.32, "steel", rot=math.degrees(a))
        b.cyl(1.05 * math.sin(-a), 1.05 * math.cos(a), 0.0, 0.2, 0.1, "rubber", 8)
    b.box(-1.0, -0.4, 2.15, -0.88, 0.4, 2.25, "steel")
    b.box(0.88, -0.4, 2.15, 1.0, 0.4, 2.25, "steel")


def chair_side(b):
    b.box(-0.85, -0.8, 1.45, 0.85, 0.8, 1.72, "fabric")
    b.box(-0.8, 0.6, 1.72, 0.8, 0.8, 2.95, "fabric")
    for x in (-0.72, 0.72):
        for y in (-0.68, 0.68):
            b.box(x - 0.05, y - 0.05, 0, x + 0.05, y + 0.05, 1.46, "steel")


def chair_lounge(b):
    # rounded boucle armchair: seat block + curved back built along an arc
    b.cyl(0, 0, 0.0, 0.25, 1.15, "accent", 32)
    b.cyl(0, 0, 0.25, 1.35, 1.25, "fabric", 32)
    for i in range(14):
        a = math.radians(-120 + i * 240 / 13)
        x, y = 1.05 * math.sin(a), 1.05 * math.cos(a)
        b.box(x - 0.28, y - 0.18, 1.3, x + 0.28, y + 0.18, 2.55, "fabric", rot=-math.degrees(a))


def banquette(b, w=8.0, d=2.2):
    b.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.35, "wood")
    b.box(-w / 2 + 0.05, -d / 2 + 0.05, 0.35, w / 2 - 0.05, d / 2 - 0.05, 1.5, "fabric")
    n = int(w // 2.6) + 1
    cw = (w - 0.2) / n
    for i in range(n):
        x0 = -w / 2 + 0.1 + i * cw
        b.box(x0 + 0.04, d / 2 - 0.75, 1.5, x0 + cw - 0.04, d / 2 - 0.05, 3.0, "fabric")


def sofa(b, w=7.5, d=3.0, arms=True):
    b.box(-w / 2, -d / 2, 0.0, w / 2, d / 2, 0.3, "steel")
    b.box(-w / 2, -d / 2, 0.3, w / 2, d / 2, 1.35, "fabric")
    b.box(-w / 2, d / 2 - 0.8, 1.35, w / 2, d / 2, 2.6, "fabric")
    if arms:
        b.box(-w / 2, -d / 2, 1.35, -w / 2 + 0.6, d / 2, 2.0, "fabric")
        b.box(w / 2 - 0.6, -d / 2, 1.35, w / 2, d / 2, 2.0, "fabric")
    n = 3
    cw = (w - 1.2) / n
    for i in range(n):
        x0 = -w / 2 + 0.6 + i * cw
        b.box(x0 + 0.03, -d / 2 + 0.05, 1.35, x0 + cw - 0.03, d / 2 - 0.8, 1.7, "fabric")


def table_rect(b, w, d, h=2.5, top="wood", legs="steel", top_t=0.13):
    b.box(-w / 2, -d / 2, h - top_t, w / 2, d / 2, h, top)
    inset = 0.35
    for x in (-w / 2 + inset, w / 2 - inset):
        b.box(x - 0.08, -d / 2 + inset, 0, x + 0.08, d / 2 - inset, 0.12, legs)
        b.box(x - 0.08, -0.08, 0, x + 0.08, 0.08, h - top_t, legs)
    b.box(-w / 2 + inset, -0.06, h - top_t - 0.2, w / 2 - inset, 0.06, h - top_t, legs)


def table_round(b, r, h, top="wood", base="steel"):
    b.cyl(0, 0, h - 0.12, h, r, top, 40)
    b.cyl(0, 0, 0.12, h - 0.12, 0.12, base, 12)
    b.cyl(0, 0, 0, 0.12, min(r * 0.6, 0.9), base, 24)


def workpoint(b, w, d):
    table_rect(b, w, d, 2.5, "wood", "steel")
    b.box(w / 2 - 1.45, -d / 2 + 0.15, 0.1, w / 2 - 0.15, d / 2 - 0.15, 2.3, "wood")  # pedestal
    for z in (0.85, 1.6):
        b.box(w / 2 - 1.42, -d / 2 + 0.1, z, w / 2 - 0.18, -d / 2 + 0.14, z + 0.03, "steel")


def credenza(b, w=6.0, d=1.5, h=2.4, body="wood", top=None):
    b.box(-w / 2, -d / 2, 0.3, w / 2, d / 2, h, body)
    if top:
        b.box(-w / 2 - 0.02, -d / 2 - 0.02, h, w / 2 + 0.02, d / 2 + 0.02, h + 0.1, top)
    b.box(-w / 2 + 0.2, -d / 2 + 0.2, 0, -w / 2 + 0.35, d / 2 - 0.2, 0.3, "steel")
    b.box(w / 2 - 0.35, -d / 2 + 0.2, 0, w / 2 - 0.2, d / 2 - 0.2, 0.3, "steel")
    n = max(2, int(w // 2))
    for i in range(1, n):
        x = -w / 2 + i * w / n
        b.box(x - 0.01, -d / 2 - 0.01, 0.4, x + 0.01, -d / 2, h - 0.1, "steel")


def shelving(b, w=6.0, d=1.8, h=6.0, frame="steel", fill="books", shelves=5, boxes=False):
    for x in (-w / 2, w / 2 - 0.12):
        b.box(x, -d / 2, 0, x + 0.12, d / 2, h, frame)
    b.box(-w / 2, d / 2 - 0.06, 0, w / 2, d / 2, h, frame)
    import random
    rnd = random.Random(int(w * 100 + h * 10 + shelves))
    for i in range(shelves + 1):
        z = 0.15 + i * (h - 0.3) / shelves
        b.box(-w / 2, -d / 2, z, w / 2, d / 2, z + 0.08, frame)
        if i == shelves:
            break
        x = -w / 2 + 0.2
        top = (h - 0.3) / shelves - 0.25
        while x < w / 2 - 0.5:
            if boxes:
                bw = 1.05
                b.box(x, -d / 2 + 0.15, z + 0.08, x + bw - 0.08, d / 2 - 0.12, z + 0.08 + min(top, 0.95),
                      "paper" if rnd.random() < 0.6 else "wood")
                x += bw
            else:
                bw = rnd.uniform(0.08, 0.16)
                bh = rnd.uniform(0.6, 0.95) * top
                if rnd.random() < 0.12:
                    x += 0.35
                    continue
                b.box(x, -d / 2 + 0.25, z + 0.08, x + bw, d / 2 - 0.15, z + 0.08 + bh, fill, var=rnd.random())
                x += bw + 0.01


def plant(b, pot_r=0.7, pot_h=1.4, h=6.0, crown=1.6, seed=1):
    import random
    rnd = random.Random(seed)
    b.cyl(0, 0, 0, pot_h, pot_r, "pot", 28, r2=pot_r * 0.82 if pot_h < 1.2 else pot_r)
    b.cyl(0, 0, pot_h - 0.05, pot_h + 0.02, pot_r * 0.93, "soil", 24)
    if h > 3.5:
        b.cyl(0, 0, pot_h, h - crown * 0.6, 0.07, "wood", 8)
        for i in range(3):                                   # a few branches
            a = rnd.uniform(0, 2 * math.pi)
            b.box(-0.03, -0.03, h - crown * 1.2, 0.03, 0.03 + crown * 0.5, h - crown * 0.5, "wood", rot=math.degrees(a))
        for i in range(34):
            a = rnd.uniform(0, 2 * math.pi)
            rr = rnd.uniform(0.1, crown * 0.85)
            b.sphere(rr * math.cos(a), rr * math.sin(a), h - crown + rnd.uniform(0, crown * 1.15),
                     rnd.uniform(0.22, 0.42) * crown / 1.6, "leaf", 1, var=rnd.random(), squash=0.55)
    else:
        for i in range(9):
            a = rnd.uniform(0, 2 * math.pi)
            rr = rnd.uniform(0.0, pot_r * 0.9)
            b.sphere(rr * math.cos(a), rr * math.sin(a), pot_h + rnd.uniform(0.2, h - pot_h), rnd.uniform(0.25, 0.42),
                     "leaf", 1, var=rnd.random(), squash=0.75)


def monitor(b, w=1.95, h=1.15):
    b.box(-0.35, -0.25, 0, 0.35, 0.25, 0.04, "steel")
    b.box(-0.05, 0.02, 0.04, 0.05, 0.1, 0.55, "steel")
    b.box(-w / 2, -0.03, 0.45, w / 2, 0.05, 0.45 + h, "steel")
    b.box(-w / 2 + 0.04, -0.045, 0.49, w / 2 - 0.04, -0.03, 0.45 + h - 0.04, "screen")


def laptop(b):
    b.box(-0.55, -0.4, 0, 0.55, 0.38, 0.05, "chrome")
    b.box(-0.55, 0.36, 0.05, 0.55, 0.42, 0.78, "chrome")
    b.box(-0.5, 0.355, 0.1, 0.5, 0.36, 0.74, "screen")


def desk_lamp(b):
    b.cyl(0, 0, 0, 0.06, 0.28, "brass", 20)
    b.cyl(0, 0, 0.06, 1.2, 0.03, "brass", 8)
    b.cyl(0, 0, 1.1, 1.45, 0.42, "emit", 24, r2=0.12)


def floor_lamp(b):
    b.cyl(0, 0, 0, 0.08, 0.6, "steel", 24)
    b.cyl(0, 0, 0.08, 4.6, 0.04, "brass", 8)
    b.cyl(0, 0, 4.4, 5.3, 0.55, "emit", 28, r2=0.45)


def pendant_linear(b, w=6.0):
    for x in (-w / 2 + 0.4, w / 2 - 0.4):
        b.cyl(x, 0, 0.35, 2.5, 0.015, "steel", 6)
    b.box(-w / 2, -0.18, 0.0, w / 2, 0.18, 0.35, "steel")
    b.box(-w / 2 + 0.05, -0.12, -0.01, w / 2 - 0.05, 0.12, 0.0, "led")


def pendant_drum(b):
    b.cyl(0, 0, 0.8, 3.0, 0.015, "steel", 6)
    b.cyl(0, 0, 0.0, 0.8, 0.9, "emit", 32)


def kiosk(b):
    b.box(-0.75, -0.6, 0, 0.75, 0.6, 0.25, "wood")
    b.box(-0.65, -0.45, 0.25, 0.65, 0.5, 5.0, "accent")
    b.box(-0.55, -0.47, 2.8, 0.55, -0.45, 4.6, "screen")
    b.box(-0.6, -0.48, 4.75, 0.6, -0.45, 4.85, "led")


def passport_station(b):
    workpoint(b, 5.0, 2.5)
    b.box(-2.5, 1.1, 2.5, 2.5, 1.25, 4.2, "fabric")           # privacy screen
    b.box(-2.0, 0.1, 2.5, -1.2, 0.8, 2.72, "steel")           # document scanner
    b.box(-1.9, 0.2, 2.72, -1.3, 0.7, 2.74, "screen")


def reception_counter(b, w=10.0, d=2.3, h=3.5):
    b.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.25, "steel")
    n = int(w / 0.25)
    for i in range(n):
        x = -w / 2 + i * w / n
        b.box(x + 0.01, -d / 2, 0.25, x + w / n - 0.01, -d / 2 + 0.25, h - 0.15, "accent")
    b.box(-w / 2, -d / 2 + 0.25, 0.25, w / 2, d / 2, h - 0.15, "accent")
    b.box(-w / 2 - 0.1, -d / 2 - 0.15, h - 0.15, w / 2 + 0.1, d / 2 - 0.9, h, "stone")
    b.box(-w / 2 + 0.3, d / 2 - 0.9, 2.45, w / 2 - 0.3, d / 2, 2.55, "wood")  # staff work surface
    b.box(-w / 2 + 0.2, -d / 2 - 0.05, 0.3, w / 2 - 0.2, -d / 2 - 0.02, 0.36, "led")


def journey_display(b, w=12.0, h=5.5):
    b.box(-w / 2, -0.4, 0, w / 2, 0.4, 1.2, "wood")
    b.box(-w / 2, -0.12, 1.2, w / 2, 0.12, h, "steel")
    b.box(-w / 2 + 0.15, -0.14, 1.35, w / 2 - 0.15, -0.12, h - 0.15, "glass")
    for i in range(4):
        x0 = -w / 2 + 0.4 + i * (w - 0.8) / 4
        b.box(x0 + 0.1, -0.13, 1.6, x0 + (w - 0.8) / 4 - 0.1, -0.125, h - 0.5, "screen")


def media_wall_unit(b, w=14.0, h=5.5, screens=3, base="wood"):
    b.box(-w / 2, -0.4, 0, w / 2, 0.4, 2.2, base)
    b.box(-w / 2 + 0.1, 0.25, 2.2, w / 2 - 0.1, 0.4, h, "steel")
    sw = (w - 0.6) / screens
    for i in range(screens):
        x0 = -w / 2 + 0.3 + i * sw
        b.box(x0 + 0.12, 0.12, 2.6, x0 + sw - 0.12, 0.25, h - 0.25, "steel")
        b.box(x0 + 0.18, 0.105, 2.66, x0 + sw - 0.18, 0.12, h - 0.31, "screen")


def archive_cabinet(b, w, d, h, fill="boxes"):
    if fill == "flatfile":
        b.box(-w / 2, -d / 2, 0.2, w / 2, d / 2, h, "accent")
        b.box(-w / 2 + 0.15, -d / 2 + 0.1, 0, w / 2 - 0.15, d / 2 - 0.1, 0.2, "steel")
        for i in range(8):
            z = 0.3 + i * (h - 0.4) / 8
            b.box(-w / 2 + 0.1, -d / 2 - 0.02, z, w / 2 - 0.1, -d / 2, z + (h - 0.4) / 8 - 0.04, "accent")
            b.box(-0.4, -d / 2 - 0.06, z + 0.15, 0.4, -d / 2 - 0.02, z + 0.2, "brass")
        b.box(-w / 2 + 0.6, -0.3, h, -w / 2 + 2.2, 0.5, h + 0.05, "paper")
    else:
        shelving(b, w, d, h, "accent" if fill == "boxes" else "wood", "books", shelves=4 if h < 5 else 5,
                 boxes=(fill == "boxes"))


def checkin_desk(b):
    kiosk(b)


def tech_bench(b, w=6.0, d=2.2):
    table_rect(b, w, d, 3.0, "accent", "steel")
    b.box(-w / 2 + 0.3, -d / 2 + 0.2, 3.0, w / 2 - 1.6, d / 2 - 0.2, 3.02, "green_mat")
    b.box(-w / 2, d / 2 - 0.15, 3.0, w / 2, d / 2, 5.4, "accent")         # pegboard riser
    b.box(-w / 2 + 0.1, d / 2 - 0.12, 4.6, w / 2 - 0.1, d / 2 - 0.15, 4.7, "led")
    b.box(w / 2 - 1.4, 0.0, 3.0, w / 2 - 0.4, 0.7, 3.45, "steel")          # bench meter
    b.box(w / 2 - 1.3, -0.01, 3.1, w / 2 - 0.5, 0.0, 3.35, "screen")
    b.box(-w / 2 + 0.1, -d / 2 + 0.1, 0.15, -w / 2 + 1.5, d / 2 - 0.1, 2.6, "accent")  # drawers


def vocal_rig(b):
    b.cyl(0, 0, 0, 0.05, 0.6, "steel", 16)
    b.cyl(0, 0, 0.05, 5.2, 0.035, "steel", 8)
    b.box(-0.04, -0.9, 5.15, 0.04, 0.0, 5.22, "steel")
    b.cyl(0, -0.95, 4.9, 5.4, 0.12, "chrome", 16)
    b.cyl(0, -1.35, 4.85, 5.45, 0.33, "fabric", 24, r2=0.33)  # pop filter disc
    b.box(-1.4, 1.0, 0, 1.4, 1.5, 6.0, "fabric")              # reflection filter panel


def edit_desk(b, w=6.0, d=2.5):
    workpoint(b, w, d)
    b.box(-w / 2 + 0.3, 0.4, 2.5, -w / 2 + 1.0, 1.05, 3.55, "steel")     # monitor speaker L
    b.box(w / 2 - 1.0, 0.4, 2.5, w / 2 - 0.3, 1.05, 3.55, "steel")      # monitor speaker R
    b.box(-1.4, -0.9, 2.5, 1.4, -0.2, 2.56, "steel")                     # control surface


def gear_locker(b, w=5.0, d=1.8, h=6.0):
    b.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, "steel")
    for i in range(3):
        x0 = -w / 2 + 0.05 + i * (w - 0.1) / 3
        b.box(x0 + 0.03, -d / 2 - 0.03, 0.15, x0 + (w - 0.1) / 3 - 0.03, -d / 2, h - 0.1, "accent")
        b.box(x0 + 0.2, -d / 2 - 0.07, h / 2 - 0.4, x0 + 0.25, -d / 2 - 0.03, h / 2 + 0.4, "chrome")
        b.box(x0 + 0.25, -d / 2 - 0.035, h - 0.9, x0 + 0.9, -d / 2 - 0.03, h - 0.6, "paper")


def road_case(b, w=2.4, d=1.8, h=2.0):
    b.box(-w / 2, -d / 2, 0.25, w / 2, d / 2, h, "steel")
    for x in (-w / 2, w / 2 - 0.08):
        b.box(x, -d / 2 - 0.01, 0.25, x + 0.08, d / 2 + 0.01, h, "chrome")
    for x in (-w / 2 + 0.3, w / 2 - 0.3):
        for y in (-d / 2 + 0.3, d / 2 - 0.3):
            b.cyl(x, y, 0, 0.25, 0.12, "rubber", 10)


def evidence_locker(b, w=5.0, d=2.0, h=6.0):
    shelving(b, w, d, h, "steel", "books", 5, boxes=True)
    for x in (-w / 2, w / 2):
        b.box(x - 0.02, -d / 2 - 0.04, 0, x + 0.02, -d / 2, h, "steel")
    for i in range(12):
        z = i * h / 12
        b.box(-w / 2, -d / 2 - 0.04, z, w / 2, -d / 2 - 0.02, z + 0.03, "steel")   # mesh door bars
    for i in range(14):
        x = -w / 2 + i * w / 14
        b.box(x, -d / 2 - 0.05, 0, x + 0.03, -d / 2 - 0.02, h, "steel")


def coat_rack(b, w=4.5, d=1.6, h=5.6):
    for x in (-w / 2, w / 2):
        b.box(x - 0.06, -0.06, 0.25, x + 0.06, 0.06, h, "steel")
        b.box(x - 0.08, -d / 2, 0.0, x + 0.08, d / 2, 0.25, "steel")
    b.box(-w / 2, -0.05, h - 0.12, w / 2, 0.05, h, "steel")
    b.box(-w / 2 + 0.1, -d / 2 + 0.1, 0.5, w / 2 - 0.1, d / 2 - 0.1, 0.6, "wood")  # shoe shelf
    import random
    rnd = random.Random(7)
    x = -w / 2 + 0.3
    while x < w / 2 - 0.35:
        t = rnd.uniform(0.18, 0.3)
        b.box(x, -0.55, h - 0.25 - rnd.uniform(2.6, 3.5), x + t, 0.55, h - 0.25, "coats", var=rnd.random())
        b.box(x + t / 2 - 0.01, -0.02, h - 0.3, x + t / 2 + 0.01, 0.02, h - 0.1, "chrome")
        x += t + 0.05


def vitrine(b, w=2.0, l=8.0):
    b.box(-l / 2, -w / 2, 0, l / 2, w / 2, 2.6, "wood")
    b.box(-l / 2 + 0.05, -w / 2 + 0.05, 2.6, l / 2 - 0.05, w / 2 - 0.05, 3.5, "glass")
    for i in range(6):
        x = -l / 2 + 0.5 + i * (l - 1) / 6
        b.box(x, -0.5, 2.6, x + 0.9, 0.5, 2.65, "paper")
    b.box(-l / 2 + 0.1, -w / 2 + 0.1, 3.42, l / 2 - 0.1, w / 2 - 0.1, 3.45, "led")


def frame_art(b, w=2.2, h=2.8):
    b.box(-w / 2, -0.08, 0, w / 2, 0.0, h, "steel")
    b.box(-w / 2 + 0.2, -0.09, 0.2, w / 2 - 0.2, -0.08, h - 0.2, "paper")


def stool(b):
    b.cyl(0, 0, 1.55, 1.7, 0.6, "fabric", 24)
    b.cyl(0, 0, 0, 1.55, 0.06, "steel", 8)
    b.cyl(0, 0, 0, 0.06, 0.45, "steel", 20)


def pouf(b):
    b.cyl(0, 0, 0, 1.4, 0.8, "fabric", 28)


def whiteboard(b, w=4.0):
    for x in (-w / 2, w / 2):
        b.box(x - 0.05, -0.6, 0, x + 0.05, 0.6, 0.1, "steel")
        b.box(x - 0.05, -0.05, 0.1, x + 0.05, 0.05, 6.0, "steel")
    b.box(-w / 2, -0.04, 2.6, w / 2, 0.04, 5.8, "paper")


def bollard(b):
    b.cyl(0, 0, 0, 2.3, 0.22, "steel", 16)
    b.cyl(0, 0, 2.0, 2.25, 0.215, "led", 16)
    b.cyl(0, 0, 2.3, 2.5, 0.26, "steel", 16)


def roof_bench(b, w=6.0, d=1.8):
    for x in (-w / 2 + 0.4, w / 2 - 0.4):
        b.box(x - 0.1, -d / 2, 0, x + 0.1, d / 2, 1.5, "galv")
    for i in range(5):
        y = -d / 2 + i * d / 5
        b.box(-w / 2, y + 0.02, 1.5, w / 2, y + d / 5 - 0.02, 1.62, "wood")
    for i in range(3):
        z = 1.9 + i * 0.3
        b.box(-w / 2, d / 2 - 0.12, z, w / 2, d / 2, z + 0.22, "wood")


def planter_box(b, w=4.0, d=1.6, h=1.8):
    b.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, "accent")
    b.box(-w / 2 + 0.1, -d / 2 + 0.1, h - 0.1, w / 2 - 0.1, d / 2 - 0.1, h - 0.02, "soil")
    import random
    rnd = random.Random(int(w * 10))
    for i in range(int(w * 4)):
        x, y = rnd.uniform(-w / 2 + 0.3, w / 2 - 0.3), rnd.uniform(-d / 2 + 0.3, d / 2 - 0.3)
        hh = rnd.uniform(1.4, 2.6)
        b.box(x - 0.03, y - 0.03, h, x + 0.03, y + 0.03, h + hh, "leaf", var=rnd.random() * 0.7 + 0.3)


def routing_beacon(b):
    b.box(-1.0, -0.75, 0, 1.0, 0.75, 0.3, "galv")
    b.box(-0.6, -0.4, 0.3, 0.6, 0.4, 5.0, "steel")
    b.box(-0.5, -0.42, 2.6, 0.5, -0.4, 4.4, "screen")
    b.box(-0.62, -0.42, 4.8, 0.62, 0.42, 4.9, "led")


def weather_console(b):
    b.box(-1.5, -0.75, 0, 1.5, 0.75, 0.25, "galv")
    b.box(-1.4, -0.4, 0.25, 1.4, 0.75, 3.0, "steel")
    b.box(-1.4, -0.75, 2.4, 1.4, 0.75, 3.1, "steel")
    b.box(-1.2, -0.76, 2.55, 1.2, -0.75, 2.95, "screen")
    b.box(-1.5, -0.9, 3.8, 1.5, 0.9, 4.0, "galv")       # rain hood
    for x in (-1.4, 1.4):
        b.box(x - 0.05, 0.6, 3.0, x + 0.05, 0.7, 3.8, "galv")


def condenser(b, w=6.0, d=3.0, h=4.0):
    b.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.3, "steel")
    b.box(-w / 2 + 0.1, -d / 2 + 0.1, 0.3, w / 2 - 0.1, d / 2 - 0.1, h - 0.2, "galv")
    for x in (-w / 4, w / 4):
        b.cyl(x, 0, h - 0.2, h, d / 2 - 0.3, "steel", 32)
        b.cyl(x, 0, h, h + 0.02, 0.25, "galv", 16)
    for i in range(12):
        y = -d / 2 + 0.1 + i * (d - 0.2) / 12
        b.box(-w / 2 + 0.05, y, 0.5, -w / 2 + 0.1, y + 0.05, h - 0.4, "steel")


def screen_panel(b, w=4.0, d=0.3, h=3.5):
    """Low smoked-glass screen on brass feet (furniture-height, not a partition)."""
    b.box(-w / 2, -d / 2, 0.0, w / 2, d / 2, 0.25, "brass")
    b.box(-w / 2, -0.04, 0.25, w / 2, 0.04, h, "smoked")
    b.box(-w / 2, -0.06, h, w / 2, 0.06, h + 0.08, "brass")


def exec_desk(b, w=6.5, d=3.0):
    b.box(-w / 2, -d / 2, 2.38, w / 2, d / 2, 2.55, "wood")
    b.box(-w / 2, -d / 2 + 0.2, 0, -w / 2 + 0.25, d / 2 - 0.2, 2.38, "stone")
    b.box(w / 2 - 1.8, -d / 2 + 0.2, 0, w / 2 - 0.2, d / 2 - 0.2, 2.38, "wood")
    b.box(-w / 2 + 0.25, d / 2 - 0.25, 0.6, w / 2 - 1.8, d / 2 - 0.15, 2.38, "wood")  # modesty panel
    b.box(-w / 2 + 0.3, -d / 2 - 0.01, 2.4, w / 2 - 0.3, -d / 2, 2.5, "brass")


def leather_armchair(b):
    b.box(-1.25, -1.2, 0, 1.25, 1.2, 0.35, "steel")
    b.box(-1.25, -1.2, 0.35, 1.25, 1.2, 1.4, "fabric")
    b.box(-1.25, 0.65, 1.4, 1.25, 1.2, 2.7, "fabric")
    b.box(-1.25, -1.2, 1.4, -0.9, 0.65, 2.1, "fabric")
    b.box(0.9, -1.2, 1.4, 1.25, 0.65, 2.1, "fabric")


def coffee_round(b, r=1.6, h=1.35):
    b.cyl(0, 0, h - 0.12, h, r, "stone", 40)
    b.cyl(0, 0, 0, h - 0.12, r * 0.75, "wood", 40)


def side_table(b):
    b.cyl(0, 0, 1.75, 1.85, 0.65, "stone", 28)
    b.cyl(0, 0, 0, 1.75, 0.5, "wood", 28)


def speaker_pair(b):
    for x in (-0.9, 0.9):
        b.box(x - 0.35, -0.3, 0, x + 0.35, 0.3, 1.0, "steel")
        b.cyl(x, -0.31, 0.3, 0.32, 0.22, "rubber", 18)


def tabletop_set(b):
    b.box(-0.5, -0.35, 0, 0.5, 0.35, 0.06, "paper")
    b.box(-0.45, -0.3, 0.06, 0.45, 0.3, 0.1, "paper")


RECIPES = {
    # key: (recipe, kwargs, category)
    "CHAIR_TASK": (chair_task, {}, "furniture"),
    "CHAIR_SIDE": (chair_side, {}, "furniture"),
    "CHAIR_LOUNGE_ROUND": (chair_lounge, {}, "furniture"),
    "CHAIR_LEATHER": (leather_armchair, {}, "furniture"),
    "LOUNGE_BANQUETTE": (banquette, {"w": 8.0, "d": 2.2}, "furniture"),
    "SOFA_3SEAT": (sofa, {"w": 7.5, "d": 3.0}, "furniture"),
    "SOFA_LONG": (sofa, {"w": 9.0, "d": 3.0}, "furniture"),
    "WORKPOINT": (workpoint, {"w": 4.0, "d": 2.0}, "furniture"),
    "WORKPOINT_5x2.5": (workpoint, {"w": 5.0, "d": 2.5}, "furniture"),
    "CONSULT_TABLE": (table_rect, {"w": 4.0, "d": 2.5}, "furniture"),
    "CONSULT_TABLE_5x2.5": (table_rect, {"w": 5.0, "d": 2.5}, "furniture"),
    "MEETING_TABLE_7x3.5": (table_rect, {"w": 7.0, "d": 3.5}, "furniture"),
    "CAFE_TABLE": (table_round, {"r": 1.25, "h": 2.45}, "furniture"),
    "ROUND_TABLE_4": (table_round, {"r": 2.0, "h": 2.45}, "furniture"),
    "COFFEE_TABLE_ROUND": (coffee_round, {}, "furniture"),
    "SIDE_TABLE": (side_table, {}, "furniture"),
    "CREDENZA": (credenza, {"w": 6.0, "d": 1.5, "h": 2.4}, "furniture"),
    "CREDENZA_STONE": (credenza, {"w": 6.0, "d": 1.6, "h": 2.5, "top": "stone"}, "furniture"),
    "BOOKCASE": (shelving, {"w": 4.0, "d": 1.2, "h": 6.5, "frame": "wood"}, "furniture"),
    "BOOKCASE_LOW": (shelving, {"w": 12.0, "d": 1.2, "h": 2.4, "frame": "wood", "shelves": 2}, "furniture"),
    "ARCHIVE_CABINET": (archive_cabinet, {"w": 5.0, "d": 1.8, "h": 4.5, "fill": "books"}, "furniture"),
    "ARCHIVE_CABINET_6x6": (archive_cabinet, {"w": 6.0, "d": 1.8, "h": 6.0, "fill": "boxes"}, "furniture"),
    "MAP_CABINET": (archive_cabinet, {"w": 4.5, "d": 3.2, "h": 3.2, "fill": "flatfile"}, "furniture"),
    "PLANT_TREE": (plant, {"pot_r": 0.75, "pot_h": 1.5, "h": 6.5, "crown": 1.8, "seed": 3}, "decor"),
    "PLANT_FLOOR": (plant, {"pot_r": 0.6, "pot_h": 1.2, "h": 4.2, "crown": 1.3, "seed": 5}, "decor"),
    "PLANT_DESK": (plant, {"pot_r": 0.25, "pot_h": 0.4, "h": 1.0, "seed": 9}, "decor"),
    "PLANTER_ROOF": (planter_box, {"w": 4.0, "d": 1.6, "h": 1.8}, "decor"),
    "VITRINE": (vitrine, {}, "furniture"),
    "STOOL": (stool, {}, "furniture"),
    "POUF": (pouf, {}, "furniture"),
    "WHITEBOARD_MOBILE": (whiteboard, {}, "equipment"),
    "COAT_RACK": (coat_rack, {}, "furniture"),
    "SCREEN_PANEL_SMOKED": (screen_panel, {}, "furniture"),
    "EXEC_DESK": (exec_desk, {}, "furniture"),
    "ROOF_BENCH": (roof_bench, {}, "furniture"),
    "PASSPORT_STATION": (passport_station, {}, "furniture"),
    "TECH_BENCH": (tech_bench, {}, "furniture"),
    "EDIT_DESK": (edit_desk, {}, "furniture"),
    # equipment
    "CHECKIN_KIOSK": (kiosk, {}, "equipment"),
    "DIRECTORY_KIOSK": (kiosk, {}, "equipment"),
    "MONITOR": (monitor, {}, "equipment"),
    "MONITOR_WIDE": (monitor, {"w": 2.8, "h": 1.2}, "equipment"),
    "LAPTOP": (laptop, {}, "equipment"),
    "VOCAL_RIG": (vocal_rig, {}, "equipment"),
    "GEAR_LOCKER": (gear_locker, {}, "equipment"),
    "ROAD_CASE": (road_case, {}, "equipment"),
    "EVIDENCE_LOCKER": (evidence_locker, {}, "equipment"),
    "ROUTING_BEACON": (routing_beacon, {}, "equipment"),
    "WEATHER_CONSOLE": (weather_console, {}, "equipment"),
    "MEP_PLACEHOLDER": (condenser, {}, "equipment"),
    "SPEAKER_PAIR": (speaker_pair, {}, "equipment"),
    "FRAME_ART": (frame_art, {}, "decor"),
    "DOC_STACK": (tabletop_set, {}, "decor"),
    # lighting (light sources are added beside the mesh in build_kit)
    "LAMP_DESK": (desk_lamp, {}, "lighting"),
    "LAMP_FLOOR": (floor_lamp, {}, "lighting"),
    "PENDANT_LINEAR": (pendant_linear, {}, "lighting"),
    "PENDANT_DRUM": (pendant_drum, {}, "lighting"),
    "BOLLARD_LIGHT": (bollard, {}, "lighting"),
}

# practical light sources baked into the lighting masters: (type, local xyz ft, watts, size ft)
LIGHT_SOURCES = {
    "LAMP_DESK": ("POINT", (0, 0, 1.25), 18, 0.25),
    "LAMP_FLOOR": ("POINT", (0, 0, 4.85), 55, 0.4),
    "PENDANT_LINEAR": ("AREA", (0, 0, -0.03), 120, (5.6, 0.25)),
    "PENDANT_DRUM": ("POINT", (0, 0, 0.35), 90, 0.5),
    "BOLLARD_LIGHT": ("POINT", (0, 0, 2.12), 14, 0.15),
    "CHECKIN_KIOSK": None,
}


def build_kit(kit_root):
    """Create every master once. Returns {key: collection}."""
    M = kit_materials()
    out = {}
    for key, (fn, kw, cat) in RECIPES.items():
        c = bpy.data.collections.new("KIT_" + key)
        kit_root.children.link(c)
        b = Builder(M)
        fn(b, **kw)
        ob = b.to_object("KIT_" + key + "_mesh", c, bevel=0.0 if key.startswith("PLANT") or key == "PLANTER_ROOF" else 0.008)
        ob["eu_kit_key"] = key
        ob["eu_category"] = cat
        ls = LIGHT_SOURCES.get(key)
        if ls:
            typ, pos, watts, size = ls
            ld = bpy.data.lights.new("KITL_" + key, typ)
            ld.energy = watts
            ld.color = (1.0, 0.82, 0.62)
            if typ == "AREA":
                ld.shape = "RECTANGLE"
                ld.size, ld.size_y = size[0] * FT, size[1] * FT
            else:
                ld.shadow_soft_size = size * FT
            lo = bpy.data.objects.new("KITL_" + key, ld)
            lo.location = Vector(pos) * FT
            if typ == "AREA":
                lo.rotation_euler = (0, 0, 0)  # area lights emit along -Z (downward)
            c.objects.link(lo)
        c["eu_kit_key"] = key
        c["eu_category"] = cat
        out[key] = c
    return out, M
