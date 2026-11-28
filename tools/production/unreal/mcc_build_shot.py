"""McCluster production adapter: build one shot in Unreal from a Blender shot export.

Run by core/src/production/executor.mjs, never by hand during a job:

    UnrealEditor-Cmd.exe <McCPreviz.uproject> -ExecutePythonScript=<this file> -unattended -nopause -nosplash -NoSound
    (environment: MCC_UNREAL_JOB=<jobs/<job>/unreal_job.json>)

It imports the static set and every moving part (FBX, legacy importer, no scene axis conversion, unit conversion
on), makes a level, a Level Sequence at the shot's frame rate with one transform track per part and a CineCamera
with the export's filmback, a camera cut, and a Movie Render Queue manifest (PNG, deferred pass) that the
executor renders in a separate -game process. Then it checks the build against the export:

    scale    imported mesh bounds equal the bounds the export expects (cm, Unreal axes)
    framing  the subject's head, projected through the camera keys READ BACK from the sequence, lands where
             Blender's camera put it, and inside the frame
    grip     the phone, read back from its track, sits where Blender had it, at the head, in frame, with a
             visible body part (the hand) touching it
    timing   the sequence runs exactly the manifest's frames at its frame rate

Result: the job's result file (unreal_build.json): {ok, map, sequence, queue_manifest, frame_pattern,
frame_start_number, checks, unreal_version, error}. Supported engines: Unreal 5.4 to 5.8 (the executor refuses
others before starting). Version differences in the Python API are handled where they are known; anything else
fails with the API name in the error rather than guessing.
"""
import json, math, os, sys, time, traceback

import unreal

JOB = json.load(open(os.environ["MCC_UNREAL_JOB"], encoding="utf-8"))
RESULT = JOB["result"]
M = JOB["manifest"]
EXPORT_DIR = JOB["export_dir"]
EX = json.load(open(os.path.join(EXPORT_DIR, "export.json"), encoding="utf-8"))
SHOT = M["shot_id"]
TAKE = int(M["take"])
FPS = int(M["frames"]["fps"])
COUNT = int(M["frames"]["count"])
BASE = "/Game/Shots/%s/T%03d" % (SHOT, TAKE)
LOG = []


def say(*a):
    line = " ".join(str(x) for x in a)
    LOG.append(line)
    unreal.log("[mcc-unreal] " + line)


def write(doc):
    doc.setdefault("log", LOG[-200:])
    doc.setdefault("unreal_version", unreal.SystemLibrary.get_engine_version())
    tmp = RESULT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1)
    os.replace(tmp, RESULT)


def sub(cls):
    return unreal.get_editor_subsystem(cls)


def first(*names):
    """The first attribute of `unreal` among names (APIs renamed across 5.x)."""
    for n in names:
        if hasattr(unreal, n):
            return getattr(unreal, n)
    raise RuntimeError("none of %s exist in this Unreal" % ", ".join(names))


# ---------- import ----------

def import_fbx(file, dest, name):
    # Legacy FBX importer: Interchange (default from 5.5) ignores FbxImportUI.
    unreal.SystemLibrary.execute_console_command(None, "Interchange.FeatureFlags.Import.FBX 0")
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", file)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", True)
    ui.set_editor_property("import_as_skeletal", False)
    ui.set_editor_property("import_animations", False)
    ui.set_editor_property("import_materials", True)
    ui.set_editor_property("import_textures", False)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
    data = ui.get_editor_property("static_mesh_import_data")
    data.set_editor_property("combine_meshes", True)
    data.set_editor_property("convert_scene", False)
    data.set_editor_property("force_front_x_axis", False)
    data.set_editor_property("convert_scene_unit", True)
    data.set_editor_property("auto_generate_collision", False)
    data.set_editor_property("import_uniform_scale", 1.0)
    try:
        data.set_editor_property("build_nanite", False)
    except Exception:
        pass
    task.set_editor_property("options", ui)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.get_editor_property("imported_object_paths") or [])
    meshes = [unreal.load_asset(p) for p in paths]
    meshes = [x for x in meshes if isinstance(x, unreal.StaticMesh)]
    if not meshes:
        raise RuntimeError("FBX import produced no static mesh for %s" % file)
    return meshes[0]


def mesh_bounds(mesh):
    box = mesh.get_bounding_box()
    lo, hi = box.min, box.max
    return [lo.x, lo.y, lo.z], [hi.x, hi.y, hi.z]


