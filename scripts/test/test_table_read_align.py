"""Table Read alignment on Prime (tools/table-read/prime/align_takes.py): the beep is
found where the audio has it, the timestamp is the fallback, heads trim to the first
sync cue, drift is measured against the server and the shot list follows the cues."""
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("align_takes", ROOT / "tools/table-read/prime/align_takes.py")
align_takes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align_takes)


def tone_with_beeps(path: Path, beeps_s, length_s=10.0, base_hz=330):
    parts = [f"sine=frequency={base_hz}:sample_rate=48000:duration={length_s}"]
    graph = "[0]volume=0.2[b]"
    inputs = ["-f", "lavfi", "-i", parts[0]]
    mix = ["[b]"]
    for i, t in enumerate(beeps_s, start=1):
        inputs += ["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.12"]
        graph += f";[{i}]volume=0.8,adelay={round(t * 1000)}|{round(t * 1000)}[p{i}]"
        mix.append(f"[p{i}]")
    graph += f";{''.join(mix)}amix=inputs={len(mix)}:normalize=0[out]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[out]", "-t", str(length_s), "-c:a", "libopus", str(path)], check=True)


def manifest(seat, role, stamped, server, lines):
    return {"schema": "mccluster-table-read-take/1", "room_id": "trtest", "take_id": "take-1", "seat_id": seat, "role": role,
            "started_device_t": 1000.0, "sync": [{"id": f"s{i + 1}", "server_at": server[i], "in_take_ms": stamped[i]} for i in range(len(stamped))],
            "lines": lines, "markers": [], "mime": "audio/webm"}


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class AlignTakes(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_beep_found_trimmed_and_drift_measured(self):
        # A: beeps at 1.000 s and 7.000 s; its clock stamped them 80 ms late.
        tone_with_beeps(self.dir / "a.webm", [1.0, 7.0])
        # B: started 400 ms later, so the same cue is at 0.600 s; its second beep 6.006 s later (1000 ppm long).
        tone_with_beeps(self.dir / "b.webm", [0.6, 6.606], base_hz=250)
        lines = [{"index": 0, "device_t": 1000.0}, {"index": 1, "device_t": 3500.0}, {"index": 2, "device_t": 6000.0}]
        (self.dir / "a.take.json").write_text(json.dumps(manifest("a1", "DAVE", [1080, 7080], [50_000, 56_000], lines)))
        (self.dir / "b.take.json").write_text(json.dumps(manifest("a2", "MATTHEW", [640, 6640], [50_000, 56_000], [])))
        session = {"scene": {"lines": [{"kind": "cue", "text": "ring"}, {"kind": "line", "speaker": "DAVE", "text": "Yo."}, {"kind": "line", "speaker": "MATTHEW", "text": "Dave?"}]}}
        (self.dir / "room.session.json").write_text(json.dumps(session))
        self.assertEqual(align_takes.main([str(self.dir)]), 0)
        out = json.loads((self.dir / "aligned/alignment.json").read_text())
        by = {t["role"]: t for t in out["takes"]}
        a, b = by["DAVE"], by["MATTHEW"]
        self.assertEqual(a["syncs"][0]["source"], "beep")
        self.assertAlmostEqual(a["syncs"][0]["beep_ms"], 1000, delta=12)
        self.assertAlmostEqual(a["syncs"][0]["clock_error_ms"], -80, delta=15)
        self.assertAlmostEqual(b["syncs"][0]["beep_ms"], 600, delta=15)
        self.assertAlmostEqual(a["trim_head_ms"] - b["trim_head_ms"], 400, delta=20)
        self.assertAlmostEqual(b["drift_ppm"], 1000, delta=250)
        self.assertTrue(b["tempo_corrected"])
        self.assertFalse(a["tempo_corrected"])
        self.assertTrue((self.dir / "aligned/voice_dave.wav").exists())
        self.assertEqual([s["speaker"] for s in out["shots"]], [None, "DAVE", "MATTHEW"])
        self.assertAlmostEqual(out["shots"][1]["start_ms"], 2500 - a["trim_head_ms"], delta=1)

    def test_timestamp_fallback_when_no_beep(self):
        tone_with_beeps(self.dir / "a.webm", [])
        (self.dir / "a.take.json").write_text(json.dumps(manifest("a1", "DAVE", [1500], [50_000], [])))
        self.assertEqual(align_takes.main([str(self.dir)]), 0)
        t = json.loads((self.dir / "aligned/alignment.json").read_text())["takes"][0]
        self.assertEqual(t["syncs"][0]["source"], "timestamp")
        self.assertEqual(t["syncs"][0]["used_ms"], 1500)


if __name__ == "__main__":
    unittest.main()
