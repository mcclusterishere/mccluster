"""Render one approved Level Sequence through the in-editor Movie Render Queue.

Run by core/src/production/executor.mjs (sequence mode) as
    UnrealEditor.exe <copy of the approved .uproject> -ExecutePythonScript=<this file> -d3d12 ...
with MCC_UNREAL_JOB naming the job file the executor wrote:

    {"job_id", "map", "sequence", "output_dir", "result",
     "frames": {"start", "end", "fps"}, "resolution": {"width", "height"},
     "settings": {"spatial_samples", "temporal_samples", "engine_warmup_count", "render_warmup_count"}}

This is the path that worked on Prime (UE 5.8.4, AMD Radeon, D3D12): the
queue is built in memory and run with the PIE executor, the same as
"Render (Local)" in the Movie Render Queue window. No queue manifest is
written or parsed (that launch failed there).

The script never saves an asset, the map or the sequence: the queue it
builds is transient. It writes the result file, then quits the editor.
The executor decides success from the result file AND the frames on disk
AND the engine log; the editor's exit alone proves nothing.
"""

import json
import os
import time
import traceback

import unreal

RESULT_SCHEMA = "mccluster-unreal-render-result/1"
STATE = {"ticks": 0, "started": False, "executor": None, "handle": None, "job": None, "t0": time.time()}


def _job():
    with open(os.environ["MCC_UNREAL_JOB"], "r", encoding="utf-8") as handle:
        return json.load(handle)


def _write(job, **fields):
    out_dir = job["output_dir"]
    frames = sorted(name for name in os.listdir(out_dir) if name.lower().endswith(".png")) if os.path.isdir(out_dir) else []
    result = {
        "schema": RESULT_SCHEMA,
        "job_id": job.get("job_id"),
        "engine_version": unreal.SystemLibrary.get_engine_version(),
        "map": job["map"],
        "sequence": job["sequence"],
        "output_dir": out_dir,
        "frames_written": len(frames),
        "first_frame": frames[0] if frames else None,
        "last_frame": frames[-1] if frames else None,
        "elapsed_s": round(time.time() - STATE["t0"], 3),
    }
    result.update(fields)
    tmp = job["result"] + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=1)
    os.replace(tmp, job["result"])


def _quit():
    if STATE["handle"] is not None:
        unreal.unregister_slate_post_tick_callback(STATE["handle"])
        STATE["handle"] = None
    unreal.SystemLibrary.quit_editor()


def _configure(job):
    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsystem.get_queue()
    queue.delete_all_jobs()
    item = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    item.job_name = "mcc_" + job["job_id"][:8]
    item.map = unreal.SoftObjectPath(job["map"])
    item.sequence = unreal.SoftObjectPath(job["sequence"])
    config = item.get_configuration()

    output = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    output.output_directory = unreal.DirectoryPath(job["output_dir"])
    output.file_name_format = "frame.{frame_number}"
    output.zero_pad_frame_numbers = 4
    output.output_resolution = unreal.IntPoint(int(job["resolution"]["width"]), int(job["resolution"]["height"]))
    output.use_custom_frame_rate = True
    output.output_frame_rate = unreal.FrameRate(int(job["frames"]["fps"]), 1)
    output.use_custom_playback_range = True
    output.custom_start_frame = int(job["frames"]["start"])
    # Movie Render Queue's custom end frame is exclusive.
    output.custom_end_frame = int(job["frames"]["end"]) + 1
    output.override_existing_output = False

    config.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
    settings = job.get("settings") or {}
    if settings:
        aa = config.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
        if "spatial_samples" in settings:
            aa.spatial_sample_count = int(settings["spatial_samples"])
        if "temporal_samples" in settings:
            aa.temporal_sample_count = int(settings["temporal_samples"])
        if "engine_warmup_count" in settings:
            aa.engine_warm_up_count = int(settings["engine_warmup_count"])
        if "render_warmup_count" in settings:
            aa.render_warm_up_count = int(settings["render_warmup_count"])
    # Silent by contract: no audio output setting is added.
    return subsystem


def _on_finished(executor, success):
    job = STATE["job"]
    try:
        _write(job, ok=bool(success), executor_success=bool(success), error=None if success else "Movie Render Queue reported failure")
    finally:
        _quit()


def _on_error(executor, pipeline, is_fatal, error_text):
    unreal.log_error("mcc_render_sequence: " + str(error_text))
    STATE["last_error"] = str(error_text)


def _tick(delta):
    STATE["ticks"] += 1
    # Let the editor finish starting before the queue runs (a few frames).
    if STATE["started"] or STATE["ticks"] < 30:
        return
    STATE["started"] = True
    job = STATE["job"]
    try:
        subsystem = _configure(job)
        unreal.log("mcc_render_sequence: rendering " + job["sequence"] + " frames %d-%d" % (job["frames"]["start"], job["frames"]["end"]))
        executor = subsystem.render_queue_with_executor(unreal.MoviePipelinePIEExecutor)
        if executor is None:
            _write(job, ok=False, executor_success=False, error="render_queue_with_executor returned no executor")
            _quit()
            return
        STATE["executor"] = executor
        executor.on_executor_finished_delegate.add_callable_unique(_on_finished)
        executor.on_executor_errored_delegate.add_callable_unique(_on_error)
    except Exception:
        _write(job, ok=False, executor_success=False, error=traceback.format_exc()[-2000:])
        _quit()


def main():
    STATE["job"] = _job()
    os.makedirs(STATE["job"]["output_dir"], exist_ok=True)
    STATE["handle"] = unreal.register_slate_post_tick_callback(_tick)


try:
    main()
except Exception:
    try:
        _write(_job(), ok=False, executor_success=False, error=traceback.format_exc()[-2000:])
    finally:
        unreal.SystemLibrary.quit_editor()