def bounds_match(got, want, tol_cm=1.0, tol_rel=0.005):
    worst = 0.0
    for i in range(2):
        for k in range(3):
            span = max(1.0, abs(want[1][k] - want[0][k]))
            err = abs(got[i][k] - want[i][k])
            worst = max(worst, err)
            if err > max(tol_cm, tol_rel * span):
                return False, worst
    return True, worst


# ---------- level, actors, sequence ----------

def new_level(path):
    les = sub(unreal.LevelEditorSubsystem)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    if not les.new_level(path):
        raise RuntimeError("LevelEditorSubsystem.new_level failed for %s" % path)
    return les


def spawn_mesh(mesh, label, movable=True):
    eas = sub(unreal.EditorActorSubsystem)
    actor = eas.spawn_actor_from_object(mesh, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    actor.set_actor_label(label)
    comp = actor.get_component_by_class(unreal.StaticMeshComponent)
    comp.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE if movable else unreal.ComponentMobility.STATIC)
    return actor


def quat_rot(q):
    return unreal.Quat(q[0], q[1], q[2], q[3]).rotator()


def unwrap(prev, value):
    if prev is None:
        return value
    while value - prev > 180.0:
        value -= 360.0
    while value - prev < -180.0:
        value += 360.0
    return value


def add_key(channel, frame, value):
    channel.add_key(unreal.FrameNumber(frame), value, 0.0, unreal.MovieSceneTimeUnit.DISPLAY_RATE)


def key_transform(binding, frames):
    track = binding.add_track(unreal.MovieScene3DTransformTrack)
    section = track.add_section()
    section.set_range(0, COUNT)
    ch = section.get_all_channels()  # location x,y,z, rotation roll(x),pitch(y),yaw(z), scale x,y,z
    prev = [None, None, None]
    for i, f in enumerate(frames):
        loc, q = f[0], f[1]
        scale = f[2] if len(f) > 2 and isinstance(f[2], list) else [1.0, 1.0, 1.0]
        r = quat_rot(q)
        rot = [unwrap(prev[0], r.roll), unwrap(prev[1], r.pitch), unwrap(prev[2], r.yaw)]
        prev = rot
        for k, v in enumerate(loc + rot + scale):
            add_key(ch[k], i, float(v))
    for c in ch:
        try:
            for key in c.get_keys():
                key.set_interpolation_mode(unreal.RichCurveInterpMode.RCIM_LINEAR)
        except Exception:
            pass
    return section


def channel_value(channel, frame):
    for key in channel.get_keys():
        if key.get_time(unreal.MovieSceneTimeUnit.DISPLAY_RATE).frame_number.value == frame:
            return key.get_value()
    return None


def read_transform(section, frame):
    ch = section.get_all_channels()
    vals = [channel_value(c, frame) for c in ch[:6]]
    if any(v is None for v in vals):
        return None
    return unreal.Vector(vals[0], vals[1], vals[2]), unreal.Rotator(vals[3], vals[4], vals[5])


def binding_id(seq, binding):
    try:
        return unreal.MovieSceneSequenceExtensions.get_binding_id(seq, binding)
    except Exception:
        return seq.get_binding_id(binding) if hasattr(seq, "get_binding_id") else binding.get_binding_id()


def add_sequence_track(seq, cls):
    if hasattr(seq, "add_track"):
        try:
            return seq.add_track(cls)
        except Exception:
            pass
    return seq.add_master_track(cls)


def light_actor(spec):
    eas = sub(unreal.EditorActorSubsystem)
    loc = unreal.Vector(*spec["ue_cm"])
    rot = quat_rot(spec["quat"])
    kind = spec["type"]
    cls = {"POINT": unreal.PointLight, "SPOT": unreal.SpotLight, "AREA": unreal.RectLight}.get(kind)
    if cls is None:
        return None
    # Blender's area/spot/point lights face local -Z; Unreal's face local +X. Pitch the light down 90 degrees.
    actor = eas.spawn_actor_from_class(cls, loc, rot)
    if kind in ("SPOT", "AREA"):
        actor.add_actor_local_rotation(unreal.Rotator(0, -90, 0), False, False)
    comp = actor.get_component_by_class(unreal.LightComponent)
    watts = float(spec.get("watts") or 0)
    # Radiometric watts to Unreal candelas for previz (683 lm/W over 4 pi sr), then a fixed interior gain.
    comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    comp.set_editor_property("intensity", max(1.0, watts * 683.0 / (4 * math.pi) * 0.05))
    comp.set_editor_property("light_color", unreal.Color(r=int(spec["color"][0] * 255), g=int(spec["color"][1] * 255), b=int(spec["color"][2] * 255), a=255))
    if kind == "AREA" and spec.get("size_cm"):
        comp.set_editor_property("source_width", max(1.0, spec["size_cm"][0]))
        comp.set_editor_property("source_height", max(1.0, spec["size_cm"][1]))
    actor.set_actor_label("L_" + spec["name"])
    return actor


