#!/usr/bin/env python3
"""Draw the tap card's QR straight from data/card.json.

    pip install segno
    python3 tools/qr.py

Only needs re-running when card.json's "url" changes, which is close to
never. SVG on purpose: it stays sharp printed on a sticker, on a business
card, or blown up on a banner, and it weighs a couple of kilobytes.

Error correction is set to H (30% recoverable) because these get printed on
things that scuff — a card in a pocket, a sticker on a case.
"""
import json
import pathlib

import segno

ROOT = pathlib.Path(__file__).resolve().parent.parent
card = json.loads((ROOT / "data" / "card.json").read_text())
url = card["url"]

out = ROOT / "assets" / "nfc"
out.mkdir(parents=True, exist_ok=True)

qr = segno.make(url, error="h")
# black on transparent: it sits on the card's own dark plate, and prints
# black on white paper without carrying a background box with it
qr.save(out / "card-qr.svg", scale=1, border=2, dark="#0a0807", light=None, svgclass=None, lineclass=None)
qr.save(out / "card-qr.png", scale=12, border=2, dark="#0a0807", light="#ffffff")

print(f"{url}\n  → assets/nfc/card-qr.svg  (screen + print)")
print(f"  → assets/nfc/card-qr.png  (for anywhere that won't take SVG)")
print(f"  version {qr.version}, error correction {qr.error.upper()}")
