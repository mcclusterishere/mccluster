"""McCluster production adapter: export one shot from an editable Blender master for Unreal.

    blender -b --factory-startup <master.blend> --python-exit-code 3 --python export_shot.py -- <shot.json>

<shot.json> is written by core/src/production/executor.mjs:
    {"job_id": ..., "manifest": <mccluster-shot-render/1>, "export_id": ..., "out": <export dir>}

The master is opened, read and NEVER saved (the executor hashes it before and after). Everything is written to a
new versioned export folder:

    set.fbx              the static set (source.set_root and its children) in world space, one combined mesh
    parts/<name>.fbx     every moving mesh of the subjects and props, in its own object space
    export.json          mccluster-shot-export/1: per-frame Unreal transforms of every part and the camera,
                         lights, expected bounds and the measurements the Unreal adapter checks against

Coordinates. Blender is Z-up, right-handed, metres; Unreal is Z-up, left-handed, centimetres. A point maps
(x, y, z) -> (100x, -100y, 100z), i.e. C = diag(1, -1, 1) and a x100 scale. An object's world matrix M maps to
C M C (translation x100). The FBX files are written with axis_forward='Y', axis_up='Z' (identity axis conversion)
and FBX unit scale, so Unreal's importer applies exactly C and x100 to the vertices; export.json carries the same
conversion for transforms. The Unreal adapter verifies the imported bounds against bounds_ue_expected below
instead of trusting this paragraph.
"""
import bpy, json, math, os, sys, hashlib, time
from mathutils import Matrix, Vector, Quaternion