def camera_ndc(cam_loc, cam_rot, point, focal, sw, sh):
    d = unreal.Vector(point[0] - cam_loc.x, point[1] - cam_loc.y, point[2] - cam_loc.z)
    fwd, right, up = cam_rot.get_forward_vector(), cam_rot.get_right_vector(), cam_rot.get_up_vector()
    x = d.x * fwd.x + d.y * fwd.y + d.z * fwd.z
    y = d.x * right.x + d.y * right.y + d.z * right.z
    z = d.x * up.x + d.y * up.y + d.z * up.z
    if x <= 0:
        return None
    return [0.5 + (y / x) * (focal / sw), 0.5 + (z / x) * (focal / sh)]


# ---------- main ----------

def main():
    started = time.time()
    checks = {}
    say("Unreal", unreal.SystemLibrary.get_engine_version(), "shot", SHOT, "take", TAKE)
    eal = unreal.EditorAssetLibrary
    mesh_dir = BASE + "/Meshes"

    # Set
    scale_errors = []
    set_actor = None
    if EX.get("set"):
        set_mesh = import_fbx(os.path.join(EXPORT_DIR, EX["set"]["file"]), mesh_dir, "SM_Set")
        got = mesh_bounds(set_mesh)
        ok, worst = bounds_match(got, EX["set"]["bounds_ue_expected_cm"], tol_cm=2.0)
        if not ok:
            scale_errors.append("set bounds %s expected %s" % ([[round(v, 1) for v in g] for g in got], EX["set"]["bounds_ue_expected_cm"]))
        say("set imported, worst bound error %.2f cm" % worst)

    parts = []
    for p in EX["parts"]:
        if not any(f[3] for f in p["frames"]):
            continue  # never visible in this shot
        mesh = import_fbx(os.path.join(EXPORT_DIR, p["file"]), mesh_dir, "SM_" + p["name"])
        got = mesh_bounds(mesh)
        ok, worst = bounds_match(got, p["local_bounds_ue_expected_cm"], tol_cm=0.2, tol_rel=0.01)
        if not ok:
            scale_errors.append("%s bounds %s expected %s" % (p["name"], [[round(v, 2) for v in g] for g in got], p["local_bounds_ue_expected_cm"]))
        parts.append((p, mesh))
    checks["scale"] = {"pass": not scale_errors, "detail": "imported bounds match the export (set and %d parts)" % len(parts) if not scale_errors else "; ".join(scale_errors[:4]),
                       "measured": {"parts": len(parts), "errors": len(scale_errors)}}

    map_path = BASE + "/Map_" + SHOT
    new_level(map_path)
    if EX.get("set"):
        set_actor = spawn_mesh(set_mesh, "Set_" + EX["set"]["root"], movable=False)
    for spec in EX.get("lights", []):
        try:
            light_actor(spec)
        except Exception as e:
            say("light %s skipped: %s" % (spec.get("name"), e))
    eas = sub(unreal.EditorActorSubsystem)
    sky = eas.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 500), unreal.Rotator(0, 0, 0))
    sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property("intensity", 1.0)
    ppv = eas.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    ppv.set_editor_property("unbound", True)

    seq_name = "LS_%s_T%03d" % (SHOT, TAKE)
    seq_path = BASE + "/" + seq_name
    if eal.does_asset_exist(seq_path):
        eal.delete_asset(seq_path)
    seq = unreal.AssetToolsHelpers.get_asset_tools().create_asset(seq_name, BASE, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    seq.set_display_rate(unreal.FrameRate(FPS, 1))
    seq.set_playback_start(0)
    seq.set_playback_end(COUNT)

    sections = {}
    for p, mesh in parts:
        actor = spawn_mesh(mesh, p["name"])
        binding = seq.add_possessable(actor)
        sections[p["source"]] = key_transform(binding, p["frames"])
        if not all(f[3] for f in p["frames"]):
            vis = binding.add_track(unreal.MovieSceneVisibilityTrack)
            vsec = vis.add_section()
            vsec.set_range(0, COUNT)
            vch = vsec.get_all_channels()[0]
            for i, f in enumerate(p["frames"]):
                add_key(vch, i, bool(f[3]))

    cam_spec = EX["camera"]
    cam = eas.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    cam.set_actor_label("Cam_" + SHOT)
    cc = cam.get_cine_camera_component()
    fb = cc.get_editor_property("filmback")
    fb.set_editor_property("sensor_width", float(cam_spec["sensor_width_mm"]))
    fb.set_editor_property("sensor_height", float(cam_spec["sensor_height_mm"]))
    cc.set_editor_property("filmback", fb)
    lens = float(cam_spec["frames"][0][2])
    cc.set_editor_property("current_focal_length", lens)
    focus = cc.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
    cc.set_editor_property("focus_settings", focus)
    cam_binding = seq.add_possessable(cam)
    cam_section = key_transform(cam_binding, [[f[0], f[1]] for f in cam_spec["frames"]])
    cut_track = add_sequence_track(seq, unreal.MovieSceneCameraCutTrack)
    cut = cut_track.add_section()
    cut.set_range(0, COUNT)
    cut.set_camera_binding_id(binding_id(seq, cam_binding))

    # ---- checks against the export, from values read back out of the sequence ----
    sw, sh = float(cam_spec["sensor_width_mm"]), float(cam_spec["sensor_height_mm"])
    meas = EX.get("measurements", [])
    frame_err, out_of_frame = 0.0, 0
    grip_fail, grip_worst_pos, grip_dist, grip_hand = [], 0.0, [], []
    phone_section = sections.get(EX["reference"].get("phone")) if EX.get("reference") else None
    for i, row in enumerate(meas):
        cam_t = read_transform(cam_section, i)
        if cam_t is None:
            raise RuntimeError("camera key %d did not read back" % i)
        for key, value in row.items():
            if not key.startswith("head_"):
                continue
            ndc = camera_ndc(cam_t[0], cam_t[1], value["ue_cm"], lens, sw, sh)
            if ndc is None:
                out_of_frame += 1
                continue
            # Blender's world_to_camera_view has y up from the bottom; ours too.
            frame_err = max(frame_err, abs(ndc[0] - value["ndc"][0]), abs(ndc[1] - value["ndc"][1]))
            if not (0.05 <= ndc[0] <= 0.95 and 0.05 <= ndc[1] <= 0.95):
                out_of_frame += 1
        if "phone_ue_cm" in row:
            if phone_section is not None:
                t = read_transform(phone_section, i)
                exp = next(p for p in EX["parts"] if p["source"] == EX["reference"]["phone"])["frames"][i][0]
                if t is not None:
                    grip_worst_pos = max(grip_worst_pos, abs(t[0].x - exp[0]), abs(t[0].y - exp[1]), abs(t[0].z - exp[2]))
            dists = [v for k, v in row.items() if k.startswith("phone_to_head_m_")]
            if dists:
                grip_dist.append(min(dists))
            hand = row.get("nearest_body_part_to_phone")
            grip_hand.append(hand["m"] if hand else 9.99)
            pndc = row.get("phone_ndc")
            if pndc and not (0.0 <= pndc[0] <= 1.0 and 0.0 <= pndc[1] <= 1.0):
                grip_fail.append("phone out of frame at %d" % i)
    checks["framing"] = {"pass": frame_err <= 0.01 and out_of_frame == 0,
                         "detail": "head lands within %.4f of Blender's framing on every frame; %d frames with the head outside the safe frame" % (frame_err, out_of_frame),
                         "measured": {"max_ndc_error": round(frame_err, 5), "frames_out": out_of_frame}}
    if grip_dist:
        far = max(grip_dist)
        hand = min(grip_hand)
        hand_max = max(grip_hand)
        problems = list(grip_fail)
        if far > 0.22:
            problems.append("phone %.2f m from the face (ear range is under 0.22 m)" % far)
        if hand_max > 0.10:
            problems.append("no visible hand touches the phone (nearest body part %.2f-%.2f m away)" % (hand, hand_max))
        if grip_worst_pos > 1.0:
            problems.append("phone track reads back %.2f cm off the export" % grip_worst_pos)
        checks["phone_grip"] = {"pass": not problems, "detail": "; ".join(problems) if problems else "phone at the ear (%.2f m from the face), in frame, held by a visible hand, track matches the export" % far,
                                "measured": {"phone_to_face_m_max": round(far, 4), "nearest_body_part_m_min": round(hand, 4), "nearest_body_part_m_max": round(hand_max, 4), "track_error_cm": round(grip_worst_pos, 3)}}
    elif M["checks"].get("phone_grip"):
        checks["phone_grip"] = {"pass": False, "detail": "no phone measurements in the export", "measured": None}

    start, end = seq.get_playback_start(), seq.get_playback_end()
    rate = seq.get_display_rate()
    seq_ok = start == 0 and end == COUNT and rate.numerator == FPS and rate.denominator == 1
    checks["sequence_timing"] = {"pass": seq_ok, "detail": "Level Sequence runs frames %d-%d at %d/%d fps (manifest: %d frames at %d fps)" % (start, end, rate.numerator, rate.denominator, COUNT, FPS),
                                 "measured": {"frames": end - start, "fps": rate.numerator / max(1, rate.denominator)}}

    # ---- save, then the Movie Render Queue manifest ----
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    sub(unreal.LevelEditorSubsystem).save_current_level()

    queue_sub = sub(unreal.MoviePipelineQueueSubsystem)
    queue = queue_sub.get_queue()
    queue.delete_all_jobs()
    job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    job.set_editor_property("job_name", "%s_T%03d" % (SHOT, TAKE))
    job.set_editor_property("sequence", unreal.SoftObjectPath(seq.get_path_name()))
    world = unreal.EditorLevelLibrary.get_editor_world() if hasattr(unreal, "EditorLevelLibrary") else sub(unreal.UnrealEditorSubsystem).get_editor_world()
    job.set_editor_property("map", unreal.SoftObjectPath(world.get_path_name()))
    config = job.get_configuration()
    out = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    out.set_editor_property("output_directory", unreal.DirectoryPath(JOB["frames_dir"].replace("\\", "/")))
    out.set_editor_property("file_name_format", SHOT + ".{frame_number}")
    out.set_editor_property("output_resolution", unreal.IntPoint(int(M["resolution"]["width"]), int(M["resolution"]["height"])))
    out.set_editor_property("zero_pad_frame_numbers", 4)
    out.set_editor_property("override_existing_output", True)
    try:
        out.set_editor_property("use_custom_frame_rate", True)
        out.set_editor_property("output_frame_rate", unreal.FrameRate(FPS, 1))
    except Exception:
        pass
    config.find_or_add_setting_by_class(first("MoviePipelineDeferredPassBase"))
    config.find_or_add_setting_by_class(first("MoviePipelineImageSequenceOutput_PNG"))
    try:
        config.find_or_add_setting_by_class(unreal.MoviePipelineGameOverrideSetting)
    except Exception:
        pass
    aa = config.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    aa.set_editor_property("spatial_sample_count", 1)
    aa.set_editor_property("temporal_sample_count", 1)
    saved = unreal.MoviePipelineEditorLibrary.save_queue_to_manifest_file(queue)
    manifest_path = None
    for item in (saved if isinstance(saved, (tuple, list)) else [saved]):
        if isinstance(item, str) and item.endswith(".utxt"):
            manifest_path = item
    if not manifest_path:
        manifest_path = os.path.join(unreal.Paths.project_saved_dir(), "MovieRenderPipeline", "QueueManifest.utxt")
    if not os.path.isabs(manifest_path):
        abs_candidate = os.path.join(unreal.Paths.project_saved_dir(), manifest_path) if not manifest_path.startswith("MovieRenderPipeline") else os.path.join(unreal.Paths.project_saved_dir(), manifest_path)
        if os.path.exists(abs_candidate):
            manifest_path = abs_candidate
    say("queue manifest", manifest_path)

    ok = all(c["pass"] for k, c in checks.items() if k in ("scale", "sequence_timing"))
    write({"ok": ok, "map": map_path, "sequence": seq.get_path_name(), "queue_manifest": manifest_path,
           "frame_pattern": SHOT + ".%04d.png", "frame_start_number": 0, "checks": checks,
           "error": None if ok else "scale or sequence timing failed: build is not trustworthy",
           "elapsed_s": round(time.time() - started, 1)})


try:
    main()
except Exception as e:
    write({"ok": False, "error": "%s: %s" % (type(e).__name__, e), "traceback": traceback.format_exc()[-4000:]})
finally:
    try:
        unreal.SystemLibrary.quit_editor()
    except Exception:
        pass
