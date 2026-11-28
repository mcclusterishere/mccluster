"""McCluster production adapter: render one shot from an editable Blender master (the local fallback).

    blender -b --factory-startup <master.blend> --python-exit-code 3 --python render_shot.py -- <shot.json>

<shot.json> (written by core/src/production/executor.mjs):
    {"job_id": ..., "manifest": <mccluster-shot-render/1>, "frames_dir": ..., "result": ...}

Renders frames manifest.frames.start..end through manifest.source.camera with the master's own render engine
(EEVEE on Prime's Radeon) to PNG frames <shot>.<frame>.png, then writes the result file. Handles outside
manifest.frames.cut hold the cut's visibility, as the Unreal export does. The master is never saved: every
change below is made in memory to this session's copy and discarded when Blender exits; the executor hashes
the master before and after.
"""
import bpy, json, os, sys, time

argv = sys.argv[sys.argv.index("--") + 1:]
job = json.load(open(argv[0], encoding="utf-8"))
m = job["manifest"]
result_path = job["result"]


def write(doc):
    with open(result_path + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
    os.replace(result_path + ".tmp", result_path)


try:
    started = time.time()
    sc = bpy.context.scene
    cam = bpy.data.objects.get(m["source"]["camera"])
    if cam is None or cam.type != "CAMERA":
        raise RuntimeError("camera %s not found" % m["source"]["camera"])
    f0, f1, fps = m["frames"]["start"], m["frames"]["end"], m["frames"]["fps"]
    if round(sc.render.fps / sc.render.fps_base) != fps:
        raise RuntimeError("scene fps does not match the manifest")
    # Markers bind cameras to frames; a single shot render uses one camera throughout.
    for marker in list(sc.timeline_markers):
        marker.camera = None
    sc.camera = cam
    cut = m["frames"].get("cut")
    held = 0
    if cut:
        # Hold the cut's visibility on the handles: key hide_render on the handle frames from the cut edges.
        # Visibility here is keyed or driven (frame-range drivers). Record what each object shows at the
        # cut-clamped frame, then replace its hide_render driver/keys with constant keys of that record.
        clamp = lambda f: min(max(f, cut["start"]), cut["end"])
        animated = [o for o in bpy.data.objects if o.animation_data and (o.animation_data.action or any(d.data_path == "hide_render" for d in o.animation_data.drivers))]
        record = {}
        for f in range(f0, f1 + 1):
            sc.frame_set(clamp(f))
            for o in animated:
                record.setdefault(o.name, {})[f] = bool(o.hide_render)
        for o in animated:
            try:
                o.driver_remove("hide_render")
            except Exception:
                pass
            for f, hidden in record[o.name].items():
                o.hide_render = hidden
                o.keyframe_insert("hide_render", frame=f)
            held += 1
    r = sc.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = m["resolution"]["width"], m["resolution"]["height"], 100
    try:
        r.image_settings.media_type = "IMAGE"
    except Exception:
        pass
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.use_file_extension = True
    sc.frame_start, sc.frame_end = f0, f1
    r.filepath = os.path.join(job["frames_dir"], m["shot_id"] + ".####")
    bpy.ops.render.render(animation=True)
    frames = sorted(x for x in os.listdir(job["frames_dir"]) if x.endswith(".png"))
    ok = len(frames) == f1 - f0 + 1
    write({"ok": ok, "error": None if ok else "rendered %d of %d frames" % (len(frames), f1 - f0 + 1),
           "frame_pattern": m["shot_id"] + ".%04d.png", "frame_start_number": f0, "blender_version": bpy.app.version_string,
           "engine": sc.render.engine, "checks": {}, "visibility_curves_held": held if cut else 0, "elapsed_s": round(time.time() - started, 1)})
except Exception as e:
    write({"ok": False, "error": "%s: %s" % (type(e).__name__, e)})
    sys.exit(3)
