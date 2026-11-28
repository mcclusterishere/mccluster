"""Compose review JPEGs and comparison sheets from the final PNG renders (Pillow).

Usage: python compose_review_sheets.py <png render dir> <approved pack dir> <hq-interior-v2 dir>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

final, pack, out = map(Path, sys.argv[1:4])
(out / "renders").mkdir(parents=True, exist_ok=True)
(out / "renders/compare").mkdir(parents=True, exist_ok=True)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
except Exception:
    font = ImageFont.load_default()

for p in sorted(final.glob("*.png")):
    Image.open(p).convert("RGB").save(out / "renders" / (p.stem + ".jpg"), quality=88, optimize=True)

BOARDS = {1: "EU-HQ-01-Arrival-Intake.png", 2: "EU-HQ-02-Public-Forum.png", 3: "EU-HQ-03-Fellowship-Field-Ops.png",
          4: "EU-HQ-04-Media-Culture.png", 5: "EU-HQ-05-Policy-Proof.png", 6: "EU-HQ-06-Executive-Command.png",
          7: "EU-HQ-07-Roof-Mobility.png"}


def fit(im, h):
    return im.resize((int(im.width * h / im.height), h), Image.LANCZOS)


def sheet(cells, name, h=560):
    ims = [fit(Image.open(p).convert("RGB"), h) for p, _ in cells]
    W = sum(i.width for i in ims) + 10 * (len(ims) + 1)
    S = Image.new("RGB", (W, h + 56), (245, 243, 238))
    d = ImageDraw.Draw(S)
    x = 10
    for im, (_, label) in zip(ims, cells):
        S.paste(im, (x, 46))
        d.text((x, 12), label, fill=(30, 30, 30), font=font)
        x += im.width + 10
    S.save(out / "renders/compare" / name, quality=86, optimize=True)


for f in range(1, 8):
    sheet([(pack / BOARDS[f], f"Approved board {f:02d} (visual direction)"),
           (final / f"F0{f}_BOARD.png", f"Rebuild v2 — F0{f} board-matching view"),
           (final / f"F0{f}_TOP.png", f"Rebuild v2 — F0{f} plan check (north up)")], f"F0{f}_board_vs_rebuild.jpg")
for f in (1, 6):
    for k in ("TOP", "EYE", "BOARD"):
        sheet([(final / f"BEFORE_F0{f}_{k}.png", f"BEFORE — official builder F0{f} ({k.lower()})"),
               (final / f"F0{f}_{k}.png", f"AFTER — Interior Rebuild v2 F0{f} ({k.lower()})")], f"F0{f}_before_after_{k}.jpg")
print("composed")