SCHEMA = "mccluster-shot-export/1"
C = Matrix(((1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
M_TO_CM = 100.0


def say(*a):
    print("[mcc-export]", *a, flush=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe(name):
    out = "".join(ch if ch.isalnum() else "_" for ch in name).strip("_")
    while "__" in out:
        out = out.replace("__", "_")
    return (out or "part")[:60]


def ue_transform(mw):
    """Blender world matrix -> Unreal location (cm), quaternion (x, y, z, w), scale."""
    m = C @ mw @ C
    loc, rot, scale = m.decompose()
    return [round(loc.x * M_TO_CM, 4), round(loc.y * M_TO_CM, 4), round(loc.z * M_TO_CM, 4)], \
           [round(rot.x, 7), round(rot.y, 7), round(rot.z, 7), round(rot.w, 7)], \
           [round(scale.x, 6), round(scale.y, 6), round(scale.z, 6)]


def ue_point(v):
    return [round(v.x * M_TO_CM, 4), round(-v.y * M_TO_CM, 4), round(v.z * M_TO_CM, 4)]


def ue_camera_transform(mw):
    """Blender camera looks down local -Z with +Y up; an Unreal CineCamera looks down local +X with +Z up."""
    loc = mw.to_translation()
    r = mw.to_3x3().normalized()
    fwd_b = r @ Vector((0, 0, -1))
    up_b = r @ Vector((0, 1, 0))
    fwd = Vector((fwd_b.x, -fwd_b.y, fwd_b.z)).normalized()
    up = Vector((up_b.x, -up_b.y, up_b.z))
    up = (up - fwd * up.dot(fwd)).normalized()
    right = up.cross(fwd).normalized()  # Unreal Y axis = Z x X (numerically, left-handed frame)
    basis = Matrix(((fwd.x, right.x, up.x), (fwd.y, right.y, up.y), (fwd.z, right.z, up.z)))
    q = basis.to_quaternion()
    return ue_point(loc), [round(q.x, 7), round(q.y, 7), round(q.z, 7), round(q.w, 7)]


def world_bounds(objs, depsgraph):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in objs:
        ev = o.evaluated_get(depsgraph)
        for corner in ev.bound_box:
            w = ev.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def ue_bounds(lo, hi):
    a, b = ue_point(lo), ue_point(hi)
    return [min(a[i], b[i]) for i in range(3)], [max(a[i], b[i]) for i in range(3)]


def descendants(root):
    out = [root]
    for child in root.children_recursive:
        out.append(child)
    return out


def renderable(o):
    return o.type in {"MESH", "FONT", "CURVE", "SURFACE", "META"}


def export_fbx(path, objs, scene):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"MESH"}, apply_unit_scale=True,
                             apply_scale_options="FBX_SCALE_UNITS", axis_forward="Y", axis_up="Z", bake_space_transform=False,
                             use_mesh_modifiers=True, mesh_smooth_type="FACE", add_leaf_bones=False, bake_anim=False,
                             path_mode="STRIP", embed_textures=False)


def mesh_copy(o, depsgraph, scene, collection, local):
    ev = o.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=depsgraph)
    copy = bpy.data.objects.new("MCC_" + safe(o.name), mesh)
    copy.matrix_world = Matrix.Identity(4) if local else ev.matrix_world.copy()
    collection.objects.link(copy)
    return copy


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    job = json.load(open(argv[0], encoding="utf-8"))
    m = job["manifest"]
    out = job["out"]
    os.makedirs(os.path.join(out, "parts"), exist_ok=True)
    result_path = os.path.join(out, "export.json")
    started = time.time()
    scene = bpy.context.scene
    src = m["source"]
    f0, f1, fps = m["frames"]["start"], m["frames"]["end"], m["frames"]["fps"]
    if round(scene.render.fps / scene.render.fps_base) != fps:
        raise SystemExit("scene fps %s does not match the manifest's %s" % (scene.render.fps, fps))

    cam = bpy.data.objects.get(src["camera"])
    if cam is None or cam.type != "CAMERA":
        raise SystemExit("camera %s not found in the master" % src["camera"])
    set_root = bpy.data.objects.get(src.get("set_root") or "")
    if src.get("set_root") and set_root is None:
        raise SystemExit("set root %s not found" % src["set_root"])

    moving = []
    for name in src.get("subjects", []):
        root = bpy.data.objects.get(name)
        if root is None:
            raise SystemExit("subject %s not found" % name)
        moving += [("subject", name, o) for o in descendants(root) if renderable(o)]
    for name in src.get("props", []):
        hits = [o for o in bpy.data.objects if (o.name == name or o.name.startswith(name)) and renderable(o)]
        if not hits:
            raise SystemExit("prop %s not found" % name)
        moving += [("prop", name, o) for o in hits]
    seen, parts = set(), []
    for kind, group, o in moving:
        if o.name not in seen:
            seen.add(o.name)
            parts.append((kind, group, o))
    moving_names = {o.name for _, _, o in parts}

    scene.frame_set(f0)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    work = bpy.data.collections.new("MCC_EXPORT")
    scene.collection.children.link(work)

    # Static set in world space, at the shot's first frame.
    set_entry = None
    if set_root is not None:
        set_objs = [o for o in descendants(set_root) if renderable(o) and o.name not in moving_names and not o.hide_render]
        animated = [o.name for o in set_objs if o.animation_data and o.animation_data.action]
        copies = [mesh_copy(o, depsgraph, scene, work, local=False) for o in set_objs]
        copies = [c for c in copies if c.data and len(c.data.vertices)]
        set_file = os.path.join(out, "set.fbx")
        export_fbx(set_file, copies, scene)
        lo, hi = world_bounds(set_objs, depsgraph)
        blo, bhi = ue_bounds(lo, hi)
        set_entry = {"root": set_root.name, "file": "set.fbx", "sha256": sha256(set_file), "objects": len(copies),
                     "animated_objects_frozen": animated,
                     "bounds_blender_m": [list(map(lambda v: round(v, 4), lo)), list(map(lambda v: round(v, 4), hi))],
                     "bounds_ue_expected_cm": [blo, bhi]}
        for c in copies:
            bpy.data.objects.remove(c, do_unlink=True)

    # Moving parts in object space; transforms baked per frame below.
    part_entries = []
    for kind, group, o in parts:
        copy = mesh_copy(o, depsgraph, scene, work, local=True)
        if not copy.data or not len(copy.data.vertices):
            bpy.data.objects.remove(copy, do_unlink=True)
            continue
        name = safe(o.name)
        file = os.path.join(out, "parts", name + ".fbx")
        export_fbx(file, [copy], scene)
        lo = Vector((min(v.co[i] for v in copy.data.vertices) for i in range(3)))
        hi = Vector((max(v.co[i] for v in copy.data.vertices) for i in range(3)))
        blo, bhi = ue_bounds(lo, hi)
        part_entries.append({"name": name, "source": o.name, "kind": kind, "group": group, "file": "parts/%s.fbx" % name,
                             "sha256": sha256(file), "local_bounds_ue_expected_cm": [blo, bhi], "frames": []})
        bpy.data.objects.remove(copy, do_unlink=True)

    by_source = {p["source"]: p for p in part_entries}
    focus = {}
    for name in src.get("subjects", []):
        actor = name.split("_")[1] if name.startswith("Actor_") and name.count("_") >= 2 else name
        hit = bpy.data.objects.get("Focus_" + name[len("Actor_"):]) if name.startswith("Actor_") else None
        if hit is not None:
            focus[actor] = hit
    phone_ref = None
    for name in src.get("props", []):
        frame_hits = [o for o in bpy.data.objects if o.name.startswith(name) and "phone" in o.name.lower() and "frame" in o.name.lower() and o.type == "MESH"]
        if frame_hits:
            phone_ref = frame_hits[0]
        elif phone_ref is None:
            hits = [o for o in bpy.data.objects if o.name.startswith(name) and "phone" in o.name.lower() and o.type == "MESH"]
            phone_ref = hits[0] if hits else None

    cut = m["frames"].get("cut") or None
    clamp = (lambda f: min(max(f, cut["start"]), cut["end"])) if cut else (lambda f: f)
    head_parts = set()
    for name in src.get("subjects", []):
        root = bpy.data.objects.get(name)
        for o in descendants(root):
            if o.name.startswith("Neck_"):
                head_parts |= {c.name for c in descendants(o)}
    # The phone itself (props named like a phone); any other prop part, such as the shot's own arm and
    # hand, counts as body for the grip measurement.
    phone_parts = {p["source"] for p in part_entries if p["kind"] == "prop" and "phone" in p["source"].lower()}

    # Visibility at the cut-clamped frame: handles hold the cut's state.
    visibility = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(clamp(f))
        visibility[f] = {p["source"]: not bpy.data.objects[p["source"]].hide_render for p in part_entries}

    cam_frames, measures = [], []
    res_x, res_y = scene.render.resolution_x, scene.render.resolution_y
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        for p in part_entries:
            o = bpy.data.objects[p["source"]].evaluated_get(dg)
            loc, quat, scale = ue_transform(o.matrix_world)
            p["frames"].append([loc, quat, scale, visibility[f][p["source"]]])
        ce = cam.evaluated_get(dg)
        cloc, cquat = ue_camera_transform(ce.matrix_world)
        cam_frames.append([cloc, cquat, round(ce.data.lens, 4)])
        row = {"frame": f}
        from bpy_extras.object_utils import world_to_camera_view
        for actor, obj in focus.items():
            pt = obj.evaluated_get(dg).matrix_world.to_translation()
            ndc = world_to_camera_view(scene, ce, pt)
            row["head_" + actor] = {"ue_cm": ue_point(pt), "ndc": [round(ndc.x, 4), round(ndc.y, 4), round(ndc.z, 4)]}
        if phone_ref is not None:
            pe = phone_ref.evaluated_get(dg)
            centre = sum((pe.matrix_world @ Vector(c) for c in pe.bound_box), Vector()) / 8.0
            row["phone_ue_cm"] = ue_point(centre)
            pndc = world_to_camera_view(scene, ce, centre)
            row["phone_ndc"] = [round(pndc.x, 4), round(pndc.y, 4), round(pndc.z, 4)]
            for actor, obj in focus.items():
                head = obj.evaluated_get(dg).matrix_world.to_translation()
                row["phone_to_head_m_" + actor] = round((centre - head).length, 4)
            # Nearest visible body part that is neither head nor phone: the hand that holds it.
            best = None
            for p in part_entries:
                srcname = p["source"]
                if srcname in head_parts or srcname in phone_parts or not visibility[f][srcname]:
                    continue
                po = bpy.data.objects[srcname].evaluated_get(dg)
                corners = [po.matrix_world @ Vector(c) for c in po.bound_box]
                lo = [min(c[i] for c in corners) for i in range(3)]
                hi = [max(c[i] for c in corners) for i in range(3)]
                d = math.sqrt(sum(max(lo[i] - centre[i], 0, centre[i] - hi[i]) ** 2 for i in range(3)))
                if best is None or d < best[0]:
                    best = (d, srcname)
            if best:
                row["nearest_body_part_to_phone"] = {"part": best[1], "m": round(best[0], 4)}
        measures.append(row)

    lights = []
    scene.frame_set(f0)
    dg = bpy.context.evaluated_depsgraph_get()
    cam_pos = cam.evaluated_get(dg).matrix_world.to_translation()
    for o in bpy.data.objects:
        if o.type != "LIGHT" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        if (ev.matrix_world.to_translation() - cam_pos).length > 25.0:
            continue
        loc, quat, _ = ue_transform(ev.matrix_world)
        lights.append({"name": safe(o.name), "type": o.data.type, "ue_cm": loc, "quat": quat, "watts": round(getattr(o.data, "energy", 0.0), 3),
                       "color": [round(c, 4) for c in o.data.color], "radius_cm": round(getattr(o.data, "shadow_soft_size", 0.1) * 100, 2),
                       "spot_angle_deg": round(math.degrees(getattr(o.data, "spot_size", 0.0)), 3) if o.data.type == "SPOT" else None,
                       "size_cm": [round(getattr(o.data, "size", 0.0) * 100, 2), round(getattr(o.data, "size_y", getattr(o.data, "size", 0.0)) * 100, 2)] if o.data.type == "AREA" else None})

    sensor_fit = cam.data.sensor_fit
    if sensor_fit == "AUTO":
        sensor_fit = "HORIZONTAL" if res_x >= res_y else "VERTICAL"
    big = cam.data.sensor_width
    if sensor_fit == "VERTICAL":
        sensor_h = cam.data.sensor_height if cam.data.sensor_fit == "VERTICAL" else big
        sensor_w = sensor_h * res_x / res_y
    else:
        sensor_w = big
        sensor_h = sensor_w * res_y / res_x

    doc = {
        "schema": SCHEMA, "ok": True, "export_id": job.get("export_id"), "job_id": job.get("job_id"),
        "blender_version": bpy.app.version_string, "master": bpy.data.filepath,
        "shot_id": m["shot_id"], "take": m["take"],
        "frames": {"start": f0, "end": f1, "fps": fps, "count": f1 - f0 + 1},
        "resolution": [res_x, res_y],
        "coordinates": {"blender": "Z-up right-handed metres", "unreal": "Z-up left-handed centimetres", "point": "(x,y,z) -> (100x,-100y,100z)", "matrix": "C M C, C=diag(1,-1,1)"},
        "set": set_entry,
        "parts": part_entries,
        "camera": {"source": cam.name, "sensor_fit": sensor_fit, "sensor_width_mm": round(sensor_w, 4), "sensor_height_mm": round(sensor_h, 4),
                   "frames": cam_frames},
        "lights": lights,
        "measurements": measures,
        "reference": {"focus": {a: o.name for a, o in focus.items()}, "phone": phone_ref.name if phone_ref else None},
        "elapsed_s": round(time.time() - started, 2),
    }
    with open(result_path + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(doc, fh)
    os.replace(result_path + ".tmp", result_path)
    say("export ok: %d parts, %d frames, set %s" % (len(part_entries), len(cam_frames), "yes" if set_entry else "no"))


try:
    main()
except SystemExit as e:
    if e.code not in (0, None):
        try:
            argv = sys.argv[sys.argv.index("--") + 1:]
            job = json.load(open(argv[0], encoding="utf-8"))
            os.makedirs(job["out"], exist_ok=True)
            json.dump({"schema": SCHEMA, "ok": False, "error": str(e.code)}, open(os.path.join(job["out"], "export.json"), "w"))
        except Exception:
            pass
        print("[mcc-export] FAILED:", e.code, flush=True)
        sys.exit(3)
