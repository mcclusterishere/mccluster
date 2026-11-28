"""Get It Back lyric review (tools/get-it-back/review_lyrics.py): confirmed wording is
found or proposed, unheard and low-confidence words are marked, silent lines are
never called wrong, and --apply writes the confirmed wording into a copy."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("review_lyrics", ROOT / "tools/get-it-back/review_lyrics.py")
rl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rl)

SHEET = {"timed": {"line": [
    {"begin": 1.0, "end": 3.0, "content": "Got the call, send it stat"},
    {"begin": 3.5, "end": 6.0, "content": "Definitely getting hacked for this,"},
    {"begin": 6.5, "end": 8.0, "content": "My pool a ghost"},
    {"begin": 9.0, "end": 10.0, "content": "Silent bar"},
]}}


def word(w, s, p=0.9):
    return {"start": s, "end": s + 0.2, "word": w, "probability": p}


ASR = {"segments": [{"words": [
    word("Got", 1.0), word("the", 1.2), word("call", 1.4), word("send", 1.7), word("it", 1.9, 0.3), word("stat", 2.1),
    word("Definitely", 3.6), word("getting", 4.0), word("hacked", 4.3), word("for", 4.6), word("that", 4.8),
    word("My", 6.6), word("pole", 6.9), word("a", 7.1), word("ghost", 7.3),
]}]}


class ReviewLyrics(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        (self.d / "l.json").write_text(json.dumps(SHEET))
        (self.d / "asr.json").write_text(json.dumps(ASR))

    def run_review(self, *extra):
        self.assertEqual(rl.main([str(self.d / "l.json"), "--out", str(self.d / "r.md"), *extra]), 0)
        return json.loads((self.d / "r.json").read_text()), (self.d / "r.md").read_text()

    def test_confirmed_wording_found_or_proposed(self):
        rep, md = self.run_review()
        by = {p["phrase"]: p for p in rep["phrases"]}
        self.assertTrue(by["send it stat"]["found"])
        self.assertFalse(by["definitely getting hacked for that"]["found"])
        self.assertEqual(by["definitely getting hacked for that"]["line"], 1)
        self.assertEqual(by["My pole a ghost"]["line"], 2)
        self.assertIn("not yet checked against the audio", md)
        self.assertEqual(rep["unclear_words"], 0, "without audio nothing is called unclear")

    def test_marks_unclear_against_asr(self):
        rep, md = self.run_review("--asr", str(self.d / "asr.json"))
        lines = rep["lines"]
        self.assertIn("[?it]", lines[0]["marked"], "low-confidence word is marked")
        self.assertIn("[?this,]", lines[1]["marked"], "the sheet's word the singer did not say is marked")
        self.assertIn("[?pool]", lines[2]["marked"])
        self.assertTrue(lines[3]["status"].startswith("unchecked"), "a line with nothing heard is unchecked, not wrong")
        self.assertEqual(rep["unclear_words"], 3)

    def test_apply_writes_confirmed_wording(self):
        self.run_review("--apply", str(self.d / "fixed.json"))
        fixed = json.loads((self.d / "fixed.json").read_text())["timed"]["line"]
        self.assertEqual(fixed[0]["content"], "Got the call, send it stat")
        self.assertEqual(fixed[1]["content"], "Definitely getting hacked for that,")
        self.assertEqual(fixed[2]["content"], "My pole a ghost")
        self.assertEqual(fixed[1]["begin"], 3.5, "timings are untouched")


if __name__ == "__main__":
    unittest.main()
